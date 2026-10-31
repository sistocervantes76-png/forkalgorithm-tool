import { fmtDate, fmtRelative, useApi, withDemo } from "../api";
import { Badge, BarChart, Card, DemoBadge, Empty, ErrorNote, Loading, PageHeader, useApp } from "../components/ui";

export default function Workflows() {
  const { demo } = useApp();
  const w = useApi(withDemo("/api/workflows", demo), [demo]);
  if (!w.data) return w.error ? <ErrorNote error={w.error} /> : <Loading />;

  // Runs per day for the last 14 days (single series).
  const days: { label: string; value: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
    days.push({ label: d.slice(5), value: w.data.runs.filter((r: any) => r.created_at.slice(0, 10) === d).length });
  }
  const failures = w.data.runs.filter((r: any) => r.status === "failed");

  return (
    <>
      <PageHeader title="Workflow performance" subtitle="Automation runs reported by Make.com through the signed inbound webhook. Forge monitors failures; each failure raises an alert." />
      {!w.data.inbound_configured && (
        <div className="mb-4 rounded-lg border border-creme-3 bg-white/80 px-4 py-3 text-sm">
          <Badge>○ Disconnected</Badge> <span className="ml-2">Set <code className="rounded bg-creme-2 px-1">MAKE_WEBHOOK_SECRET</code> and add an HTTP module to each Make.com scenario that posts run results to <code className="rounded bg-creme-2 px-1">/api/webhooks/make</code>. See DEPLOYMENT.md.</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Runs per day (14 days)" className="lg:col-span-2">
          {w.data.runs.length ? <BarChart data={days} label="Workflow runs per day" /> : <Empty title="No runs reported yet" />}
        </Card>
        <Card title="Recent failures">
          {failures.length ? (
            <ul className="space-y-2 text-sm">
              {failures.slice(0, 6).map((r: any) => (
                <li key={r.id}>
                  <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{r.workflow}</span><DemoBadge show={r.is_demo} /></div>
                  <div className="text-xs text-bad">{r.error ?? "No error detail"}</div>
                  <div className="text-[11px] text-ink-3">{fmtRelative(r.created_at)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No failures" />
          )}
        </Card>
        <Card title="By workflow (30 days)" className="lg:col-span-3">
          {w.data.summary.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-ink-3"><tr><th className="pb-2 font-medium">Workflow</th><th className="pb-2 text-right font-medium">Runs</th><th className="pb-2 text-right font-medium">Success rate</th><th className="pb-2 text-right font-medium">Avg duration</th><th className="pb-2 text-right font-medium">Last run</th></tr></thead>
                <tbody className="divide-y divide-creme-2">
                  {w.data.summary.map((s: any) => (
                    <tr key={s.workflow}>
                      <td className="py-2"><span className="flex items-center gap-2">{s.workflow} <DemoBadge show={s.is_demo} /></span></td>
                      <td className="py-2 text-right tabular-nums">{s.total}</td>
                      <td className={`py-2 text-right tabular-nums ${s.failed ? "text-warn" : "text-ok"}`}>{Math.round((s.completed / s.total) * 100)}%</td>
                      <td className="py-2 text-right tabular-nums">{s.avg_ms ? `${(s.avg_ms / 1000).toFixed(1)}s` : "—"}</td>
                      <td className="py-2 text-right text-xs text-ink-3">{fmtDate(s.last_run)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No workflows reporting" />
          )}
        </Card>
      </div>
    </>
  );
}
