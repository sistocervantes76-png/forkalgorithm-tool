// Demonstration data. Every row is flagged is_demo = 1, uses example.com
// domains, and is shown with a DEMO badge. It never feeds briefings or
// headline metrics unless the viewer explicitly opts in.
import type { Env } from "./env";
import { audit, newId, nowIso } from "./lib";

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

export async function loadDemo(env: Env, actor: string): Promise<void> {
  await clearDemo(env, actor, false);
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const db = env.DB;

  const tasks: [string, string, string, string, string, number, string | null, string | null][] = [
    // agent, title, status, kind, priority, hoursAgo, result, error
    ["agt-scout", "Compile HVAC automation offers in Tampa Bay", "completed", "research", "normal", 50, "DEMO RESULT — 6 published offers summarized.", null],
    ["agt-hunter", "Draft intro emails for 5 qualified plumbers", "awaiting_approval", "outreach", "high", 20, null, null],
    ["agt-forge", "Diagnose failed lead-intake scenario", "failed", "general", "high", 8, null, "DEMO ERROR — Make.com module 4 returned 401"],
    ["agt-echo", "Draft three LinkedIn posts on missed-call text-back", "running", "draft", "normal", 1, null, null],
    ["agt-ledger", "Summarize October Stripe payouts", "proposed", "report", "normal", 3, null, null],
    ["agt-compass", "Update crew scheduling SOP", "scheduled", "draft", "low", 2, null, null],
    ["agt-harbor", "Draft 30-day check-in for new clients", "completed", "draft", "normal", 30, "DEMO RESULT — check-in template drafted.", null],
    ["agt-sentinel", "Review Hunter's outreach drafts for claims", "paused", "general", "normal", 12, null, null],
  ];
  for (const [agent, title, status, kind, priority, h, result, error] of tasks) {
    const id = newId("TSK");
    const started = ["completed", "failed", "running"].includes(status) ? ago(h) : null;
    const completed = ["completed", "failed"].includes(status) ? ago(h - 0.5) : null;
    const approvalId = status === "awaiting_approval" ? newId("APR") : null;
    stmts.push(
      db.prepare(
        `INSERT INTO tasks (id, title, description, agent_id, status, priority, kind, requires_approval, approval_id, source, created_by,
          started_at, completed_at, attempts, result, error, is_demo, created_at, updated_at)
         VALUES (?, ?, 'Demonstration task.', ?, ?, ?, ?, ?, ?, 'manual', 'demo', ?, ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(id, title, agent, status, priority, kind, approvalId ? 1 : 0, approvalId, started, completed, started ? 1 : 0, result, error, ago(h + 1), now),
      db.prepare("INSERT INTO task_logs (task_id, ts, level, message, actor) VALUES (?, ?, 'info', 'DEMO — sample log entry', 'demo')").bind(id, ago(h)),
    );
    if (approvalId) {
      stmts.push(
        db.prepare(
          `INSERT INTO approvals (id, task_id, title, description, category, risk_level, requested_by, status, is_demo, created_at)
           VALUES (?, ?, ?, 'DEMO — outreach always requires founder approval.', 'outbound_campaign', 'medium', 'agt-hunter', 'pending', 1, ?)`,
        ).bind(approvalId, id, `Approve task: ${title}`, ago(h)),
      );
    }
  }

  stmts.push(
    db.prepare(
      `INSERT INTO approvals (id, title, description, category, risk_level, requested_by, status, is_demo, created_at)
       VALUES (?, 'Grant Hunter CRM write access', 'DEMO — access change request.', 'access', 'high', 'agt-atlas', 'pending', 1, ?)`,
    ).bind(newId("APR"), ago(5)),
  );

  const prospects: [string, string, string, string, number, string][] = [
    ["Gulf Breeze HVAC (demo)", "HVAC", "Tampa, FL", "Misses after-hours calls", 82, "drafted"],
    ["Clearwater Drain Pros (demo)", "Plumbing", "Clearwater, FL", "No online booking", 74, "awaiting_approval"],
    ["Sunline Roofing (demo)", "Roofing", "St. Petersburg, FL", "Slow estimate follow-up", 68, "contacted"],
    ["Bayside Electric (demo)", "Electrical", "Brandon, FL", "Manual invoicing", 61, "meeting"],
    ["Palm Lawn & Garden (demo)", "Landscaping", "Sarasota, FL", "No review requests", 55, "researched"],
    ["Harbor Pest Control (demo)", "Pest control", "Tampa, FL", "Paper work orders", 47, "qualified"],
  ];
  prospects.forEach(([name, industry, location, problem, score, status], i) => {
    const slug = name.toLowerCase().replace(/[^a-z]+/g, "-").replace(/-demo-?$/, "");
    stmts.push(
      db.prepare(
        `INSERT INTO prospects (id, business_name, industry, location, website, public_contact, problem, qualification_score, source_url,
          researched_at, agent_id, outreach_status, proposed_message, deal_value_cents, meeting_at, is_demo, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'agt-scout', ?, ?, ?, ?, 1, ?, ?)`,
      ).bind(
        newId("PRS"), name, industry, location, `https://${slug}.example.com`, `office@${slug}.example.com`, problem, score,
        `https://${slug}.example.com/about`, ago(24 * (i + 1)), status,
        status === "researched" ? null : `DEMO DRAFT — Hi ${name.replace(" (demo)", "")} team, noticed ${problem.toLowerCase()}…`,
        status === "meeting" || status === "qualified" ? 150000 + i * 25000 : null, status === "meeting" ? ago(-48) : null, now, now,
      ),
    );
  });

  const findings: [string, string, string, string | null, string | null][] = [
    ["trend", "Missed-call text-back bundled with CRM", "DEMO — several trade-service vendors now bundle text-back with CRM subscriptions.", null, null],
    ["competitor", "Example Competitor A", "DEMO — positions on AI receptionist for home services.", "Example Competitor A", null],
    ["pricing", "Example Competitor A — Starter plan", "DEMO — published monthly price.", "Example Competitor A", "$297/mo (demo)"],
    ["pricing", "Example Competitor B — Growth plan", "DEMO — published monthly price plus setup fee.", "Example Competitor B", "$497/mo + $999 setup (demo)"],
  ];
  for (const [kind, title, summary, competitor, price] of findings) {
    stmts.push(
      db.prepare(
        `INSERT INTO market_findings (id, kind, title, summary, competitor, published_price, industry, source_url, researched_at, agent_id, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Trade services', 'https://competitor.example.com/pricing', ?, 'agt-scout', 1, ?)`,
      ).bind(newId("MKT"), kind, title, summary, competitor, price, ago(36), now),
    );
  }

  for (let i = 0; i < 14; i++) {
    const failed = i % 5 === 3;
    stmts.push(
      db.prepare(
        `INSERT INTO workflow_runs (id, workflow, external_id, source, status, started_at, finished_at, duration_ms, error, is_demo, created_at)
         VALUES (?, ?, ?, 'make', ?, ?, ?, ?, ?, 1, ?)`,
      ).bind(
        newId("RUN"), i % 2 ? "Lead intake → Sheets (demo)" : "Missed-call text-back (demo)", `demo-${i}-${crypto.randomUUID()}`,
        failed ? "failed" : "completed", ago(i * 10), ago(i * 10 - 0.01), 1200 + i * 150, failed ? "DEMO — connection timeout" : null, ago(i * 10),
      ),
    );
  }

  stmts.push(
    db.prepare(
      `INSERT INTO alerts (id, severity, category, title, body, is_demo, created_at) VALUES (?, 'warning', 'failure', 'DEMO — Lead intake scenario failed', 'Sample alert.', 1, ?)`,
    ).bind(`ALR-DEMO${Math.floor(Math.random() * 1e4)}`, ago(8)),
    db.prepare(
      `INSERT INTO recommendations (id, agent_id, week_of, title, body, status, source, is_demo, created_at)
       VALUES (?, 'agt-atlas', ?, 'DEMO — Focus outreach on HVAC before peak season', 'Sample recommendation for interface review.', 'open', 'manual', 1, ?)`,
    ).bind(newId("REC"), new Date().toISOString().slice(0, 10), now),
  );

  await db.batch(stmts);
  await audit(env, actor, "demo.load", "system", null, { rows: stmts.length });
}

export async function clearDemo(env: Env, actor: string, log = true): Promise<void> {
  const db = env.DB;
  await db.batch([
    db.prepare("DELETE FROM task_logs WHERE task_id IN (SELECT id FROM tasks WHERE is_demo = 1)"),
    db.prepare("UPDATE tasks SET approval_id = NULL WHERE is_demo = 1"),
    db.prepare("DELETE FROM approvals WHERE is_demo = 1"),
    db.prepare("DELETE FROM tasks WHERE is_demo = 1"),
    db.prepare("DELETE FROM prospects WHERE is_demo = 1"),
    db.prepare("DELETE FROM market_findings WHERE is_demo = 1"),
    db.prepare("DELETE FROM workflow_runs WHERE is_demo = 1"),
    db.prepare("DELETE FROM alerts WHERE is_demo = 1"),
    db.prepare("DELETE FROM feedback WHERE recommendation_id IN (SELECT id FROM recommendations WHERE is_demo = 1)"),
    db.prepare("DELETE FROM recommendations WHERE is_demo = 1"),
  ]);
  if (log) await audit(env, actor, "demo.clear", "system", null, {});
}
