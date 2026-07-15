import React from "react";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  id: string;
  title: string;
  value: string | number;
  subtext: string;
  icon: LucideIcon;
  badgeText?: string;
  badgeType?: "success" | "warning" | "error" | "info";
}

export default function StatCard({
  id,
  title,
  value,
  subtext,
  icon: Icon,
  badgeText,
  badgeType = "info",
}: StatCardProps) {
  // Map badge types to clean, responsive theme-aware styling
  const badgeStyles = {
    success: "bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30",
    warning: "bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30",
    error: "bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30",
    info: "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30",
  };

  return (
    <div
      id={id}
      className="bg-white dark:bg-[#0a0a0a] border border-neutral-200/90 dark:border-neutral-900/90 rounded-[10px] p-6 hover:border-neutral-300 dark:hover:border-neutral-800 transition-all duration-150 flex flex-col justify-between min-h-[140px]"
    >
      <div className="flex justify-between items-start">
        <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-450 uppercase tracking-wider">
          {title}
        </span>
        <div className="p-1 text-neutral-400 dark:text-neutral-555">
          <Icon size={14} />
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="text-2xl font-semibold text-neutral-900 dark:text-white tracking-tight">
          {value}
        </span>
        {badgeText && (
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm uppercase tracking-wider ${badgeStyles[badgeType]}`}
          >
            {badgeText}
          </span>
        )}
      </div>

      <div className="mt-2 text-xs text-neutral-450 dark:text-neutral-500 leading-relaxed border-t border-neutral-100/80 dark:border-neutral-900/80 pt-2 font-medium">
        {subtext}
      </div>
    </div>
  );
}
