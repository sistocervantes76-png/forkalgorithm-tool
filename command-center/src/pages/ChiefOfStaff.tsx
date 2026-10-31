import { useState } from "react";
import { api, fmtDate, fmtMoney, fmtRelative, useApi, withDemo } from "../api";
import { AgentAvatar, ConnectionBadge, type Agent } from "../components/Nameplate";
import { Badge, Button, Card, DemoBadge, Empty, ErrorNote, Field, Input, Loading, PageHeader, Textarea, useAction, useApp } from "../components/ui";

const VERDICTS = [
  { v: "like", label: "Like", glyph: "👍" },
  { v: "dislike", label: "Dislike", glyph: "👎" },
  { v: "modify", label: "Modify", glyph: "✎" },
  { v: "hold", label: "Hold", glyph: "⏸" },
] as const;

const REC_STATUS: Record<string, [string, any]> = {
  open: ["Open", "info"],
  liked: ["Liked", "ok"],
  disliked: ["Disliked", "bad"],
  modify_requested: ["Modify requested", "warn"],
  held: ["On hold", "tan"],
  actioned: ["Actioned", "ok"],
};

export default function ChiefOfStaff() {
  const { demo, navigate, can } = useApp();
  const cos = useApi(withDemo("/api/chief-of-staff", demo), [demo]);
  const atlas = useApi<{ agent: Agent }>("/api/agents/agt-atlas");
  const briefings = useApi("/api/briefings");
  const gen = useAction();

  if (!cos.data) return cos.error ? <ErrorNote error={cos.error} /> : <Loading />;
  const d = cos.data;
  const a = atlas.data?.agent;

  return (
    <>
      <PageHeader
        title="Chief of Staff"
        subtitle="Atlas coordinates the department agents through backend jobs and authorized tools, and reports to you. One CEO summary is produced every Friday; security issues, critical failures and approval requests alert you immediately."
        actions={
          can("admin") && (
            <Button variant="primary" disabled={gen.busy} onClick={() => gen.run(() => api<{ id: string }>("POST", "/api/briefings/generate", {}), "Briefing generated").then((r) => r && navigate(`/briefings?open=${r.id}`))}>
              Generate briefing now
            </Button>
          )
        }
      />

      {a && (
        <div className="mb-4 flex flex-wrap items-center gap-4 rounded-xl bg-charcoal p-4 text-creme">
          <AgentAvatar agent={a} size={52} />
          <div className="min-w-0 flex-1">
            <div className="font-display text-xl">{a.name}</div>
            <div className="text-sm text-creme/70">Chief of Staff · reports to the founder · {a.autonomy.replace("_", " ")}</div>
          </div>
          <ConnectionBadge connection={a.connection} />
          <Button size="sm" onClick={() => navigate("/agents?open=agt-atlas")}>Configure Atlas</Button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Departmental assignments" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-3">
                <tr><th className="pb-2 font-medium">Department</th><th className="pb-2 font-medium">Agent</th><th className="pb-2 text-right font-medium">Open</th><th className="pb-2 text-right font-medium">Done</th><th className="pb-2 text-right font-medium">Failed</th></tr>
              </thead>
              <tbody className="divide-y divide-creme-2">
                {d.departments.map((r: any) => (
                  <tr key={r.agent_id} className="cursor-pointer hover:bg-creme-2/40" onClick={() => navigate(`/tasks?agent=${r.agent_id}`)}>
                    <td className="py-2 text-ink-2">{r.department ?? "—"}</td>
                    <td className="py-2 font-medium">{r.agent}</td>
                    <td className="py-2 text-right tabular-nums">{r.open ?? 0}</td>
                    <td className="py-2 text-right tabular-nums text-ok">{r.completed ?? 0}</td>
                    <td className="py-2 text-right tabular-nums text-bad">{r.failed ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Outstanding approvals" action={<Button size="sm" variant="ghost" onClick={() => navigate("/approvals")}>Decide →</Button>}>
          {d.approvals.length ? (
            <ul className="space-y-2 text-sm">
              {d.approvals.map((x: any) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{x.title}</span>
                  <DemoBadge show={x.is_demo} />
                  {x.status === "held" && <Badge tone="tan">Hold</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="None outstanding" />
          )}
        </Card>

        <Card title="Completed work">
          <TaskList rows={d.completed} empty="No completed tasks yet" onOpen={(id) => navigate(`/tasks?open=${id}`)} />
        </Card>
        <Card title="Failed work">
          <TaskList rows={d.failed} empty="No failures" onOpen={(id) => navigate(`/tasks?open=${id}`)} showError />
        </Card>
        <Card title="Workflow incidents" action={<Button size="sm" variant="ghost" onClick={() => navigate("/alerts")}>Alerts →</Button>}>
          {d.incidents.length ? (
            <ul className="space-y-2 text-sm">
              {d.incidents.map((i: any) => (
                <li key={i.id}>
                  <div className="flex items-center gap-2">
                    <Badge tone={i.severity === "critical" ? "bad" : "warn"}>{i.severity}</Badge>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <DemoBadge show={i.is_demo} />
                  </div>
                  <div className="text-xs text-ink-3">{fmtRelative(i.created_at)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No open incidents" />
          )}
        </Card>

        <Card title="Active opportunities" action={<Button size="sm" variant="ghost" onClick={() => navigate("/intel")}>Pipeline →</Button>}>
          {d.opportunities.length ? (
            <ul className="space-y-2 text-sm">
              {d.opportunities.map((o: any) => (
                <li key={o.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{o.business_name}</span>
                  <DemoBadge show={o.is_demo} />
                  <Badge>{o.outreach_status}</Badge>
                  {o.deal_value_cents ? <span className="text-xs tabular-nums">{fmtMoney(o.deal_value_cents)}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No replied, meeting or qualified prospects" />
          )}
        </Card>

        <Card title="Briefing history" action={<Button size="sm" variant="ghost" onClick={() => navigate("/briefings")}>All →</Button>}>
          {briefings.data?.briefings.length ? (
            <ul className="space-y-1.5 text-sm">
              {briefings.data.briefings.slice(0, 5).map((b: any) => (
                <li key={b.id}>
                  <button className="text-left hover:underline" onClick={() => navigate(`/briefings?open=${b.id}`)}>
                    Week of {fmtDate(b.week_of, false)} <span className="text-xs text-ink-3">· {b.trigger_kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No briefings yet">The first one is generated on Friday, or click “Generate briefing now”.</Empty>
          )}
        </Card>

        <Recommendations className="lg:col-span-2" recs={d.recommendations} reload={cos.reload} />
        <Card title="Founder feedback history">
          {d.feedback.length ? (
            <ul className="space-y-2 text-sm">
              {d.feedback.map((f: any) => (
                <li key={f.id}>
                  <div className="flex items-center gap-2">
                    <Badge tone={f.verdict === "like" ? "ok" : f.verdict === "dislike" ? "bad" : f.verdict === "modify" ? "warn" : "tan"}>{f.verdict}</Badge>
                    <span className="min-w-0 flex-1 truncate">{f.recommendation_title}</span>
                  </div>
                  {f.note && <p className="mt-0.5 text-xs text-ink-2">“{f.note}”</p>}
                  <div className="text-[11px] text-ink-3">{fmtDate(f.created_at)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No feedback yet" />
          )}
          <p className="mt-3 text-[11px] text-ink-3">Feedback updates planning preferences only. It never changes financial limits, legal permissions or system access.</p>
        </Card>
      </div>
    </>
  );
}

function TaskList({ rows, empty, onOpen, showError }: { rows: any[]; empty: string; onOpen: (id: string) => void; showError?: boolean }) {
  if (!rows.length) return <Empty title={empty} />;
  return (
    <ul className="space-y-2 text-sm">
      {rows.map((t) => (
        <li key={t.id}>
          <button className="w-full text-left hover:underline" onClick={() => onOpen(t.id)}>
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <DemoBadge show={t.is_demo} />
            </span>
          </button>
          <div className="truncate text-xs text-ink-3">{t.agent_name} · {fmtRelative(t.completed_at)}{showError && t.error ? ` · ${t.error}` : ""}</div>
        </li>
      ))}
    </ul>
  );
}

function Recommendations({ recs, reload, className }: { recs: any[]; reload: () => void; className?: string }) {
  const { can } = useApp();
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: "", body: "" });
  const add = useAction();
  return (
    <Card title="Weekly strategic recommendations" className={className} action={can("operator") && <Button size="sm" onClick={() => setAdding((x) => !x)}>{adding ? "Cancel" : "Add"}</Button>}>
      {adding && (
        <form
          className="mb-4 space-y-2 rounded-lg bg-creme-2/60 p-3"
          onSubmit={(e) => (e.preventDefault(), add.run(() => api("POST", "/api/recommendations", f), "Recommendation added").then(() => (setAdding(false), setF({ title: "", body: "" }), reload())))}
        >
          <Field label="Title"><Input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Recommendation"><Textarea required maxLength={8000} rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
          <Button variant="primary" disabled={add.busy}>Save</Button>
        </form>
      )}
      {recs.length ? (
        <ul className="space-y-3">
          {recs.map((r) => (
            <RecItem key={r.id} r={r} reload={reload} />
          ))}
        </ul>
      ) : (
        <Empty title="No recommendations recorded">Recommendations come from Atlas (via a configured worker) or can be added manually.</Empty>
      )}
    </Card>
  );
}

function RecItem({ r, reload }: { r: any; reload: () => void }) {
  const { can } = useApp();
  const [mode, setMode] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { busy, run } = useAction();
  const [label, tone] = REC_STATUS[r.status] ?? [r.status, "neutral"];
  const send = (verdict: string) => run(() => api("POST", `/api/recommendations/${r.id}/feedback`, { verdict, note: note || undefined }), "Feedback recorded").then(() => (setMode(null), setNote(""), reload()));
  return (
    <li className="rounded-lg border border-creme-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 font-medium">{r.title}</span>
        <DemoBadge show={r.is_demo} />
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">{r.body}</p>
      <div className="mt-1 text-[11px] text-ink-3">Week of {fmtDate(r.week_of, false)} · source: {r.source}</div>
      {can("owner") && !r.is_demo && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {VERDICTS.map((v) => (
            <Button key={v.v} size="sm" disabled={busy} variant={mode === v.v ? "primary" : "secondary"} onClick={() => (v.v === "modify" || v.v === "hold" ? setMode(mode === v.v ? null : v.v) : send(v.v))}>
              <span aria-hidden="true">{v.glyph}</span> {v.label}
            </Button>
          ))}
        </div>
      )}
      {mode && (
        <form className="mt-2 flex gap-2" onSubmit={(e) => (e.preventDefault(), send(mode))}>
          <Input autoFocus required={mode === "modify"} placeholder={mode === "modify" ? "What should change?" : "Reason (optional)"} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          <Button variant="primary" disabled={busy}>Send</Button>
        </form>
      )}
    </li>
  );
}
