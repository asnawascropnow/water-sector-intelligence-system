import React, { useState } from "react";
import { 
  Settings, 
  Users, 
  ShieldAlert, 
  ToggleLeft, 
  ToggleRight, 
  UserPlus, 
  CheckCircle2, 
  Search, 
  Sliders, 
  ShieldCheck,
  Lock,
  RefreshCw
} from "lucide-react";
import { TeamMember } from "../data/mockData.types";

interface AdminProps {
  teamMembers: TeamMember[];
  theme?: "light" | "dark";
}

interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: "Hydrologist" | "Liaison" | "Director" | "Administrator";
  status: "Active" | "Inactive";
}

export default function Admin({ teamMembers, theme }: AdminProps) {
  // User Directory State
  const [users, setUsers] = useState<AdminUser[]>([
    { id: "USR-01", name: "D. Madhan", email: "madhan@croponow.com", role: "Hydrologist", status: "Active" },
    { id: "USR-02", name: "S. Raghavan", email: "raghavan@croponow.com", role: "Hydrologist", status: "Active" },
    { id: "USR-03", name: "R. Mehta", email: "mehta@croponow.com", role: "Liaison", status: "Active" },
    { id: "USR-04", name: "H. Kumar", email: "kumar@croponow.com", role: "Hydrologist", status: "Active" },
    { id: "USR-05", name: "G. Srinivasan", email: "srinivasan@croponow.com", role: "Director", status: "Active" },
  ]);

  const [searchQuery, setSearchQuery] = useState("");

  const toggleUserStatus = (id: string) => {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, status: u.status === "Active" ? "Inactive" : "Active" } : u));
  };

  // Role Policies Toggles
  const [policies, setPolicies] = useState([
    { id: "pol1", name: "Export audited location data to raw CSV/XLSX", checked: true },
    { id: "pol2", name: "Alter lead stages in Work CRM boards", checked: true },
    { id: "pol3", name: "Trigger GCS Data Lake to Production database ETL", checked: false },
    { id: "pol4", name: "Re-calibrate satellite spectral index thresholds", checked: false },
    { id: "pol5", name: "Authorize third-party API keys integrations", checked: false },
  ]);

  const togglePolicy = (id: string) => {
    setPolicies(prev => prev.map(p => p.id === id ? { ...p, checked: !p.checked } : p));
  };

  // System Config Settings
  const [liveSync, setLiveSync] = useState(true);
  const [airflowCron, setAirflowCron] = useState(true);

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="admin-page-container">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-700 dark:text-indigo-400">
              <Settings size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">Platform Administration</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Control member directory listings, adjust operational role policies, and configure core GIS ingestion parameters.
          </p>
        </div>
      </div>

      {/* Top statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-[#1f1f23] p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-650 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40">
            <Users size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Active Users</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">5 Mapped Profiles</p>
            <p className="text-[9px] text-indigo-600 font-semibold mt-1">All roles authorized</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40">
            <ShieldCheck size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Security Access Level</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">Role-Based (RBAC)</p>
            <p className="text-[9px] text-emerald-650 font-semibold mt-1">Audit log engine enabled</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40">
            <Lock size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">System Policies</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">5 Core Guidelines</p>
            <p className="text-[9px] text-slate-500 mt-1">Compliance matrices validated</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 p-3 rounded-md border border-purple-100/40">
            <RefreshCw size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Ingestion Gateway</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">Active</p>
            <p className="text-[9px] text-purple-600 font-semibold mt-1">SSL Certificate valid</p>
          </div>
        </div>
      </div>

      {/* Admin splits: User directory (Left) and Policies / General Settings (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* User directory panel */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-7 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Users size={16} className="text-indigo-600 dark:text-indigo-400" />
                Staff Directory Registry
              </h4>
              <button 
                onClick={() => {
                  alert("Member creation flow initialized.");
                }}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded flex items-center gap-1 cursor-pointer border-0"
              >
                <UserPlus size={12} />
                <span>Invite Member</span>
              </button>
            </div>

            {/* Quick search */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                <Search size={13} />
              </span>
              <input 
                type="text" 
                placeholder="Search platform users..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs bg-slate-50 dark:bg-zinc-950 border border-slate-250 dark:border-zinc-850 rounded pl-9 pr-3 py-2"
              />
            </div>

            {/* Members Directory Table */}
            <div className="overflow-x-auto border border-slate-150 dark:border-zinc-850 rounded-md">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-850 text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                    <th className="p-3">Staff Identity</th>
                    <th className="p-3">Assigned Role</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center">Permissions Actuator</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-zinc-850/80 text-slate-700 dark:text-zinc-300">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/40">
                      <td className="p-3">
                        <p className="font-bold text-slate-900 dark:text-zinc-50">{u.name}</p>
                        <p className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">{u.email}</p>
                      </td>
                      <td className="p-3 font-semibold text-slate-650 dark:text-zinc-350">{u.role}</td>
                      <td className="p-3 text-center">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase border ${
                          u.status === "Active"
                            ? "bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-950/20 dark:text-emerald-400"
                            : "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/20 dark:text-red-400"
                        }`}>
                          {u.status}
                        </span>
                      </td>
                      <td className="p-3 text-center">
                        <button 
                          onClick={() => toggleUserStatus(u.id)}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer border-0 bg-transparent"
                        >
                          {u.status === "Active" ? "Deactivate" : "Activate"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* System Settings and Roles Policies checklist */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Sliders size={16} className="text-indigo-600" />
                Role Policy Actuators
              </h4>
              <span className="text-[10px] font-mono text-slate-550 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded border">Security Editor</span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-zinc-455 leading-relaxed">
              Adjust compliance policies dynamically across hydrology and liaison access pools. Changes write instantly to cloud RBAC schemas.
            </p>

            <div className="space-y-3 pt-1.5">
              {policies.map((p) => (
                <div 
                  key={p.id}
                  onClick={() => togglePolicy(p.id)}
                  className="flex items-start gap-2.5 p-2 bg-slate-50 dark:bg-zinc-900/40 hover:bg-slate-100/80 dark:hover:bg-zinc-900/80 border border-slate-200 dark:border-zinc-850 rounded-md text-xs cursor-pointer select-none transition-colors"
                >
                  <input 
                    type="checkbox" 
                    checked={p.checked}
                    onChange={() => {}} // toggled by outer div
                    className="mt-0.5 accent-indigo-650 h-3.5 w-3.5 cursor-pointer rounded-sm"
                  />
                  <span className={`text-[11px] leading-tight ${p.checked ? "text-slate-800 dark:text-zinc-200 font-bold" : "text-slate-400 dark:text-zinc-550 font-medium"}`}>
                    {p.name}
                  </span>
                </div>
              ))}
            </div>

            {/* General System Config */}
            <div className="border-t border-slate-100 dark:border-zinc-850/80 pt-4 space-y-3.5">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">General GIS Engine Config</h4>
              
              <div className="flex items-center justify-between text-xs">
                <div>
                  <p className="font-bold text-slate-900 dark:text-zinc-50">Enterprise Live-Sync Gateway</p>
                  <p className="text-[10px] text-slate-400">Stream spatial changes directly to central GIS registers</p>
                </div>
                <button 
                  onClick={() => setLiveSync(!liveSync)}
                  className="text-slate-500 dark:text-zinc-400 cursor-pointer border-0 bg-transparent"
                >
                  {liveSync ? <ToggleRight size={32} className="text-indigo-650" /> : <ToggleLeft size={32} />}
                </button>
              </div>

              <div className="flex items-center justify-between text-xs">
                <div>
                  <p className="font-bold text-slate-900 dark:text-zinc-50">Apache Airflow Sync Cronjobs</p>
                  <p className="text-[10px] text-slate-400">Trigger automatic crawler fetches daily at 02:00 AM</p>
                </div>
                <button 
                  onClick={() => setAirflowCron(!airflowCron)}
                  className="text-slate-500 dark:text-zinc-400 cursor-pointer border-0 bg-transparent"
                >
                  {airflowCron ? <ToggleRight size={32} className="text-indigo-650" /> : <ToggleLeft size={32} />}
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
