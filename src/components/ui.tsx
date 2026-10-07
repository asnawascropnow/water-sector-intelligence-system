import React, { useEffect } from "react";
import { Inbox, Loader2, X, type LucideIcon } from "lucide-react";
import type { Provenance } from "../../shared/constants";
import type { FieldSource } from "../../shared/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ---------- Buttons ---------- */

type BtnVariant = "primary" | "secondary" | "ghost" | "danger";
export function Button({
  variant = "secondary",
  size = "md",
  loading,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; size?: "sm" | "md"; loading?: boolean }) {
  const styles: Record<BtnVariant, string> = {
    primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] border border-transparent shadow-sm",
    secondary: "bg-[var(--surface)] border border-[var(--border-strong)] text-[var(--text)] hover:bg-[var(--surface-2)] shadow-sm",
    ghost: "border border-transparent text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
    danger: "bg-[var(--surface)] border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950",
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40",
        size === "sm" ? "h-8 text-xs px-3" : "h-9 text-sm px-3.5",
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ---------- Surfaces ---------- */

export function Card({
  title,
  description,
  icon: Icon,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cx("rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-card)] flex flex-col min-w-0", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5 min-w-0">
            {Icon && (
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]">
                <Icon size={15} />
              </span>
            )}
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-[var(--text)] truncate">{title}</h2>
              {description && <p className="text-xs text-[var(--text-3)] truncate">{description}</p>}
            </div>
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </header>
      )}
      <div className={cx(bodyClassName && /(^|\s)p[xy]?-/.test(bodyClassName) ? "" : "p-5", "flex-1 min-h-0", bodyClassName)}>{children}</div>
    </section>
  );
}

export function CardLink({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a {...props} className="text-xs font-medium text-[var(--accent-text)] hover:underline">
      {children}
    </a>
  );
}

/* ---------- Badges ---------- */

const TONES = {
  neutral: "bg-gray-100 text-gray-700 ring-gray-200 dark:bg-white/5 dark:text-gray-300 dark:ring-white/10",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20",
  purple: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20",
};
export type Tone = keyof typeof TONES;
const DOT: Record<Tone, string> = { neutral: "bg-gray-400", blue: "bg-blue-500", green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500", purple: "bg-violet-500" };

export function Badge({ tone = "neutral", children, title, className, dot }: { tone?: Tone; children: React.ReactNode; title?: string; className?: string; dot?: boolean }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset", TONES[tone], className)}>
      {dot && <span className={cx("h-1.5 w-1.5 rounded-full", DOT[tone])} />}
      {children}
    </span>
  );
}

export const potentialTone = (p?: string | null): Tone => (p === "High" ? "green" : p === "Medium" ? "amber" : "neutral");
export const confidenceTone = (c?: string | null): Tone => (c === "High" ? "green" : c === "Medium" ? "blue" : c === "Low" ? "amber" : "neutral");
export const priorityTone = (p?: string | null): Tone => (p === "High" ? "red" : p === "Medium" ? "amber" : "neutral");
export const statusTone = (s?: string | null): Tone =>
  !s ? "neutral" : s === "Converted" || s === "Pilot" ? "green" : s === "Lost" || s === "Not Interested" ? "red" : s === "Nurture" ? "purple" : "blue";

export function PotentialBadge({ potential, short }: { potential?: string | null; short?: boolean }) {
  return (
    <Badge tone={potentialTone(potential)} dot title="AI Inference — see reasons on the organization page">
      {potential ?? "Unknown"}
      {!short && " potential"}
    </Badge>
  );
}

const PROVENANCE_TONE: Record<Provenance, Tone> = { Verified: "green", Unverified: "neutral", Estimated: "amber", "AI Inference": "purple", Unknown: "neutral" };
/** Small label showing where a value came from (Rule 2). */
export function ProvenanceTag({ fs }: { fs?: FieldSource }) {
  if (!fs) return null;
  return (
    <Badge tone={PROVENANCE_TONE[fs.provenance] ?? "neutral"} title={fs.source ?? undefined} className="text-[10px] py-0">
      {fs.provenance}
    </Badge>
  );
}

export function Avatar({ name, size = 28 }: { name?: string | null; size?: number }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-text)] font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
      title={name ?? undefined}
    >
      {initials}
    </span>
  );
}

/* ---------- Overlays ---------- */

export function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1500] flex items-start sm:items-center justify-center p-4 bg-gray-950/40 backdrop-blur-[2px] overflow-y-auto" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("w-full rounded-xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl", width)} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-3)] cursor-pointer">
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-5 py-3.5 border-t border-[var(--border)] bg-[var(--surface-2)] rounded-b-xl">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- Form controls ---------- */

const inputCls =
  "w-full h-9 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] shadow-sm transition focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/25 focus:border-[var(--accent)]";

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="block text-xs font-medium text-[var(--text-2)] mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[var(--text-3)] mt-1">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={cx(inputCls, props.className)} />;
});
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, "h-auto py-2", props.className)} />;
}
export function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: readonly (string | { value: string | number; label: string })[]; placeholder?: string }) {
  return (
    <select {...props} className={cx(inputCls, "pr-8 cursor-pointer", props.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

/** Segmented control used for list filters (Tasks, Import review). */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number; alert?: boolean }[] }) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-gray-100 dark:bg-white/5 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md px-3 h-7 text-xs font-medium transition cursor-pointer",
            value === it.value ? "bg-[var(--surface)] text-[var(--text)] shadow-sm" : "text-[var(--text-3)] hover:text-[var(--text)]",
          )}
        >
          {it.label}
          {it.count !== undefined && (
            <span className={cx("rounded-full px-1.5 text-[10px] tabular-nums", it.alert && it.count > 0 ? "bg-red-600 text-white" : "bg-gray-200 dark:bg-white/10 text-[var(--text-2)]")}>{it.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ---------- Feedback ---------- */

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--text-3)] py-10 justify-center">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, children, icon: Icon = Inbox, action, compact }: { title: string; children?: React.ReactNode; icon?: LucideIcon; action?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center text-center px-4", compact ? "py-6" : "py-12")}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 dark:bg-white/5 text-[var(--text-3)] mb-3">
        <Icon size={18} />
      </span>
      <p className="text-sm font-medium text-[var(--text)]">{title}</p>
      {children && <div className="text-sm text-[var(--text-3)] mt-1 max-w-sm">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 text-sm px-3 py-2 mb-4">{error}</div>;
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
      <div className="min-w-0">
        {eyebrow && <div className="text-xs font-medium text-[var(--accent-text)] mb-1">{eyebrow}</div>}
        <h1 className="text-[22px] leading-7 font-semibold tracking-tight text-[var(--text)]">{title}</h1>
        {subtitle && <p className="text-sm text-[var(--text-3)] mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const STAT_TONE = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300",
  violet: "bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300",
  cyan: "bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300",
  red: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
  gray: "bg-gray-100 text-gray-600 dark:bg-white/5 dark:text-gray-300",
};

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "blue",
  hint,
  alert,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  tone?: keyof typeof STAT_TONE;
  hint?: string;
  alert?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cx(
        "group text-left rounded-xl border bg-[var(--surface)] p-4 shadow-[var(--shadow-card)] transition enabled:cursor-pointer enabled:hover:border-[var(--border-strong)] enabled:hover:shadow-md",
        alert ? "border-red-200 dark:border-red-900/60" : "border-[var(--border)]",
      )}
    >
      <div className="text-xs font-medium leading-4 text-[var(--text-3)] min-h-8">{label}</div>
      <div className="flex items-end justify-between gap-2 mt-1.5">
        <span className={cx("text-2xl leading-none font-semibold tabular-nums tracking-tight", alert ? "text-red-600 dark:text-red-400" : "text-[var(--text)]")}>{value}</span>
        {Icon && (
          <span className={cx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", STAT_TONE[alert ? "red" : tone])}>
            <Icon size={14} />
          </span>
        )}
      </div>
      {hint && <div className="text-[11px] text-[var(--text-3)] mt-0.5 truncate">{hint}</div>}
    </button>
  );
}
