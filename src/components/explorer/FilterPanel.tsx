import React, { useMemo } from "react";
import { X, RefreshCw, Filter, Trello, Shield } from "lucide-react";
import { Location, Category, RwhStatus, WaterStressLevel, TeamMember, WorkStatus } from "../../data/mockData.types";

interface FilterPanelProps {
  locations: Location[];
  teamMembers: TeamMember[];
  selectedState: string;
  setSelectedState: (state: string) => void;
  selectedDistrict: string;
  setSelectedDistrict: (district: string) => void;
  selectedCategories: Category[];
  setSelectedCategories: (categories: Category[]) => void;
  selectedRwhStatuses: RwhStatus[];
  setSelectedRwhStatuses: (statuses: RwhStatus[]) => void;
  selectedWaterStressLevels: WaterStressLevel[];
  setSelectedWaterStressLevels: (levels: WaterStressLevel[]) => void;
  minArea: number;
  setMinArea: (area: number) => void;
  maxArea: number;
  setMaxArea: (area: number) => void;

  // CRM Filters
  selectedAssignee: string;
  setSelectedAssignee: (val: string) => void;
  selectedPriority: string;
  setSelectedPriority: (val: string) => void;
  selectedWorkStatus: string;
  setSelectedWorkStatus: (val: string) => void;

  onReset: () => void;
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

export default function FilterPanel({
  locations,
  teamMembers,
  selectedState,
  setSelectedState,
  selectedDistrict,
  setSelectedDistrict,
  selectedCategories,
  setSelectedCategories,
  selectedRwhStatuses,
  setSelectedRwhStatuses,
  selectedWaterStressLevels,
  setSelectedWaterStressLevels,
  minArea,
  setMinArea,
  maxArea,
  setMaxArea,

  selectedAssignee,
  setSelectedAssignee,
  selectedPriority,
  setSelectedPriority,
  selectedWorkStatus,
  setSelectedWorkStatus,

  onReset,
}: FilterPanelProps) {
  // Extract dynamic list of States from the full dataset
  const states = useMemo(() => {
    const set = new Set(locations.map((l) => l.state));
    return Array.from(set).sort();
  }, [locations]);

  // Extract Districts based on selected State
  const districts = useMemo(() => {
    const filtered = selectedState
      ? locations.filter((l) => l.state === selectedState)
      : locations;
    const set = new Set(filtered.map((l) => l.district));
    return Array.from(set).sort();
  }, [locations, selectedState]);

  // Static Lists
  const categoriesList: Category[] = [
    "Industry",
    "Manufacturing",
    "Mining",
    "School",
    "College",
    "University",
    "Hospital",
    "Apartment/Residential",
    "Hotel",
    "Government Building",
    "Data Centre",
  ];

  const rwhStatusesList: RwhStatus[] = [
    "verified_has_rwh",
    "verified_no_rwh",
    "unknown",
  ];

  const waterStressLevelsList: WaterStressLevel[] = [
    "Safe",
    "Semi-Critical",
    "Critical",
    "Over-Exploited",
  ];

  const toggleCategory = (cat: Category) => {
    if (selectedCategories.includes(cat)) {
      setSelectedCategories(selectedCategories.filter((c) => c !== cat));
    } else {
      setSelectedCategories([...selectedCategories, cat]);
    }
  };

  const toggleRwhStatus = (status: RwhStatus) => {
    if (selectedRwhStatuses.includes(status)) {
      setSelectedRwhStatuses(selectedRwhStatuses.filter((s) => s !== status));
    } else {
      setSelectedRwhStatuses([...selectedRwhStatuses, status]);
    }
  };

  const toggleWaterStress = (level: WaterStressLevel) => {
    if (selectedWaterStressLevels.includes(level)) {
      setSelectedWaterStressLevels(
        selectedWaterStressLevels.filter((l) => l !== level)
      );
    } else {
      setSelectedWaterStressLevels([...selectedWaterStressLevels, level]);
    }
  };

  const getRwhStatusLabel = (status: RwhStatus) => {
    if (status === "verified_has_rwh") return "Has RWH";
    if (status === "verified_no_rwh") return "No RWH";
    return "Unknown";
  };

  return (
    <div className="w-full h-full bg-[#FAFBFC] border border-[#DFE1E6] rounded-[3px] p-4 overflow-y-auto space-y-5 font-sans text-[#172B4D]">
      {/* SECTION: PANEL HEADER */}
      <div className="flex items-center justify-between pb-2 border-b border-[#F4F5F7]">
        <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-widest text-[#5E6C84]">
          <Filter size={12} className="text-[#0052CC]" />
          <span>Refine Directory</span>
        </div>
        <button
          onClick={onReset}
          className="text-[10px] text-[#0052CC] hover:text-[#0065FF] flex items-center gap-1 font-bold bg-transparent border-0 cursor-pointer transition-all"
        >
          <RefreshCw size={10} />
          Reset All
        </button>
      </div>

      {/* SECTION: CRM & OUTREACH PIPELINE FILTERS */}
      <div className="space-y-3 bg-[#DEEBFF]/30 border border-[#B3D4FF] p-3 rounded-[3px]">
        <h4 className="text-[11px] font-bold text-[#0747A6] uppercase tracking-wider flex items-center gap-1.5">
          <Trello size={12} />
          <span>CRM & Sales Funnel</span>
        </h4>

        {/* Assigned To */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#5E6C84] uppercase tracking-wide">Assigned To</label>
          <select
            id="explorer-assignee-filter"
            value={selectedAssignee}
            onChange={(e) => setSelectedAssignee(e.target.value)}
            className="w-full text-xs h-[30px] px-2 bg-white border border-[#DFE1E6] rounded-[3px] outline-none text-[#172B4D] font-medium"
          >
            <option value="All">All Specialists</option>
            <option value="Unassigned">Unassigned Only</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        {/* Work Status Stage */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#5E6C84] uppercase tracking-wide">Pipeline Stage</label>
          <select
            id="explorer-work-status-filter"
            value={selectedWorkStatus}
            onChange={(e) => setSelectedWorkStatus(e.target.value)}
            className="w-full text-xs h-[30px] px-2 bg-white border border-[#DFE1E6] rounded-[3px] outline-none text-[#172B4D] font-medium"
          >
            <option value="All">All Stages</option>
            <option value="Unassigned">Unassigned (No Pipeline)</option>
            {WORK_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        {/* Conversion Priority */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#5E6C84] uppercase tracking-wide">Priority</label>
          <select
            id="explorer-priority-filter"
            value={selectedPriority}
            onChange={(e) => setSelectedPriority(e.target.value)}
            className="w-full text-xs h-[30px] px-2 bg-white border border-[#DFE1E6] rounded-[3px] outline-none text-[#172B4D] font-medium"
          >
            <option value="All">All Priorities</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
      </div>

      {/* Cascading Location Section */}
      <div className="space-y-3">
        <h4 className="text-[11px] font-bold text-[#5E6C84] uppercase tracking-wider">
          Geographic Focus
        </h4>

        {/* State */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#5E6C84]">State</label>
          <select
            id="state-filter-select"
            value={selectedState}
            onChange={(e) => {
              setSelectedState(e.target.value);
              setSelectedDistrict("");
            }}
            className="w-full text-xs h-[30px] px-2 bg-[#FAFBFC] border border-[#DFE1E6] hover:bg-[#EBECF0] rounded-[3px] focus:bg-white focus:border-[#0052CC] outline-none text-[#172B4D]"
          >
            <option value="">All States ({states.length})</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
        </div>

        {/* District */}
        <div className="space-y-1">
          <label className="text-[10px] font-bold text-[#5E6C84]">District</label>
          <select
            id="district-filter-select"
            value={selectedDistrict}
            onChange={(e) => {
              setSelectedDistrict(e.target.value);
            }}
            className="w-full text-xs h-[30px] px-2 bg-[#FAFBFC] border border-[#DFE1E6] hover:bg-[#EBECF0] rounded-[3px] focus:bg-white focus:border-[#0052CC] outline-none text-[#172B4D]"
          >
            <option value="">All Districts ({districts.length})</option>
            {districts.map((dist) => (
              <option key={dist} value={dist}>
                {dist}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Categories */}
      <div className="space-y-2 border-t border-[#F4F5F7] pt-3.5">
        <h4 className="text-[11px] font-bold text-[#5E6C84] uppercase tracking-wider">
          Institution Category
        </h4>
        <div className="grid grid-cols-1 gap-1.5 max-h-[120px] overflow-y-auto pr-1">
          {categoriesList.map((cat) => {
            const checked = selectedCategories.includes(cat);
            return (
              <label
                key={cat}
                className="flex items-center gap-2.5 text-xs text-[#172B4D] cursor-pointer hover:text-black py-0.5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(cat)}
                  className="w-3.5 h-3.5 text-[#0052CC] border-[#DFE1E6] rounded-[2px] focus:ring-[#0052CC] cursor-pointer"
                />
                <span>{cat}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* RWH Status */}
      <div className="space-y-2 border-t border-[#F4F5F7] pt-3.5">
        <h4 className="text-[11px] font-bold text-[#5E6C84] uppercase tracking-wider">
          Harvesting Status
        </h4>
        <div className="space-y-1.5">
          {rwhStatusesList.map((status) => {
            const checked = selectedRwhStatuses.includes(status);
            let colorDot = "bg-gray-400";
            if (status === "verified_has_rwh") colorDot = "bg-[#00875A]";
            if (status === "verified_no_rwh") colorDot = "bg-[#DE350B]";
            if (status === "unknown") colorDot = "bg-[#FF991F]";

            return (
              <label
                key={status}
                className="flex items-center gap-2.5 text-xs text-[#172B4D] cursor-pointer hover:text-black py-0.5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleRwhStatus(status)}
                  className="w-3.5 h-3.5 text-[#0052CC] border-[#DFE1E6] rounded-[2px] focus:ring-[#0052CC] cursor-pointer"
                />
                <span className={`w-2 h-2 rounded-full ${colorDot}`} />
                <span className="truncate">{getRwhStatusLabel(status)}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Water Stress Levels */}
      <div className="space-y-2 border-t border-[#F4F5F7] pt-3.5">
        <h4 className="text-[11px] font-bold text-[#5E6C84] uppercase tracking-wider">
          Water Stress Level
        </h4>
        <div className="space-y-1.5">
          {waterStressLevelsList.map((level) => {
            const checked = selectedWaterStressLevels.includes(level);
            let colorDot = "bg-[#00875A]";
            if (level === "Semi-Critical") colorDot = "bg-[#5E6C84]";
            if (level === "Critical") colorDot = "bg-[#FF991F]";
            if (level === "Over-Exploited") colorDot = "bg-[#DE350B]";

            return (
              <label
                key={level}
                className="flex items-center gap-2.5 text-xs text-[#172B4D] cursor-pointer hover:text-black py-0.5"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleWaterStress(level)}
                  className="w-3.5 h-3.5 text-[#0052CC] border-[#DFE1E6] rounded-[2px] focus:ring-[#0052CC] cursor-pointer"
                />
                <span className={`w-1.5 h-1.5 rounded-sm ${colorDot}`} />
                <span>{level}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Land Area Slider */}
      <div className="space-y-2 border-t border-[#F4F5F7] pt-3.5 pb-1">
        <h4 className="text-[11px] font-bold text-[#5E6C84] uppercase tracking-wider">
          Land Area (Acres)
        </h4>
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <span className="text-[9px] text-[#5E6C84] font-bold uppercase tracking-wider block">Min</span>
            <input
              type="number"
              min="0"
              max={maxArea}
              value={minArea}
              onChange={(e) => setMinArea(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full text-xs h-[28px] px-2 bg-[#FAFBFC] border border-[#DFE1E6] rounded-[3px] outline-none focus:bg-white focus:border-[#0052CC]"
            />
          </div>
          <div className="flex-1 space-y-1">
            <span className="text-[9px] text-[#5E6C84] font-bold uppercase tracking-wider block">Max</span>
            <input
              type="number"
              min={minArea}
              max="5000"
              value={maxArea}
              onChange={(e) => setMaxArea(Math.max(minArea, parseFloat(e.target.value) || 0))}
              className="w-full text-xs h-[28px] px-2 bg-[#FAFBFC] border border-[#DFE1E6] rounded-[3px] outline-none focus:bg-white focus:border-[#0052CC]"
            />
          </div>
        </div>
        <div className="pt-2">
          <input
            type="range"
            min="0"
            max="5000"
            step="10"
            value={maxArea}
            onChange={(e) => setMaxArea(parseInt(e.target.value))}
            className="w-full h-1 bg-[#EBECF0] rounded-lg appearance-none cursor-pointer accent-[#0052CC]"
          />
          <div className="flex justify-between text-[10px] text-[#5E6C84] mt-1">
            <span>0 ac</span>
            <span>Limit: {maxArea} ac</span>
            <span>5000+ ac</span>
          </div>
        </div>
      </div>
    </div>
  );
}
