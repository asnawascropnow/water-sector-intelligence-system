import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Bot, Building2, Droplet, KanbanSquare, LayoutDashboard, ListChecks, Map, Menu, Moon, Settings, Sun, Upload, X } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { Avatar, cx } from "../ui";

const NAV = [
  {
    group: "Discover",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/map", label: "Bengaluru Map", icon: Map },
      { to: "/organizations", label: "Organizations", icon: Building2 },
      { to: "/import", label: "Import Data", icon: Upload },
    ],
  },
  {
    group: "Engage",
    items: [
      { to: "/crm", label: "CRM", icon: KanbanSquare },
      { to: "/tasks", label: "Tasks / Follow-ups", icon: ListChecks },
      { to: "/ai", label: "AI Recommendations", icon: Bot },
    ],
  },
  { group: "System", items: [{ to: "/settings", label: "Settings", icon: Settings }] },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { activeUsers, currentUser, setCurrentUserId, theme, setTheme } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const fullBleed = loc.pathname === "/map";

  return (
    <div className="min-h-screen bg-[var(--page)] text-[var(--text)]">
      {open && <div className="fixed inset-0 bg-gray-950/40 z-40 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-[var(--surface)] border-r border-[var(--border)] transition-transform",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="h-16 flex items-center justify-between px-5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#1a7cf0] to-[#0b4fa8] shadow-sm">
              <Droplet size={17} className="text-white fill-white/90" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Bengaluru Water</div>
              <div className="text-[11px] text-[var(--text-3)]">Intelligence & CRM</div>
            </div>
          </div>
          <button className="md:hidden p-1 cursor-pointer" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
          {NAV.map(({ group, items }) => (
            <div key={group}>
              <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-3)]">{group}</div>
              <div className="space-y-0.5">
                {items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) => {
                      const active = isActive || (to === "/organizations" && loc.pathname.startsWith("/organizations/"));
                      return cx(
                        "group flex items-center gap-3 rounded-lg px-3 h-9 text-[13px] transition-colors",
                        active ? "bg-[var(--accent-soft)] text-[var(--accent-text)] font-semibold" : "text-[var(--text-2)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
                      );
                    }}
                  >
                    <Icon size={16} className="shrink-0" />
                    {label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-[var(--border)] space-y-2">
          <div className="flex items-center gap-3 rounded-lg bg-[var(--surface-2)] p-2.5">
            <Avatar name={currentUser?.name} size={32} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Working as</div>
              <select
                aria-label="Working as"
                value={currentUser?.id ?? ""}
                onChange={(e) => setCurrentUserId(Number(e.target.value))}
                className="w-full bg-transparent text-sm font-medium text-[var(--text)] focus:outline-none cursor-pointer -ml-0.5"
              >
                {activeUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex w-full items-center gap-2 rounded-lg px-3 h-8 text-xs text-[var(--text-3)] hover:bg-[var(--surface-2)] hover:text-[var(--text)] cursor-pointer"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />} {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      <div className="md:pl-64 min-h-screen flex flex-col">
        <header className="md:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-4 bg-[var(--surface)] border-b border-[var(--border)]">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="cursor-pointer">
            <Menu size={20} />
          </button>
          <span className="text-sm font-semibold">Bengaluru Water Intelligence</span>
        </header>
        <main className={cx("flex-1 min-w-0", fullBleed ? "" : "px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-[1440px] w-full mx-auto")}>{children}</main>
      </div>
    </div>
  );
}
