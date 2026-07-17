import React, { useState, useMemo } from "react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { 
  CheckCircle2, 
  Activity, 
  Sparkles, 
  Award, 
  BarChart3, 
  PieChart as PieIcon,
  BookOpen
} from "lucide-react";
import { Location, RwhStatus } from "../data/mockData.types";

interface AnalyticsProps {
  locations: Location[];
  theme?: "light" | "dark";
}

export default function Analytics({ locations }: AnalyticsProps) {
  const [selectedState, setSelectedState] = useState("All");

  // Filter locations by state if selected
  const filtered = selectedState === "All" 
    ? locations 
    : locations.filter(loc => loc.state === selectedState);

  // Group locations by category
  const categories = ["School", "College", "University", "Industry", "Manufacturing", "Hospital", "Apartment/Residential", "Hotel", "Government Building", "Data Centre", "Mining"];
  const categoryData = categories.map(cat => {
    const subset = filtered.filter(loc => loc.category === cat);
    const hasRwh = subset.filter(loc => loc.water.rainwaterHarvesting.status === "verified_has_rwh").length;
    const noRwh = subset.filter(loc => loc.water.rainwaterHarvesting.status === "verified_no_rwh").length;
    return {
      name: cat,
      "Has RWH": hasRwh,
      "No RWH": noRwh,
      Total: subset.length
    };
  }).filter(item => item.Total > 0);

  // Group locations by RWH status
  const rwhStatuses: RwhStatus[] = ["verified_has_rwh", "verified_no_rwh", "unknown"];
  const colors = ["#10B981", "#EF4444", "#F59E0B"];
  const rwhData = rwhStatuses.map((status, idx) => {
    const count = filtered.filter(loc => loc.water.rainwaterHarvesting.status === status).length;
    return {
      name: status === "verified_has_rwh" ? "Has RWH" : status === "verified_no_rwh" ? "No RWH" : "Unknown",
      value: count,
      color: colors[idx]
    };
  }).filter(item => item.value > 0);

  // State-wise breakdown table calculation
  const statesList = ["Karnataka", "Gujarat", "Tamil Nadu", "Maharashtra"];
  const stateBreakdown = statesList.map(st => {
    const subset = locations.filter(loc => loc.state === st);
    const hasRwh = subset.filter(loc => loc.water.rainwaterHarvesting.status === "verified_has_rwh").length;
    const rate = subset.length > 0 ? (hasRwh / subset.length) * 100 : 0;
    const totalAcres = subset.reduce((acc, curr) => {
      const acres = curr.water.estimatedRoofArea ? (curr.water.estimatedRoofArea * 4 / 4046.86) : 0;
      return acc + acres;
    }, 0);
    return {
      state: st,
      total: subset.length,
      hasRwh,
      rate: rate.toFixed(1),
      acres: totalAcres.toFixed(1)
    };
  });

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto font-sans text-slate-800 dark:text-zinc-200" id="analytics-screen-container">
      
      {/* Sub-header Controls */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div>
          <h3 className="text-base font-extrabold text-slate-900 dark:text-white uppercase tracking-wider">Geospatial Analytics & Compliance Charts</h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Cross-referencing aquifer risk zones with real facility RWH adoption metrics.</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Territory Filter:</span>
          <select
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            className="text-xs font-semibold bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-800 rounded px-2.5 py-1.5 outline-none cursor-pointer"
          >
            <option value="All">All Regions ({locations.length})</option>
            <option value="Karnataka">Karnataka (211)</option>
            <option value="Gujarat">Gujarat (22)</option>
            <option value="Tamil Nadu">Tamil Nadu (12)</option>
            <option value="Maharashtra">Maharashtra (11)</option>
          </select>
        </div>
      </div>

      {/* Top Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Overall Adoption</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {((filtered.filter(loc => loc.water.rainwaterHarvesting.status === "verified_has_rwh").length / (filtered.length || 1)) * 100).toFixed(1)}%
            </p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">Verified RWH coverage</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <Activity size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Active Survey Count</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">{filtered.length} Facilities</p>
            <p className="text-[9px] text-slate-550 dark:text-zinc-450 mt-1">Physical locations audited</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-400 p-3 rounded-md border border-purple-100/40 dark:border-purple-900/20">
            <Sparkles size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Opportunity Index</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">
              {filtered.filter(loc => loc.water.rainwaterHarvesting.status === "verified_no_rwh").length} Nodes
            </p>
            <p className="text-[9px] text-purple-600 font-semibold mt-1">Potential target campaigns</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <Award size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Water Saved Estimator</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">14.2 M Liters</p>
            <p className="text-[9px] text-amber-600 font-semibold mt-1">Estimated annual runoff capture</p>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Sector distribution comparison */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-8 flex flex-col justify-between">
          <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/85 flex items-center justify-between">
            <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
              <BarChart3 size={15} className="text-indigo-600 dark:text-indigo-400" />
              Harvesting Implementation by Industry Sector
            </h4>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded">Sector Comparison</span>
          </div>

          <div className="h-[280px] w-full pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="name" stroke="#94A3B8" fontSize={10} tickLine={false} />
                <YAxis stroke="#94A3B8" fontSize={10} tickLine={false} />
                <Tooltip />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Has RWH" fill="#10B981" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar dataKey="No RWH" fill="#EF4444" stackId="a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Status Breakdown Circle */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-4 flex flex-col justify-between">
          <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/85 flex items-center justify-between">
            <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
              <PieIcon size={15} className="text-indigo-600 dark:text-indigo-400" />
              RWH Status Share
            </h4>
            <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded">Volume Ratio</span>
          </div>

          <div className="h-[220px] w-full flex items-center justify-center relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={rwhData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {rwhData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute text-center">
              <span className="block text-xl font-extrabold text-slate-900 dark:text-white">{filtered.length}</span>
              <span className="text-[9px] uppercase text-slate-550 dark:text-zinc-450 font-bold tracking-wider">Total Audits</span>
            </div>
          </div>

          <div className="space-y-1.5 font-sans">
            {rwhData.map((item, idx) => (
              <div key={item.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }}></span>
                  <span className="text-slate-650 dark:text-zinc-450">{item.name}</span>
                </div>
                <span className="font-bold text-slate-900 dark:text-white">
                  {item.value} ({((item.value / filtered.length) * 100).toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* State Analytics Benchmarking Table */}
      <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
          <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
            <BookOpen size={16} className="text-indigo-650 dark:text-indigo-400" />
            Regional Water Harvesting Scorecards
          </h4>
          <span className="text-xs font-mono text-slate-500">Live Census Comparisons</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-850 text-[10px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="p-3">State Territory</th>
                <th className="p-3">Total Mapped Facilities</th>
                <th className="p-3">Verified Has RWH</th>
                <th className="p-3 font-mono">Surveyed Land Area</th>
                <th className="p-3">Compliance Rate</th>
                <th className="p-3">Territory Risk Level</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-850/80 text-slate-750 dark:text-zinc-350">
              {stateBreakdown.map((row) => (
                <tr key={row.state} className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/40">
                  <td className="p-3 font-bold text-slate-900 dark:text-zinc-100">{row.state} Region</td>
                  <td className="p-3 text-slate-550 dark:text-zinc-450 font-bold">{row.total} complexes</td>
                  <td className="p-3 text-slate-800 dark:text-zinc-200 font-semibold">{row.hasRwh} audited</td>
                  <td className="p-3 font-mono text-indigo-650 dark:text-indigo-400 font-bold">{row.acres} Acres</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <div className="w-16 bg-slate-100 dark:bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-emerald-500 h-full" style={{ width: `${row.rate}%` }}></div>
                      </div>
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{row.rate}%</span>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold border ${
                      row.state === "Karnataka" || row.state === "Gujarat"
                        ? "bg-red-50 dark:bg-red-950/25 text-red-700 dark:text-red-400 border-red-100 dark:border-red-900/20"
                        : "bg-amber-50 dark:bg-amber-950/25 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/20"
                    }`}>
                      {row.state === "Karnataka" || row.state === "Gujarat" ? "OVER-EXPLOITED" : "CRITICAL"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
