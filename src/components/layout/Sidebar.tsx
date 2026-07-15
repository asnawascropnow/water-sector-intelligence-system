import React from "react";
import { NavLink } from "react-router-dom";
import { 
  LayoutDashboard, 
  ChevronLeft, 
  ChevronRight, 
  Droplet, 
  Building2, 
  Globe, 
  TrendingUp, 
  Briefcase, 
  DollarSign, 
  Activity, 
  FileText, 
  Sparkles, 
  Database, 
  Settings, 
  Search,
  ShieldCheck
} from "lucide-react";

interface SidebarProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  activeSidebarItem: string;
  setActiveSidebarItem: (item: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const menuItems = [
  { name: "Organizations", route: "/explorer", icon: Building2 },
  { name: "Maps", route: "/maps", icon: Globe },
  { name: "Analytics", route: "/analytics", icon: TrendingUp },
  { name: "Projects", route: "/projects", icon: Briefcase },
  { name: "Funding", route: "/funding", icon: DollarSign },
  { name: "Operations", route: "/operations", icon: Activity },
  { name: "Reports", route: "/reports", icon: FileText },
  { name: "AI Intelligence", route: "/ai", icon: Sparkles },
  { name: "Data Center", route: "/monitoring", icon: Database },
  { name: "Administration", route: "/admin", icon: Settings },
];

export default function Sidebar({
  isCollapsed,
  setIsCollapsed,
  activeSidebarItem,
  setActiveSidebarItem,
  isMobileOpen,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div 
          onClick={onCloseMobile}
          className="fixed inset-0 bg-black/40 dark:bg-black/60 backdrop-blur-xs z-40 md:hidden transition-all duration-300"
        />
      )}

      <aside
        id="app-sidebar"
        className={`surface text-neutral-800 dark:text-neutral-100 h-screen fixed top-0 transition-all duration-300 z-50 flex flex-col justify-between select-none ${
          isCollapsed ? "md:w-16" : "md:w-60"
        } ${
          isMobileOpen 
            ? "left-0 w-60 shadow-xl" 
            : "-left-60 md:left-0 w-60"
        }`}
        style={{ borderRight: '1px solid var(--border)' }}
      >
        <div className="flex flex-col h-full overflow-hidden">
          {/* Header/Logo */}
          <div className="h-14 border-b flex items-center justify-between px-4 surface flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="bg-neutral-950 dark:bg-white p-1 rounded-sm flex-shrink-0 flex items-center justify-center shadow-xs" style={{ background: 'var(--accent)' }}>
                <Droplet size={14} className="text-white fill-current" />
              </div>
              {(!isCollapsed || isMobileOpen) && (
                <div className="flex flex-col text-left leading-none">
                  <span className="font-bold tracking-tight text-[14px]" style={{ color: 'var(--text-default)' }}>
                    WIOS Intel
                  </span>
                  <span className="text-[9px] font-medium tracking-wider uppercase mt-0.5 muted">
                    Water Platform
                  </span>
                </div>
              )}
            </div>
            <button
              id="sidebar-toggle-btn"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-white p-1 rounded-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors cursor-pointer hidden md:block"
              title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
            >
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          {/* Search Nav Trigger in Sidebar (Ctrl+K visual) */}
          {(!isCollapsed || isMobileOpen) && (
            <div className="px-3 pt-3.5 pb-1 flex-shrink-0">
              <div 
                onClick={() => {
                  const searchInput = document.getElementById("global-search-input");
                  if (searchInput) searchInput.focus();
                }}
                className="bg-neutral-50 dark:bg-neutral-900/50 border border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 rounded-sm p-1.5 flex items-center justify-between text-neutral-450 dark:text-neutral-400 cursor-pointer transition-colors text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <Search size={12} className="text-neutral-400 dark:text-neutral-500" />
                  <span>Search nodes...</span>
                </div>
                <kbd className="bg-neutral-100 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 text-[9px] px-1 py-0.5 rounded text-neutral-500 dark:text-neutral-400 font-mono leading-none">
                  ⌘K
                </kbd>
              </div>
            </div>
          )}

        {/* Scrollable Navigation Area */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5 custom-scrollbar">
          
          {/* Dashboard */}
          <NavLink
            to="/dashboard"
            id="nav-link-dashboard"
            onClick={() => setActiveSidebarItem("Dashboard")}
            className={({ isActive }) =>
              `flex items-center gap-3 px-2.5 py-1.5 rounded-sm transition-all text-xs font-semibold ${
                isActive && activeSidebarItem === "Dashboard"
                  ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-white border-l-2 border-neutral-900 dark:border-white pl-2"
                  : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/60 hover:text-neutral-900 dark:hover:text-white"
              }`
            }
          >
            <LayoutDashboard size={14} className="flex-shrink-0" />
            {!isCollapsed && <span>Command Center</span>}
          </NavLink>

          {/* Flat Menu Items */}
          {menuItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.name}
                to={item.route}
                onClick={() => setActiveSidebarItem(item.name)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-2.5 py-1.5 rounded-sm transition-all text-xs font-semibold ${
                    isActive && activeSidebarItem === item.name
                      ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-white border-l-2 border-neutral-900 dark:border-white pl-2"
                      : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900/60 hover:text-neutral-900 dark:hover:text-white"
                  }`
                }
              >
                <Icon size={14} className="flex-shrink-0" />
                {!isCollapsed && <span>{item.name}</span>}
              </NavLink>
            );
          })}

        </div>
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-neutral-200/80 dark:border-neutral-800/80 text-[11px] text-neutral-500 dark:text-neutral-400 bg-white dark:bg-[#09090b] flex-shrink-0">
        {(isCollapsed && !isMobileOpen) ? (
          <div className="flex justify-center" title="WIOS Enterprise Pro">
            <ShieldCheck size={14} className="text-neutral-900 dark:text-neutral-100" />
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-neutral-800 dark:text-neutral-200">WIOS Enterprise</span>
              <span className="font-mono text-[9px] bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 px-1 py-0.2 rounded-sm border border-neutral-200/40 dark:border-neutral-700/40">v2.1</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">
              <span className="w-1 h-1 bg-emerald-500 rounded-full animate-ping"></span>
              <span>80 Core Nodes Synced</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  </>
  );
}
