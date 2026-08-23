export function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

export function formatPercent(value: number, maximumFractionDigits = 1) {
  return `${Number.isFinite(value) ? value.toFixed(maximumFractionDigits) : "0.0"}%`;
}

export function formatDateTime(value?: string | number | Date | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, options ?? {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(value?: string | number | Date | null) {
  return formatDateTime(value, { month: "short", day: "numeric", year: "numeric" });
}

export function formatTime(value?: string | number | Date | null, timeZone?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(value));
  } catch {
    return formatDateTime(value, { hour: "numeric", minute: "2-digit" });
  }
}

export function formatLocalTime(timeZone?: string) {
  if (!timeZone) return "Local time unavailable";
  try {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date());
  } catch {
    return "Local time unavailable";
  }
}

export function relativeTime(value?: string | number | Date | null, now = Date.now()) {
  if (!value) return "Not scheduled";
  const diff = new Date(value).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff < 0 ? "Due now" : "In <1 min";
  const minutes = Math.round(abs / 60_000);
  if (minutes < 60) return diff < 0 ? `${minutes}m overdue` : `In ${minutes}m`;
  const hours = Math.round(abs / 3_600_000);
  if (hours < 24) return diff < 0 ? `${hours}h overdue` : `In ${hours}h`;
  const days = Math.round(abs / 86_400_000);
  return diff < 0 ? `${days}d overdue` : `In ${days}d`;
}

export function initials(value?: string) {
  return (value || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function phoneHref(value?: string) {
  return value ? `tel:${value.replace(/[^+\d]/g, "")}` : undefined;
}

export function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalInputValue(value?: string | number | Date | null) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

export function fromLocalInputValue(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
