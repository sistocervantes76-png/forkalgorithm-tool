import { useState } from "react";
import { ACTION_TYPES, AUDIENCES, CONTENT_LANES, FEEDBACK_VERDICTS, PRIORITIES, TASK_STATUSES, TASK_STATUS_LABELS, type TaskStatus } from "../../shared/domain";
import { api, fmtDate, fmtMoney, newIdempotencyKey, useApi, withDemo } from "../api";
import { Icon } from "../components/icons";
import type { Agent } from "../components/Nameplate";
import { Badge, Button, Card, DemoBadge, Drawer, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, StatusPill, Textarea, cx, useAction, useApp } from "../components/ui";

const KINDS = [
  ["general", "General"],
  ["draft", "Draft"],
  ["research", "Research"],
  ["report", "Report"],
  ["outreach", "Outreach (always needs approval)"],
  ["publication", "Publication (always needs approval)"],
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
  const [content, setContent] = useState<ContentFields>(EMPTY_CONTENT);
  const [action, setAction] = useState<ActionFields>(EMPTY_ACTION);
  const selected = agents.find((a) => a.id === f.agent_id);
  const isEcho = selected?.slug === "echo";
  return (
    <Drawer open onClose={onClose} title="New task">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await run(() =>
            api<{ task: { id: string; status: string }; duplicate: boolean }>("POST", "/api/tasks", {
              ...f,
              ...contentPayload(content),
              ...actionPayload(action),
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
        {(isEcho || content.content_lane) && <ContentFieldsEditor value={content} onChange={setContent} required={isEcho} />}
        <details className="rounded-lg border border-creme-3 bg-white/60 p-3">
          <summary className="cursor-pointer text-sm font-medium">Outbound action (optional)</summary>
          <p className="mb-2 mt-1 text-xs text-ink-3">If this work should end in something leaving the building (a message, post, record update, payment or access change), name it exactly. Any later change voids the approval.</p>
          <ActionFieldsEditor value={action} onChange={setAction} />
        </details>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.requires_approval} onChange={(e) => setF({ ...f, requires_approval: e.target.checked })} /> Require my approval before it runs</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.propose_only} onChange={(e) => setF({ ...f, propose_only: e.target.checked })} /> Save as a proposal only</label>
        {selected && (
          <p className="rounded-lg bg-creme-2 px-3 py-2 text-xs text-ink-2">
            {selected.name} runs under <strong>{selected.autonomy.replace("_", " ")}</strong>.{" "}
            {selected.autonomy === "observer" ? "Observers cannot execute; this will be kept as a proposal." : selected.autonomy === "supervised" ? "This task will wait for your approval." : ""}{" "}
            {selected.readiness && !selected.readiness.ready ? `${selected.readiness.summary}. The task will wait in the queue.` : ""}
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
  const [editing, setEditing] = useState(false);
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

          {editing ? (
            <EditTask task={t} onDone={() => (setEditing(false), d.reload())} />
          ) : (
            <>
              {t.description && <Card title="Instructions"><p className="whitespace-pre-wrap text-sm">{t.description}</p></Card>}
              {(t.content_lane || t.action_type) && (
                <Card title="Lane and exact action">
                  <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                    {t.content_lane && (<><dt className="text-xs text-ink-3">Content lane</dt><dd>{CONTENT_LANES.find((l) => l.key === t.content_lane)?.label}</dd></>)}
                    {t.audience && (<><dt className="text-xs text-ink-3">Audience</dt><dd>{AUDIENCES.find((x) => x.key === t.audience)?.label}</dd></>)}
                    {t.evidence_ref && (<><dt className="text-xs text-ink-3">Evidence</dt><dd className="font-mono text-xs">{t.evidence_ref}</dd></>)}
                    {t.action_type && (<><dt className="text-xs text-ink-3">Action</dt><dd>{ACTION_TYPES.find((x) => x.key === t.action_type)?.label}</dd></>)}
                    {t.destination && (<><dt className="text-xs text-ink-3">Destination</dt><dd className="break-words">{t.destination}</dd></>)}
                    {t.amount_cents != null && (<><dt className="text-xs text-ink-3">Amount</dt><dd>{fmtMoney(t.amount_cents, t.currency ?? "usd")}</dd></>)}
                    {t.action_content && (<><dt className="text-xs text-ink-3">Exact content</dt><dd><pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans">{t.action_content}</pre></dd></>)}
                  </dl>
                </Card>
              )}
            </>
          )}

          {d.data.approvals?.length > 0 && (
            <Card title="Approval history">
              <ul className="divide-y divide-creme-2 text-sm">
                {d.data.approvals.map((a: any) => (
                  <li key={a.id} className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{a.id}</span>
                      <Badge>{a.stage}</Badge>
                      <Badge tone={a.status === "approved" ? "ok" : a.status === "rejected" || a.status === "invalidated" ? "bad" : "warn"}>{a.status}</Badge>
                    </div>
                    {a.decided_at && <div className="mt-1 text-xs text-ink-3">Decided {fmtDate(a.decided_at)}{a.decision_note ? ` — “${a.decision_note}”` : ""}</div>}
                    {a.status === "invalidated" && <div className="mt-1 text-xs text-bad">{a.invalidated_reason}</div>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {t.result && <Card title="Result"><pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm">{t.result}</pre></Card>}
          {t.error && <Card title="Last error"><p className="text-sm text-bad">{t.error}</p></Card>}

          {d.data.attempts?.length > 0 && (
            <Card title="Execution attempts" subtitle="Failures are kept; a retry adds a new attempt">
              <ol className="space-y-1 text-xs">
                {d.data.attempts.map((x: any) => (
                  <li key={x.attempt} className="flex flex-wrap gap-x-2">
                    <span className="font-semibold">#{x.attempt}</span>
                    <Badge tone={x.outcome === "completed" ? "ok" : x.outcome === "running" ? "emerald" : "bad"}>{x.outcome.replace("_", " ")}</Badge>
                    <span className="text-ink-3">{x.executor} · {fmtDate(x.started_at)} → {fmtDate(x.finished_at)}</span>
                    {x.error && <span className="w-full text-bad">{x.error}</span>}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {t.status === "completed" && !t.is_demo && op && <ReleasePanel task={t} release={d.data.release} dispatches={d.data.dispatches} onDone={d.reload} />}

          {!t.is_demo && <FeedbackPanel taskId={t.id} feedback={d.data.feedback ?? []} onDone={d.reload} />}

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
                {t.status === "failed" && <Button variant="primary" disabled={busy} onClick={() => act("retry", {}, "Retry scheduled (one more attempt)")}>Retry once</Button>}
                {["proposed", "awaiting_approval", "scheduled", "paused", "failed"].includes(t.status) && (
                  <Button variant="danger" disabled={busy} onClick={() => confirm("Cancel this task?") && act("transition", { to: "cancelled" }, "Cancelled")}>Cancel</Button>
                )}
                {!["running", "cancelled"].includes(t.status) && !editing && <Button disabled={busy} onClick={() => setEditing(true)}>Edit</Button>}
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

// ---------------------------------------------------------------- shared editors

interface ContentFields { content_lane: string; audience: string; evidence_ref: string }
const EMPTY_CONTENT: ContentFields = { content_lane: "", audience: "", evidence_ref: "" };
const contentPayload = (c: ContentFields) => ({ content_lane: c.content_lane || undefined, audience: c.audience || undefined, evidence_ref: c.evidence_ref || undefined });

interface ActionFields { action_type: string; destination: string; action_content: string; amount: string; currency: string }
const EMPTY_ACTION: ActionFields = { action_type: "", destination: "", action_content: "", amount: "", currency: "usd" };
function actionPayload(a: ActionFields) {
  if (!a.action_type) return {};
  return {
    action_type: a.action_type,
    destination: a.destination || undefined,
    action_content: a.action_content || undefined,
    amount_cents: a.amount ? Math.round(Number(a.amount) * 100) : undefined,
    currency: a.amount ? a.currency : undefined,
  };
}

function ContentFieldsEditor({ value, onChange, required }: { value: ContentFields; onChange: (v: ContentFields) => void; required?: boolean }) {
  const lane = CONTENT_LANES.find((l) => l.key === value.content_lane);
  return (
    <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/50 p-3">
      <p className="text-xs text-ink-2">Echo content uses exactly one lane and one audience. Food-world examples go to the culinary audience; trade-service examples go to Fork Algorithm business content. Never both in one post.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={`Content lane${required ? "" : " (optional)"}`} hint={lane?.detail}>
          <Select required={required} value={value.content_lane} onChange={(e) => onChange({ ...value, content_lane: e.target.value })}>
            <option value="">Choose…</option>
            {CONTENT_LANES.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </Select>
        </Field>
        <Field label="Audience">
          <Select required={required} value={value.audience} onChange={(e) => onChange({ ...value, audience: e.target.value })}>
            <option value="">Choose…</option>
            {AUDIENCES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </Select>
        </Field>
      </div>
      {value.content_lane === "verified_proof" && (
        <Field label="Evidence task ID" hint="A completed, real (non-demo) task that shows the result. Proof is never invented.">
          <Input required placeholder="TSK-20261101-XXXXXX" value={value.evidence_ref} onChange={(e) => onChange({ ...value, evidence_ref: e.target.value.trim() })} />
        </Field>
      )}
    </div>
  );
}

function ActionFieldsEditor({ value, onChange, outboundOnly }: { value: ActionFields; onChange: (v: ActionFields) => void; outboundOnly?: boolean }) {
  const def = ACTION_TYPES.find((t) => t.key === value.action_type);
  const needs = (def?.needs ?? []) as readonly string[];
  return (
    <div className="space-y-3">
      <Field label="Action">
        <Select value={value.action_type} onChange={(e) => onChange({ ...value, action_type: e.target.value })}>
          <option value="">{outboundOnly ? "Choose…" : "None"}</option>
          {ACTION_TYPES.filter((t) => !outboundOnly || t.external).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
      </Field>
      {def && def.external && (
        <>
          <Field label="Destination" hint="Recipient, list, page, account or system, exactly.">
            <Input required={needs.includes("destination")} maxLength={500} value={value.destination} onChange={(e) => onChange({ ...value, destination: e.target.value })} />
          </Field>
          <Field label="Exact content">
            <Textarea rows={4} required={needs.includes("action_content") && !outboundOnly} maxLength={20000} value={value.action_content} placeholder={outboundOnly ? "Leave empty to use the task result" : ""} onChange={(e) => onChange({ ...value, action_content: e.target.value })} />
          </Field>
          {(needs.includes("amount_cents") || value.amount) && (
            <div className="grid grid-cols-[1fr_6rem] gap-2">
              <Field label="Amount"><Input type="number" min="0" step="0.01" required={needs.includes("amount_cents")} value={value.amount} onChange={(e) => onChange({ ...value, amount: e.target.value })} /></Field>
              <Field label="Currency"><Input maxLength={3} value={value.currency} onChange={(e) => onChange({ ...value, currency: e.target.value })} /></Field>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EditTask({ task, onDone }: { task: any; onDone: () => void }) {
  const { busy, run } = useAction();
  const completed = task.status === "completed";
  const [f, setF] = useState({ title: task.title, description: task.description ?? "", priority: task.priority });
  const [content, setContent] = useState<ContentFields>({ content_lane: task.content_lane ?? "", audience: task.audience ?? "", evidence_ref: task.evidence_ref ?? "" });
  const [action, setAction] = useState<ActionFields>({
    action_type: task.action_type ?? "",
    destination: task.destination ?? "",
    action_content: task.action_content ?? "",
    amount: task.amount_cents != null ? String(task.amount_cents / 100) : "",
    currency: task.currency ?? "usd",
  });
  return (
    <Card title="Edit task">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const body: Record<string, unknown> = completed
            ? { ...actionPayload(action) }
            : { ...f, ...contentPayload(content), ...actionPayload(action) };
          if (!action.action_type) Object.assign(body, { action_type: null, destination: null, action_content: null, amount_cents: null });
          const r = await run(() => api<{ invalidated: string[] }>("PATCH", `/api/tasks/${task.id}`, body));
          if (r) onDone();
        }}
      >
        <p className="rounded-lg bg-warn/10 px-3 py-2 text-xs text-warn">
          Changing the instructions, assignee, content lane or exact action voids any approval for this task. You will be asked to approve the new version.
        </p>
        {!completed && (
          <>
            <Field label="Title"><Input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Instructions"><Textarea rows={4} maxLength={8000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
            <Field label="Priority (does not affect approvals)">
              <Select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</Select>
            </Field>
            {(task.agent_id === "agt-echo" || content.content_lane) && <ContentFieldsEditor value={content} onChange={setContent} required={task.agent_id === "agt-echo"} />}
          </>
        )}
        <ActionFieldsEditor value={action} onChange={setAction} />
        <div className="flex gap-2">
          <Button variant="primary" disabled={busy}>Save</Button>
          <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}

function ReleasePanel({ task, release, dispatches, onDone }: { task: any; release: { ready: boolean; reason?: string; approval_id?: string } | null; dispatches: any[]; onDone: () => void }) {
  const { can } = useApp();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<ActionFields>({ ...EMPTY_ACTION, action_type: task.action_type ?? "", destination: task.destination ?? "" });
  const make = dispatches.find((x) => x.target === "make");
  return (
    <Card title="Release (outbound action)" subtitle="Nothing leaves the Command Center without a release approval for the exact content">
      {make && (
        <p className="mb-2 text-sm">
          Make.com dispatch: <Badge tone={make.status === "sent" ? "ok" : make.status === "failed" ? "bad" : "warn"}>{make.status}</Badge>
          <span className="ml-2 text-xs text-ink-3">{make.attempts} attempt(s){make.last_error ? ` · last error: ${make.last_error}` : ""}</span>
        </p>
      )}
      {release?.ready ? (
        <p className="text-sm text-ok">Release approved ({release.approval_id}). Content, destination and amount still match.</p>
      ) : (
        <p className="text-sm text-ink-3">{release?.reason ?? "No release requested."}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!make?.status || make.status !== "sent" ? <Button size="sm" onClick={() => setOpen(!open)}>{open ? "Close" : "Request release approval"}</Button> : null}
        {release?.ready && can("owner") && (!make || make.status === "failed") && (
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => confirm("Send this exact approved action to Make.com?") && run(() => api("POST", `/api/tasks/${task.id}/dispatch`, { retry: make?.status === "failed" }), "Dispatched to Make.com").then(onDone)}
          >
            {make?.status === "failed" ? "Retry dispatch" : "Dispatch to Make.com"}
          </Button>
        )}
      </div>
      {open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => api("POST", `/api/tasks/${task.id}/release`, actionPayload(action)), "Release approval requested");
            if (r) (setOpen(false), onDone());
          }}
        >
          <ActionFieldsEditor value={action} onChange={setAction} outboundOnly />
          <Button variant="primary" disabled={busy || !action.action_type}>Request approval</Button>
        </form>
      )}
    </Card>
  );
}

const VERDICT_LABEL: Record<string, string> = { like: "Like", dislike: "Dislike", modify: "Modify", hold: "Hold" };

function FeedbackPanel({ taskId, feedback, onDone }: { taskId: string; feedback: any[]; onDone: () => void }) {
  const { can } = useApp();
  const { busy, run } = useAction();
  const [note, setNote] = useState("");
  return (
    <Card title="Founder feedback" subtitle="Shapes planning preferences only. It never changes access, authority or limits, and Hold does not pause the task.">
      {can("owner") && (
        <div className="space-y-2">
          <Input placeholder="Note (required for Modify)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_VERDICTS.map((v) => (
              <Button key={v} size="sm" disabled={busy || (v === "modify" && !note)} onClick={() => run(() => api("POST", `/api/tasks/${taskId}/feedback`, { verdict: v, note: note || undefined }), `${VERDICT_LABEL[v]} recorded`).then(() => (setNote(""), onDone()))}>
                {VERDICT_LABEL[v]}
              </Button>
            ))}
          </div>
        </div>
      )}
      {feedback.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs">
          {feedback.map((f) => (
            <li key={f.id}><Badge tone={f.verdict === "like" ? "ok" : f.verdict === "dislike" ? "bad" : f.verdict === "hold" ? "tan" : "warn"}>{VERDICT_LABEL[f.verdict]}</Badge> <span className="text-ink-3">{fmtDate(f.created_at)}</span> {f.note}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-3">No feedback yet.</p>
      )}
    </Card>
  );
}
