// Task, approval and alert lifecycle. All state changes go through here so
// that every change gets a log line, an audit entry and consistent rules.
import type { Env } from "./env";
import {
  ALWAYS_APPROVE_KINDS,
  CAPABILITIES,
  TASK_TRANSITIONS,
  type ApprovalCategory,
  type Autonomy,
  type CapabilityKey,
  type Priority,
  type TaskStatus,
} from "../shared/domain";
import { HttpError, audit, newId, nowIso, parseJsonField } from "./lib";
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

// ---------------------------------------------------------------- create

export interface CreateTaskInput {
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
  return "general";
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
    note = "Scheduled — will run when a configured worker or executor picks it up";
  }

  const id = newId("TSK");
  const now = nowIso();
  try {
    await env.DB.prepare(
      `INSERT INTO tasks (id, title, description, agent_id, status, priority, kind, requires_approval, idempotency_key,
        parent_task_id, source, created_by, scheduled_for, max_attempts, is_demo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, input.title, input.description ?? "", agent?.id ?? null, status, input.priority ?? agent?.priority ?? "normal", kind,
        approval.required ? 1 : 0, input.idempotency_key ?? null, input.parent_task_id ?? null, input.source, input.created_by,
        input.scheduled_for ?? null, input.max_attempts ?? 3, input.is_demo ? 1 : 0, now, now,
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
    const approvalId = await createApproval(env, {
      task_id: id,
      title: `Approve task: ${input.title}`,
      description: `${approval.reason}.\n\n${input.description ?? ""}`.trim(),
      category: input.approval_category ?? approvalCategoryForKind(kind),
      risk_level: kind === "financial" || kind === "access" ? "high" : kind === "outreach" ? "medium" : "low",
      requested_by: input.created_by,
      is_demo: input.is_demo,
    });
    await env.DB.prepare("UPDATE tasks SET approval_id = ? WHERE id = ?").bind(approvalId, id).run();
  }

  await audit(env, input.created_by, "task.create", "task", id, { status, kind, agent_id: agent?.id ?? null });
  return { task: await getTask(env, id), duplicate: false };
}

// ---------------------------------------------------------------- transitions

export async function transitionTask(env: Env, taskId: string, to: TaskStatus, actor: string, note?: string): Promise<TaskRow> {
  const task = await getTask(env, taskId);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks are read-only");
  if (!TASK_TRANSITIONS[task.status].includes(to)) {
    throw new HttpError(409, `Cannot move a ${task.status} task to ${to}`);
  }
  const now = nowIso();
  const res = await env.DB.prepare("UPDATE tasks SET status = ?, updated_at = ?, lease_expires_at = NULL WHERE id = ? AND status = ?")
    .bind(to, now, taskId, task.status)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "Task changed concurrently; refresh and try again");
  const verb = task.status === "failed" && to === "scheduled" ? "Retry requested" : `Status ${task.status} → ${to}`;
  await addLog(env, taskId, "info", note ? `${verb}: ${note}` : verb, actor);
  await audit(env, actor, "task.transition", "task", taskId, { from: task.status, to, note });
  return getTask(env, taskId);
}

/** Atomically claims a scheduled task for execution. Returns null if someone else claimed it first. */
export async function claimTask(env: Env, taskId: string, actor: string, leaseMinutes: number): Promise<TaskRow | null> {
  const now = new Date();
  const lease = new Date(now.getTime() + leaseMinutes * 60_000).toISOString();
  const row = await env.DB.prepare(
    `UPDATE tasks SET status = 'running', started_at = ?, completed_at = NULL, error = NULL, attempts = attempts + 1,
       lease_expires_at = ?, updated_at = ?
     WHERE id = ? AND status = 'scheduled' RETURNING *`,
  )
    .bind(now.toISOString(), lease, now.toISOString(), taskId)
    .first<TaskRow>();
  if (!row) return null;
  await addLog(env, taskId, "info", `Execution started (attempt ${row.attempts} of ${row.max_attempts})`, actor);
  return row;
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
  if (row.agent_id) {
    await env.DB.prepare("UPDATE agents SET last_confirmed_execution_at = ? WHERE id = ?").bind(now, row.agent_id).run();
  }
  await addLog(env, taskId, "info", "Execution completed", actor);
  await audit(env, actor, "task.complete", "task", taskId, {});
  return row;
}

export async function failTask(env: Env, taskId: string, error: string, actor: string, retryable: boolean): Promise<TaskRow> {
  const task = await getTask(env, taskId);
  if (task.status !== "running") throw new HttpError(409, "Only running tasks can be failed");
  const now = nowIso();
  const canRetry = retryable && task.attempts < task.max_attempts;
  if (canRetry) {
    // Exponential backoff: 2, 4, 8 … minutes.
    const delay = Math.min(2 ** task.attempts, 60) * 60_000;
    const next = new Date(Date.now() + delay).toISOString();
    await env.DB.prepare(
      "UPDATE tasks SET status = 'scheduled', error = ?, scheduled_for = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(error.slice(0, 4000), next, now, taskId)
      .run();
    await addLog(env, taskId, "warn", `Attempt ${task.attempts} failed: ${error}. Automatic retry at ${next}`, actor);
  } else {
    await env.DB.prepare(
      "UPDATE tasks SET status = 'failed', error = ?, completed_at = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(error.slice(0, 4000), now, now, taskId)
      .run();
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
  await audit(env, actor, "task.fail", "task", taskId, { error: error.slice(0, 500), retry_scheduled: canRetry });
  return getTask(env, taskId);
}

/** Recovers tasks whose execution lease lapsed (worker crashed or timed out). */
export async function recoverStuckTasks(env: Env): Promise<number> {
  const stuck = await env.DB.prepare("SELECT id FROM tasks WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?")
    .bind(nowIso())
    .all<{ id: string }>();
  for (const { id } of stuck.results) {
    await failTask(env, id, "Execution lease expired without a result (worker unresponsive)", "system", true);
  }
  return stuck.results.length;
}

// ---------------------------------------------------------------- approvals

export async function createApproval(
  env: Env,
  a: { task_id?: string | null; title: string; description: string; category: ApprovalCategory; risk_level: string; requested_by: string; is_demo?: boolean },
): Promise<string> {
  const id = newId("APR");
  await env.DB.prepare(
    `INSERT INTO approvals (id, task_id, title, description, category, risk_level, requested_by, status, is_demo, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(id, a.task_id ?? null, a.title, a.description, a.category, a.risk_level, a.requested_by, a.is_demo ? 1 : 0, nowIso())
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

export async function decideApproval(env: Env, approvalId: string, decision: "approved" | "rejected" | "held", userId: string, note: string | undefined) {
  const appr = await env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(approvalId).first<{ id: string; status: string; task_id: string | null; category: string; is_demo: number }>();
  if (!appr) throw new HttpError(404, "Approval not found");
  if (appr.is_demo) throw new HttpError(409, "Demonstration approvals cannot be decided");
  if (appr.status === "approved" || appr.status === "rejected") throw new HttpError(409, `Approval was already ${appr.status}`);

  const now = nowIso();
  const res = await env.DB.prepare(
    "UPDATE approvals SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status IN ('pending','held')",
  )
    .bind(decision, userId, now, note ?? null, approvalId)
    .run();
  if (!res.meta.changes) throw new HttpError(409, "Approval changed concurrently");
  const actor = `user:${userId}`;

  if (appr.task_id) {
    const task = await getTask(env, appr.task_id);
    if (task.status === "awaiting_approval") {
      if (decision === "approved") {
        await env.DB.prepare("UPDATE tasks SET status = 'scheduled', updated_at = ? WHERE id = ?").bind(now, task.id).run();
        await addLog(env, task.id, "info", `Approved by founder${note ? `: ${note}` : ""}. Scheduled.`, actor);
      } else if (decision === "rejected") {
        await env.DB.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ?, completed_at = ? WHERE id = ?").bind(now, now, task.id).run();
        await addLog(env, task.id, "warn", `Rejected by founder${note ? `: ${note}` : ""}. Cancelled.`, actor);
      } else {
        await addLog(env, task.id, "info", `Put on hold by founder${note ? `: ${note}` : ""}`, actor);
      }
    }
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
  await audit(env, actor, `approval.${decision}`, "approval", approvalId, { note, task_id: appr.task_id, category: appr.category });
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
