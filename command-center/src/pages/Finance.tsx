import { fmtDate, fmtMoney, fmtRelative, useApi } from "../api";
import { Badge, BarChart, Card, Empty, ErrorNote, Loading, PageHeader, Stat, useApp } from "../components/ui";

const LIMIT_LABELS: Record<string, string> = {
  "limit.monthly_ai_spend_usd": "Monthly AI spend limit (USD)",
  "limit.outbound_messages_per_day": "Outbound messages per day",
  "limit.max_transaction_usd": "Max single transaction (USD)",
};

export default function Finance() {
  const { navigate } = useApp();
  const f = useApi("/api/finance");
  if (!f.data) return f.error ? <ErrorNote error={f.error} /> : <Loading />;
  const s = f.data.summary;

  return (
    <>
      <PageHeader title="Financial overview" subtitle="Ledger reads figures from connected sources only. Every number is labelled with its source. No agent can move money." />
      {!f.data.connected ? (
        <Card title="Stripe" action={<Badge>○ Disconnected</Badge>}>
          <Empty title="No financial data connected">{f.data.reason}. Add a restricted, read-only Stripe key as the STRIPE_SECRET_KEY secret to see balance and charge totals.</Empty>
        </Card>
      ) : (
        <>
          <div className="mb-2 text-xs text-ink-3">Source: Stripe {s.livemode ? "live" : <strong className="text-warn">test</strong>} mode · fetched {fmtRelative(s.fetched_at)}</div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Object.entries(s.available as Record<string, number>).map(([cur, v]) => <Stat key={`a-${cur}`} label={`Available (${cur.toUpperCase()})`} value={fmtMoney(v, cur)} />)}
            {Object.entries(s.pending as Record<string, number>).map(([cur, v]) => <Stat key={`p-${cur}`} label={`Pending (${cur.toUpperCase()})`} value={fmtMoney(v, cur)} />)}
            {Object.entries(s.last_30_days.gross_cents_by_currency as Record<string, number>).map(([cur, v]) => <Stat key={`g-${cur}`} label="Gross charges, 30 days" value={fmtMoney(v, cur)} sub={`${s.last_30_days.succeeded_count} succeeded · ${s.last_30_days.failed_count} failed`} />)}
          </div>
          <Card className="mt-4" title="Successful charges per day (30 days)" subtitle={s.last_30_days.truncated ? "Showing the most recent 100 charges only" : undefined}>
            {Object.keys(s.last_30_days.by_day).length ? (
              <BarChart
                label="Successful charge volume per day"
                format={(v) => fmtMoney(v)}
                data={Array.from({ length: 30 }, (_, i) => {
                  const d = new Date(Date.now() - (29 - i) * 86400_000).toISOString().slice(0, 10);
                  return { label: d.slice(5), value: s.last_30_days.by_day[d] ?? 0 };
                })}
              />
            ) : (
              <Empty title="No successful charges in the last 30 days" />
            )}
          </Card>
        </>
      )}
      <Card className="mt-4" title="Founder-set limits" subtitle="Protected settings. Only the owner can change them, and feedback never does." action={<button className="text-xs text-emerald-700 underline" onClick={() => navigate("/settings")}>Edit in Settings</button>}>
        <ul className="divide-y divide-creme-2 text-sm">
          {f.data.limits.map((l: any) => (
            <li key={l.key} className="flex justify-between py-2">
              <span>{LIMIT_LABELS[l.key] ?? l.key}</span>
              <span className="tabular-nums">{l.value === "0" ? <span className="text-ink-3">0 (none allowed)</span> : l.value} <span className="ml-2 text-xs text-ink-3">{fmtDate(l.updated_at, false)}</span></span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
