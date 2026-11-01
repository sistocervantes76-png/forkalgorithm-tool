import { createContext, useContext, useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { TASK_STATUS_LABELS, type TaskStatus } from "../../shared/domain";
import { Icon } from "./icons";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- app context

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "operator" | "viewer";
}

interface AppCtx {
  user: AppUser;
  demo: boolean;
  setDemo: (v: boolean) => void;
  navigate: (path: string) => void;
  toast: (msg: string, kind?: "ok" | "error") => void;
  can: (role: AppUser["role"]) => boolean;
}
export const AppContext = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = () => useContext(AppContext);

// ---------------------------------------------------------------- primitives

export function Card({ title, action, children, className, subtitle }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0 rounded-xl border border-creme-3 bg-white/80 shadow-[0_1px_0_rgba(30,35,32,.04)]", className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-creme-2 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({ variant = "secondary", size = "md", className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md" }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-emerald-700 text-creme hover:bg-emerald-800",
        variant === "secondary" && "border border-creme-3 bg-white text-ink hover:bg-creme-2",
        variant === "ghost" && "text-ink-2 hover:bg-creme-2",
        variant === "danger" && "border border-bad/30 bg-white text-bad hover:bg-red-50",
        className,
      )}
      {...rest}
    />
  );
}

const inputCls = "w-full rounded-lg border border-creme-3 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-emerald-600 focus:outline-none";
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(inputCls, p.className)} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={cx(inputCls, "min-h-24", p.className)} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(inputCls, "pr-8", p.className)} />;

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

export function Badge({ children, tone = "neutral", className, title }: { children: ReactNode; tone?: "neutral" | "ok" | "warn" | "bad" | "info" | "emerald" | "tan" | "demo"; className?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
        tone === "neutral" && "bg-creme-2 text-ink-2",
        tone === "ok" && "bg-emerald-50 text-ok",
        tone === "warn" && "bg-amber-50 text-warn",
        tone === "bad" && "bg-red-50 text-bad",
        tone === "info" && "bg-sky-50 text-info",
        tone === "emerald" && "bg-emerald-700 text-creme",
        tone === "tan" && "bg-tan-light text-tan-dark",
        tone === "demo" && "border border-dashed border-tan-dark bg-tan-light/60 uppercase tracking-wide text-tan-dark",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const DemoBadge = ({ show }: { show: boolean | number | null | undefined }) => (show ? <Badge tone="demo" title="Demonstration data — not a real operational result">Demo</Badge> : null);

const STATUS_TONE: Record<TaskStatus, Parameters<typeof Badge>[0]["tone"]> = {
  proposed: "neutral",
  awaiting_approval: "warn",
  scheduled: "info",
  running: "emerald",
  completed: "ok",
  failed: "bad",
  paused: "tan",
  cancelled: "neutral",
};
const STATUS_GLYPH: Record<TaskStatus, string> = { proposed: "○", awaiting_approval: "◐", scheduled: "◷", running: "▶", completed: "✓", failed: "✕", paused: "❚❚", cancelled: "–" };

export function StatusPill({ status }: { status: TaskStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]}>
      <span aria-hidden="true">{STATUS_GLYPH[status]}</span>
      {TASK_STATUS_LABELS[status]}
    </Badge>
  );
}

export function IntegrationPill({ status }: { status: string }) {
  const map: Record<string, [Parameters<typeof Badge>[0]["tone"], string]> = {
    connected: ["ok", "● Connected (verified)"],
    unverified: ["info", "◐ Configured, not verified"],
    disconnected: ["bad", "✕ Disconnected"],
    not_configured: ["neutral", "○ Not configured"],
    demo: ["demo", "Demonstration"],
  };
  const [tone, label] = map[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-creme-3 px-4 py-6 text-center">
      <p className="text-sm font-medium text-ink-2">{title}</p>
      {children && <div className="mt-1 text-xs text-ink-3">{children}</div>}
    </div>
  );
}

export function Loading() {
  return <div className="py-8 text-center text-sm text-ink-3">Loading…</div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-bad/20 bg-red-50 px-3 py-2 text-sm text-bad">{error}</div>;
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-xl border border-creme-3 bg-white/80 p-4">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button className="absolute inset-0 bg-charcoal/40" aria-label="Close panel" onClick={onClose} />
      <div className={cx("relative flex h-full w-full flex-col bg-creme shadow-2xl", wide ? "max-w-3xl" : "max-w-xl")}>
        <div className="flex items-center justify-between border-b border-creme-3 bg-white/70 px-5 py-3">
          <div className="min-w-0 text-base font-semibold">{title}</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={18} />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-creme-3" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm", value === t.id ? "border-emerald-700 font-medium text-emerald-800" : "border-transparent text-ink-3 hover:text-ink")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Async action wrapper: disables while running, toasts errors. */
export function useAction() {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", "error");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

// ---------------------------------------------------------------- charts

/** Single-series bar chart. One hue, no legend (title names the series), hover tooltip per bar. */
export function BarChart({ data, height = 120, format = (v: number) => String(v), label }: { data: { label: string; value: number }[]; height?: number; format?: (v: number) => string; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(data.length, 1);
  return (
    <figure aria-label={label}>
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label={label}>
          <line x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} stroke="var(--color-creme-3)" vectorEffect="non-scaling-stroke" />
          {data.map((d, i) => {
            const h = (d.value / max) * (height - 8);
            return (
              <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * w} y={0} width={w} height={height} fill="transparent" />
                <rect x={i * w + w * 0.18} y={height - h - 1} width={w * 0.64} height={Math.max(h, d.value ? 1.5 : 0)} rx="0.8" fill={hover === i ? "var(--color-emerald-800)" : "var(--color-emerald-600)"} />
              </g>
            );
          })}
        </svg>
        {hover !== null && data[hover] && (
          <div className="pointer-events-none absolute -top-2 rounded-md bg-charcoal px-2 py-1 text-xs text-creme shadow" style={{ left: `${Math.min(hover * w, 75)}%`, transform: "translateY(-100%)" }}>
            {data[hover].label}: <span className="font-semibold tabular-nums">{format(data[hover].value)}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-ink-3">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </figure>
  );
}

/** Horizontal labelled bars for categorical counts (each row is labelled, so color is not the identity carrier). */
export function HBarList({ rows, format = (v: number) => String(v) }: { rows: { label: string; value: number; tone?: string }[]; format?: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,8rem)_1fr_auto] items-center gap-2 text-xs" title={`${r.label}: ${format(r.value)}`}>
          <span className="truncate text-ink-2">{r.label}</span>
          <span className="h-2 rounded-full bg-creme-2">
            <span className="block h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.tone ?? "var(--color-emerald-600)" }} />
          </span>
          <span className="tabular-nums text-ink">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}
