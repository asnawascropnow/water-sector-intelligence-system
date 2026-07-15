import React, { useState } from "react";
import { 
  Briefcase, 
  CheckCircle2, 
  Clock, 
  MapPin, 
  ClipboardList, 
  Compass, 
  CheckSquare, 
  ChevronRight, 
  AlertCircle,
  FileSpreadsheet,
  ArrowUpRight
} from "lucide-react";
import { Location, Assignment } from "../data/mockData.types";

interface ProjectsProps {
  locations: Location[];
  assignments: Assignment[];
  theme?: "light" | "dark";
}

interface ProjectTask {
  id: string;
  name: string;
  location: string;
  surveyor: string;
  status: "Completed" | "In Progress" | "Pending";
  progress: number;
  startDate: string;
}

export default function Projects({ locations, assignments, theme }: ProjectsProps) {
  const [activeTab, setActiveTab] = useState<"all" | "active" | "surveys" | "proposal">("all");

  // Simulated projects data based on locations/assignments
  const [projectsList, setProjectsList] = useState<ProjectTask[]>([
    { id: "PRJ-001", name: "REVA University Harvesting System Installation", location: "Reva University, Bengaluru", surveyor: "D. Madhan", status: "In Progress", progress: 68, startDate: "2026-06-01" },
    { id: "PRJ-002", name: "Alliance University Borewell Recharging Setup", location: "Alliance University, Anekal", surveyor: "S. Raghavan", status: "Completed", progress: 100, startDate: "2026-05-15" },
    { id: "PRJ-003", name: "Apollo Hospital Rooftop Redirection", location: "Apollo Jayanagar, Bengaluru", surveyor: "D. Madhan", status: "Pending", progress: 0, startDate: "2026-07-20" },
    { id: "PRJ-004", name: "Ahmedabad Textile Mill Catchment Survey", location: "Ahmedabad Textile Industry", surveyor: "R. Mehta", status: "In Progress", progress: 40, startDate: "2026-06-18" },
    { id: "PRJ-005", name: "Baldwin Girls High School Tank Sizing", location: "Baldwin Girls High School", surveyor: "S. Raghavan", status: "Completed", progress: 100, startDate: "2026-05-10" },
    { id: "PRJ-006", name: "Bangalore Brewery Filtration Layout", location: "Bangalore Brewery Kalyani", surveyor: "H. Kumar", status: "In Progress", progress: 15, startDate: "2026-07-02" },
  ]);

  // Survey checklist item simulator state
  const [surveyChecks, setSurveyChecks] = useState([
    { id: "chk1", label: "Initial site coordinate verification", checked: true },
    { id: "chk2", label: "Topography and soil absorption testing", checked: true },
    { id: "chk3", label: "Roof surface area laser survey", checked: false },
    { id: "chk4", label: "Annual rainfall index calculation", checked: false },
    { id: "chk5", label: "Pre-filtration channel layout draft", checked: false },
  ]);

  const toggleCheck = (id: string) => {
    setSurveyChecks(prev => prev.map(c => c.id === id ? { ...c, checked: !c.checked } : c));
  };

  const filteredProjects = activeTab === "all" 
    ? projectsList
    : activeTab === "active"
    ? projectsList.filter(p => p.status === "In Progress")
    : activeTab === "surveys"
    ? projectsList.filter(p => p.progress < 50)
    : projectsList.filter(p => p.status === "Completed");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="projects-page-container">
      {/* Page Header Card */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-700 dark:text-indigo-400">
              <Briefcase size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">Projects Tracking Center</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Monitor engineering progress, on-site surveys, and RWH infrastructure rollout timelines.
          </p>
        </div>

        {/* Navigation Tabs */}
        <div className="flex bg-slate-100 dark:bg-zinc-900 p-0.5 rounded-md text-xs font-semibold gap-1 border border-slate-200 dark:border-zinc-800">
          <button 
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer ${
              activeTab === "all" ? "bg-white dark:bg-zinc-800 shadow-xs text-indigo-600 dark:text-indigo-400" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            All Projects
          </button>
          <button 
            onClick={() => setActiveTab("active")}
            className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer ${
              activeTab === "active" ? "bg-white dark:bg-zinc-800 shadow-xs text-indigo-600 dark:text-indigo-400" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Active
          </button>
          <button 
            onClick={() => setActiveTab("surveys")}
            className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer ${
              activeTab === "surveys" ? "bg-white dark:bg-zinc-800 shadow-xs text-indigo-600 dark:text-indigo-400" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Surveys
          </button>
          <button 
            onClick={() => setActiveTab("proposal")}
            className={`px-3 py-1.5 rounded-sm transition-all cursor-pointer ${
              activeTab === "proposal" ? "bg-white dark:bg-zinc-800 shadow-xs text-indigo-600 dark:text-indigo-400" : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
            }`}
          >
            Completed
          </button>
        </div>
      </div>

      {/* Projects Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <ClipboardList size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Total Active Projects</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">3 Underway</p>
            <p className="text-[9px] text-indigo-650 font-semibold mt-1">Installation teams on site</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Completed Deployments</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">2 Handed Over</p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">100% compliant harvesting</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <Compass size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Site Surveys Booked</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">5 In Queue</p>
            <p className="text-[9px] text-amber-600 font-semibold mt-1">Geological testing planned</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 p-3 rounded-md border border-red-100/40 dark:border-red-900/20">
            <AlertCircle size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Pipeline Bottlenecks</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">0 Escalations</p>
            <p className="text-[9px] text-green-600 font-semibold mt-1">All material schedules on-time</p>
          </div>
        </div>
      </div>

      {/* Main Grid Splits: Project Queue and Interactive Checkbox */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Project Pipeline List */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-8 space-y-4">
          <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
            <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
              <Briefcase size={16} className="text-indigo-600 dark:text-indigo-400" />
              Active Infrastructure Pipeline
            </h4>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded">Vanguard Execution</span>
          </div>

          <div className="space-y-3.5">
            {filteredProjects.map((prj) => (
              <div 
                key={prj.id}
                className="p-3.5 bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-850/80 rounded-md text-xs space-y-3 transition-all hover:border-slate-300 dark:hover:border-zinc-800"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-slate-400 font-bold">{prj.id}</span>
                      <h5 className="font-bold text-slate-900 dark:text-zinc-100 text-[12.5px]">{prj.name}</h5>
                    </div>
                    <p className="text-[10.5px] text-slate-500 dark:text-zinc-400 flex items-center gap-1 mt-0.5">
                      <MapPin size={11} className="text-slate-450" />
                      {prj.location}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 font-mono font-bold rounded uppercase text-[9px] border ${
                    prj.status === "Completed"
                      ? "bg-emerald-50 dark:bg-emerald-950/25 text-emerald-700 dark:text-emerald-450 border-emerald-100 dark:border-emerald-900/25"
                      : prj.status === "Pending"
                      ? "bg-slate-100 dark:bg-zinc-850 text-slate-500 border-slate-200"
                      : "bg-indigo-50 dark:bg-indigo-950/25 text-indigo-700 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/25 animate-pulse"
                  }`}>
                    {prj.status}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-slate-500">
                    <span>Engineering Progress Tracker</span>
                    <span className="font-bold font-mono">{prj.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-100 dark:bg-zinc-900 h-2 rounded-full overflow-hidden border border-slate-200/40 dark:border-zinc-800">
                    <div 
                      className={`h-full transition-all duration-300 ${
                        prj.status === "Completed" ? "bg-emerald-500" : "bg-indigo-600"
                      }`}
                      style={{ width: `${prj.progress}%` }}
                    ></div>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px] text-slate-400 pt-1.5 border-t border-slate-100 dark:border-zinc-850/50">
                  <span>Assigned Engineer: <strong className="text-slate-600 dark:text-zinc-300">{prj.surveyor}</strong></span>
                  <span>Start Date: <strong className="text-slate-600 dark:text-zinc-300">{prj.startDate}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Interactive Site Survey Checklist */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <CheckSquare size={16} className="text-indigo-600 dark:text-indigo-400" />
                Live Survey Auditing
              </h4>
              <span className="text-[10px] font-mono text-emerald-600 font-semibold bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-100/40">Checklist</span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-zinc-400 leading-relaxed">
              Use this checklist during on-site inspections to verify raw geographic points before triggering formal proposals.
            </p>

            <div className="space-y-2.5 pt-1.5">
              {surveyChecks.map((check) => (
                <div 
                  key={check.id}
                  onClick={() => toggleCheck(check.id)}
                  className="flex items-start gap-2.5 p-2 bg-slate-50 dark:bg-zinc-900/40 hover:bg-slate-100/80 dark:hover:bg-zinc-900 border border-slate-200 dark:border-zinc-850 rounded-md text-xs cursor-pointer select-none transition-colors"
                >
                  <input 
                    type="checkbox" 
                    checked={check.checked}
                    onChange={() => {}} // toggled by outer div
                    className="mt-0.5 accent-indigo-600 h-3.5 w-3.5 cursor-pointer rounded-sm"
                  />
                  <span className={`text-[11.5px] leading-tight ${check.checked ? "line-through text-slate-400 dark:text-zinc-550 font-medium" : "text-slate-800 dark:text-zinc-200 font-semibold"}`}>
                    {check.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-3.5 border-t border-slate-100 dark:border-zinc-850/80">
            <button 
              onClick={() => {
                setSurveyChecks(prev => prev.map(c => ({ ...c, checked: false })));
              }}
              className="w-full text-center border border-slate-200 dark:border-zinc-800 hover:bg-slate-50 dark:hover:bg-zinc-900 font-bold py-2 rounded-md text-xs transition-colors cursor-pointer text-slate-650 dark:text-zinc-350"
            >
              Reset Audit Checklist
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
