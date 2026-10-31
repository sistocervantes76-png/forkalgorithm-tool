import { useState } from "react";
import { OUTREACH_STATUSES } from "../../shared/domain";
import { api, fmtDate, fmtMoney, useApi, withDemo } from "../api";
import { Icon } from "../components/icons";
import { Badge, Button, Card, DemoBadge, Drawer, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Tabs, Textarea, cx, useAction, useApp } from "../components/ui";

type Tab = "prospects" | "pipeline" | "market";
const label = (s: string) => s.replaceAll("_", " ");

export default function Intel() {
  const [tab, setTab] = useState<Tab>("prospects");
  return (
    <>
      <PageHeader
        title="Market intelligence & outreach"
        subtitle="Research findings and prospects with sources and timestamps. Use approved search providers only, respect site terms, and collect only published business contact channels. No outreach is sent without your explicit approval."
      />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ id: "prospects", label: "Prospects" }, { id: "pipeline", label: "Pipeline" }, { id: "market", label: "Market findings" }]} />
      {tab === "prospects" && <Prospects />}
      {tab === "pipeline" && <Pipeline />}
      {tab === "market" && <Market />}
    </>
  );
}

function scoreTone(s: number | null) {
  if (s === null) return "neutral";
  return s >= 75 ? "ok" : s >= 50 ? "warn" : "neutral";
}

function Prospects() {
  const { demo, can } = useApp();
  const [f, setF] = useState({ industry: "", location: "", problem: "", status: "", min_score: "" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const list = useApi(withDemo(`/api/intel/prospects${qs ? `?${qs}` : ""}`, demo), [demo]);
  const [open, setOpen] = useState<any | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
        <Select value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} aria-label="Industry">
          <option value="">All industries</option>
          {list.data?.industries.map((i: string) => <option key={i}>{i}</option>)}
        </Select>
        <Input placeholder="Location" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} aria-label="Location" />
        <Input placeholder="Problem" value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} aria-label="Problem" />
        <Select value={f.min_score} onChange={(e) => setF({ ...f, min_score: e.target.value })} aria-label="Minimum opportunity score">
          <option value="">Any score</option>
          <option value="75">Score ≥ 75</option>
          <option value="50">Score ≥ 50</option>
          <option value="25">Score ≥ 25</option>
        </Select>
        <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Outreach status">
          <option value="">Any status</option>
          {OUTREACH_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
        {can("operator") && <Button variant="primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Prospect</Button>}
      </div>
      <ErrorNote error={list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.prospects.length === 0 ? (
        <Empty title="No prospects on record">Add prospects from research. Each needs a source URL; Scout can supply them once a research worker is connected.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.data.prospects.map((p: any) => (
            <button key={p.id} onClick={() => setOpen(p)} className="rounded-xl border border-creme-3 bg-white/80 p-4 text-left hover:shadow-sm">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{p.business_name}</div>
                  <div className="text-xs text-ink-3">{p.industry || "—"} · {p.location || "—"}</div>
                </div>
                <DemoBadge show={p.is_demo} />
                <Badge tone={scoreTone(p.qualification_score)} title="Qualification score">{p.qualification_score ?? "—"}</Badge>
              </div>
              {p.problem && <p className="mt-2 text-sm text-ink-2">{p.problem}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={p.outreach_status === "do_not_contact" ? "bad" : p.outreach_status === "awaiting_approval" ? "warn" : "neutral"}>{label(p.outreach_status)}</Badge>
                <span className="text-ink-3">Researched {fmtDate(p.researched_at, false)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && <ProspectDrawer p={open} onClose={() => (setOpen(null), list.reload())} />}
      {adding && <NewProspect onClose={() => setAdding(false)} onCreated={() => (setAdding(false), list.reload())} />}
    </>
  );
}

function ProspectDrawer({ p, onClose }: { p: any; onClose: () => void }) {
  const { can, navigate } = useApp();
  const { busy, run } = useAction();
  const [msg, setMsg] = useState(p.proposed_message ?? "");
  const [notes, setNotes] = useState(p.notes ?? "");
  const [status, setStatus] = useState(p.outreach_status);
  const editable = can("operator") && !p.is_demo;
  const save = (body: object, m: string) => run(() => api("PATCH", `/api/intel/prospects/${p.id}`, body), m);
  const manualStatuses = OUTREACH_STATUSES.filter((s) => s !== "awaiting_approval" && s !== "approved");

  return (
    <Drawer open onClose={onClose} title={<span className="flex items-center gap-2">{p.business_name} <DemoBadge show={p.is_demo} /></span>}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-creme-3 bg-white/80 p-4 text-sm">
          <div><dt className="text-xs text-ink-3">Industry</dt><dd>{p.industry || "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">Location</dt><dd>{p.location || "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">Website</dt><dd className="truncate">{p.website ? <a className="text-emerald-700 underline" href={p.website} target="_blank" rel="noopener noreferrer">{p.website}</a> : "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">Public business contact</dt><dd className="truncate">{p.public_contact || "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">Qualification score</dt><dd>{p.qualification_score ?? "—"}</dd></div>
          <div><dt className="text-xs text-ink-3">Researched</dt><dd>{fmtDate(p.researched_at)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-ink-3">Source</dt><dd className="truncate">{p.source_url ? <a className="text-emerald-700 underline" href={p.source_url} target="_blank" rel="noopener noreferrer">{p.source_url}</a> : "—"}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-ink-3">Problem</dt><dd>{p.problem || "—"}</dd></div>
        </dl>

        <Card title="Proposed outreach message" subtitle="Changing an approved message sends it back to draft.">
          <Textarea rows={6} value={msg} onChange={(e) => setMsg(e.target.value)} disabled={!editable} maxLength={4000} />
          {editable && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy || msg === (p.proposed_message ?? "")} onClick={() => save({ proposed_message: msg, ...(p.outreach_status === "researched" ? { outreach_status: "drafted" } : {}) }, "Message saved")}>Save draft</Button>
              <Button
                variant="primary"
                disabled={busy || !p.proposed_message || ["awaiting_approval", "approved", "do_not_contact"].includes(p.outreach_status)}
                onClick={() => run(() => api("POST", `/api/intel/prospects/${p.id}/request-outreach`, {}), "Sent to the decision queue").then(onClose)}
              >
                Request outreach approval
              </Button>
            </div>
          )}
          {p.approval_id && <button className="mt-2 text-xs text-emerald-700 underline" onClick={() => navigate("/approvals")}>View approval {p.approval_id}</button>}
          <p className="mt-2 text-xs text-ink-3">Sending is not automated yet. After approval, send through your own channel (or an approved Make.com scenario) and mark the prospect contacted. Honor opt-outs and CAN-SPAM/TCPA rules.</p>
        </Card>

        {editable && (
          <Card title="Status & notes">
            <div className="space-y-3">
              <Field label="Outreach status" hint="Approval states are set by the decision queue.">
                <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {(manualStatuses.includes(status) ? manualStatuses : [status, ...manualStatuses]).map((s) => <option key={s} value={s}>{label(s)}</option>)}
                </Select>
              </Field>
              <Field label="Notes"><Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
              <Button disabled={busy} onClick={() => save({ ...(status !== p.outreach_status ? { outreach_status: status } : {}), notes }, "Saved").then((r) => r && onClose())}>Save</Button>
            </div>
          </Card>
        )}
      </div>
    </Drawer>
  );
}

function NewProspect({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ business_name: "", industry: "", location: "", website: "", public_contact: "", problem: "", qualification_score: "", source_url: "", proposed_message: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Drawer open onClose={onClose} title="Add prospect">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
          if (body.qualification_score) body.qualification_score = Number(body.qualification_score) as any;
          run(() => api("POST", "/api/intel/prospects", body), "Prospect added").then((r) => r && onCreated());
        }}
      >
        <Field label="Business name"><Input required maxLength={160} value={f.business_name} onChange={set("business_name")} /></Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Industry"><Input maxLength={80} value={f.industry} onChange={set("industry")} /></Field>
          <Field label="Location"><Input maxLength={120} value={f.location} onChange={set("location")} /></Field>
          <Field label="Website"><Input type="url" value={f.website} onChange={set("website")} placeholder="https://" /></Field>
          <Field label="Published business contact" hint="Business channel only, never personal data"><Input maxLength={200} value={f.public_contact} onChange={set("public_contact")} /></Field>
          <Field label="Qualification score (0–100)"><Input type="number" min={0} max={100} value={f.qualification_score} onChange={set("qualification_score")} /></Field>
          <Field label="Source URL"><Input type="url" required value={f.source_url} onChange={set("source_url")} placeholder="Where this was found" /></Field>
        </div>
        <Field label="Problem observed"><Input maxLength={500} value={f.problem} onChange={set("problem")} /></Field>
        <Field label="Proposed message (optional)"><Textarea rows={4} maxLength={4000} value={f.proposed_message} onChange={set("proposed_message")} /></Field>
        <Button variant="primary" disabled={busy}>Add prospect</Button>
      </form>
    </Drawer>
  );
}

const STAGES = ["contacted", "replied", "meeting", "qualified"] as const;

function Pipeline() {
  const { demo } = useApp();
  const list = useApi(withDemo("/api/intel/prospects", demo), [demo]);
  if (!list.data) return <Loading />;
  const byStage = (s: string) => list.data.prospects.filter((p: any) => p.outreach_status === s);
  const early = list.data.prospects.filter((p: any) => ["researched", "drafted", "awaiting_approval", "approved"].includes(p.outreach_status)).length;
  return (
    <>
      <p className="mb-3 text-sm text-ink-3">{early} prospect(s) in research, draft or approval stages. Meetings and qualified opportunities are tracked below.</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {STAGES.map((s) => {
          const rows = byStage(s);
          const value = rows.reduce((a: number, p: any) => a + (p.deal_value_cents ?? 0), 0);
          return (
            <div key={s} className="rounded-xl border border-creme-3 bg-creme-2/50 p-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold capitalize">{s}</h3>
                <span className="text-xs text-ink-3">{rows.length}{value ? ` · ${fmtMoney(value)}` : ""}</span>
              </div>
              <ul className="space-y-2">
                {rows.length === 0 && <li className="text-xs text-ink-3">Empty</li>}
                {rows.map((p: any) => (
                  <li key={p.id} className="rounded-lg bg-white p-2.5 text-sm shadow-sm">
                    <div className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate font-medium">{p.business_name}</span><DemoBadge show={p.is_demo} /></div>
                    <div className="text-xs text-ink-3">{p.industry} · score {p.qualification_score ?? "—"}</div>
                    {p.meeting_at && <div className="mt-1 text-xs text-emerald-800">Meeting {fmtDate(p.meeting_at)}</div>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Market() {
  const { demo, can } = useApp();
  const [kind, setKind] = useState("");
  const list = useApi(withDemo(`/api/intel/findings${kind ? `?kind=${kind}` : ""}`, demo), [demo]);
  const [adding, setAdding] = useState(false);
  const add = useAction();
  const [f, setF] = useState({ kind: "trend", title: "", summary: "", competitor: "", published_price: "", industry: "", source_url: "" });
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {[["", "All"], ["trend", "Trending offers"], ["competitor", "Competitors"], ["pricing", "Published pricing"]].map(([k, l]) => (
          <button key={k} onClick={() => setKind(k)} className={cx("rounded-full border px-3 py-1 text-xs", kind === k ? "border-emerald-700 bg-emerald-700 text-creme" : "border-creme-3 bg-white")}>{l}</button>
        ))}
        {can("operator") && <Button className="ml-auto" size="sm" onClick={() => setAdding((x) => !x)}>{adding ? "Cancel" : "Add finding"}</Button>}
      </div>
      {adding && (
        <Card className="mb-4" title="New finding">
          <form
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ""));
              add.run(() => api("POST", "/api/intel/findings", body), "Finding saved").then((r) => r && (setAdding(false), list.reload()));
            }}
          >
            <Field label="Type">
              <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                <option value="trend">Trending offer</option>
                <option value="competitor">Competitor</option>
                <option value="pricing">Published pricing</option>
              </Select>
            </Field>
            <Field label="Title"><Input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Competitor"><Input maxLength={120} value={f.competitor} onChange={(e) => setF({ ...f, competitor: e.target.value })} /></Field>
            <Field label="Published price"><Input maxLength={120} value={f.published_price} onChange={(e) => setF({ ...f, published_price: e.target.value })} /></Field>
            <Field label="Industry"><Input maxLength={80} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} /></Field>
            <Field label="Source URL"><Input type="url" required value={f.source_url} onChange={(e) => setF({ ...f, source_url: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Summary"><Textarea rows={3} maxLength={4000} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field></div>
            <div><Button variant="primary" disabled={add.busy}>Save finding</Button></div>
          </form>
        </Card>
      )}
      <ErrorNote error={list.error} />
      {!list.data ? (
        <Loading />
      ) : list.data.findings.length === 0 ? (
        <Empty title="No findings recorded">Findings need a source URL and research timestamp.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-creme-3 bg-white/80">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-creme-2/70 text-left text-xs text-ink-3">
              <tr><th className="px-4 py-2 font-medium">Finding</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Published price</th><th className="px-4 py-2 font-medium">Source</th><th className="px-4 py-2 font-medium">Researched</th></tr>
            </thead>
            <tbody className="divide-y divide-creme-2">
              {list.data.findings.map((x: any) => (
                <tr key={x.id}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 font-medium">{x.title} <DemoBadge show={x.is_demo} /></div>
                    <div className="text-xs text-ink-3">{x.summary}</div>
                  </td>
                  <td className="px-4 py-2.5"><Badge>{x.kind}</Badge></td>
                  <td className="px-4 py-2.5">{x.published_price ?? "—"}</td>
                  <td className="max-w-[12rem] truncate px-4 py-2.5">{x.source_url ? <a className="text-emerald-700 underline" href={x.source_url} target="_blank" rel="noopener noreferrer">{new URL(x.source_url).hostname}</a> : "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-ink-3">{fmtDate(x.researched_at)}<div>{x.agent_name ?? ""}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
