import { TASK_STATUS_LABELS, type TaskStatus } from "../../shared/domain";
import { fmtDate, fmtRelative, useApi, withDemo } from "../api";
import { AgentAvatar, type Agent } from "../components/Nameplate";
import { Badge, Button, Card, DemoBadge, Empty, ErrorNote, HBarList, IntegrationPill, Loading, PageHeader, Stat, StatusPill, useApp } from "../components/ui";

const STATUS_COLORS: Partial<Record<TaskStatus, string>> = {
  completed: "var(--color-ok)",
  failed: "var(--color-bad)",
  running: "var(--color-emerald-600)",
  awaiting_approval: "var(--color-warn)",
  scheduled: "var(--color-info)",
};

export default function Overview() {
  const { demo, navigate } = useApp();
  const ov = useApi(withDemo("/api/overview", demo), [demo]);
  const agents = useApi<{ agents: Agent[] }>(withDemo("/api/agents", demo), [demo]);
  const activity = useApi(withDemo("/api/activity?limit=15", demo), [demo]);
  const approvals = useApi(withDemo("/api/approvals?status=open", demo), [demo]);
  const alerts = useApi(withDemo("/api/alerts?open=1", demo), [demo]);

  if (ov.loading && !ov.data) return <Loading />;
  if (ov.error) return <ErrorNote error={ov.error} />;
  const o = ov.data;
  const t: Record<string, number> = o.tasks ?? {};
  const totalTasks = Object.values(t).reduce((a, b) => a + b, 0);
  const done = (t.completed ?? 0) + (t.failed ?? 0);
  const connected = o.integrations.filter((i: any) => i.status === "connected").length;

  return (
    <>
      <PageHeader
        title="Operations overview"
        subtitle="The business behind the public page: decisions waiting on you, work in progress, and what has actually run. Every number comes from Command Center records or a verified connection."
        actions={<Button variant="primary" onClick={() => navigate("/tasks?new=1")}>New task</Button>}
      />

      {demo && (
        <div className="mb-4 rounded-lg border border-dashed border-tan-dark bg-tan-light/50 px-4 py-2.5 text-sm text-tan-dark">
          <strong>Demonstration data is visible.</strong> Records marked DEMO are samples for reviewing the interface. They are not operational results.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Agents ready to execute"
          value={agents.data ? `${agents.data.agents.filter((a) => a.readiness?.ready).length} / ${o.agents.total}` : "…"}
          sub={`${o.agents.enabled} profiles enabled. Enabled is not running.`}
        />
        <Stat label="Open tasks" value={(t.scheduled ?? 0) + (t.running ?? 0) + (t.proposed ?? 0) + (t.paused ?? 0)} sub={`${t.running ?? 0} running · ${t.scheduled ?? 0} scheduled`} />
        <Stat label="Awaiting your approval" value={o.approvals_pending} tone={o.approvals_pending ? "warn" : undefined} sub={<button className="underline" onClick={() => navigate("/approvals")}>Open decision queue</button>} />
        <Stat
          label="Open alerts"
          value={(o.alerts_open.critical ?? 0) + (o.alerts_open.warning ?? 0)}
          tone={o.alerts_open.critical ? "bad" : undefined}
          sub={`${o.alerts_open.critical ?? 0} critical · ${o.alerts_open.warning ?? 0} warning`}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card
          className="lg:col-span-2"
          title="Agent directory"
          subtitle="Click a nameplate for the full control panel"
          action={<Button size="sm" variant="ghost" onClick={() => navigate("/agents")}>All agents →</Button>}
        >
          {agents.data ? (
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {agents.data.agents.map((a) => (
                <li key={a.id} className="min-w-0">
                  <button onClick={() => navigate(`/agents?open=${a.id}`)} className="flex w-full items-center gap-3 rounded-lg border border-creme-2 px-3 py-2 text-left hover:bg-creme-2/60">
                    <AgentAvatar agent={a} size={34} />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.name} <span className="font-normal text-ink-3">· {a.role_title}</span></div>
                      <div className="truncate text-xs text-ink-3">{a.current_assignment ? a.current_assignment.title : a.last_confirmed_execution_at ? `Last verified run ${fmtRelative(a.last_confirmed_execution_at)}` : "No verified executions yet"}</div>
                    </div>
                    {a.current_assignment ? <StatusPill status={a.current_assignment.status} /> : <Badge tone={a.readiness?.ready ? "ok" : "neutral"}>{a.readiness?.ready ? "Ready" : "Not running"}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Loading />
          )}
        </Card>

        <Card title="Task queue" subtitle={totalTasks ? `${totalTasks} tasks on record` : undefined} action={<Button size="sm" variant="ghost" onClick={() => navigate("/tasks")}>Queue →</Button>}>
          {totalTasks ? (
            <>
              <HBarList rows={(Object.keys(TASK_STATUS_LABELS) as TaskStatus[]).filter((s) => t[s]).map((s) => ({ label: TASK_STATUS_LABELS[s], value: t[s], tone: STATUS_COLORS[s] ?? "var(--color-tan-dark)" }))} />
              <p className="mt-3 text-xs text-ink-3">
                Completion rate: <strong className="text-ink">{done ? `${Math.round(((t.completed ?? 0) / done) * 100)}%` : "—"}</strong> of finished tasks
              </p>
            </>
          ) : (
            <Empty title="No tasks yet">Create a task and assign it to an agent to start tracking work.</Empty>
          )}
        </Card>

        <Card title="Verified executions" subtitle="Attempts a worker or executor confirmed finished">
          {o.verified_executions ? (
            <div className="text-2xl font-semibold tabular-nums">{o.verified_executions}</div>
          ) : (
            <Empty title="No verified executions yet">Nothing has run through a configured backend. Plans, drafts and demonstration data do not count.</Empty>
          )}
        </Card>

        <Card title="CEO decision queue" action={<Button size="sm" variant="ghost" onClick={() => navigate("/approvals")}>Decide →</Button>}>
          {approvals.data?.approvals.length ? (
            <ul className="divide-y divide-creme-2">
              {approvals.data.approvals.slice(0, 5).map((a: any) => (
                <li key={a.id} className="py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{a.title}</span>
                    <DemoBadge show={a.is_demo} />
                  </div>
                  <div className="mt-0.5 flex gap-2 text-xs text-ink-3">
                    <Badge tone={a.risk_level === "high" || a.risk_level === "critical" ? "bad" : "neutral"}>{a.risk_level} risk</Badge>
                    <span>{a.category.replace("_", " ")}</span>
                    {a.status === "held" && <Badge tone="tan">On hold</Badge>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Nothing awaiting approval" />
          )}
        </Card>

        <Card title="Agent activity" className="lg:col-span-2" action={<Button size="sm" variant="ghost" onClick={() => navigate("/tasks")}>Tasks →</Button>}>
          {activity.data?.items.length ? (
            <ol className="relative space-y-3 border-l border-creme-3 pl-4">
              {activity.data.items.map((i: any, idx: number) => (
                <li key={idx} className="text-sm">
                  <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${i.level === "error" ? "bg-bad" : i.level === "warn" ? "bg-warn" : "bg-emerald-600"}`} aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{i.task_title}</span>
                    <span className="text-xs text-ink-3">{fmtRelative(i.ts)}</span>
                    <DemoBadge show={i.is_demo} />
                  </div>
                  <div className="text-xs text-ink-2 [overflow-wrap:anywhere]">{i.message}</div>
                </li>
              ))}
            </ol>
          ) : (
            <Empty title="No agent activity recorded">Activity appears here when tasks are created, approved, run, or fail.</Empty>
          )}
        </Card>

        <Card title="Weekly CEO review" action={<Button size="sm" variant="ghost" onClick={() => navigate("/briefings")}>Reviews →</Button>}>
          {o.latest_briefing ? (
            <div className="text-sm">
              <div>Week of {fmtDate(o.latest_briefing.week_of, false)}</div>
              <div className="text-xs text-ink-3">Generated {fmtRelative(o.latest_briefing.generated_at)} · {o.latest_briefing.generated_by === "aggregation" ? "records summary" : "records + AI narrative"}</div>
            </div>
          ) : (
            <Empty title="No review yet" />
          )}
          <p className="mt-2 text-xs text-ink-3">
            Next scheduled: {fmtDate(o.next_briefing)} ({o.review_schedule.day[0].toUpperCase() + o.review_schedule.day.slice(1)}, {o.review_schedule.hour}:00 {o.review_schedule.timezone})
          </p>
        </Card>

        <Card title="System alerts" action={<Button size="sm" variant="ghost" onClick={() => navigate("/alerts")}>All →</Button>}>
          {alerts.data?.alerts.length ? (
            <ul className="space-y-2">
              {alerts.data.alerts.slice(0, 5).map((a: any) => (
                <li key={a.id} className="flex items-start gap-2 text-sm">
                  <Badge tone={a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : "info"}>{a.severity}</Badge>
                  <span className="min-w-0 flex-1">{a.title}</span>
                  <DemoBadge show={a.is_demo} />
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No open alerts" />
          )}
        </Card>

        <Card title="Integrations" subtitle={`${connected} of ${o.integrations.length} verified connected`} action={<Button size="sm" variant="ghost" onClick={() => navigate("/settings")}>Manage →</Button>}>
          <ul className="space-y-1.5">
            {o.integrations.map((i: any) => (
              <li key={i.key} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{i.name}</span>
                <IntegrationPill status={i.status} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
