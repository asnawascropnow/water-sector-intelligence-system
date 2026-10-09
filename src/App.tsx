import React from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppProvider } from "./context/AppContext";
import Layout from "./components/layout/Layout";
import Dashboard from "./pages/Dashboard";
import MapPage from "./pages/MapPage";
import Organizations from "./pages/Organizations";
import Projects from "./pages/Projects";
import ProjectDetails from "./pages/ProjectDetails";
import OrganizationDetails from "./pages/OrganizationDetails";
import ImportData from "./pages/ImportData";
import CRM from "./pages/CRM";
import OpportunityDetails from "./pages/OpportunityDetails";
import Tasks from "./pages/Tasks";
import AIRecommendations from "./pages/AIRecommendations";
import Settings from "./pages/Settings";
import EmailCampaigns from "./pages/EmailCampaigns";
import EmailCampaign from "./pages/EmailCampaign";

export default function App() {
  return (
    <AppProvider>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/organizations" element={<Organizations />} />
            <Route path="/organizations/:id" element={<OrganizationDetails />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetails />} />
            <Route path="/import" element={<ImportData />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/crm/:id" element={<OpportunityDetails />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/ai" element={<AIRecommendations />} />
            <Route path="/email" element={<EmailCampaigns />} />
            <Route path="/email/:id" element={<EmailCampaign />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Layout>
      </HashRouter>
    </AppProvider>
  );
}
