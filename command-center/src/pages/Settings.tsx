import { useState } from "react";
import { api, fmtDate, useApi } from "../api";
import { Badge, Button, Card, ErrorNote, Field, Input, IntegrationPill, Loading, PageHeader, Select, Tabs, useAction, useApp } from "../components/ui";

type Tab = "integrations" | "settings" | "users" | "data";

export default function Settings() {
  const { can } = useApp();
  const [tab, setTab] = useState<Tab>("integrations");
  const tabs: { id: Tab; label: string }[] = [{ id: "integrations", label: "Integrations" }, { id: "settings", label: "Policies & limits" }];
  if (can("owner")) tabs.push({ id: "users", label: "Users & roles" }, { id: "data", label: "Demonstration data" });
  return (
    <>
      <PageHeader title="Settings" subtitle="Credentials live only as Cloudflare Worker secrets. They are never sent to the browser or stored in the database." />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={tabs} />
      {tab === "integrations" && <Integrations />}
      {tab === "settings" && <Policies />}
      {tab === "users" && <Users />}
      {tab === "data" && <DemoData />}
    </>
  );
}

function Integrations() {
  const { can } = useApp();
  const list = useApi("/api/integrations");
  const { busy, run } = useAction();
  if (!list.data) return list.error ? <ErrorNote error={list.error} /> : <Loading />;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {list.data.integrations.map((i: any) => (
        <Card key={i.key} title={i.name} subtitle={i.category} action={<IntegrationPill status={i.status} />}>
          <p className="text-sm text-ink-2">{i.description}</p>
          {i.required_secrets.length > 0 && (
            <p className="mt-2 text-xs text-ink-3">
              Secrets: {i.required_secrets.map((s: string) => <code key={s} className="mr-1 rounded bg-creme-2 px-1">{s}</code>)}
            </p>
          )}
          {i.verified_contact_at && <p className="mt-2 text-xs text-ok">Last verified contact {fmtDate(i.verified_contact_at)}</p>}
          {i.last_test && (
            <p className={`mt-2 text-xs ${i.last_test.ok ? "text-ok" : "text-bad"}`}>
              Last test {fmtDate(i.last_test.at)}: {i.last_test.message}
            </p>
          )}
          {i.testable && can("owner") && (
            <Button className="mt-3" size="sm" disabled={busy || !i.secrets_present} title={!i.secrets_present ? "Set the secrets first" : ""} onClick={() => run(() => api("POST", `/api/integrations/${i.key}/test`, {})).then(list.reload)}>
              Test connection
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

const WEEKDAY_OPTIONS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SETTING_META: Record<string, { label: string; kind: "number" | "bool" | "list" | "readonly" | "day" | "text"; help?: string }> = {
  "briefing.day": { label: "Weekly CEO review day", kind: "day", help: "Default Friday. The review is generated once per week from real records." },
  "briefing.hour_local": { label: "Review hour (local, 0-23)", kind: "number", help: "Hour in the time zone below. Checked every 15 minutes." },
  "briefing.timezone": { label: "Review time zone", kind: "text", help: "IANA name, e.g. America/New_York." },
  "alerts.immediate_categories": { label: "Immediate alert categories", kind: "list", help: "Comma-separated: security, failure, approval, integration, system. Sent to Make.com when connected." },
  "tasks.running_lease_minutes": { label: "Running-task lease (minutes)", kind: "number", help: "A running task with no result after this long is retried or failed." },
  "limit.monthly_ai_spend_usd": { label: "Monthly AI spend limit (USD)", kind: "number", help: "Recorded limit. Enforce it with a spend cap in the Anthropic Console as well." },
  "limit.outbound_messages_per_day": { label: "Outbound messages per day", kind: "number" },
  "limit.max_transaction_usd": { label: "Max single transaction (USD)", kind: "number", help: "Financial approvals above this amount are refused. Approvals and feedback never raise it; only this setting does." },
  "legal.outbound_requires_approval": { label: "Outbound requires approval", kind: "readonly", help: "Always on. Cannot be disabled." },
  "access.allow_external_workers": { label: "Allow external workers", kind: "bool", help: "Lets processes holding WORKER_TOKEN claim tasks via /api/worker/*." },
};

function Policies() {
  const { can } = useApp();
  const list = useApi("/api/settings");
  if (!list.data) return list.error ? <ErrorNote error={list.error} /> : <Loading />;
  return (
    <Card title="Policies & limits" subtitle="Protected settings (limits, legal, access) are owner-only and never changed by founder feedback. Every change is audited.">
      <ul className="divide-y divide-creme-2">
        {list.data.settings.map((s: any) => (
          <SettingRow key={s.key} s={s} editable={(s.protected ? can("owner") : can("admin")) && SETTING_META[s.key]?.kind !== "readonly"} reload={list.reload} />
        ))}
      </ul>
    </Card>
  );
}

function SettingRow({ s, editable, reload }: { s: any; editable: boolean; reload: () => void }) {
  const meta = SETTING_META[s.key] ?? { label: s.key, kind: "readonly" as const };
  const initial = meta.kind === "list" ? (JSON.parse(s.value) as string[]).join(", ") : s.value.replaceAll('"', "");
  const [v, setV] = useState(initial);
  const { busy, run } = useAction();
  const save = () => {
    const value = meta.kind === "number" ? Number(v) : meta.kind === "bool" ? v === "true" : meta.kind === "list" ? v.split(",").map((x: string) => x.trim()).filter(Boolean) : v;
    run(() => api("PUT", `/api/settings/${s.key}`, { value }), "Setting saved").then(reload);
  };
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">{meta.label} {s.protected ? <Badge tone="tan">Protected</Badge> : null}</div>
        {meta.help && <div className="text-xs text-ink-3">{meta.help}</div>}
        <div className="text-[11px] text-ink-3">Updated {fmtDate(s.updated_at)} by {s.updated_by}</div>
      </div>
      {editable ? (
        <div className="flex items-center gap-2">
          {meta.kind === "bool" ? (
            <Select value={v} onChange={(e) => setV(e.target.value)} className="w-28"><option value="false">Off</option><option value="true">On</option></Select>
          ) : meta.kind === "day" ? (
            <Select value={v} onChange={(e) => setV(e.target.value)} className="w-36">{WEEKDAY_OPTIONS.map((d) => <option key={d} value={d}>{d[0].toUpperCase() + d.slice(1)}</option>)}</Select>
          ) : (
            <Input value={v} onChange={(e) => setV(e.target.value)} className={meta.kind === "list" || meta.kind === "text" ? "w-64" : "w-28"} type={meta.kind === "number" ? "number" : "text"} />
          )}
          <Button size="sm" disabled={busy || v === initial} onClick={save}>Save</Button>
        </div>
      ) : (
        <code className="rounded bg-creme-2 px-2 py-1 text-xs">{initial}</code>
      )}
    </li>
  );
}

function Users() {
  const list = useApi("/api/users");
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", email: "", role: "viewer", password: "" });
  if (!list.data) return list.error ? <ErrorNote error={list.error} /> : <Loading />;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <Card title="Users">
        <ul className="divide-y divide-creme-2">
          {list.data.users.map((u: any) => (
            <li key={u.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{u.name} {u.disabled ? <Badge tone="bad">Disabled</Badge> : null}</div>
                <div className="text-xs text-ink-3">{u.email} · last sign-in {fmtDate(u.last_login_at)}</div>
              </div>
              {u.role === "owner" ? (
                <Badge tone="emerald">Owner</Badge>
              ) : (
                <>
                  <Select className="w-32" value={u.role} disabled={busy} onChange={(e) => run(() => api("PATCH", `/api/users/${u.id}`, { role: e.target.value }), "Role updated").then(list.reload)}>
                    <option value="admin">Admin</option>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                  <Button size="sm" variant={u.disabled ? "secondary" : "danger"} disabled={busy} onClick={() => run(() => api("PATCH", `/api/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? "Enabled" : "Disabled and signed out").then(list.reload)}>
                    {u.disabled ? "Enable" : "Disable"}
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-3">Viewer: read-only. Operator: create and run tasks, manage prospects. Admin: agent settings and non-protected policies. Owner: approvals, capability authorization, protected limits, users.</p>
      </Card>
      <Card title="Add user">
        <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), run(() => api("POST", "/api/users", f), "User added").then((r) => r && (setF({ name: "", email: "", role: "viewer", password: "" }), list.reload())))}>
          <Field label="Name"><Input required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="viewer">Viewer</option><option value="operator">Operator</option><option value="admin">Admin</option></Select>
          </Field>
          <Field label="Initial password" hint="At least 12 characters. Share it securely."><Input type="password" required minLength={12} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
          <Button variant="primary" disabled={busy}>Add user</Button>
        </form>
      </Card>
    </div>
  );
}

function DemoData() {
  const { setDemo } = useApp();
  const { busy, run } = useAction();
  return (
    <Card title="Demonstration data" subtitle="For reviewing the interface before real data flows in.">
      <p className="text-sm text-ink-2">
        Loads sample tasks, approvals, prospects, findings and workflow runs. Every record is flagged as demonstration data, uses example.com addresses, shows a DEMO badge, cannot be approved or executed, and is excluded from briefings. It is hidden unless “Show demonstration data” is switched on.
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" disabled={busy} onClick={() => run(() => api("POST", "/api/admin/demo", { action: "load" }), "Demonstration data loaded").then(() => setDemo(true))}>Load demonstration data</Button>
        <Button variant="danger" disabled={busy} onClick={() => run(() => api("POST", "/api/admin/demo", { action: "clear" }), "Demonstration data removed").then(() => setDemo(false))}>Remove all demonstration data</Button>
      </div>
    </Card>
  );
}
