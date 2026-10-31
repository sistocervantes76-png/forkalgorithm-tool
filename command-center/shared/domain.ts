// Shared domain constants used by both the Worker API and the React app.

export const TASK_STATUSES = [
  "proposed",
  "awaiting_approval",
  "scheduled",
  "running",
  "completed",
  "failed",
  "paused",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  proposed: "Proposed",
  awaiting_approval: "Awaiting approval",
  scheduled: "Scheduled",
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  paused: "Paused",
  cancelled: "Cancelled",
};

// Allowed manual transitions. Worker/executor transitions (scheduled→running,
// running→completed/failed) are enforced separately in the API.
export const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  proposed: ["awaiting_approval", "scheduled", "cancelled"],
  awaiting_approval: ["cancelled"], // leaves this state only through an approval decision
  scheduled: ["paused", "cancelled"],
  running: ["paused"],
  completed: [],
  failed: ["scheduled", "cancelled"], // retry
  paused: ["scheduled", "cancelled"],
  cancelled: [],
};

export const PRIORITIES = ["low", "normal", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const AUTONOMY_LEVELS = ["observer", "draft_only", "supervised", "preapproved_routine"] as const;
export type Autonomy = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_INFO: Record<Autonomy, { label: string; detail: string }> = {
  observer: { label: "Observer", detail: "Reads and reports. Cannot run tasks." },
  draft_only: { label: "Draft only", detail: "Produces drafts. Nothing leaves the building." },
  supervised: { label: "Supervised execution", detail: "Every task needs founder approval before it runs." },
  preapproved_routine: {
    label: "Preapproved routine",
    detail: "Routine tasks run without per-task approval. Outbound, financial and access actions still need approval.",
  },
};

export const ROLES = ["owner", "admin", "operator", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export type IntegrationKey =
  | "internal"
  | "anthropic"
  | "make_inbound"
  | "make_outbound"
  | "stripe"
  | "ringcentral"
  | "google_sheets"
  | "worker_api";

export const CAPABILITIES = [
  { key: "web_research", label: "Web research", integration: "anthropic", note: "Uses Claude's web search tool (an approved search provider)." },
  { key: "internal_docs", label: "Internal document reading", integration: "google_sheets", note: "Reads the configured Google Sheet." },
  { key: "drafting", label: "Drafting", integration: "anthropic", note: "Generates drafts with the configured AI provider." },
  { key: "task_delegation", label: "Task delegation", integration: "internal", note: "Proposes tasks for other agents. Proposals still follow approval rules." },
  { key: "email", label: "Email", integration: "make_outbound", note: "Sends only through an approved Make.com scenario." },
  { key: "crm_updates", label: "CRM updates", integration: "google_sheets", note: "Writes business records to Google Sheets." },
  { key: "workflow_monitoring", label: "Workflow monitoring", integration: "make_inbound", note: "Reads Make.com run reports received by webhook." },
  { key: "api_integrations", label: "API integrations", integration: "make_outbound", note: "Triggers approved Make.com scenarios." },
  { key: "reporting", label: "Reporting", integration: "internal", note: "Builds reports from Command Center records." },
] as const satisfies ReadonlyArray<{ key: string; label: string; integration: IntegrationKey; note: string }>;
export type CapabilityKey = (typeof CAPABILITIES)[number]["key"];

export const APPROVAL_CATEGORIES = ["general", "outbound_campaign", "financial", "access", "security", "publication"] as const;
export type ApprovalCategory = (typeof APPROVAL_CATEGORIES)[number];

// Task kinds that ALWAYS require founder approval, regardless of autonomy.
export const ALWAYS_APPROVE_KINDS = ["outreach", "financial", "access"] as const;

export const OUTREACH_STATUSES = [
  "researched",
  "drafted",
  "awaiting_approval",
  "approved",
  "contacted",
  "replied",
  "meeting",
  "qualified",
  "not_interested",
  "do_not_contact",
] as const;

// Settings keys that founder feedback can never modify. Only an owner, via the
// explicit settings screen, may change them — and every change is audited.
export const PROTECTED_SETTING_PREFIXES = ["limit.", "legal.", "access."];

export const FEEDBACK_VERDICTS = ["like", "dislike", "modify", "hold"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (default)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1" },
];

export const PROVIDERS = [
  { id: "none", label: "Not configured" },
  { id: "anthropic", label: "Anthropic (in-Worker draft executor)" },
  { id: "custom-worker", label: "External worker (polls the Worker API)" },
];
