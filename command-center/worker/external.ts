// Machine-to-machine endpoints:
//  - /api/worker/*      agent processes hosted elsewhere (Bearer WORKER_TOKEN)
//  - /api/webhooks/make Make.com scenario run reports (HMAC or bearer secret)
import type { Env } from "./env";
import { requireWorkerToken } from "./auth";
import { HttpError, audit, clientIp, hmacSha256Hex, json, newId, nowIso, rateLimit, readJson, safeEqual } from "./lib";
import { bool, int, isoDate, oneOf, reqStr, str } from "./validate";
import { addLog, claimTask, completeTask, createTask, failTask, getAgent, getTask, raiseAlert } from "./tasks";
import { PRIORITIES } from "../shared/domain";
import { weekStart } from "./briefing";

export async function handleExternal(req: Request, env: Env, path: string): Promise<Response | null> {
  if (path === "/api/webhooks/make" && req.method === "POST") return makeWebhook(req, env);
  if (!path.startsWith("/api/worker/")) return null;
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

  if (!(await rateLimit(env, `worker:${clientIp(req)}`, 240, 60))) throw new HttpError(429, "Rate limit exceeded");
  await requireWorkerToken(req, env);
  const body = await readJson(req);
  const agentId = reqStr(body, "agent_id", { max: 80 });
  const agent = await getAgent(env, agentId);
  if (agent.provider !== "custom-worker") throw new HttpError(403, `${agent.name} is not configured to use an external worker`);
  const actor = `worker:${agent.id}`;
  await env.DB.prepare("UPDATE agents SET last_heartbeat_at = ? WHERE id = ?").bind(nowIso(), agent.id).run();

  if (path === "/api/worker/heartbeat") return json({ ok: true, enabled: Boolean(agent.enabled), paused: Boolean(agent.paused) });

  if (path === "/api/worker/claim") {
    if (!agent.enabled || agent.paused || agent.archived) return json({ task: null, reason: "Agent is disabled or paused" });
    if (agent.autonomy === "observer") return json({ task: null, reason: "Observer agents cannot execute tasks" });
    const lease = int(body, "lease_minutes", { optional: true, min: 1, max: 240 }) ?? 30;
    const candidates = await env.DB.prepare(
      `SELECT id FROM tasks WHERE agent_id = ? AND status = 'scheduled' AND is_demo = 0 AND (scheduled_for IS NULL OR scheduled_for <= ?)
       ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, created_at LIMIT 5`,
    )
      .bind(agent.id, nowIso())
      .all<{ id: string }>();
    for (const c of candidates.results) {
      const claimed = await claimTask(env, c.id, actor, lease);
      if (claimed) return json({ task: claimed });
    }
    return json({ task: null });
  }

  if (path === "/api/worker/tasks") {
    // Delegation: workers may only PROPOSE tasks. Approval rules apply when a human advances them.
    const { task, duplicate } = await createTask(env, {
      title: reqStr(body, "title", { max: 200 }),
      description: str(body, "description", { optional: true, max: 8000 }),
      agent_id: str(body, "assign_to", { optional: true, max: 80 }) ?? agent.id,
      priority: oneOf(body, "priority", PRIORITIES, true),
      kind: oneOf(body, "kind", ["general", "draft", "research", "outreach", "report", "financial", "access"], true),
      idempotency_key: str(body, "idempotency_key", { optional: true, max: 120 }),
      parent_task_id: str(body, "parent_task_id", { optional: true, max: 40 }) ?? null,
      propose_only: true,
      source: "agent",
      created_by: actor,
    });
    return json({ task, duplicate }, duplicate ? 200 : 201);
  }

  if (path === "/api/worker/recommendations") {
    const id = newId("REC");
    await env.DB.prepare("INSERT INTO recommendations (id, agent_id, week_of, title, body, status, source, created_at) VALUES (?, ?, ?, ?, ?, 'open', 'agent', ?)")
      .bind(id, agent.id, weekStart(), reqStr(body, "title", { max: 200 }), reqStr(body, "body", { max: 8000 }), nowIso())
      .run();
    await audit(env, actor, "recommendation.create", "recommendation", id, {});
    return json({ id }, 201);
  }

  const m = path.match(/^\/api\/worker\/tasks\/([A-Z0-9-]+)\/(log|complete|fail)$/);
  if (!m) throw new HttpError(404, "Not found");
  const task = await getTask(env, m[1]);
  if (task.agent_id !== agent.id) throw new HttpError(403, "Task is assigned to a different agent");
  if (task.status !== "running") throw new HttpError(409, `Task is ${task.status}, not running`);

  if (m[2] === "log") {
    await addLog(env, task.id, oneOf(body, "level", ["debug", "info", "warn", "error"], true) ?? "info", reqStr(body, "message", { max: 4000 }), actor);
    // A log call also extends the lease, acting as a progress heartbeat.
    await env.DB.prepare("UPDATE tasks SET lease_expires_at = ? WHERE id = ? AND status = 'running'")
      .bind(new Date(Date.now() + 30 * 60_000).toISOString(), task.id)
      .run();
    return json({ ok: true });
  }
  if (m[2] === "complete") return json({ task: await completeTask(env, task.id, reqStr(body, "result", { max: 100_000 }), actor) });
  return json({ task: await failTask(env, task.id, reqStr(body, "error", { max: 4000 }), actor, bool(body, "retryable") ?? true) });
}

async function makeWebhook(req: Request, env: Env): Promise<Response> {
  if (!env.MAKE_WEBHOOK_SECRET) throw new HttpError(503, "Make.com inbound webhook is not configured");
  if (!(await rateLimit(env, `make:${clientIp(req)}`, 300, 60))) throw new HttpError(429, "Rate limit exceeded");
  const raw = await req.text();
  if (raw.length > 64 * 1024) throw new HttpError(413, "Payload too large");

  const sig = req.headers.get("X-Signature") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const okSig = sig && safeEqual(sig.toLowerCase(), await hmacSha256Hex(env.MAKE_WEBHOOK_SECRET, raw));
  const okBearer = bearer && safeEqual(bearer, env.MAKE_WEBHOOK_SECRET);
  if (!okSig && !okBearer) {
    await audit(env, "webhook:make", "webhook.rejected", "workflow_run", null, { reason: "bad signature" }, clientIp(req));
    throw new HttpError(401, "Invalid signature");
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  const workflow = reqStr(body, "workflow", { max: 160 });
  const externalId = reqStr(body, "execution_id", { max: 160 });
  const status = oneOf(body, "status", ["running", "completed", "failed"])!;
  const started = isoDate(body, "started_at") ?? null;
  const finished = isoDate(body, "finished_at") ?? null;
  const error = str(body, "error", { optional: true, max: 2000 }) ?? null;
  const duration = started && finished ? new Date(finished).getTime() - new Date(started).getTime() : null;
  const now = nowIso();

  // Upsert by (source, external_id): retried deliveries never create duplicates.
  await env.DB.prepare(
    `INSERT INTO workflow_runs (id, workflow, external_id, source, status, started_at, finished_at, duration_ms, error, payload, created_at)
     VALUES (?, ?, ?, 'make', ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (source, external_id) DO UPDATE SET status = excluded.status, finished_at = excluded.finished_at,
       duration_ms = excluded.duration_ms, error = excluded.error, payload = excluded.payload`,
  )
    .bind(newId("RUN"), workflow, externalId, status, started, finished, duration, error, raw.slice(0, 8000), now)
    .run();

  if (status === "failed") {
    await raiseAlert(env, {
      severity: "warning",
      category: "failure",
      title: `Workflow failed: ${workflow}`,
      body: error ?? "No error detail supplied",
      agent_id: "agt-forge",
      dedupe_key: `make-fail:${externalId}`,
    });
  }
  await audit(env, "webhook:make", "workflow_run.report", "workflow_run", externalId, { workflow, status });
  return json({ ok: true });
}
