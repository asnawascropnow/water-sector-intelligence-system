import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import { Location } from "../../data/mockData.types";

interface LeadFunnelChartProps {
  locations: Location[];
}

export default function LeadFunnelChart({ locations }: LeadFunnelChartProps) {
  // Define pipeline order
  const PIPELINE_STAGES = ["Identified", "Contacted", "Proposal Sent", "Won", "Lost"];

  // Colors corresponding to stages
  const STAGE_COLORS: Record<string, string> = {
    Identified: "#42526E",   // Neutral slate
    Contacted: "#00B8D9",    // Informational light teal
    "Proposal Sent": "#6554C0", // Purple
    Won: "#00875A",          // Green (compliant/successful)
    Lost: "#DE350B",         // Red (lost opportunity)
  };

  // Aggregate counts
  const stageCounts = locations.reduce((acc, loc) => {
    acc[loc.crm.status] = (acc[loc.crm.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Format data in pipeline order
  const data = PIPELINE_STAGES.map((stage) => ({
    stage,
    count: stageCounts[stage] || 0,
  }));

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const { stage, count } = payload[0].payload;
      return (
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-3 shadow-md text-xs text-[#172B4D]">
          <p className="font-semibold">{stage} Stage</p>
          <p className="mt-1" style={{ color: STAGE_COLORS[stage] }}>
            Total Leads: <span className="font-bold">{count}</span>
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div id="lead-funnel-chart-container" className="h-full min-h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 10, right: 30, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#F4F5F7" horizontal={false} />
          <XAxis
            type="number"
            stroke="#5E6C84"
            fontSize={11}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            dataKey="stage"
            type="category"
            stroke="#172B4D"
            fontSize={11}
            width={100}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F4F5F7" }} />
          <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={18}>
            {data.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={STAGE_COLORS[entry.stage] || "#0052CC"}
              />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              style={{ fill: "#172B4D", fontSize: "11px", fontWeight: "600" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
