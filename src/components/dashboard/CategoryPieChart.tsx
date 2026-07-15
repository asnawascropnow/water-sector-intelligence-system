import React from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Location } from "../../data/mockData.types";

interface CategoryPieChartProps {
  locations: Location[];
}

// Atlassian Design Palette for charts
const COLORS = [
  "#0052CC", // primary blue
  "#00B8D9", // light teal
  "#00875A", // green (compliant)
  "#FF991F", // yellow (needs attention)
  "#DE350B", // red (non-compliant)
  "#6554C0", // purple
  "#FF5630", // coral/orange
  "#42526E", // neutral grey
];

export default function CategoryPieChart({ locations }: CategoryPieChartProps) {
  // Aggregate data by category
  const counts = locations.reduce((acc, loc) => {
    acc[loc.category] = (acc[loc.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const data = Object.entries(counts).map(([name, value]) => ({
    name,
    value,
  })).sort((a, b) => b.value - a.value);

  const total = data.reduce((sum, item) => sum + item.value, 0);

  // Custom Tooltip to show count and percentage
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const { name, value } = payload[0];
      const percent = ((value / total) * 100).toFixed(1);
      return (
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-3 shadow-md text-xs text-[#172B4D]">
          <p className="font-semibold">{name}</p>
          <p className="text-[#0052CC] mt-1">
            Count: <span className="font-bold">{value}</span> ({percent}%)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div id="category-pie-chart-container" className="h-full flex flex-col justify-between">
      <div className="flex-1 min-h-[220px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={80}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend
              verticalAlign="bottom"
              height={36}
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: "11px", color: "#42526E" }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
