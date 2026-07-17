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
} from "recharts";
import { Location } from "../../data/mockData.types";

interface DistrictBarChartProps {
  locations: Location[];
}

export default function DistrictBarChart({ locations }: DistrictBarChartProps) {
  // 1. Filter for "Verified - No RWH" or "Unknown" locations
  const targetLocations = locations.filter(
    (loc) =>
      loc.water.rainwaterHarvesting.status === "verified_no_rwh" || loc.water.rainwaterHarvesting.status === "unknown"
  );

  // 2. Aggregate count per district
  const districtCounts = targetLocations.reduce((acc, loc) => {
    acc[loc.district] = (acc[loc.district] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // 3. Format, sort, and slice to get top 5
  const data = Object.entries(districtCounts)
    .map(([district, count]) => ({
      district,
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const { district, count } = payload[0].payload;
      return (
        <div className="bg-white border border-[#DFE1E6] rounded-[3px] p-3 shadow-md text-xs text-[#172B4D]">
          <p className="font-semibold">{district} District</p>
          <p className="text-[#DE350B] mt-1">
            Prospect Targets: <span className="font-bold">{count}</span> institutions
          </p>
          <p className="text-[10px] text-gray-500 mt-1">
            (RWH status is No-RWH or Unknown)
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div id="district-bar-chart-container" className="h-full min-h-[220px]">
      {data.length === 0 ? (
        <div className="h-full flex items-center justify-center text-xs text-[#5E6C84]">
          No data available.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
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
              dataKey="district"
              type="category"
              stroke="#172B4D"
              fontSize={11}
              width={100}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: "#F4F5F7" }} />
            <Bar dataKey="count" radius={[0, 3, 3, 0]} barSize={16}>
              {data.map((entry, index) => {
                // Gradient colors from critical to caution
                const colors = ["#DE350B", "#E54921", "#FF5630", "#FF7A00", "#FF991F"];
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={colors[index % colors.length]}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
