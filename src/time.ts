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

export function toUnixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

export function utcDateRange(date: string): { start: number; end: number } {
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: toUnixSeconds(start), end: toUnixSeconds(end) };
}

export function* dateRangeInclusive(start: string, end: string): Generator<string> {
  const cursor = new Date(`${start}T00:00:00.000Z`);
  const final = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(final.getTime())) {
    throw new Error("Dates must use YYYY-MM-DD format.");
  }
  if (cursor > final) throw new Error("start date must be on or before end date.");

  while (cursor <= final) {
    yield cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
}
