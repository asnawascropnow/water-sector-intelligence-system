import React, { useState } from "react";
import {
  Trello,
  List,
  Search,
  Filter,
  User,
  Calendar,
  AlertCircle,
  MapPin,
  Tag,
  ChevronRight,
  ArrowUpDown,
  Plus,
  HelpCircle,
  SlidersHorizontal,
  ChevronLeft,
  ChevronsRight,
  Sparkles,
} from "lucide-react";
import { Location, Assignment, TeamMember, Priority, WorkStatus, Team } from "../data/mockData.types";
import DetailDrawer from "../components/explorer/DetailDrawer";

interface AssignmentsProps {
  locations: Location[];
  assignments: Assignment[];
  teamMembers: TeamMember[];
  onUpdateLocation: (updated: Location) => void;
  onUpdateAssignment: (updated: Assignment) => void;
  theme?: "light" | "dark";
}

const WORK_STATUSES: WorkStatus[] = [
  "Not Started",
  "Contacted",
  "Site Visit Scheduled",
  "Proposal Drafting",
  "Proposal Sent",
  "Negotiation",
  "Won",
  "Lost",
  "On Hold"
];

const STAGE_COLORS: Record<WorkStatus, { bg: string; text: string; border: string }> = {
  "Not Started": { bg: "bg-slate-100 dark:bg-zinc-900", text: "text-slate-700 dark:text-zinc-300", border: "border-slate-300 dark:border-zinc-800" },
  "Contacted": { bg: "bg-sky-50 dark:bg-sky-950/30", text: "text-sky-700 dark:text-sky-400", border: "border-sky-200 dark:border-sky-900/30" },
  "Site Visit Scheduled": { bg: "bg-indigo-50 dark:bg-indigo-950/30", text: "text-indigo-700 dark:text-indigo-400", border: "border-indigo-200 dark:border-indigo-900/30" },
  "Proposal Drafting": { bg: "bg-purple-50 dark:bg-purple-950/30", text: "text-purple-700 dark:text-purple-400", border: "border-purple-200 dark:border-purple-900/30" },
  "Proposal Sent": { bg: "bg-pink-50 dark:bg-pink-950/30", text: "text-pink-700 dark:text-pink-400", border: "border-pink-200 dark:border-pink-900/30" },
  "Negotiation": { bg: "bg-amber-50 dark:bg-amber-950/30", text: "text-amber-700 dark:text-amber-400", border: "border-amber-200 dark:border-amber-900/30" },
  "Won": { bg: "bg-emerald-50 dark:bg-emerald-950/30", text: "text-emerald-700 dark:text-emerald-400", border: "border-emerald-200 dark:border-emerald-900/30" },
  "Lost": { bg: "bg-rose-50 dark:bg-rose-950/30", text: "text-rose-700 dark:text-rose-400", border: "border-rose-200 dark:border-rose-900/30" },
  "On Hold": { bg: "bg-amber-100 dark:bg-amber-950/40", text: "text-amber-800 dark:text-amber-400", border: "border-amber-300 dark:border-amber-900/30" }
};

export default function Assignments({
  locations,
  assignments,
  teamMembers,
  onUpdateLocation,
  onUpdateAssignment,
  theme,
}: AssignmentsProps) {
  // Page state
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [searchQuery, setSearchQuery] = useState("");
  
  // Advanced Filter state
  const [selectedAssignee, setSelectedAssignee] = useState<string>("All");
  const [selectedPriority, setSelectedPriority] = useState<string>("All");
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Sorting state for Table View
  const [sortField, setSortField] = useState<"name" | "priority" | "assignee" | "status">("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // Drawer state
  const [selectedLoc, setSelectedLoc] = useState<Location | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Drag-and-drop visual indicator state
  const [draggedOverColumn, setDraggedOverColumn] = useState<WorkStatus | null>(null);

  // Check if a date string is in the past compared to "2026-07-10"
  const isOverdue = (dateStr?: string, currentStatus?: WorkStatus) => {
    if (!dateStr) return false;
    const isPast = dateStr < "2026-07-10";
    const isActive = currentStatus !== "Won" && currentStatus !== "Lost";
    return isPast && isActive;
  };

  // Move assignment card to a new stage
  const handleMoveCard = (locationId: string, newStatus: WorkStatus) => {
    const assign = assignments.find((a) => a.locationId === locationId);
    if (assign && assign.currentStatus !== newStatus) {
      const updated: Assignment = {
        ...assign,
        currentStatus: newStatus,
        activityLog: [
          {
            id: `ACT-${Date.now()}`,
            timestamp: new Date().toISOString(),
            author: "System",
            note: `Status updated to ${newStatus} on Kanban board.`
          },
          ...assign.activityLog
        ]
      };
      onUpdateAssignment(updated);
    }
  };

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent, locationId: string) => {
    e.dataTransfer.setData("text/plain", locationId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, status: WorkStatus) => {
    e.preventDefault();
    if (draggedOverColumn !== status) {
      setDraggedOverColumn(status);
    }
  };

  const handleDragLeave = () => {
    setDraggedOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, targetStatus: WorkStatus) => {
    e.preventDefault();
    setDraggedOverColumn(null);
    const locationId = e.dataTransfer.getData("text/plain");
    if (locationId) {
      handleMoveCard(locationId, targetStatus);
    }
  };

  // Card click triggers Detail Drawer (pre-opened in 'assignment' tab)
  const handleCardClick = (locationId: string) => {
    const loc = locations.find((l) => l.id === locationId);
    if (loc) {
      setSelectedLoc(loc);
      setIsDrawerOpen(true);
    }
  };

  // Helper to fetch details
  const getLocDetails = (locationId: string) => {
    return locations.find((l) => l.id === locationId);
  };

  const getMemberDetails = (memberId: string) => {
    return teamMembers.find((m) => m.id === memberId);
  };

  // Filters logic
  const filteredAssignments = assignments.filter((assign) => {
    const loc = getLocDetails(assign.locationId);
    if (!loc) return false;

    // Search query matches client name, address, or district
    const matchesSearch =
      loc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.district.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.address.toLowerCase().includes(searchQuery.toLowerCase());

    // Assignee filter
    const matchesAssignee = selectedAssignee === "All" || assign.assignedToId === selectedAssignee;

    // Priority filter
    const matchesPriority = selectedPriority === "All" || assign.priority === selectedPriority;

    // Category filter
    const matchesCategory = selectedCategory === "All" || loc.category === selectedCategory;

    return matchesSearch && matchesAssignee && matchesPriority && matchesCategory;
  });

  // Table Sorting logic
  const toggleSort = (field: "name" | "priority" | "assignee" | "status") => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedAssignments = [...filteredAssignments].sort((a, b) => {
    const locA = getLocDetails(a.locationId);
    const locB = getLocDetails(b.locationId);
    const memberA = getMemberDetails(a.assignedToId);
    const memberB = getMemberDetails(b.assignedToId);

    if (!locA || !locB) return 0;

    let valA: string = "";
    let valB: string = "";

    switch (sortField) {
      case "name":
        valA = locA.name;
        valB = locB.name;
        break;
      case "priority":
        // Map priorities to numerical weights for comparison (High=3, Med=2, Low=1)
        const priorityWeight = { High: 3, Medium: 2, Low: 1 };
        return sortDirection === "asc"
          ? priorityWeight[a.priority] - priorityWeight[b.priority]
          : priorityWeight[b.priority] - priorityWeight[a.priority];
      case "assignee":
        valA = memberA?.name || "";
        valB = memberB?.name || "";
        break;
      case "status":
        valA = a.currentStatus;
        valB = b.currentStatus;
        break;
    }

    if (sortDirection === "asc") {
      return valA.localeCompare(valB);
    } else {
      return valB.localeCompare(valA);
    }
  });

  // Distinct categories helper
  const uniqueCategories = Array.from(new Set(locations.map((l) => l.category)));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="assignments-page-container">
      {/* Upper Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white dark:bg-[#09090b] p-4 border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm">
        {/* Left: Search & Mode Selector */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-64">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search size={15} />
            </span>
            <input
              type="text"
              placeholder="Search assignments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-[32px] pl-9 pr-3 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 rounded-md text-xs text-slate-900 dark:text-white transition-all outline-none"
            />
          </div>

          <div className="h-[32px] w-[1px] bg-slate-200 dark:bg-zinc-800 hidden sm:block"></div>

          {/* View Toggler */}
          <div className="bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 p-0.5 rounded-md flex gap-0.5">
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md cursor-pointer transition-all ${
                viewMode === "kanban"
                  ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm"
                  : "text-slate-500 dark:text-zinc-450 hover:bg-slate-100 dark:hover:bg-zinc-800"
              }`}
            >
              <Trello size={13} />
              Kanban Board
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md cursor-pointer transition-all ${
                viewMode === "table"
                  ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 shadow-sm"
                  : "text-slate-500 dark:text-zinc-450 hover:bg-slate-100 dark:hover:bg-zinc-800"
              }`}
            >
              <List size={13} />
              Table Directory
            </button>
          </div>
        </div>

        {/* Right: Advanced Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Assignee Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-zinc-400">
            <User size={13} />
            <select
              value={selectedAssignee}
              onChange={(e) => setSelectedAssignee(e.target.value)}
              className="h-[32px] px-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-md font-semibold text-slate-900 dark:text-zinc-50 outline-none"
            >
              <option value="All">All Specialists</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          {/* Priority Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-zinc-400">
            <SlidersHorizontal size={13} />
            <select
              value={selectedPriority}
              onChange={(e) => setSelectedPriority(e.target.value)}
              className="h-[32px] px-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-md font-semibold text-slate-900 dark:text-zinc-50 outline-none"
            >
              <option value="All">All Priorities</option>
              <option value="High">High Priority</option>
              <option value="Medium">Medium Priority</option>
              <option value="Low">Low Priority</option>
            </select>
          </div>

          {/* Category Filter */}
          <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-zinc-400">
            <Tag size={13} />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-[32px] px-2 bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded-md font-semibold text-slate-900 dark:text-zinc-50 outline-none"
            >
              <option value="All">All Categories</option>
              {uniqueCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Board View */}
      {viewMode === "kanban" ? (
        /* ==================== KANBAN BOARD VIEW ==================== */
        <div
          className="flex gap-4 overflow-x-auto pb-4 h-[calc(100vh-220px)] min-h-[480px] align-stretch"
          id="kanban-columns-scroller"
        >
          {WORK_STATUSES.map((status) => {
            const cardsInStage = filteredAssignments.filter((a) => a.currentStatus === status);
            const isDraggedOver = draggedOverColumn === status;

            return (
              <div
                key={status}
                onDragOver={(e) => handleDragOver(e, status)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, status)}
                className={`w-[290px] flex-shrink-0 flex flex-col rounded-md border transition-all ${
                  isDraggedOver
                    ? "bg-emerald-50/10 dark:bg-emerald-950/10 border-emerald-400 dark:border-emerald-600 border-2"
                    : "bg-slate-50 dark:bg-zinc-900/40 border-slate-200 dark:border-zinc-850"
                }`}
              >
                {/* Column Header */}
                <div className="p-3 flex items-center justify-between border-b border-slate-200 dark:border-zinc-850/80 bg-white dark:bg-zinc-950 rounded-t-md select-none">
                  <div className="flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      status === "Won" ? "bg-emerald-500" :
                      status === "Lost" ? "bg-red-500" :
                      status === "Negotiation" ? "bg-amber-500" : "bg-slate-400 dark:bg-zinc-500"
                    }`}></span>
                    <h4 className="text-[12px] font-bold text-slate-900 dark:text-zinc-50 leading-tight">
                      {status}
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-100 dark:bg-zinc-900 text-slate-800 dark:text-zinc-300 rounded-full">
                    {cardsInStage.length}
                  </span>
                </div>

                {/* Cards Container */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2.5 max-h-full">
                  {cardsInStage.length === 0 ? (
                    <div className="py-12 text-center text-[11px] text-slate-500 dark:text-zinc-500 italic">
                      No cards in stage
                    </div>
                  ) : (
                    cardsInStage.map((card) => {
                      const loc = getLocDetails(card.locationId);
                      const member = getMemberDetails(card.assignedToId);
                      if (!loc) return null;

                      const overdue = isOverdue(card.nextFollowUpDate, card.currentStatus);

                      return (
                        <div
                          key={card.locationId}
                          draggable
                          onDragStart={(e) => handleDragStart(e, card.locationId)}
                          onClick={() => handleCardClick(card.locationId)}
                          className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 hover:border-indigo-600 dark:hover:border-indigo-400 hover:shadow-md rounded-md p-3 cursor-grab active:cursor-grabbing transition-all select-none space-y-3 relative group"
                        >
                          {/* Top row: Priority & Quick move trigger */}
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wide border ${
                                card.priority === "High"
                                  ? "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/35"
                                  : card.priority === "Medium"
                                  ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/35"
                                  : "bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-400 border-slate-200 dark:border-zinc-800"
                              }`}
                            >
                              {card.priority} Priority
                            </span>
                            
                            {/* Inline quick mover menu for accessibility without drag */}
                            <select
                              value={card.currentStatus}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => handleMoveCard(card.locationId, e.target.value as WorkStatus)}
                              className="text-[9px] bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-1 text-slate-500 dark:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity outline-none"
                              title="Move stage"
                            >
                              {WORK_STATUSES.map((st) => (
                                <option key={st} value={st}>{st}</option>
                              ))}
                            </select>
                          </div>

                          {/* Client Title */}
                          <h5 className="text-[12px] font-bold text-slate-900 dark:text-zinc-50 leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                            {loc.name}
                          </h5>

                          {/* Meta parameters: District / Category */}
                          <div className="flex flex-wrap gap-1 items-center text-[10px] text-slate-500 dark:text-zinc-400">
                            <span className="flex items-center gap-0.5 bg-slate-50 dark:bg-zinc-900 px-1 py-0.5 rounded-md border border-slate-100 dark:border-zinc-850/60">
                              <MapPin size={9} /> {loc.district}
                            </span>
                            <span className="flex items-center gap-0.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 px-1 py-0.5 rounded-md border border-indigo-100 dark:border-indigo-900/20">
                              {loc.category}
                            </span>
                          </div>

                          <div className="h-[1px] bg-slate-100 dark:bg-zinc-850/60"></div>

                          {/* Footer parameters: Assignee & Follow Up */}
                          <div className="flex items-center justify-between text-[11px]">
                            {/* Representative Avatar & Name */}
                            <div className="flex items-center gap-1.5 min-w-0" title={member?.name}>
                              <div className="w-5 h-5 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center font-bold text-[8px] flex-shrink-0">
                                {member?.name.split(" ").map(w => w[0]).join("")}
                              </div>
                              <span className="text-slate-800 dark:text-zinc-200 truncate font-medium max-w-[90px]">
                                {member?.name}
                              </span>
                            </div>

                            {/* Date */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <Calendar size={11} className={overdue ? "text-rose-500" : "text-slate-400"} />
                              <span
                                className={`font-mono text-[10px] ${
                                  overdue ? "text-rose-600 dark:text-rose-400 font-bold" : "text-slate-500 dark:text-zinc-500"
                                }`}
                                title={overdue ? "Follow-up is OVERDUE" : "Next follow-up"}
                              >
                                {card.nextFollowUpDate}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ==================== TABLE DIRECTORY VIEW ==================== */
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse" id="assignments-table-element">
            <thead>
              <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-850 text-[11px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider select-none">
                <th
                  onClick={() => toggleSort("name")}
                  className="p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Location Name / Client</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="p-4">District</th>
                <th className="p-4">Category</th>
                <th
                  onClick={() => toggleSort("assignee")}
                  className="p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Specialist</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="p-4">Team</th>
                <th
                  onClick={() => toggleSort("priority")}
                  className="p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Priority</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="p-4">Next Follow Up</th>
                <th
                  onClick={() => toggleSort("status")}
                  className="p-4 cursor-pointer hover:bg-slate-100 dark:hover:bg-zinc-900 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <span>Pipeline Status</span>
                    <ArrowUpDown size={12} />
                  </div>
                </th>
                <th className="p-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-850/80 text-xs text-slate-700 dark:text-zinc-300">
              {sortedAssignments.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-slate-500 dark:text-zinc-500 italic">
                     No active assignments match search or filters.
                  </td>
                </tr>
              ) : (
                sortedAssignments.map((assign) => {
                  const loc = getLocDetails(assign.locationId);
                  const member = getMemberDetails(assign.assignedToId);
                  if (!loc) return null;

                  const overdue = isOverdue(assign.nextFollowUpDate, assign.currentStatus);

                  return (
                    <tr
                      key={assign.locationId}
                      onClick={() => handleCardClick(assign.locationId)}
                      className="hover:bg-slate-50/60 dark:hover:bg-zinc-900/40 transition-colors cursor-pointer"
                    >
                      {/* Name */}
                      <td className="p-4 font-bold text-slate-900 dark:text-zinc-50 max-w-[200px] truncate">
                        {loc.name}
                      </td>

                      {/* District */}
                      <td className="p-4 text-slate-500 dark:text-zinc-400">{loc.district}</td>

                      {/* Category */}
                      <td className="p-4">
                        <span className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-md uppercase text-[10px] font-semibold border border-indigo-100 dark:border-indigo-900/20">
                          {loc.category}
                        </span>
                      </td>

                      {/* Specialist */}
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          <div className="w-5 h-5 rounded-full bg-indigo-600 dark:bg-indigo-500 text-white flex items-center justify-center font-bold text-[8px]">
                            {member?.name.split(" ").map(w => w[0]).join("")}
                          </div>
                          <span className="font-medium text-slate-800 dark:text-zinc-200">{member?.name}</span>
                        </div>
                      </td>

                      {/* Team */}
                      <td className="p-4 text-slate-500 dark:text-zinc-500 font-mono text-[11px]">{assign.team}</td>

                      {/* Priority */}
                      <td className="p-4">
                        <span
                          className={`text-[9px] font-bold px-2 py-0.5 rounded-md border uppercase ${
                            assign.priority === "High"
                              ? "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/35"
                              : assign.priority === "Medium"
                              ? "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/35"
                              : "bg-slate-50 dark:bg-zinc-900 text-slate-700 dark:text-zinc-400 border-slate-200 dark:border-zinc-800"
                          }`}
                        >
                          {assign.priority}
                        </span>
                      </td>

                      {/* Next Follow Up */}
                      <td className="p-4 font-mono text-[11px]">
                        <span className={overdue ? "text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1" : "text-slate-600 dark:text-zinc-400"}>
                          {overdue && <AlertCircle size={12} className="text-rose-500 dark:text-rose-400 flex-shrink-0" />}
                          {assign.nextFollowUpDate}
                        </span>
                      </td>

                      {/* Pipeline Status */}
                      <td className="p-4">
                        <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                          assign.currentStatus === "Won" ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/20" :
                          assign.currentStatus === "Lost" ? "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-900/20" :
                          assign.currentStatus === "Negotiation" ? "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-900/20" :
                          "bg-slate-50 dark:bg-zinc-900 text-slate-600 dark:text-zinc-450 border-slate-200 dark:border-zinc-800"
                        }`}>
                          {assign.currentStatus}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => handleCardClick(assign.locationId)}
                          className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold px-2.5 py-1 rounded-md transition-all cursor-pointer"
                        >
                          Open logs
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Embedded DetailDrawer with Pre-selected 'assignment' tab */}
      <DetailDrawer
        location={selectedLoc}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateLocation={onUpdateLocation}
        assignments={assignments}
        teamMembers={teamMembers}
        onUpdateAssignment={onUpdateAssignment}
        initialTab="assignment"
      />
    </div>
  );
}
