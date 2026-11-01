import { useState } from "react";
import { ACTION_TYPES } from "../../shared/domain";
import { api, fmtDate, fmtMoney, useApi, withDemo } from "../api";
import { Badge, Button, DemoBadge, Empty, ErrorNote, Loading, PageHeader, Tabs, Textarea, useAction, useApp } from "../components/ui";

type Filter = "open" | "approved" | "rejected" | "invalidated";

export default function Approvals() {
  const { demo, can, navigate } = useApp();
  const [filter, setFilter] = useState<Filter>("open");
  const list = useApi(withDemo(`/api/approvals?status=${filter}`, demo), [demo]);

  return (
    <>
      <PageHeader
        title="CEO approvals"
        subtitle="Each approval covers one exact action: what happens, where it goes, the exact content and any amount. If any of that changes afterwards, the approval is void and you decide again. Every decision is in the audit log."
      />
      <Tabs<Filter> value={filter} onChange={setFilter} tabs={[{ id: "open", label: "Pending & on hold" }, { id: "approved", label: "Approved" }, { id: "rejected", label: "Rejected" }, { id: "invalidated", label: "Invalidated" }]} />
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
  const [confirmOutbound, setConfirmOutbound] = useState(false);
  const { busy, run } = useAction();
  const outbound = a.category === "outbound_campaign" && (a.stage === "release" || ["send_message", "outbound_campaign"].includes(a.action_type));
  const decide = (decision: string) =>
    run(() => api("POST", `/api/approvals/${a.id}/decision`, { decision, note: note || undefined, explicit_outbound: outbound && decision === "approved" ? confirmOutbound : undefined }), `Marked ${decision}`).then(onDone);
  const actionLabel = ACTION_TYPES.find((t) => t.key === a.action_type)?.label;
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
            <Badge tone={a.stage === "release" ? "info" : "neutral"}>{a.stage === "release" ? "Release (outbound)" : "Execution"}</Badge>
            {a.status === "invalidated" && <Badge tone="bad">Invalidated</Badge>}
            {a.status === "held" && <Badge tone="tan">On hold</Badge>}
            {a.status === "approved" && <Badge tone="ok">Approved</Badge>}
            {a.status === "rejected" && <Badge tone="bad">Rejected</Badge>}
            <span>Requested {fmtDate(a.created_at)} by {a.agent_name ?? a.requested_by ?? "—"}</span>
          </div>
        </div>
        {a.task_id && <Button size="sm" variant="ghost" onClick={openTask}>Open task →</Button>}
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-2 rounded-lg border border-creme-3 bg-creme/60 p-3 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-xs text-ink-3">Exact action</dt>
        <dd>{actionLabel ?? <span className="text-ink-3">Run the task as described (no outbound action)</span>}</dd>
        {a.destination && (<><dt className="text-xs text-ink-3">Destination</dt><dd className="break-words font-medium">{a.destination}</dd></>)}
        {a.amount_cents != null && (<><dt className="text-xs text-ink-3">Amount</dt><dd className="font-semibold">{fmtMoney(a.amount_cents, a.currency ?? "usd")}</dd></>)}
        {a.action_content && (<><dt className="text-xs text-ink-3">Exact content</dt><dd><pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-white p-2 font-sans text-sm text-ink">{a.action_content}</pre></dd></>)}
        <dt className="text-xs text-ink-3">Fingerprint</dt>
        <dd className="font-mono text-[11px] text-ink-3" title={a.fingerprint ?? ""}>{a.fingerprint ? `${a.fingerprint.slice(0, 16)}…` : "none (legacy record)"}</dd>
      </dl>
      {a.description && <pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-creme-2/60 p-3 font-sans text-sm text-ink-2">{a.description}</pre>}
      {a.status === "invalidated" && <p className="mt-2 text-xs text-bad">Invalidated {fmtDate(a.invalidated_at)}: {a.invalidated_reason}</p>}
      {a.decided_at && <p className="mt-2 text-xs text-ink-3">Decided {fmtDate(a.decided_at)}{a.decision_note ? ` — “${a.decision_note}”` : ""}</p>}
      {canDecide && (a.status === "pending" || a.status === "held") && (
        <div className="mt-3 space-y-2">
          <Textarea rows={2} className="min-h-0" placeholder="Decision note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
          {outbound && (
            <label className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
              <input type="checkbox" className="mt-1" checked={confirmOutbound} onChange={(e) => setConfirmOutbound(e.target.checked)} />
              <span>I authorize this outbound campaign to <strong>{a.destination ?? "the destination above"}</strong> with exactly the content shown.</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" disabled={busy || (outbound && !confirmOutbound)} onClick={() => decide("approved")}>Approve this exact action</Button>
            <Button variant="danger" disabled={busy} onClick={() => decide("rejected")}>Reject</Button>
            {a.status !== "held" && <Button disabled={busy} onClick={() => decide("held")}>Hold</Button>}
          </div>
        </div>
      )}
    </li>
  );
}
