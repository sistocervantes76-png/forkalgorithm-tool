// Task, approval and alert lifecycle. All state changes go through here so
// that every change gets a log line, an audit entry and consistent rules.
import type { Env } from "./env";
import {
  ACTION_TYPES,
  ALWAYS_APPROVE_KINDS,
  CAPABILITIES,
  MATERIAL_TASK_FIELDS,
  TASK_TRANSITIONS,
  type ApprovalCategory,
  type ApprovalStage,
  type Autonomy,
  type CapabilityKey,
  type Priority,
  type TaskStatus,
} from "../shared/domain";
import { HttpError, audit, newId, nowIso, parseJsonField, sha256Hex } from "./lib";
import { integrationUsable, sendToMake, secretsPresent } from "./integrations";

export interface AgentRow {
  id: string;
  slug: string;
  name: string;
  role_title: string;
  department_id: string | null;
  reports_to: string | null;
  icon: string;
  accent: string;
  nameplate_style: string;
  responsibilities: string;
  system_prompt: string;
  provider: string;
  model: string;
  autonomy: Autonomy;
  priority: Priority;
  authority_level: number;
  enabled: number;
  paused: number;
  schedule: string;
  replaced_by: string | null;
  archived: number;
  is_core: number;
  last_heartbeat_at: string | null;
  last_confirmed_execution_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string;
  agent_id: string | null;
  status: TaskStatus;
  priority: Priority;
  kind: string;
  requires_approval: number;
  approval_id: string | null;
  idempotency_key: string | null;
  parent_task_id: string | null;
  source: string;
  created_by: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  max_attempts: number;
  result: string | null;
  error: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
  action_type: string | null;
  destination: string | null;
  action_content: string | null;
  amount_cents: number | null;
  currency: string | null;
  content_lane: string | null;
  audience: string | null;
  evidence_ref: string | null;
}

export interface ApprovalRow {
  id: string;
  task_id: string | null;
  stage: ApprovalStage;
  title: string;
  description: string;
  category: ApprovalCategory;
  risk_level: string;
  action_type: string | null;
  destination: string | null;
  action_content: string | null;
  amount_cents: number | null;
  currency: string | null;
  fingerprint: string | null;
  explicit_outbound_authorization: number;
  requested_by: string | null;
  status: "pending" | "approved" | "rejected" | "held" | "invalidated";
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  invalidated_at: string | null;
  invalidated_reason: string | null;
  is_demo: number;
  created_at: string;
}

/** The exact-action fields carried by tasks and approvals. */
export interface ActionSpec {
  action_type?: string | null;
  destination?: string | null;
  action_content?: string | null;
  amount_cents?: number | null;
  currency?: string | null;
}

export async function getAgent(env: Env, id: string): Promise<AgentRow> {
  const a = await env.DB.prepare("SELECT * FROM agents WHERE id = ? OR slug = ?").bind(id, id).first<AgentRow>();
  if (!a) throw new HttpError(404, "Agent not found");
  return a;
}

export async function getTask(env: Env, id: string): Promise<TaskRow> {
  const t = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>();
  if (!t) throw new HttpError(404, "Task not found");
  return t;
}

export async function addLog(env: Env, taskId: string, level: "debug" | "info" | "warn" | "error", message: string, actor: string) {
  await env.DB.prepare("INSERT INTO task_logs (task_id, ts, level, message, actor) VALUES (?, ?, ?, ?, ?)")
    .bind(taskId, nowIso(), level, message.slice(0, 4000), actor)
    .run();
}

// ---------------------------------------------------------------- capabilities

export interface EffectiveCapability {
  key: CapabilityKey;
  label: string;
  integration: string;
  requested: boolean;
  granted: boolean;
  integration_ready: boolean;
  effective: boolean;
  blocked_reason: string | null;
}

/** A capability is effective only when requested AND granted by the owner AND its integration has credentials. */
export async function effectiveCapabilities(env: Env, agentId: string): Promise<EffectiveCapability[]> {
  const rows = await env.DB.prepare("SELECT capability, requested, granted FROM agent_capabilities WHERE agent_id = ?")
    .bind(agentId)
    .all<{ capability: string; requested: number; granted: number }>();
  const byKey = new Map(rows.results.map((r) => [r.capability, r]));
  const out: EffectiveCapability[] = [];
  for (const cap of CAPABILITIES) {
    const r = byKey.get(cap.key);
    const requested = Boolean(r?.requested);
    const granted = Boolean(r?.granted);
    const ready = await integrationUsable(env, cap.integration);
    let blocked: string | null = null;
    if (!requested) blocked = "Not enabled for this agent";
    else if (!granted) blocked = "Awaiting owner authorization";
    else if (!ready) blocked = `Integration "${cap.integration}" has no credentials`;
    out.push({ key: cap.key, label: cap.label, integration: cap.integration, requested, granted, integration_ready: ready, effective: !blocked, blocked_reason: blocked });
  }
  return out;
}

export async function hasCapability(env: Env, agentId: string, key: CapabilityKey): Promise<boolean> {
  return (await effectiveCapabilities(env, agentId)).some((c) => c.key === key && c.effective);
}

// ---------------------------------------------------------------- exact actions & fingerprints

const actionDef = (key: string | null | undefined) => ACTION_TYPES.find((a) => a.key === key);

/** True when the action type sends, publishes, pays, writes records or grants access. */
export function isExternalAction(actionType: string | null | undefined): boolean {
  return Boolean(actionDef(actionType)?.external);
}

function canonical(obj: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(obj).sort().map((k) => [k, obj[k] ?? null]));
}

/** Fingerprint of everything an EXECUTION approval covers: the task's material fields. */
export async function executionFingerprint(task: Pick<TaskRow, "id" | (typeof MATERIAL_TASK_FIELDS)[number]>): Promise<string> {
  const o: Record<string, unknown> = { stage: "execution", task_id: task.id };
  for (const f of MATERIAL_TASK_FIELDS) o[f] = (task as Record<string, unknown>)[f] ?? null;
  return sha256Hex(canonical(o));
}

/** Fingerprint of everything a RELEASE approval covers: exact action, destination, content and amount. */
export async function releaseFingerprint(taskId: string | null, a: ActionSpec): Promise<string> {
  return sha256Hex(
    canonical({
      stage: "release",
      task_id: taskId,
      action_type: a.action_type ?? null,
      destination: a.destination ?? null,
      action_content: a.action_content ?? null,
      amount_cents: a.amount_cents ?? null,
      currency: a.amount_cents != null ? (a.currency ?? "usd") : null,
    }),
  );
}

/** Validates that an action names everything its type requires (destination, content, amount). */
export function assertActionComplete(a: ActionSpec, context: string): void {
  const def = actionDef(a.action_type);
  if (!def) throw new HttpError(400, `${context}: choose an action type`);
  const missing = (def.needs as readonly string[]).filter((f) => {
    const v = (a as Record<string, unknown>)[f];
    return v === null || v === undefined || v === "";
  });
  if (missing.length) {
    const names: Record<string, string> = { destination: "destination", action_content: "exact content", amount_cents: "amount" };
    throw new HttpError(400, `${context}: ${def.label} needs ${missing.map((m) => names[m] ?? m).join(", ")}`);
  }
  if (a.amount_cents != null && (!Number.isInteger(a.amount_cents) || a.amount_cents < 0)) throw new HttpError(400, "Amount must be a whole number of cents, 0 or more");
}

// ---------------------------------------------------------------- Echo content rules

export interface ContentSpec {
  content_lane?: string | null;
  audience?: string | null;
  evidence_ref?: string | null;
}

const LANE_EXEMPT_KINDS = new Set(["research", "report"]);

/**
 * Echo drafts must use exactly one content lane and one audience. "Verified proof"
 * must point at a completed, non-demonstration task, so proof is never invented.
 */
export async function assertContentRules(env: Env, agent: AgentRow | null, kind: string, c: ContentSpec, selfId?: string): Promise<void> {
  const isEcho = agent?.slug === "echo" || agent?.id === "agt-echo";
  if (isEcho && !LANE_EXEMPT_KINDS.has(kind)) {
    if (!c.content_lane) throw new HttpError(400, "Echo content needs a content lane (operator lessons, revenue leaks, systems explained, build progress or verified proof)");
    if (!c.audience) throw new HttpError(400, "Echo content needs one audience: culinary or trade-service business. Never mix them in one post.");
  }
  if (c.content_lane === "verified_proof") {
    if (!c.evidence_ref) throw new HttpError(400, "Verified proof needs evidence: the ID of a completed task that shows the result");
    if (selfId && c.evidence_ref === selfId) throw new HttpError(400, "A task cannot be its own proof");
    const ev = await env.DB.prepare("SELECT status, is_demo FROM tasks WHERE id = ?").bind(c.evidence_ref).first<{ status: string; is_demo: number }>();
    if (!ev) throw new HttpError(400, `Evidence task ${c.evidence_ref} does not exist`);
    if (ev.is_demo) throw new HttpError(400, "Demonstration records can never be used as proof");
    if (ev.status !== "completed") throw new HttpError(400, `Evidence task ${c.evidence_ref} is ${ev.status}, not completed`);
  }
}

// ---------------------------------------------------------------- create

export interface CreateTaskInput extends ActionSpec, ContentSpec {
  title: string;
  description?: string;
  agent_id?: string | null;
  priority?: Priority;
  kind?: string;
  requires_approval?: boolean;
  idempotency_key?: string;
  parent_task_id?: string | null;
  scheduled_for?: string | null;
  max_attempts?: number;
  source: string;
  created_by: string;
  propose_only?: boolean;
  approval_category?: ApprovalCategory;
  is_demo?: boolean;
}

function approvalCategoryForKind(kind: string): ApprovalCategory {
  if (kind === "outreach") return "outbound_campaign";
  if (kind === "financial") return "financial";
  if (kind === "access") return "access";
  if (kind === "publication") return "publication";
  return "general";
}

function riskForKind(kind: string): string {
  return kind === "financial" || kind === "access" ? "high" : kind === "outreach" || kind === "publication" ? "medium" : "low";
}

export function needsApproval(kind: string, autonomy: Autonomy | null, explicit: boolean): { required: boolean; reason: string | null } {
  if (explicit) return { required: true, reason: "Approval explicitly requested" };
  if ((ALWAYS_APPROVE_KINDS as readonly string[]).includes(kind)) return { required: true, reason: `${kind} actions always require founder approval` };
  if (autonomy === "supervised") return { required: true, reason: "Agent runs under supervised execution" };
  return { required: false, reason: null };
}

export async function createTask(env: Env, input: CreateTaskInput): Promise<{ task: TaskRow; duplicate: boolean }> {
  if (input.idempotency_key) {
    const existing = await env.DB.prepare("SELECT * FROM tasks WHERE idempotency_key = ?").bind(input.idempotency_key).first<TaskRow>();
    if (existing) return { task: existing, duplicate: true };
  }

  const agent = input.agent_id ? await getAgent(env, input.agent_id) : null;
  if (agent?.archived) throw new HttpError(409, "Agent is archived");
  const kind = input.kind ?? "general";
  if (input.action_type) assertActionComplete(input, "Task action");
  await assertContentRules(env, agent, kind, input);
  const approval = needsApproval(kind, agent?.autonomy ?? null, Boolean(input.requires_approval));

  let status: TaskStatus;
  let note: string;
  if (input.propose_only) {
    status = "proposed";
    note = "Created as a proposal";
  } else if (agent?.autonomy === "observer") {
    status = "proposed";
    note = `${agent.name} is an observer and cannot execute tasks; kept as a proposal`;
  } else if (approval.required) {
    status = "awaiting_approval";
    note = approval.reason!;
  } else {
    status = "scheduled";
    note = "Scheduled. It runs only when a configured backend with valid credentials picks it up.";
  }

  const id = newId("TSK");
  const now = nowIso();
  const currency = input.amount_cents != null ? (input.currency ?? "usd").toLowerCase() : null;
  try {
    await env.DB.prepare(
      `INSERT INTO tasks (id, title, description, agent_id, status, priority, kind, requires_approval, idempotency_key,
        parent_task_id, source, created_by, scheduled_for, max_attempts, is_demo, created_at, updated_at,
        action_type, destination, action_content, amount_cents, currency, content_lane, audience, evidence_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, input.title, input.description ?? "", agent?.id ?? null, status, input.priority ?? agent?.priority ?? "normal", kind,
        approval.required ? 1 : 0, input.idempotency_key ?? null, input.parent_task_id ?? null, input.source, input.created_by,
        input.scheduled_for ?? null, input.max_attempts ?? 3, input.is_demo ? 1 : 0, now, now,
        input.action_type ?? null, input.destination ?? null, input.action_content ?? null, input.amount_cents ?? null, currency,
        input.content_lane ?? null, input.audience ?? null, input.evidence_ref ?? null,
      )
      .run();
  } catch (err) {
    // Unique constraint race on idempotency_key: return the winner.
    if (input.idempotency_key && String(err).includes("UNIQUE")) {
      const existing = await env.DB.prepare("SELECT * FROM tasks WHERE idempotency_key = ?").bind(input.idempotency_key).first<TaskRow>();
      if (existing) return { task: existing, duplicate: true };
    }
    throw err;
  }
  await addLog(env, id, "info", note, input.created_by);

  if (status === "awaiting_approval") {
    await requestExecutionApproval(env, await getTask(env, id), approval.reason!, input.created_by, input.approval_category);
  }

  await audit(env, input.created_by, "task.create", "task", id, { status, kind, agent_id: agent?.id ?? null, action_type: input.action_type ?? null });
  return { task: await getTask(env, id), duplicate: false };
}

/** Creates an execution-stage approval that snapshots the task's exact current spec. */
export async function requestExecutionApproval(env: Env, task: TaskRow, reason: string, actor: string, category?: ApprovalCategory): Promise<string> {
  const lines = [
    `${reason}.`,
    task.description ? `Instructions:\n${task.description}` : "",
    task.content_lane ? `Content lane: ${task.content_lane}${task.audience ? ` · Audience: ${task.audience}` : ""}${task.evidence_ref ? ` · Evidence: ${task.evidence_ref}` : ""}` : "",
  ].filter(Boolean);
  const approvalId = await createApproval(env, {
    task_id: task.id,
    stage: "execution",
    title: `Approve task: ${task.title}`,
    description: lines.join("\n\n"),
    category: category ?? (task.action_type ? (actionDef(task.action_type)?.category as ApprovalCategory) : approvalCategoryForKind(task.kind)),
    risk_level: riskForKind(task.kind),
    requested_by: actor,
    action_type: task.action_type,
    destination: task.destination,
    action_content: task.action_content,
    amount_cents: task.amount_cents,
    currency: task.currency,
    fingerprint: await executionFingerprint(task),
    is_demo: Boolean(task.is_demo),
  });
  await env.DB.prepare("UPDATE tasks SET approval_id = ?, requires_approval = 1 WHERE id = ?").bind(approvalId, task.id).run();
  return approvalId;
}

// ---------------------------------------------------------------- edits (material changes invalidate approvals)

export type TaskPatch = Partial<Pick<TaskRow, "title" | "description" | "priority" | "scheduled_for" | "agent_id" | "action_type" | "destination" | "action_content" | "amount_cents" | "currency" | "content_lane" | "audience" | "evidence_ref">>;

const RELEASE_FIELDS = new Set(["action_type", "destination", "action_content", "amount_cents", "currency"]);

/** Invalidates every live approval (pending, held or approved-but-unconsumed) for a task. */
export async function invalidateApprovals(env: Env, taskId: string, reason: string, actor: string, stage?: ApprovalStage): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT id FROM approvals WHERE task_id = ? AND status IN ('pending','held','approved')${stage ? " AND stage = ?" : ""}`,
  )
    .bind(...(stage ? [taskId, stage] : [taskId]))
    .all<{ id: string }>();
  const ids: string[] = [];
  for (const { id } of rows.results) {
    // Approved release approvals that were already dispatched are history, not live.
    const used = await env.DB.prepare("SELECT 1 AS x FROM task_dispatches WHERE approval_id = ? AND status = 'sent'").bind(id).first();
    if (used) continue;
    await env.DB.prepare("UPDATE approvals SET status = 'invalidated', invalidated_at = ?, invalidated_reason = ? WHERE id = ? AND status IN ('pending','held','approved')")
      .bind(nowIso(), reason.slice(0, 500), id)
      .run();
    await audit(env, actor, "approval.invalidated", "approval", id, { task_id: taskId, reason });
    ids.push(id);
  }
  return ids;
}

export async function updateTask(env: Env, taskId: string, patch: TaskPatch, actor: string): Promise<{ task: TaskRow; invalidated: string[] }> {
  const task = await getTask(env, taskId);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks are read-only");
  if (task.status === "running") throw new HttpError(409, "A running task cannot be edited. Pause it or wait for the result.");
  if (task.status === "cancelled") throw new HttpError(409, "Cancelled tasks cannot be edited");

  const changed = (Object.keys(patch) as (keyof TaskPatch)[]).filter((k) => patch[k] !== undefined && (patch[k] ?? null) !== (task[k] ?? null));
  if (!changed.length) return { task, invalidated: [] };
  if (task.status === "completed" && changed.some((k) => !RELEASE_FIELDS.has(k))) {
    throw new HttpError(409, "A completed task's instructions are final. Only its outbound action (destination, content, amount) can change.");
  }

  const next = { ...task, ...Object.fromEntries(changed.map((k) => [k, patch[k] ?? null])) } as TaskRow;
  if (next.amount_cents != null && !next.currency) next.currency = "usd";
  if (next.amount_cents == null) next.currency = null;
  const agent = next.agent_id ? await getAgent(env, next.agent_id) : null;
  if (agent?.archived) throw new HttpError(409, "Agent is archived");
  if (next.action_type) assertActionComplete(next, "Task action");
  await assertContentRules(env, agent, next.kind, next, task.id);

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE tasks SET title = ?, description = ?, priority = ?, scheduled_for = ?, agent_id = ?, action_type = ?, destination = ?,
       action_content = ?, amount_cents = ?, currency = ?, content_lane = ?, audience = ?, evidence_ref = ?, updated_at = ?
     WHERE id = ? AND updated_at = ?`,
  )
    .bind(
      next.title, next.description, next.priority, next.scheduled_for, next.agent_id, next.action_type, next.destination,
      next.action_content, next.amount_cents, next.currency, next.content_lane, next.audience, next.evidence_ref, now, task.id, task.updated_at,
    )
    .run()
    .then((r) => {
      if (!r.meta.changes) throw new HttpError(409, "Task changed concurrently; refresh and try again");
    });

  const material = changed.filter((k) => (MATERIAL_TASK_FIELDS as readonly string[]).includes(k));
  let invalidated: string[] = [];
  if (material.length) {
    const reason = `Material change after the approval was requested: ${material.join(", ")}`;
    if (task.status === "completed") {
      invalidated = await invalidateApprovals(env, task.id, reason, actor, "release");
    } else {
      invalidated = await invalidateApprovals(env, task.id, reason, actor);
      // A task that needed approval must be approved again for its new exact spec.
      if (task.requires_approval && ["awaiting_approval", "scheduled", "paused", "failed"].includes(task.status)) {
        await env.DB.prepare("UPDATE tasks SET status = 'awaiting_approval', updated_at = ? WHERE id = ?").bind(nowIso(), task.id).run();
        await requestExecutionApproval(env, await getTask(env, task.id), "Re-approval needed after a material change", actor);
      }
    }
    if (invalidated.length) await addLog(env, task.id, "warn", `${reason}. Invalidated approval(s): ${invalidated.join(", ")}`, actor);
  }
  await addLog(env, task.id, "info", `Edited: ${changed.join(", ")}`, actor);
  await audit(env, actor, "task.update", "task", task.id, { changed, material, invalidated });
  return { task: await getTask(env, task.id), invalidated };
}

// ---------------------------------------------------------------- transitions

export async function transitionTask(env: Env, taskId: string, to: TaskStatus, actor: string, note?: string): Promise<TaskRow> {
  const task = await getTask(env, taskId);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks are read-only");
  if (!TASK_TRANSITIONS[task.status].includes(to)) {
    throw new HttpError(409, `Cannot move a ${task.status} task to ${to}`);
  }
  // Resuming or retrying an approval-gated task requires its approval to still be valid.
  if (to === "scheduled" && task.requires_approval) {
    const blocked = await approvalBlock(env, task);
    if (blocked) throw new HttpError(409, blocked);
  }
  const now = nowIso();
  const res = await env.DB.prepare("UPDATE tasks SET status = ?, updated_at = ?, lease_expires_at = NULL WHERE id = ? AND status = ?")
    .bind(to, now, taskId, task.status)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "Task changed concurrently; refresh and try again");
  if (to === "cancelled") await invalidateApprovals(env, taskId, "Task cancelled", actor);
  const verb = task.status === "failed" && to === "scheduled" ? "Retry requested" : `Status ${task.status} → ${to}`;
  await addLog(env, taskId, "info", note ? `${verb}: ${note}` : verb, actor);
  await audit(env, actor, "task.transition", "task", taskId, { from: task.status, to, note });
  return getTask(env, taskId);
}

/** Returns why an approval-gated task may not run, or null when its approval matches the exact current spec. */
export async function approvalBlock(env: Env, task: TaskRow): Promise<string | null> {
  if (!task.requires_approval) return null;
  if (!task.approval_id) return "Task requires approval but has no approval record";
  const appr = await env.DB.prepare("SELECT status, fingerprint, stage FROM approvals WHERE id = ?").bind(task.approval_id).first<{ status: string; fingerprint: string | null; stage: string }>();
  if (!appr) return "Approval record is missing";
  if (appr.status !== "approved") return `Approval ${task.approval_id} is ${appr.status}`;
  if (!appr.fingerprint || appr.fingerprint !== (await executionFingerprint(task))) {
    return "The task changed after it was approved. The approval no longer covers it.";
  }
  return null;
}

/**
 * Atomically claims a scheduled task for execution. Returns null if someone else
 * claimed it first. Throws 409 when the task's approval does not cover it.
 * Duplicate execution is prevented three ways: the status guard, the updated_at
 * guard (no edit slipped in between check and claim) and the attempt primary key.
 */
export async function claimTask(env: Env, taskId: string, actor: string, leaseMinutes: number): Promise<TaskRow | null> {
  const task = await getTask(env, taskId);
  if (task.status !== "scheduled") return null;
  const blocked = await approvalBlock(env, task);
  if (blocked) throw new HttpError(409, `Execution blocked: ${blocked}`);

  const now = new Date();
  const lease = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  const row = await env.DB.prepare(
    `UPDATE tasks SET status = 'running', started_at = ?, completed_at = NULL, error = NULL, attempts = attempts + 1,
       lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'scheduled' AND updated_at = ? RETURNING *`,
  )
    .bind(now.toISOString(), lease, now.toISOString(), taskId, task.updated_at)
    .first<TaskRow>();
  if (!row) return null;
  const fp = task.requires_approval ? await executionFingerprint(task) : null;
  await env.DB.prepare("INSERT INTO task_attempts (task_id, attempt, executor, approval_fingerprint, started_at) VALUES (?, ?, ?, ?, ?)")
    .bind(taskId, row.attempts, actor, fp, now.toISOString())
    .run();
  await addLog(env, taskId, "info", `Execution started by ${actor} (attempt ${row.attempts} of ${row.max_attempts})`, actor);
  return row;
}

async function closeAttempt(env: Env, taskId: string, attempt: number, outcome: "completed" | "failed" | "lease_expired", error: string | null) {
  await env.DB.prepare("UPDATE task_attempts SET outcome = ?, finished_at = ?, error = ? WHERE task_id = ? AND attempt = ? AND outcome = 'running'")
    .bind(outcome, nowIso(), error?.slice(0, 4000) ?? null, taskId, attempt)
    .run();
}

export async function completeTask(env: Env, taskId: string, result: string, actor: string): Promise<TaskRow> {
  const now = nowIso();
  const row = await env.DB.prepare(
    `UPDATE tasks SET status = 'completed', completed_at = ?, result = ?, error = NULL, lease_expires_at = NULL, updated_at = ?
     WHERE id = ? AND status = 'running' RETURNING *`,
  )
    .bind(now, result.slice(0, 100_000), now, taskId)
    .first<TaskRow>();
  if (!row) throw new HttpError(409, "Only running tasks can be completed");
  await closeAttempt(env, taskId, row.attempts, "completed", null);
  if (row.agent_id) {
    await env.DB.prepare("UPDATE agents SET last_confirmed_execution_at = ? WHERE id = ?").bind(now, row.agent_id).run();
  }
  await addLog(env, taskId, "info", "Execution completed", actor);
  await audit(env, actor, "task.complete", "task", taskId, {});
  return row;
}

export async function failTask(env: Env, taskId: string, error: string, actor: string, retryable: boolean, leaseExpired = false): Promise<TaskRow> {
  const task = await getTask(env, taskId);
  if (task.status !== "running") throw new HttpError(409, "Only running tasks can be failed");
  const now = nowIso();
  const canRetry = retryable && task.attempts < task.max_attempts;
  // Guarded on status so a late completion and a failure can't both win.
  let res: D1Result;
  if (canRetry) {
    // Exponential backoff: 2, 4, 8 … minutes.
    const delay = Math.min(2 ** task.attempts, 60) * 60_000;
    const next = new Date(Date.now() + delay).toISOString();
    res = await env.DB.prepare(
      "UPDATE tasks SET status = 'scheduled', error = ?, scheduled_for = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
    )
      .bind(error.slice(0, 4000), next, now, taskId)
      .run();
    if (res.meta.changes) await addLog(env, taskId, "warn", `Attempt ${task.attempts} failed: ${error}. Automatic retry at ${next}`, actor);
  } else {
    res = await env.DB.prepare(
      "UPDATE tasks SET status = 'failed', error = ?, completed_at = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'running'",
    )
      .bind(error.slice(0, 4000), now, now, taskId)
      .run();
    if (res.meta.changes) {
      await addLog(env, taskId, "error", `Failed after ${task.attempts} attempt(s): ${error}`, actor);
      await raiseAlert(env, {
        severity: task.priority === "critical" ? "critical" : "warning",
        category: "failure",
        title: `Task failed: ${task.title}`,
        body: error.slice(0, 500),
        agent_id: task.agent_id,
        task_id: task.id,
        dedupe_key: `task-failed:${task.id}:${task.attempts}`,
      });
    }
  }
  if (!res.meta.changes) throw new HttpError(409, "Task changed concurrently");
  await closeAttempt(env, taskId, task.attempts, leaseExpired ? "lease_expired" : "failed", error);
  await audit(env, actor, "task.fail", "task", taskId, { error: error.slice(0, 500), retry_scheduled: canRetry, attempt: task.attempts });
  return getTask(env, taskId);
}

/** Recovers tasks whose execution lease lapsed (worker crashed or timed out). */
export async function recoverStuckTasks(env: Env): Promise<number> {
  const stuck = await env.DB.prepare("SELECT id FROM tasks WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?")
    .bind(nowIso())
    .all<{ id: string }>();
  for (const { id } of stuck.results) {
    await failTask(env, id, "Execution lease expired without a result (worker unresponsive)", "system", true, true).catch(() => null);
  }
  return stuck.results.length;
}

// ---------------------------------------------------------------- release (outbound action) approvals

/**
 * Requests founder approval to release a completed task's result to the outside
 * world. The approval records the exact action, destination, content and amount.
 */
export async function requestRelease(env: Env, taskId: string, spec: ActionSpec, actor: string): Promise<{ approval_id: string; task: TaskRow }> {
  const task = await getTask(env, taskId);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks cannot be released");
  if (task.status !== "completed") throw new HttpError(409, "Only completed tasks can be released");
  const a: ActionSpec = {
    action_type: spec.action_type ?? task.action_type,
    destination: spec.destination ?? task.destination,
    action_content: spec.action_content ?? task.action_content ?? task.result,
    amount_cents: spec.amount_cents !== undefined ? spec.amount_cents : task.amount_cents,
    currency: spec.currency ?? task.currency,
  };
  if (!isExternalAction(a.action_type)) throw new HttpError(400, "Choose an outbound action type (send, publish, update records, trigger workflow, payment or access)");
  assertActionComplete(a, "Release");
  if (a.amount_cents != null) a.currency = (a.currency ?? "usd").toLowerCase();
  else a.currency = null;
  const agent = task.agent_id ? await getAgent(env, task.agent_id) : null;
  await assertContentRules(env, agent, task.kind, task, task.id);

  await invalidateApprovals(env, task.id, "Superseded by a new release request", actor, "release");
  const def = actionDef(a.action_type)!;
  await env.DB.prepare("UPDATE tasks SET action_type = ?, destination = ?, action_content = ?, amount_cents = ?, currency = ?, updated_at = ? WHERE id = ?")
    .bind(a.action_type, a.destination, a.action_content, a.amount_cents ?? null, a.currency, nowIso(), task.id)
    .run();
  const approvalId = await createApproval(env, {
    task_id: task.id,
    stage: "release",
    title: `Release: ${def.label.split(" (")[0]} — ${task.title}`,
    description: `Approve sending this exact content to the destination below. Any change to the action, destination, content or amount voids this approval.`,
    category: def.category as ApprovalCategory,
    risk_level: def.category === "financial" || def.category === "access" ? "high" : def.category === "outbound_campaign" || def.category === "publication" ? "medium" : "low",
    requested_by: actor,
    ...a,
    fingerprint: await releaseFingerprint(task.id, a),
  });
  await addLog(env, task.id, "info", `Release approval ${approvalId} requested (${a.action_type} → ${a.destination})`, actor);
  await audit(env, actor, "task.release_request", "task", task.id, { approval_id: approvalId, action_type: a.action_type, destination: a.destination, amount_cents: a.amount_cents ?? null });
  return { approval_id: approvalId, task: await getTask(env, task.id) };
}

/** The approved, still-valid release approval for a task, or a reason it cannot be released. */
export async function validReleaseApproval(env: Env, task: TaskRow): Promise<{ approval: ApprovalRow } | { reason: string }> {
  const appr = await env.DB.prepare("SELECT * FROM approvals WHERE task_id = ? AND stage = 'release' ORDER BY created_at DESC LIMIT 1")
    .bind(task.id)
    .first<ApprovalRow>();
  if (!appr) return { reason: "No release approval has been requested for this task" };
  if (appr.status !== "approved") return { reason: `Release approval ${appr.id} is ${appr.status}` };
  const fp = await releaseFingerprint(task.id, task);
  if (appr.fingerprint !== fp) return { reason: "The action, destination, content or amount changed after approval" };
  if ((appr.category === "outbound_campaign" || appr.action_type === "send_message" || appr.action_type === "outbound_campaign") && !appr.explicit_outbound_authorization) return { reason: "Outbound campaigns need explicit authorization on the approval" };
  return { approval: appr };
}

// ---------------------------------------------------------------- approvals

export async function createApproval(
  env: Env,
  a: ActionSpec & {
    task_id?: string | null;
    stage?: ApprovalStage;
    title: string;
    description: string;
    category: ApprovalCategory;
    risk_level: string;
    requested_by: string;
    fingerprint?: string | null;
    is_demo?: boolean;
  },
): Promise<string> {
  const id = newId("APR");
  const fingerprint = a.fingerprint ?? (await releaseFingerprint(a.task_id ?? null, a));
  await env.DB.prepare(
    `INSERT INTO approvals (id, task_id, stage, title, description, category, risk_level, action_type, destination, action_content,
       amount_cents, currency, fingerprint, requested_by, status, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(
      id, a.task_id ?? null, a.stage ?? "execution", a.title, a.description, a.category, a.risk_level, a.action_type ?? null, a.destination ?? null,
      a.action_content ?? null, a.amount_cents ?? null, a.amount_cents != null ? (a.currency ?? "usd") : null, fingerprint, a.requested_by, a.is_demo ? 1 : 0, nowIso(),
    )
    .run();
  if (!a.is_demo) {
    await raiseAlert(env, {
      severity: a.risk_level === "high" || a.risk_level === "critical" ? "warning" : "info",
      category: "approval",
      title: `Approval needed: ${a.title}`,
      body: a.description.slice(0, 300),
      task_id: a.task_id ?? null,
      dedupe_key: `approval:${id}`,
    });
  }
  return id;
}

async function protectedLimitCents(env: Env, key: string): Promise<number> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return Math.round(Number(row?.value ?? 0) * 100);
}

export async function decideApproval(
  env: Env,
  approvalId: string,
  decision: "approved" | "rejected" | "held",
  userId: string,
  note: string | undefined,
  opts: { explicit_outbound?: boolean } = {},
) {
  const appr = await env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(approvalId).first<ApprovalRow>();
  if (!appr) throw new HttpError(404, "Approval not found");
  if (appr.is_demo) throw new HttpError(409, "Demonstration approvals cannot be decided");
  if (appr.status === "invalidated") throw new HttpError(409, `Approval was invalidated: ${appr.invalidated_reason ?? "the action changed"}. Review the new approval instead.`);
  if (appr.status === "approved" || appr.status === "rejected") throw new HttpError(409, `Approval was already ${appr.status}`);
  const actor = `user:${userId}`;
  const task = appr.task_id ? await getTask(env, appr.task_id) : null;

  if (decision === "approved") {
    // The approval must still describe exactly what will happen.
    if (task) {
      const current = appr.stage === "release" ? await releaseFingerprint(task.id, task) : await executionFingerprint(task);
      if (appr.fingerprint !== current) {
        await invalidateApprovals(env, task.id, "Task changed before the decision", actor, appr.stage);
        throw new HttpError(409, "The task changed after this approval was requested. It has been invalidated; review the current version.");
      }
    }
    // A real send (release stage, or a named outbound action) needs explicit authorization.
    // Approving a task to DRAFT outreach does not send anything; its release will ask again.
    if (appr.category === "outbound_campaign" && (appr.stage === "release" || isExternalAction(appr.action_type))) {
      if (!opts.explicit_outbound) throw new HttpError(409, "Outbound campaigns need explicit authorization: confirm the destination and content to approve.");
    }
    if (appr.category === "financial" || appr.action_type === "financial_transaction") {
      if (appr.stage === "release" && appr.amount_cents == null) throw new HttpError(409, "Financial approvals must state an amount");
      if (appr.amount_cents != null) {
        const limit = await protectedLimitCents(env, "limit.max_transaction_usd");
        if (appr.amount_cents > limit) {
          throw new HttpError(409, `Amount exceeds the protected per-transaction limit ($${(limit / 100).toFixed(2)}). Change the limit explicitly in Settings first; approvals never raise it.`);
        }
      }
    }
  }

  const now = nowIso();
  const res = await env.DB.prepare(
    `UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ?, explicit_outbound_authorization = ?
     WHERE id = ? AND status IN ('pending','held')`,
  )
    .bind(decision, userId, now, note ?? null, decision === "approved" && opts.explicit_outbound ? 1 : 0, approvalId)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "Approval changed concurrently");

  if (task && appr.stage === "execution" && task.approval_id === appr.id && task.status === "awaiting_approval") {
    if (decision === "approved") {
      await env.DB.prepare("UPDATE tasks SET status = 'scheduled', updated_at = ? WHERE id = ? AND status = 'awaiting_approval'").bind(now, task.id).run();
      await addLog(env, task.id, "info", `Approved by founder${note ? `: ${note}` : ""}. Scheduled.`, actor);
    } else if (decision === "rejected") {
      await env.DB.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?").bind(now, now, task.id).run();
      await addLog(env, task.id, "warn", `Rejected by founder${note ? `: ${note}` : ""}. Cancelled.`, actor);
    } else {
      await addLog(env, task.id, "info", `Put on hold by founder${note ? `: ${note}` : ""}`, actor);
    }
  } else if (task && appr.stage === "release") {
    await addLog(env, task.id, decision === "rejected" ? "warn" : "info", `Release ${decision} by founder${note ? `: ${note}` : ""}`, actor);
  }
  // Prospect outreach approvals move the prospect along too.
  if (decision !== "held") {
    await env.DB.prepare("UPDATE prospects SET outreach_status = ?, updated_at = ? WHERE approval_id = ? AND outreach_status = 'awaiting_approval'")
      .bind(decision === "approved" ? "approved" : "drafted", now, approvalId)
      .run();
  }
  await env.DB.prepare("UPDATE alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE dedupe_key = ? AND acknowledged_at IS NULL")
    .bind(userId, now, `approval:${approvalId}`)
    .run();
  await audit(env, actor, `approval.${decision}`, "approval", approvalId, {
    note,
    task_id: appr.task_id,
    stage: appr.stage,
    category: appr.category,
    fingerprint: appr.fingerprint,
    explicit_outbound: Boolean(opts.explicit_outbound),
  });
}

// ---------------------------------------------------------------- alerts

export async function raiseAlert(
  env: Env,
  a: { severity: "info" | "warning" | "critical"; category: string; title: string; body: string; agent_id?: string | null; task_id?: string | null; dedupe_key?: string },
) {
  const id = `ALR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const res = await env.DB.prepare(
    `INSERT INTO alerts (id, severity, category, title, body, agent_id, task_id, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (dedupe_key) DO NOTHING`,
  )
    .bind(id, a.severity, a.category, a.title, a.body, a.agent_id ?? null, a.task_id ?? null, a.dedupe_key ?? null, nowIso())
    .run();
  if (!res.meta.changes) return;

  // Immediate notification for configured categories, only if Make.com outbound is connected.
  const setting = await env.DB.prepare("SELECT value FROM settings WHERE key = 'alerts.immediate_categories'").first<{ value: string }>();
  const immediate = parseJsonField<string[]>(setting?.value, []);
  if (secretsPresent(env, "make_outbound") && (immediate.includes(a.category) || a.severity === "critical")) {
    try {
      await sendToMake(env, { type: "alert", id, ...a, created_at: nowIso() });
    } catch (err) {
      console.error("alert notification failed", err);
    }
  }
}
