import React, { useState, useEffect } from "react";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import PageShell from "./components/layout/PageShell";
import Dashboard from "./pages/Dashboard";
import Explorer from "./pages/Explorer";
import Assignments from "./pages/Assignments";
import Monitoring from "./pages/Monitoring";
import Funding from "./pages/Funding";
import Maps from "./pages/Maps";
import Analytics from "./pages/Analytics";
import Projects from "./pages/Projects";
import Operations from "./pages/Operations";
import Reports from "./pages/Reports";
import AI from "./pages/AI";
import Admin from "./pages/Admin";
import initialLocations from "./data/mockLocations.json";
import initialAssignments from "./data/mockAssignments.json";
import initialTeamMembers from "./data/mockTeamMembers.json";
import { Location, Assignment, TeamMember, LeadStage, Category } from "./data/mockData.types";

export default function App() {
  // Theme state: default to 'light' (high contrast Vercel style)
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("wios-theme");
    if (saved === "light" || saved === "dark") return saved;
    return "light";
  });

  // Sync theme class to document element
  useEffect(() => {
    localStorage.setItem("wios-theme", theme);
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [theme]);

  // Sync font size class to document element on start and listen for custom events
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem("wios-fontsize");
    if (saved === "normal" || saved === "large" || saved === "xlarge") return saved;
    return "normal";
  });

  useEffect(() => {
    const syncFontSize = () => {
      const saved = localStorage.getItem("wios-fontsize") || "normal";
      document.documentElement.classList.remove("text-normal", "text-large", "text-xlarge");
      document.documentElement.classList.add(`text-${saved}`);
      setFontSize(saved);
    };
    
    syncFontSize();
    window.addEventListener("fontsize-changed", syncFontSize);
    return () => window.removeEventListener("fontsize-changed", syncFontSize);
  }, []);

  // Global React state containing the 80 locations
  const [locations, setLocations] = useState<Location[]>(() => {
    return initialLocations as Location[];
  });

  // Global React state containing assignments and team members
  const [assignments, setAssignments] = useState<Assignment[]>(() => {
    return initialAssignments as Assignment[];
  });

  const [teamMembers] = useState<TeamMember[]>(() => {
    return initialTeamMembers as TeamMember[];
  });

  // Shared search query state (TopBar updates it, Explorer reads it)
  const [searchQuery, setSearchQuery] = useState("");

  // Shared category filters synced from Dashboard to Explorer
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);

  // Global active states for the sidebar and dashboard focus
  const [activeSidebarItem, setActiveSidebarItem] = useState("Dashboard");
  const [activeSection, setActiveSection] = useState("all");
  const [dashboardMapLayer, setDashboardMapLayer] = useState<"stress" | "groundwater" | "rainfall" | "density">("stress");

  // Callback to update a location's properties (lead stage / notes)
  const handleUpdateLocation = (updatedLoc: Location) => {
    setLocations((prev) =>
      prev.map((loc) => (loc.id === updatedLoc.id ? updatedLoc : loc))
    );
  };

  // Synchronize Google Place discovered organizations with master state
  const handleSyncLocations = (syncedList: Location[]) => {
    setLocations((prev) => {
      const copy = [...prev];
      syncedList.forEach((synced) => {
        let index = -1;
        if (synced.placeId) {
          index = copy.findIndex((loc) => loc.placeId === synced.placeId);
        }
        
        if (index === -1) {
          index = copy.findIndex((loc) => loc.name.toLowerCase() === synced.name.toLowerCase());
        }

        if (index !== -1) {
          // Exists: update
          copy[index] = {
            ...copy[index],
            ...synced,
            id: copy[index].id,
          };
        } else {
          // Insert as a new organization
          const numericIds = copy
            .map((loc) => parseInt(loc.id.replace(/\D/g, "")))
            .filter((num) => !isNaN(num));
          const maxId = numericIds.length > 0 ? Math.max(...numericIds) : 100;
          const nextId = `LOC-${maxId + 1}`;

          copy.push({
            ...synced,
            id: nextId,
          });
        }
      });
      return copy;
    });
  };

  // Callback to update or add a work assignment, maintaining sync with lead stage
  const handleUpdateAssignment = (updatedAssign: Assignment) => {
    setAssignments((prev) => {
      const exists = prev.some((a) => a.locationId === updatedAssign.locationId);
      if (exists) {
        return prev.map((a) => (a.locationId === updatedAssign.locationId ? updatedAssign : a));
      } else {
        return [...prev, updatedAssign];
      }
    });

    // Sync location lead stage based on assignment status
    setLocations((prevLocations) =>
      prevLocations.map((loc) => {
        if (loc.id === updatedAssign.locationId) {
          let mappedStage: LeadStage = "Identified";
          switch (updatedAssign.currentStatus) {
            case "Not Started":
              mappedStage = "Identified";
              break;
            case "Contacted":
            case "Site Visit Scheduled":
              mappedStage = "Contacted";
              break;
            case "Proposal Drafting":
            case "Proposal Sent":
            case "Negotiation":
              mappedStage = "Proposal Sent";
              break;
            case "Won":
              mappedStage = "Won";
              break;
            case "Lost":
              mappedStage = "Lost";
              break;
            case "On Hold":
              mappedStage = "Identified";
              break;
          }
          return { ...loc, leadStage: mappedStage };
        }
        return loc;
      })
    );
  };

  return (
    <HashRouter>
      <PageShell 
        searchQuery={searchQuery} 
        setSearchQuery={setSearchQuery}
        activeSidebarItem={activeSidebarItem}
        setActiveSidebarItem={setActiveSidebarItem}
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        dashboardMapLayer={dashboardMapLayer}
        setDashboardMapLayer={setDashboardMapLayer}
        theme={theme}
        setTheme={setTheme}
      >
        <Routes>
          {/* Dashboard Route */}
          <Route
            path="/dashboard"
            element={
              <Dashboard 
                locations={locations} 
                assignments={assignments} 
                teamMembers={teamMembers} 
                onUpdateAssignment={handleUpdateAssignment}
                activeSection={activeSection}
                setActiveSection={setActiveSection}
                dashboardMapLayer={dashboardMapLayer}
                setDashboardMapLayer={setDashboardMapLayer}
                selectedCategories={selectedCategories}
                setSelectedCategories={setSelectedCategories}
                setActiveSidebarItem={setActiveSidebarItem}
                searchQuery={searchQuery}
              />
            }
          />

          {/* Infrastructure Explorer Route */}
          <Route
            path="/explorer"
            element={
              <Explorer
                locations={locations}
                assignments={assignments}
                teamMembers={teamMembers}
                onUpdateLocation={handleUpdateLocation}
                onUpdateAssignment={handleUpdateAssignment}
                searchQuery={searchQuery}
                selectedCategories={selectedCategories}
                setSelectedCategories={setSelectedCategories}
              />
            }
          />

          {/* Work CRM Board Route */}
          <Route
            path="/assignments"
            element={
              <Assignments
                locations={locations}
                assignments={assignments}
                teamMembers={teamMembers}
                onUpdateLocation={handleUpdateLocation}
                onUpdateAssignment={handleUpdateAssignment}
              />
            }
          />

          {/* Data Lake Sync Route */}
          <Route
            path="/monitoring"
            element={<Monitoring locations={locations} theme={theme} />}
          />

          {/* Funding Intelligence Route */}
          <Route
            path="/funding"
            element={<Funding teamMembers={teamMembers} theme={theme} />}
          />

          {/* Maps & Spatial Intelligence Route */}
          <Route
            path="/maps"
            element={
              <Maps 
                locations={locations} 
                assignments={assignments}
                teamMembers={teamMembers}
                onSyncLocations={handleSyncLocations} 
                onUpdateAssignment={handleUpdateAssignment}
                theme={theme} 
              />
            }
          />

          {/* Analytics Route */}
          <Route
            path="/analytics"
            element={<Analytics locations={locations} theme={theme} />}
          />

          {/* Projects Tracking Route */}
          <Route
            path="/projects"
            element={<Projects locations={locations} assignments={assignments} theme={theme} />}
          />

          {/* Operations Center Route */}
          <Route
            path="/operations"
            element={<Operations locations={locations} teamMembers={teamMembers} theme={theme} />}
          />

          {/* Reports & Exports Route */}
          <Route
            path="/reports"
            element={<Reports locations={locations} theme={theme} />}
          />

          {/* AI Intelligence Route */}
          <Route
            path="/ai"
            element={<AI locations={locations} theme={theme} />}
          />

          {/* Administration Route */}
          <Route
            path="/admin"
            element={<Admin teamMembers={teamMembers} theme={theme} />}
          />

          {/* Default Route Fallbacks */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </PageShell>
    </HashRouter>
  );
}
