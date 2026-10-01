export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" }) {
  if (!iso) return "—";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return d.toLocaleDateString("en-IN", opts);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function todayLocal(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
}

export function relativeDays(iso: string | null | undefined) {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function dueLabel(date: string | null) {
  if (!date) return "No date";
  const today = todayLocal();
  if (date === today) return "Today";
  if (date === todayLocal(1)) return "Tomorrow";
  if (date < today) {
    const days = Math.round((new Date(today).getTime() - new Date(date).getTime()) / 86400000);
    return `${days} day${days === 1 ? "" : "s"} overdue`;
  }
  return formatDate(date);
}

export const displayUrl = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
