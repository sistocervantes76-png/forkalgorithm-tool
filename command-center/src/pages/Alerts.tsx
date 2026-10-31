import { useState } from "react";
import { api, fmtDate, useApi, withDemo } from "../api";
import { Badge, Button, DemoBadge, Empty, ErrorNote, Input, Loading, PageHeader, Tabs, useAction, useApp } from "../components/ui";

type Tab = "alerts" | "audit";

export default function Alerts() {
  const { can } = useApp();
  const [tab, setTab] = useState<Tab>("alerts");
  return (
    <>
      <PageHeader title="Alerts & audit log" subtitle="Security issues, critical failures and approval requests raise alerts immediately. Every state change is written to the audit log." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "alerts", label: "System alerts" }, ...(can("admin") ? [{ id: "audit" as Tab, label: "Audit log" }] : [])]} />
      {tab === "alerts" ? <AlertList /> : <AuditLog />}
    </>
  );
}

function AlertList() {
  const { demo, can } = useApp();
  const [openOnly, setOpenOnly] = useState(true);
  const list = useApi(withDemo(`/api/alerts${openOnly ? "?open=1" : ""}`, demo), [demo]);
  const { busy, run } = useAction();
  return (
    <>
      <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> Unacknowledged only</label>
      <ErrorNote error={list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.alerts.length === 0 ? (
        <Empty title="No alerts" />
      ) : (
        <ul className="space-y-2">
          {list.data.alerts.map((a: any) => (
            <li key={a.id} className={`flex flex-wrap items-start gap-3 rounded-xl border bg-white/80 p-3 ${a.acknowledged_at ? "border-creme-3 opacity-70" : a.severity === "critical" ? "border-bad/40" : "border-creme-3"}`}>
              <Badge tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}>{a.severity === "critical" ? "▲" : a.severity === "warning" ? "!" : "i"} {a.severity}</Badge>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{a.title} <Badge>{a.category}</Badge> <DemoBadge show={a.is_demo} /></div>
                {a.body && <p className="mt-0.5 text-xs text-ink-2">{a.body}</p>}
                <p className="mt-0.5 text-[11px] text-ink-3">{fmtDate(a.created_at)}{a.task_id ? ` · ${a.task_id}` : ""}{a.acknowledged_at ? ` · acknowledged ${fmtDate(a.acknowledged_at)}` : ""}</p>
              </div>
              {!a.acknowledged_at && can("operator") && <Button size="sm" disabled={busy} onClick={() => run(() => api("POST", `/api/alerts/${a.id}/ack`, {}), "Acknowledged").then(list.reload)}>Acknowledge</Button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AuditLog() {
  const [q, setQ] = useState("");
  const list = useApi(`/api/audit${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  return (
    <>
      <Input className="mb-3 max-w-sm" placeholder="Search action, entity or actor" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
      <ErrorNote error={list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.entries.length === 0 ? (
        <Empty title="No entries" />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-creme-3 bg-white/80">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="bg-creme-2/70 text-left text-ink-3">
              <tr><th className="px-3 py-2 font-medium">Time</th><th className="px-3 py-2 font-medium">Actor</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Entity</th><th className="px-3 py-2 font-medium">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-creme-2 font-mono">
              {list.data.entries.map((e: any) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-ink-3">{fmtDate(e.ts)}</td>
                  <td className="px-3 py-1.5">{e.actor}</td>
                  <td className="px-3 py-1.5 font-semibold">{e.action}</td>
                  <td className="px-3 py-1.5">{e.entity_type}{e.entity_id ? `:${e.entity_id}` : ""}</td>
                  <td className="max-w-md truncate px-3 py-1.5 text-ink-3" title={e.details}>{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
