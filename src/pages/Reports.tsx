import React, { useState } from "react";
import { 
  FileText, 
  Download, 
  RefreshCw, 
  Calendar, 
  Clock, 
  FileSpreadsheet, 
  CheckCircle2, 
  Info, 
  ChevronRight,
  Sliders,
  Sparkles,
  Printer
} from "lucide-react";
import { Location } from "../data/mockData.types";

interface ReportsProps {
  locations: Location[];
  theme?: "light" | "dark";
}

interface ExportLog {
  id: string;
  name: string;
  format: "PDF" | "XLSX" | "CSV";
  generatedBy: string;
  date: string;
  size: string;
}

export default function Reports({ locations, theme }: ReportsProps) {
  const [reportFormat, setReportFormat] = useState<"PDF" | "XLSX" | "CSV">("PDF");
  const [selectedState, setSelectedState] = useState("Karnataka");
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileProgress, setCompileProgress] = useState(0);
  const [generatedLogs, setGeneratedLogs] = useState<ExportLog[]>([
    { id: "REP-9102", name: "National Water Scarcity Assessment Report", format: "PDF", generatedBy: "System Cron", date: "2026-07-01 02:00 AM", size: "14.2 MB" },
    { id: "REP-8451", name: "Karnataka Industrial RWH Compliance Audit", format: "XLSX", generatedBy: "D. Madhan", date: "2026-07-10 11:15 AM", size: "4.8 MB" },
    { id: "REP-7319", name: "Gujarat High-Stress Coordinate Census", format: "CSV", generatedBy: "R. Mehta", date: "2026-07-12 04:30 PM", size: "1.2 MB" },
    { id: "REP-6204", name: "Apollo Jayanagar Site Survey Dossier", format: "PDF", generatedBy: "S. Raghavan", date: "2026-07-13 09:20 AM", size: "2.1 MB" },
  ]);

  const handleGenerateReport = () => {
    if (isCompiling) return;
    setIsCompiling(true);
    setCompileProgress(0);

    const interval = setInterval(() => {
      setCompileProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          setIsCompiling(false);
          
          // Add newly compiled report to list
          const newReport: ExportLog = {
            id: `REP-${Math.floor(1000 + Math.random() * 9000)}`,
            name: `${selectedState} Environmental Compliance Dossier`,
            format: reportFormat,
            generatedBy: "Authorized Admin",
            date: new Date().toISOString().replace("T", " ").substring(0, 16),
            size: reportFormat === "PDF" ? "3.2 MB" : reportFormat === "XLSX" ? "1.8 MB" : "450 KB"
          };
          setGeneratedLogs(prevLogs => [newReport, ...prevLogs]);
          return 100;
        }
        return prev + 10;
      });
    }, 150);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="reports-page-container">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-700 dark:text-indigo-400">
              <FileText size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">Reports & Exports Engine</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Compile regional water stress matrices, export compliance sheets, and generate printable PDF dossiers.
          </p>
        </div>
      </div>

      {/* Top statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <Printer size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Reports Compiled</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">142 Documents</p>
            <p className="text-[9px] text-indigo-650 font-semibold mt-1">Ready for ESG presentations</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <Download size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Total Exports Drawn</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">2.4k CSV Rows</p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">Filtered database extractions</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 p-3 rounded-md border border-purple-100/40 dark:border-purple-900/20">
            <Sparkles size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Auto Schedules Active</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">4 Daily Cronjobs</p>
            <p className="text-[9px] text-purple-600 font-semibold mt-1">Automated emails to stakeholders</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Average Render Speed</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">1.8 Seconds</p>
            <p className="text-[9px] text-slate-500 mt-1">Fast cloud-run microservice</p>
          </div>
        </div>
      </div>

      {/* Compiler Splits: Configurator (Left) and Historical Log Table (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Reports Configuration Form */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-5 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Sliders size={16} className="text-indigo-600" />
                Dossier Configuration
              </h4>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded">Engine Settings</span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-zinc-455 leading-relaxed">
              Tailor water assessment dossiers dynamically. Choose geographical filters and export formats.
            </p>

            <div className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase text-slate-500">Target Region</label>
                <select 
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value)}
                  className="w-full text-xs bg-slate-50 dark:bg-zinc-900 border border-slate-200 dark:border-zinc-850 rounded px-2.5 py-2 font-medium cursor-pointer"
                >
                  <option value="Karnataka">Karnataka Territory (35 nodes)</option>
                  <option value="Gujarat">Gujarat Territory (22 nodes)</option>
                  <option value="Tamil Nadu">Tamil Nadu Territory (12 nodes)</option>
                  <option value="Maharashtra">Maharashtra Territory (11 nodes)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-bold uppercase text-slate-500">Document Format</label>
                <div className="grid grid-cols-3 gap-2">
                  {(["PDF", "XLSX", "CSV"] as const).map(fmt => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setReportFormat(fmt)}
                      className={`text-xs font-bold py-2 px-3 rounded border text-center transition-all cursor-pointer ${
                        reportFormat === fmt
                          ? "bg-indigo-650 text-white border-indigo-650 shadow-xs"
                          : "bg-transparent border-slate-200 text-slate-650 hover:bg-slate-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center gap-1.5 text-[10px] text-slate-500 bg-slate-50 dark:bg-zinc-900 p-2.5 rounded border">
                  <Info size={12} className="text-indigo-600 flex-shrink-0" />
                  <span>PDF contains full site drawings, compliance checklists, and corporate CSR signoffs. Excel/CSV contains coordinates only.</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-3.5 border-t border-slate-100 dark:border-zinc-850/80 space-y-3">
            {isCompiling && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span>Assembling environmental data streams...</span>
                  <span>{compileProgress}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-zinc-900 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-indigo-650 h-full transition-all duration-150" style={{ width: `${compileProgress}%` }}></div>
                </div>
              </div>
            )}

            <button 
              disabled={isCompiling}
              onClick={handleGenerateReport}
              className="w-full text-center bg-indigo-650 hover:bg-indigo-600 disabled:bg-slate-100 text-white disabled:text-slate-400 font-bold py-2.5 rounded-md text-xs transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-sm border-0"
            >
              <RefreshCw size={13} className={isCompiling ? "animate-spin" : ""} />
              Generate Compliance Report
            </button>
          </div>
        </div>

        {/* Generated Documents History List */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-7 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <FileText size={16} className="text-indigo-600 dark:text-indigo-400" />
                Historical Compilation Vault
              </h4>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded">Security Mapped</span>
            </div>

            <div className="space-y-3">
              {generatedLogs.map((log) => (
                <div 
                  key={log.id} 
                  className="flex items-center justify-between p-3 bg-slate-50 dark:bg-zinc-900/40 border border-slate-250 dark:border-zinc-850 rounded-md text-xs"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2.5 rounded flex-shrink-0 border ${
                      log.format === "PDF"
                        ? "bg-red-50 text-red-650 border-red-100 dark:bg-red-950/25 dark:text-red-400"
                        : "bg-emerald-50 text-emerald-650 border-emerald-100 dark:bg-emerald-950/25 dark:text-emerald-400"
                    }`}>
                      {log.format === "PDF" ? <FileText size={16} /> : <FileSpreadsheet size={16} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 dark:text-zinc-100 truncate text-[11.5px]">{log.name}</p>
                      <p className="text-[10px] text-slate-500 flex items-center gap-2 mt-0.5">
                        <span>Ref: <strong className="font-mono">{log.id}</strong></span>
                        <span>|</span>
                        <span>Generated by: <strong>{log.generatedBy}</strong></span>
                        <span>|</span>
                        <span>Size: <strong>{log.size}</strong></span>
                      </p>
                    </div>
                  </div>

                  <button 
                    onClick={() => {
                      alert(`Successfully downloaded compliance dossier ${log.id} in ${log.format} format.`);
                    }}
                    className="p-2 border border-slate-200 hover:bg-slate-100 text-slate-650 dark:border-zinc-850 dark:hover:bg-zinc-900 dark:text-zinc-400 rounded-md cursor-pointer transition-colors"
                    title="Download document"
                  >
                    <Download size={12} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
