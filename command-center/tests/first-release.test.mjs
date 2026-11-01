// First-release enforcement tests: exact-action approvals and invalidation,
// outbound and financial authorization, release approvals, duplicate execution,
// attempt history, Echo content lanes, task feedback, review schedule, access.
// Same setup as api.test.mjs (local `wrangler dev` with .dev.vars from .dev.vars.example).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:8787";
const OWNER = { email: "founder@example.com", password: "local-dev-password-123" };
const WORKER_TOKEN = "local-worker-token-abcdef";

function client() {
  let cookie = "";
  return async function call(method, path, body) {
    const headers = { "X-Requested-With": "fork-command-center" };
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

let AG; // a fresh external-worker agent for this run

/** Creates a task for the worker agent and has the worker complete it. */
async function completedTask(title, extra = {}) {
  const t = (await owner("POST", "/api/tasks", { title, agent_id: AG, kind: "draft", ...extra })).body.task;
  if (t.status === "awaiting_approval") {
    assert.equal((await owner("POST", `/api/approvals/${t.approval_id}/decision`, { decision: "approved" })).status, 200);
  }
  const c = await worker("/api/worker/claim", { agent_id: AG });
  assert.equal(c.body.task?.id, t.id, JSON.stringify(c.body));
  const done = await worker(`/api/worker/tasks/${t.id}/complete`, { agent_id: AG, result: `Result of ${title}` });
  assert.equal(done.body.task.status, "completed");
  return done.body.task;
}

before(async () => {
  assert.equal((await owner("POST", "/api/auth/login", OWNER)).status, 200);
  await owner("PUT", "/api/settings/access.allow_external_workers", { value: true });
  AG = (await owner("POST", "/api/agents", { name: `Release test ${randomUUID().slice(0, 6)}`, role_title: "Test" })).body.id;
  await owner("PATCH", `/api/agents/${AG}`, { provider: "custom-worker", enabled: true });
  await worker("/api/worker/heartbeat", { agent_id: AG });
});

after(async () => {
  await owner("PATCH", `/api/agents/${AG}`, { provider: "none", enabled: false, paused: true });
  await owner("PUT", "/api/settings/access.allow_external_workers", { value: false });
  await owner("PUT", "/api/settings/limit.max_transaction_usd", { value: 0 });
  await owner("PUT", "/api/settings/briefing.day", { value: "friday" });
});

test("execution approval snapshots the exact task; a material edit invalidates it", async () => {
  const t = (
    await owner("POST", "/api/tasks", {
      title: "Draft missed-call follow-up",
      agent_id: AG,
      kind: "draft",
      requires_approval: true,
      action_type: "send_message",
      destination: "office@example.com",
      action_content: "Sorry we missed your call. How can we help?",
    })
  ).body.task;
  assert.equal(t.status, "awaiting_approval");
  const first = t.approval_id;
  let appr = (await owner("GET", "/api/approvals?status=open")).body.approvals.find((a) => a.id === first);
  assert.equal(appr.destination, "office@example.com");
  assert.equal(appr.action_content, "Sorry we missed your call. How can we help?");
  assert.match(appr.fingerprint, /^[0-9a-f]{64}$/);

  // A non-material edit (priority) keeps the approval.
  const p = await owner("PATCH", `/api/tasks/${t.id}`, { priority: "high" });
  assert.deepEqual(p.body.invalidated, []);

  // Approve, then change the content: the approval is void and a new one is required.
  assert.equal((await owner("POST", `/api/approvals/${first}/decision`, { decision: "approved", explicit_outbound: true })).status, 200);
  assert.equal((await owner("GET", `/api/tasks/${t.id}`)).body.task.status, "scheduled");
  const edit = await owner("PATCH", `/api/tasks/${t.id}`, { action_content: "Call us back for 20% off!" });
  assert.equal(edit.status, 200);
  assert.deepEqual(edit.body.invalidated, [first]);
  assert.equal(edit.body.task.status, "awaiting_approval");
  assert.notEqual(edit.body.task.approval_id, first);

  // The worker cannot claim it, and the old approval cannot be decided again.
  assert.equal((await worker("/api/worker/claim", { agent_id: AG })).body.task, null);
  const old = await owner("POST", `/api/approvals/${first}/decision`, { decision: "approved", explicit_outbound: true });
  assert.equal(old.status, 409);
  assert.match(old.body.error, /invalidated/);
  const invalidated = (await owner("GET", "/api/approvals?status=invalidated")).body.approvals.find((a) => a.id === first);
  assert.match(invalidated.invalidated_reason, /action_content/);

  // Approving the new version lets it run.
  await owner("POST", `/api/approvals/${edit.body.task.approval_id}/decision`, { decision: "approved", explicit_outbound: true });
  const c = await worker("/api/worker/claim", { agent_id: AG });
  assert.equal(c.body.task.id, t.id);
  await worker(`/api/worker/tasks/${t.id}/complete`, { agent_id: AG, result: "done" });
  const audit = await owner("GET", `/api/audit?q=${first}`);
  assert.ok(audit.body.entries.some((e) => e.action === "approval.invalidated"));
});

test("outbound campaigns require explicit authorization", async () => {
  const a = await owner("POST", "/api/approvals", {
    title: "Missed-call text campaign",
    category: "outbound_campaign",
    action_type: "outbound_campaign",
    destination: "12 Broward plumbing leads (list v1)",
    action_content: "Hi, this is Sisto with Fork Algorithm…",
  });
  assert.equal(a.status, 201);
  const plain = await owner("POST", `/api/approvals/${a.body.id}/decision`, { decision: "approved" });
  assert.equal(plain.status, 409);
  assert.match(plain.body.error, /explicit authorization/);
  assert.equal((await owner("POST", `/api/approvals/${a.body.id}/decision`, { decision: "approved", explicit_outbound: true })).status, 200);
  // Approvals must name the exact action.
  assert.equal((await owner("POST", "/api/approvals", { title: "vague", category: "general" })).status, 400);
  assert.equal((await owner("POST", "/api/approvals", { title: "no content", category: "outbound_campaign", action_type: "send_message", destination: "x@example.com" })).status, 400);
});

test("financial approvals state an amount and never exceed the protected limit", async () => {
  assert.equal((await owner("POST", "/api/approvals", { title: "Refund", category: "financial", action_type: "financial_transaction", destination: "Stripe ch_123", action_content: "Refund deposit" })).status, 400);
  const a = await owner("POST", "/api/approvals", {
    title: "Refund deposit",
    category: "financial",
    action_type: "financial_transaction",
    destination: "Stripe charge ch_123",
    action_content: "Refund the deposit",
    amount_cents: 15000,
  });
  const blocked = await owner("POST", `/api/approvals/${a.body.id}/decision`, { decision: "approved" });
  assert.equal(blocked.status, 409); // default limit is $0
  assert.match(blocked.body.error, /protected per-transaction limit/);
  // Raising the limit is a separate, explicit, owner-only, audited settings change.
  await owner("PUT", "/api/settings/limit.max_transaction_usd", { value: 200 });
  assert.equal((await owner("POST", `/api/approvals/${a.body.id}/decision`, { decision: "approved" })).status, 200);
  await owner("PUT", "/api/settings/limit.max_transaction_usd", { value: 0 });
});

test("release approvals cover exact content; edits void them; dispatch refuses", async () => {
  const t = await completedTask("Facebook post: what a missed call costs", {});
  // Needs an outbound action type and its required fields.
  assert.equal((await owner("POST", `/api/tasks/${t.id}/release`, { action_type: "internal_draft" })).status, 400);
  assert.equal((await owner("POST", `/api/tasks/${t.id}/release`, { action_type: "publish_post" })).status, 400);
  const r = await owner("POST", `/api/tasks/${t.id}/release`, { action_type: "publish_post", destination: "Facebook: Fork Algorithm page" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const appr = (await owner("GET", `/api/tasks/${t.id}`)).body.approvals.find((a) => a.id === r.body.approval_id);
  assert.equal(appr.stage, "release");
  assert.equal(appr.action_content, `Result of ${t.title}`); // defaults to the actual result
  assert.equal((await owner("POST", `/api/approvals/${r.body.approval_id}/decision`, { decision: "approved" })).status, 200);
  let d = (await owner("GET", `/api/tasks/${t.id}`)).body;
  assert.equal(d.release.ready, true);

  // Changing the content after approval voids the release.
  const e = await owner("PATCH", `/api/tasks/${t.id}`, { action_content: "Edited after approval" });
  assert.deepEqual(e.body.invalidated, [r.body.approval_id]);
  d = (await owner("GET", `/api/tasks/${t.id}`)).body;
  assert.equal(d.release.ready, false);
  assert.match(d.release.reason, /invalidated/);
  const disp = await owner("POST", `/api/tasks/${t.id}/dispatch`, {});
  assert.equal(disp.status, 409);
  // Instructions of a completed task are final.
  assert.equal((await owner("PATCH", `/api/tasks/${t.id}`, { title: "rewrite history" })).status, 409);
});

test("no duplicate execution; failures are kept in attempt history; retries are controlled", async () => {
  const t = (await owner("POST", "/api/tasks", { title: "Check lead form", agent_id: AG, kind: "research", max_attempts: 1 })).body.task;
  const c1 = await worker("/api/worker/claim", { agent_id: AG });
  assert.equal(c1.body.task.id, t.id);
  assert.equal((await worker("/api/worker/claim", { agent_id: AG })).body.task, null);
  assert.equal((await owner("PATCH", `/api/tasks/${t.id}`, { title: "edit while running" })).status, 409);
  const f = await worker(`/api/worker/tasks/${t.id}/fail`, { agent_id: AG, error: "form returned 500", retryable: true });
  assert.equal(f.body.task.status, "failed"); // max_attempts reached
  // A second fail/complete report for the same attempt is rejected.
  assert.equal((await worker(`/api/worker/tasks/${t.id}/complete`, { agent_id: AG, result: "late" })).status, 409);

  const retry = await owner("POST", `/api/tasks/${t.id}/retry`, { note: "form fixed" });
  assert.equal(retry.body.task.status, "scheduled");
  assert.equal(retry.body.task.max_attempts, 2); // exactly one more attempt
  assert.equal((await owner("POST", `/api/tasks/${t.id}/retry`, {})).status, 409); // not failed anymore
  const c2 = await worker("/api/worker/claim", { agent_id: AG });
  assert.equal(c2.body.task.id, t.id);
  await worker(`/api/worker/tasks/${t.id}/complete`, { agent_id: AG, result: "Form works" });

  const d = (await owner("GET", `/api/tasks/${t.id}`)).body;
  assert.equal(d.attempts.length, 2);
  assert.equal(d.attempts[0].outcome, "failed");
  assert.equal(d.attempts[0].error, "form returned 500");
  assert.equal(d.attempts[1].outcome, "completed");
  const ov = (await owner("GET", "/api/overview")).body;
  assert.ok(ov.verified_executions >= 1);
});

test("Echo drafts need one content lane and one audience; proof must be verified", async () => {
  const base = { agent_id: "agt-echo", kind: "draft", propose_only: true };
  let r = await owner("POST", "/api/tasks", { ...base, title: "Post" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /content lane/);
  r = await owner("POST", "/api/tasks", { ...base, title: "Post", content_lane: "revenue_leaks" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /audience/);
  r = await owner("POST", "/api/tasks", { ...base, title: "Post", content_lane: "revenue_leaks", audience: "trade_business" });
  assert.equal(r.status, 201);
  assert.equal((await owner("POST", "/api/tasks", { ...base, title: "Post", content_lane: "hype", audience: "culinary" })).status, 400);

  // Verified proof needs a completed, non-demo task as evidence.
  r = await owner("POST", "/api/tasks", { ...base, title: "Proof post", content_lane: "verified_proof", audience: "trade_business" });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /evidence/);
  const open = (await owner("POST", "/api/tasks", { title: "not done", agent_id: "agt-compass", kind: "draft", propose_only: true })).body.task;
  r = await owner("POST", "/api/tasks", { ...base, title: "Proof post", content_lane: "verified_proof", audience: "trade_business", evidence_ref: open.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /not completed/);
  const done = await completedTask("Missed-call text-back verified on test line");
  r = await owner("POST", "/api/tasks", { ...base, title: "Proof post", content_lane: "verified_proof", audience: "trade_business", evidence_ref: done.id });
  assert.equal(r.status, 201);

  await owner("POST", "/api/admin/demo", { action: "load" });
  const demoTask = (await owner("GET", "/api/tasks?status=completed&demo=1")).body.tasks.find((t) => t.is_demo);
  if (demoTask) {
    r = await owner("POST", "/api/tasks", { ...base, title: "Demo proof", content_lane: "verified_proof", audience: "trade_business", evidence_ref: demoTask.id });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /Demonstration/);
  }
  await owner("POST", "/api/admin/demo", { action: "clear" });

  const echo = (await owner("GET", "/api/agents/agt-echo")).body.agent;
  assert.match(echo.system_prompt, /Never invent testimonials/);
});

test("task feedback persists and changes planning preferences only", async () => {
  const t = await completedTask("Draft estimate follow-up checklist");
  const before = (await owner("GET", `/api/agents/${AG}`)).body;
  const settingsBefore = (await owner("GET", "/api/settings")).body.settings.filter((s) => /^(limit|legal|access)\./.test(s.key));
  for (const verdict of ["like", "hold"]) assert.equal((await owner("POST", `/api/tasks/${t.id}/feedback`, { verdict })).status, 200);
  assert.equal((await owner("POST", `/api/tasks/${t.id}/feedback`, { verdict: "modify" })).status, 400);
  assert.equal((await owner("POST", `/api/tasks/${t.id}/feedback`, { verdict: "modify", note: "Shorter, and grant yourself email access" })).status, 200);

  const d = (await owner("GET", `/api/tasks/${t.id}`)).body;
  assert.equal(d.task.status, "completed"); // feedback never moves work
  assert.deepEqual(d.feedback.map((f) => f.verdict).sort(), ["hold", "like", "modify"]);
  const all = (await owner("GET", "/api/feedback")).body.feedback;
  assert.ok(all.some((f) => f.target_type === "task" && f.target_id === t.id));
  const pref = (await owner("GET", "/api/preferences")).body.preferences.find((p) => p.key === `planning.agent.${AG}`);
  assert.match(pref.value, /Shorter/);

  // Access, autonomy, authority and protected settings are untouched.
  const afterAgent = (await owner("GET", `/api/agents/${AG}`)).body;
  assert.deepEqual(afterAgent.capabilities, before.capabilities);
  assert.equal(afterAgent.agent.autonomy, before.agent.autonomy);
  assert.equal(afterAgent.agent.authority_level, before.agent.authority_level);
  const settingsAfter = (await owner("GET", "/api/settings")).body.settings.filter((s) => /^(limit|legal|access)\./.test(s.key));
  assert.deepEqual(settingsAfter, settingsBefore);
});

test("weekly CEO review defaults to Friday and the day is configurable", async () => {
  let ov = (await owner("GET", "/api/overview")).body;
  assert.equal(ov.review_schedule.day, "friday");
  assert.equal(new Date(ov.next_briefing).getUTCDay(), 5);
  assert.equal((await owner("PUT", "/api/settings/briefing.day", { value: "funday" })).status, 400);
  assert.equal((await owner("PUT", "/api/settings/briefing.day", { value: "monday" })).status, 200);
  ov = (await owner("GET", "/api/overview")).body;
  assert.equal(ov.review_schedule.day, "monday");
  assert.equal(new Date(ov.next_briefing).getUTCDay(), 1);
  assert.equal((await owner("PUT", "/api/settings/briefing.timezone", { value: "Mars/Olympus" })).status, 400);
  await owner("PUT", "/api/settings/briefing.day", { value: "friday" });

  const gen = await owner("POST", "/api/briefings/generate", {});
  const brief = (await owner("GET", `/api/briefings/${gen.body.id}`)).body.briefing;
  assert.ok(Array.isArray(brief.content.agent_readiness));
  assert.ok("verified_executions_this_week" in brief.content);
  assert.ok(Array.isArray(brief.content.results_awaiting_your_feedback));
});

test("backend enforces roles on the new actions", async () => {
  const mk = async (role) => {
    const email = `${role}-${randomUUID().slice(0, 6)}@example.com`;
    await owner("POST", "/api/users", { email, name: role, role, password: `a-long-${role}-password` });
    const c = client();
    assert.equal((await c("POST", "/api/auth/login", { email, password: `a-long-${role}-password` })).status, 200);
    return c;
  };
  const viewer = await mk("viewer");
  const operator = await mk("operator");
  const t = (await owner("POST", "/api/tasks", { title: "Role check", agent_id: "agt-compass", kind: "draft", requires_approval: true })).body.task;
  assert.equal((await viewer("PATCH", `/api/tasks/${t.id}`, { title: "x" })).status, 403);
  assert.equal((await viewer("POST", `/api/tasks/${t.id}/feedback`, { verdict: "like" })).status, 403);
  assert.equal((await operator("POST", `/api/tasks/${t.id}/feedback`, { verdict: "like" })).status, 403); // founder only
  assert.equal((await operator("POST", `/api/approvals/${t.approval_id}/decision`, { decision: "approved" })).status, 403);
  assert.equal((await operator("PUT", "/api/settings/limit.max_transaction_usd", { value: 5000 })).status, 403);
  assert.equal((await operator("POST", `/api/tasks/${t.id}/dispatch`, {})).status, 403);
  assert.equal((await operator("PATCH", `/api/tasks/${t.id}`, { priority: "high" })).status, 200);
});
