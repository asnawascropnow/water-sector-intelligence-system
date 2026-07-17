import React, { useState } from "react";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

interface PageShellProps {
  children: React.ReactNode;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  activeSidebarItem: string;
  setActiveSidebarItem: (item: string) => void;
  activeSection: string;
  setActiveSection: (sec: string) => void;
  dashboardMapLayer: "stress" | "groundwater" | "rainfall" | "density";
  setDashboardMapLayer: (layer: "stress" | "groundwater" | "rainfall" | "density") => void;
  theme: "light" | "dark";
  setTheme: (theme: "light" | "dark") => void;
}

export default function PageShell({ 
  children, 
  searchQuery, 
  setSearchQuery,
  activeSidebarItem,
  setActiveSidebarItem,
  activeSection,
  setActiveSection,
  dashboardMapLayer,
  setDashboardMapLayer,
  theme,
  setTheme,
}: PageShellProps) {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  return (
    <div className={`min-h-screen antialiased font-sans flex ${theme === 'dark' ? 'dark' : ''}`}>
      {/* Fixed Left Sidebar with mobile responsive properties */}
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        setIsCollapsed={setIsSidebarCollapsed} 
        activeSidebarItem={activeSidebarItem}
        setActiveSidebarItem={setActiveSidebarItem}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
      />

      {/* Main Layout Container with responsive padding */}
      <div
        className={`flex-1 flex flex-col transition-all duration-300 min-w-0 min-h-screen pl-0 ${
          isSidebarCollapsed ? "md:pl-16" : "md:pl-60"
        }`}
      >
        {/* Sticky Topbar with responsive trigger */}
        <TopBar 
          searchQuery={searchQuery} 
          setSearchQuery={setSearchQuery} 
          dashboardMapLayer={dashboardMapLayer}
          setDashboardMapLayer={setDashboardMapLayer}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          theme={theme}
          setTheme={setTheme}
        />

        {/* Scrollable Content Pane */}
        <main id="main-content-area" className="flex-1 overflow-y-auto flex flex-col">
          <div className="w-full flex-1 flex flex-col">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
