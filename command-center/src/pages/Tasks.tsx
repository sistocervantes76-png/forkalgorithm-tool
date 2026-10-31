import { useState } from "react";
import { PRIORITIES, TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "../../shared/domain";
import { api, fmtDate, newIdempotencyKey, useApi, withDemo } from "../api";
import { Icon } from "../components/icons";
import type { Agent } from "../components/Nameplate";
import { Badge, Button, Card, DemoBadge, Drawer, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, StatusPill, Textarea, cx, useAction, useApp } from "../components/ui";

const KINDS = [
  ["general", "General"],
  ["draft", "Draft"],
  ["research", "Research"],
  ["report", "Report"],
  ["outreach", "Outreach (always needs approval)"],
  ["financial", "Financial (always needs approval)"],
  ["access", "Access change (always needs approval)"],
];

export default function Tasks() {
  const { demo, can } = useApp();
  const params = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState<string>(params.get("status") ?? "");
  const [agent, setAgent] = useState("");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const [creating, setCreating] = useState(params.get("new") === "1");
  const query = new URLSearchParams({ ...(status && { status }), ...(agent && { agent }), ...(q && { q }) }).toString();
  const tasks = useApi(withDemo(`/api/tasks${query ? `?${query}` : ""}`, demo), [demo]);
  const agents = useApi<{ agents: Agent[] }>("/api/agents");

  return (
    <>
      <PageHeader
        title="Task queue"
        subtitle="Every unit of work has an ID, an owner, a status, timestamps, logs and, where required, an approval record."
        actions={can("operator") && <Button variant="primary" onClick={() => setCreating(true)}><Icon name="plus" size={16} /> New task</Button>}
      />
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {["", ...TASK_STATUSES].map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cx("whitespace-nowrap rounded-full border px-3 py-1 text-xs", status === s ? "border-emerald-700 bg-emerald-700 text-creme" : "border-creme-3 bg-white text-ink-2 hover:bg-creme-2")}>
            {s ? TASK_STATUS_LABELS[s as TaskStatus] : "All"}
          </button>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_14rem]">
        <Input placeholder="Search title or task ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tasks" />
        <Select value={agent} onChange={(e) => setAgent(e.target.value)} aria-label="Filter by agent">
          <option value="">All agents</option>
          {agents.data?.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </div>
      <ErrorNote error={tasks.error} />
      {!tasks.data ? (
        <Loading />
      ) : tasks.data.tasks.length === 0 ? (
        <Empty title="No tasks match">Create a task to assign work to an agent.</Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-creme-3 bg-white/80">
          <table className="w-full text-sm">
            <thead className="hidden bg-creme-2/70 text-left text-xs text-ink-3 md:table-header-group">
              <tr>
                <th className="px-4 py-2 font-medium">Task</th>
                <th className="px-4 py-2 font-medium">Agent</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Finished</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-creme-2">
              {tasks.data.tasks.map((t: any) => (
                <tr key={t.id} className="cursor-pointer hover:bg-creme-2/40" onClick={() => setOpenId(t.id)}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium">
                      {t.title} <DemoBadge show={t.is_demo} />
                    </div>
                    <div className="font-mono text-[11px] text-ink-3">{t.id} · {t.kind} · {t.priority}</div>
                    <div className="mt-1 flex flex-wrap gap-2 md:hidden">
                      <StatusPill status={t.status} />
                      <span className="text-xs text-ink-3">{t.agent_name ?? "Unassigned"}</span>
                    </div>
                  </td>
                  <td className="hidden px-4 py-2.5 md:table-cell">{t.agent_name ?? <span className="text-ink-3">Unassigned</span>}</td>
                  <td className="hidden px-4 py-2.5 md:table-cell"><StatusPill status={t.status} /></td>
                  <td className="hidden px-4 py-2.5 text-xs text-ink-3 md:table-cell">{fmtDate(t.started_at)}</td>
                  <td className="hidden px-4 py-2.5 text-xs text-ink-3 md:table-cell">{fmtDate(t.completed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {openId && <TaskDrawer id={openId} onClose={() => (setOpenId(null), tasks.reload(), window.history.replaceState({}, "", "/tasks"))} />}
      {creating && <NewTask agents={agents.data?.agents ?? []} onClose={() => (setCreating(false), window.history.replaceState({}, "", "/tasks"))} onCreated={(id) => (setCreating(false), tasks.reload(), setOpenId(id))} />}
    </>
  );
}

function NewTask({ agents, onClose, onCreated }: { agents: Agent[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { busy, run } = useAction();
  // One key per form instance: double-submits return the same task.
  const [key] = useState(newIdempotencyKey);
  const [f, setF] = useState({ title: "", description: "", agent_id: "", kind: "general", priority: "normal", requires_approval: false, propose_only: false, scheduled_for: "" });
  const selected = agents.find((a) => a.id === f.agent_id);
  return (
    <Drawer open onClose={onClose} title="New task">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() =>
            api<{ task: { id: string; status: string }; duplicate: boolean }>("POST", "/api/tasks", {
              ...f,
              agent_id: f.agent_id || undefined,
              scheduled_for: f.scheduled_for ? new Date(f.scheduled_for).toISOString() : undefined,
              idempotency_key: key,
            }),
          );
          if (r) onCreated(r.task.id);
        }}
      >
        <Field label="Title"><Input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Instructions"><Textarea maxLength={8000} rows={5} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Assign to">
            <Select value={f.agent_id} onChange={(e) => setF({ ...f, agent_id: e.target.value })}>
              <option value="">Unassigned</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {a.role_title}</option>)}
            </Select>
          </Field>
          <Field label="Kind">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Not before (optional)"><Input type="datetime-local" value={f.scheduled_for} onChange={(e) => setF({ ...f, scheduled_for: e.target.value })} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requires_approval} onChange={(e) => setF({ ...f, requires_approval: e.target.checked })} /> Require my approval before it runs</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.propose_only} onChange={(e) => setF({ ...f, propose_only: e.target.checked })} /> Save as a proposal only</label>
        {selected && (
          <p className="rounded-lg bg-creme-2 px-3 py-2 text-xs text-ink-2">
            {selected.name} runs under <strong>{selected.autonomy.replace("_", " ")}</strong>.{" "}
            {selected.autonomy === "observer" ? "Observers cannot execute; this will be kept as a proposal." : selected.autonomy === "supervised" ? "This task will wait for your approval." : ""}{" "}
            {selected.connection.state === "not_configured" || selected.connection.state === "disabled" ? "No execution backend is active, so the task will wait in the queue." : ""}
          </p>
        )}
        <Button variant="primary" disabled={busy}>Create task</Button>
      </form>
    </Drawer>
  );
}

function TaskDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { can } = useApp();
  const d = useApi(`/api/tasks/${id}`);
  const { busy, run } = useAction();
  const [note, setNote] = useState("");
  const t = d.data?.task;
  const act = (path: string, body: object, msg: string) => run(() => api("POST", `/api/tasks/${id}/${path}`, body), msg).then(d.reload);
  const op = can("operator");

  return (
    <Drawer open wide onClose={onClose} title={t ? <span className="flex items-center gap-2">{t.title} <DemoBadge show={t.is_demo} /></span> : "Task"}>
      {!t ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={t.status} />
            <Badge>{t.kind}</Badge>
            <Badge tone={t.priority === "critical" ? "bad" : t.priority === "high" ? "warn" : "neutral"}>{t.priority}</Badge>
            {t.requires_approval ? <Badge tone="warn">Approval required</Badge> : null}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl border border-creme-3 bg-white/80 p-4 text-sm sm:grid-cols-3">
            <Meta k="Task ID" v={<span className="font-mono text-xs">{t.id}</span>} />
            <Meta k="Assigned agent" v={d.data.agent_name ?? "Unassigned"} />
            <Meta k="Source" v={`${t.source} · ${t.created_by ?? "—"}`} />
            <Meta k="Created" v={fmtDate(t.created_at)} />
            <Meta k="Started" v={fmtDate(t.started_at)} />
            <Meta k="Completed" v={fmtDate(t.completed_at)} />
            <Meta k="Attempts" v={`${t.attempts} of ${t.max_attempts}`} />
            <Meta k="Not before" v={fmtDate(t.scheduled_for)} />
            <Meta k="Idempotency key" v={<span className="break-all font-mono text-[11px]">{t.idempotency_key ?? "—"}</span>} />
          </dl>

          {t.description && <Card title="Instructions"><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>}

          {d.data.approval && (
            <Card title="Approval record">
              <div className="text-sm">
                <div className="flex items-center gap-2"><span className="font-mono text-xs">{d.data.approval.id}</span><Badge tone={d.data.approval.status === "approved" ? "ok" : d.data.approval.status === "rejected" ? "bad" : "warn"}>{d.data.approval.status}</Badge></div>
                {d.data.approval.decided_at && <div className="mt-1 text-xs text-ink-3">Decided {fmtDate(d.data.approval.decided_at)}{d.data.approval.decision_note ? ` — “${d.data.approval.decision_note}”` : ""}</div>}
              </div>
            </Card>
          )}

          {t.result && <Card title="Result"><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{t.result}</pre></Card>}
          {t.error && <Card title="Error"><p className="text-sm text-bad">{t.error}</p></Card>}

          {op && !t.is_demo && (
            <Card title="Controls">
              <div className="flex flex-wrap gap-2">
                {t.status === "scheduled" && (
                  <Button variant="primary" disabled={busy || !d.data.can_run_in_worker} title={d.data.run_blocked_reason ?? ""} onClick={() => act("run", {}, "Execution finished")}>
                    Run now (draft)
                  </Button>
                )}
                {t.status === "proposed" && <Button variant="primary" disabled={busy} onClick={() => act("transition", { to: "scheduled" }, "Scheduled")}>Schedule</Button>}
                {t.status === "proposed" && <Button disabled={busy} onClick={() => act("transition", { to: "awaiting_approval" }, "Submitted for approval")}>Submit for approval</Button>}
                {(t.status === "scheduled" || t.status === "running") && <Button disabled={busy} onClick={() => act("transition", { to: "paused" }, "Paused")}>Pause</Button>}
                {t.status === "paused" && <Button disabled={busy} onClick={() => act("transition", { to: "scheduled" }, "Resumed")}>Resume</Button>}
                {t.status === "failed" && <Button variant="primary" disabled={busy} onClick={() => act("retry", {}, "Retry scheduled")}>Retry</Button>}
                {["proposed", "awaiting_approval", "scheduled", "paused", "failed"].includes(t.status) && (
                  <Button variant="danger" disabled={busy} onClick={() => confirm("Cancel this task?") && act("transition", { to: "cancelled" }, "Cancelled")}>Cancel</Button>
                )}
                {t.status === "completed" && d.data.approval?.status === "approved" && can("owner") && (
                  <Button disabled={busy} onClick={() => confirm("Send this approved result to Make.com for action?") && act("dispatch", {}, "Dispatched to Make.com")}>Dispatch to Make.com</Button>
                )}
              </div>
              {t.status === "scheduled" && !d.data.can_run_in_worker && <p className="mt-2 text-xs text-ink-3">Run now unavailable: {d.data.run_blocked_reason}. The task stays queued until a configured worker claims it.</p>}
              {t.status === "running" && <p className="mt-2 text-xs text-ink-3">Running tasks complete when the worker reports back. If the worker goes silent, the lease expires and the task is retried or marked failed automatically.</p>}
            </Card>
          )}

          <Card title="Logs">
            {d.data.logs.length ? (
              <ol className="space-y-1.5 font-mono text-xs">
                {d.data.logs.map((l: any) => (
                  <li key={l.id} className={cx(l.level === "error" && "text-bad", l.level === "warn" && "text-warn")}>
                    <span className="text-ink-3">{fmtDate(l.ts)}</span> <span className="uppercase">[{l.level}]</span> <span className="text-ink-3">{l.actor}</span> — {l.message}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty title="No logs" />
            )}
            {op && !t.is_demo && (
              <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), note && act("notes", { message: note }, "Note added").then(() => setNote("")))}>
                <Input placeholder="Add a note to the log" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
                <Button disabled={busy || !note}>Add</Button>
              </form>
            )}
          </Card>
          <ErrorNote error={d.error} />
        </div>
      )}
    </Drawer>
  );
}

const Meta = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div>
    <dt className="text-xs text-ink-3">{k}</dt>
    <dd>{v}</dd>
  </div>
);
