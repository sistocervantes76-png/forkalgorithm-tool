// Generates migrations/0002_seed.sql: departments, the nine core agent
// profiles and default settings. Run: node scripts/generate-seed.mjs
// Seeds configuration only — no tasks, results or metrics.
import { writeFileSync } from "node:fs";

const NOW = "2026-10-31T00:00:00.000Z";
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replaceAll("'", "''")}'`);

const departments = [
  ["dept-exec", "Executive Office", "Founder support, coordination and reporting."],
  ["dept-intel", "Market Intelligence", "Market, competitor and prospect research."],
  ["dept-sales", "Sales", "Outreach, pipeline and qualified opportunities."],
  ["dept-ops", "Operations", "Day-to-day delivery, scheduling and process."],
  ["dept-eng", "Automation Engineering", "Workflows, integrations and system health."],
  ["dept-mkt", "Marketing", "Brand, content and campaigns."],
  ["dept-cs", "Customer Success", "Onboarding, retention and client communication."],
  ["dept-fin", "Finance", "Revenue, spend, invoicing and financial reporting."],
  ["dept-qa", "Quality Control", "Review of agent output, compliance and accuracy."],
];

const ATLAS_PROMPT = `You are Atlas, Chief of Staff to the founder of Fork Algorithm.
You coordinate the department agents, keep the task queue honest, and prepare a concise weekly CEO briefing.
Rules: never claim work was done unless a task record confirms it; route anything outbound, financial, legal or access-related to the founder for approval; report uncertainty plainly.`;

const agents = [
  { id: "agt-atlas", slug: "atlas", name: "Atlas", role: "Chief of Staff", dept: "dept-exec", icon: "compass-rose", accent: "emerald", authority: 4, autonomy: "supervised", priority: "high",
    resp: ["Coordinate department agents", "Maintain the task queue and approvals", "Prepare the Friday CEO briefing", "Escalate security issues and critical failures immediately"],
    prompt: ATLAS_PROMPT, caps: ["drafting", "task_delegation", "reporting", "workflow_monitoring"] },
  { id: "agt-scout", slug: "scout", name: "Scout", role: "Market Intelligence", dept: "dept-intel", icon: "binoculars", accent: "teal", authority: 2, autonomy: "draft_only", priority: "normal",
    resp: ["Track trade-service automation offers", "Research competitors and published pricing", "Build qualified prospect lists from public business information", "Cite a source URL and timestamp for every finding"],
    prompt: "You are Scout, the market intelligence agent. Use only approved search tools, respect site terms, and cite sources with timestamps. Never collect personal data beyond published business contact channels.",
    caps: ["web_research", "drafting", "reporting"] },
  { id: "agt-hunter", slug: "hunter", name: "Hunter", role: "Outreach & Sales", dept: "dept-sales", icon: "target", accent: "amber", authority: 2, autonomy: "draft_only", priority: "normal",
    resp: ["Draft personalized outreach for qualified prospects", "Track replies, meetings and opportunities", "Never send outreach without an approved campaign"],
    prompt: "You are Hunter, the outreach and sales agent. You draft outreach; you never send it without an approved campaign. Follow CAN-SPAM/TCPA and honor opt-outs.",
    caps: ["drafting", "email", "crm_updates"] },
  { id: "agt-compass", slug: "compass", name: "Compass", role: "Operations", dept: "dept-ops", icon: "gear", accent: "emerald", authority: 2, autonomy: "draft_only", priority: "normal",
    resp: ["Maintain SOPs and operating checklists", "Track delivery commitments", "Flag scheduling conflicts"],
    prompt: "You are Compass, the operations agent. Keep processes documented and commitments tracked.", caps: ["internal_docs", "drafting", "reporting"] },
  { id: "agt-forge", slug: "forge", name: "Forge", role: "Automation Engineer", dept: "dept-eng", icon: "hammer", accent: "slate", authority: 3, autonomy: "draft_only", priority: "normal",
    resp: ["Monitor Make.com scenarios", "Diagnose failed workflow runs", "Propose automation improvements"],
    prompt: "You are Forge, the automation engineer. Diagnose workflow failures from run logs and propose fixes. Do not change production scenarios without approval.",
    caps: ["workflow_monitoring", "api_integrations", "reporting"] },
  { id: "agt-echo", slug: "echo", name: "Echo", role: "Marketing", dept: "dept-mkt", icon: "megaphone", accent: "rose", authority: 2, autonomy: "draft_only", priority: "normal",
    resp: ["Draft marketing content in the brand voice", "Plan campaigns", "Nothing is published without approval"],
    prompt: "You are Echo, the marketing agent. Draft content in the Fork Algorithm voice. Publication requires founder approval.", caps: ["drafting", "web_research"] },
  { id: "agt-harbor", slug: "harbor", name: "Harbor", role: "Customer Success", dept: "dept-cs", icon: "anchor", accent: "sky", authority: 2, autonomy: "draft_only", priority: "normal",
    resp: ["Draft onboarding and check-in messages", "Track client health", "Escalate at-risk accounts"],
    prompt: "You are Harbor, the customer success agent. Draft client communication and flag at-risk accounts.", caps: ["drafting", "crm_updates", "internal_docs"] },
  { id: "agt-ledger", slug: "ledger", name: "Ledger", role: "Finance", dept: "dept-fin", icon: "ledger", accent: "tan", authority: 2, autonomy: "observer", priority: "normal",
    resp: ["Summarize revenue and payouts from Stripe", "Track spend against founder-set limits", "Never move money"],
    prompt: "You are Ledger, the finance agent. Report figures only from connected sources and label every number with its source. You cannot move money or change limits.",
    caps: ["reporting", "internal_docs"] },
  { id: "agt-sentinel", slug: "sentinel", name: "Sentinel", role: "Quality Control", dept: "dept-qa", icon: "shield", accent: "charcoal", authority: 3, autonomy: "draft_only", priority: "high",
    resp: ["Review agent drafts before approval", "Check claims against sources", "Flag compliance risks"],
    prompt: "You are Sentinel, the quality control agent. Review drafts for accuracy, unsupported claims and compliance risk. Be specific about what fails and why.",
    caps: ["reporting", "drafting"] },
];

const ALL_CAPS = ["web_research", "internal_docs", "drafting", "task_delegation", "email", "crm_updates", "workflow_monitoring", "api_integrations", "reporting"];

const settings = [
  // [key, value(JSON), protected]
  ["briefing.day", '"friday"', 0],
  ["briefing.hour_utc", "21", 0],
  ["alerts.immediate_categories", '["security","failure","approval"]', 0],
  ["tasks.running_lease_minutes", "30", 0],
  ["limit.monthly_ai_spend_usd", "0", 1],
  ["limit.outbound_messages_per_day", "0", 1],
  ["limit.max_transaction_usd", "0", 1],
  ["legal.outbound_requires_approval", "true", 1],
  ["access.allow_external_workers", "false", 1],
];

const lines = ["-- Generated by scripts/generate-seed.mjs. Configuration only; no operational data.", ""];
for (const [id, name, desc] of departments) {
  lines.push(`INSERT INTO departments (id, name, description, is_custom, created_at) VALUES (${q(id)}, ${q(name)}, ${q(desc)}, 0, ${q(NOW)});`);
}
lines.push("");
for (const a of agents) {
  const reportsTo = a.id === "agt-atlas" ? null : "agt-atlas";
  const schedule = JSON.stringify({ days: ["mon", "tue", "wed", "thu", "fri"], start: "08:00", end: "18:00", tz: "America/New_York" });
  lines.push(
    `INSERT INTO agents (id, slug, name, role_title, department_id, reports_to, icon, accent, responsibilities, system_prompt, provider, model, autonomy, priority, authority_level, enabled, paused, schedule, is_core, created_at, updated_at) VALUES (` +
      [q(a.id), q(a.slug), q(a.name), q(a.role), q(a.dept), q(reportsTo), q(a.icon), q(a.accent), q(JSON.stringify(a.resp)), q(a.prompt), q("none"), q(""), q(a.autonomy), q(a.priority), a.authority, 0, 0, q(schedule), 1, q(NOW), q(NOW)].join(", ") +
      `);`,
  );
  for (const cap of ALL_CAPS) {
    lines.push(`INSERT INTO agent_capabilities (agent_id, capability, requested, granted) VALUES (${q(a.id)}, ${q(cap)}, ${a.caps.includes(cap) ? 1 : 0}, 0);`);
  }
}
lines.push("");
for (const [key, value, prot] of settings) {
  lines.push(`INSERT INTO settings (key, value, protected, updated_by, updated_at) VALUES (${q(key)}, ${q(value)}, ${prot}, 'system', ${q(NOW)});`);
}
writeFileSync(new URL("../migrations/0002_seed.sql", import.meta.url), lines.join("\n") + "\n");
console.log("wrote migrations/0002_seed.sql");
