import { useState } from "react";
import { api, fmtDate, useApi } from "../api";
import { Badge, Button, Card, Empty, ErrorNote, HBarList, Loading, PageHeader, useAction, useApp } from "../components/ui";

export default function Briefings() {
  const { can } = useApp();
  const list = useApi("/api/briefings");
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("open"));
  const gen = useAction();
  const current = openId ?? list.data?.briefings[0]?.id ?? null;

  return (
    <>
      <PageHeader
        title="Weekly CEO review"
        subtitle="Atlas reports to you once a week (default Friday; change the day in Settings). Built only from Command Center records, with demonstration data excluded. If Atlas has a verified AI provider, a short narrative is added from those facts only."
        actions={can("admin") && <Button variant="primary" disabled={gen.busy} onClick={() => gen.run(() => api<{ id: string }>("POST", "/api/briefings/generate", {}), "Briefing generated").then((r) => r && (list.reload(), setOpenId(r.id)))}>Generate now</Button>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_1fr]">
        <Card title="History">
          {!list.data ? (
            <Loading />
          ) : list.data.briefings.length === 0 ? (
            <Empty title="No briefings yet" />
          ) : (
            <ul className="space-y-1">
              {list.data.briefings.map((b: any) => (
                <li key={b.id}>
                  <button onClick={() => setOpenId(b.id)} className={`w-full rounded-lg px-2 py-1.5 text-left text-sm ${current === b.id ? "bg-emerald-50 text-emerald-900" : "hover:bg-creme-2"}`}>
                    Week of {fmtDate(b.week_of, false)}
                    <div className="text-[11px] text-ink-3">{fmtDate(b.generated_at)} · {b.trigger_kind}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {current ? <BriefingView id={current} /> : <Empty title="Select or generate a briefing" />}
      </div>
    </>
  );
}

function BriefingView({ id }: { id: string }) {
  const { data, error } = useApi(`/api/briefings/${id}`, [id]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  const b = data.briefing;
  const c = b.content;
  const totals = c.task_status_totals as Record<string, number>;
  return (
    <div className="space-y-4">
      <Card title={`Week of ${fmtDate(b.week_of, false)}`} subtitle={`${c.data_basis} Generated ${fmtDate(b.generated_at)}.`} action={<Badge tone={b.generated_by === "aggregation" ? "neutral" : "emerald"}>{b.generated_by === "aggregation" ? "Records only" : "Records + AI narrative"}</Badge>}>
        {b.narrative ? (
          <div className="whitespace-pre-wrap text-sm leading-relaxed">{b.narrative}</div>
        ) : (
          <p className="text-sm text-ink-3">
            No AI narrative: {c.narrative_error ? `the narrative request failed (${c.narrative_error}).` : "Atlas has no runnable AI provider (needs provider = Anthropic, ANTHROPIC_API_KEY, the profile enabled, and the drafting capability authorized)."} The facts below are complete without it.
          </p>
        )}
      </Card>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Work by agent this week">
          {c.tasks_by_agent.some((r: any) => r.completed || r.failed) ? (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-creme-2">
                {c.tasks_by_agent.map((r: any) => (
                  <tr key={r.agent}><td className="py-1.5">{r.agent}</td><td className="py-1.5 text-right text-ok tabular-nums">{r.completed ?? 0} done</td><td className="py-1.5 text-right text-bad tabular-nums">{r.failed ?? 0} failed</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No tasks finished this week" />
          )}
        </Card>
        <Card title="Task status (all time)">
          {Object.keys(totals).length ? <HBarList rows={Object.entries(totals).map(([k, v]) => ({ label: k.replaceAll("_", " "), value: v }))} /> : <Empty title="No tasks" />}
        </Card>
        <Card title="Needs your decision">
          {c.approvals_outstanding.length ? (
            <ul className="space-y-1 text-sm">{c.approvals_outstanding.map((a: any) => <li key={a.id}>• {a.title} <span className="text-xs text-ink-3">({a.risk_level})</span></li>)}</ul>
          ) : (
            <Empty title="Nothing outstanding" />
          )}
        </Card>
        <Card title="Incidents this week">
          {c.incidents_this_week.length ? (
            <ul className="space-y-1 text-sm">{c.incidents_this_week.map((a: any, i: number) => <li key={i}><Badge tone={a.severity === "critical" ? "bad" : "warn"}>{a.severity}</Badge> {a.title}</li>)}</ul>
          ) : (
            <Empty title="No warnings or critical alerts" />
          )}
        </Card>
        <Card title="Pipeline">
          {c.pipeline_by_status.length ? <HBarList rows={c.pipeline_by_status.map((p: any) => ({ label: p.status.replaceAll("_", " "), value: p.n }))} /> : <Empty title="No prospects" />}
        </Card>
        <Card title="Verified executions & readiness">
          <p className="text-sm">{c.verified_executions_this_week ? <>Verified executions this week: <strong>{c.verified_executions_this_week}</strong></> : (c.verified_executions_note ?? "No verified executions yet")}</p>
          {c.approvals_invalidated_this_week > 0 && <p className="mt-1 text-sm">Approvals voided by later changes: <strong>{c.approvals_invalidated_this_week}</strong></p>}
          {Array.isArray(c.agent_readiness) && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {c.agent_readiness.map((r: any) => <li key={r.agent}><Badge tone={r.ready ? "ok" : "neutral"}>{r.ready ? "Ready" : "Not running"}</Badge> {r.agent} <span className="text-ink-3">{r.ready ? "" : r.summary.replace("Not running: ", "")}</span></li>)}
            </ul>
          )}
        </Card>
        <Card title="Results awaiting your feedback">
          {c.results_awaiting_your_feedback?.length ? (
            <ul className="space-y-1 text-sm">{c.results_awaiting_your_feedback.map((t: any) => <li key={t.id}>• {t.title} <span className="text-xs text-ink-3">({t.agent ?? "unassigned"})</span></li>)}</ul>
          ) : (
            <Empty title="Nothing waiting" />
          )}
        </Card>
        <Card title="Workflows & feedback">
          <p className="text-sm">Workflow runs: <strong>{c.workflow_runs_this_week?.total ?? 0}</strong> ({c.workflow_runs_this_week?.failed ?? 0} failed)</p>
          <p className="mt-1 text-sm">Founder feedback: {c.founder_feedback_this_week.length ? c.founder_feedback_this_week.map((f: any) => `${f.n} ${f.verdict}`).join(", ") : "none"}</p>
          {c.demo_records_excluded > 0 && <p className="mt-2 text-xs text-ink-3">{c.demo_records_excluded} demonstration record(s) excluded.</p>}
        </Card>
      </div>
    </div>
  );
}
