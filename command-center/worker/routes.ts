// Authenticated JSON API for the Command Center UI.
import type { Env } from "./env";
import {
  ACTION_TYPE_KEYS,
  APPROVAL_CATEGORIES,
  AUDIENCE_KEYS,
  AUTONOMY_LEVELS,
  CONTENT_LANE_KEYS,
  TASK_KINDS,
  WEEKDAYS,
  CAPABILITIES,
  FEEDBACK_VERDICTS,
  OUTREACH_STATUSES,
  PRIORITIES,
  PROTECTED_SETTING_PREFIXES,
  ROLES,
  TASK_STATUSES,
  type TaskStatus,
} from "../shared/domain";
import { hashPassword, requireRole, type User } from "./auth";
import { HttpError, audit, json, newId, nowIso, parseJsonField } from "./lib";
import { bool, int, isoDate, oneOf, reqStr, str, strArray, url } from "./validate";
import {
  addLog,
  approvalBlock,
  createApproval,
  createTask,
  decideApproval,
  effectiveCapabilities,
  getAgent,
  getTask,
  requestExecutionApproval,
  requestRelease,
  transitionTask,
  updateTask,
  validReleaseApproval,
  assertActionComplete,
  type ActionSpec,
  type AgentRow,
  type TaskPatch,
} from "./tasks";
import { INTEGRATIONS, integrationStatuses, secretsPresent, sendToMake, stripeFinancialSummary, testIntegration } from "./integrations";
import { canExecuteInWorker, executeTask, executionReadiness } from "./executor";
import { generateBriefing, nextReviewDate, reviewSchedule, weekStart } from "./briefing";
import { clearDemo, loadDemo } from "./demo";

export interface Ctx {
  req: Request;
  env: Env;
  user: User;
  params: Record<string, string>;
  url: URL;
  body: Record<string, unknown>;
  ip: string;
}

type Handler = (c: Ctx) => Promise<Response>;
export const routes: [string, string, Handler][] = [];
const route = (method: string, path: string, h: Handler) => routes.push([method, path, h]);

const actorOf = (c: Ctx) => `user:${c.user.id}`;
/** Demo rows are hidden unless the viewer opts in with ?demo=1. */
const demoFilter = (c: Ctx, alias = "") => (c.url.searchParams.get("demo") === "1" ? "" : ` AND ${alias}is_demo = 0`);

/**
 * Reads the exact-action and content-lane fields shared by task create/edit and
 * release requests. With `nullable`, an explicit null clears a field.
 */
function actionAndContent(b: Record<string, unknown>, nullable = false) {
  const n = <T>(field: string, read: () => T): T | null | undefined => (nullable && b[field] === null ? null : read());
  return {
    action_type: n("action_type", () => oneOf(b, "action_type", ACTION_TYPE_KEYS, true)),
    destination: n("destination", () => str(b, "destination", { optional: true, max: 500 })),
    action_content: n("action_content", () => str(b, "action_content", { optional: true, max: 20_000, trim: false })),
    amount_cents: n("amount_cents", () => int(b, "amount_cents", { optional: true, min: 0, max: 100_000_000 })),
    currency: n("currency", () => {
      const v = str(b, "currency", { optional: true, max: 3 });
      if (v && !/^[a-zA-Z]{3}$/.test(v)) throw new HttpError(400, "Invalid currency: use a 3-letter code");
      return v?.toLowerCase();
    }),
    content_lane: n("content_lane", () => oneOf(b, "content_lane", CONTENT_LANE_KEYS, true)),
    audience: n("audience", () => oneOf(b, "audience", AUDIENCE_KEYS, true)),
    evidence_ref: n("evidence_ref", () => str(b, "evidence_ref", { optional: true, max: 40 })),
  };
}

// ---------------------------------------------------------------- agent helpers

function connectionState(env: Env, a: AgentRow): { state: string; label: string } {
  if (a.archived) return { state: "archived", label: "Archived" };
  if (!a.enabled) return { state: "disabled", label: "Profile disabled" };
  if (a.paused) return { state: "paused", label: "Paused" };
  if (a.provider === "anthropic") {
    return env.ANTHROPIC_API_KEY
      ? { state: "configured", label: "Profile enabled · Anthropic key set (readiness checks below)" }
      : { state: "not_configured", label: "Not configured · ANTHROPIC_API_KEY missing" };
  }
  if (a.provider === "custom-worker") {
    if (!a.last_heartbeat_at) return { state: "awaiting_worker", label: "No worker has connected yet" };
    const age = Date.now() - new Date(a.last_heartbeat_at).getTime();
    return age < 10 * 60_000 ? { state: "online", label: "Worker online" } : { state: "offline", label: "Worker offline" };
  }
  return { state: "not_configured", label: "Profile enabled · no execution backend, so nothing runs" };
}

async function agentStats(c: Ctx) {
  const df = demoFilter(c);
  const rows = await c.env.DB.prepare(
    `SELECT agent_id,
       SUM(status = 'completed') AS completed, SUM(status = 'failed') AS failed,
       SUM(status IN ('scheduled','running','awaiting_approval','proposed','paused')) AS open
     FROM tasks WHERE agent_id IS NOT NULL${df} GROUP BY agent_id`,
  ).all<{ agent_id: string; completed: number; failed: number; open: number }>();
  const current = await c.env.DB.prepare(
    `SELECT agent_id, id, title, status FROM tasks WHERE status IN ('running','scheduled','awaiting_approval')${df}
     ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, updated_at DESC`,
  ).all<{ agent_id: string; id: string; title: string; status: string }>();
  const errLogs = await c.env.DB.prepare(
    `SELECT t.agent_id, COUNT(*) AS n FROM task_logs l JOIN tasks t ON t.id = l.task_id
     WHERE l.level = 'error' AND l.ts > ?${demoFilter(c, "t.")} GROUP BY t.agent_id`,
  )
    .bind(new Date(Date.now() - 30 * 86400_000).toISOString())
    .all<{ agent_id: string; n: number }>();
  const stats = new Map(rows.results.map((r) => [r.agent_id, r]));
  const assignment = new Map<string, { id: string; title: string; status: string }>();
  for (const r of current.results) if (!assignment.has(r.agent_id)) assignment.set(r.agent_id, r);
  const errors = new Map(errLogs.results.map((r) => [r.agent_id, r.n]));
  return { stats, assignment, errors };
}

function presentAgent(env: Env, a: AgentRow, s: Awaited<ReturnType<typeof agentStats>>, readiness?: Awaited<ReturnType<typeof executionReadiness>>) {
  const st = s.stats.get(a.id);
  const done = (st?.completed ?? 0) + (st?.failed ?? 0);
  return {
    ...a,
    enabled: Boolean(a.enabled),
    paused: Boolean(a.paused),
    archived: Boolean(a.archived),
    is_core: Boolean(a.is_core),
    responsibilities: parseJsonField<string[]>(a.responsibilities, []),
    schedule: parseJsonField<Record<string, unknown>>(a.schedule, {}),
    connection: connectionState(env, a),
    readiness: readiness ?? null,
    verified_execution: a.last_confirmed_execution_at ? { last_at: a.last_confirmed_execution_at } : { last_at: null, label: "No verified executions yet" },
    current_assignment: s.assignment.get(a.id) ?? null,
    stats: {
      completed: st?.completed ?? 0,
      failed: st?.failed ?? 0,
      open: st?.open ?? 0,
      completion_rate: done ? Math.round(((st?.completed ?? 0) / done) * 100) : null,
      error_count_30d: s.errors.get(a.id) ?? 0,
    },
  };
}

// ---------------------------------------------------------------- session

route("GET", "/api/auth/me", async (c) => json({ user: c.user }));

// ---------------------------------------------------------------- overview

route("GET", "/api/overview", async (c) => {
  const db = c.env.DB;
  const df = demoFilter(c);
  const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const [taskCounts, approvals, alerts, pipeline, runs, briefing, demo, agents] = await Promise.all([
    db.prepare(`SELECT status, COUNT(*) AS n FROM tasks WHERE 1=1${df} GROUP BY status`).all<{ status: string; n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM approvals WHERE status IN ('pending','held')${df}`).first<{ n: number }>(),
    db.prepare(`SELECT severity, COUNT(*) AS n FROM alerts WHERE acknowledged_at IS NULL${df} GROUP BY severity`).all<{ severity: string; n: number }>(),
    db.prepare(`SELECT outreach_status AS status, COUNT(*) AS n, SUM(COALESCE(deal_value_cents,0)) AS value FROM prospects WHERE 1=1${df} GROUP BY outreach_status`).all(),
    db.prepare(`SELECT COUNT(*) AS total, SUM(status='completed') AS completed, SUM(status='failed') AS failed FROM workflow_runs WHERE created_at > ?${df}`).bind(since7).first(),
    db.prepare("SELECT id, week_of, generated_at, generated_by FROM briefings ORDER BY generated_at DESC LIMIT 1").first(),
    db.prepare(
      "SELECT (SELECT COUNT(*) FROM tasks WHERE is_demo=1)+(SELECT COUNT(*) FROM prospects WHERE is_demo=1)+(SELECT COUNT(*) FROM workflow_runs WHERE is_demo=1) AS n",
    ).first<{ n: number }>(),
    db.prepare("SELECT enabled, paused, provider FROM agents WHERE archived = 0").all<{ enabled: number; paused: number; provider: string }>(),
  ]);
  const integrations = await integrationStatuses(c.env);
  return json({
    tasks: Object.fromEntries(taskCounts.results.map((r) => [r.status, r.n])),
    approvals_pending: approvals?.n ?? 0,
    alerts_open: Object.fromEntries(alerts.results.map((r) => [r.severity, r.n])),
    pipeline: pipeline.results,
    workflow_runs_7d: runs,
    latest_briefing: briefing,
    demo_records: demo?.n ?? 0,
    agents: {
      total: agents.results.length,
      enabled: agents.results.filter((a) => a.enabled && !a.paused).length,
      with_backend: agents.results.filter((a) => a.provider !== "none").length,
    },
    integrations: integrations.map((i) => ({ key: i.key, name: i.name, status: i.status })),
    next_briefing: nextReviewDate(await reviewSchedule(c.env)),
    review_schedule: await reviewSchedule(c.env),
    verified_executions: (await db.prepare("SELECT COUNT(*) AS n FROM task_attempts a JOIN tasks t ON t.id = a.task_id WHERE a.outcome = 'completed' AND t.is_demo = 0").first<{ n: number }>())?.n ?? 0,
  });
});

route("GET", "/api/activity", async (c) => {
  const limit = Math.min(Number(c.url.searchParams.get("limit") ?? 40), 200);
  const rows = await c.env.DB.prepare(
    `SELECT 'log' AS type, l.ts, l.level, l.message, l.actor, l.task_id, t.title AS task_title, t.agent_id, t.is_demo
       FROM task_logs l JOIN tasks t ON t.id = l.task_id WHERE 1=1${demoFilter(c, "t.")}
     ORDER BY l.ts DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return json({ items: rows.results });
});

// ---------------------------------------------------------------- departments

route("GET", "/api/departments", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM departments ORDER BY is_custom, name").all();
  return json({ departments: rows.results });
});

route("POST", "/api/departments", async (c) => {
  requireRole(c.user, "admin");
  const name = reqStr(c.body, "name", { max: 80 });
  const id = `dept-${crypto.randomUUID().slice(0, 8)}`;
  await c.env.DB.prepare("INSERT INTO departments (id, name, description, is_custom, created_at) VALUES (?, ?, ?, 1, ?)")
    .bind(id, name, str(c.body, "description", { optional: true, max: 500 }) ?? "", nowIso())
    .run()
    .catch(() => {
      throw new HttpError(409, "A department with that name already exists");
    });
  await audit(c.env, actorOf(c), "department.create", "department", id, { name }, c.ip);
  return json({ id }, 201);
});

// ---------------------------------------------------------------- agents

route("GET", "/api/agents", async (c) => {
  const includeArchived = c.url.searchParams.get("archived") === "1";
  const rows = await c.env.DB.prepare(`SELECT * FROM agents ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY is_core DESC, created_at, name`).all<AgentRow>();
  const s = await agentStats(c);
  const readiness = await Promise.all(rows.results.map((a) => executionReadiness(c.env, a)));
  return json({ agents: rows.results.map((a, i) => presentAgent(c.env, a, s, readiness[i])) });
});

route("GET", "/api/agents/:id", async (c) => {
  const a = await getAgent(c.env, c.params.id);
  const s = await agentStats(c);
  const df = demoFilter(c);
  const [caps, tasks, logs, skills] = await Promise.all([
    effectiveCapabilities(c.env, a.id),
    c.env.DB.prepare(`SELECT id, title, status, kind, priority, created_at, completed_at, is_demo FROM tasks WHERE agent_id = ?${df} ORDER BY created_at DESC LIMIT 50`).bind(a.id).all(),
    c.env.DB.prepare(
      `SELECT l.* FROM task_logs l JOIN tasks t ON t.id = l.task_id WHERE t.agent_id = ?${demoFilter(c, "t.")} ORDER BY l.ts DESC LIMIT 50`,
    ).bind(a.id).all(),
    // Skill indicators come only from tasks a worker or executor actually finished.
    c.env.DB.prepare(
      `SELECT kind, SUM(status='completed') AS completed, SUM(status='failed') AS failed, MAX(completed_at) AS last_at
       FROM tasks WHERE agent_id = ? AND status IN ('completed','failed') AND attempts > 0${df} GROUP BY kind`,
    ).bind(a.id).all(),
  ]);
  const blocked = await canExecuteInWorker(c.env, a);
  return json({
    agent: presentAgent(c.env, a, s, await executionReadiness(c.env, a)),
    capabilities: caps,
    tasks: tasks.results,
    logs: logs.results,
    skills: skills.results,
    executor: { in_worker_available: !blocked, blocked_reason: blocked },
  });
});

route("POST", "/api/agents", async (c) => {
  requireRole(c.user, "admin");
  const name = reqStr(c.body, "name", { max: 60 });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `agent-${Date.now()}`;
  const id = `agt-${slug}-${crypto.randomUUID().slice(0, 4)}`;
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO agents (id, slug, name, role_title, department_id, reports_to, icon, responsibilities, system_prompt, autonomy, priority, authority_level, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'agt-atlas', ?, ?, ?, 'draft_only', 'normal', 1, ?, ?)`,
  )
    .bind(
      id, `${slug}-${id.slice(-4)}`, name, reqStr(c.body, "role_title", { max: 80 }), str(c.body, "department_id", { optional: true, max: 60 }) ?? null,
      str(c.body, "icon", { optional: true, max: 30 }) ?? "bot", JSON.stringify(strArray(c.body, "responsibilities", { optional: true, maxItems: 20 }) ?? []),
      str(c.body, "system_prompt", { optional: true, max: 8000 }) ?? "", now, now,
    )
    .run();
  await c.env.DB.batch(CAPABILITIES.map((cap) => c.env.DB.prepare("INSERT INTO agent_capabilities (agent_id, capability) VALUES (?, ?)").bind(id, cap.key)));
  await audit(c.env, actorOf(c), "agent.create", "agent", id, { name }, c.ip);
  return json({ id }, 201);
});

route("PATCH", "/api/agents/:id", async (c) => {
  requireRole(c.user, "admin");
  const a = await getAgent(c.env, c.params.id);
  const b = c.body;
  const sets: string[] = [];
  const vals: unknown[] = [];
  const changes: Record<string, unknown> = {};
  const set = (col: string, v: unknown) => {
    if (v === undefined) return;
    sets.push(`${col} = ?`);
    vals.push(v);
    changes[col] = v;
  };
  set("name", str(b, "name", { optional: true, max: 60 }));
  set("role_title", str(b, "role_title", { optional: true, max: 80 }));
  set("icon", str(b, "icon", { optional: true, max: 30 }));
  set("accent", oneOf(b, "accent", ["emerald", "teal", "amber", "slate", "rose", "sky", "tan", "charcoal"], true));
  set("nameplate_style", oneOf(b, "nameplate_style", ["standard", "brass", "minimal"], true));
  set("department_id", str(b, "department_id", { optional: true, max: 60 }));
  const resp = strArray(b, "responsibilities", { optional: true, maxItems: 20 });
  if (resp) set("responsibilities", JSON.stringify(resp));
  set("system_prompt", str(b, "system_prompt", { optional: true, max: 8000, trim: false }));
  set("provider", oneOf(b, "provider", ["none", "anthropic", "custom-worker"], true));
  set("model", str(b, "model", { optional: true, max: 80 }));
  set("autonomy", oneOf(b, "autonomy", AUTONOMY_LEVELS, true));
  set("priority", oneOf(b, "priority", PRIORITIES, true));
  if (b.authority_level !== undefined) {
    requireRole(c.user, "owner");
    set("authority_level", int(b, "authority_level", { min: 0, max: 5 }));
  }
  const enabled = bool(b, "enabled");
  if (enabled !== undefined) set("enabled", enabled ? 1 : 0);
  const paused = bool(b, "paused");
  if (paused !== undefined) set("paused", paused ? 1 : 0);
  if (b.schedule !== undefined) {
    const s = b.schedule as Record<string, unknown>;
    if (!s || typeof s !== "object") throw new HttpError(400, "Invalid schedule");
    const days = strArray(s, "days", { maxItems: 7 }) ?? [];
    if (days.some((d) => !["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(d))) throw new HttpError(400, "Invalid schedule days");
    const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
    const start = str(s, "start", { optional: true, max: 5 });
    const end = str(s, "end", { optional: true, max: 5 });
    if ((start && !hm.test(start)) || (end && !hm.test(end))) throw new HttpError(400, "Schedule times must be HH:MM");
    const tz = str(s, "tz", { optional: true, max: 60 }) ?? "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new HttpError(400, "Unknown time zone");
    }
    set("schedule", JSON.stringify({ days, start, end, tz }));
  }
  if (!sets.length) throw new HttpError(400, "No changes supplied");
  sets.push("updated_at = ?");
  vals.push(nowIso());
  await c.env.DB.prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, a.id).run();
  // Never log the full prompt into audit details, only that it changed.
  if ("system_prompt" in changes) changes.system_prompt = "(updated)";
  await audit(c.env, actorOf(c), "agent.update", "agent", a.id, changes, c.ip);
  return json({ ok: true });
});

route("PUT", "/api/agents/:id/capabilities", async (c) => {
  requireRole(c.user, "admin");
  const a = await getAgent(c.env, c.params.id);
  const cap = oneOf(c.body, "capability", CAPABILITIES.map((x) => x.key))!;
  const requested = bool(c.body, "requested");
  const granted = bool(c.body, "granted");
  if (granted !== undefined) requireRole(c.user, "owner"); // authorization is owner-only
  const now = nowIso();
  if (requested !== undefined) {
    await c.env.DB.prepare(
      `INSERT INTO agent_capabilities (agent_id, capability, requested) VALUES (?, ?, ?)
       ON CONFLICT (agent_id, capability) DO UPDATE SET requested = excluded.requested,
         granted = CASE WHEN excluded.requested = 0 THEN 0 ELSE granted END`,
    ).bind(a.id, cap, requested ? 1 : 0).run();
  }
  if (granted !== undefined) {
    const row = await c.env.DB.prepare("SELECT requested FROM agent_capabilities WHERE agent_id = ? AND capability = ?").bind(a.id, cap).first<{ requested: number }>();
    if (granted && !row?.requested) throw new HttpError(409, "Enable the capability for this agent before authorizing it");
    await c.env.DB.prepare("UPDATE agent_capabilities SET granted = ?, granted_by = ?, granted_at = ? WHERE agent_id = ? AND capability = ?")
      .bind(granted ? 1 : 0, granted ? c.user.id : null, granted ? now : null, a.id, cap)
      .run();
  }
  await audit(c.env, actorOf(c), "agent.capability", "agent", a.id, { capability: cap, requested, granted }, c.ip);
  return json({ capabilities: await effectiveCapabilities(c.env, a.id) });
});

route("POST", "/api/agents/:id/replace", async (c) => {
  requireRole(c.user, "owner");
  const old = await getAgent(c.env, c.params.id);
  if (old.id === "agt-atlas") throw new HttpError(409, "The Chief of Staff can be reconfigured but not replaced");
  const name = reqStr(c.body, "name", { max: 60 });
  const newIdStr = `agt-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${crypto.randomUUID().slice(0, 4)}`;
  const now = nowIso();
  const db = c.env.DB;
  await db.batch([
    db.prepare(
      `INSERT INTO agents (id, slug, name, role_title, department_id, reports_to, icon, accent, responsibilities, system_prompt, autonomy, priority, authority_level, schedule, is_core, created_at, updated_at)
       SELECT ?, ?, ?, role_title, department_id, reports_to, icon, accent, responsibilities, system_prompt, 'draft_only', priority, MIN(authority_level, 2), schedule, is_core, ?, ? FROM agents WHERE id = ?`,
    ).bind(newIdStr, newIdStr.slice(4), name, now, now, old.id),
    db.prepare("INSERT INTO agent_capabilities (agent_id, capability, requested, granted) SELECT ?, capability, requested, 0 FROM agent_capabilities WHERE agent_id = ?").bind(newIdStr, old.id),
    db.prepare("UPDATE agents SET archived = 1, enabled = 0, replaced_by = ?, updated_at = ? WHERE id = ?").bind(newIdStr, now, old.id),
    db.prepare("UPDATE tasks SET agent_id = ?, updated_at = ? WHERE agent_id = ? AND status IN ('proposed','awaiting_approval','scheduled','paused')").bind(newIdStr, now, old.id),
  ]);
  await audit(c.env, actorOf(c), "agent.replace", "agent", old.id, { replacement: newIdStr, note: "Capability grants reset; replacement starts in draft-only mode" }, c.ip);
  return json({ id: newIdStr }, 201);
});

// ---------------------------------------------------------------- tasks

route("GET", "/api/tasks", async (c) => {
  const p = c.url.searchParams;
  const where: string[] = ["1=1"];
  const vals: unknown[] = [];
  const status = p.get("status");
  if (status && (TASK_STATUSES as readonly string[]).includes(status)) (where.push("t.status = ?"), vals.push(status));
  if (p.get("agent")) (where.push("t.agent_id = ?"), vals.push(p.get("agent")));
  if (p.get("q")) (where.push("(t.title LIKE ? OR t.id LIKE ?)"), vals.push(`%${p.get("q")}%`, `%${p.get("q")}%`));
  const rows = await c.env.DB.prepare(
    `SELECT t.*, a.name AS agent_name FROM tasks t LEFT JOIN agents a ON a.id = t.agent_id
     WHERE ${where.join(" AND ")}${demoFilter(c, "t.")} ORDER BY t.updated_at DESC LIMIT 300`,
  )
    .bind(...vals)
    .all();
  return json({ tasks: rows.results });
});

route("POST", "/api/tasks", async (c) => {
  requireRole(c.user, "operator");
  const { task, duplicate } = await createTask(c.env, {
    title: reqStr(c.body, "title", { max: 200 }),
    description: str(c.body, "description", { optional: true, max: 8000 }),
    agent_id: str(c.body, "agent_id", { optional: true, max: 80 }) ?? null,
    priority: oneOf(c.body, "priority", PRIORITIES, true),
    kind: oneOf(c.body, "kind", TASK_KINDS, true),
    requires_approval: bool(c.body, "requires_approval"),
    ...actionAndContent(c.body),
    idempotency_key: str(c.body, "idempotency_key", { optional: true, max: 120 }),
    scheduled_for: isoDate(c.body, "scheduled_for"),
    max_attempts: int(c.body, "max_attempts", { optional: true, min: 1, max: 10 }),
    propose_only: bool(c.body, "propose_only"),
    source: "manual",
    created_by: actorOf(c),
  });
  return json({ task, duplicate }, duplicate ? 200 : 201);
});

route("GET", "/api/tasks/:id", async (c) => {
  const task = await getTask(c.env, c.params.id);
  const [logs, approval, approvals, attempts, dispatch, feedback, agent] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM task_logs WHERE task_id = ? ORDER BY ts, id").bind(task.id).all(),
    task.approval_id ? c.env.DB.prepare("SELECT * FROM approvals WHERE id = ?").bind(task.approval_id).first() : null,
    c.env.DB.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at DESC").bind(task.id).all(),
    c.env.DB.prepare("SELECT * FROM task_attempts WHERE task_id = ? ORDER BY attempt").bind(task.id).all(),
    c.env.DB.prepare("SELECT * FROM task_dispatches WHERE task_id = ?").bind(task.id).all(),
    c.env.DB.prepare("SELECT f.*, u.name AS user_name FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE f.target_type = 'task' AND f.target_id = ? ORDER BY f.created_at DESC").bind(task.id).all(),
    task.agent_id ? getAgent(c.env, task.agent_id) : null,
  ]);
  const blocked = agent ? (await canExecuteInWorker(c.env, agent)) ?? (await approvalBlock(c.env, task)) : "No agent assigned";
  const release = task.status === "completed" ? await validReleaseApproval(c.env, task) : null;
  return json({
    task,
    logs: logs.results,
    approval,
    approvals: approvals.results,
    attempts: attempts.results,
    dispatches: dispatch.results,
    feedback: feedback.results,
    agent_name: agent?.name ?? null,
    can_run_in_worker: !blocked,
    run_blocked_reason: blocked,
    release: release ? ("approval" in release ? { ready: true, approval_id: release.approval.id } : { ready: false, reason: release.reason }) : null,
  });
});

route("PATCH", "/api/tasks/:id", async (c) => {
  requireRole(c.user, "operator");
  const b = c.body;
  const patch: TaskPatch = {
    title: str(b, "title", { optional: true, max: 200 }),
    description: b.description === "" ? "" : str(b, "description", { optional: true, max: 8000 }),
    priority: oneOf(b, "priority", PRIORITIES, true),
    scheduled_for: b.scheduled_for === null ? null : isoDate(b, "scheduled_for"),
    agent_id: b.agent_id === null ? null : str(b, "agent_id", { optional: true, max: 80 }),
    ...actionAndContent(b, true),
  };
  for (const k of Object.keys(patch) as (keyof TaskPatch)[]) if (patch[k] === undefined) delete patch[k];
  const { task, invalidated } = await updateTask(c.env, c.params.id, patch, actorOf(c));
  return json({ task, invalidated });
});

route("POST", "/api/tasks/:id/release", async (c) => {
  requireRole(c.user, "operator");
  const r = await requestRelease(c.env, c.params.id, actionAndContent(c.body, true) as ActionSpec, actorOf(c));
  return json(r, 201);
});

route("POST", "/api/tasks/:id/transition", async (c) => {
  requireRole(c.user, "operator");
  const to = oneOf(c.body, "to", TASK_STATUSES)! as TaskStatus;
  const task = await getTask(c.env, c.params.id);
  // Moving a proposal forward re-applies approval rules.
  if (task.status === "proposed" && to === "scheduled" && task.agent_id) {
    const agent = await getAgent(c.env, task.agent_id);
    if (agent.autonomy === "observer") throw new HttpError(409, `${agent.name} is an observer and cannot execute tasks`);
    if (task.requires_approval || agent.autonomy === "supervised" || ["outreach", "financial", "access", "publication"].includes(task.kind)) {
      throw new HttpError(409, "This task needs founder approval. Submit it for approval instead.");
    }
  }
  if (to === "awaiting_approval") {
    if (task.status !== "proposed") throw new HttpError(409, "Only proposals can be submitted for approval");
    await requestExecutionApproval(c.env, task, "Submitted for founder approval", actorOf(c));
  }
  const updated = await transitionTask(c.env, task.id, to, actorOf(c), str(c.body, "note", { optional: true, max: 500 }));
  return json({ task: updated });
});

route("POST", "/api/tasks/:id/retry", async (c) => {
  requireRole(c.user, "operator");
  const task = await getTask(c.env, c.params.id);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks are read-only");
  if (task.status !== "failed") throw new HttpError(409, "Only failed tasks can be retried");
  const blocked = await approvalBlock(c.env, task);
  if (blocked) throw new HttpError(409, blocked);
  // Controlled retry: one extra attempt at a time, with the previous error kept in the attempt history.
  const updated = await c.env.DB.prepare(
    "UPDATE tasks SET max_attempts = MAX(max_attempts, attempts + 1), scheduled_for = NULL, updated_at = ? WHERE id = ? AND status = 'failed' AND updated_at = ?",
  )
    .bind(nowIso(), task.id, task.updated_at)
    .run();
  if (!updated.meta.changes) throw new HttpError(409, "Task changed concurrently; refresh and try again");
  return json({ task: await transitionTask(c.env, task.id, "scheduled", actorOf(c), str(c.body, "note", { optional: true, max: 500 }) ?? `manual retry after: ${task.error ?? "unknown error"}`) });
});

route("POST", "/api/tasks/:id/run", async (c) => {
  requireRole(c.user, "operator");
  return json({ task: await executeTask(c.env, c.params.id, actorOf(c)) });
});

route("POST", "/api/tasks/:id/notes", async (c) => {
  requireRole(c.user, "operator");
  const task = await getTask(c.env, c.params.id);
  await addLog(c.env, task.id, "info", `Note: ${reqStr(c.body, "message", { max: 2000 })}`, actorOf(c));
  return json({ ok: true }, 201);
});

route("POST", "/api/tasks/:id/dispatch", async (c) => {
  // Sends a completed task's exact, release-approved action to Make.com. Owner only.
  requireRole(c.user, "owner");
  const task = await getTask(c.env, c.params.id);
  if (task.is_demo) throw new HttpError(409, "Demonstration tasks cannot be dispatched");
  if (task.status !== "completed") throw new HttpError(409, "Only completed tasks can be dispatched");
  const release = await validReleaseApproval(c.env, task);
  if ("reason" in release) throw new HttpError(409, release.reason);
  if (!secretsPresent(c.env, "make_outbound")) throw new HttpError(409, "Make.com outbound is not configured");
  const retry = bool(c.body, "retry") ?? false;
  const now = nowIso();
  const actor = actorOf(c);

  // Claim the dispatch slot first. The primary key (task_id, target) makes a second send impossible;
  // only a failed dispatch can be retried, and only explicitly.
  const claim = retry
    ? await c.env.DB.prepare(
        "UPDATE task_dispatches SET status = 'sending', attempts = attempts + 1, approval_id = ?, fingerprint = ?, actor = ?, updated_at = ? WHERE task_id = ? AND target = 'make' AND status = 'failed'",
      ).bind(release.approval.id, release.approval.fingerprint, actor, now, task.id).run()
    : await c.env.DB.prepare(
        "INSERT INTO task_dispatches (task_id, target, approval_id, fingerprint, status, actor, created_at, updated_at) VALUES (?, 'make', ?, ?, 'sending', ?, ?, ?) ON CONFLICT (task_id, target) DO NOTHING",
      ).bind(task.id, release.approval.id, release.approval.fingerprint, actor, now, now).run();
  if (!claim.meta.changes) {
    const existing = await c.env.DB.prepare("SELECT status FROM task_dispatches WHERE task_id = ? AND target = 'make'").bind(task.id).first<{ status: string }>();
    throw new HttpError(409, existing?.status === "failed" ? "The last dispatch failed. Retry it explicitly." : `Already dispatched (${existing?.status ?? "unknown"}); duplicate prevented`);
  }
  try {
    await sendToMake(c.env, {
      type: "task.dispatch",
      idempotency_key: `dispatch:${task.id}:${release.approval.fingerprint}`,
      task_id: task.id,
      approval_id: release.approval.id,
      action_type: task.action_type,
      destination: task.destination,
      content: task.action_content,
      amount_cents: task.amount_cents,
      currency: task.currency,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Dispatch failed";
    await c.env.DB.prepare("UPDATE task_dispatches SET status = 'failed', last_error = ?, updated_at = ? WHERE task_id = ? AND target = 'make'").bind(message, nowIso(), task.id).run();
    await addLog(c.env, task.id, "error", `Dispatch to Make.com failed: ${message}`, actor);
    await audit(c.env, actor, "task.dispatch_failed", "task", task.id, { error: message }, c.ip);
    throw new HttpError(502, `Dispatch failed: ${message}. Nothing was marked as sent; you can retry.`);
  }
  await c.env.DB.prepare("UPDATE task_dispatches SET status = 'sent', last_error = NULL, updated_at = ? WHERE task_id = ? AND target = 'make'").bind(nowIso(), task.id).run();
  await addLog(c.env, task.id, "info", `Dispatched to Make.com under approval ${release.approval.id}`, actor);
  await audit(c.env, actor, "task.dispatch", "task", task.id, { approval_id: release.approval.id, fingerprint: release.approval.fingerprint }, c.ip);
  return json({ ok: true });
});

// ---------------------------------------------------------------- approvals

route("GET", "/api/approvals", async (c) => {
  const status = c.url.searchParams.get("status");
  const where = status === "open" ? "ap.status IN ('pending','held')" : status ? "ap.status = ?" : "1=1";
  if (status && status !== "open" && !["approved", "rejected", "invalidated", "pending", "held"].includes(status)) throw new HttpError(400, "Unknown status filter");
  const stmt = c.env.DB.prepare(
    `SELECT ap.*, t.title AS task_title, t.agent_id, a.name AS agent_name FROM approvals ap
     LEFT JOIN tasks t ON t.id = ap.task_id LEFT JOIN agents a ON a.id = t.agent_id
     WHERE ${where}${demoFilter(c, "ap.")} ORDER BY ap.created_at DESC LIMIT 200`,
  );
  const rows = await (status && status !== "open" ? stmt.bind(status) : stmt).all();
  return json({ approvals: rows.results });
});

route("POST", "/api/approvals", async (c) => {
  requireRole(c.user, "operator");
  const action = actionAndContent(c.body, true) as ActionSpec;
  assertActionComplete(action, "Approval");
  const id = await createApproval(c.env, {
    title: reqStr(c.body, "title", { max: 200 }),
    description: str(c.body, "description", { optional: true, max: 4000 }) ?? "",
    category: oneOf(c.body, "category", APPROVAL_CATEGORIES)!,
    risk_level: oneOf(c.body, "risk_level", ["low", "medium", "high", "critical"], true) ?? "medium",
    requested_by: actorOf(c),
    ...action,
  });
  await audit(c.env, actorOf(c), "approval.request", "approval", id, {}, c.ip);
  return json({ id }, 201);
});

route("POST", "/api/approvals/:id/decision", async (c) => {
  requireRole(c.user, "owner");
  const decision = oneOf(c.body, "decision", ["approved", "rejected", "held"])!;
  await decideApproval(c.env, c.params.id, decision, c.user.id, str(c.body, "note", { optional: true, max: 1000 }), {
    explicit_outbound: bool(c.body, "explicit_outbound") ?? false,
  });
  return json({ ok: true });
});

// ---------------------------------------------------------------- chief of staff

route("GET", "/api/chief-of-staff", async (c) => {
  const db = c.env.DB;
  const df = demoFilter(c);
  const [byDept, completed, failed, approvals, opportunities, incidents, recs, feedback] = await Promise.all([
    db.prepare(
      `SELECT d.name AS department, a.name AS agent, a.id AS agent_id,
         SUM(t.status IN ('proposed','awaiting_approval','scheduled','running','paused')) AS open,
         SUM(t.status = 'completed') AS completed, SUM(t.status = 'failed') AS failed
       FROM agents a LEFT JOIN departments d ON d.id = a.department_id
       LEFT JOIN tasks t ON t.agent_id = a.id${df.replace("is_demo", "t.is_demo")}
       WHERE a.archived = 0 AND a.id != 'agt-atlas' GROUP BY a.id ORDER BY d.name`,
    ).all(),
    db.prepare(`SELECT t.id, t.title, t.completed_at, a.name AS agent_name, t.is_demo FROM tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.status = 'completed'${demoFilter(c, "t.")} ORDER BY t.completed_at DESC LIMIT 10`).all(),
    db.prepare(`SELECT t.id, t.title, t.error, t.completed_at, a.name AS agent_name, t.is_demo FROM tasks t LEFT JOIN agents a ON a.id = t.agent_id WHERE t.status = 'failed'${demoFilter(c, "t.")} ORDER BY t.updated_at DESC LIMIT 10`).all(),
    db.prepare(`SELECT id, title, category, risk_level, status, created_at, is_demo FROM approvals WHERE status IN ('pending','held')${df} ORDER BY created_at`).all(),
    db.prepare(`SELECT id, business_name, outreach_status, qualification_score, deal_value_cents, meeting_at, is_demo FROM prospects WHERE outreach_status IN ('replied','meeting','qualified')${df} ORDER BY updated_at DESC LIMIT 20`).all(),
    db.prepare(`SELECT * FROM alerts WHERE category IN ('failure','security','integration','system') AND acknowledged_at IS NULL${df} ORDER BY created_at DESC LIMIT 20`).all(),
    db.prepare(`SELECT * FROM recommendations WHERE 1=1${df} ORDER BY created_at DESC LIMIT 30`).all(),
    db.prepare(
      `SELECT f.*, COALESCE(r.title, t.title) AS recommendation_title, u.name AS user_name FROM feedback f
       LEFT JOIN recommendations r ON f.target_type = 'recommendation' AND r.id = f.target_id
       LEFT JOIN tasks t ON f.target_type = 'task' AND t.id = f.target_id
       LEFT JOIN users u ON u.id = f.user_id
       ORDER BY f.created_at DESC LIMIT 50`,
    ).all(),
  ]);
  return json({
    departments: byDept.results,
    completed: completed.results,
    failed: failed.results,
    approvals: approvals.results,
    opportunities: opportunities.results,
    incidents: incidents.results,
    recommendations: recs.results,
    feedback: feedback.results,
  });
});

route("POST", "/api/recommendations", async (c) => {
  requireRole(c.user, "operator");
  const id = newId("REC");
  await c.env.DB.prepare(
    "INSERT INTO recommendations (id, agent_id, week_of, title, body, status, source, created_at) VALUES (?, ?, ?, ?, ?, 'open', 'manual', ?)",
  )
    .bind(id, str(c.body, "agent_id", { optional: true, max: 80 }) ?? "agt-atlas", weekStart(), reqStr(c.body, "title", { max: 200 }), reqStr(c.body, "body", { max: 8000 }), nowIso())
    .run();
  await audit(c.env, actorOf(c), "recommendation.create", "recommendation", id, {}, c.ip);
  return json({ id }, 201);
});

const VERDICT_STATUS = { like: "liked", dislike: "disliked", modify: "modify_requested", hold: "held" } as const;

/**
 * Records Like / Dislike / Modify / Hold on a recommendation or a task. Feedback
 * updates planning preferences only (planning.agent.<id>). It never changes task
 * status, capabilities, autonomy, authority or protected settings.
 */
async function recordFeedback(c: Ctx, targetType: "recommendation" | "task", targetId: string) {
  requireRole(c.user, "owner");
  let agentId: string | null;
  let title: string;
  let lane: string | null = null;
  if (targetType === "recommendation") {
    const rec = await c.env.DB.prepare("SELECT id, agent_id, title FROM recommendations WHERE id = ?").bind(targetId).first<{ id: string; agent_id: string | null; title: string }>();
    if (!rec) throw new HttpError(404, "Recommendation not found");
    agentId = rec.agent_id;
    title = rec.title;
  } else {
    const t = await getTask(c.env, targetId);
    if (t.is_demo) throw new HttpError(409, "Feedback on demonstration data is not recorded");
    agentId = t.agent_id;
    title = t.title;
    lane = t.content_lane;
  }
  const verdict = oneOf(c.body, "verdict", FEEDBACK_VERDICTS)!;
  const note = str(c.body, "note", { optional: true, max: 2000 }) ?? "";
  if (verdict === "modify" && !note) throw new HttpError(400, "Describe the modification you want");
  const fid = newId("FBK");
  const now = nowIso();
  const stmts = [
    c.env.DB.prepare("INSERT INTO feedback (id, recommendation_id, target_type, target_id, verdict, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(fid, targetType === "recommendation" ? targetId : null, targetType, targetId, verdict, note, c.user.id, now),
  ];
  if (targetType === "recommendation") stmts.push(c.env.DB.prepare("UPDATE recommendations SET status = ? WHERE id = ?").bind(VERDICT_STATUS[verdict], targetId));
  await c.env.DB.batch(stmts);

  const prefKey = `planning.agent.${agentId ?? "agt-atlas"}`;
  assertNotProtected(prefKey);
  const existing = await c.env.DB.prepare("SELECT value FROM founder_preferences WHERE key = ?").bind(prefKey).first<{ value: string }>();
  const pref = parseJsonField<{ like: number; dislike: number; modify: number; hold: number; recent: { verdict: string; title: string; note: string; lane?: string | null; on: string }[] }>(
    existing?.value,
    { like: 0, dislike: 0, modify: 0, hold: 0, recent: [] },
  );
  pref[verdict] += 1;
  pref.recent = [{ verdict, title, note, lane, on: targetType }, ...pref.recent].slice(0, 10);
  await c.env.DB.prepare(
    `INSERT INTO founder_preferences (key, value, source_feedback_id, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, source_feedback_id = excluded.source_feedback_id, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(prefKey, JSON.stringify(pref), fid, c.user.id, now)
    .run();
  if (targetType === "task") await addLog(c.env, targetId, "info", `Founder feedback: ${verdict}${note ? ` — ${note}` : ""} (planning preference only)`, actorOf(c));
  await audit(c.env, actorOf(c), `${targetType}.feedback`, targetType, targetId, { verdict, preference_key: prefKey, feedback_id: fid }, c.ip);
  return json({ ok: true, id: fid, preference_key: prefKey });
}

route("POST", "/api/recommendations/:id/feedback", (c) => recordFeedback(c, "recommendation", c.params.id));
route("POST", "/api/tasks/:id/feedback", (c) => recordFeedback(c, "task", c.params.id));

route("GET", "/api/feedback", async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT f.*, u.name AS user_name,
       COALESCE(r.title, t.title) AS target_title
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     LEFT JOIN recommendations r ON f.target_type = 'recommendation' AND r.id = f.target_id
     LEFT JOIN tasks t ON f.target_type = 'task' AND t.id = f.target_id
     ORDER BY f.created_at DESC LIMIT 200`,
  ).all();
  return json({ feedback: rows.results });
});

function assertNotProtected(key: string) {
  if (PROTECTED_SETTING_PREFIXES.some((p) => key.startsWith(p))) throw new HttpError(403, "Protected settings cannot be changed by feedback");
}

route("GET", "/api/preferences", async (c) => {
  const rows = await c.env.DB.prepare("SELECT * FROM founder_preferences ORDER BY updated_at DESC").all();
  return json({ preferences: rows.results });
});

route("GET", "/api/briefings", async (c) => {
  const rows = await c.env.DB.prepare("SELECT id, week_of, generated_at, generated_by, trigger_kind FROM briefings ORDER BY generated_at DESC LIMIT 52").all();
  return json({ briefings: rows.results });
});

route("GET", "/api/briefings/:id", async (c) => {
  const row = await c.env.DB.prepare("SELECT * FROM briefings WHERE id = ?").bind(c.params.id).first<{ content: string }>();
  if (!row) throw new HttpError(404, "Briefing not found");
  return json({ briefing: { ...row, content: parseJsonField(row.content, {}) } });
});

route("POST", "/api/briefings/generate", async (c) => {
  requireRole(c.user, "admin");
  const id = await generateBriefing(c.env, "manual", actorOf(c));
  return json({ id }, 201);
});

// ---------------------------------------------------------------- market intelligence & outreach

route("GET", "/api/intel/findings", async (c) => {
  const kind = c.url.searchParams.get("kind");
  const stmt = c.env.DB.prepare(
    `SELECT f.*, a.name AS agent_name FROM market_findings f LEFT JOIN agents a ON a.id = f.agent_id
     WHERE ${kind ? "f.kind = ?" : "1=1"}${demoFilter(c, "f.")} ORDER BY f.researched_at DESC LIMIT 300`,
  );
  return json({ findings: (await (kind ? stmt.bind(kind) : stmt).all()).results });
});

route("POST", "/api/intel/findings", async (c) => {
  requireRole(c.user, "operator");
  const id = newId("MKT");
  await c.env.DB.prepare(
    `INSERT INTO market_findings (id, kind, title, summary, competitor, published_price, industry, source_url, researched_at, agent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, oneOf(c.body, "kind", ["trend", "competitor", "pricing"]), reqStr(c.body, "title", { max: 200 }), str(c.body, "summary", { optional: true, max: 4000 }) ?? "",
      str(c.body, "competitor", { optional: true, max: 120 }) ?? null, str(c.body, "published_price", { optional: true, max: 120 }) ?? null,
      str(c.body, "industry", { optional: true, max: 80 }) ?? null, url(c.body, "source_url", false), isoDate(c.body, "researched_at") ?? nowIso(),
      str(c.body, "agent_id", { optional: true, max: 80 }) ?? null, nowIso(),
    )
    .run();
  await audit(c.env, actorOf(c), "finding.create", "finding", id, {}, c.ip);
  return json({ id }, 201);
});

route("GET", "/api/intel/prospects", async (c) => {
  const p = c.url.searchParams;
  const where = ["1=1"];
  const vals: unknown[] = [];
  if (p.get("industry")) (where.push("industry = ?"), vals.push(p.get("industry")));
  if (p.get("location")) (where.push("location LIKE ?"), vals.push(`%${p.get("location")}%`));
  if (p.get("problem")) (where.push("problem LIKE ?"), vals.push(`%${p.get("problem")}%`));
  if (p.get("status")) (where.push("outreach_status = ?"), vals.push(p.get("status")));
  if (p.get("min_score")) (where.push("qualification_score >= ?"), vals.push(Number(p.get("min_score"))));
  const rows = await c.env.DB.prepare(
    `SELECT * FROM prospects WHERE ${where.join(" AND ")}${demoFilter(c)} ORDER BY COALESCE(qualification_score, -1) DESC, updated_at DESC LIMIT 500`,
  )
    .bind(...vals)
    .all();
  const industries = await c.env.DB.prepare(`SELECT DISTINCT industry FROM prospects WHERE industry != ''${demoFilter(c)} ORDER BY industry`).all<{ industry: string }>();
  return json({ prospects: rows.results, industries: industries.results.map((r) => r.industry) });
});

route("POST", "/api/intel/prospects", async (c) => {
  requireRole(c.user, "operator");
  const id = newId("PRS");
  const now = nowIso();
  try {
    await c.env.DB.prepare(
      `INSERT INTO prospects (id, business_name, industry, location, website, public_contact, problem, qualification_score, source_url, researched_at, agent_id, proposed_message, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id, reqStr(c.body, "business_name", { max: 160 }), str(c.body, "industry", { optional: true, max: 80 }) ?? "", str(c.body, "location", { optional: true, max: 120 }) ?? "",
        url(c.body, "website"), str(c.body, "public_contact", { optional: true, max: 200 }) ?? null, str(c.body, "problem", { optional: true, max: 500 }) ?? "",
        int(c.body, "qualification_score", { optional: true, min: 0, max: 100 }) ?? null, url(c.body, "source_url", false), isoDate(c.body, "researched_at") ?? now,
        str(c.body, "agent_id", { optional: true, max: 80 }) ?? null, str(c.body, "proposed_message", { optional: true, max: 4000 }) ?? null,
        str(c.body, "notes", { optional: true, max: 2000 }) ?? "", now, now,
      )
      .run();
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new HttpError(409, "A prospect with this name and location already exists");
    throw err;
  }
  await audit(c.env, actorOf(c), "prospect.create", "prospect", id, {}, c.ip);
  return json({ id }, 201);
});

route("PATCH", "/api/intel/prospects/:id", async (c) => {
  requireRole(c.user, "operator");
  const row = await c.env.DB.prepare("SELECT * FROM prospects WHERE id = ?").bind(c.params.id).first<{ id: string; outreach_status: string }>();
  if (!row) throw new HttpError(404, "Prospect not found");
  const status = oneOf(c.body, "outreach_status", OUTREACH_STATUSES, true);
  // Approval states are controlled by the approval workflow, not direct edits.
  if (status && ["awaiting_approval", "approved"].includes(status)) throw new HttpError(409, "Use 'Request outreach approval'; approvals set this status");
  if (status === "contacted" && row.outreach_status !== "approved" && !["contacted", "replied", "meeting", "qualified"].includes(row.outreach_status)) {
    throw new HttpError(409, "A prospect can only be marked contacted after outreach was approved");
  }
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => v !== undefined && (sets.push(`${col} = ?`), vals.push(v));
  add("outreach_status", status);
  add("proposed_message", str(c.body, "proposed_message", { optional: true, max: 4000 }));
  add("notes", str(c.body, "notes", { optional: true, max: 2000 }));
  add("qualification_score", int(c.body, "qualification_score", { optional: true, min: 0, max: 100 }));
  add("meeting_at", isoDate(c.body, "meeting_at"));
  add("deal_value_cents", int(c.body, "deal_value_cents", { optional: true, min: 0 }));
  if (!sets.length) throw new HttpError(400, "No changes supplied");
  // A changed message invalidates a prior approval.
  // Editing the message voids any approval for the old text.
  if (c.body.proposed_message !== undefined && ["approved", "awaiting_approval"].includes(row.outreach_status)) {
    sets.push("outreach_status = 'drafted'", "approval_id = NULL");
    const apr = (row as { approval_id?: string | null }).approval_id;
    if (apr) {
      await c.env.DB.prepare("UPDATE approvals SET status = 'invalidated', invalidated_at = ?, invalidated_reason = 'Outreach message edited after the approval was requested' WHERE id = ? AND status IN ('pending','held','approved')")
        .bind(nowIso(), apr)
        .run();
      await audit(c.env, actorOf(c), "approval.invalidated", "approval", apr, { prospect_id: row.id, reason: "message edited" }, c.ip);
    }
  }
  sets.push("updated_at = ?");
  vals.push(nowIso());
  await c.env.DB.prepare(`UPDATE prospects SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, row.id).run();
  await audit(c.env, actorOf(c), "prospect.update", "prospect", row.id, { outreach_status: status }, c.ip);
  return json({ ok: true });
});

route("POST", "/api/intel/prospects/:id/request-outreach", async (c) => {
  requireRole(c.user, "operator");
  const p = await c.env.DB.prepare("SELECT * FROM prospects WHERE id = ?").bind(c.params.id).first<{ id: string; business_name: string; proposed_message: string | null; outreach_status: string; public_contact: string | null; source_url: string | null; is_demo: number }>();
  if (!p) throw new HttpError(404, "Prospect not found");
  if (p.outreach_status === "do_not_contact") throw new HttpError(409, "Prospect is marked do-not-contact");
  if (!p.proposed_message) throw new HttpError(409, "Add a proposed message before requesting approval");
  if (!p.public_contact) throw new HttpError(409, "No published business contact channel on record");
  if (["awaiting_approval", "approved"].includes(p.outreach_status)) throw new HttpError(409, `Outreach is already ${p.outreach_status}`);
  const id = await createApproval(c.env, {
    stage: "release",
    title: `Outreach to ${p.business_name}`,
    description: `Source: ${p.source_url ?? "n/a"}`,
    category: "outbound_campaign",
    risk_level: "medium",
    requested_by: actorOf(c),
    action_type: "send_message",
    destination: p.public_contact,
    action_content: p.proposed_message,
    is_demo: Boolean(p.is_demo),
  });
  await c.env.DB.prepare("UPDATE prospects SET outreach_status = 'awaiting_approval', approval_id = ?, updated_at = ? WHERE id = ?").bind(id, nowIso(), p.id).run();
  await audit(c.env, actorOf(c), "prospect.request_outreach", "prospect", p.id, { approval_id: id }, c.ip);
  return json({ approval_id: id }, 201);
});

// ---------------------------------------------------------------- workflows & finance

route("GET", "/api/workflows", async (c) => {
  const df = demoFilter(c);
  const [runs, summary] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM workflow_runs WHERE 1=1${df} ORDER BY created_at DESC LIMIT 200`).all(),
    c.env.DB.prepare(
      `SELECT workflow, COUNT(*) AS total, SUM(status='completed') AS completed, SUM(status='failed') AS failed,
         CAST(AVG(duration_ms) AS INTEGER) AS avg_ms, MAX(created_at) AS last_run, MAX(is_demo) AS is_demo
       FROM workflow_runs WHERE created_at > ?${df} GROUP BY workflow ORDER BY total DESC`,
    ).bind(new Date(Date.now() - 30 * 86400_000).toISOString()).all(),
  ]);
  return json({ runs: runs.results, summary: summary.results, inbound_configured: secretsPresent(c.env, "make_inbound") });
});

route("GET", "/api/finance", async (c) => {
  const limits = await c.env.DB.prepare("SELECT key, value, updated_at FROM settings WHERE key LIKE 'limit.%'").all();
  if (!secretsPresent(c.env, "stripe")) {
    return json({ connected: false, reason: "STRIPE_SECRET_KEY is not configured", limits: limits.results });
  }
  try {
    return json({ connected: true, summary: await stripeFinancialSummary(c.env), limits: limits.results });
  } catch (err) {
    return json({ connected: false, reason: `Stripe request failed: ${err instanceof Error ? err.message : "unknown"}`, limits: limits.results });
  }
});

// ---------------------------------------------------------------- alerts & audit

route("GET", "/api/alerts", async (c) => {
  const open = c.url.searchParams.get("open") === "1";
  const rows = await c.env.DB.prepare(
    `SELECT * FROM alerts WHERE ${open ? "acknowledged_at IS NULL" : "1=1"}${demoFilter(c)} ORDER BY acknowledged_at IS NOT NULL, created_at DESC LIMIT 200`,
  ).all();
  return json({ alerts: rows.results });
});

route("POST", "/api/alerts/:id/ack", async (c) => {
  requireRole(c.user, "operator");
  await c.env.DB.prepare("UPDATE alerts SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL").bind(c.user.id, nowIso(), c.params.id).run();
  await audit(c.env, actorOf(c), "alert.ack", "alert", c.params.id, {}, c.ip);
  return json({ ok: true });
});

route("GET", "/api/audit", async (c) => {
  requireRole(c.user, "admin");
  const p = c.url.searchParams;
  const where = ["1=1"];
  const vals: unknown[] = [];
  if (p.get("entity_type")) (where.push("entity_type = ?"), vals.push(p.get("entity_type")));
  if (p.get("q")) (where.push("(action LIKE ? OR entity_id LIKE ? OR actor LIKE ?)"), vals.push(...Array(3).fill(`%${p.get("q")}%`)));
  const rows = await c.env.DB.prepare(`SELECT * FROM audit_log WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT 300`).bind(...vals).all();
  return json({ entries: rows.results });
});

// ---------------------------------------------------------------- integrations & settings

route("GET", "/api/integrations", async (c) => json({ integrations: await integrationStatuses(c.env) }));

route("POST", "/api/integrations/:key/test", async (c) => {
  requireRole(c.user, "owner");
  const def = INTEGRATIONS.find((d) => d.key === c.params.key);
  if (!def) throw new HttpError(404, "Unknown integration");
  const result = await testIntegration(c.env, def.key);
  await audit(c.env, actorOf(c), "integration.test", "integration", def.key, { ok: result.ok, message: result.message }, c.ip);
  return json({ result });
});

const EDITABLE_SETTINGS: Record<string, (v: unknown) => string> = {
  "briefing.day": (v) => JSON.stringify(oneOf({ v }, "v", WEEKDAYS)),
  "briefing.hour_local": (v) => String(int({ v }, "v", { min: 0, max: 23 })),
  "briefing.timezone": (v) => {
    const tz = reqStr({ v }, "v", { max: 60 });
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
    } catch {
      throw new HttpError(400, "Unknown time zone");
    }
    return JSON.stringify(tz);
  },
  "alerts.immediate_categories": (v) => JSON.stringify(strArray({ v }, "v", { maxItems: 10 })),
  "tasks.running_lease_minutes": (v) => String(int({ v }, "v", { min: 5, max: 240 })),
  "limit.monthly_ai_spend_usd": (v) => String(int({ v }, "v", { min: 0, max: 1_000_000 })),
  "limit.outbound_messages_per_day": (v) => String(int({ v }, "v", { min: 0, max: 10_000 })),
  "limit.max_transaction_usd": (v) => String(int({ v }, "v", { min: 0, max: 1_000_000 })),
  "legal.outbound_requires_approval": () => "true", // fixed: outbound always requires approval
  "access.allow_external_workers": (v) => String(bool({ v }, "v", false)),
};

route("GET", "/api/settings", async (c) => {
  const rows = await c.env.DB.prepare("SELECT key, value, protected, updated_by, updated_at FROM settings WHERE key NOT LIKE 'integration.%' ORDER BY key").all();
  return json({ settings: rows.results });
});

route("PUT", "/api/settings/:key", async (c) => {
  const key = c.params.key;
  const encode = EDITABLE_SETTINGS[key];
  if (!encode) throw new HttpError(404, "Unknown or read-only setting");
  const isProtected = PROTECTED_SETTING_PREFIXES.some((p) => key.startsWith(p));
  requireRole(c.user, isProtected ? "owner" : "admin");
  const value = encode(c.body.value);
  const before = await c.env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  await c.env.DB.prepare(
    `INSERT INTO settings (key, value, protected, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(key, value, isProtected ? 1 : 0, c.user.id, nowIso())
    .run();
  await audit(c.env, actorOf(c), "setting.update", "setting", key, { from: before?.value ?? null, to: value, protected: isProtected }, c.ip);
  return json({ ok: true, value });
});

// ---------------------------------------------------------------- users

route("GET", "/api/users", async (c) => {
  requireRole(c.user, "owner");
  const rows = await c.env.DB.prepare("SELECT id, email, name, role, disabled, created_at, last_login_at FROM users ORDER BY created_at").all();
  return json({ users: rows.results });
});

route("POST", "/api/users", async (c) => {
  requireRole(c.user, "owner");
  const role = oneOf(c.body, "role", ROLES.filter((r) => r !== "owner"))!;
  const email = reqStr(c.body, "email", { max: 254 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "Invalid email");
  const password = reqStr(c.body, "password", { min: 12, max: 256 });
  const id = `usr-${crypto.randomUUID()}`;
  await c.env.DB.prepare("INSERT INTO users (id, email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, email, reqStr(c.body, "name", { max: 80 }), role, await hashPassword(password), nowIso())
    .run()
    .catch(() => {
      throw new HttpError(409, "A user with that email already exists");
    });
  await audit(c.env, actorOf(c), "user.create", "user", id, { email, role }, c.ip);
  return json({ id }, 201);
});

route("PATCH", "/api/users/:id", async (c) => {
  requireRole(c.user, "owner");
  if (c.params.id === c.user.id) throw new HttpError(409, "You cannot change your own account here");
  const role = oneOf(c.body, "role", ROLES.filter((r) => r !== "owner"), true);
  const disabled = bool(c.body, "disabled");
  if (role) await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ? AND role != 'owner'").bind(role, c.params.id).run();
  if (disabled !== undefined) {
    await c.env.DB.prepare("UPDATE users SET disabled = ? WHERE id = ? AND role != 'owner'").bind(disabled ? 1 : 0, c.params.id).run();
    if (disabled) await c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(c.params.id).run();
  }
  await audit(c.env, actorOf(c), "user.update", "user", c.params.id, { role, disabled }, c.ip);
  return json({ ok: true });
});

// ---------------------------------------------------------------- demo data

route("POST", "/api/admin/demo", async (c) => {
  requireRole(c.user, "owner");
  const action = oneOf(c.body, "action", ["load", "clear"])!;
  if (action === "load") await loadDemo(c.env, actorOf(c));
  else await clearDemo(c.env, actorOf(c));
  return json({ ok: true });
});
