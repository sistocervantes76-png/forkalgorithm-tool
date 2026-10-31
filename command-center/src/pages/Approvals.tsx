import { useState } from "react";
import { api, fmtDate, useApi, withDemo } from "../api";
import { Badge, Button, DemoBadge, Empty, ErrorNote, Loading, PageHeader, Tabs, Textarea, useAction, useApp } from "../components/ui";

type Filter = "open" | "approved" | "rejected";

export default function Approvals() {
  const { demo, can, navigate } = useApp();
  const [filter, setFilter] = useState<Filter>("open");
  const list = useApi(withDemo(`/api/approvals?status=${filter}`, demo), [demo]);

  return (
    <>
      <PageHeader
        title="CEO decision queue"
        subtitle="Outbound campaigns, financial actions, access changes and supervised tasks stop here until you decide. Every decision is recorded in the audit log."
      />
      <Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ id: "open", label: "Pending & on hold" }, { id: "approved", label: "Approved" }, { id: "rejected", label: "Rejected" }]} />
      <ErrorNote error={list.error} />
      {!can("owner") && <p className="mb-3 text-sm text-ink-3">Only the owner can decide approvals. You can review them here.</p>}
      {!list.data ? (
        <Loading />
      ) : list.data.approvals.length === 0 ? (
        <Empty title={filter === "open" ? "Nothing needs your decision" : "No records"} />
      ) : (
        <ul className="space-y-3">
          {list.data.approvals.map((a: any) => (
            <ApprovalCard key={a.id} a={a} onDone={list.reload} canDecide={can("owner") && !a.is_demo} openTask={() => navigate(`/tasks?open=${a.task_id}`)} />
          ))}
        </ul>
      )}
    </>
  );
}

function ApprovalCard({ a, onDone, canDecide, openTask }: { a: any; onDone: () => void; canDecide: boolean; openTask: () => void }) {
  const [note, setNote] = useState("");
  const { busy, run } = useAction();
  const decide = (decision: string) => run(() => api("POST", `/api/approvals/${a.id}/decision`, { decision, note: note || undefined }), `Marked ${decision}`).then(onDone);
  const risk = a.risk_level === "high" || a.risk_level === "critical" ? "bad" : a.risk_level === "medium" ? "warn" : "neutral";
  return (
    <li className="rounded-xl border border-creme-3 bg-white/80 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{a.title}</h3>
            <DemoBadge show={a.is_demo} />
          </div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-3">
            <span className="font-mono">{a.id}</span>
            <Badge tone={risk}>{a.risk_level} risk</Badge>
            <Badge>{a.category.replace("_", " ")}</Badge>
            {a.status === "held" && <Badge tone="tan">On hold</Badge>}
            {a.status === "approved" && <Badge tone="ok">Approved</Badge>}
            {a.status === "rejected" && <Badge tone="bad">Rejected</Badge>}
            <span>Requested {fmtDate(a.created_at)} by {a.agent_name ?? a.requested_by ?? "—"}</span>
          </div>
        </div>
        {a.task_id && <Button size="sm" variant="ghost" onClick={openTask}>Open task →</Button>}
      </div>
      {a.description && <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-creme-2/60 p-3 font-sans text-sm text-ink-2">{a.description}</pre>}
      {a.decided_at && <p className="mt-2 text-xs text-ink-3">Decided {fmtDate(a.decided_at)}{a.decision_note ? ` — “${a.decision_note}”` : ""}</p>}
      {canDecide && (a.status === "pending" || a.status === "held") && (
        <div className="mt-3 space-y-2">
          <Textarea rows={2} className="min-h-0" placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy} onClick={() => decide("approved")}>Approve</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide("rejected")}>Reject</Button>
            {a.status !== "held" && <Button disabled={busy} onClick={() => decide("held")}>Hold</Button>}
          </div>
        </div>
      )}
    </li>
  );
}
