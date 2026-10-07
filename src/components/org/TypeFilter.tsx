import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Organization, OrganizationTaxonomy } from "../../../shared/types";
import { ORG_TYPE_COLORS } from "../../../shared/constants";
import { cx } from "../ui";

/**
 * Multi-select organization type filter driven by the database taxonomy (GET /api/meta/organization-types).
 * Types are grouped by catalog group. Inactive (legacy) types are listed only when organizations use them.
 */
export default function TypeFilter({
  taxonomy,
  organizations,
  value,
  onChange,
  viewLabel,
}: {
  taxonomy: OrganizationTaxonomy | null;
  organizations: Organization[];
  value: string[];
  onChange: (types: string[]) => void;
  /** Label to show when the selection equals a saved view. */
  viewLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of organizations) m.set(o.org_type, (m.get(o.org_type) ?? 0) + 1);
    return m;
  }, [organizations]);

  const groups = useMemo(() => {
    if (!taxonomy) return [];
    return taxonomy.groups
      .map((g) => ({ ...g, types: taxonomy.types.filter((t) => t.group === g.key && (t.active || counts.has(t.key) || value.includes(t.key))) }))
      .filter((g) => g.types.length);
  }, [taxonomy, counts, value]);

  const toggle = (t: string) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  const toggleGroup = (types: string[]) => {
    const all = types.every((t) => value.includes(t));
    onChange(all ? value.filter((t) => !types.includes(t)) : [...new Set([...value, ...types])]);
  };

  const label = !value.length ? "All types" : viewLabel ? viewLabel : value.length === 1 ? value[0] : `${value.length} types`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Organization type"
        onClick={() => setOpen((v) => !v)}
        className={cx(
          "inline-flex h-9 items-center gap-2 rounded-lg border bg-[var(--surface)] px-3 text-sm shadow-sm cursor-pointer whitespace-nowrap",
          value.length ? "border-[var(--accent)] text-[var(--accent-text)] font-medium" : "border-[var(--border-strong)] text-[var(--text)]",
        )}
      >
        {label}
        <ChevronDown size={14} className="text-[var(--text-3)]" />
      </button>
      {open && (
        <div className="absolute right-0 sm:left-0 sm:right-auto z-40 mt-1.5 w-80 max-h-[60vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl p-2" role="listbox" aria-multiselectable="true">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs text-[var(--text-3)]">{value.length ? `${value.length} selected` : "Select one or more types"}</span>
            {value.length > 0 && (
              <button type="button" onClick={() => onChange([])} className="text-xs font-medium text-[var(--accent-text)] hover:underline cursor-pointer">
                Clear
              </button>
            )}
          </div>
          {!taxonomy && <div className="px-2 py-3 text-sm text-[var(--text-3)]">Loading types…</div>}
          {groups.map((g) => {
            const keys = g.types.map((t) => t.key);
            return (
              <div key={g.key} className="py-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(keys)}
                  className="w-full text-left px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)] hover:text-[var(--text)] cursor-pointer"
                  title="Select or clear the whole group"
                >
                  {g.label}
                </button>
                {g.types.map((t) => {
                  const on = value.includes(t.key);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => toggle(t.key)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-2)] cursor-pointer"
                    >
                      <span className={cx("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "border-[var(--border-strong)]")}>
                        {on && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: t.map_color ?? ORG_TYPE_COLORS.Other }} />
                      <span className="flex-1 text-left truncate">
                        {t.label}
                        {!t.active && <span className="text-[var(--text-3)]"> (legacy)</span>}
                      </span>
                      <span className="text-xs tabular-nums text-[var(--text-3)]">{counts.get(t.key) ?? 0}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
