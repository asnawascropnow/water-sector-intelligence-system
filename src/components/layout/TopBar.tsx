import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { 
  Search, 
  Bell, 
  HelpCircle, 
  ShieldAlert, 
  Layers, 
  Plus, 
  ChevronDown, 
  Briefcase, 
  Sparkles,
  Sliders,
  CheckCircle,
  Clock,
  LogOut,
  User,
  X,
  Droplet,
  Menu,
  Sun,
  Moon
} from "lucide-react";

interface TopBarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  dashboardMapLayer: "stress" | "groundwater" | "rainfall" | "density";
  setDashboardMapLayer: (layer: "stress" | "groundwater" | "rainfall" | "density") => void;
  onToggleMobileSidebar?: () => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

export default function TopBar({ 
  searchQuery, 
  setSearchQuery,
  dashboardMapLayer,
  setDashboardMapLayer,
  onToggleMobileSidebar,
  theme,
  setTheme,
}: TopBarProps) {
  const routerLocation = useLocation();
  const navigate = useNavigate();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // States for interactive menus
  const [showWorkspaceMenu, setShowWorkspaceMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState("WIOS Central Command");
  
  // Custom dialog state for "Quick Add Node"
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({
    name: "",
    category: "Industry",
    state: "Karnataka",
    district: "Bengaluru Urban",
    waterSource: "Groundwater (Borewell)",
    waterStressLevel: "Critical"
  });

  // Handle Ctrl+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Derive title and breadcrumbs
  const path = routerLocation.pathname;
  let mainTitle = "WIOS Operations Control Room";
  let categoryLabel = "Operations";

  if (path === "/dashboard" || path === "/") {
    mainTitle = "Water Intelligence Command Center";
    categoryLabel = "Command Center";
  } else if (path === "/explorer") {
    mainTitle = "National Spatial Directory";
    categoryLabel = "Geospatial Twin";
  } else if (path === "/assignments") {
    mainTitle = "Active Consulting CRM Board";
    categoryLabel = "Pipeline Funnel";
  } else if (path === "/monitoring") {
    mainTitle = "Data Ingestion & APIs Lake";
    categoryLabel = "Data Lake Sync";
  }

  // Sample real-time notifications for internal operators
  const notificationsList = [
    {
      id: "n1",
      title: "Data Ingestion Peak",
      desc: "Scraped 24 water consent orders from KSPCB portal.",
      time: "5m ago",
      type: "info"
    },
    {
      id: "n2",
      title: "Immediate Follow-up Overdue",
      desc: "REVA University has not received a follow-up call in 7 days.",
      time: "2h ago",
      type: "alert"
    },
    {
      id: "n3",
      title: "Geospatial Heatmap Regenerated",
      desc: "Groundwater aquifer contours for Bengaluru Urban updated successfully.",
      time: "1d ago",
      type: "success"
    }
  ];

  const handleQuickAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`Success: Standard node registration submitted for "${quickAddForm.name}". This will run through the WIOS ingestion scraper to gather complete GIS/Twin data.`);
    setIsQuickAddOpen(false);
    setQuickAddForm({
      name: "",
      category: "Industry",
      state: "Karnataka",
      district: "Bengaluru Urban",
      waterSource: "Groundwater (Borewell)",
      waterStressLevel: "Critical"
    });
  };

  return (
    <header
      id="app-topbar"
      className="h-14 flex items-center justify-between px-6 sticky top-0 z-40 transition-colors"
      style={{ background: theme === 'dark' ? 'var(--dark-bg-muted)' : 'var(--bg-muted)', borderBottom: '1px solid var(--border)' }}
    >
      {/* Left Section: Breadcrumb, Title & Workspace Switcher */}
      <div className="flex items-center gap-3 md:gap-5">
        {/* Mobile menu trigger */}
        <button
          onClick={onToggleMobileSidebar}
          className="md:hidden p-1.5 rounded-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer"
          title="Open Menu"
        >
          <Menu size={16} />
        </button>

        <div className="flex flex-col">
          <div className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400 uppercase tracking-wider font-semibold">
            <span className="hidden xs:inline">CropNow India</span>
            <span className="text-neutral-300 dark:text-neutral-700 hidden xs:inline">/</span>
            <span className="text-neutral-900 dark:text-neutral-100 font-bold">{categoryLabel}</span>
          </div>
          <h1 className="text-xs md:text-xs font-medium text-neutral-900 dark:text-neutral-100 leading-tight mt-0.5 tracking-tight flex items-center gap-1.5 max-w-[160px] xs:max-w-xs md:max-w-none truncate">
            <span className="truncate">{mainTitle}</span>
          </h1>
        </div>

        {/* Workspace Dropdown */}
        <div className="relative border-l border-neutral-250 dark:border-neutral-850 pl-5 hidden lg:block">
          <button
            onClick={() => setShowWorkspaceMenu(!showWorkspaceMenu)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/85 dark:border-neutral-800/85 px-2.5 py-1 rounded-sm"
          >
            <Sparkles size={11} className="text-neutral-600 dark:text-neutral-300" />
            <span>{activeWorkspace}</span>
            <ChevronDown size={11} className="text-neutral-400 dark:text-neutral-500" />
          </button>

          {showWorkspaceMenu && (
            <div className="absolute left-5 mt-1.5 w-52 bg-white dark:bg-[#09090b] border border-neutral-200 dark:border-neutral-800 rounded-sm shadow-md z-50 text-[11px] py-1 animate-fadeIn">
              <div className="px-3 py-1 text-[9px] uppercase font-bold text-neutral-400 dark:text-neutral-500 tracking-wider border-b border-neutral-100 dark:border-neutral-800/60 mb-1">
                Select Workspace Instance
              </div>
              {["WIOS Central Command", "Akash Bhumi Rural Project", "South India Aquifer Labs", "Corporate ESG Node"].map((ws) => (
                <button
                  key={ws}
                  onClick={() => {
                    setActiveWorkspace(ws);
                    setShowWorkspaceMenu(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors ${
                    activeWorkspace === ws ? "text-neutral-950 dark:text-white font-semibold" : "text-neutral-500 dark:text-neutral-400"
                  }`}
                >
                  {ws}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Section: Map Layer Toggles, Search, Quick Add, Notifications, Profile */}
      <div className="flex items-center gap-3">
        
        {/* Quick Toolbar for Map Layers (Active visual indicator of connected layers) */}
        {path === "/dashboard" && (
          <div className="hidden lg:flex items-center gap-1 bg-neutral-50 dark:bg-neutral-900/50 p-0.5 border border-neutral-200/80 dark:border-neutral-800/80 rounded-sm text-xs mr-1">
            <span className="text-[9px] font-bold text-neutral-400 dark:text-neutral-500 uppercase tracking-wide px-2 flex items-center gap-1">
              <Layers size={10} />
              Layer:
            </span>
            {[
              { id: "stress" as const, label: "Stress" },
              { id: "groundwater" as const, label: "Aquifer" },
              { id: "rainfall" as const, label: "Rain" },
              { id: "density" as const, label: "Density" }
            ].map((lay) => (
              <button
                key={lay.id}
                onClick={() => setDashboardMapLayer(lay.id)}
                className={`px-2 py-0.5 rounded-sm text-[10px] font-medium transition-all cursor-pointer ${
                  dashboardMapLayer === lay.id 
                    ? "bg-neutral-900 dark:bg-white text-white dark:text-black" 
                    : "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-white"
                }`}
              >
                {lay.label}
              </button>
            ))}
          </div>
        )}

        {/* Global Search Input */}
        <div className="relative w-28 xs:w-40 md:w-56 shrink-0">
          <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-neutral-400 dark:text-neutral-500">
            <Search size={12} />
          </span>
          <input
            id="global-search-input"
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (path !== "/explorer") {
                navigate("/explorer");
              }
            }}
            placeholder="Search Twin ID... (⌘K)"
            className="w-full h-[28px] pl-7 pr-4 bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100/50 dark:hover:bg-[#111] focus:bg-white dark:focus:bg-[#000] border border-neutral-200 dark:border-neutral-800 focus:border-neutral-900 dark:focus:border-neutral-100 rounded-sm text-xs text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 transition-all outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute inset-y-0 right-0 pr-2 flex items-center text-[9px] text-neutral-500 hover:text-neutral-900"
            >
              Clear
            </button>
          )}
        </div>

        {/* Action Widgets */}
        <div className="flex items-center gap-1.5 border-l border-neutral-200 dark:border-neutral-800 pl-3 shrink-0">
          
          {/* Quick Add Ingest Button */}
          <button 
            onClick={() => setIsQuickAddOpen(true)}
            className="bg-neutral-900 dark:bg-neutral-100 hover:bg-neutral-800 dark:hover:bg-neutral-200 text-white dark:text-black text-[10px] font-semibold h-[28px] px-2.5 rounded-sm flex items-center gap-1.5 transition-colors cursor-pointer"
            title="Register new Digital Twin Node"
          >
            <Plus size={12} />
            <span className="hidden xs:inline">Ingest</span>
          </button>

          {/* Light/Dark Mode Toggle Button */}
          <button
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            className="p-1.5 rounded-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-400 dark:text-neutral-500 hover:text-neutral-950 dark:hover:text-white transition-colors cursor-pointer"
            title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {theme === "light" ? <Moon size={14} /> : <Sun size={14} />}
          </button>

          {/* Font Size Adjuster Button */}
          <button
            onClick={() => {
              const current = localStorage.getItem("wios-fontsize") || "normal";
              let next: "normal" | "large" | "xlarge" = "normal";
              if (current === "normal") next = "large";
              else if (current === "large") next = "xlarge";
              else next = "normal";
              
              localStorage.setItem("wios-fontsize", next);
              const root = document.documentElement;
              root.classList.remove("text-normal", "text-large", "text-xlarge");
              root.classList.add(`text-${next}`);
              window.dispatchEvent(new Event("fontsize-changed"));
            }}
            className="p-1 rounded-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-450 dark:text-neutral-500 hover:text-neutral-950 dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center font-semibold text-[10px] min-w-[24px] h-[24px] border border-neutral-200/80 dark:border-neutral-800/80"
            title="Adjust Font Size"
          >
            A±
          </button>

          {/* Real-time Notifications Popover */}
          <div className="relative">
            <button 
              onClick={() => {
                setShowNotifications(!showNotifications);
                setShowUserMenu(false);
              }}
              title="WIOS Operations Log System" 
              className="p-1.5 rounded-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 text-neutral-400 dark:text-neutral-500 hover:text-neutral-950 dark:hover:text-white transition-colors relative cursor-pointer"
            >
              <Bell size={14} />
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-neutral-900 dark:bg-neutral-100 rounded-full"></span>
            </button>

            {showNotifications && (
              <div className="absolute right-0 mt-1.5 w-72 bg-white dark:bg-[#09090b] border border-neutral-200 dark:border-neutral-800 rounded-sm shadow-md z-50 text-[11px] divide-y divide-neutral-100 dark:divide-neutral-800 animate-fadeIn text-neutral-600 dark:text-neutral-400">
                <div className="p-2.5 bg-neutral-50 dark:bg-neutral-900 flex justify-between items-center">
                  <span className="font-bold text-neutral-900 dark:text-white uppercase tracking-wider text-[9px] flex items-center gap-1">
                    Live Operations Log
                  </span>
                  <span className="bg-neutral-900 dark:bg-neutral-800 text-white dark:text-neutral-300 text-[8px] px-1.5 py-0.2 rounded-full font-bold">
                    3 Pending
                  </span>
                </div>
                <div className="max-h-[220px] overflow-y-auto">
                  {notificationsList.map((not) => (
                    <div key={not.id} className="p-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-900/50 transition-colors space-y-0.5">
                      <div className="flex justify-between font-semibold text-neutral-950 dark:text-white text-[10px]">
                        <span>{not.title}</span>
                        <span className="text-[8px] text-neutral-400 dark:text-neutral-500 font-mono">{not.time}</span>
                      </div>
                      <p className="text-[9px] text-neutral-500 dark:text-neutral-400 leading-relaxed">{not.desc}</p>
                    </div>
                  ))}
                </div>
                <div className="p-2 text-center bg-neutral-50 dark:bg-neutral-900">
                  <button 
                    onClick={() => {
                      alert("Opening comprehensive logs panel");
                      setShowNotifications(false);
                    }}
                    className="text-neutral-900 dark:text-neutral-100 hover:underline font-semibold text-[9px]"
                  >
                    View Comprehensive Audits
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User Profile dropdown */}
          <div className="relative">
            <div 
              onClick={() => {
                setShowUserMenu(!showUserMenu);
                setShowNotifications(false);
              }}
              className="flex items-center gap-1.5 ml-1 cursor-pointer hover:opacity-80 transition-opacity"
            >
              <div className="w-6 h-6 rounded-sm bg-neutral-900 dark:bg-neutral-100 text-white dark:text-black flex items-center justify-center font-bold text-[10px]">
                WI
              </div>
              <ChevronDown size={10} className="text-neutral-400 dark:text-neutral-500 hidden md:block" />
            </div>

            {showUserMenu && (
              <div className="absolute right-0 mt-1.5 w-44 bg-white dark:bg-[#09090b] border border-neutral-200 dark:border-neutral-800 rounded-sm shadow-md z-50 text-[11px] py-1 animate-fadeIn">
                <div className="px-3 py-1.5 border-b border-neutral-100 dark:border-neutral-800/80 mb-1">
                  <p className="font-semibold text-neutral-950 dark:text-white">Specialist Akash</p>
                  <p className="text-[9px] text-neutral-400 dark:text-neutral-500 mt-0.5">CWIP Ops Lead</p>
                </div>
                <button
                  onClick={() => alert("Enterprise IAM panel is configured server-side.")}
                  className="w-full text-left px-3 py-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5"
                >
                  <User size={12} />
                  <span>IAM Settings</span>
                </button>
                <button
                  onClick={() => alert("WIOS System status: Synced & Secured.")}
                  className="w-full text-left px-3 py-1.5 text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5"
                >
                  <Clock size={12} />
                  <span>Logins History</span>
                </button>
                <div className="border-t border-neutral-150 dark:border-neutral-800/80 mt-1 pt-1">
                  <button
                    onClick={() => alert("Logging out of local session")}
                    className="w-full text-left px-3 py-1.5 text-rose-500 hover:text-rose-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 flex items-center gap-1.5"
                  >
                    <LogOut size={12} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* QUICK INGEST DIALOG MODAL */}
      {isQuickAddOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[1000] text-slate-900 dark:text-zinc-50 animate-fadeIn">
          <div className="bg-white dark:bg-zinc-950 rounded-md border border-slate-200 dark:border-zinc-850 w-[450px] shadow-2xl p-6 relative">
            <button 
              onClick={() => setIsQuickAddOpen(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X size={18} />
            </button>
            
            <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-zinc-850">
              <Droplet size={18} className="text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                WIOS Digital Twin Ingestion
              </h3>
            </div>

            <form onSubmit={handleQuickAddSubmit} className="mt-4 space-y-4 text-xs">
              <p className="text-slate-500 dark:text-zinc-400 text-[11px] leading-relaxed">
                Provide basic coordinates to initiate automated scrapers and trigger GIS/TWIN asset resolution from municipal logs, AISHE data layers, or KSPCB consent records.
              </p>

              <div className="space-y-1">
                <label className="font-bold text-slate-700 dark:text-zinc-300">Organization Name *</label>
                <input 
                  type="text"
                  required
                  placeholder="e.g. MS Ramaiah Tech Campus"
                  value={quickAddForm.name}
                  onChange={(e) => setQuickAddForm({ ...quickAddForm, name: e.target.value })}
                  className="w-full h-[32px] border border-slate-200 dark:border-zinc-800 rounded-md px-3 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white focus:border-indigo-500 dark:focus:border-indigo-400 outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">Category Type</label>
                  <select 
                    value={quickAddForm.category}
                    onChange={(e) => setQuickAddForm({ ...quickAddForm, category: e.target.value })}
                    className="w-full h-[32px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white rounded-md px-2 outline-none"
                  >
                    <option value="Industry">Industry</option>
                    <option value="University">University</option>
                    <option value="Hospital">Hospital</option>
                    <option value="Apartment/Residential">Residential</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">Water Source</label>
                  <select 
                    value={quickAddForm.waterSource}
                    onChange={(e) => setQuickAddForm({ ...quickAddForm, waterSource: e.target.value })}
                    className="w-full h-[32px] border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white rounded-md px-2 outline-none"
                  >
                    <option value="Groundwater (Borewell)">Groundwater</option>
                    <option value="Municipal (Cauvery)">Municipal</option>
                    <option value="Tankers Only">Tankers</option>
                    <option value="Mixed Supply">Mixed</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">State Focus</label>
                  <input 
                    type="text"
                    value={quickAddForm.state}
                    onChange={(e) => setQuickAddForm({ ...quickAddForm, state: e.target.value })}
                    className="w-full h-[32px] border border-slate-200 dark:border-zinc-800 rounded-md px-3 bg-slate-50 dark:bg-zinc-900/60 text-slate-400 dark:text-zinc-500 cursor-not-allowed"
                    disabled
                  />
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-slate-700 dark:text-zinc-300">District Focus</label>
                  <input 
                    type="text"
                    value={quickAddForm.district}
                    onChange={(e) => setQuickAddForm({ ...quickAddForm, district: e.target.value })}
                    className="w-full h-[32px] border border-slate-200 dark:border-zinc-800 rounded-md px-3 bg-slate-50 dark:bg-zinc-900/60 text-slate-400 dark:text-zinc-500 cursor-not-allowed"
                    disabled
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsQuickAddOpen(false)}
                  className="px-4 py-2 border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900 text-slate-700 dark:text-zinc-300 font-bold rounded-md cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-md cursor-pointer"
                >
                  Initialize Ingest Pipeline
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </header>
  );
}
