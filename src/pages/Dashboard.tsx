import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { 
  CheckCircle, 
  XCircle, 
  Database, 
  Activity, 
  HelpCircle, 
  FlameKindling,
  UserCheck2,
  TrendingUp,
  SlidersHorizontal,
  ChevronRight,
  TrendingDown,
  Percent,
  Trello,
  Briefcase,
  AlertOctagon,
  Calendar,
  Users,
  Sparkles,
  ArrowRight,
  Layers,
  Search,
  Globe,
  Building2,
  DollarSign,
  FileText,
  Clock,
  Shield,
  Filter,
  CheckCircle2,
  Info,
  Sliders,
  ChevronLeft,
  BookOpen,
  MapPin,
  RefreshCw,
  Plus,
  Compass,
  Cpu
} from "lucide-react";
import { 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  AreaChart, 
  Area, 
  RadarChart, 
  PolarGrid, 
  PolarAngleAxis, 
  PolarRadiusAxis, 
  Radar 
} from "recharts";
import { APIProvider, Map as GoogleMap, AdvancedMarker, Pin, InfoWindow, useMap } from "@vis.gl/react-google-maps";
import { Location, Assignment, TeamMember, WorkStatus, Category } from "../data/mockData.types";
import StatCard from "../components/dashboard/StatCard";
import DetailDrawer from "../components/explorer/DetailDrawer";

interface DashboardProps {
  locations: Location[];
  assignments: Assignment[];
  teamMembers: TeamMember[];
  onUpdateAssignment: (updated: Assignment) => void;
  activeSection: string;
  setActiveSection: (sec: string) => void;
  dashboardMapLayer: "stress" | "groundwater" | "rainfall" | "density";
  setDashboardMapLayer: (layer: "stress" | "groundwater" | "rainfall" | "density") => void;
  theme?: "light" | "dark";
  selectedCategories: Category[];
  setSelectedCategories: (cats: Category[]) => void;
  setActiveSidebarItem: (item: string) => void;
}

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string || "";
const GOOGLE_MAPS_MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string || "";

function GoogleCircle({ center, radius, options }: { center: { lat: number; lng: number }; radius: number; options: google.maps.CircleOptions }) {
  const map = useMap();
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    const circle = new google.maps.Circle({ center, radius, ...options });
    circle.setMap(map);
    return () => { circle.setMap(null); };
  }, [map, center.lat, center.lng, radius, JSON.stringify(options)]);
  return null;
}

export default function Dashboard({ 
  locations, 
  assignments, 
  teamMembers, 
  onUpdateAssignment,
  activeSection,
  setActiveSection,
  dashboardMapLayer,
  setDashboardMapLayer,
  theme,
  selectedCategories,
  setSelectedCategories,
  setActiveSidebarItem,
}: DashboardProps) {
  const navigate = useNavigate();
  
  // Local state managers
  const [selectedLoc, setSelectedLoc] = useState<Location | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [kpiSearchText, setKpiSearchText] = useState("");
  const [kpiActiveTab, setKpiActiveTab] = useState<"all" | "high-priority" | "unverified">("all");
  const [mapSearchText, setMapSearchText] = useState("");
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number }>({ lat: 20.5937, lng: 78.9629 }); // default India
  const [customToast, setCustomToast] = useState<string | null>(null);
  const [opportunitySearch, setOpportunitySearch] = useState("");

  // Auto clear toast helper
  useEffect(() => {
    if (customToast) {
      const timer = setTimeout(() => setCustomToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [customToast]);

  // Handle sidebar navigation clicks that update dashboardMapLayer
  useEffect(() => {
    if (dashboardMapLayer) {
      setCustomToast(`Active GIS Layer Switched to: ${dashboardMapLayer.toUpperCase()}`);
    }
  }, [dashboardMapLayer]);

  // --- STATS ENGINE ---
  const totalLocationsCount = locations.length;

  const statsBreakdown = useMemo(() => {
    const counts = {
      total: totalLocationsCount,
      Industry: 0,
      Manufacturing: 0,
      University: 0,
      College: 0,
      School: 0,
      Hospital: 0,
      "Apartment/Residential": 0,
      Mining: 0,
      "Data Centre": 0,
      Hotel: 0,
      "Government Building": 0,
      // Placeholders for legacy/other metrics
      SoftwareParks: 6,
      MunicipalBodies: 3,
      Other: 0
    };

    locations.forEach((loc) => {
      const cat = loc.category;
      if (cat in counts) {
        counts[cat as keyof typeof counts] += 1;
      } else {
        counts.Other += 1;
      }
    });

    return counts;
  }, [locations]);

  // Sparkline data generator for Atlassian visual feel
  const generateSparkline = (val: number, multiplier = 1.1) => {
    return [
      { pv: val * 0.7 },
      { pv: val * 0.95 },
      { pv: val * 0.8 },
      { pv: val * 1.1 },
      { pv: val * multiplier }
    ];
  };

  // 14 Core KPI Items schema
  const kpiItems = [
    { id: "kpi-total", label: "Total Organizations", val: totalLocationsCount, trend: "+12% MoM", isUp: true, cat: "all", icon: Database, bg: "bg-[#FAFBFC]", border: "border-[#DFE1E6]" },
    { id: "kpi-ind", label: "Industries", val: statsBreakdown.Industry, trend: "+4% MoM", isUp: true, cat: "Industry", icon: Building2, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-man", label: "Manufacturing Facilities", val: statsBreakdown.Manufacturing, trend: "+2% MoM", isUp: true, cat: "Manufacturing", icon: Sliders, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-uni", label: "Universities Tracked", val: statsBreakdown.University, trend: "+15% MoM", isUp: true, cat: "University", icon: BookOpen, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-col", label: "Colleges", val: statsBreakdown.College, trend: "Stable", isUp: true, cat: "College", icon: Sparkles, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-sch", label: "Schools Cataloged", val: statsBreakdown.School, trend: "-1%", isUp: false, cat: "School", icon: Users, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-hosp", label: "Hospitals", val: statsBreakdown.Hospital, trend: "+18%", isUp: true, cat: "Hospital", icon: Activity, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-apt", label: "Apartments & Housing", val: statsBreakdown["Apartment/Residential"], trend: "+9%", isUp: true, cat: "Apartment/Residential", icon: Shield, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-dc", label: "Data Centres", val: statsBreakdown["Data Centre"], trend: "+24% Peak", isUp: true, cat: "Data Centre", icon: Cpu, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-hotel", label: "Hotels & Hospitality", val: statsBreakdown.Hotel, trend: "+5% MoM", isUp: true, cat: "Hotel", icon: Compass, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-govt", label: "Government Buildings", val: statsBreakdown["Government Building"], trend: "Stable", isUp: true, cat: "Government Building", icon: Shield, bg: "bg-white", border: "border-[#DFE1E6]" },
    { id: "kpi-mine", label: "Mining Operations", val: statsBreakdown.Mining, trend: "+12%", isUp: true, cat: "Mining", icon: FlameKindling, bg: "bg-white", border: "border-[#DFE1E6]" },
  ];

  // Filter KPI Row dynamically
  const filteredKpiItems = useMemo(() => {
    return kpiItems.filter(item => {
      const matchSearch = item.label.toLowerCase().includes(kpiSearchText.toLowerCase());
      if (kpiActiveTab === "all") return matchSearch;
      if (kpiActiveTab === "high-priority") return matchSearch && (item.cat === "Industry" || item.cat === "Manufacturing" || item.label.includes("Data") || item.label.includes("Mining"));
      if (kpiActiveTab === "unverified") return matchSearch && (item.cat === "School" || item.cat === "Hospital" || item.cat === "Apartment/Residential");
      return matchSearch;
    });
  }, [kpiSearchText, kpiActiveTab, statsBreakdown]);

  // --- RECHARTS CALCULATIONS ---
  const categoryDistributionData = useMemo(() => {
    const list: Record<string, number> = {};
    locations.forEach(l => {
      list[l.category] = (list[l.category] || 0) + 1;
    });
    return Object.keys(list).map(key => ({
      name: key,
      value: list[key]
    }));
  }, [locations]);

  const waterSourceDistributionData = useMemo(() => {
    const list: Record<string, number> = {};
    locations.forEach(l => {
      const src = (l.water.waterSource || "Mixed").split(" ")[0]; // e.g. "Borewell", "Municipal"
      list[src] = (list[src] || 0) + 1;
    });
    return Object.keys(list).map(key => ({
      name: key,
      count: list[key]
    }));
  }, [locations]);

  const priorityLevelDistribution = useMemo(() => {
    const activeAssigns = assignments;
    const counts = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    locations.forEach((loc) => {
      const assign = activeAssigns.find(a => a.locationId === loc.id);
      if (loc.water.waterStressLevel === "Over-Exploited" || loc.water.waterStressLevel === "Critical") {
        counts.Critical += 1;
      } else if (assign?.priority === "High") {
        counts.High += 1;
      } else if (assign?.priority === "Medium") {
        counts.Medium += 1;
      } else {
        counts.Low += 1;
      }
    });
    return [
      { name: "Critical Stress", value: counts.Critical, color: "#DE350B" },
      { name: "High Priority", value: counts.High, color: "#FF991F" },
      { name: "Medium Priority", value: counts.Medium, color: "#0052CC" },
      { name: "Low Priority", value: counts.Low, color: "#7A869A" }
    ];
  }, [locations, assignments]);

  // --- AI OPPORTUNITY RANKER ---
  const aiOpportunities = useMemo(() => {
    return locations.map((loc) => {
      let score = 50; // base score
      if (loc.water.waterStressLevel === "Over-Exploited") score += 25;
      if (loc.water.waterStressLevel === "Critical") score += 20;
      if (loc.water.rainwaterHarvesting.status === "verified_no_rwh") score += 20;
      if (loc.water.rainwaterHarvesting.status === "unknown") score += 10;
      if (loc.category === "Industry" || loc.category === "Manufacturing") score += 15;
      
      const acres = loc.water.estimatedRoofArea ? (loc.water.estimatedRoofArea * 4 / 4046.86) : 5;
      if (acres > 500) score += 10;
      if (loc.water.estimatedRoofArea && loc.water.estimatedRoofArea > 404) score += 10;

      // Calculate Estimated Savings in Litres/yr and mock Revenue
      const estimatedSavingsLitres = Math.round(acres * 45000);
      const estRevenueInRupees = Math.round(acres * 2200);

      // Eligibility for CSR funding
      const fundingEligible = loc.category !== "Industry" && loc.category !== "Manufacturing" ? "Highly Eligible (Atal Bhujal)" : "Co-Funded ESG Only";

      return {
        ...loc,
        score,
        savings: `${(estimatedSavingsLitres / 100000).toFixed(1)}L Litres`,
        revenue: `₹${(estRevenueInRupees / 1000).toFixed(0)}k`,
        fundingEligible
      };
    })
    .sort((a, b) => b.score - a.score)
    .filter(op => {
      if (!opportunitySearch.trim()) return true;
      return op.name.toLowerCase().includes(opportunitySearch.toLowerCase()) || op.district.toLowerCase().includes(opportunitySearch.toLowerCase());
    })
    .slice(0, 5); // top 5 ranked
  }, [locations, opportunitySearch]);

  // --- RECENT COMPLETED ACTIVITIES MOCK ---
  const [recentActivitiesList, setRecentActivitiesList] = useState([
    { id: "act-1", title: "Corporate Twin Ingested", desc: "Bosch Automotive Campus registered under Twin ID #BOS-809.", time: "10m ago", author: "Specialist Akash", status: "Ingested" },
    { id: "act-2", title: "Drought Alert Triggered", desc: "Bengaluru Urban ground table water decreased by 4.2% MoM.", time: "1h ago", author: "AI Copilot Node", status: "Warning" },
    { id: "act-3", title: "CSR Application Submitted", desc: "REVA University applied for the HDFC Sustainability Grant.", time: "4h ago", author: "Outreach Team", status: "Funding" },
    { id: "act-4", title: "Site Survey Finalized", desc: "On-site RWH survey completed for BMS College of Engineering.", time: "1d ago", author: "Technical Lead", status: "Completed" },
    { id: "act-5", title: "Engineering Proposal Won", desc: "Negotiation finalized with ITC Food Division (₹12,40,000).", time: "2d ago", author: "Consultant Admin", status: "Won" }
  ]);

  // Add new location helper on map search
  const handleMapSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const target = locations.find(l => l.name.toLowerCase().includes(mapSearchText.toLowerCase()) || l.district.toLowerCase().includes(mapSearchText.toLowerCase()));
    if (target) {
      setMapCenter(target.location);
      setCustomToast(`Centered GIS Map on: ${target.name}`);
    } else {
      alert("No matching nodes found. Try searching for a valid node name or district.");
    }
  };

  // Assign specialist tool
  const handleAssignSpecialist = (locId: string, specId: string) => {
    const spec = teamMembers.find(t => t.id === specId);
    if (!spec) return;
    const existing = assignments.find(a => a.locationId === locId);
    
    if (existing) {
      onUpdateAssignment({
        ...existing,
        assignedToId: specId,
        team: spec.team
      });
    } else {
      onUpdateAssignment({
        locationId: locId,
        assignedToId: specId,
        team: spec.team,
        priority: "High",
        currentStatus: "Contacted",
        createdDate: "2026-07-13",
        activityLog: [{ id: "lg-1", timestamp: "2026-07-13", author: "System AI", note: "Created via Quick Dashboard Assign" }],
        meetingNotes: [],
        documents: []
      });
    }
    setCustomToast(`Assigned ${spec.name} to Node Opportunity!`);
  };

  const COLORS_PALETTE = ["#0052CC", "#00B8D9", "#00875A", "#FF991F", "#DE350B", "#5E6C84", "#6554C0", "#008DA5"];

  return (
    <div className="space-y-8 animate-fadeIn text-slate-900 dark:text-zinc-50" id="dashboard-container">
      
      {/* Micro Status Float Toast */}
      {customToast && (
        <div className="fixed bottom-5 right-5 bg-white dark:bg-zinc-900 text-slate-900 dark:text-white border border-slate-200 dark:border-zinc-800 shadow-2xl px-4 py-3 rounded-md z-[1000] flex items-center gap-2.5 text-xs animate-slideIn">
          <Sparkles size={14} className="text-indigo-600 dark:text-indigo-400" />
          <span>{customToast}</span>
        </div>
      )}

      {/* Large Premium Welcome Hero Banner */}
      <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-6 shadow-sm relative overflow-hidden flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-50/10 dark:bg-indigo-950/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="space-y-1.5 max-w-2xl z-10">
          <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-widest">
            <Sparkles size={14} />
            <span>Central Operations Dashboard</span>
          </div>
          <h2 className="text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            Good Morning, Specialist Akash. Welcome to WIOS.
          </h2>
          <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
            Akash Bhumi & CropNow’s central command node is currently tracking <strong className="text-slate-900 dark:text-white font-semibold">{totalLocationsCount} industrial & institutional Digital Twins</strong> across India. Regional ground aquifers are experiencing typical monsoonal recharge levels.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch gap-2.5 z-10 w-full md:w-auto">
          <div className="bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-850 rounded-md px-4 py-2.5 text-left flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold text-slate-500 dark:text-zinc-400 tracking-wider">Groundwater Depletion</span>
            <span className="text-sm font-extrabold text-amber-600 flex items-center gap-1 mt-0.5">
              Critical (Bengaluru) <FlameKindling size={14} />
            </span>
          </div>
          <div className="bg-slate-50 dark:bg-zinc-900/60 border border-slate-200 dark:border-zinc-850 rounded-md px-4 py-2.5 text-left flex flex-col justify-center">
            <span className="text-[9px] uppercase font-bold text-slate-500 dark:text-zinc-400 tracking-wider">Live Pipeline Volume</span>
            <span className="text-sm font-extrabold text-indigo-600 dark:text-indigo-400 flex items-center gap-1 mt-0.5">
              ₹84,40,000 <TrendingUp size={14} />
            </span>
          </div>
        </div>
      </div>

      {/* SECTION: 14 KPI CARD ROW with Search & Interactive Tabs */}
      <div className="space-y-4" id="dashboard-kpi-rows">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-zinc-850/80 pb-3.5">
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Ecosystem Node breakdown
            </h3>
          </div>
          
          <div className="flex items-center gap-2">
            {/* KPI Inline Filter tab */}
            <div className="flex bg-slate-100 dark:bg-zinc-900 p-0.5 rounded-md text-[11px] font-bold">
              {[
                { id: "all" as const, label: "All Nodes" },
                { id: "high-priority" as const, label: "Heavy Ind / DC" },
                { id: "unverified" as const, label: "Residential/Edu" }
              ].map(tb => (
                <button
                  key={tb.id}
                  onClick={() => setKpiActiveTab(tb.id)}
                  className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors ${
                    kpiActiveTab === tb.id ? "bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-sm" : "text-slate-500 dark:text-zinc-400 hover:text-slate-955"
                  }`}
                >
                  {tb.label}
                </button>
              ))}
            </div>

            {/* KPI Inner Search */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={kpiSearchText}
                onChange={(e) => setKpiSearchText(e.target.value)}
                placeholder="Search metrics..."
                className="pl-7 pr-3 py-1 bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 text-[11px] rounded-md text-slate-900 dark:text-white outline-none focus:border-indigo-500 w-40"
              />
            </div>
          </div>
        </div>

        {/* 14 KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3.5">
          {filteredKpiItems.map((item) => {
            const IconComponent = item.icon;
            return (
              <div 
                key={item.id} 
                className={`bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-3.5 shadow-sm transition-all hover:shadow-md hover:border-indigo-500 dark:hover:border-indigo-400 group cursor-pointer`}
                onClick={() => {
                  if (item.cat === "all") {
                    setSelectedCategories([]);
                  } else {
                    setSelectedCategories([item.cat as Category]);
                  }
                  setActiveSidebarItem("Organizations");
                  navigate("/explorer");
                }}
              >
                <div className="flex justify-between items-start text-slate-500 dark:text-zinc-400">
                  <div className="bg-slate-50 dark:bg-zinc-900 p-1.5 rounded-sm group-hover:bg-indigo-50 dark:group-hover:bg-indigo-950/25 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    <IconComponent size={14} />
                  </div>
                  <span className={`text-[9px] font-bold px-1 py-0.2 rounded font-mono ${
                    item.isUp ? "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40" : "text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/40"
                  }`}>
                    {item.trend}
                  </span>
                </div>
                <div className="mt-3.5">
                  <span className="text-[10px] text-slate-500 dark:text-zinc-400 block font-semibold uppercase tracking-wider truncate" title={item.label}>
                    {item.label}
                  </span>
                  <span className="text-xl font-black text-slate-900 dark:text-white block mt-1 tracking-tight">
                    {item.val}
                  </span>
                </div>
                <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-zinc-850/60 flex items-center justify-between text-[9px] text-indigo-600 dark:text-indigo-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  <span>View Layer</span>
                  <ArrowRight size={10} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SECTION: LARGE GIS INTERACTIVE INDIA MAP & CONTROLS */}
      <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm overflow-hidden" id="dashboard-interactive-map">
        
        {/* Map Header with Real Layer States */}
        <div className="bg-slate-900 dark:bg-[#0d0d10] p-4 border-b border-slate-200 dark:border-zinc-850/80 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Globe size={16} className="text-indigo-400" />
              <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                Geospatial Twin GIS Layer
              </h3>
            </div>
            <p className="text-[10px] text-slate-400 dark:text-zinc-500">
              Real-time monitoring overlay of ground table recharge aquifers and industrial density profiles.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            {/* Real GIS Search */}
            <form onSubmit={handleMapSearchSubmit} className="relative flex-1 md:flex-none">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input 
                type="text" 
                value={mapSearchText}
                onChange={(e) => setMapSearchText(e.target.value)}
                placeholder="Pan map to node name..."
                className="pl-7 pr-3 py-1 bg-slate-800 dark:bg-zinc-900 border border-slate-700 dark:border-zinc-800 text-[11px] rounded-md text-white outline-none focus:border-indigo-500 w-full md:w-48"
              />
            </form>

            {/* In-Map Controls toolbar */}
            <div className="flex bg-slate-800 dark:bg-zinc-900 p-0.5 rounded-md border border-slate-700 dark:border-zinc-800 text-[10px] font-bold">
              {[
                { id: "stress" as const, label: "Stress" },
                { id: "groundwater" as const, label: "Groundwater Table" },
                { id: "rainfall" as const, label: "Rain mm" },
                { id: "density" as const, label: "Industrial clusters" }
              ].map(tb => (
                <button
                  key={tb.id}
                  onClick={() => setDashboardMapLayer(tb.id)}
                  type="button"
                  className={`px-2.5 py-1 rounded-md cursor-pointer transition-colors uppercase ${
                    dashboardMapLayer === tb.id ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
                  }`}
                >
                  {tb.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Dynamic GIS Map Body */}
        <div className="h-[450px] relative w-full flex flex-col lg:flex-row bg-[#FAFBFC]">
          
          {/* Main Google Maps wrapper */}
          <div className="flex-1 h-full relative" id="dashboard-google-map-frame">
            {GOOGLE_MAPS_API_KEY ? (
              <APIProvider apiKey={GOOGLE_MAPS_API_KEY} version="weekly">
                <GoogleMap
                defaultCenter={mapCenter}
                center={mapCenter}
                defaultZoom={5}
                mapId={GOOGLE_MAPS_MAP_ID}
                gestureHandling="greedy"
                style={{ width: "100%", height: "100%" }}
                zoomControl={true}
                mapTypeControl={true}
                fullscreenControl={true}
                scaleControl={true}
                streetViewControl={false}
                internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              >
                {/* Dynamic Aquifer Outlines overlays represented by GoogleCircle */}
                {dashboardMapLayer === "groundwater" && (
                  <>
                    <GoogleCircle center={{ lat: 12.9716, lng: 77.5946 }} radius={4500} options={{ strokeColor: "rgba(0, 82, 204, 0.45)", fillColor: "rgba(0, 82, 204, 0.15)", strokeWeight: 1.5, fillOpacity: 0.15 }} />
                    <GoogleCircle center={{ lat: 13.0358, lng: 77.5970 }} radius={3000} options={{ strokeColor: "rgba(222, 53, 11, 0.45)", fillColor: "rgba(222, 53, 11, 0.15)", strokeWeight: 1.5, fillOpacity: 0.15 }} />
                  </>
                )}

                {dashboardMapLayer === "rainfall" && (
                  <GoogleCircle center={{ lat: 12.9250, lng: 77.5120 }} radius={8000} options={{ strokeColor: "rgba(0, 137, 165, 0.35)", fillColor: "rgba(0, 137, 165, 0.1)", strokeWeight: 1, fillOpacity: 0.1 }} />
                )}

                {/* Markers plot dynamically from locations array */}
                {locations.map((loc) => {
                  // Determine marker color depending on the active GIS layer
                  let markerColor = "#3b82f6";
                  let detailsLabel = "";

                  if (dashboardMapLayer === "stress") {
                    detailsLabel = `Stress: ${loc.water.waterStressLevel}`;
                    if (loc.water.waterStressLevel === "Safe") markerColor = "#00875A";
                    else if (loc.water.waterStressLevel === "Semi-Critical") markerColor = "#FF991F";
                    else if (loc.water.waterStressLevel === "Critical") markerColor = "#DE350B";
                    else markerColor = "#7A869A";
                  } else if (dashboardMapLayer === "groundwater") {
                    detailsLabel = `Source: ${loc.water.waterSource || "Mixed"}`;
                    markerColor = loc.water.waterSource && loc.water.waterSource.includes("Borewell") ? "#DE350B" : "#0052CC";
                  } else if (dashboardMapLayer === "rainfall") {
                    const isObligated = loc.water.estimatedRoofArea && loc.water.estimatedRoofArea > 404;
                    detailsLabel = `RWH Obligation: ${isObligated ? "Legally Mandated" : "Optional"}`;
                    markerColor = loc.water.rainwaterHarvesting.status === "verified_has_rwh" ? "#00875A" : "#DE350B";
                  } else if (dashboardMapLayer === "density") {
                    detailsLabel = `Category: ${loc.category}`;
                    markerColor = loc.category === "Industry" ? "#0052CC" : "#6554C0";
                  }

                  return (
                    <AdvancedMarker
                      key={loc.id}
                      position={loc.location}
                      onClick={() => {
                        setSelectedLoc(loc);
                        setIsDrawerOpen(true);
                      }}
                    >
                      <Pin
                        background={markerColor}
                        borderColor="#ffffff"
                        glyph=""
                      />
                    </AdvancedMarker>
                  );
                })}

                {/* Bounded area highlighting for selected node */}
                {selectedLoc && (
                  <GoogleCircle
                    center={selectedLoc.location}
                    radius={1600}
                    options={{
                      strokeColor: "#6366f1",
                      fillColor: "#6366f1",
                      fillOpacity: 0.15,
                      strokeWeight: 1.5,
                    }}
                  />
                )}

                {/* InfoWindow for selected marker */}
                {selectedLoc && (
                  <InfoWindow
                    position={selectedLoc.location}
                    onCloseClick={() => setSelectedLoc(null)}
                  >
                    <div className="p-1 min-w-[180px] text-slate-900 text-xs">
                      <p className="font-bold m-0 leading-tight">{selectedLoc.name}</p>
                      <p className="text-[10px] text-slate-500 mt-0.5 m-0">{selectedLoc.district}, {selectedLoc.state}</p>
                      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                        <span className="text-[9px] font-bold text-slate-700 uppercase bg-slate-50 px-1 py-0.5 rounded">
                          {dashboardMapLayer === "stress" ? `Stress: ${selectedLoc.water.waterStressLevel}` :
                           dashboardMapLayer === "groundwater" ? `Source: ${selectedLoc.water.waterSource || "Mixed"}` :
                           dashboardMapLayer === "rainfall" ? `RWH: ${selectedLoc.water.estimatedRoofArea && selectedLoc.water.estimatedRoofArea > 404 ? "Mandated" : "Optional"}` :
                           `Category: ${selectedLoc.category}`}
                        </span>
                        <button 
                          onClick={() => {
                            setSelectedLoc(selectedLoc);
                            setIsDrawerOpen(true);
                          }}
                          className="bg-[#0052CC] text-white text-[9px] font-bold px-1.5 py-0.5 rounded hover:bg-[#0065FF]"
                        >
                          Explore Twin
                        </button>
                      </div>
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
              </APIProvider>
            ) : (
              <div className="flex-1 h-full w-full flex items-center justify-center text-sm text-slate-500 bg-[#FAFBFC]">
                Google Maps disabled — set VITE_GOOGLE_MAPS_API_KEY in your .env
              </div>
            )}
          </div>

          {/* Interactive Legend and GIS layers information Panel */}
          <div className="w-full lg:w-72 bg-white dark:bg-[#09090b] border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-zinc-850 p-5 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="border-b border-slate-100 dark:border-zinc-850/60 pb-3.5">
                <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-zinc-400 tracking-wider block">
                  Active GIS Legend
                </span>
                <span className="text-xs font-extrabold text-slate-900 dark:text-white uppercase tracking-wide block mt-1">
                  {dashboardMapLayer === "stress" ? "Water Stress Matrix" : 
                   dashboardMapLayer === "groundwater" ? "Ground Aquifer Levels" : 
                   dashboardMapLayer === "rainfall" ? "RWH Compliance Index" : "Industrial Concentration"}
                </span>
              </div>

              {/* Dynamic Legend items depending on selected layer state */}
              <div className="space-y-3 text-xs leading-relaxed">
                {dashboardMapLayer === "stress" && (
                  <>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400">Circles are color coded by the official CGWA aquifer depletion vulnerability index:</p>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#DE350B]" /> <span>Over-Exploited / Critical Zone</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#FF991F]" /> <span>Semi-Critical Level</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#00875A]" /> <span>Safe Aquifer Table</span></div>
                  </>
                )}
                {dashboardMapLayer === "groundwater" && (
                  <>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400">Borewell dependence and estimated extraction depth thresholds:</p>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#DE350B]" /> <span>Borewell Extraction (&gt; 400 ft)</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#0052CC]" /> <span>Municipal Supply / Mixed</span></div>
                    <p className="text-[10px] text-slate-500 dark:text-zinc-500 italic">Aquifer blue circles represent simulated monsoonal recharge capture radius of 3km.</p>
                  </>
                )}
                {dashboardMapLayer === "rainfall" && (
                  <>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400">Compliance with local rainfall harvesting mandates:</p>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#00875A]" /> <span>RWH Installed & Active</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#DE350B]" /> <span>No Harvesting (High Risk)</span></div>
                  </>
                )}
                {dashboardMapLayer === "density" && (
                  <>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400">Spatial density of water consumers in Bengaluru Urban:</p>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#0052CC]" /> <span>Heavy Industrial / Mfg Nodes</span></div>
                    <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-[#6554C0]" /> <span>Universities & Campuses</span></div>
                  </>
                )}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-zinc-850/60 text-[11px] text-slate-500 dark:text-zinc-400 space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2.5 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-900/30">
                <CheckCircle2 size={13} />
                <span className="font-bold">GIS Coordinate Feed Online</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* SECTION: TWO-COLUMN ANTECEDENT VISUALS (RECHARTS BAR & PIE GRAPHICS) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="dashboard-charts-grid">
        
        {/* Recharts Pie: Org Category Distribution */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-5 shadow-sm flex flex-col justify-between h-[340px]">
          <div className="border-b border-slate-100 dark:border-zinc-850/60 pb-3">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Ecosystem Category Spread
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">Relative division of institutional data twins mapped in the system.</p>
          </div>
          <div className="flex-1 min-h-[180px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryDistributionData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {categoryDistributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS_PALETTE[index % COLORS_PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{
                    backgroundColor: theme === "dark" ? "#09090b" : "#ffffff",
                    borderColor: theme === "dark" ? "#27272a" : "#e4e4e7",
                    color: theme === "dark" ? "#f4f4f5" : "#18181b",
                    fontSize: "11px",
                    borderRadius: "6px"
                  }}
                  formatter={(value) => [`${value} Mapped`, "Volume"]} 
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: "10px" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Recharts Bar: Water Source Extract Distribution */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-5 shadow-sm flex flex-col justify-between h-[340px]">
          <div className="border-b border-slate-100 dark:border-zinc-850/60 pb-3">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Water Source Dependability
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">Classification of primary water feeding lines for active nodes.</p>
          </div>
          <div className="flex-1 min-h-[180px] mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={waterSourceDistributionData}>
                <XAxis dataKey="name" stroke={theme === "dark" ? "#71717a" : "#8e8e93"} style={{ fontSize: "10px" }} />
                <YAxis stroke={theme === "dark" ? "#71717a" : "#8e8e93"} style={{ fontSize: "10px" }} />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: theme === "dark" ? "#09090b" : "#ffffff",
                    borderColor: theme === "dark" ? "#27272a" : "#e4e4e7",
                    color: theme === "dark" ? "#f4f4f5" : "#18181b",
                    fontSize: "11px",
                    borderRadius: "6px"
                  }}
                  formatter={(value) => [`${value} Twins`, "Nodes"]} 
                />
                <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Priority and Aquifer Critical Level Radar / Speed gauge */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md p-5 shadow-sm flex flex-col justify-between h-[340px]">
          <div className="border-b border-slate-100 dark:border-zinc-850/60 pb-3">
            <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Opportunity Severity Index
            </h4>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">Priority breakdown targeting RWH conversions.</p>
          </div>
          
          <div className="flex-1 mt-3 space-y-3.5">
            {priorityLevelDistribution.map((item) => {
              const totalItems = locations.length;
              const percent = totalItems > 0 ? (item.value / totalItems) * 100 : 0;
              return (
                <div key={item.name} className="space-y-1 text-xs">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold text-slate-700 dark:text-zinc-300 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      {item.name}
                    </span>
                    <span className="font-mono font-extrabold text-slate-900 dark:text-white">{item.value} nodes ({percent.toFixed(0)}%)</span>
                  </div>
                  <div className="w-full bg-slate-50 dark:bg-zinc-900 border border-slate-100 dark:border-zinc-850 h-2 rounded-md overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${percent}%`, backgroundColor: item.color }}></div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/30 p-2 rounded-md text-[10px] text-rose-800 dark:text-rose-400 leading-normal flex items-center gap-2">
            <AlertOctagon size={14} className="text-rose-600 dark:text-rose-400 flex-shrink-0" />
            <span>Over 35% of industrial nodes sit in critical aquifer tables.</span>
          </div>
        </div>

      </div>

      {/* SECTION: AI INTELLIGENCE OPPORTUNITY ENGINE (CLICK TO ASSIGN/OPEN ACTION CHANNELS) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6" id="dashboard-ai-insights">
        
        {/* Col 1 & 2: Top Ranked Water Opportunities */}
        <div className="xl:col-span-2 bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between">
          <div className="border-b border-[#F4F5F7] pb-3.5 flex flex-col sm:flex-row justify-between sm:items-center gap-2">
            <div>
              <h4 className="text-xs font-bold text-[#172B4D] uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#0052CC]" />
                Top AI-Ranked Water Opportunities
              </h4>
              <p className="text-[11px] text-[#5E6C84] mt-0.5">High-probability consulting targets based on water stress, obligations, and scale.</p>
            </div>
            
            <div className="relative">
              <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input 
                type="text" 
                value={opportunitySearch}
                onChange={(e) => setOpportunitySearch(e.target.value)}
                placeholder="Search opportunities..."
                className="pl-7 pr-3 py-0.5 bg-white border border-[#DFE1E6] text-[10px] rounded-[3px] outline-none w-36"
              />
            </div>
          </div>

          {/* List of high score opportunities */}
          <div className="divide-y divide-[#F4F5F7] mt-3.5 space-y-1">
            {aiOpportunities.map((op) => {
              const currentAssignee = assignments.find(a => a.locationId === op.id);
              const specialist = teamMembers.find(t => t.id === currentAssignee?.assignedToId);

              return (
                <div key={op.id} className="py-3.5 text-xs flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3.5 hover:bg-[#FAFBFC] transition-colors px-2 rounded-sm group">
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-[#172B4D] truncate group-hover:text-[#0052CC] transition-colors">{op.name}</span>
                      <span className="bg-[#DEEBFF] text-[#0052CC] text-[9px] font-bold px-1.5 py-0.2 rounded-sm uppercase font-mono tracking-wider">
                        Score: {op.score}
                      </span>
                    </div>
                    <div className="text-[10px] text-[#5E6C84] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span>Sector: <strong className="text-gray-700">{op.category}</strong></span>
                      <span>•</span>
                      <span>District: <strong className="text-gray-700">{op.district}</strong></span>
                      <span>•</span>
                      <span className="text-[#DE350B] font-bold">Est Savings: {op.savings}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3.5 flex-shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="text-[10px] text-gray-500 font-medium">Pipeline Yield</p>
                      <p className="font-bold text-gray-900 font-mono">{op.revenue}</p>
                    </div>

                    {/* Quick Assign Dropdown */}
                    <select
                      onChange={(e) => handleAssignSpecialist(op.id, e.target.value)}
                      value={specialist?.id || ""}
                      className="bg-white border border-[#DFE1E6] hover:border-[#0052CC] rounded-[3px] text-[10px] font-bold py-1 px-2 text-[#172B4D] outline-none"
                    >
                      <option value="">{specialist ? `Assigned: ${specialist.name}` : "Assign Expert..."}</option>
                      {teamMembers.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>

                    <button
                      onClick={() => {
                        setSelectedLoc(op);
                        setIsDrawerOpen(true);
                      }}
                      className="bg-[#FAFBFC] hover:bg-[#EBECF0] border border-[#DFE1E6] text-gray-700 text-[10px] font-bold px-2 py-1.5 rounded-[3px] transition-all cursor-pointer flex items-center gap-1"
                    >
                      Open Twin
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Col 3: Smart AI Recommendation Engine */}
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between">
          <div className="border-b border-[#F4F5F7] pb-3">
            <h4 className="text-xs font-bold text-[#0052CC] uppercase tracking-wider flex items-center gap-1">
              <Compass size={14} /> Smart AI Copilot Insights
            </h4>
            <p className="text-[11px] text-[#5E6C84] mt-1">Real-time recommended actions based on statutory compliance laws.</p>
          </div>

          <div className="flex-1 py-3.5 space-y-3 max-h-[220px] overflow-y-auto">
            {[
              { text: "Target 12 campuses missing verified harvesting loops in Bengaluru Urban.", tag: "Atal Bhujal", link: "Bengaluru" },
              { text: "Initiate outreach to ITC Food Division (estimated ESG funding matching score of 94%).", tag: "CSR Funding", link: "ITC" },
              { text: "Alert: BMS College has unverified estimation status. Schedule ground-truth site audit.", tag: "Field Audit", link: "BMS" },
              { text: "Apply CGWA Borewell Restriction warning layer for Bengaluru North taluk.", tag: "Regulation Alert", link: "Bengaluru" }
            ].map((rc, idx) => (
              <div 
                key={idx}
                onClick={() => {
                  setMapSearchText(rc.link);
                  setCustomToast(`Searching for "${rc.link}" recommendations...`);
                }}
                className="p-2.5 bg-gray-50 hover:bg-[#DEEBFF]/30 border border-gray-100 hover:border-[#B3D4FF] rounded-[2px] transition-all cursor-pointer text-[11px] leading-relaxed group"
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="bg-[#0052CC]/10 text-[#0052CC] text-[9px] font-bold px-1.5 py-0.2 rounded font-mono">
                    {rc.tag}
                  </span>
                  <span className="text-gray-400 opacity-0 group-hover:opacity-100 text-[10px] font-bold flex items-center gap-0.5">
                    Execute <ChevronRight size={10} />
                  </span>
                </div>
                <p className="text-[#172B4D] group-hover:text-[#0052CC] font-medium">{rc.text}</p>
              </div>
            ))}
          </div>

          <div className="bg-[#E3FCEF] border border-[#ABF5D1] p-2 rounded-[2px] text-[10px] text-emerald-800 flex items-center gap-1.5">
            <CheckCircle2 size={13} className="text-emerald-600 flex-shrink-0" />
            <span>Smart Recommendations updated: Just Now</span>
          </div>
        </div>

      </div>

      {/* SECTION: COMPREHENSIVE DATA GRIDS, RECENT ACTIVITIES & TIMELINES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="dashboard-projects-section">
        
        {/* Modern Data Grid: Recent Digital Twins */}
        <div className="lg:col-span-2 bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between">
          <div className="border-b border-[#F4F5F7] pb-3.5 flex justify-between items-center">
            <div>
              <h4 className="text-xs font-bold text-[#172B4D] uppercase tracking-wider">
                Digital Twin Node Directory
              </h4>
              <p className="text-[11px] text-[#5E6C84] mt-0.5">Highly detailed view of mapped industrial nodes, aquifer health, and sync logs.</p>
            </div>
            
            <button 
              onClick={() => navigate("/explorer")}
              className="text-[#0052CC] text-xs font-bold hover:underline flex items-center gap-0.5"
            >
              Open Spatial Explorer <ChevronRight size={12} />
            </button>
          </div>

          {/* Directory Table */}
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#DFE1E6] text-[#5E6C84] text-[10px] uppercase font-bold tracking-wider">
                  <th className="pb-2">Organization</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Water Stress</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {locations.slice(0, 6).map((loc) => {
                  let stressBadge = "bg-emerald-50 text-emerald-700 border-emerald-200";
                  if (loc.water.waterStressLevel === "Critical") stressBadge = "bg-amber-50 text-amber-700 border-amber-200";
                  if (loc.water.waterStressLevel === "Over-Exploited") stressBadge = "bg-red-50 text-red-700 border-red-200";

                  const rwhStatusLabel = loc.water.rainwaterHarvesting.status === "verified_has_rwh" ? "Has RWH" : loc.water.rainwaterHarvesting.status === "verified_no_rwh" ? "No RWH" : "Unknown";

                  return (
                    <tr 
                      key={loc.id} 
                      className="hover:bg-[#FAFBFC] transition-colors cursor-pointer"
                      onClick={() => {
                        setSelectedLoc(loc);
                        setIsDrawerOpen(true);
                      }}
                    >
                      <td className="py-3 font-bold text-[#172B4D]">
                        <div className="truncate max-w-[150px]" title={loc.name}>{loc.name}</div>
                        <span className="text-[9px] text-gray-500 font-normal">{loc.district}, {loc.state}</span>
                      </td>
                      <td className="py-3 text-gray-600">{loc.category}</td>
                      <td className="py-3">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${stressBadge}`}>
                          {loc.water.waterStressLevel}
                        </span>
                      </td>
                      <td className="py-3 text-gray-500 font-mono text-[10px]">{(loc.water.waterSource || "Mixed").split(" ")[0]}</td>
                      <td className="py-3">
                        <span className={`w-2 h-2 rounded-full inline-block mr-1.5 ${
                          loc.water.rainwaterHarvesting.status === "verified_has_rwh" ? "bg-emerald-500" :
                          loc.water.rainwaterHarvesting.status === "verified_no_rwh" ? "bg-red-500" : "bg-amber-500"
                        }`} />
                        <span className="text-[11px] text-gray-700">{rwhStatusLabel}</span>
                      </td>
                      <td className="py-3 text-right">
                        <button 
                          className="text-[#0052CC] hover:underline font-bold text-[11px]"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLoc(loc);
                            setIsDrawerOpen(true);
                          }}
                        >
                          Audit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Chronological Activity Timeline */}
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between">
          <div className="border-b border-[#F4F5F7] pb-3 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-[#172B4D] uppercase tracking-wider">
                System Activity Log
              </h4>
              <p className="text-[11px] text-[#5E6C84] mt-0.5">Real-time ledger of actions taken by operations team.</p>
            </div>
            
            <button 
              onClick={() => {
                alert("Triggered manual ledger refresh!");
              }}
              className="text-[#5E6C84] hover:text-[#0052CC]"
            >
              <RefreshCw size={12} className="animate-spin-slow" />
            </button>
          </div>

          {/* Timeline Nodes */}
          <div className="flex-1 mt-4 space-y-4 max-h-[300px] overflow-y-auto pr-1">
            {recentActivitiesList.map((act) => (
              <div key={act.id} className="flex gap-3 text-xs">
                <div className="flex flex-col items-center">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[9px] text-white shadow-xs ${
                    act.status === "Ingested" ? "bg-[#0052CC]" :
                    act.status === "Warning" ? "bg-amber-500" :
                    act.status === "Completed" ? "bg-emerald-600" : "bg-purple-600"
                  }`}>
                    {act.status[0]}
                  </div>
                  <div className="w-0.5 h-full bg-[#DFE1E6] mt-1" />
                </div>
                <div className="space-y-1 pb-2">
                  <div className="flex justify-between items-baseline gap-2">
                    <span className="font-extrabold text-[#172B4D]">{act.title}</span>
                    <span className="text-[9px] text-gray-400 font-mono">{act.time}</span>
                  </div>
                  <p className="text-[11px] text-[#5E6C84] leading-relaxed">{act.desc}</p>
                  <p className="text-[10px] text-gray-500">
                    By <strong className="text-[#172B4D] font-semibold">{act.author}</strong>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* SECTION: TEAM PERFORMANCE, CALENDAR & NEWS CORNER */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" id="dashboard-team-section">
        
        {/* Consulting Project Sales Board pipeline summary */}
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between">
          <div className="border-b border-[#F4F5F7] pb-3">
            <h4 className="text-xs font-bold text-[#172B4D] uppercase tracking-wider">
              CRM Pipelines Value
            </h4>
            <p className="text-[11px] text-[#5E6C84] mt-1">Sum of expected execution contract values for qualified opportunities.</p>
          </div>

          <div className="flex-1 py-4 space-y-4">
            {[
              { stage: "Proposal drafting", val: "₹18,40,000", count: 8, fill: "w-3/5 bg-sky-500" },
              { stage: "Proposal Sent", val: "₹24,00,000", count: 12, fill: "w-4/5 bg-purple-500" },
              { stage: "Negotiations Active", val: "₹14,20,000", count: 4, fill: "w-2/5 bg-amber-500" },
              { stage: "Contracts Won (July)", val: "₹28,80,000", count: 9, fill: "w-[90%] bg-emerald-500" }
            ].map((p, idx) => (
              <div key={idx} className="space-y-1 text-xs">
                <div className="flex justify-between items-baseline">
                  <span className="font-bold text-gray-700">{p.stage}</span>
                  <span className="font-mono text-gray-900 font-extrabold">{p.val} ({p.count})</span>
                </div>
                <div className="w-full bg-[#FAFBFC] border border-[#DFE1E6] h-3 rounded-sm overflow-hidden relative flex items-center">
                  <div className={`h-full ${p.fill}`} />
                </div>
              </div>
            ))}
          </div>

          <button 
            onClick={() => navigate("/assignments")}
            className="w-full py-2 bg-gray-50 border border-[#DFE1E6] text-[#0052CC] hover:bg-gray-100 font-bold rounded-[3px] text-xs transition-colors cursor-pointer text-center block"
          >
            Open Live CRM Board
          </button>
        </div>

        {/* CSR & ESG Funding Dashboard widgets */}
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between" id="dashboard-funding-section">
          <div className="border-b border-[#F4F5F7] pb-3">
            <h4 className="text-xs font-bold text-[#172B4D] uppercase tracking-wider">
              ESG & CSR Grant Calendar
            </h4>
            <p className="text-[11px] text-[#5E6C84] mt-1">Available third-party funds matched to municipal/school water installations.</p>
          </div>

          <div className="flex-1 py-3.5 space-y-3.5 max-h-[220px] overflow-y-auto">
            {[
              { fund: "Atal Bhujal Yojana Central Grant", scope: "Public Schools/Colleges", amount: "₹45,00,000 Pool", date: "Deadline: July 28, 2026", match: "High Match Rate" },
              { fund: "HDFC Environmental CSR Fund", scope: "Housing/Institutions", amount: "₹15,00,000 Grant", date: "Deadline: Aug 12, 2026", match: "Corporate Ready" },
              { fund: "NABARD Rural Groundwater Fund", scope: "Piped water networks", amount: "Co-Funded loans", date: "Applications Open", match: "Govt Direct" }
            ].map((fd, idx) => (
              <div key={idx} className="p-3 bg-gray-50 border border-gray-100 rounded-[2px] space-y-1.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-extrabold text-[#172B4D] truncate pr-2" title={fd.fund}>{fd.fund}</span>
                  <span className="bg-emerald-50 text-emerald-800 text-[8px] font-bold px-1.5 py-0.2 rounded-sm font-mono flex-shrink-0">
                    {fd.match}
                  </span>
                </div>
                <p className="text-[10px] text-[#5E6C84]">Scope: <strong className="text-gray-700">{fd.scope}</strong> • <strong className="text-gray-700">{fd.amount}</strong></p>
                <p className="text-[9px] text-[#0052CC] font-bold flex items-center gap-1">
                  <Calendar size={10} /> {fd.date}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-[#DEEBFF] p-2.5 rounded-[2px] text-[10px] text-[#0747A6] flex items-center gap-2">
            <Info size={13} className="text-[#0052CC] flex-shrink-0" />
            <span>Outreach matching score engine saves 14 hours per proposal.</span>
          </div>
        </div>

        {/* News Center / Alerts */}
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-5 shadow-xs flex flex-col justify-between">
          <div className="border-b border-[#F4F5F7] pb-3">
            <h4 className="text-xs font-bold text-[#DE350B] uppercase tracking-wider flex items-center gap-1">
              <AlertOctagon size={13} /> Statutory & News Center
            </h4>
            <p className="text-[11px] text-[#5E6C84] mt-1">Official water exploitation alerts and CGWA policy revisions.</p>
          </div>

          <div className="flex-1 py-3.5 space-y-3.5">
            {[
              { headline: "CGWA mandates digital telemetry meters on all borewells extraction in Karnataka.", source: "CGWA Gazette", time: "1d ago" },
              { headline: "BBMP raises penalties for commercial campus Rainwater harvesting non-compliance.", source: "BBMP Circular", time: "3d ago" },
              { headline: "Severe groundwater tables drawdown registered across Bengaluru East sector.", source: "Sustain Labs North", time: "1w ago" }
            ].map((ns, idx) => (
              <div key={idx} className="space-y-1 text-xs">
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span className="font-bold uppercase tracking-wider text-[#DE350B]">{ns.source}</span>
                  <span className="font-mono">{ns.time}</span>
                </div>
                <p className="font-semibold text-gray-900 hover:text-[#0052CC] transition-colors cursor-pointer leading-relaxed">
                  {ns.headline}
                </p>
              </div>
            ))}
          </div>

          <div className="p-2.5 bg-gray-50 border border-[#DFE1E6] rounded-[2px] text-[10px] text-gray-600 flex items-center gap-2">
            <Info size={13} className="text-[#0052CC] flex-shrink-0" />
            <span>Policy checks are evaluated daily against digital twins.</span>
          </div>
        </div>

      </div>

      {/* FLOATING ACTION PANEL: Integrated controls */}
      <div className="bg-[#050B14] border border-[#14263D] p-5 rounded-[3px]" id="dashboard-quick-actions">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Trello size={14} className="text-[#0052CC]" /> Live Data Sync Control
            </h4>
            <p className="text-[10px] text-[#5A6E85]">Perform batch actions to synchronize local data with external municipal logs.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button 
              onClick={() => {
                alert("Report compilation requested. PDF compiles and will download in 3s.");
                setCustomToast("Compiling Comprehensive PDF Executive Report...");
              }}
              className="bg-[#102A4A] hover:bg-[#153A66] text-white font-bold text-[11px] h-8 px-4 rounded-[2px] cursor-pointer transition-colors"
            >
              Compile PDF Report
            </button>
            <button 
              onClick={() => {
                alert("Simulated excel download completed for 80 Digital Twins.");
                setCustomToast("Exported Node Directory to Excel!");
              }}
              className="bg-[#102A4A] hover:bg-[#153A66] text-white font-bold text-[11px] h-8 px-4 rounded-[2px] cursor-pointer transition-colors"
            >
              Export Excel Directory
            </button>
            <button 
              onClick={() => {
                alert("Data extraction scraper launched for CGWA and AISHE portals.");
                setCustomToast("Ingestion Web Scrapers In Motion...");
              }}
              className="bg-[#0052CC] hover:bg-[#0065FF] text-white font-bold text-[11px] h-8 px-4 rounded-[2px] cursor-pointer transition-all shadow-md"
            >
              Batch Sync Ingestion
            </button>
          </div>
        </div>
      </div>

      {/* Embed DetailDrawer for Quick Node Edits & Spezialization Assignments */}
      <DetailDrawer
        location={selectedLoc}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onUpdateLocation={() => {}} // fallback local update handled at App.tsx shell level
        assignments={assignments}
        teamMembers={teamMembers}
        onUpdateAssignment={onUpdateAssignment}
        initialTab="assignment"
      />

    </div>
  );
}
