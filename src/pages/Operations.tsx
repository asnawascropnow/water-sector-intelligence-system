import React, { useState } from "react";
import { 
  Activity, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Calendar, 
  Users, 
  Clock, 
  CheckSquare, 
  ChevronRight,
  TrendingUp,
  AlertTriangle,
  UserCheck
} from "lucide-react";
import { Location, TeamMember } from "../data/mockData.types";

interface OperationsProps {
  locations: Location[];
  teamMembers: TeamMember[];
  theme?: "light" | "dark";
}

interface InteractiveTask {
  id: string;
  title: string;
  assignee: string;
  dueDate: string;
  completed: boolean;
  priority: "High" | "Medium" | "Low";
}

export default function Operations({ locations, teamMembers, theme }: OperationsProps) {
  // Interactive Task Queue State
  const [tasks, setTasks] = useState<InteractiveTask[]>([
    { id: "TSK-001", title: "Review Reva University water flow calculations", assignee: "D. Madhan", dueDate: "2026-07-15", completed: false, priority: "High" },
    { id: "TSK-002", title: "Confirm Ahmedabad site survey schedules with mill management", assignee: "R. Mehta", dueDate: "2026-07-16", completed: true, priority: "Medium" },
    { id: "TSK-003", title: "Submit ESG alignment proposal to Apollo Jayanagar team", assignee: "S. Raghavan", dueDate: "2026-07-18", completed: false, priority: "High" },
    { id: "TSK-004", title: "Re-calibrate satellite spectral index thresholds", assignee: "H. Kumar", dueDate: "2026-07-20", completed: false, priority: "Low" },
  ]);

  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState(teamMembers[0]?.name || "D. Madhan");
  const [newTaskPriority, setNewTaskPriority] = useState<"High" | "Medium" | "Low">("Medium");

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;
    
    const task: InteractiveTask = {
      id: `TSK-${String(tasks.length + 1).padStart(3, "0")}`,
      title: newTaskTitle,
      assignee: newTaskAssignee,
      dueDate: new Date(Date.now() + 86400000 * 2).toISOString().split("T")[0], // default 2 days out
      completed: false,
      priority: newTaskPriority
    };

    setTasks([task, ...tasks]);
    setNewTaskTitle("");
  };

  const toggleTaskCompleted = (id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, completed: !t.completed } : t));
  };

  const handleDeleteTask = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  // Calendar Schedule mock items
  const calendarEvents = [
    { id: "evt1", title: "Reva Univ Site Survey Kickoff", date: "2026-07-14", time: "10:30 AM", type: "On-site" },
    { id: "evt2", title: "Apollo Jayanagar Proposal Sync", date: "2026-07-16", time: "02:00 PM", type: "Virtual" },
    { id: "evt3", title: "Peenya Industrial Core Inspection", date: "2026-07-17", time: "09:00 AM", type: "On-site" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="operations-page-container">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-700 dark:text-indigo-400">
              <Activity size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">Operations Control Center</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Orchestrate workforce deployments, track team tasks, and sync schedule calendar entries.
          </p>
        </div>
      </div>

      {/* Top operational metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <UserCheck size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Field Staff Mapped</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">{teamMembers.length} Specialists</p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">All agents active on-site</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <CheckSquare size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Operations Task Backlog</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {tasks.filter(t => !t.completed).length} Tasks Pending
            </p>
            <p className="text-[9px] text-slate-500 mt-1">Continuously triaged</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <Calendar size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Site Visits Scheduled</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">3 This Week</p>
            <p className="text-[9px] text-amber-600 font-semibold mt-1">Inspection gear calibrated</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 p-3 rounded-md border border-purple-100/40 dark:border-purple-900/20">
            <TrendingUp size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Closeout Rate</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">92% Average</p>
            <p className="text-[9px] text-indigo-650 font-semibold mt-1">Project cycle times minimized</p>
          </div>
        </div>
      </div>

      {/* Grid splits: Interactive Task Queue (Left) and Operations Calendar (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Interactive Task Queue */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-8 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <CheckSquare size={16} className="text-indigo-600 dark:text-indigo-400" />
                Specialists Task Queue Controller
              </h4>
              <span className="text-[10px] font-mono text-slate-550 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded border">Live Engine</span>
            </div>

            {/* Interactive Form */}
            <form onSubmit={handleAddTask} className="grid grid-cols-1 md:grid-cols-12 gap-2.5 p-3.5 bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-850 rounded-md">
              <div className="md:col-span-6">
                <input 
                  type="text" 
                  placeholder="Describe a new operational task..."
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded px-3 py-2"
                />
              </div>
              <div className="md:col-span-3">
                <select 
                  value={newTaskAssignee}
                  onChange={(e) => setNewTaskAssignee(e.target.value)}
                  className="w-full text-xs bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded px-2 py-2"
                >
                  {teamMembers.map(tm => (
                    <option key={tm.id} value={tm.name}>{tm.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <select 
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(e.target.value as any)}
                  className="w-full text-xs bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded px-2 py-2"
                >
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <button 
                  type="submit"
                  className="w-full bg-indigo-650 hover:bg-indigo-600 text-white font-bold py-2 rounded flex items-center justify-center transition-colors shadow-xs cursor-pointer"
                >
                  <Plus size={15} />
                </button>
              </div>
            </form>

            {/* Interactive List */}
            <div className="space-y-2">
              {tasks.map((task) => (
                <div 
                  key={task.id}
                  className={`flex items-center justify-between p-3 border rounded-md text-xs transition-colors ${
                    task.completed 
                      ? "bg-slate-50/75 border-slate-200 dark:bg-zinc-900/20 dark:border-zinc-850 text-slate-400 dark:text-zinc-550" 
                      : "bg-white border-slate-200 dark:bg-zinc-950 dark:border-zinc-850 text-slate-800 dark:text-zinc-200"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <input 
                      type="checkbox" 
                      checked={task.completed}
                      onChange={() => toggleTaskCompleted(task.id)}
                      className="accent-indigo-650 h-4 w-4 cursor-pointer rounded-sm"
                    />
                    <div className="min-w-0">
                      <p className={`font-bold truncate text-[11.5px] ${task.completed ? "line-through" : ""}`}>
                        {task.title}
                      </p>
                      <p className="text-[10px] text-slate-500 flex items-center gap-1.5 mt-0.5">
                        <span>Assignee: <strong className="text-slate-600 dark:text-zinc-350">{task.assignee}</strong></span>
                        <span className="text-slate-300 dark:text-zinc-700">|</span>
                        <span>Due Date: <strong>{task.dueDate}</strong></span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <span className={`px-1.5 py-0.5 font-mono text-[8.5px] font-extrabold rounded border tracking-wide ${
                      task.priority === "High"
                        ? "bg-red-50 text-red-700 border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/20"
                        : task.priority === "Medium"
                        ? "bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-950/20 dark:text-amber-400 dark:border-amber-900/20"
                        : "bg-slate-50 text-slate-500 border-slate-150"
                    }`}>
                      {task.priority}
                    </span>
                    <button 
                      onClick={() => handleDeleteTask(task.id)}
                      className="text-slate-400 hover:text-red-600 p-1 rounded hover:bg-slate-50 dark:hover:bg-zinc-900 transition-colors cursor-pointer"
                      title="Delete task"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Operational Calendar schedule */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-4 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Calendar size={16} className="text-indigo-600 dark:text-indigo-400" />
                Operational Calendar
              </h4>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded">Timeline</span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-zinc-455 leading-relaxed">
              Upcoming field assignments, verification surveys, and client alignment meetings scheduled this week.
            </p>

            <div className="space-y-3.5 pt-1.5">
              {calendarEvents.map((evt) => (
                <div key={evt.id} className="p-3 bg-slate-50 dark:bg-zinc-900/40 border border-slate-150 dark:border-zinc-850 rounded-md text-xs flex items-start gap-3">
                  <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 p-2 rounded-md font-bold font-mono text-center flex-shrink-0 min-w-[45px]">
                    <span className="block text-[10px] uppercase text-slate-400 font-semibold">Jul</span>
                    <span className="block text-sm leading-none mt-0.5">{evt.date.split("-")[2]}</span>
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <h5 className="font-bold text-slate-900 dark:text-zinc-100 truncate text-[11.5px]">{evt.title}</h5>
                    <p className="text-[10px] text-slate-500 flex items-center gap-1.5">
                      <Clock size={10} />
                      <span>{evt.time}</span>
                      <span className="text-slate-300 dark:text-zinc-750">|</span>
                      <span>Mode: <strong className="text-slate-600 dark:text-zinc-355">{evt.type}</strong></span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-3.5 border-t border-slate-100 dark:border-zinc-850/80">
            <button 
              onClick={() => {
                alert("Calendar synchronization initialized. Google Workspace hooks synced.");
              }}
              className="w-full text-center bg-slate-900 dark:bg-zinc-800 text-white hover:bg-slate-800 dark:hover:bg-zinc-700 font-bold py-2 rounded-md text-xs transition-colors cursor-pointer"
            >
              Sync Workspace Calendar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
