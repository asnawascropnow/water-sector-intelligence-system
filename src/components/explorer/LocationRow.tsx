import React from "react";
import {
  MapPin,
  Building2,
  Home,
  Bed,
  Landmark,
  Cpu,
  Hammer,
  Compass,
  School as SchoolIcon,
  Hospital as HospitalIcon,
} from "lucide-react";
import { Location, Category, RwhStatus, WaterStressLevel } from "../../data/mockData.types";

interface LocationRowProps {
  key?: React.Key | string;
  location: Location;
  isSelected: boolean;
  onClick: () => void;
}

const LocationRow: React.FC<LocationRowProps> = ({ location, isSelected, onClick }) => {
  // Select category icon
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "University":
      case "College":
        return <SchoolIcon size={14} className="text-[#0747A6]" />;
      case "School":
        return <SchoolIcon size={14} className="text-[#00875A]" />;
      case "Hospital":
        return <HospitalIcon size={14} className="text-[#DE350B]" />;
      case "Apartment/Residential":
        return <Home size={14} className="text-[#6554C0]" />;
      case "Industry":
      case "Manufacturing":
        return <Building2 size={14} className="text-[#FF7A00]" />;
      case "Hotel":
        return <Bed size={14} className="text-[#00B8D9]" />;
      case "Government Building":
        return <Landmark size={14} className="text-[#4C5B76]" />;
      case "Data Centre":
        return <Cpu size={14} className="text-[#36B37E]" />;
      case "Mining":
        return <Hammer size={14} className="text-[#FFAB00]" />;
      default:
        return <Compass size={14} className="text-[#42526E]" />;
    }
  };

  // Status badge styles
  const getRwhStatusStyles = (status: RwhStatus) => {
    switch (status) {
      case "verified_has_rwh":
        return "bg-[#E3FCEF] text-[#006644] border-[#ABF5D1]";
      case "verified_no_rwh":
        return "bg-[#FFEBE6] text-[#BF2600] border-[#FFBDAD]";
      default:
        return "bg-[#FFF0B3] text-[#172B4D] border-[#FFE380]";
    }
  };

  const getRwhStatusLabel = (status: RwhStatus) => {
    if (status === "verified_has_rwh") return "HAS RWH";
    if (status === "verified_no_rwh") return "NO RWH";
    return "UNKNOWN";
  };

  const getWaterStressStyles = (level: WaterStressLevel) => {
    switch (level) {
      case "Safe":
        return "bg-[#E3FCEF] text-[#006644]";
      case "Semi-Critical":
        return "bg-[#EBECF0] text-[#42526E]";
      case "Critical":
        return "bg-[#FFF0B3] text-[#172B4D]";
      case "Over-Exploited":
        return "bg-[#FFEBE6] text-[#BF2600]";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  const acres = location.water.estimatedRoofArea 
    ? (location.water.estimatedRoofArea * 4 / 4046.86).toFixed(1)
    : "0";

  return (
    <div
      onClick={onClick}
      className={`p-3 border-b border-[#DFE1E6] hover:bg-[#F4F5F7] transition-all cursor-pointer flex flex-col gap-2 relative ${
        isSelected ? "bg-[#DEEBFF] border-l-4 border-l-[#0052CC] hover:bg-[#DEEBFF]" : "bg-white"
      }`}
    >
      {/* Top row: Name & Area */}
      <div className="flex justify-between items-start gap-2">
        <h5 className="font-semibold text-[13px] text-[#172B4D] hover:text-[#0052CC] transition-colors line-clamp-1">
          {location.name}
        </h5>
        <span className="text-[11px] font-mono font-medium text-[#5E6C84] bg-[#F4F5F7] px-1.5 py-0.5 rounded-sm flex-shrink-0">
          {acres} ac
        </span>
      </div>

      {/* Middle row: Address info */}
      <div className="flex items-center gap-1 text-[11px] text-[#5E6C84]">
        <MapPin size={12} className="text-[#8993A4] flex-shrink-0" />
        <span className="truncate">
          {location.district}, {location.state}
        </span>
      </div>

      {/* Bottom row: Badges */}
      <div className="flex items-center justify-between gap-1 mt-1 flex-wrap">
        <div className="flex items-center gap-1.5">
          {/* Category mini badge */}
          <span className="flex items-center gap-1 bg-[#FAFBFC] border border-[#DFE1E6] rounded-sm px-1.5 py-0.5 text-[10px] font-medium text-[#42526E]">
            {getCategoryIcon(location.category)}
            <span>{location.category}</span>
          </span>

          {/* Water Stress Badge */}
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wide ${getWaterStressStyles(
              location.water.waterStressLevel
            )}`}
          >
            {location.water.waterStressLevel}
          </span>
        </div>

        {/* RWH Status Badge */}
        <span
          className={`text-[9.5px] font-bold px-2 py-0.5 border rounded-sm truncate max-w-[120px] ${getRwhStatusStyles(
            location.water.rainwaterHarvesting.status
          )}`}
        >
          {getRwhStatusLabel(location.water.rainwaterHarvesting.status)}
        </span>
      </div>
    </div>
  );
};

export default LocationRow;
