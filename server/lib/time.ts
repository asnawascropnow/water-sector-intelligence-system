// All "today" logic uses India Standard Time so daily reminders match the team's day.
export const TZ = "Asia/Kolkata";

export function todayIST(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function daysSince(iso: string | Date | null | undefined): number | null {
  if (!iso) return null;
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return Math.floor((Date.now() - t) / 86400000);
}
