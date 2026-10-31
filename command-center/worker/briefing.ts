// Weekly CEO briefing. Facts are aggregated from real records only (is_demo = 0).
// An AI narrative is added only when Atlas is configured with a working provider.
import type { Env } from "./env";
import { audit, newId, nowIso, parseJsonField } from "./lib";
import { briefingNarrative, canExecuteInWorker, executeTask } from "./executor";
import { raiseAlert, recoverStuckTasks, type AgentRow } from "./tasks";
import { pruneRateLimits } from "./lib";

export function weekStart(d = new Date()): string {
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return m.toISOString().slice(0, 10);
}

export async function buildBriefingFacts(env: Env, weekOf: string) {
  const from = `${weekOf}T00:00:00.000Z`;
  const to = new Date(new Date(from).getTime() + 7 * 86400_000).toISOString();
  const db = env.DB;

  const [byAgent, statusCounts, pendingApprovals, decided, alerts, pipeline, runs, recs, feedback, demoCount] = await Promise.all([
    db.prepare(
      `SELECT a.name AS agent,
              SUM(CASE WHEN t.status = 'completed' AND t.completed_at >= ?1 AND t.completed_at < ?2 THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN t.status = 'failed' AND t.completed_at >= ?1 AND t.completed_at < ?2 THEN 1 ELSE 0 END) AS failed
       FROM agents a LEFT JOIN tasks t ON t.agent_id = a.id AND t.is_demo = 0
       WHERE a.archived = 0 GROUP BY a.id ORDER BY a.is_core DESC, a.name`,
    ).bind(from, to).all(),
    db.prepare("SELECT status, COUNT(*) AS n FROM tasks WHERE is_demo = 0 GROUP BY status").all<{ status: string; n: number }>(),
    db.prepare("SELECT id, title, category, risk_level, created_at FROM approvals WHERE is_demo = 0 AND status IN ('pending','held') ORDER BY created_at").all(),
    db.prepare("SELECT status, COUNT(*) AS n FROM approvals WHERE is_demo = 0 AND decided_at >= ? AND decided_at < ? GROUP BY status").bind(from, to).all(),
    db.prepare("SELECT severity, category, title, created_at FROM alerts WHERE is_demo = 0 AND created_at >= ? AND created_at < ? AND severity != 'info' ORDER BY created_at DESC LIMIT 20").bind(from, to).all(),
    db.prepare("SELECT outreach_status AS status, COUNT(*) AS n FROM prospects WHERE is_demo = 0 GROUP BY outreach_status").all(),
    db.prepare(
      "SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, SUM(status = 'failed') AS failed FROM workflow_runs WHERE is_demo = 0 AND created_at >= ? AND created_at < ?",
    ).bind(from, to).first(),
    db.prepare("SELECT title, status FROM recommendations WHERE is_demo = 0 AND week_of = ?").bind(weekOf).all(),
    db.prepare("SELECT verdict, COUNT(*) AS n FROM feedback WHERE created_at >= ? AND created_at < ? GROUP BY verdict").bind(from, to).all(),
    db.prepare("SELECT (SELECT COUNT(*) FROM tasks WHERE is_demo = 1) + (SELECT COUNT(*) FROM prospects WHERE is_demo = 1) AS n").first<{ n: number }>(),
  ]);

  return {
    week_of: weekOf,
    period: { from, to },
    data_basis: "Command Center records only. Demonstration data excluded.",
    demo_records_excluded: demoCount?.n ?? 0,
    tasks_by_agent: byAgent.results,
    task_status_totals: Object.fromEntries(statusCounts.results.map((r) => [r.status, r.n])),
    approvals_outstanding: pendingApprovals.results,
    approvals_decided_this_week: decided.results,
    incidents_this_week: alerts.results,
    pipeline_by_status: pipeline.results,
    workflow_runs_this_week: runs,
    recommendations_this_week: recs.results,
    founder_feedback_this_week: feedback.results,
  };
}

export async function generateBriefing(env: Env, trigger: "manual" | "scheduled", actor: string) {
  const weekOf = weekStart();
  const facts = await buildBriefingFacts(env, weekOf);
  let narrative: string | null = null;
  let narrativeError: string | null = null;
  try {
    narrative = await briefingNarrative(env, facts);
  } catch (err) {
    narrativeError = err instanceof Error ? err.message : "AI narrative failed";
  }
  const id = newId("BRF");
  await env.DB.prepare(
    "INSERT INTO briefings (id, week_of, generated_at, generated_by, trigger_kind, content, narrative, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'final')",
  )
    .bind(id, weekOf, nowIso(), narrative ? "aggregation+ai" : "aggregation", trigger, JSON.stringify({ ...facts, narrative_error: narrativeError }), narrative)
    .run();
  await audit(env, actor, "briefing.generate", "briefing", id, { trigger, with_narrative: Boolean(narrative) });
  return id;
}

// ---------------------------------------------------------------- schedule helpers

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** True if `now` falls inside the agent's operating schedule (in its time zone). */
export function withinSchedule(scheduleJson: string, now = new Date()): boolean {
  const s = parseJsonField<{ days?: string[]; start?: string; end?: string; tz?: string }>(scheduleJson, {});
  if (!s.days?.length) return true; // no schedule = any time
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: s.tz || "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return false;
  }
  const weekday = parts.find((p) => p.type === "weekday")?.value.toLowerCase().slice(0, 3) ?? "";
  const hm = `${parts.find((p) => p.type === "hour")?.value}:${parts.find((p) => p.type === "minute")?.value}`;
  if (!s.days.includes(weekday) || !DAYS.includes(weekday)) return false;
  return (!s.start || hm >= s.start) && (!s.end || hm < s.end);
}

// ---------------------------------------------------------------- cron entry point

export async function runScheduled(env: Env, cron: string): Promise<void> {
  const recovered = await recoverStuckTasks(env);
  if (recovered) console.log(`recovered ${recovered} stuck task(s)`);
  await pruneRateLimits(env);
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()).run();

  // Friday briefing (cron "0 21 * * 5" by default). Skip if one already exists for this week from the schedule.
  if (cron.trim().endsWith("* * 5")) {
    const existing = await env.DB.prepare("SELECT id FROM briefings WHERE week_of = ? AND trigger_kind = 'scheduled'").bind(weekStart()).first();
    if (!existing) {
      try {
        await generateBriefing(env, "scheduled", "system");
      } catch (err) {
        await raiseAlert(env, { severity: "warning", category: "system", title: "Weekly briefing failed", body: String(err), dedupe_key: `briefing-fail:${weekStart()}` });
      }
    }
  }

  // Execute a small batch of due tasks for agents using the in-Worker executor.
  const due = await env.DB.prepare(
    `SELECT t.id, t.agent_id FROM tasks t JOIN agents a ON a.id = t.agent_id
     WHERE t.status = 'scheduled' AND t.is_demo = 0 AND (t.scheduled_for IS NULL OR t.scheduled_for <= ?)
       AND a.provider = 'anthropic' AND a.enabled = 1 AND a.paused = 0 AND a.archived = 0
     ORDER BY CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at
     LIMIT 3`,
  )
    .bind(nowIso())
    .all<{ id: string; agent_id: string }>();
  for (const row of due.results) {
    const agent = await env.DB.prepare("SELECT * FROM agents WHERE id = ?").bind(row.agent_id).first<AgentRow>();
    if (!agent || !withinSchedule(agent.schedule) || (await canExecuteInWorker(env, agent))) continue;
    try {
      await executeTask(env, row.id, "cron");
    } catch (err) {
      console.error("scheduled execution skipped", row.id, err);
    }
  }
}
