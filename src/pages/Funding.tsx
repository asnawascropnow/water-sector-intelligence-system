import React, { useState, useMemo } from "react";
import { 
  DollarSign, 
  Search, 
  Filter, 
  Calendar, 
  ExternalLink, 
  User, 
  Briefcase, 
  CheckCircle, 
  Clock, 
  XCircle, 
  ChevronRight, 
  TrendingUp, 
  SlidersHorizontal,
  Info,
  Globe,
  Plus,
  Users,
  Award
} from "lucide-react";
import { TeamMember, Priority } from "../data/mockData.types";

interface Fund {
  id: string;
  agency: string;
  type: string;
  amount: string;
  amountNum: number;
  eligibility: string;
  deadline: string;
  website: string;
  contactPerson: string;
  country: string;
  focusArea: string;
  matchRate: string;
  
  // CRM tracking fields
  assignedToId: string;
  proposalStatus: "Not Started" | "Drafting" | "Submitted" | "Won" | "Lost";
  meetingStatus: "Not Scheduled" | "Scheduled" | "Completed";
  remarks: string;
}

interface FundingProps {
  teamMembers: TeamMember[];
  theme?: "light" | "dark";
}

const initialFunds: Fund[] = [
  {
    id: "FUND-001",
    agency: "HDFC Environmental CSR Fund",
    type: "CSR Fund",
    amount: "₹15,00,000",
    amountNum: 1500000,
    eligibility: "Public and private schools, colleges & institutes in Karnataka",
    deadline: "2026-08-12",
    website: "https://hdfcbank.com/csr",
    contactPerson: "Deepa Mehta (Director of Impact)",
    country: "India",
    focusArea: "Rooftop Rainwater Harvesting & direct groundwater recharge pits",
    matchRate: "High Match",
    assignedToId: "TM-002",
    proposalStatus: "Drafting",
    meetingStatus: "Scheduled",
    remarks: "Initial technical scope completed for Peenya schools. Working on budget templates."
  },
  {
    id: "FUND-002",
    agency: "Atal Bhujal Yojana Central Grant",
    type: "Government Grant",
    amount: "₹45,00,000",
    amountNum: 4500000,
    eligibility: "Municipal campuses, government institutions and registered societies",
    deadline: "2026-07-28",
    website: "https://jalshakti-dowr.gov.in",
    contactPerson: "Dr. Sandeep Shastri (Nodal Officer)",
    country: "India",
    focusArea: "Aquifer mapping, restoration of injection borewells & soil moisture retention",
    matchRate: "High Match",
    assignedToId: "TM-001",
    proposalStatus: "Not Started",
    meetingStatus: "Not Scheduled",
    remarks: "Waiting on official municipal endorsement certificates for Bengaluru East nodes."
  },
  {
    id: "FUND-003",
    agency: "Wipro Climate Mitigation CSR Fund",
    type: "CSR Fund",
    amount: "₹25,00,000",
    amountNum: 2500000,
    eligibility: "Hospitals and university campuses with high daily tanker dependency",
    deadline: "2026-08-30",
    website: "https://wipro.org/sustainability",
    contactPerson: "S. Raghavan (CSR Lead)",
    country: "India",
    focusArea: "Dual pipeline recycling networks, smart flow meters & telemetry setups",
    matchRate: "Corporate Ready",
    assignedToId: "TM-005",
    proposalStatus: "Submitted",
    meetingStatus: "Completed",
    remarks: "Proposal sent on July 5. Pitch meeting conducted. Clarifications on sensor integration resolved."
  },
  {
    id: "FUND-004",
    agency: "Acumen Clean Water Venture Fund",
    type: "Impact Fund",
    amount: "₹50,00,000",
    amountNum: 5000000,
    eligibility: "Commercial tech parks, manufacturing clusters & industrial estates",
    deadline: "2026-10-15",
    website: "https://acumen.org/investments",
    contactPerson: "Jacqueline Novogratz (Partner)",
    country: "Global / India",
    focusArea: "Zero liquid discharge systems, greywater STP upgrades & reverse osmosis loops",
    matchRate: "Govt Direct",
    assignedToId: "TM-003",
    proposalStatus: "Drafting",
    meetingStatus: "Scheduled",
    remarks: "Drafting pilot layout for Peenya Industrial Hub cluster. Presentation on Aug 2."
  },
  {
    id: "FUND-005",
    agency: "UN Sustainable Water Challenge",
    type: "International Fund",
    amount: "₹33,20,000 ($40,000)",
    amountNum: 3320000,
    eligibility: "Educational institutions and smart-campus pilot programs",
    deadline: "2026-11-20",
    website: "https://unwater.org/funding",
    contactPerson: "UN Water Secretariat Coordinator",
    country: "Global",
    focusArea: "IoT-enabled water audits, digital telemetry meters & rainwater volume tracking",
    matchRate: "High Match",
    assignedToId: "TM-006",
    proposalStatus: "Won",
    meetingStatus: "Completed",
    remarks: "Awarded! Funds allocated to IISc digital twin integration project. Initial tranche of 50% received."
  },
  {
    id: "FUND-006",
    agency: "NABARD Rural Infrastructure Development",
    type: "Government Grant",
    amount: "₹30,00,000",
    amountNum: 3000000,
    eligibility: "Semi-urban & rural institutions, colleges and agricultural colleges",
    deadline: "2026-09-05",
    website: "https://nabard.org/grants",
    contactPerson: "R. K. Sen (Chief General Manager)",
    country: "India",
    focusArea: "Piped water networks, decentralized rainwater collection and mini filtration plants",
    matchRate: "Govt Direct",
    assignedToId: "TM-008",
    proposalStatus: "Not Started",
    meetingStatus: "Not Scheduled",
    remarks: "Awaiting final state soil and aquifer level baseline data before submitting."
  }
];

export default function Funding({ teamMembers, theme }: FundingProps) {
  // Local state for funds so changes persist within session
  const [funds, setFunds] = useState<Fund[]>(initialFunds);
  const [selectedFundId, setSelectedFundId] = useState<string>("FUND-001");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedType, setSelectedType] = useState("All");
  const [selectedStatus, setSelectedStatus] = useState("All");

  const [toastMessage, setToastMessage] = useState("");

  const activeFund = useMemo(() => {
    return funds.find((f) => f.id === selectedFundId) || funds[0];
  }, [funds, selectedFundId]);

  // Form input bindings for selected fund edits
  const [assignedToId, setAssignedToId] = useState("");
  const [proposalStatus, setProposalStatus] = useState<"Not Started" | "Drafting" | "Submitted" | "Won" | "Lost">("Not Started");
  const [meetingStatus, setMeetingStatus] = useState<"Not Scheduled" | "Scheduled" | "Completed">("Not Scheduled");
  const [remarks, setRemarks] = useState("");

  // Sync edit form states when active fund changes
  React.useEffect(() => {
    if (activeFund) {
      setAssignedToId(activeFund.assignedToId);
      setProposalStatus(activeFund.proposalStatus);
      setMeetingStatus(activeFund.meetingStatus);
      setRemarks(activeFund.remarks);
    }
  }, [activeFund]);

  // Handle saving fund CRM edits
  const handleSaveCRM = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeFund) return;

    setFunds((prevFunds) =>
      prevFunds.map((f) => {
        if (f.id === activeFund.id) {
          return {
            ...f,
            assignedToId,
            proposalStatus,
            meetingStatus,
            remarks
          };
        }
        return f;
      })
    );

    setToastMessage(`Saved pipeline updates for ${activeFund.agency}!`);
    setTimeout(() => setToastMessage(""), 3000);
  };

  // Filter logic
  const filteredFunds = useMemo(() => {
    return funds.filter((f) => {
      // 1. Text Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesAgency = f.agency.toLowerCase().includes(query);
        const matchesFocus = f.focusArea.toLowerCase().includes(query);
        const matchesEligibility = f.eligibility.toLowerCase().includes(query);
        if (!matchesAgency && !matchesFocus && !matchesEligibility) return false;
      }

      // 2. Fund Type
      if (selectedType !== "All" && f.type !== selectedType) return false;

      // 3. Status Filter
      if (selectedStatus !== "All" && f.proposalStatus !== selectedStatus) return false;

      return true;
    });
  }, [funds, searchQuery, selectedType, selectedStatus]);

  // Summary Metrics
  const summaryMetrics = useMemo(() => {
    const totalPool = funds.reduce((acc, f) => acc + f.amountNum, 0);
    const activePipeline = funds
      .filter((f) => f.proposalStatus === "Drafting" || f.proposalStatus === "Submitted")
      .reduce((acc, f) => acc + f.amountNum, 0);
    const wonCount = funds.filter((f) => f.proposalStatus === "Won").length;
    const wonValue = funds
      .filter((f) => f.proposalStatus === "Won")
      .reduce((acc, f) => acc + f.amountNum, 0);

    return {
      totalPool,
      activePipeline,
      wonCount,
      wonValue
    };
  }, [funds]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "Won":
        return "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/20";
      case "Submitted":
        return "bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/20";
      case "Drafting":
        return "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/20";
      case "Lost":
        return "bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900/20";
      default:
        return "bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-400 border border-slate-200 dark:border-zinc-800";
    }
  };

  return (
    <div className="space-y-6 text-slate-900 dark:text-zinc-50" id="funding-page-root">
      
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-16 right-5 bg-emerald-600 text-white font-semibold text-xs px-4 py-2.5 rounded-md shadow-lg z-[2000] flex items-center gap-2 animate-bounce">
          <CheckCircle size={14} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-zinc-50 tracking-tight flex items-center gap-2">
            <DollarSign className="text-indigo-600 dark:text-indigo-400" />
            Water Fund Intelligence System
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            Discover, track and align third-party ESG grants and corporate CSR opportunities to speed up campus installations.
          </p>
        </div>
      </div>

      {/* THREE VALUE KANBAN COUNTERS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5" id="funding-metrics-cards">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-450 uppercase tracking-widest">Aggregate Grant Pool</p>
            <h3 className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 font-mono">₹{summaryMetrics.totalPool.toLocaleString("en-IN")}</h3>
            <p className="text-[10px] text-slate-400 dark:text-zinc-500">6 high-match opportunities indexed</p>
          </div>
          <div className="w-10 h-10 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-100/40 dark:border-indigo-900/20 flex items-center justify-center">
            <Globe size={18} />
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-widest">Active Application Value</p>
            <h3 className="text-lg font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">₹{summaryMetrics.activePipeline.toLocaleString("en-IN")}</h3>
            <p className="text-[10px] text-slate-400 dark:text-zinc-500">3 proposal cycles in progress</p>
          </div>
          <div className="w-10 h-10 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 border border-purple-100/40 dark:border-purple-900/20 flex items-center justify-center">
            <Clock size={18} />
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-4 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-widest">Secured Direct Capital</p>
            <h3 className="text-lg font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">₹{summaryMetrics.wonValue.toLocaleString("en-IN")}</h3>
            <p className="text-[10px] text-slate-400 dark:text-zinc-500">{summaryMetrics.wonCount} official award cycles completed</p>
          </div>
          <div className="w-10 h-10 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100/40 dark:border-emerald-900/20 flex items-center justify-center">
            <Award size={18} />
          </div>
        </div>
      </div>

      {/* FILTER & EXPLORATION SPLIT SECTION */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT COLUMN: Opportunity Finder List (7 Cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-4 shadow-sm space-y-4">
            
            {/* SEARCH & FILTER CONTROLS */}
            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400 dark:text-zinc-500" />
                <input
                  type="text"
                  placeholder="Search grants by agency, eligibility, focus area..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-9 pl-9 pr-4 text-xs border border-slate-200 dark:border-zinc-800 rounded-md focus:border-indigo-500 outline-none text-slate-900 dark:text-zinc-50 bg-slate-50 dark:bg-zinc-900/50"
                />
              </div>

              <div className="flex gap-2">
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="h-9 px-2 text-xs border border-slate-200 dark:border-zinc-800 rounded-md outline-none bg-white dark:bg-zinc-900 font-medium text-slate-700 dark:text-zinc-300 focus:border-indigo-500"
                >
                  <option value="All">All Grant Types</option>
                  <option value="CSR Fund">CSR Funds</option>
                  <option value="Government Grant">Govt Grants</option>
                  <option value="Impact Fund">Impact Funds</option>
                  <option value="International Fund">International</option>
                </select>

                <select
                  value={selectedStatus}
                  onChange={(e) => setSelectedStatus(e.target.value)}
                  className="h-9 px-2 text-xs border border-slate-200 dark:border-zinc-800 rounded-md outline-none bg-white dark:bg-zinc-900 font-medium text-slate-700 dark:text-zinc-300 focus:border-indigo-500"
                >
                  <option value="All">All Pipeline Status</option>
                  <option value="Not Started">Not Started</option>
                  <option value="Drafting">Drafting</option>
                  <option value="Submitted">Submitted</option>
                  <option value="Won">Won</option>
                  <option value="Lost">Lost</option>
                </select>
              </div>
            </div>

            {/* FUNDS DIRECTORY LIST */}
            <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
              {filteredFunds.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 dark:border-zinc-800 rounded-md">
                  <p className="text-xs text-slate-500 italic">No matching funding sources found.</p>
                </div>
              ) : (
                filteredFunds.map((fund) => {
                  const isSelected = fund.id === selectedFundId;
                  const assignedTo = teamMembers.find((m) => m.id === fund.assignedToId);

                  return (
                    <div
                      key={fund.id}
                      onClick={() => setSelectedFundId(fund.id)}
                      className={`p-4 border rounded-md transition-all cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-3 ${
                        isSelected
                          ? "border-indigo-600 dark:border-indigo-500 bg-indigo-50/20 dark:bg-indigo-950/15 shadow-sm"
                          : "border-slate-200 dark:border-zinc-850 bg-white dark:bg-[#09090b] hover:border-slate-300 dark:hover:border-zinc-800"
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold uppercase text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 border border-slate-150 dark:border-zinc-700 px-1.5 py-0.2 rounded-sm">
                            {fund.type}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">ID: {fund.id}</span>
                        </div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-zinc-50 truncate">{fund.agency}</h4>
                        <p className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-1">{fund.focusArea}</p>
                        
                        <div className="flex items-center gap-4 text-[10px] text-slate-500 dark:text-zinc-450">
                          <span className="flex items-center gap-1 font-semibold text-slate-700 dark:text-zinc-300">
                            <Calendar size={11} /> Deadline: {fund.deadline}
                          </span>
                          {assignedTo && (
                            <span className="flex items-center gap-1">
                              <User size={11} /> Owner: {assignedTo.name}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex md:flex-col items-end gap-2 text-right flex-shrink-0">
                        <span className="text-xs font-extrabold text-slate-900 dark:text-zinc-50 font-mono">
                          {fund.amount}
                        </span>
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase tracking-wide border ${getStatusBadge(
                          fund.proposalStatus
                        )}`}>
                          {fund.proposalStatus}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

          </div>
        </div>

        {/* RIGHT COLUMN: Pipeline CRM Assignment Panel (5 Cols) */}
        <div className="lg:col-span-5">
          {activeFund ? (
            <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-5 shadow-sm space-y-5">
              
              {/* Profile Card Header */}
              <div className="border-b border-slate-100 dark:border-zinc-850/80 pb-4 space-y-2">
                <span className="text-[9px] font-bold tracking-widest text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-100 dark:border-indigo-900/30 uppercase">
                  Match: {activeFund.matchRate}
                </span>
                <h3 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 leading-tight pt-1">
                  {activeFund.agency}
                </h3>
                <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium">Focus Country: {activeFund.country}</p>
              </div>

              {/* Fund Details Information Block */}
              <div className="space-y-4 text-xs">
                <div className="space-y-1">
                  <h4 className="font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider text-[9px]">Eligibility Criteria</h4>
                  <p className="text-slate-700 dark:text-zinc-300 leading-relaxed bg-slate-50 dark:bg-zinc-900/50 p-2.5 rounded border border-slate-150 dark:border-zinc-800/80">
                    {activeFund.eligibility}
                  </p>
                </div>

                <div className="space-y-1">
                  <h4 className="font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider text-[9px]">Technical Scope</h4>
                  <p className="text-slate-700 dark:text-zinc-300 leading-relaxed">
                    {activeFund.focusArea}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3.5 pt-1">
                  <div>
                    <h4 className="font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider text-[9px]">Agency Contact</h4>
                    <p className="text-slate-800 dark:text-zinc-200 font-semibold mt-0.5">{activeFund.contactPerson}</p>
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider text-[9px]">Portal Website</h4>
                    <a
                      href={activeFund.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 mt-0.5 font-bold"
                    >
                      Visit Website <ExternalLink size={10} />
                    </a>
                  </div>
                </div>
              </div>

              {/* Fund Assignment and Lead Tracking CRM Form */}
              <div className="border-t border-slate-100 dark:border-zinc-850/80 pt-5 space-y-4">
                <div className="flex items-center gap-1.5 pb-1 border-b border-slate-100 dark:border-zinc-850/85">
                  <SlidersHorizontal size={13} className="text-indigo-600 dark:text-indigo-400" />
                  <h4 className="text-xs font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wide">
                    CRM Assignment & Pipeline
                  </h4>
                </div>

                <form onSubmit={handleSaveCRM} className="space-y-4">
                  <div className="grid grid-cols-2 gap-3.5 text-xs">
                    
                    {/* Owner assignment */}
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 dark:text-zinc-455">Assigned Specialist</label>
                      <select
                        value={assignedToId}
                        onChange={(e) => setAssignedToId(e.target.value)}
                        className="w-full h-8 px-2.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 rounded outline-none text-slate-800 dark:text-zinc-200 font-medium"
                      >
                        {teamMembers.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} ({member.team.split(" ")[0]})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Proposal Status */}
                    <div className="space-y-1">
                      <label className="font-bold text-slate-500 dark:text-zinc-455">Proposal Status</label>
                      <select
                        value={proposalStatus}
                        onChange={(e) => setProposalStatus(e.target.value as any)}
                        className="w-full h-8 px-2.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 focus:border-indigo-500 rounded outline-none text-indigo-700 dark:text-indigo-400 font-semibold"
                      >
                        <option value="Not Started">Not Started</option>
                        <option value="Drafting">Drafting</option>
                        <option value="Submitted">Submitted</option>
                        <option value="Won">(Won) Awarded</option>
                        <option value="Lost">Lost</option>
                      </select>
                    </div>

                    {/* Meeting status */}
                    <div className="space-y-1 col-span-2">
                      <label className="font-bold text-slate-500 dark:text-zinc-455">Agency Meeting Status</label>
                      <div className="grid grid-cols-3 gap-2 mt-1">
                        {["Not Scheduled", "Scheduled", "Completed"].map((st) => {
                          const isSel = meetingStatus === st;
                          return (
                            <button
                              key={st}
                              type="button"
                              onClick={() => setMeetingStatus(st as any)}
                              className={`h-8 border text-[11px] rounded transition-all cursor-pointer font-medium ${
                                isSel
                                  ? "bg-sky-50 dark:bg-sky-950/40 border-sky-400 dark:border-sky-800 text-sky-800 dark:text-sky-300 font-bold"
                                  : "bg-slate-50 dark:bg-zinc-900 border-slate-200 dark:border-zinc-800 text-slate-500 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800"
                              }`}
                            >
                              {st}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Remarks log */}
                    <div className="col-span-2 space-y-1">
                      <label className="font-bold text-slate-500 dark:text-zinc-455">Operations Remarks & Activity Log</label>
                      <textarea
                        rows={3}
                        value={remarks}
                        onChange={(e) => setRemarks(e.target.value)}
                        placeholder="Log next proposal milestones or application remarks..."
                        className="w-full p-2.5 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded outline-none focus:border-indigo-500 resize-none text-slate-800 dark:text-zinc-200"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white dark:bg-indigo-600 dark:hover:bg-indigo-500 font-extrabold rounded text-xs transition-all shadow-sm cursor-pointer text-center"
                  >
                    Update Pipeline Node
                  </button>
                </form>
              </div>

            </div>
          ) : (
            <div className="bg-slate-50 dark:bg-zinc-900/40 border border-dashed border-slate-200 dark:border-zinc-800 rounded-md p-6 text-center text-xs text-slate-400 dark:text-zinc-500">
              Select an indexed funding source from the left to view and edit pipeline tracking logs.
            </div>
          )}
        </div>

      </div>

    </div>
  );
}
