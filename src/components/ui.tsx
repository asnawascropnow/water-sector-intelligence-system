import React, { useEffect } from "react";
import { Loader2, X } from "lucide-react";
import type { Provenance } from "../../shared/constants";
import type { FieldSource } from "../../shared/types";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

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
    primary: "bg-[var(--accent)] text-white hover:brightness-110 border border-transparent",
    secondary: "bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 text-neutral-800 dark:text-neutral-100 hover:bg-neutral-50 dark:hover:bg-neutral-800",
    ghost: "border border-transparent text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800",
    danger: "bg-white dark:bg-neutral-900 border border-red-300 dark:border-red-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950",
  };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap",
        size === "sm" ? "text-xs px-2.5 py-1.5" : "text-sm px-3.5 py-2",
        styles[variant],
        className,
      )}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ title, actions, children, className, bodyClassName }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  amber: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  red: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  purple: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, title, className }: { tone?: Tone; children: React.ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}

export const potentialTone = (p?: string | null): Tone => (p === "High" ? "green" : p === "Medium" ? "amber" : p === "Low" ? "neutral" : "neutral");
export const confidenceTone = (c?: string | null): Tone => (c === "High" ? "green" : c === "Medium" ? "blue" : c === "Low" ? "amber" : "neutral");
export const priorityTone = (p?: string | null): Tone => (p === "High" ? "red" : p === "Medium" ? "amber" : "neutral");
export const statusTone = (s?: string | null): Tone =>
  !s ? "neutral" : s === "Converted" ? "green" : s === "Lost" || s === "Not Interested" ? "red" : s === "Nurture" ? "purple" : s === "Pilot" ? "green" : "blue";

export function PotentialBadge({ potential }: { potential?: string | null }) {
  return (
    <Badge tone={potentialTone(potential)} title="AI Inference — see reasons on the organization page">
      {potential ?? "Unknown"} potential
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

export function Modal({ open, onClose, title, children, footer, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1500] flex items-start sm:items-center justify-center p-4 bg-black/40 overflow-y-auto" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("w-full rounded-lg bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 shadow-xl", width)} onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 cursor-pointer">
            <X size={16} />
          </button>
        </header>
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <footer className="flex justify-end gap-2 px-5 py-3 border-t border-neutral-200 dark:border-neutral-800">{footer}</footer>}
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/30 focus:border-[var(--accent)]";

export function Field({ label, hint, children, className }: { label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-neutral-500 mt-1">{hint}</span>}
    </label>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(props, ref) {
  return <input ref={ref} {...props} className={cx(inputCls, props.className)} />;
});
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} className={cx(inputCls, props.className)} />;
}
export function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: readonly (string | { value: string | number; label: string })[]; placeholder?: string }) {
  return (
    <select {...props} className={cx(inputCls, "pr-7", props.className)}>
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

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-500 py-6 justify-center">
      <Loader2 size={16} className="animate-spin" /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="text-center py-10 px-4">
      <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      {children && <div className="text-sm text-neutral-500 mt-1">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-md border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300 text-sm px-3 py-2">{error}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, tone, onClick }: { label: string; value: React.ReactNode; tone?: "red"; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="text-left rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-4 py-3 enabled:hover:border-neutral-400 dark:enabled:hover:border-neutral-600 enabled:cursor-pointer transition"
    >
      <div className="text-xs text-neutral-500 dark:text-neutral-400">{label}</div>
      <div className={cx("text-2xl font-semibold mt-1 tabular-nums", tone === "red" && Number(value) > 0 ? "text-red-600 dark:text-red-400" : "text-neutral-900 dark:text-neutral-50")}>{value}</div>
    </button>
  );
}
