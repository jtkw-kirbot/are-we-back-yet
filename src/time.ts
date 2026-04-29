import { LOS_ANGELES_TZ } from "./config.js";

function partsFor(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
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

function localDateTimeAsUtcMs(parts: Record<string, string>): number {
  return Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second ?? "0"),
  );
}

export function localDateTimeToUtcMs(
  date: string,
  timeZone = LOS_ANGELES_TZ,
  time: { hour: number; minute: number; second: number; millisecond: number } = {
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
  },
): number {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error(`Invalid date: ${date}`);
  const [, year, month, day] = match;
  const targetUtcMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    time.hour,
    time.minute,
    time.second,
    time.millisecond,
  );
  let utcMs = targetUtcMs;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const renderedAsUtcMs = localDateTimeAsUtcMs(partsFor(new Date(utcMs), timeZone));
    const delta = targetUtcMs - renderedAsUtcMs;
    if (delta === 0) return utcMs;
    utcMs += delta;
  }
  return utcMs;
}

export function endOfLocalDateUnixSeconds(date: string, timeZone = LOS_ANGELES_TZ): number {
  const next = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(next.getTime())) throw new Error(`Invalid date: ${date}`);
  next.setUTCDate(next.getUTCDate() + 1);
  const nextDate = next.toISOString().slice(0, 10);
  const nextStartUtcMs = localDateTimeToUtcMs(nextDate, timeZone);
  return Math.floor((nextStartUtcMs - 1) / 1000);
}
