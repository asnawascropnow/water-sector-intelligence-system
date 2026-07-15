import React, { useState } from "react";
import { 
  Sparkles, 
  Send, 
  Bot, 
  User, 
  Activity, 
  Lightbulb, 
  ArrowRight, 
  LineChart as ChartIcon, 
  ShieldAlert,
  Zap,
  RefreshCw,
  Search
} from "lucide-react";
import { Location } from "../data/mockData.types";

interface AIProps {
  locations: Location[];
  theme?: "light" | "dark";
}

interface ChatMessage {
  id: string;
  sender: "bot" | "user";
  text: string;
  timestamp: string;
}

export default function AI({ locations, theme }: AIProps) {
  // Chat Simulator State
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: "1", sender: "bot", text: "Welcome to WIOS AI Copilot! I am trained on your regional hydrology registers and 80 audited complex nodes. Ask me to find high-yield opportunities, calculate potential runoff volumes, or analyze over-exploited districts.", timestamp: "Just now" }
  ]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // High opportunity recommendations from mock data
  const highYieldOpportunities = locations
    .filter(loc => loc.rwhStatus === "Verified - No RWH" && (loc.waterStressLevel === "Semi-Critical" || loc.waterStressLevel === "Over-Exploited"))
    .slice(0, 3)
    .map(loc => {
      // rough potential calculation
      const area = loc.landAreaAcres || 3.5;
      const potentialLiters = (area * 4046.86 * 0.8 * 850).toFixed(0); // Area (m2) * runoff coeff * rainfall (mm)
      return {
        ...loc,
        potentialLiters: (Number(potentialLiters) / 1000000).toFixed(1) + "M Liters"
      };
    });

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const userMsg: ChatMessage = {
      id: String(messages.length + 1),
      sender: "user",
      text: inputText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText("");
    setIsTyping(true);

    // Simulate AI thinking and replying
    setTimeout(() => {
      let botResponse = "I have analyzed your query against the 80 core nodes. No direct matches found, but general models indicate high groundwater table stress in southern regions. Consider corporate rooftop harvesting campaigns.";
      const lowerQuery = inputText.toLowerCase();

      if (lowerQuery.includes("karnataka") || lowerQuery.includes("bangalore") || lowerQuery.includes("bengaluru")) {
        const noRwhCount = locations.filter(loc => loc.state === "Karnataka" && loc.rwhStatus === "Verified - No RWH").length;
        botResponse = `Karnataka currently has ${noRwhCount} verified facilities without active rainwater harvesting (No RWH). The high-yield hotspots include Reva University and Baldwin High School campuses which have substantial catchment roof areas.`;
      } else if (lowerQuery.includes("gujarat") || lowerQuery.includes("ahmedabad")) {
        botResponse = `Gujarat has 22 mapped complexes. 14 are categorized as 'Over-exploited' due to intense salinity in deep aquifers. Setting up on-site sedimentation filters and rooftop redirectors would save roughly 4.2 million liters annually across Peenya textile zones.`;
      } else if (lowerQuery.includes("savings") || lowerQuery.includes("calculate") || lowerQuery.includes("yield")) {
        botResponse = `Based on current land areas, adopting RWH across all 24 'No RWH' facilities would harvest an estimated 14.2 Million Liters of pristine stormwater annually, relieving local storm drains and decreasing tap water dependency by 42%.`;
      } else if (lowerQuery.includes("opportunity") || lowerQuery.includes("suggest")) {
        botResponse = `I suggest prioritizing the following facilities due to combined critical water stress and large land area:
1. Reva University Campus (Bengaluru, Karnataka) - Est Saving: 3.5M Liters
2. Gujarat Manufacturing Block (Peenya/Ahmedabad) - Est Saving: 2.1M Liters
3. Apollo Hospital Complex (Jayanagar, Karnataka) - Est Saving: 1.8M Liters`;
      }

      const botMsg: ChatMessage = {
        id: String(messages.length + 2),
        sender: "bot",
        text: botResponse,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      };

      setMessages(prev => [...prev, botMsg]);
      setIsTyping(false);
    }, 1200);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-900 dark:text-zinc-50" id="ai-intelligence-page-container">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-50 dark:bg-indigo-950/40 p-1.5 rounded text-indigo-700 dark:text-indigo-400">
              <Sparkles size={18} />
            </div>
            <h2 className="text-lg font-extrabold tracking-wider uppercase">AI Intelligence Node</h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            Harness ML models to predict aquifer stress levels and identify optimal water conservation campaigns.
          </p>
        </div>
      </div>

      {/* Top AI Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 p-3 rounded-md border border-indigo-100/40 dark:border-indigo-900/20">
            <Bot size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">AI Copilot Engine</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">Online v1.8</p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">GCP Vertex AI synchronized</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 p-3 rounded-md border border-amber-100/40 dark:border-amber-900/20">
            <Lightbulb size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Flagged Opportunities</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">{highYieldOpportunities.length} Critical</p>
            <p className="text-[9px] text-amber-600 font-semibold mt-1">Large area, high stress, no RWH</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 p-3 rounded-md border border-emerald-100/40 dark:border-emerald-900/20">
            <Zap size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Prediction Accuracy</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">94.8% Confidence</p>
            <p className="text-[9px] text-emerald-600 font-semibold mt-1">Cross-validated CGWB models</p>
          </div>
        </div>

        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 p-4 rounded-md shadow-sm flex items-center gap-3">
          <div className="bg-purple-50 dark:bg-purple-950/30 text-purple-600 dark:text-purple-400 p-3 rounded-md border border-purple-100/40 dark:border-purple-900/20">
            <Activity size={20} />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-500 dark:text-zinc-455 uppercase tracking-wider">Inference Response</p>
            <p className="text-lg font-extrabold text-slate-900 dark:text-zinc-50 mt-0.5">142ms average</p>
            <p className="text-[9px] text-slate-500 mt-1">Microservices warm</p>
          </div>
        </div>
      </div>

      {/* Split Panels: AI Copilot Chat (Left) and Recommendation Engine (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Interactive AI Chat Copilot */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-7 flex flex-col justify-between h-[450px]">
          <div className="space-y-4 flex flex-col h-full overflow-hidden">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Bot size={16} className="text-indigo-600 dark:text-indigo-400" />
                WIOS AI Copilot Terminal
              </h4>
              <span className="text-[10px] font-mono text-emerald-600 font-semibold bg-emerald-50 dark:bg-emerald-950/25 px-2 py-0.5 rounded border border-emerald-100/40">Active Nodes DB Connected</span>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto space-y-3.5 pr-2 custom-scrollbar text-xs">
              {messages.map((msg) => (
                <div 
                  key={msg.id}
                  className={`flex gap-2.5 max-w-[85%] ${
                    msg.sender === "user" ? "ml-auto flex-row-reverse" : ""
                  }`}
                >
                  <div className={`p-2 rounded-md flex-shrink-0 flex items-center justify-center h-7 w-7 border ${
                    msg.sender === "user"
                      ? "bg-indigo-50/50 border-indigo-150 text-indigo-600 dark:bg-indigo-950/30"
                      : "bg-slate-50 border-slate-150 text-slate-600 dark:bg-zinc-900 dark:border-zinc-800"
                  }`}>
                    {msg.sender === "user" ? <User size={14} /> : <Bot size={14} />}
                  </div>
                  <div className={`p-3 rounded-md leading-relaxed whitespace-pre-wrap ${
                    msg.sender === "user"
                      ? "bg-indigo-600 text-white font-medium"
                      : "bg-slate-50 border border-slate-150 text-slate-800 dark:bg-zinc-900/40 dark:border-zinc-850 dark:text-zinc-200"
                  }`}>
                    <p className="m-0 text-[11.5px]">{msg.text}</p>
                    <span className={`block text-[8px] mt-1.5 text-right font-mono ${
                      msg.sender === "user" ? "text-indigo-200" : "text-slate-400 dark:text-zinc-500"
                    }`}>
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="flex gap-2.5 max-w-[80%] items-center">
                  <div className="bg-slate-50 border border-slate-150 text-slate-600 p-2 rounded-md flex items-center justify-center h-7 w-7 dark:bg-zinc-900">
                    <Bot size={14} className="animate-spin" />
                  </div>
                  <span className="text-[10px] text-slate-400 animate-pulse font-mono">Copilot is running inference models...</span>
                </div>
              )}
            </div>
          </div>

          {/* Chat Input form */}
          <form onSubmit={handleSendMessage} className="flex gap-2 border-t border-slate-100 dark:border-zinc-850/80 pt-3.5 mt-3.5">
            <input 
              type="text" 
              placeholder="Ask copilot: 'Opportunities in Karnataka' or 'suggest coordinates'..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              className="flex-1 text-xs bg-slate-50 dark:bg-zinc-950 border border-slate-200 dark:border-zinc-850 rounded px-3 py-2.5"
            />
            <button 
              type="submit"
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold px-4 rounded-md transition-colors flex items-center justify-center cursor-pointer border-0"
            >
              <Send size={14} />
            </button>
          </form>
        </div>

        {/* AI-Flagged Smart Opportunities */}
        <div className="bg-white dark:bg-[#09090b] border border-slate-200 dark:border-zinc-850 rounded-md shadow-sm p-5 lg:col-span-5 flex flex-col justify-between h-[450px]">
          <div className="space-y-4">
            <div className="pb-3 border-b border-slate-100 dark:border-zinc-850/80 flex items-center justify-between">
              <h4 className="text-sm font-extrabold text-slate-900 dark:text-zinc-50 uppercase tracking-wider flex items-center gap-2">
                <Lightbulb size={16} className="text-indigo-600 dark:text-indigo-400" />
                AI Recommendation Matrix
              </h4>
              <span className="text-[10px] font-mono text-slate-500 bg-slate-50 dark:bg-zinc-900 px-2 py-0.5 rounded border">High-Yield</span>
            </div>

            <p className="text-[11px] text-slate-500 dark:text-zinc-455 leading-relaxed">
              ML algorithms have crossed-referenced surveyed roof dimensions, local rainfall records, and CGWB aquifer stress, generating 3 priority harvesting prospects.
            </p>

            <div className="space-y-3 pt-1">
              {highYieldOpportunities.map((opp) => (
                <div 
                  key={opp.id} 
                  className="p-3 bg-slate-50 dark:bg-zinc-900/40 border border-slate-150 dark:border-zinc-850 rounded-md text-xs flex items-start gap-2.5 hover:border-slate-300 dark:hover:border-zinc-800 transition-colors"
                >
                  <div className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 p-2 rounded-md font-bold text-center flex-shrink-0">
                    <ShieldAlert size={15} />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex justify-between items-start">
                      <h5 className="font-bold text-slate-900 dark:text-zinc-100 truncate text-[11.5px] leading-tight pr-1">{opp.name}</h5>
                      <span className="font-mono text-[9px] text-[#10b981] font-extrabold bg-emerald-50 dark:bg-emerald-950/25 px-1 rounded flex-shrink-0">{opp.potentialLiters}</span>
                    </div>
                    <p className="text-[10px] text-slate-450 leading-none">{opp.district}, {opp.state}</p>
                    <div className="flex items-center justify-between text-[9px] pt-1 border-t border-slate-100/60 dark:border-zinc-850/30">
                      <span className="text-slate-400">Stress class: <strong className="text-red-650 dark:text-red-400">{opp.waterStressLevel}</strong></span>
                      <span className="text-slate-400">Rooftop Area: <strong className="text-indigo-650 dark:text-indigo-400">{opp.landAreaAcres || 3.5} ac</strong></span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100 dark:border-zinc-850/80">
            <button 
              onClick={() => {
                alert("Triggered automation. Site surveyors dispatched to target campaigns.");
              }}
              className="w-full text-center bg-indigo-650 hover:bg-indigo-600 text-white font-bold py-2.5 rounded-md text-xs transition-colors cursor-pointer"
            >
              Dispatch Surveyors to Targets
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
