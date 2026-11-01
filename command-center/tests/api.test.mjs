// End-to-end API tests against a running local Worker:
//   npm run db:migrate:local && npx wrangler dev --test-scheduled &
//   BASE=http://localhost:8787 npm test
// Requires .dev.vars with OWNER_EMAIL / OWNER_PASSWORD / WORKER_TOKEN / MAKE_WEBHOOK_SECRET
// matching the constants below, and NO integration secrets (to verify disconnected states).
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OWNER = { email: "founder@example.com", password: "local-dev-password-123" };
const WORKER_TOKEN = "local-worker-token-abcdef";
const MAKE_SECRET = "local-make-secret";

function client() {
  let cookie = "";
  return async function call(method, path, body, extraHeaders = {}) {
    const headers = { "X-Requested-With": "fork-command-center", ...extraHeaders };
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
}

const owner = client();
const worker = (path, body) =>
  fetch(BASE + path, { method: "POST", headers: { Authorization: `Bearer ${WORKER_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    body: await r.json(),
  }));

before(async () => {
  const r = await owner("POST", "/api/auth/login", OWNER);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  await owner("POST", "/api/admin/demo", { action: "clear" });
  // Reset state that earlier (possibly aborted) runs may have left behind.
  await owner("PATCH", "/api/agents/agt-forge", { provider: "none", enabled: false });
  await owner("PUT", "/api/settings/access.allow_external_workers", { value: false });
});

test("API requires a session and the CSRF header", async () => {
  const anon = client();
  assert.equal((await anon("GET", "/api/agents")).status, 401);
  const res = await fetch(BASE + "/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(res.status, 403);
  assert.equal((await anon("POST", "/api/auth/login", { email: OWNER.email, password: "wrong" })).status, 401);
});

test("nine core agents are seeded with the right reporting lines", async () => {
  const { body } = await owner("GET", "/api/agents");
  const core = body.agents.filter((a) => a.is_core);
  assert.equal(core.length, 9);
  const atlas = core.find((a) => a.slug === "atlas");
  assert.equal(atlas.reports_to, null);
  for (const a of core.filter((a) => a.slug !== "atlas")) assert.equal(a.reports_to, "agt-atlas");
  // Enabled=false and no backend: never shown as running.
  assert.ok(core.every((a) => ["disabled", "not_configured"].includes(a.connection.state)));
});

test("agent settings persist; enabling a profile does not fake a connection", async () => {
  const r = await owner("PATCH", "/api/agents/agt-echo", { name: "Echo", autonomy: "supervised", priority: "high", enabled: true, provider: "anthropic", model: "claude-opus-5-5" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { body } = await owner("GET", "/api/agents/agt-echo");
  assert.equal(body.agent.autonomy, "supervised");
  assert.equal(body.agent.priority, "high");
  assert.equal(body.agent.connection.state, "not_configured"); // no ANTHROPIC_API_KEY locally
  assert.equal(body.executor.in_worker_available, false);
  assert.equal(body.agent.readiness.ready, false); // enabling a profile does not start an agent
  assert.equal(body.agent.readiness.checks.find((c) => c.key === "credentials").ok, false);
  assert.equal(body.agent.verified_execution.label, "No verified executions yet");
  await owner("PATCH", "/api/agents/agt-echo", { autonomy: "draft_only", priority: "normal", enabled: false, provider: "none", model: "" });
});

test("capabilities need request + owner grant + credentials", async () => {
  let r = await owner("PUT", "/api/agents/agt-compass/capabilities", { capability: "email", granted: true });
  assert.equal(r.status, 409); // not requested
  r = await owner("PUT", "/api/agents/agt-compass/capabilities", { capability: "email", requested: true });
  r = await owner("PUT", "/api/agents/agt-compass/capabilities", { capability: "email", granted: true });
  assert.equal(r.status, 200);
  const email = r.body.capabilities.find((c) => c.key === "email");
  assert.equal(email.granted, true);
  assert.equal(email.effective, false); // Make.com outbound not configured
  assert.match(email.blocked_reason, /no credentials/);
  const reporting = r.body.capabilities.find((c) => c.key === "reporting");
  assert.equal(reporting.effective, false); // requested but not granted
  await owner("PUT", "/api/agents/agt-compass/capabilities", { capability: "email", requested: false });
});

test("task creation applies approval rules and prevents duplicates", async () => {
  const key = randomUUID();
  const a = await owner("POST", "/api/tasks", { title: "Draft SOP", agent_id: "agt-compass", kind: "draft", idempotency_key: key });
  assert.equal(a.status, 201);
  assert.equal(a.body.task.status, "scheduled");
  assert.match(a.body.task.id, /^TSK-\d{8}-[A-Z0-9]{6}$/);
  const dup = await owner("POST", "/api/tasks", { title: "Draft SOP", agent_id: "agt-compass", kind: "draft", idempotency_key: key });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true);
  assert.equal(dup.body.task.id, a.body.task.id);

  const out = await owner("POST", "/api/tasks", { title: "Email 5 plumbers", agent_id: "agt-hunter", kind: "outreach" });
  assert.equal(out.body.task.status, "awaiting_approval");
  assert.ok(out.body.task.approval_id);

  const obs = await owner("POST", "/api/tasks", { title: "Summarize payouts", agent_id: "agt-ledger", kind: "report" });
  assert.equal(obs.body.task.status, "proposed"); // Ledger is an observer
});

test("approval decisions drive task state and are audited", async () => {
  const t1 = (await owner("POST", "/api/tasks", { title: "Outreach A", agent_id: "agt-hunter", kind: "outreach" })).body.task;
  const t2 = (await owner("POST", "/api/tasks", { title: "Outreach B", agent_id: "agt-hunter", kind: "outreach" })).body.task;
  assert.equal((await owner("POST", `/api/approvals/${t1.approval_id}/decision`, { decision: "held", note: "next week" })).status, 200);
  assert.equal((await owner("GET", `/api/tasks/${t1.id}`)).body.task.status, "awaiting_approval");
  // Approving an outreach task authorizes drafting only; the send needs its own release approval.
  assert.equal((await owner("POST", `/api/approvals/${t1.approval_id}/decision`, { decision: "approved" })).status, 200);
  assert.equal((await owner("GET", `/api/tasks/${t1.id}`)).body.task.status, "scheduled");
  assert.equal((await owner("POST", `/api/approvals/${t1.approval_id}/decision`, { decision: "rejected" })).status, 409);
  await owner("POST", `/api/approvals/${t2.approval_id}/decision`, { decision: "rejected", note: "no" });
  assert.equal((await owner("GET", `/api/tasks/${t2.id}`)).body.task.status, "cancelled");
  const audit = await owner("GET", `/api/audit?q=${t1.approval_id}`);
  assert.ok(audit.body.entries.some((e) => e.action === "approval.approved"));
});

test("invalid transitions are rejected; pause/resume works", async () => {
  const t = (await owner("POST", "/api/tasks", { title: "Pause me", agent_id: "agt-compass", kind: "draft" })).body.task;
  assert.equal((await owner("POST", `/api/tasks/${t.id}/transition`, { to: "completed" })).status, 409);
  assert.equal((await owner("POST", `/api/tasks/${t.id}/transition`, { to: "paused" })).body.task.status, "paused");
  assert.equal((await owner("POST", `/api/tasks/${t.id}/transition`, { to: "scheduled" })).body.task.status, "scheduled");
  const run = await owner("POST", `/api/tasks/${t.id}/run`, {});
  assert.equal(run.status, 409); // no provider configured — refuses instead of pretending
  assert.match(run.body.error, /provider/i);
});

test("external worker API is off until the owner allows it, then runs the full lifecycle", async () => {
  // A fresh agent per run keeps the queue for this test empty.
  const AG = (await owner("POST", "/api/agents", { name: `Worker test ${randomUUID().slice(0, 6)}`, role_title: "Test" })).body.id;
  assert.equal((await worker("/api/worker/heartbeat", { agent_id: AG })).status, 403);
  await owner("PUT", "/api/settings/access.allow_external_workers", { value: true });
  assert.equal((await worker("/api/worker/heartbeat", { agent_id: AG })).status, 403); // provider not custom-worker
  await owner("PATCH", `/api/agents/${AG}`, { provider: "custom-worker", enabled: true });
  const bad = await fetch(BASE + "/api/worker/heartbeat", { method: "POST", headers: { Authorization: "Bearer nope" }, body: "{}" });
  assert.equal(bad.status, 401);

  const t = (await owner("POST", "/api/tasks", { title: "Diagnose scenario", agent_id: AG, kind: "research", max_attempts: 2 })).body.task;
  const claim = await worker("/api/worker/claim", { agent_id: AG });
  assert.equal(claim.body.task.id, t.id);
  assert.equal(claim.body.task.status, "running");
  assert.equal((await worker("/api/worker/claim", { agent_id: AG })).body.task, null); // no double-claim
  await worker(`/api/worker/tasks/${t.id}/log`, { agent_id: AG, message: "checking module 4" });
  const failed = await worker(`/api/worker/tasks/${t.id}/fail`, { agent_id: AG, error: "timeout", retryable: true });
  assert.equal(failed.body.task.status, "scheduled"); // automatic retry with backoff
  assert.ok(failed.body.task.scheduled_for);

  const t2 = (await owner("POST", "/api/tasks", { title: "Write report", agent_id: AG, kind: "report" })).body.task;
  const c2 = await worker("/api/worker/claim", { agent_id: AG });
  assert.equal(c2.body.task.id, t2.id);
  const done = await worker(`/api/worker/tasks/${t2.id}/complete`, { agent_id: AG, result: "Report body" });
  assert.equal(done.body.task.status, "completed");
  const agent = (await owner("GET", `/api/agents/${AG}`)).body.agent;
  assert.ok(agent.last_confirmed_execution_at);
  assert.equal(agent.connection.state, "online");

  const prop = await worker("/api/worker/tasks", { agent_id: AG, title: "Ask Hunter to email", assign_to: "agt-hunter", kind: "outreach" });
  assert.equal(prop.body.task.status, "proposed"); // workers can only propose

  await owner("PATCH", `/api/agents/${AG}`, { provider: "none", enabled: false, paused: true });
  await owner("PUT", "/api/settings/access.allow_external_workers", { value: false });
});

test("Make.com webhook verifies signatures and dedupes deliveries", async () => {
  const payload = JSON.stringify({ workflow: "Lead intake", execution_id: `exec-${randomUUID()}`, status: "failed", error: "401 from CRM" });
  const bad = await fetch(BASE + "/api/webhooks/make", { method: "POST", headers: { "X-Signature": "00" }, body: payload });
  assert.equal(bad.status, 401);
  const sig = createHmac("sha256", MAKE_SECRET).update(payload).digest("hex");
  for (let i = 0; i < 2; i++) {
    const ok = await fetch(BASE + "/api/webhooks/make", { method: "POST", headers: { "X-Signature": sig }, body: payload });
    assert.equal(ok.status, 200);
  }
  const { body } = await owner("GET", "/api/workflows");
  const id = JSON.parse(payload).execution_id;
  assert.equal(body.runs.filter((r) => r.external_id === id).length, 1);
  const alerts = await owner("GET", "/api/alerts?open=1");
  assert.ok(alerts.body.alerts.some((a) => a.title === "Workflow failed: Lead intake"));
});

test("founder feedback updates planning preferences, never protected limits", async () => {
  const before = (await owner("GET", "/api/settings")).body.settings.filter((s) => s.key.startsWith("limit."));
  const rec = await owner("POST", "/api/recommendations", { title: "Focus on HVAC", body: "Peak season is coming." });
  assert.equal((await owner("POST", `/api/recommendations/${rec.body.id}/feedback`, { verdict: "modify" })).status, 400); // note required
  const fb = await owner("POST", `/api/recommendations/${rec.body.id}/feedback`, { verdict: "modify", note: "Include plumbing too" });
  assert.equal(fb.body.preference_key, "planning.agent.agt-atlas");
  const prefs = (await owner("GET", "/api/preferences")).body.preferences;
  assert.match(prefs.find((p) => p.key === "planning.agent.agt-atlas").value, /Include plumbing too/);
  const after = (await owner("GET", "/api/settings")).body.settings.filter((s) => s.key.startsWith("limit."));
  assert.deepEqual(after, before);
});

test("demo data is flagged, hidden by default, read-only, and excluded from briefings", async () => {
  await owner("POST", "/api/admin/demo", { action: "load" });
  const hidden = await owner("GET", "/api/intel/prospects");
  assert.ok(hidden.body.prospects.every((p) => p.is_demo === 0));
  const shown = await owner("GET", "/api/intel/prospects?demo=1");
  assert.ok(shown.body.prospects.some((p) => p.is_demo === 1));
  const demoApprovals = (await owner("GET", "/api/approvals?status=open&demo=1")).body.approvals.filter((a) => a.is_demo);
  assert.equal((await owner("POST", `/api/approvals/${demoApprovals[0].id}/decision`, { decision: "approved" })).status, 409);
  const demoTask = (await owner("GET", "/api/tasks?status=scheduled&demo=1")).body.tasks.find((t) => t.is_demo);
  assert.equal((await owner("POST", `/api/tasks/${demoTask.id}/transition`, { to: "paused" })).status, 409);
  assert.equal((await owner("POST", `/api/tasks/${demoTask.id}/run`, {})).status, 409);
  const gen = await owner("POST", "/api/briefings/generate", {});
  const brief = (await owner("GET", `/api/briefings/${gen.body.id}`)).body.briefing;
  assert.equal(brief.generated_by, "aggregation"); // no AI provider → no invented narrative
  assert.ok(brief.content.demo_records_excluded > 0);
  assert.ok(brief.content.pipeline_by_status.every((p) => !String(p.status).includes("demo")));
  await owner("POST", "/api/admin/demo", { action: "clear" });
  assert.equal((await owner("GET", "/api/overview")).body.demo_records, 0);
});

test("integrations report not configured without secrets", async () => {
  const { body } = await owner("GET", "/api/integrations");
  const s = Object.fromEntries(body.integrations.map((i) => [i.key, i.status]));
  assert.equal(s.internal, "connected");
  assert.equal(s.stripe, "not_configured");
  assert.equal(s.anthropic, "not_configured");
  assert.equal(s.ringcentral, "not_configured");
  assert.equal(s.google_sheets, "not_configured");
  assert.equal(s.make_outbound, "not_configured");
  // Secret set, and the signed webhook test above delivered a verified report.
  assert.equal(s.make_inbound, "connected");
  assert.equal((await owner("POST", "/api/integrations/stripe/test", {})).status, 409);
  const fin = await owner("GET", "/api/finance");
  assert.equal(fin.body.connected, false);
});

test("role-based access: viewers cannot write; protected settings are owner-only", async () => {
  const email = `viewer-${randomUUID().slice(0, 6)}@example.com`;
  assert.equal((await owner("POST", "/api/users", { email, name: "Viewer", role: "viewer", password: "short" })).status, 400);
  assert.equal((await owner("POST", "/api/users", { email, name: "Viewer", role: "viewer", password: "a-long-viewer-password" })).status, 201);
  const viewer = client();
  assert.equal((await viewer("POST", "/api/auth/login", { email, password: "a-long-viewer-password" })).status, 200);
  assert.equal((await viewer("GET", "/api/agents")).status, 200);
  assert.equal((await viewer("POST", "/api/tasks", { title: "x" })).status, 403);
  assert.equal((await viewer("PUT", "/api/settings/limit.max_transaction_usd", { value: 999 })).status, 403);
  assert.equal((await viewer("GET", "/api/audit")).status, 403);
});

test("input validation rejects bad payloads", async () => {
  assert.equal((await owner("POST", "/api/tasks", { title: "" })).status, 400);
  assert.equal((await owner("POST", "/api/tasks", { title: "x", priority: "urgent" })).status, 400);
  assert.equal((await owner("PATCH", "/api/agents/agt-scout", { schedule: { days: ["funday"] } })).status, 400);
  assert.equal((await owner("POST", "/api/intel/prospects", { business_name: "X", source_url: "javascript:alert(1)" })).status, 400);
});

test("scheduled handler runs without error", async () => {
  const res = await fetch(BASE + "/__scheduled?cron=0+21+*+*+5");
  assert.equal(res.status, 200);
});
