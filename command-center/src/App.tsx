import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, useApi, withDemo } from "./api";
import { Icon } from "./components/icons";
import { AppContext, Button, Field, Input, cx, useApp, type AppUser } from "./components/ui";
import Overview from "./pages/Overview";
import Agents from "./pages/Agents";
import ChiefOfStaff from "./pages/ChiefOfStaff";
import Tasks from "./pages/Tasks";
import Approvals from "./pages/Approvals";
import Intel from "./pages/Intel";
import Workflows from "./pages/Workflows";
import Finance from "./pages/Finance";
import Briefings from "./pages/Briefings";
import Alerts from "./pages/Alerts";
import Settings from "./pages/Settings";

// First-release workspaces first. "Later phase" pages work from real records
// but are not part of the first-release scope and are kept out of the way.
const NAV = [
  { path: "/", label: "Overview", icon: "dashboard", el: Overview },
  { path: "/approvals", label: "CEO Approvals", icon: "approval", el: Approvals },
  { path: "/tasks", label: "Tasks", icon: "tasks", el: Tasks },
  { path: "/agents", label: "Agents", icon: "agents", el: Agents },
  { path: "/chief-of-staff", label: "Atlas & Feedback", icon: "crown", el: ChiefOfStaff },
  { path: "/briefings", label: "Weekly CEO Review", icon: "briefing", el: Briefings },
  { path: "/alerts", label: "Audit & Alerts", icon: "bell", el: Alerts },
  { path: "/settings", label: "Settings & Integrations", icon: "settings", el: Settings },
  { path: "/intel", label: "Market & Outreach", icon: "radar", el: Intel, later: true },
  { path: "/workflows", label: "Workflows", icon: "flow", el: Workflows, later: true },
  { path: "/finance", label: "Finance", icon: "finance", el: Finance, later: true },
];

const RANK = { viewer: 0, operator: 1, admin: 2, owner: 3 };

function readDemoPref(): boolean {
  try {
    return localStorage.getItem("fa:demo") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [path, setPath] = useState(window.location.pathname);
  const [demo, setDemoState] = useState(readDemoPref);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: "ok" | "error" }[]>([]);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    api<{ user: AppUser }>("GET", "/api/auth/me")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
    const onPop = () => setPath(window.location.pathname);
    const onUnauth = () => setUser(null);
    window.addEventListener("popstate", onPop);
    window.addEventListener("fa:unauthorized", onUnauth);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("fa:unauthorized", onUnauth);
    };
  }, []);

  const navigate = useCallback((p: string) => {
    window.history.pushState({}, "", p);
    setPath(p.split("?")[0]);
    setNavOpen(false);
    window.scrollTo(0, 0);
  }, []);

  const toast = useCallback((msg: string, kind: "ok" | "error" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const setDemo = useCallback((v: boolean) => {
    setDemoState(v);
    try {
      localStorage.setItem("fa:demo", v ? "1" : "0");
    } catch {
      /* storage unavailable: preference is per-session only */
    }
  }, []);

  const ctx = useMemo(
    () => (user ? { user, demo, setDemo, navigate, toast, can: (r: AppUser["role"]) => RANK[user.role] >= RANK[r] } : null),
    [user, demo, setDemo, navigate, toast],
  );

  if (user === undefined) return <div className="flex h-full items-center justify-center text-sm text-ink-3">Loading…</div>;
  if (!user || !ctx) return <Login onLogin={setUser} />;

  const current = NAV.find((n) => n.path === path) ?? NAV[0];
  const Page = current.el;

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex min-h-full">
        <Sidebar path={current.path} navigate={navigate} open={navOpen} onClose={() => setNavOpen(false)} user={user} onLogout={() => api("POST", "/api/auth/logout").finally(() => setUser(null))} />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar onMenu={() => setNavOpen(true)} title={current.label} />
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 lg:px-8">
            {"later" in current && current.later && (
              <div className="mb-4 rounded-lg border border-tan bg-tan-light/40 px-4 py-2.5 text-sm text-tan-dark">
                <strong>Later-phase workspace.</strong> It shows only real records and connected data, but it is outside the first-release scope and has not been reviewed for daily use yet.
              </div>
            )}
            <Page />
          </main>
        </div>
      </div>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx("pointer-events-auto rounded-lg px-4 py-2.5 text-sm shadow-lg", t.kind === "error" ? "bg-bad text-white" : "bg-charcoal text-creme")}>
            {t.msg}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}

function Sidebar({ path, navigate, open, onClose, user, onLogout }: { path: string; navigate: (p: string) => void; open: boolean; onClose: () => void; user: AppUser; onLogout: () => void }) {
  const { data } = useApi<{ approvals_pending: number; alerts_open: Record<string, number> }>("/api/overview", [path]);
  const counts: Record<string, number> = {
    "/approvals": data?.approvals_pending ?? 0,
    "/alerts": (data?.alerts_open?.critical ?? 0) + (data?.alerts_open?.warning ?? 0),
  };
  return (
    <>
      {open && <button className="fixed inset-0 z-30 bg-charcoal/50 lg:hidden" aria-label="Close navigation" onClick={onClose} />}
      <aside className={cx("fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-charcoal text-creme transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-700">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M8 4v6a4 4 0 0 0 8 0V4M12 4v16" />
            </svg>
          </span>
          <div>
            <div className="font-display text-base leading-tight">Fork Algorithm</div>
            <div className="text-[11px] uppercase tracking-widest text-tan">Command Center</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Main">
          {NAV.map((n, i) => (
            <div key={n.path}>
            {n.later && !NAV[i - 1]?.later && <div className="px-3 pb-1 pt-4 text-[10px] uppercase tracking-widest text-tan">Later phase</div>}
            <a
              href={n.path}
              onClick={(e) => {
                e.preventDefault();
                navigate(n.path);
              }}
              aria-current={path === n.path ? "page" : undefined}
              className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm", path === n.path ? "bg-emerald-800 text-creme" : "text-creme/75 hover:bg-charcoal-2 hover:text-creme")}
            >
              <Icon name={n.icon} size={18} />
              <span className="flex-1">{n.label}</span>
              {counts[n.path] ? <span className="rounded-full bg-tan px-1.5 text-[11px] font-semibold text-charcoal">{counts[n.path]}</span> : null}
            </a>
            </div>
          ))}
        </nav>
        <div className="border-t border-charcoal-3 px-4 py-3 text-xs">
          <div className="truncate font-medium">{user.name}</div>
          <div className="truncate text-creme/60">
            {user.email} · {user.role}
          </div>
          <button onClick={onLogout} className="mt-2 inline-flex items-center gap-1.5 text-creme/70 hover:text-creme">
            <Icon name="logout" size={14} /> Sign out
          </button>
        </div>
      </aside>
    </>
  );
}

function TopBar({ onMenu, title }: { onMenu: () => void; title: string }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-creme-3 bg-creme/90 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8">
      <button className="rounded-md p-1.5 text-ink-2 hover:bg-creme-2 lg:hidden" onClick={onMenu} aria-label="Open navigation">
        <Icon name="menu" />
      </button>
      <span className="text-sm font-medium text-ink-2 lg:hidden">{title}</span>
      <div className="ml-auto">
        <DemoToggle />
      </div>
    </header>
  );
}

function DemoToggle() {
  const ctx = useApp();
  const { data } = useApi<{ demo_records: number }>(withDemo("/api/overview", false), [ctx.demo]);
  if (!data?.demo_records && !ctx.demo) return null;
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-full border border-dashed border-tan-dark bg-tan-light/50 px-3 py-1 text-xs text-tan-dark">
      <input type="checkbox" checked={ctx.demo} onChange={(e) => ctx.setDemo(e.target.checked)} className="accent-[var(--color-tan-dark)]" />
      Show demonstration data
    </label>
  );
}


function Login({ onLogin }: { onLogin: (u: AppUser) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: AppUser }>("POST", "/api/auth/login", { email, password });
      onLogin(r.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex min-h-full items-center justify-center bg-charcoal px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-creme p-7 shadow-2xl">
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-widest text-tan-dark">Fork Algorithm</div>
          <h1 className="font-display text-2xl text-ink">Agent Command Center</h1>
          <p className="mt-1 text-sm text-ink-3">Founder access. Approvals, tasks and the weekly review for the business behind the public page.</p>
        </div>
        <div className="space-y-3">
          <Field label="Email">
            <Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-bad">{error}</p>}
          <Button variant="primary" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </div>
      </form>
    </div>
  );
}
