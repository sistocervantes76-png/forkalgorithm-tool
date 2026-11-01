import { AUTONOMY_INFO, type Autonomy } from "../../shared/domain";
import { fmtRelative } from "../api";
import { Icon } from "./icons";
import { Badge, StatusPill, cx } from "./ui";

export interface Agent {
  id: string;
  slug: string;
  name: string;
  role_title: string;
  department_id: string | null;
  reports_to: string | null;
  icon: string;
  accent: string;
  nameplate_style: string;
  responsibilities: string[];
  system_prompt: string;
  provider: string;
  model: string;
  autonomy: Autonomy;
  priority: string;
  authority_level: number;
  enabled: boolean;
  paused: boolean;
  archived: boolean;
  is_core: boolean;
  schedule: { days?: string[]; start?: string; end?: string; tz?: string };
  last_heartbeat_at: string | null;
  last_confirmed_execution_at: string | null;
  connection: { state: string; label: string };
  readiness: { ready: boolean; summary: string; checks: { key: string; label: string; ok: boolean; detail: string }[] } | null;
  verified_execution: { last_at: string | null; label?: string };
  current_assignment: { id: string; title: string; status: any } | null;
  stats: { completed: number; failed: number; open: number; completion_rate: number | null; error_count_30d: number };
}

export const ACCENTS: Record<string, { bg: string; ring: string; text: string }> = {
  emerald: { bg: "bg-emerald-700", ring: "ring-emerald-700/30", text: "text-creme" },
  teal: { bg: "bg-teal-700", ring: "ring-teal-700/30", text: "text-white" },
  amber: { bg: "bg-amber-700", ring: "ring-amber-700/30", text: "text-white" },
  slate: { bg: "bg-slate-600", ring: "ring-slate-600/30", text: "text-white" },
  rose: { bg: "bg-rose-700", ring: "ring-rose-700/30", text: "text-white" },
  sky: { bg: "bg-sky-700", ring: "ring-sky-700/30", text: "text-white" },
  tan: { bg: "bg-tan-dark", ring: "ring-tan-dark/30", text: "text-creme" },
  charcoal: { bg: "bg-charcoal", ring: "ring-charcoal/30", text: "text-creme" },
};

const CONN_TONE: Record<string, { dot: string; tone: Parameters<typeof Badge>[0]["tone"] }> = {
  ready: { dot: "bg-emerald-500", tone: "ok" },
  configured: { dot: "bg-info", tone: "info" },
  online: { dot: "bg-emerald-500", tone: "ok" },
  offline: { dot: "bg-bad", tone: "bad" },
  disconnected: { dot: "bg-bad", tone: "bad" },
  awaiting_worker: { dot: "bg-amber-500", tone: "warn" },
  paused: { dot: "bg-tan-dark", tone: "tan" },
  disabled: { dot: "bg-ink-3", tone: "neutral" },
  not_configured: { dot: "bg-ink-3", tone: "neutral" },
  archived: { dot: "bg-ink-3", tone: "neutral" },
};

export function AgentAvatar({ agent, size = 44 }: { agent: Pick<Agent, "icon" | "accent" | "name">; size?: number }) {
  const a = ACCENTS[agent.accent] ?? ACCENTS.emerald;
  return (
    <span className={cx("inline-flex shrink-0 items-center justify-center rounded-xl ring-4", a.bg, a.ring, a.text)} style={{ width: size, height: size }}>
      <Icon name={agent.icon} size={size * 0.52} />
    </span>
  );
}

export function ConnectionBadge({ connection }: { connection: Agent["connection"] }) {
  const c = CONN_TONE[connection.state] ?? CONN_TONE.not_configured;
  return (
    <Badge tone={c.tone} title={connection.label}>
      <span className={cx("h-1.5 w-1.5 rounded-full", c.dot)} aria-hidden="true" />
      {connection.label}
    </Badge>
  );
}

/** Ready only when profile, backend, credentials and authorized tools all check out. */
export function ReadinessBadge({ agent }: { agent: Pick<Agent, "readiness" | "connection"> }) {
  if (!agent.readiness) return <ConnectionBadge connection={agent.connection} />;
  const r = agent.readiness;
  return (
    <Badge tone={r.ready ? "ok" : "neutral"} title={r.checks.map((c) => `${c.ok ? "✓" : "✕"} ${c.label}: ${c.detail}`).join("\n")}>
      <span className={cx("h-1.5 w-1.5 rounded-full", r.ready ? "bg-emerald-500" : "bg-ink-3")} aria-hidden="true" />
      {r.ready ? "Ready to execute" : "Not running"}
    </Badge>
  );
}

export function ReadinessChecklist({ readiness }: { readiness: NonNullable<Agent["readiness"]> }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {readiness.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          <span className={cx("mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold", c.ok ? "bg-ok text-white" : "bg-creme-3 text-ink-2")} aria-hidden="true">
            {c.ok ? "✓" : "✕"}
          </span>
          <span>
            <span className="font-medium">{c.label}</span>
            <span className="block text-xs text-ink-3">{c.detail}</span>
          </span>
        </li>
      ))}
      <li className="pt-1 text-xs text-ink-3">Tasks that need approval also run only after you approve their exact action.</li>
    </ul>
  );
}

export function AuthorityPips({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`Authority level ${level} of 5`} aria-label={`Authority level ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-2 w-3 rounded-sm", i <= level ? "bg-tan-dark" : "bg-creme-3")} />
      ))}
    </span>
  );
}

export function Nameplate({ agent, department, onOpen }: { agent: Agent; department?: string; onOpen: () => void }) {
  const style = agent.nameplate_style;
  return (
    <button
      onClick={onOpen}
      className={cx(
        "group w-full rounded-xl border bg-white/90 text-left transition hover:-translate-y-px hover:shadow-md",
        style === "brass" ? "border-tan bg-gradient-to-br from-creme to-tan-light/40" : "border-creme-3",
        !agent.enabled && "opacity-80",
      )}
    >
      <div className={cx("flex items-center gap-3 px-4 pt-4", style === "minimal" && "pb-1")}>
        <AgentAvatar agent={agent} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-display text-lg leading-tight text-ink">{agent.name}</span>
            {!agent.reports_to && <Badge tone="emerald">Chief of Staff</Badge>}
          </div>
          <div className="truncate text-xs text-ink-3">
            {agent.role_title}
            {department ? ` · ${department}` : ""}
          </div>
        </div>
        <Badge tone={agent.enabled ? (agent.paused ? "tan" : "neutral") : "neutral"} title="An enabled profile does not start a running agent">
          {agent.enabled ? (agent.paused ? "Paused" : "Profile on") : "Profile off"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5 px-4 pt-3">
        <ReadinessBadge agent={agent} />
      </div>

      <div className="mt-3 border-t border-creme-2 px-4 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="text-ink-3">Current assignment</span>
          {agent.current_assignment ? <StatusPill status={agent.current_assignment.status} /> : <span className="text-ink-3">None</span>}
        </div>
        {agent.current_assignment && <div className="mt-1 truncate text-ink-2">{agent.current_assignment.title}</div>}
      </div>

      {agent.last_confirmed_execution_at ? (
        <dl className="grid grid-cols-4 gap-2 border-t border-creme-2 px-4 py-3 text-xs">
          <div>
            <dt className="text-ink-3">Completion</dt>
            <dd className="font-semibold tabular-nums">{agent.stats.completion_rate === null ? "—" : `${agent.stats.completion_rate}%`}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Errors 30d</dt>
            <dd className={cx("font-semibold tabular-nums", agent.stats.error_count_30d > 0 && "text-bad")}>{agent.stats.error_count_30d}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Last verified</dt>
            <dd className="font-semibold" title={agent.last_confirmed_execution_at}>{fmtRelative(agent.last_confirmed_execution_at)}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Authority</dt>
            <dd className="pt-1">
              <AuthorityPips level={agent.authority_level} />
            </dd>
          </div>
        </dl>
      ) : (
        <div className="flex items-center justify-between gap-2 border-t border-creme-2 px-4 py-3 text-xs">
          <span className="text-ink-3">No verified executions yet</span>
          <AuthorityPips level={agent.authority_level} />
        </div>
      )}
      <div className="rounded-b-xl bg-creme-2/60 px-4 py-1.5 text-[11px] text-ink-3">{AUTONOMY_INFO[agent.autonomy].label} · {agent.priority} priority</div>
    </button>
  );
}
