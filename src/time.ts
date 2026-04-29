import { LOS_ANGELES_TZ } from "./config.js";

function partsFor(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function localDate(date = new Date(), timeZone = LOS_ANGELES_TZ): string {
  const parts = partsFor(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function localHour(date = new Date(), timeZone = LOS_ANGELES_TZ): number {
  return Number(partsFor(date, timeZone).hour);
}

export function isLosAngelesRunWindow(date = new Date()): boolean {
  return localHour(date, LOS_ANGELES_TZ) === 21;
}
