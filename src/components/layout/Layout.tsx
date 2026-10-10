import React, { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Bell, Bot, Building2, Check, ChevronDown, Droplet, Droplets, FolderKanban, HardHat, KanbanSquare, Layers, LayoutDashboard, ListChecks, Mail, Map, Menu, Moon, PencilRuler, Settings, Sun, Upload, Warehouse, X, type LucideIcon } from "lucide-react";
import type { DashboardSummary } from "../../../shared/types";
import { useApp } from "../../context/AppContext";
import { useApi } from "../../lib/useApi";
import { Avatar, cx } from "../ui";

/** Icons for known saved views; any other view from the database gets a generic icon. */
const VIEW_ICONS: Record<string, LucideIcon> = { architects: PencilRuler, developers: Warehouse, contractors: HardHat, water_ecosystem: Droplets };

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/organizations", label: "Organizations", icon: Building2 },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/map", label: "Bengaluru Map", icon: Map },
  { to: "/import", label: "Import Data", icon: Upload },
  { to: "/crm", label: "CRM", icon: KanbanSquare },
  { to: "/tasks", label: "Tasks / Follow-ups", icon: ListChecks },
  { to: "/email", label: "Email Outreach", icon: Mail },
  { to: "/ai", label: "AI Recommendations", icon: Bot },
  { to: "/settings", label: "Settings", icon: Settings },
];

/** Section of the current route, used for the page title in the top bar. */
const current = (path: string) => NAV.find((n) => path === n.to || path.startsWith(`${n.to}/`));

function Logo() {
  return (
    <Link to="/dashboard" className="flex items-center gap-3 min-w-0" aria-label="WSIS home">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[var(--accent)] text-[var(--accent)]">
        <Droplet size={18} strokeWidth={2.25} />
      </span>
      <span className="text-[22px] font-bold tracking-tight text-[var(--text)]">WSIS</span>
    </Link>
  );
}

/** Avatar + name + role; opens a menu to switch the acting team member (no login yet). */
function UserMenu() {
  const { activeUsers, currentUser, setCurrentUserId } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Working as ${currentUser?.name ?? "nobody"}. Switch team member`}
        className="flex items-center gap-3 rounded-full py-1 pl-1 pr-2 hover:bg-[var(--surface-3)] transition cursor-pointer"
      >
        <Avatar name={currentUser?.name} size={40} />
        <span className="hidden sm:block text-left leading-tight">
          <span className="block text-sm font-semibold uppercase text-[var(--text)]">{currentUser?.name ?? "Select user"}</span>
          <span className="block text-[13px] text-[var(--text-3)] capitalize">{currentUser?.role || "Team member"}</span>
        </span>
        <ChevronDown size={14} className="hidden sm:block text-[var(--text-3)]" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-2 w-64 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-2xl z-50">
          <div className="px-3 pt-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-3)]">Working as</div>
          {activeUsers.map((u) => (
            <button
              key={u.id}
              role="menuitemradio"
              aria-checked={u.id === currentUser?.id}
              onClick={() => {
                setCurrentUserId(u.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-[var(--surface-3)] cursor-pointer"
            >
              <Avatar name={u.name} size={28} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium truncate">{u.name}</span>
                <span className="block text-xs text-[var(--text-3)] capitalize truncate">{u.role}</span>
              </span>
              {u.id === currentUser?.id && <Check size={15} className="text-[var(--accent)]" />}
            </button>
          ))}
          <div className="border-t border-[var(--border)] mt-1.5 pt-1.5">
            <Link to="/settings" onClick={() => setOpen(false)} className="block rounded-xl px-3 py-2 text-sm text-[var(--text-2)] hover:bg-[var(--surface-3)]">
              Manage team
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({ label, children, onClick, to, dot }: { label: string; children: React.ReactNode; onClick?: () => void; to?: string; dot?: boolean }) {
  const cls = "relative flex h-10 w-10 items-center justify-center rounded-full text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition cursor-pointer";
  const inner = (
    <>
      {children}
      {dot && <span className="absolute top-2 right-2.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-[var(--header)]" />}
    </>
  );
  return to ? (
    <Link to={to} className={cls} aria-label={label} title={label}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-label={label} title={label}>
      {inner}
    </button>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const { theme, setTheme, taxonomy } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const fullBleed = loc.pathname === "/map";
  const section = current(loc.pathname);
  const { data: summary } = useApi<DashboardSummary>("/dashboard/summary");
  const overdue = summary?.overdueFollowUps ?? 0;

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      {open && <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 w-[260px] flex flex-col bg-[var(--sidebar)] border-r border-[var(--border)] transition-transform",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="h-16 shrink-0 flex items-center justify-between px-5 border-b border-[var(--border)]">
          <Logo />
          <button className="md:hidden p-1.5 rounded-full hover:bg-[var(--surface-3)] cursor-pointer" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-5 space-y-1.5" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon }) => {
            const viewKey = new URLSearchParams(loc.search).get("view");
            const onOrgs = loc.pathname === "/organizations";
            // Organizations is not highlighted while one of its saved views is open (the view is).
            const active = to === "/organizations" ? (onOrgs && !viewKey) || loc.pathname.startsWith("/organizations/") : section?.to === to;
            return (
              <React.Fragment key={to}>
                <NavLink
                  to={to}
                  onClick={() => setOpen(false)}
                  className={cx(
                    "flex items-center gap-3 rounded-full px-3.5 h-11 text-[15px] transition-colors",
                    active ? "bg-[var(--accent)] text-white font-semibold" : "text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]",
                  )}
                >
                  <Icon size={18} className="shrink-0" />
                  <span className="truncate">{label}</span>
                </NavLink>
                {/* Saved Discover views from the database: the Organizations page with a type filter applied. */}
                {to === "/organizations" &&
                  (taxonomy?.views ?? []).map((v) => {
                    const VIcon = VIEW_ICONS[v.key] ?? Layers;
                    const on = onOrgs && viewKey === v.key;
                    return (
                      <NavLink
                        key={v.key}
                        to={`/organizations?view=${encodeURIComponent(v.key)}`}
                        onClick={() => setOpen(false)}
                        title={v.types.join(", ")}
                        className={cx(
                          "flex items-center gap-3 rounded-full pl-10 pr-3.5 h-9 text-[14px] transition-colors",
                          on ? "bg-[var(--accent)] text-white font-semibold" : "text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-3)]",
                        )}
                      >
                        <VIcon size={15} className="shrink-0" />
                        <span className="truncate">{v.label}</span>
                      </NavLink>
                    );
                  })}
              </React.Fragment>
            );
          })}
        </nav>
      </aside>

      <div className="md:pl-[260px] min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 h-16 shrink-0 flex items-center gap-3 px-4 sm:px-6 lg:px-8 bg-[var(--header)] border-b border-[var(--border)]">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="md:hidden -ml-1 p-2 rounded-full hover:bg-[var(--surface-3)] cursor-pointer">
            <Menu size={20} />
          </button>
          {/* Section name; each page keeps its own <h1>. */}
          <div className="flex-1 min-w-0 truncate text-xl font-semibold tracking-tight">{section?.label ?? "WSIS"}</div>
          <div className="flex items-center gap-1 sm:gap-2">
            <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun size={20} /> : <Moon size={20} />}
            </IconButton>
            <IconButton label={overdue ? `${overdue} overdue follow-up${overdue === 1 ? "" : "s"}` : "Notifications — no overdue follow-ups"} to={overdue ? "/tasks?scope=overdue" : "/ai"} dot={overdue > 0}>
              <Bell size={20} />
            </IconButton>
            <div className="w-px h-8 bg-[var(--border)] mx-1 hidden sm:block" />
            <UserMenu />
          </div>
        </header>
        <main className={cx("flex-1 min-w-0", fullBleed ? "" : "px-4 sm:px-6 lg:px-8 py-8 max-w-[1600px] w-full mx-auto")}>{children}</main>
      </div>
    </div>
  );
}
