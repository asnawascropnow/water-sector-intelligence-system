import React, { useState, useEffect } from "react";
import {
  X,
  MapPin,
  Droplets,
  Phone,
  Mail,
  User,
  ExternalLink,
  History,
  FileText,
  BadgeAlert,
  Info,
  Calendar,
  Layers,
  Sparkles,
  ClipboardList,
  AlertCircle,
  Plus,
  Users,
  Paperclip,
  Zap,
  BarChart3,
  TrendingUp,
} from "lucide-react";
import { Location, Assignment, TeamMember, Priority, WorkStatus, Team, ActivityLogEntry, MeetingNote, DocumentRef } from "../../data/mockData.types";

// Helper for water consumption profile & index scoring
export function getWaterMetrics(loc: Location) {
  const numId = parseInt(loc.id.replace(/\D/g, "")) || 1;
  const sizeFactor = loc.landAreaAcres;
  
  const dailyUsage = Math.round(sizeFactor * 12 + (numId % 5) * 4 + 8); // kL
  const monthlyUsage = dailyUsage * 30;
  const annualUsage = dailyUsage * 365;
  const ratePerKl = loc.waterSource.toLowerCase().includes("tanker") ? 135 : 95;
  const monthlyCost = monthlyUsage * ratePerKl;

  const isTanker = loc.waterSource.toLowerCase().includes("tanker");
  const isBorewell = loc.waterSource.toLowerCase().includes("borewell") || isTanker || (numId % 2 === 0);
  const isMunicipal = loc.waterSource.toLowerCase().includes("municipal") || loc.waterSource.toLowerCase().includes("mixed") || !isBorewell;

  const tankerUsage = isTanker ? Math.round(dailyUsage * 0.45) : 0;
  const borewellUsage = isBorewell ? Math.round(dailyUsage * (isTanker ? 0.35 : 0.75)) : Math.round(dailyUsage * 0.15);
  const municipalUsage = Math.round(dailyUsage - tankerUsage - borewellUsage);

  const solarInstalled = (numId % 3) === 0 ? "Installed (120 kWp)" : "Not Installed (180 kWp potential)";

  const savingPct = loc.rwhStatus === "Verified - Has RWH" ? 12 : 38;
  const savingConsumption = Math.round(monthlyUsage * (savingPct / 100));
  const savingCost = Math.round(monthlyCost * (savingPct / 100));

  let score = 15;
  if (loc.waterStressLevel === "Over-Exploited") score += 35;
  else if (loc.waterStressLevel === "Critical") score += 25;
  else if (loc.waterStressLevel === "Semi-Critical") score += 15;
  else score += 5;

  if (loc.rwhStatus === "Verified - No RWH") score += 30;
  else if (loc.rwhStatus === "Unknown") score += 15;

  if (isTanker) score += 15;
  else if (isBorewell) score += 10;

  if (sizeFactor > 50) score += 15;
  else if (sizeFactor > 10) score += 10;

  score = Math.min(score, 100);

  let woiPriority: "Critical" | "High" | "Medium" | "Low" = "Low";
  if (score >= 75) woiPriority = "Critical";
  else if (score >= 55) woiPriority = "High";
  else if (score >= 35) woiPriority = "Medium";

  return {
    dailyUsage,
    monthlyUsage,
    annualUsage,
    monthlyCost,
    tankerUsage,
    borewellUsage,
    municipalUsage: Math.max(0, municipalUsage),
    solarInstalled,
    savingPct,
    savingConsumption,
    savingCost,
    score,
    woiPriority
  };
}

interface DetailDrawerProps {
  location: Location | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateLocation: (updated: Location) => void;
  assignments: Assignment[];
  teamMembers: TeamMember[];
  onUpdateAssignment: (updated: Assignment) => void;
  initialTab?: "profile" | "assignment";
}

export default function DetailDrawer({
  location,
  isOpen,
  onClose,
  onUpdateLocation,
  assignments,
  teamMembers,
  onUpdateAssignment,
  initialTab = "profile",
}: DetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<"profile" | "assignment">("profile");

  // New item form states for Work Assignment CRM
  const [newLogNote, setNewLogNote] = useState("");
  
  // Meeting form states
  const [mtgDate, setMtgDate] = useState("");
  const [mtgAttendees, setMtgAttendees] = useState("");
  const [mtgSummary, setMtgSummary] = useState("");
  const [showMtgForm, setShowMtgForm] = useState(false);

  // Document form states
  const [docLabel, setDocLabel] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [showDocForm, setShowDocForm] = useState(false);

  // Reset states when drawer opens or selected location changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
      // Reset forms
      setNewLogNote("");
      setMtgDate(new Date().toISOString().split("T")[0]);
      setMtgAttendees("");
      setMtgSummary("");
      setShowMtgForm(false);
      setDocLabel("");
      setDocUrl("");
      setShowDocForm(false);
    }
  }, [isOpen, location?.id, initialTab]);

  if (!location) return null;

  // Find assignment record if it exists
  const assignment = assignments.find((a) => a.locationId === location.id);

  // Status and badge styles
  const getRwhStatusStyles = (status: string) => {
    switch (status) {
      case "Verified - Has RWH":
        return "bg-[#E3FCEF] text-[#006644] border border-[#ABF5D1]";
      case "Verified - No RWH":
        return "bg-[#FFEBE6] text-[#BF2600] border border-[#FFBDAD]";
      default:
        return "bg-[#FFF0B3] text-[#172B4D] border border-[#FFE380]";
    }
  };

  const getWaterStressStyles = (level: string) => {
    switch (level) {
      case "Safe":
        return "bg-[#E3FCEF] text-[#006644] border border-[#ABF5D1]";
      case "Semi-Critical":
        return "bg-[#EBECF0] text-[#42526E] border border-[#DFE1E6]";
      case "Critical":
        return "bg-[#FFF0B3] text-[#172B4D] border border-[#FFE380]";
      case "Over-Exploited":
        return "bg-[#FFEBE6] text-[#BF2600] border border-[#FFBDAD]";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const getConfidenceStyles = (conf: string) => {
    switch (conf) {
      case "Official Dataset":
        return "bg-[#DEEBFF] text-[#0747A6] border border-[#B3D4FF]";
      case "Crowd-Verified":
        return "bg-[#E3FCEF] text-[#006644] border border-[#ABF5D1]";
      default:
        return "bg-[#F4F5F7] text-[#5E6C84] border border-[#DFE1E6]";
    }
  };

  const getPriorityStyles = (priority: Priority) => {
    switch (priority) {
      case "High":
        return "bg-red-50 text-red-700 border-red-200 hover:bg-red-100";
      case "Medium":
        return "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100";
      case "Low":
        return "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100";
    }
  };

  // Create standard empty assignment
  const handleCreateAssignment = () => {
    const defaultMember = teamMembers[0] || { id: "TM-001", name: "Rajesh Kumar", team: "Water Intelligence" as Team };
    const newAssign: Assignment = {
      locationId: location.id,
      assignedToId: defaultMember.id,
      team: defaultMember.team,
      priority: "Medium",
      currentStatus: "Not Started",
      nextFollowUpDate: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString().split("T")[0], // 5 days from now
      activityLog: [
        {
          id: `ACT-${Date.now()}`,
          timestamp: new Date().toISOString(),
          author: "System",
          note: `Lead pipeline initialized and assigned to ${defaultMember.name}.`
        }
      ],
      meetingNotes: [],
      documents: [],
      createdDate: new Date().toISOString().split("T")[0]
    };
    onUpdateAssignment(newAssign);
  };

  // Handlers for modifying assignments
  const updateAssignmentField = (field: keyof Assignment, value: any) => {
    if (!assignment) return;
    const updated = { ...assignment, [field]: value };
    onUpdateAssignment(updated);
  };

  const handleAssigneeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const memberId = e.target.value;
    const member = teamMembers.find((t) => t.id === memberId);
    if (member && assignment) {
      const updated = {
        ...assignment,
        assignedToId: member.id,
        team: member.team, // auto fill team
        activityLog: [
          {
            id: `ACT-${Date.now()}`,
            timestamp: new Date().toISOString(),
            author: "System",
            note: `Reassigned to ${member.name} (${member.team}).`
          },
          ...assignment.activityLog
        ]
      };
      onUpdateAssignment(updated);
    }
  };

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLogNote.trim() || !assignment) return;

    const newEntry: ActivityLogEntry = {
      id: `ACT-${Date.now()}`,
      timestamp: new Date().toISOString(),
      author: "WI Specialist", // Current user fallback
      note: newLogNote.trim()
    };

    const updated = {
      ...assignment,
      activityLog: [newEntry, ...assignment.activityLog]
    };
    onUpdateAssignment(updated);
    setNewLogNote("");
  };

  const handleAddMeeting = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mtgSummary.trim() || !assignment) return;

    const newMtg: MeetingNote = {
      id: `MTG-${Date.now()}`,
      date: mtgDate || new Date().toISOString().split("T")[0],
      attendees: mtgAttendees ? mtgAttendees.split(",").map((s) => s.trim()).filter(Boolean) : ["WI Specialist"],
      summary: mtgSummary.trim()
    };

    const updated = {
      ...assignment,
      meetingNotes: [newMtg, ...assignment.meetingNotes]
    };
    onUpdateAssignment(updated);

    // Reset meeting form
    setMtgDate(new Date().toISOString().split("T")[0]);
    setMtgAttendees("");
    setMtgSummary("");
    setShowMtgForm(false);
  };

  const handleAddDocument = (e: React.FormEvent) => {
    e.preventDefault();
    if (!docLabel.trim() || !assignment) return;

    const newDoc: DocumentRef = {
      id: `DOC-${Date.now()}`,
      label: docLabel.trim(),
      url: docUrl.trim() || "#"
    };

    const updated = {
      ...assignment,
      documents: [...assignment.documents, newDoc]
    };
    onUpdateAssignment(updated);

    // Reset doc form
    setDocLabel("");
    setDocUrl("");
    setShowDocForm(false);
  };

  // Overdue follow-up check (comparing today's date "2026-07-10")
  const checkOverdue = (dateStr?: string) => {
    if (!dateStr) return false;
    // Overdue if follow up is in the past and status is not Won, Lost
    const isPast = dateStr < "2026-07-10";
    const isActive = assignment?.currentStatus !== "Won" && assignment?.currentStatus !== "Lost";
    return isPast && isActive;
  };

  const isOverdue = assignment ? checkOverdue(assignment.nextFollowUpDate) : false;

  return (
    <>
      {/* Drawer Overlay backdrop */}
      <div
        className={`fixed inset-0 bg-[#091E42]/40 backdrop-blur-[1px] transition-opacity duration-300 z-[1000] ${
          isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      {/* Right Drawer Sliding Panel */}
      <div
        id="detail-drawer-panel"
        className={`fixed top-0 right-0 h-full w-[480px] bg-[#F4F5F7] border-l border-[#DFE1E6] shadow-2xl transition-transform duration-300 ease-out z-[1010] flex flex-col justify-between ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header Block */}
        <div className="p-5 border-b border-[#DFE1E6] bg-white flex-shrink-0 shadow-[0_1px_3px_rgba(9,30,66,0.05)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-[#5E6C84] tracking-wider uppercase font-mono bg-[#EBECF0] px-1.5 py-0.5 rounded-[2px]">
              ID: {location.id}
            </span>
            <button
              onClick={onClose}
              id="close-drawer-btn"
              className="p-1 text-[#42526E] hover:text-[#172B4D] hover:bg-[#EBECF0] rounded-sm transition-colors cursor-pointer"
              title="Close Panel"
            >
              <X size={18} />
            </button>
          </div>

          <h3 className="text-base font-bold text-[#172B4D] leading-tight mb-2">
            {location.name}
          </h3>

          <div className="flex flex-wrap gap-1.5 mb-4">
            <span className="text-[10px] font-bold px-2 py-0.5 bg-[#DEEBFF] text-[#0747A6] rounded-[2px] uppercase tracking-wide border border-[#B3D4FF]">
              {location.category}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-[2px] uppercase tracking-wide ${getRwhStatusStyles(
                location.rwhStatus
              )}`}
            >
              {location.rwhStatus}
            </span>
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-[2px] uppercase tracking-wide ${getWaterStressStyles(
                location.waterStressLevel
              )}`}
            >
              Stress: {location.waterStressLevel}
            </span>
          </div>

          {/* Tab Selection Row */}
          <div className="flex border-b border-[#DFE1E6] -mx-5 -mb-5 px-5 mt-4 bg-white" id="drawer-tab-row">
            <button
              onClick={() => setActiveTab("profile")}
              className={`py-2 px-4 text-xs font-bold border-b-2 tracking-wide cursor-pointer transition-all ${
                activeTab === "profile"
                  ? "border-[#0052CC] text-[#0052CC]"
                  : "border-transparent text-[#5E6C84] hover:text-[#172B4D]"
              }`}
            >
              Facility Profile
            </button>
            <button
              onClick={() => setActiveTab("assignment")}
              className={`py-2 px-4 text-xs font-bold border-b-2 tracking-wide cursor-pointer transition-all flex items-center gap-1.5 ${
                activeTab === "assignment"
                  ? "border-[#0052CC] text-[#0052CC]"
                  : "border-transparent text-[#5E6C84] hover:text-[#172B4D]"
              }`}
            >
              <Sparkles size={13} className="text-[#0052CC]" />
              Work Assignment & CRM
              {assignment && (
                <span className="w-2 h-2 rounded-full bg-[#0052CC]"></span>
              )}
              {isOverdue && (
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
              )}
            </button>
          </div>
        </div>

        {/* Scrollable Attributes Area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {activeTab === "profile" ? (
            <div className="space-y-6">
              {/* Section: Geographic Details */}
              <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#5E6C84] uppercase tracking-wider pb-1.5 border-b border-[#F4F5F7]">
                  <MapPin size={14} className="text-[#0052CC]" />
                  <span>Location Context</span>
                </div>
                <div className="grid grid-cols-2 gap-3.5 text-xs">
                  <div className="col-span-2">
                    <p className="text-[11px] text-[#5E6C84]">Address</p>
                    <p className="font-semibold text-[#172B4D] mt-0.5 leading-normal">
                      {location.address}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#5E6C84]">District</p>
                    <p className="font-semibold text-[#172B4D] mt-0.5">
                      {location.district}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#5E6C84]">Taluk</p>
                    <p className="font-semibold text-[#172B4D] mt-0.5">
                      {location.taluk || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#5E6C84]">State & Pincode</p>
                    <p className="font-semibold text-[#172B4D] mt-0.5">
                      {location.state} - {location.pincode}
                    </p>
                  </div>
                </div>
              </div>              {/* Section: Water Profile & Opportunity Index Scoring */}
              {(() => {
                const metrics = getWaterMetrics(location);
                return (
                  <>
                    {/* Water Opportunity Index Core Panel */}
                    <div className="bg-[#050B14] text-white border border-[#14263D] rounded-[3px] p-4 shadow-md space-y-3">
                      <div className="flex items-center justify-between pb-2 border-b border-[#14263D]">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#00B8D9]">
                          <TrendingUp size={14} className="text-[#00B8D9]" />
                          <span>Water Opportunity Index (WOI)</span>
                        </div>
                        <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-[2px] tracking-wide uppercase ${
                          metrics.woiPriority === "Critical" ? "bg-red-500/20 text-red-400 border border-red-500/30" :
                          metrics.woiPriority === "High" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                          metrics.woiPriority === "Medium" ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
                          "bg-gray-500/20 text-gray-400 border border-gray-500/30"
                        }`}>
                          {metrics.woiPriority} Priority
                        </span>
                      </div>

                      <div className="flex items-center gap-4 py-1">
                        <div className="text-center">
                          <div className="text-3xl font-extrabold font-mono text-white tracking-tight">
                            {metrics.score}
                            <span className="text-xs text-gray-400 font-normal">/100</span>
                          </div>
                          <div className="text-[9px] text-[#5A6E85] uppercase font-bold tracking-wider mt-0.5">WOI Score</div>
                        </div>

                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between text-[10px] text-[#8FA2BA] font-semibold">
                            <span>Prioritization Rank</span>
                            <span>{metrics.score}% Intensity</span>
                          </div>
                          <div className="w-full bg-[#101F30] h-2 rounded-full overflow-hidden">
                            <div 
                              className={`h-full rounded-full transition-all ${
                                metrics.score >= 75 ? "bg-red-500" :
                                metrics.score >= 55 ? "bg-amber-500" :
                                metrics.score >= 35 ? "bg-sky-500" : "bg-gray-500"
                              }`}
                              style={{ width: `${metrics.score}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1.5 border-t border-[#14263D]/60">
                        <div>
                          <p className="text-[10px] text-[#5A6E85]">Est. Saving Potential</p>
                          <p className="font-extrabold text-emerald-400 mt-0.5">{metrics.savingPct}% Savings</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[#5A6E85]">Est. Cost Reductions</p>
                          <p className="font-extrabold text-[#00B8D9] mt-0.5">₹{metrics.savingCost.toLocaleString("en-IN")}/mo</p>
                        </div>
                      </div>
                    </div>

                    {/* Section: Water Consumption Breakdown */}
                    <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#172B4D] uppercase tracking-wider pb-1.5 border-b border-[#F4F5F7]">
                        <Droplets size={14} className="text-[#00B8D9]" />
                        <span>Water Inflow & Consumption Profiles</span>
                      </div>

                      <div className="grid grid-cols-2 gap-3.5 text-xs">
                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Approximate Daily Water</p>
                          <p className="font-extrabold text-[#172B4D] mt-0.5 text-[14px] font-mono">
                            {metrics.dailyUsage} kL <span className="text-[10px] text-gray-500 font-normal">/ day</span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Estimated Monthly Volume</p>
                          <p className="font-bold text-[#172B4D] mt-0.5 text-[14px] font-mono">
                            {metrics.monthlyUsage.toLocaleString("en-IN")} kL <span className="text-[10px] text-gray-500 font-normal">/ mo</span>
                          </p>
                        </div>

                        {/* Breakdown bar */}
                        <div className="col-span-2 space-y-1">
                          <p className="text-[11px] text-[#5E6C84] font-semibold">Source Usage Breakdown (Daily Estimation)</p>
                          <div className="w-full h-4 rounded-sm overflow-hidden flex text-[9px] font-bold text-white font-mono">
                            {metrics.borewellUsage > 0 && (
                              <div 
                                className="bg-[#172B4D] flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity" 
                                style={{ width: `${(metrics.borewellUsage / metrics.dailyUsage) * 100}%` }}
                                title={`Groundwater/Borewell: ${metrics.borewellUsage} kL`}
                              >
                                {Math.round((metrics.borewellUsage / metrics.dailyUsage) * 100)}% GW
                              </div>
                            )}
                            {metrics.tankerUsage > 0 && (
                              <div 
                                className="bg-amber-600 flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity" 
                                style={{ width: `${(metrics.tankerUsage / metrics.dailyUsage) * 100}%` }}
                                title={`Tanker Water: ${metrics.tankerUsage} kL`}
                              >
                                {Math.round((metrics.tankerUsage / metrics.dailyUsage) * 100)}% TNK
                              </div>
                            )}
                            {metrics.municipalUsage > 0 && (
                              <div 
                                className="bg-[#0052CC] flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity" 
                                style={{ width: `${(metrics.municipalUsage / metrics.dailyUsage) * 100}%` }}
                                title={`Municipal (Cauvery): ${metrics.municipalUsage} kL`}
                              >
                                {Math.round((metrics.municipalUsage / metrics.dailyUsage) * 100)}% MUN
                              </div>
                            )}
                          </div>
                          <div className="flex justify-between text-[9px] text-[#5E6C84] pt-0.5">
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-[#172B4D]"></span> Groundwater ({metrics.borewellUsage} kL)
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-amber-600"></span> Tankers ({metrics.tankerUsage} kL)
                            </span>
                            <span className="flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-[#0052CC]"></span> Municipal ({metrics.municipalUsage} kL)
                            </span>
                          </div>
                        </div>

                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Primary Inflow Sources</p>
                          <p className="font-semibold text-[#172B4D] mt-0.5">{location.waterSource}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Approximate Monthly Bill</p>
                          <p className="font-bold text-[#172B4D] mt-0.5 text-[13px] text-gray-900 font-mono">
                            ₹{metrics.monthlyCost.toLocaleString("en-IN")}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Section: RWH Compliance & ESG Metrics */}
                    <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-[#172B4D] uppercase tracking-wider pb-1.5 border-b border-[#F4F5F7]">
                        <Zap size={14} className="text-amber-500" />
                        <span>Sustainability & Compliance Audits</span>
                      </div>

                      <div className="grid grid-cols-2 gap-3.5 text-xs">
                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Estimated Land Area</p>
                          <p className="font-bold text-[#172B4D] mt-0.5 text-[13px] font-mono">
                            {location.landAreaAcres} Acres
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Solar Energy Status</p>
                          <p className="font-semibold text-gray-700 mt-0.5">
                            {metrics.solarInstalled}
                          </p>
                        </div>

                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="text-[11px] text-[#5E6C84]">CGWA Legally Obligated</p>
                            <span className="text-gray-400 cursor-pointer" title="CGWA state laws mandate Rainwater Harvesting systems on properties over 0.1 acres built-up.">
                              <Info size={11} />
                            </span>
                          </div>
                          <span className={`inline-block text-[9px] font-extrabold px-1.5 py-0.5 rounded-sm uppercase mt-1 ${
                            location.legallyObligatedForRwh 
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : "bg-gray-50 text-gray-500 border border-gray-200"
                          }`}>
                            {location.legallyObligatedForRwh ? "YES - MANDATED" : "NO OBLIGATION"}
                          </span>
                        </div>

                        <div>
                          <p className="text-[11px] text-[#5E6C84]">Existing Technologies</p>
                          <p className="font-semibold text-gray-700 mt-0.5">
                            {location.category === "Manufacturing" || location.category === "Industry"
                              ? "RO Plant, STP (300 kLD)" 
                              : "Basic Sand Filter, Overheads"}
                          </p>
                        </div>

                        <div className="col-span-2 bg-emerald-50 border border-emerald-100 p-2.5 rounded-[2px] flex items-center justify-between">
                          <div className="space-y-0.5">
                            <span className="text-[9px] font-bold text-emerald-800 uppercase tracking-wider block">Estimated Saving Potential (RWH + Aerators)</span>
                            <span className="text-[11px] text-emerald-900 leading-snug">
                              Save <strong className="font-bold">{metrics.savingConsumption.toLocaleString("en-IN")} kL</strong> of water & <strong className="font-bold">₹{metrics.savingCost.toLocaleString("en-IN")}</strong> monthly.
                            </span>
                          </div>
                          <span className="text-lg font-extrabold text-emerald-600 font-mono pr-1">
                            {metrics.savingPct}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* Section: Contact Details */}
              <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#5E6C84] uppercase tracking-wider pb-1.5 border-b border-[#F4F5F7]">
                  <User size={14} className="text-[#6554C0]" />
                  <span>Institutional Representative</span>
                </div>
                {location.contactName ? (
                  <div className="grid grid-cols-2 gap-3.5 text-xs">
                    <div>
                      <p className="text-[11px] text-[#5E6C84]">Name</p>
                      <p className="font-semibold text-[#172B4D] mt-0.5">
                        {location.contactName}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#5E6C84]">Designation</p>
                      <p className="font-semibold text-[#172B4D] mt-0.5 text-gray-600">
                        {location.contactDesignation || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#5E6C84]">Phone Number</p>
                      <p className="font-semibold text-[#172B4D] mt-0.5 flex items-center gap-1">
                        <Phone size={10} className="text-gray-400" />
                        {location.contactPhone || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[11px] text-[#5E6C84]">Email Address</p>
                      <p className="font-semibold text-[#172B4D] mt-0.5 flex items-center gap-1 truncate" title={location.contactEmail}>
                        <Mail size={10} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{location.contactEmail || "—"}</span>
                      </p>
                    </div>
                    {location.website && (
                      <div className="col-span-2">
                        <p className="text-[11px] text-[#5E6C84]">Official Website</p>
                        <a
                          href={location.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#0052CC] hover:underline flex items-center gap-1 mt-0.5 font-medium"
                        >
                          {location.website}
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-[#5E6C84] italic py-1">
                    No contact information registered in current dataset.
                  </p>
                )}
              </div>

              {/* Section: Data Provenance */}
              <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold text-[#5E6C84] uppercase tracking-wider pb-1.5 border-b border-[#F4F5F7]">
                  <History size={14} className="text-[#00875A]" />
                  <span>Data Provenance</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <p className="text-[11px] text-[#5E6C84]">Primary Source</p>
                    <p className="font-semibold text-[#172B4D] mt-0.5">
                      {location.dataSource}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#5E6C84]">Confidence Level</p>
                    <span
                      className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wide mt-1 ${getConfidenceStyles(
                        location.confidenceLevel
                      )}`}
                    >
                      {location.confidenceLevel}
                    </span>
                  </div>
                  <div>
                    <p className="text-[11px] text-[#5E6C84]">Last Audited On</p>
                    <p className="font-semibold text-[#172B4D] mt-0.5 flex items-center gap-1">
                      <Calendar size={12} className="text-gray-400" />
                      {location.lastVerifiedDate}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Tab 2: Assignment & CRM Board */
            <div className="space-y-6">
              {!assignment ? (
                /* Unassigned Empty State */
                <div className="bg-white border border-dashed border-[#DFE1E6] rounded-[3px] p-8 text-center space-y-4 shadow-[0_1px_2px_rgba(9,30,66,0.05)]">
                  <div className="w-12 h-12 rounded-full bg-[#DEEBFF] text-[#0052CC] flex items-center justify-center mx-auto">
                    <ClipboardList size={22} />
                  </div>
                  <div className="space-y-1">
                    <h4 className="font-bold text-[#172B4D] text-sm">Not Currently Assigned</h4>
                    <p className="text-xs text-[#5E6C84] max-w-sm mx-auto leading-relaxed">
                      This prospect is sitting in our general database. Assign it to an outreach or engineering lead to initiate water surveys, designs, and commercial proposals.
                    </p>
                  </div>
                  <button
                    onClick={handleCreateAssignment}
                    id="assign-prospect-btn"
                    className="mx-auto bg-[#0052CC] hover:bg-[#0065FF] text-white text-xs font-bold px-4 py-2 rounded-[3px] transition-all cursor-pointer shadow-sm flex items-center gap-1.5"
                  >
                    <Plus size={14} />
                    Assign this Location
                  </button>
                </div>
              ) : (
                /* Active Assignment Panel */
                <div className="space-y-6">
                  {/* Task Metadata Form Card */}
                  <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-4">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#F4F5F7]">
                      <span className="text-[11px] font-bold text-[#5E6C84] uppercase tracking-wide">
                        Assigned pipeline metadata
                      </span>
                      {isOverdue && (
                        <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-[2px] flex items-center gap-1 animate-pulse">
                          <AlertCircle size={10} />
                          Overdue Follow-up
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-xs">
                      {/* Assigned To */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#5E6C84]">Assigned Specialist</label>
                        <select
                          id="assignee-select"
                          value={assignment.assignedToId}
                          onChange={handleAssigneeChange}
                          className="w-full h-[32px] px-2.5 bg-white border border-[#DFE1E6] focus:border-[#0052CC] rounded-[3px] outline-none text-[#172B4D] font-medium"
                        >
                          {teamMembers.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Overridden Team */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#5E6C84]">Operations Team</label>
                        <select
                          id="team-select"
                          value={assignment.team}
                          onChange={(e) => updateAssignmentField("team", e.target.value)}
                          className="w-full h-[32px] px-2.5 bg-white border border-[#DFE1E6] focus:border-[#0052CC] rounded-[3px] outline-none text-[#172B4D] font-medium"
                        >
                          <option value="Water Intelligence">Water Intelligence</option>
                          <option value="Industry Outreach">Industry Outreach</option>
                          <option value="Technical">Technical</option>
                          <option value="Project Execution">Project Execution</option>
                        </select>
                      </div>

                      {/* Work Status CRM Stage */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#5E6C84]">Current Work Status</label>
                        <select
                          id="work-status-select"
                          value={assignment.currentStatus}
                          onChange={(e) => updateAssignmentField("currentStatus", e.target.value)}
                          className="w-full h-[32px] px-2.5 bg-white border border-[#DFE1E6] focus:border-[#0052CC] rounded-[3px] outline-none text-[#172B4D] font-semibold text-[#0052CC]"
                        >
                          <option value="Not Started">Not Started</option>
                          <option value="Contacted">Contacted</option>
                          <option value="Site Visit Scheduled">Site Visit Scheduled</option>
                          <option value="Proposal Drafting">Proposal Drafting</option>
                          <option value="Proposal Sent">Proposal Sent</option>
                          <option value="Negotiation">Negotiation</option>
                          <option value="Won">Won</option>
                          <option value="Lost">Lost</option>
                          <option value="On Hold">On Hold</option>
                        </select>
                      </div>

                      {/* Next Follow Up */}
                      <div className="space-y-1">
                        <label className="text-[11px] font-bold text-[#5E6C84]">Next Follow-up Date</label>
                        <div className="relative">
                          <input
                            id="follow-up-date-input"
                            type="date"
                            value={assignment.nextFollowUpDate || ""}
                            onChange={(e) => updateAssignmentField("nextFollowUpDate", e.target.value)}
                            className={`w-full h-[32px] px-2.5 bg-white border rounded-[3px] outline-none font-semibold ${
                              isOverdue
                                ? "border-red-400 text-red-600 focus:border-red-500"
                                : "border-[#DFE1E6] text-[#172B4D] focus:border-[#0052CC]"
                            }`}
                          />
                        </div>
                      </div>

                      {/* Priority (3-way color-coded selector) */}
                      <div className="col-span-2 space-y-1.5">
                        <label className="text-[11px] font-bold text-[#5E6C84]">Conversion Priority</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(["Low", "Medium", "High"] as Priority[]).map((p) => {
                            const isSel = assignment.priority === p;
                            let style = "bg-gray-50 text-gray-500 hover:bg-gray-100 border-[#DFE1E6]";
                            if (isSel) {
                              if (p === "High") style = "bg-red-50 text-red-700 border-red-400 font-bold";
                              else if (p === "Medium") style = "bg-amber-50 text-amber-700 border-amber-400 font-bold";
                              else style = "bg-gray-100 text-gray-800 border-gray-400 font-bold";
                            }
                            return (
                              <button
                                key={p}
                                type="button"
                                onClick={() => updateAssignmentField("priority", p)}
                                className={`h-[32px] border text-xs rounded-[3px] transition-all cursor-pointer ${style}`}
                              >
                                {p}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Documents Section */}
                  <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#F4F5F7]">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#5E6C84] uppercase tracking-wide">
                        <Paperclip size={13} className="text-gray-400" />
                        <span>Survey & Proposal Documents</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowDocForm(!showDocForm)}
                        className="text-[10px] font-bold text-[#0052CC] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus size={10} /> Add Ref
                      </button>
                    </div>

                    {/* Add Document Ref Subform */}
                    {showDocForm && (
                      <form onSubmit={handleAddDocument} className="p-2.5 bg-[#FAFBFC] rounded border border-[#DFE1E6] space-y-2 text-xs">
                        <div>
                          <label className="block text-[10px] font-bold text-[#5E6C84] mb-0.5">Document Label</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Roof survey map photo"
                            value={docLabel}
                            onChange={(e) => setDocLabel(e.target.value)}
                            className="w-full h-7 px-2 border border-[#DFE1E6] rounded-[3px] outline-none focus:border-[#0052CC]"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-[#5E6C84] mb-0.5">Reference URL / File name</label>
                          <input
                            type="text"
                            placeholder="e.g. LOC-001-roof.jpg"
                            value={docUrl}
                            onChange={(e) => setDocUrl(e.target.value)}
                            className="w-full h-7 px-2 border border-[#DFE1E6] rounded-[3px] outline-none focus:border-[#0052CC]"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5 pt-1">
                          <button
                            type="button"
                            onClick={() => setShowDocForm(false)}
                            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-[#42526E] text-[10px] rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="px-2 py-1 bg-[#0052CC] hover:bg-[#0065FF] text-white text-[10px] font-bold rounded"
                          >
                            Add File
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Document List */}
                    {assignment.documents.length === 0 ? (
                      <p className="text-[11px] text-[#5E6C84] italic">No document links loaded in session.</p>
                    ) : (
                      <div className="space-y-1.5 text-xs">
                        {assignment.documents.map((doc) => (
                          <div key={doc.id} className="flex items-center justify-between p-2 bg-[#F4F5F7] rounded-[2px] hover:bg-[#EBECF0]">
                            <span className="font-semibold text-[#172B4D] truncate pr-4">{doc.label}</span>
                            <a
                              href={doc.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#0052CC] hover:underline flex items-center gap-0.5 font-bold text-[10px] flex-shrink-0"
                            >
                              Open <ExternalLink size={10} />
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Meeting Notes Section */}
                  <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-3">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#F4F5F7]">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#5E6C84] uppercase tracking-wide">
                        <Users size={13} className="text-gray-400" />
                        <span>Minutes of Meetings</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowMtgForm(!showMtgForm)}
                        className="text-[10px] font-bold text-[#0052CC] hover:underline flex items-center gap-0.5 cursor-pointer"
                      >
                        <Plus size={10} /> Record Minute
                      </button>
                    </div>

                    {/* Add Meeting Note Subform */}
                    {showMtgForm && (
                      <form onSubmit={handleAddMeeting} className="p-2.5 bg-[#FAFBFC] rounded border border-[#DFE1E6] space-y-2 text-xs">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[10px] font-bold text-[#5E6C84] mb-0.5">Meeting Date</label>
                            <input
                              type="date"
                              required
                              value={mtgDate}
                              onChange={(e) => setMtgDate(e.target.value)}
                              className="w-full h-7 px-2 border border-[#DFE1E6] rounded-[3px] outline-none focus:border-[#0052CC]"
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-[#5E6C84] mb-0.5">Attendees</label>
                            <input
                              type="text"
                              placeholder="e.g. Priya S, Ramesh"
                              value={mtgAttendees}
                              onChange={(e) => setMtgAttendees(e.target.value)}
                              className="w-full h-7 px-2 border border-[#DFE1E6] rounded-[3px] outline-none focus:border-[#0052CC]"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-[#5E6C84] mb-0.5">Discussion Summary</label>
                          <textarea
                            required
                            rows={2}
                            placeholder="Log key action items or discussion summaries..."
                            value={mtgSummary}
                            onChange={(e) => setMtgSummary(e.target.value)}
                            className="w-full p-2 border border-[#DFE1E6] rounded-[3px] outline-none focus:border-[#0052CC] resize-none"
                          />
                        </div>
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowMtgForm(false)}
                            className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-[#42526E] text-[10px] rounded"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="px-2 py-1 bg-[#0052CC] hover:bg-[#0065FF] text-white text-[10px] font-bold rounded"
                          >
                            Save Note
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Meeting Notes List */}
                    {assignment.meetingNotes.length === 0 ? (
                      <p className="text-[11px] text-[#5E6C84] italic">No formal meetings recorded.</p>
                    ) : (
                      <div className="space-y-3">
                        {assignment.meetingNotes.map((note) => (
                          <div key={note.id} className="p-3 bg-[#FAFBFC] rounded border border-[#EBECF0] text-xs space-y-1.5">
                            <div className="flex items-center justify-between text-[11px] text-[#5E6C84] font-semibold">
                              <span className="flex items-center gap-1">
                                <Calendar size={11} /> {note.date}
                              </span>
                              <span className="bg-[#EBECF0] px-1.5 py-0.5 rounded text-[9px] text-[#172B4D]">
                                Attendees: {note.attendees.join(", ")}
                              </span>
                            </div>
                            <p className="text-[#172B4D] leading-relaxed italic">{note.summary}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Activity Logs Section */}
                  <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-4 shadow-[0_1px_2px_rgba(9,30,66,0.08)] space-y-4">
                    <div className="flex items-center justify-between pb-1.5 border-b border-[#F4F5F7]">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[#5E6C84] uppercase tracking-wide">
                        <FileText size={13} className="text-gray-400" />
                        <span>Continuous Activity Log</span>
                      </div>
                      <span className="text-[10px] text-[#5E6C84] font-mono">
                        Reverse chronological
                      </span>
                    </div>

                    {/* Add Activity Log Entry Form */}
                    <form onSubmit={handleAddNote} className="space-y-2">
                      <div className="flex gap-2">
                        <input
                          id="new-activity-log-input"
                          type="text"
                          placeholder="Log a call, survey note, or follow-up status..."
                          value={newLogNote}
                          onChange={(e) => setNewLogNote(e.target.value)}
                          className="flex-1 h-[32px] px-2.5 text-xs border border-[#DFE1E6] rounded-[3px] focus:border-[#0052CC] outline-none text-[#172B4D]"
                        />
                        <button
                          type="submit"
                          className="h-[32px] px-3.5 bg-[#0052CC] hover:bg-[#0065FF] text-white text-xs font-bold rounded-[3px] transition-all cursor-pointer"
                        >
                          Log Note
                        </button>
                      </div>
                    </form>

                    {/* Activity Log List */}
                    {assignment.activityLog.length === 0 ? (
                      <p className="text-[11px] text-[#5E6C84] italic">No activity logs recorded.</p>
                    ) : (
                      <div className="space-y-3.5 max-h-[300px] overflow-y-auto pr-1">
                        {assignment.activityLog.map((log) => (
                          <div key={log.id} className="text-xs flex gap-2.5 items-start">
                            {/* Small User Initials Avatar */}
                            <div className="w-6 h-6 rounded-full bg-[#EBECF0] text-[#172B4D] flex items-center justify-center font-bold text-[9px] flex-shrink-0 mt-0.5">
                              {log.author.split(" ").map(w => w[0]).join("")}
                            </div>
                            <div className="space-y-0.5 flex-1 min-w-0">
                              <div className="flex items-center justify-between text-[10px] text-[#5E6C84]">
                                <span className="font-bold text-[#172B4D]">{log.author}</span>
                                <span>{new Date(log.timestamp).toLocaleDateString("en-IN", {
                                  day: "numeric",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}</span>
                              </div>
                              <p className="text-[#172B4D] leading-relaxed break-words">{log.note}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info in drawer */}
        <div className="p-4 border-t border-[#DFE1E6] bg-white flex-shrink-0 text-[10px] text-[#5E6C84] text-center font-mono">
          © CropNow Water Intelligence Platform. Internal Operations Only.
        </div>
      </div>
    </>
  );
}
