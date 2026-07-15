import React, { useState } from "react";
import {
  Database,
  RefreshCw,
  Server,
  Terminal,
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Info,
  Calendar,
  CloudLightning,
  FileSpreadsheet,
} from "lucide-react";
import { Location } from "../data/mockData.types";

interface MonitoringProps {
  locations: Location[];
  theme?: "light" | "dark";
}

interface DataLakeFile {
  name: string;
  size: string;
  source: string;
  year: string;
  status: "Pending" | "Shifted" | "Processing";
}

export default function Monitoring({ locations, theme }: MonitoringProps) {
  // Simulator state
  const [isShifting, setIsShifting] = useState(false);
  const [shiftProgress, setShiftProgress] = useState(0);
  const [terminalLogs, setTerminalLogs] = useState<string[]>([]);
  const [syncCompleted, setSyncCompleted] = useState(false);

  // Raw files currently in Data Lake S3/GCS queue
  const [lakeFiles, setLakeFiles] = useState<DataLakeFile[]>([
    { name: "cgwb_water_stress_karnataka_2025.csv", size: "12.4 MB", source: "CGWB", year: "2025", status: "Pending" },
    { name: "kspcb_industry_consent_orders_q1_2026.json", size: "8.7 MB", source: "KSPCB", year: "2026", status: "Pending" },
    { name: "national_health_profile_hospitals_bengaluru.json", size: "4.2 MB", source: "NHP India", year: "2024", status: "Pending" },
    { name: "satellite_soil_moisture_indices_weekly.nc", size: "145.8 MB", source: "Sentinel-2", year: "Real-time", status: "Pending" },
    { name: "on_site_rwh_field_surveys_batch7.csv", size: "2.1 MB", source: "CropNow Field Team", year: "2026", status: "Pending" },
  ]);

  // Comprehensive Data Provenance registry showing what data is fetched, where from, years represented, and sync info
  const ingestionRegistry = [
    {
      source: "Central Ground Water Board (CGWB)",
      category: "Groundwater Stress & Aquifer Table",
      geographicScope: "Karnataka (All Districts)",
      years: "2024 - 2025",
      type: "Official Government Survey",
      frequency: "Bi-Annually",
      lastSynced: "2026-07-01 04:30 AM",
      totalMappedRecords: "34 district records",
      status: "Active"
    },
    {
      source: "Karnataka State Pollution Control Board (KSPCB)",
      category: "Industrial Pollution Consent & Water Usage",
      geographicScope: "Industrial zones (Peenya, Bidadi, Whitefield)",
      years: "2025 - 2026",
      type: "Regulatory Compliance API",
      frequency: "Daily automated script at 02:00 AM",
      lastSynced: "2026-07-10 02:00 AM",
      totalMappedRecords: "45 industrial complexes",
      status: "Active"
    },
    {
      source: "AISHE (All India Survey on Higher Education)",
      category: "Academic Institutions & Campus Outlines",
      geographicScope: "Bengaluru Metropolitan & Mysuru",
      years: "2023 - 2024",
      type: "Public Policy Data Dump",
      frequency: "Quarterly manual import",
      lastSynced: "2026-06-15 11:20 AM",
      totalMappedRecords: "20 major campuses",
      status: "Idle"
    },
    {
      source: "National Health Profile (NHP India)",
      category: "Public & Private Hospital Bed Sizing",
      geographicScope: "Bengaluru District",
      years: "2024",
      type: "Ministry of Health CSV Extract",
      frequency: "Yearly archive sync",
      lastSynced: "2026-05-20 09:15 AM",
      totalMappedRecords: "15 hospital hubs",
      status: "Idle"
    },
    {
      source: "Copernicus Sentinel-2 Soil Moisture Indices",
      category: "Raster Infrared Crop & Soil Wetness Map",
      geographicScope: "South Karnataka Agricultural Belts",
      years: "Real-time API",
      type: "Satellite Remote Sensing Data",
      frequency: "Weekly satellite pass integration",
      lastSynced: "2026-07-08 06:10 PM",
      totalMappedRecords: "Raster imagery overlay",
      status: "Active"
    },
    {
      source: "CropNow Field Survey & Verified Audits",
      category: "On-site verified RWH measurements & photos",
      geographicScope: "On-site verifications",
      years: "2026",
      type: "CropNow Mobile Field Auditor App",
      frequency: "Continuous live uploads",
      lastSynced: "2026-07-10 11:45 AM",
      totalMappedRecords: "80 fully audited facilities",
      status: "Active"
    }
  ];

  // Run the "Data Lake to Active Database" shifting simulation
  const handleStartShift = () => {
    if (isShifting) return;
    setIsShifting(true);
    setSyncCompleted(false);
    setShiftProgress(0);
    setTerminalLogs([]);

    const logs = [
      "Connecting to Google Cloud Storage Data Lake bucket 'croponow-raw-lake-01'...",
      "Authentication successful. Found 5 pending files representing historical datasets.",
      "Initiating Extract-Transform-Load (ETL) pipeline...",
      "STEP 1: Extracting aquifer records from 'cgwb_water_stress_karnataka_2025.csv'...",
      "Mapping regional water scarcity indices to active CRM coordinates...",
      "STEP 2: Processing industrial pollution compliance logs from 'kspcb_industry_consent_orders_q1_2026.json'...",
      "Deduplicating existing Peenya and Bidadi plant listings against production DB...",
      "STEP 3: Parsing 'national_health_profile_hospitals_bengaluru.json' hospital capacities...",
      "Injecting hospital water consumption estimators based on beds size...",
      "STEP 4: Rendering satellite soil raster indexes from 'satellite_soil_moisture_indices_weekly.nc'...",
      "STEP 5: Importing on-site surveys from 'on_site_rwh_field_surveys_batch7.csv'...",
      "Validating roof coordinates and on-site representative contact cards...",
      "Performing integrity checks. Row checks: 3410 rows read, 3410 rows matched.",
      "Writing shifted relational schemas into CRM PostgreSQL tables...",
      "Rebuilding relational indexes on 'locations' and 'assignments' collections...",
      "DATABASE SYNC COMPLETE: Shifted 5 files. Production CRM database is fully optimized."
    ];

    let currentLogIndex = 0;
    
    // Simulate files changing status as progress completes
    const interval = setInterval(() => {
      setShiftProgress((prev) => {
        const next = prev + 5;
        
        // Add log lines matching progress percentage
        const logsCountToDisplay = Math.floor((next / 100) * logs.length);
        if (currentLogIndex < logsCountToDisplay) {
          setTerminalLogs(logs.slice(0, logsCountToDisplay));
          currentLogIndex = logsCountToDisplay;
        }

        // Update file status list visually based on percentage
        if (next === 20) {
          setLakeFiles(prevFiles => prevFiles.map((f, i) => i === 0 ? { ...f, status: "Shifted" as const } : f));
        } else if (next === 40) {
          setLakeFiles(prevFiles => prevFiles.map((f, i) => i === 1 ? { ...f, status: "Shifted" as const } : f));
        } else if (next === 60) {
          setLakeFiles(prevFiles => prevFiles.map((f, i) => i === 2 ? { ...f, status: "Shifted" as const } : f));
        } else if (next === 85) {
          setLakeFiles(prevFiles => prevFiles.map((f, i) => i === 3 ? { ...f, status: "Shifted" as const } : f));
        } else if (next >= 100) {
          setLakeFiles(prevFiles => prevFiles.map(f => ({ ...f, status: "Shifted" as const })));
          setSyncCompleted(true);
          setIsShifting(false);
          clearInterval(interval);
          return 100;
        }
        return next;
      });
    }, 150);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="monitoring-page-container">
      {/* Top Cards: Pipeline Summary Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <Server size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Raw Data Lake size</p>
            <p className="text-xl font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">173.2 MB</p>
            <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-1">GCS buckets storing raw datasets</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <Database size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Active CRM Database</p>
            <p className="text-xl font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">80 Primary Nodes</p>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1 flex items-center gap-0.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span> Index Healthy
            </p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Scheduled Sync Rules</p>
            <p className="text-xl font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">6 Active Cronjobs</p>
            <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-1">Automating external updates</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-400 p-3 rounded-md border border-sky-100/40 dark:border-sky-900/20">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">ETL Pipeline Status</p>
            <p className="text-xl font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">100% Operational</p>
            <p className="text-[10px] text-emerald-650 dark:text-emerald-400 font-semibold mt-1">Zero failed ingest jobs</p>
          </div>
        </div>
      </div>

      {/* Grid: 1. Pipeline Flowchart (Left) and Ingest Shifter Console (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Architecture Flowchart Card */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-7 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-850/80">
            <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
              <Activity size={16} className="text-indigo-600 dark:text-indigo-400" />
              CropNow CWIP Data Ingestion Architecture
            </h4>
            <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded border border-slate-100 dark:border-zinc-800">Airflow Managed</span>
          </div>

          <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed">
            Raw geospatial datasets are compiled from various external registries (Satellite imagery, environmental board registers, government water surveys) and stored in the **Raw Data Lake**. Our scheduler validates, normalizes, and shifts them into the **Active CRM Database** where they fuel real-time insights on water consumption, legal mandates, and sales pipeline opportunities.
          </p>

          {/* Architecture Visual Boxes */}
          <div className="space-y-4 py-2" id="pipeline-flowchart-visual">
            
            {/* Box 1: Sources */}
            <div className="bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-850/80 p-3 rounded-md flex items-center justify-between relative">
              <div className="flex items-center gap-2.5">
                <div className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 p-1.5 rounded text-xs font-bold font-mono">STEP 1</div>
                <div>
                  <h5 className="text-[12px] font-bold text-slate-900 dark:text-zinc-50">External Registers & Satellites</h5>
                  <p className="text-[10px] text-slate-500 dark:text-zinc-400">CGWB aquifers, KSPCB industry water mandates, Sentinel-2 spectral raster</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded">API / Crawlers</span>
            </div>

            <div className="flex justify-center -my-2.5">
              <div className="w-[2px] h-5 bg-slate-200 dark:bg-zinc-800"></div>
            </div>

            {/* Box 2: Data Lake */}
            <div className="bg-sky-50/10 dark:bg-sky-950/20 border border-sky-200/60 dark:border-sky-900/40 p-3 rounded-md flex items-center justify-between relative">
              <div className="flex items-center gap-2.5">
                <div className="bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-400 p-1.5 rounded text-xs font-bold font-mono">STEP 2</div>
                <div>
                  <h5 className="text-[12px] font-bold text-sky-700 dark:text-sky-450">Raw Data Lake Storage (Unstructured)</h5>
                  <p className="text-[10px] text-sky-600 dark:text-sky-400">Storage for multi-megabyte CSV records, JSON arrays, and GeoTIFFs</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-sky-700 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 rounded border border-sky-100/40 dark:border-sky-900/20">GCS Buckets</span>
            </div>

            <div className="flex justify-center -my-2.5">
              <div className="w-[2px] h-5 bg-sky-300 dark:bg-sky-850"></div>
            </div>

            {/* Box 3: Transformation Engine */}
            <div className="bg-purple-50/10 dark:bg-purple-950/20 border border-purple-200/60 dark:border-purple-900/40 p-3 rounded-md flex items-center justify-between relative">
              <div className="flex items-center gap-2.5">
                <div className="bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400 p-1.5 rounded text-xs font-bold font-mono">STEP 3</div>
                <div>
                  <h5 className="text-[12px] font-bold text-purple-700 dark:text-purple-400">Validation, Cleanse & Transformation</h5>
                  <p className="text-[10px] text-purple-650 dark:text-purple-350">Coordinate mapping, RWH size validation, representative deduplication</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-purple-700 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-100/40 dark:border-purple-900/20">ETL Shifter</span>
            </div>

            <div className="flex justify-center -my-2.5">
              <div className="w-[2px] h-5 bg-purple-300 dark:bg-purple-850"></div>
            </div>

            {/* Box 4: Target Production DB */}
            <div className="bg-emerald-50/10 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40 p-3 rounded-md flex items-center justify-between relative">
              <div className="flex items-center gap-2.5">
                <div className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 p-1.5 rounded text-xs font-bold font-mono">STEP 4</div>
                <div>
                  <h5 className="text-[12px] font-bold text-emerald-700 dark:text-emerald-400">Production Relational Database (Shifted)</h5>
                  <p className="text-[10px] text-emerald-650 dark:text-emerald-350">Populates 80 fully structured facility profiles with live CRM links</p>
                </div>
              </div>
              <span className="text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-100/40 dark:border-emerald-900/20">PostgreSQL Active</span>
            </div>

          </div>
        </div>

        {/* Shifter Simulation Console Card */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-850/80">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Terminal size={16} className="text-indigo-600 dark:text-indigo-400" />
                Interactive Data Shifter Console
              </h4>
              <button
                disabled={isShifting}
                onClick={handleStartShift}
                className="bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-slate-100 dark:disabled:bg-zinc-900 disabled:text-slate-400 dark:disabled:text-zinc-600 text-xs font-bold px-3 py-1.5 rounded-md flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              >
                <RefreshCw size={12} className={isShifting ? "animate-spin" : ""} />
                Shift Data Lake to DB
              </button>
            </div>

            {/* List of files in Data Lake waiting to be shifted */}
            <div className="space-y-2">
              <h5 className="text-[11px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Pending raw files in Data Lake</h5>
              <div className="space-y-1.5">
                {lakeFiles.map((file) => (
                  <div key={file.name} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-zinc-900/40 border border-slate-200 dark:border-zinc-850/80 rounded-md text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileSpreadsheet size={14} className="text-slate-400 dark:text-zinc-500 flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-zinc-50 truncate text-[11px]">{file.name}</p>
                        <p className="text-[10px] text-slate-500 dark:text-zinc-400">Coverage: {file.year} Dataset ({file.size})</p>
                      </div>
                    </div>
                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase border ${
                      file.status === "Shifted"
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/20"
                        : "bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/20 animate-pulse"
                    }`}>
                      {file.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Progress Bar */}
            {isShifting && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-semibold text-slate-900 dark:text-zinc-100">
                  <span>Extracting & transforming databases...</span>
                  <span>{shiftProgress}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-zinc-900 h-2 rounded-full overflow-hidden border border-slate-200/50 dark:border-zinc-800">
                  <div className="bg-indigo-600 dark:bg-indigo-500 h-full transition-all duration-150" style={{ width: `${shiftProgress}%` }}></div>
                </div>
              </div>
            )}

            {syncCompleted && (
              <div className="bg-emerald-50/10 dark:bg-emerald-950/15 border border-emerald-200/60 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-400 p-3 rounded-md text-xs flex items-center gap-2.5">
                <CheckCircle2 size={18} className="text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                <div>
                  <p className="font-bold">ETL Relational Sync Completed!</p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-500">All data shifted, normalized, and indices rebuilt in active PostgreSQL.</p>
                </div>
              </div>
            )}
          </div>

          {/* Terminal Console log stream */}
          <div className="mt-4 bg-[#0b0c10] dark:bg-black border border-slate-200 dark:border-zinc-850 text-[#a8ffdb] font-mono text-[10px] p-3 rounded-md h-[180px] overflow-y-auto space-y-1 shadow-inner">
            <p className="text-slate-500 dark:text-zinc-500"># CropNow Data Shifting CLI v1.0</p>
            <p className="text-slate-500 dark:text-zinc-500"># Waiting for data lake trigger...</p>
            {terminalLogs.map((log, index) => (
              <p key={index} className={log.startsWith("SUCCESS") || log.startsWith("DATABASE SYNC") ? "text-emerald-400 font-semibold" : ""}>
                {log.startsWith("STEP") ? `\n> ${log}` : `  ${log}`}
              </p>
            ))}
          </div>
        </div>
      </div>

      {/* Comprehensive Data Lineage Registry (Bottom Table) */}
      <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 space-y-4">
        <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
          <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
            <Database size={16} className="text-indigo-600 dark:text-indigo-400" />
            National Water Data Lineage & Provenance Register
          </h4>
          <span className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono">Current Audit Sync</span>
        </div>

        <p className="text-xs text-slate-500 dark:text-zinc-450 leading-relaxed">
          The table below acts as the **Data Provenance Master List**. It logs every major dataset integrated into this platform, documenting its regulatory source, historical year spans, automatic fetch frequencies, and when the data was last moved from our unstructured data lake into our active CRM transactional schema.
        </p>

        <div className="overflow-x-auto border border-slate-150 dark:border-zinc-850 rounded-md">
          <table className="w-full text-left border-collapse text-xs" id="provenance-registry-table">
            <thead>
              <tr className="bg-slate-50 dark:bg-zinc-950 border-b border-slate-200 dark:border-zinc-850 text-[11px] font-bold text-slate-500 dark:text-zinc-400 uppercase tracking-wider">
                <th className="p-3">Data Registry & Owner</th>
                <th className="p-3">Information Category</th>
                <th className="p-3">Geographic Boundary</th>
                <th className="p-3">Years Represented</th>
                <th className="p-3">Ingest Frequency</th>
                <th className="p-3">Last ETL Shift to DB</th>
                <th className="p-3">Production Record Count</th>
                <th className="p-3 text-center">Pipeline Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-850/80 text-slate-700 dark:text-zinc-300">
              {ingestionRegistry.map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-zinc-900/40">
                  <td className="p-3">
                    <p className="font-bold text-slate-900 dark:text-zinc-50">{item.source}</p>
                    <p className="text-[10px] text-slate-400 dark:text-zinc-550 font-mono">{item.type}</p>
                  </td>
                  <td className="p-3 text-slate-800 dark:text-zinc-200">{item.category}</td>
                  <td className="p-3 text-slate-500 dark:text-zinc-400">{item.geographicScope}</td>
                  <td className="p-3">
                    <span className="text-indigo-700 dark:text-indigo-400 font-bold font-mono bg-indigo-50 dark:bg-indigo-950/40 px-2 py-0.5 rounded border border-indigo-100/45 dark:border-indigo-900/25 inline-block">
                      {item.years}
                    </span>
                  </td>
                  <td className="p-3 text-slate-500 dark:text-zinc-400">{item.frequency}</td>
                  <td className="p-3 text-slate-800 dark:text-zinc-200 font-mono text-[11px]">{item.lastSynced}</td>
                  <td className="p-3 text-slate-800 dark:text-zinc-200 font-semibold">{item.totalMappedRecords}</td>
                  <td className="p-3 text-center">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      item.status === "Active"
                        ? "bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/20"
                        : "bg-slate-50 dark:bg-zinc-900 text-slate-500 dark:text-zinc-450 border-slate-200 dark:border-zinc-800"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        item.status === "Active" ? "bg-emerald-500 animate-pulse" : "bg-slate-400 dark:bg-zinc-500"
                      }`}></span>
                      {item.status}
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
