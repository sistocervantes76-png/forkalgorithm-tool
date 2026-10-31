import { useEffect, useState } from "react";
import { AI_MODELS, AUTONOMY_INFO, AUTONOMY_LEVELS, CAPABILITIES, PRIORITIES, PROVIDERS, type Autonomy } from "../../shared/domain";
import { api, fmtDate, fmtRelative, useApi, withDemo } from "../api";
import { AGENT_ICONS, Icon } from "../components/icons";
import { ACCENTS, AgentAvatar, AuthorityPips, ConnectionBadge, Nameplate, type Agent } from "../components/Nameplate";
import { Badge, Button, Card, DemoBadge, Drawer, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, StatusPill, Tabs, Textarea, cx, useAction, useApp } from "../components/ui";

export default function Agents() {
  const { demo, can } = useApp();
  const list = useApi<{ agents: Agent[] }>(withDemo("/api/agents", demo), [demo]);
  const depts = useApi<{ departments: { id: string; name: string }[] }>("/api/departments");
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("open"));
  const [creating, setCreating] = useState(false);
  const deptName = (id: string | null) => depts.data?.departments.find((d) => d.id === id)?.name;

  const atlas = list.data?.agents.find((a) => !a.reports_to);
  const team = list.data?.agents.filter((a) => a.reports_to) ?? [];

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Profiles describe each agent's role, authority and permissions. A profile does not run by itself: execution needs a configured backend (the in-Worker Anthropic executor or an external worker)."
        actions={can("admin") && <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New agent</Button>}
      />
      <ErrorNote error={list.error} />
      {!list.data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-2 flex items-center gap-2 text-xs text-ink-3">
            <span className="rounded bg-charcoal px-2 py-0.5 text-creme">Founder</span>
            <span aria-hidden="true">→</span>
            <span>Chief of Staff</span>
            <span aria-hidden="true">→</span>
            <span>Department agents</span>
          </div>
          {atlas && (
            <div className="mb-4 max-w-xl">
              <Nameplate agent={atlas} department={deptName(atlas.department_id)} onOpen={() => setOpenId(atlas.id)} />
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {team.map((a) => (
              <Nameplate key={a.id} agent={a} department={deptName(a.department_id)} onOpen={() => setOpenId(a.id)} />
            ))}
          </div>
        </>
      )}
      {openId && <AgentPanel id={openId} departments={depts.data?.departments ?? []} onClose={() => (setOpenId(null), list.reload(), window.history.replaceState({}, "", "/agents"))} />}
      {creating && <NewAgent departments={depts.data?.departments ?? []} onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), list.reload(), depts.reload(), setOpenId(id))} />}
    </>
  );
}

type TabId = "settings" | "nameplate" | "brain" | "schedule" | "history" | "lifecycle";

function AgentPanel({ id, departments, onClose }: { id: string; departments: { id: string; name: string }[]; onClose: () => void }) {
  const { demo } = useApp();
  const detail = useApi(withDemo(`/api/agents/${id}`, demo), [demo]);
  const [tab, setTab] = useState<TabId>("settings");
  const a: Agent | undefined = detail.data?.agent;

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={
        a ? (
          <span className="flex items-center gap-3">
            <AgentAvatar agent={a} size={32} />
            <span>
              {a.name} <span className="text-sm font-normal text-ink-3">· {a.role_title}</span>
            </span>
          </span>
        ) : (
          "Agent"
        )
      }
    >
      {!a ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <ConnectionBadge connection={a.connection} />
            <Badge>{AUTONOMY_INFO[a.autonomy].label}</Badge>
            <Badge tone="tan">Authority <AuthorityPips level={a.authority_level} /></Badge>
            <span className="text-xs text-ink-3">Last confirmed execution: {a.last_confirmed_execution_at ? fmtDate(a.last_confirmed_execution_at) : "never"}</span>
          </div>
          <Tabs<TabId>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "settings", label: "Command panel" },
              { id: "nameplate", label: "Nameplate & role" },
              { id: "brain", label: "Model & prompt" },
              { id: "schedule", label: "Schedule" },
              { id: "history", label: "History & logs" },
              { id: "lifecycle", label: "Pause / replace" },
            ]}
          />
          {tab === "settings" && <CommandPanel agent={a} detail={detail.data} reload={detail.reload} />}
          {tab === "nameplate" && <NameplateForm agent={a} departments={departments} reload={detail.reload} />}
          {tab === "brain" && <BrainForm agent={a} executor={detail.data.executor} reload={detail.reload} />}
          {tab === "schedule" && <ScheduleForm agent={a} reload={detail.reload} />}
          {tab === "history" && <History detail={detail.data} />}
          {tab === "lifecycle" && <Lifecycle agent={a} reload={detail.reload} onReplaced={onClose} />}
        </>
      )}
    </Drawer>
  );
}

function useSave(agentId: string, reload: () => void) {
  const { busy, run } = useAction();
  return { busy, save: (patch: Record<string, unknown>, msg = "Saved") => run(() => api("PATCH", `/api/agents/${agentId}`, patch), msg).then(reload) };
}

// ---------------------------------------------------------------- command panel (game-style)

const AUTONOMY_ICON: Record<Autonomy, string> = { observer: "search", draft_only: "briefing", supervised: "approval", preapproved_routine: "rocket" };
const SKILL_LABEL: Record<string, string> = { research: "Research", draft: "Drafting", report: "Reporting", outreach: "Outreach", general: "General work", financial: "Financial", access: "Access" };

function CommandPanel({ agent, detail, reload }: { agent: Agent; detail: any; reload: () => void }) {
  const { can } = useApp();
  const { busy, save } = useSave(agent.id, reload);
  const capAction = useAction();
  const setCap = (capability: string, patch: { requested?: boolean; granted?: boolean }) =>
    capAction.run(() => api("PUT", `/api/agents/${agent.id}/capabilities`, { capability, ...patch })).then(reload);
  const readOnly = !can("admin");

  return (
    <div className="space-y-5">
      <section className="rounded-xl bg-charcoal p-4 text-creme">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-tan">Autonomy</h3>
          <span className="text-[11px] text-creme/60">Outbound, financial and access actions always require approval</span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {AUTONOMY_LEVELS.map((lvl, i) => (
            <button
              key={lvl}
              disabled={busy || readOnly}
              onClick={() => save({ autonomy: lvl }, `Autonomy set to ${AUTONOMY_INFO[lvl].label}`)}
              aria-pressed={agent.autonomy === lvl}
              className={cx(
                "rounded-lg border p-3 text-left transition disabled:cursor-not-allowed",
                agent.autonomy === lvl ? "border-tan bg-emerald-800" : "border-charcoal-3 bg-charcoal-2 hover:border-creme/30",
              )}
            >
              <div className="flex items-center justify-between">
                <Icon name={AUTONOMY_ICON[lvl]} size={18} />
                <span className="text-[10px] text-creme/50">Tier {i + 1}</span>
              </div>
              <div className="mt-2 text-sm font-medium">{AUTONOMY_INFO[lvl].label}</div>
              <div className="mt-1 text-[11px] leading-snug text-creme/65">{AUTONOMY_INFO[lvl].detail}</div>
            </button>
          ))}
        </div>

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-tan">Priority</h3>
        <div className="flex overflow-hidden rounded-lg border border-charcoal-3">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              disabled={busy || readOnly}
              onClick={() => save({ priority: p }, `Priority set to ${p}`)}
              aria-pressed={agent.priority === p}
              className={cx("flex-1 px-2 py-2 text-sm capitalize", agent.priority === p ? (p === "critical" ? "bg-bad text-white" : "bg-tan text-charcoal") : "bg-charcoal-2 text-creme/70 hover:text-creme")}
            >
              {p}
            </button>
          ))}
        </div>

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-widest text-tan">Authority level</h3>
        <div className="flex items-center gap-1.5">
          {[0, 1, 2, 3, 4, 5].map((lvl) => (
            <button
              key={lvl}
              disabled={busy || !can("owner")}
              onClick={() => save({ authority_level: lvl }, `Authority set to ${lvl}`)}
              aria-label={`Authority level ${lvl}`}
              aria-pressed={agent.authority_level === lvl}
              className={cx("h-8 flex-1 rounded-md border text-xs font-semibold disabled:cursor-not-allowed", lvl <= agent.authority_level && lvl > 0 ? "border-tan bg-tan text-charcoal" : "border-charcoal-3 bg-charcoal-2 text-creme/50")}
            >
              {lvl}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-creme/55">Owner-only. Authority is a record of trust for planning; it never grants system access on its own.</p>
      </section>

      <section>
        <div className="mb-2 flex items-end justify-between">
          <h3 className="text-sm font-semibold">Capabilities & permissions</h3>
          <span className="text-xs text-ink-3">Active = enabled + owner-authorized + credentials present</span>
        </div>
        <ul className="divide-y divide-creme-2 rounded-xl border border-creme-3 bg-white/80">
          {detail.capabilities.map((c: any) => {
            const meta = CAPABILITIES.find((x) => x.key === c.key)!;
            return (
              <li key={c.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {c.label}
                    {c.effective ? <Badge tone="ok">● Active</Badge> : c.requested ? <Badge tone="warn" title={c.blocked_reason}>◐ Blocked</Badge> : <Badge>Off</Badge>}
                  </div>
                  <div className="text-xs text-ink-3">{c.requested && !c.effective ? c.blocked_reason : meta.note}</div>
                </div>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={c.requested} disabled={capAction.busy || readOnly} onChange={(e) => setCap(c.key, { requested: e.target.checked })} />
                  Enabled
                </label>
                <label className={cx("flex items-center gap-1.5 text-xs", !c.requested && "opacity-40")}>
                  <input type="checkbox" checked={c.granted} disabled={capAction.busy || !can("owner") || !c.requested} onChange={(e) => setCap(c.key, { granted: e.target.checked })} />
                  Owner authorized
                </label>
                <Badge tone={c.integration_ready ? "ok" : "neutral"} title={`Integration: ${c.integration}`}>{c.integration_ready ? "Credentials ✓" : "No credentials"}</Badge>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Skill indicators</h3>
        <p className="mb-2 text-xs text-ink-3">Based only on tasks an executor or worker actually finished. No experience points, no estimates.</p>
        {detail.skills.length ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {detail.skills.map((s: any) => {
              const total = s.completed + s.failed;
              const pct = total ? Math.round((s.completed / total) * 100) : 0;
              return (
                <div key={s.kind} className="rounded-lg border border-creme-3 bg-white/80 p-3">
                  <div className="flex justify-between text-sm"><span className="font-medium">{SKILL_LABEL[s.kind] ?? s.kind}</span><span className="tabular-nums">{pct}%</span></div>
                  <div className="mt-1.5 h-2 rounded-full bg-creme-2"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-1 text-xs text-ink-3">{s.completed} succeeded · {s.failed} failed · last {fmtRelative(s.last_at)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <Empty title="No verified runs yet">Skill indicators appear after this agent finishes real tasks.</Empty>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- forms

function NameplateForm({ agent, departments, reload }: { agent: Agent; departments: { id: string; name: string }[]; reload: () => void }) {
  const { can } = useApp();
  const { busy, save } = useSave(agent.id, reload);
  const [f, setF] = useState({ name: agent.name, role_title: agent.role_title, icon: agent.icon, accent: agent.accent, nameplate_style: agent.nameplate_style, department_id: agent.department_id ?? "", responsibilities: agent.responsibilities.join("\n") });
  const ro = !can("admin");
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save({ ...f, department_id: f.department_id || undefined, responsibilities: f.responsibilities.split("\n").map((s) => s.trim()).filter(Boolean) });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Agent name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={60} disabled={ro} required /></Field>
        <Field label="Role title"><Input value={f.role_title} onChange={(e) => setF({ ...f, role_title: e.target.value })} maxLength={80} disabled={ro} required /></Field>
        <Field label="Department">
          <Select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })} disabled={ro}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Nameplate style">
          <Select value={f.nameplate_style} onChange={(e) => setF({ ...f, nameplate_style: e.target.value })} disabled={ro}>
            <option value="standard">Standard</option>
            <option value="brass">Brass</option>
            <option value="minimal">Minimal</option>
          </Select>
        </Field>
      </div>
      <Field label="Icon">
        <div className="flex flex-wrap gap-2">
          {AGENT_ICONS.map((ic) => (
            <button type="button" key={ic} disabled={ro} onClick={() => setF({ ...f, icon: ic })} aria-label={ic} aria-pressed={f.icon === ic} className={cx("rounded-lg border p-2", f.icon === ic ? "border-emerald-700 bg-emerald-50" : "border-creme-3 bg-white")}>
              <Icon name={ic} />
            </button>
          ))}
        </div>
      </Field>
      <Field label="Accent">
        <div className="flex flex-wrap gap-2">
          {Object.entries(ACCENTS).map(([k, v]) => (
            <button type="button" key={k} disabled={ro} onClick={() => setF({ ...f, accent: k })} aria-label={k} aria-pressed={f.accent === k} className={cx("h-8 w-8 rounded-full ring-offset-2", v.bg, f.accent === k && "ring-2 ring-charcoal")} />
          ))}
        </div>
      </Field>
      <Field label="Responsibilities" hint="One per line"><Textarea value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} disabled={ro} rows={5} /></Field>
      {!ro && <Button variant="primary" disabled={busy}>Save nameplate</Button>}
    </form>
  );
}

function BrainForm({ agent, executor, reload }: { agent: Agent; executor: { in_worker_available: boolean; blocked_reason: string | null }; reload: () => void }) {
  const { can } = useApp();
  const { busy, save } = useSave(agent.id, reload);
  const [f, setF] = useState({ provider: agent.provider, model: agent.model || AI_MODELS[0].id, system_prompt: agent.system_prompt });
  const ro = !can("admin");
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save({ provider: f.provider, model: f.provider === "anthropic" ? f.model : "", system_prompt: f.system_prompt }))}>
      <div className="rounded-lg border border-creme-3 bg-white/80 p-3 text-sm">
        <strong>Execution backend:</strong> {executor.in_worker_available ? <span className="text-ok">In-Worker draft executor is ready.</span> : <span className="text-ink-2">Not runnable here: {executor.blocked_reason}.</span>}
        <p className="mt-1 text-xs text-ink-3">
          "Anthropic" runs tasks inside this Worker and produces drafts only, never sending or publishing anything. "External worker" means a process you host elsewhere that claims tasks through the worker API with WORKER_TOKEN.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Provider">
          <Select value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value })} disabled={ro}>
            {PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Model" hint={f.provider !== "anthropic" ? "Only used with the Anthropic provider" : undefined}>
          <Select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} disabled={ro || f.provider !== "anthropic"}>
            {AI_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="System prompt" hint="Command Center guardrails (drafts only, no fabrication, cite sources) are always appended and cannot be removed here.">
        <Textarea value={f.system_prompt} onChange={(e) => setF({ ...f, system_prompt: e.target.value })} rows={10} className="font-mono text-xs" disabled={ro} maxLength={8000} />
      </Field>
      {!ro && <Button variant="primary" disabled={busy}>Save model & prompt</Button>}
    </form>
  );
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function ScheduleForm({ agent, reload }: { agent: Agent; reload: () => void }) {
  const { can } = useApp();
  const { busy, save } = useSave(agent.id, reload);
  const [s, setS] = useState({ days: agent.schedule.days ?? [], start: agent.schedule.start ?? "08:00", end: agent.schedule.end ?? "18:00", tz: agent.schedule.tz ?? "America/New_York" });
  const ro = !can("admin");
  return (
    <form className="space-y-4" onSubmit={(e) => (e.preventDefault(), save({ schedule: s }, "Schedule saved"))}>
      <p className="text-sm text-ink-3">The in-Worker executor only picks up this agent's scheduled tasks inside these hours. Manual "Run now" ignores the schedule. No days selected means any time.</p>
      <div className="flex flex-wrap gap-2">
        {DAYS.map((d) => (
          <button type="button" key={d} disabled={ro} aria-pressed={s.days.includes(d)} onClick={() => setS({ ...s, days: s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d] })} className={cx("w-12 rounded-lg border py-2 text-sm capitalize", s.days.includes(d) ? "border-emerald-700 bg-emerald-700 text-creme" : "border-creme-3 bg-white")}>
            {d}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Start"><Input type="time" value={s.start} onChange={(e) => setS({ ...s, start: e.target.value })} disabled={ro} /></Field>
        <Field label="End"><Input type="time" value={s.end} onChange={(e) => setS({ ...s, end: e.target.value })} disabled={ro} /></Field>
        <Field label="Time zone"><Input value={s.tz} onChange={(e) => setS({ ...s, tz: e.target.value })} disabled={ro} placeholder="America/New_York" /></Field>
      </div>
      {!ro && <Button variant="primary" disabled={busy}>Save schedule</Button>}
    </form>
  );
}

function History({ detail }: { detail: any }) {
  const { navigate } = useApp();
  return (
    <div className="space-y-5">
      <Card title="Task history">
        {detail.tasks.length ? (
          <ul className="divide-y divide-creme-2">
            {detail.tasks.map((t: any) => (
              <li key={t.id}>
                <button className="flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-creme-2/50" onClick={() => navigate(`/tasks?open=${t.id}`)}>
                  <span className="font-mono text-xs text-ink-3">{t.id}</span>
                  <span className="min-w-0 flex-1 truncate">{t.title}</span>
                  <DemoBadge show={t.is_demo} />
                  <StatusPill status={t.status} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No tasks assigned yet" />
        )}
      </Card>
      <Card title="Recent logs">
        {detail.logs.length ? (
          <ul className="space-y-1 font-mono text-xs">
            {detail.logs.map((l: any) => (
              <li key={l.id} className={cx(l.level === "error" && "text-bad", l.level === "warn" && "text-warn")}>
                <span className="text-ink-3">{fmtDate(l.ts)}</span> [{l.level}] {l.task_id}: {l.message}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="No logs yet" />
        )}
      </Card>
    </div>
  );
}

function Lifecycle({ agent, reload, onReplaced }: { agent: Agent; reload: () => void; onReplaced: () => void }) {
  const { can, toast } = useApp();
  const { busy, save } = useSave(agent.id, reload);
  const [replacement, setReplacement] = useState("");
  const action = useAction();
  return (
    <div className="space-y-4">
      <Card title="Profile state">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !can("admin")} variant={agent.enabled ? "secondary" : "primary"} onClick={() => save({ enabled: !agent.enabled }, agent.enabled ? "Profile disabled" : "Profile enabled")}>
            {agent.enabled ? "Disable profile" : "Enable profile"}
          </Button>
          <Button disabled={busy || !can("admin") || !agent.enabled} onClick={() => save({ paused: !agent.paused }, agent.paused ? "Resumed" : "Paused")}>
            {agent.paused ? "Resume agent" : "Pause agent"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Enabling a profile allows a configured backend to execute its tasks. It does not start a process by itself. Pausing stops new tasks from being picked up; a task that is already running finishes or times out.
        </p>
      </Card>
      {agent.id !== "agt-atlas" && can("owner") && (
        <Card title="Replace agent" subtitle="Archives this profile, creates a replacement in draft-only mode with permissions reset, and reassigns open tasks.">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await action.run(() => api<{ id: string }>("POST", `/api/agents/${agent.id}/replace`, { name: replacement }));
              if (r) {
                toast(`${agent.name} replaced by ${replacement}`);
                onReplaced();
              }
            }}
          >
            <Input className="max-w-xs" placeholder="Replacement name" value={replacement} onChange={(e) => setReplacement(e.target.value)} required maxLength={60} />
            <Button variant="danger" disabled={action.busy}>Replace</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

function NewAgent({ departments, onClose, onCreated }: { departments: { id: string; name: string }[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", role_title: "", department_id: "", new_department: "", icon: "bot" });
  useEffect(() => {
    if (!f.department_id && departments[0]) setF((x) => ({ ...x, department_id: departments[0].id }));
  }, [departments, f.department_id]);
  return (
    <Drawer open onClose={onClose} title="New agent">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(async () => {
            let dept = f.department_id;
            if (dept === "__new") dept = (await api<{ id: string }>("POST", "/api/departments", { name: f.new_department })).id;
            return api<{ id: string }>("POST", "/api/agents", { name: f.name, role_title: f.role_title, department_id: dept, icon: f.icon });
          }, "Agent created (disabled, draft-only)");
          if (r) onCreated(r.id);
        }}
      >
        <Field label="Name"><Input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Role title"><Input required maxLength={80} value={f.role_title} onChange={(e) => setF({ ...f, role_title: e.target.value })} /></Field>
        <Field label="Department">
          <Select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            <option value="__new">+ New department…</option>
          </Select>
        </Field>
        {f.department_id === "__new" && <Field label="New department name"><Input required maxLength={80} value={f.new_department} onChange={(e) => setF({ ...f, new_department: e.target.value })} /></Field>}
        <p className="text-xs text-ink-3">New agents report to the Chief of Staff, start disabled in draft-only mode, and hold no authorized capabilities.</p>
        <Button variant="primary" disabled={busy}>Create agent</Button>
      </form>
    </Drawer>
  );
}
