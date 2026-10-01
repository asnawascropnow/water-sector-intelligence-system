import React, { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Bot, Building2, Droplet, KanbanSquare, LayoutDashboard, ListChecks, Map, Menu, Moon, Settings, Sun, Upload, X } from "lucide-react";
import { useApp } from "../../context/AppContext";
import { cx } from "../ui";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/map", label: "Bengaluru Map", icon: Map },
  { to: "/organizations", label: "Organizations", icon: Building2 },
  { to: "/import", label: "Import Data", icon: Upload },
  { to: "/crm", label: "CRM", icon: KanbanSquare },
  { to: "/tasks", label: "Tasks / Follow-ups", icon: ListChecks },
  { to: "/ai", label: "AI Recommendations", icon: Bot },
  { to: "/settings", label: "Settings", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const { activeUsers, currentUser, setCurrentUserId, theme, setTheme } = useApp();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const fullBleed = loc.pathname === "/map";

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-[#07090d] text-neutral-900 dark:text-neutral-100">
      {open && <div className="fixed inset-0 bg-black/40 z-40 md:hidden" onClick={() => setOpen(false)} />}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-50 w-60 flex flex-col bg-white dark:bg-neutral-950 border-r border-neutral-200 dark:border-neutral-800 transition-transform",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="h-14 flex items-center justify-between px-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md" style={{ background: "var(--accent)" }}>
              <Droplet size={14} className="text-white fill-current" />
            </div>
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">Bengaluru Water</div>
              <div className="text-[10px] uppercase tracking-wider text-neutral-500">Intelligence & CRM</div>
            </div>
          </div>
          <button className="md:hidden p-1 cursor-pointer" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={16} />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cx(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition",
                  isActive || (to === "/organizations" && loc.pathname.startsWith("/organizations/"))
                    ? "bg-neutral-100 dark:bg-neutral-900 font-medium text-neutral-900 dark:text-white"
                    : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 hover:text-neutral-900 dark:hover:text-white",
                )
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
          <label className="block text-[11px] text-neutral-500">
            Working as
            <select
              value={currentUser?.id ?? ""}
              onChange={(e) => setCurrentUserId(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100"
            >
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="flex items-center gap-2 text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white cursor-pointer"
          >
            {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />} {theme === "dark" ? "Light" : "Dark"} mode
          </button>
        </div>
      </aside>

      <div className="md:pl-60 min-h-screen flex flex-col">
        <header className="md:hidden sticky top-0 z-30 h-12 flex items-center gap-3 px-4 bg-white dark:bg-neutral-950 border-b border-neutral-200 dark:border-neutral-800">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="cursor-pointer">
            <Menu size={18} />
          </button>
          <span className="text-sm font-semibold">Bengaluru Water Intelligence</span>
        </header>
        <main className={cx("flex-1 min-w-0", fullBleed ? "" : "px-4 sm:px-6 py-6 max-w-[1400px] w-full mx-auto")}>{children}</main>
      </div>
    </div>
  );
}
