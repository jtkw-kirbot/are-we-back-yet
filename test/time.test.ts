import { describe, expect, it } from "vitest";
import { dateRangeInclusive, isLosAngelesRunWindow, localDate } from "../src/time.js";

describe("time helpers", () => {
  it("formats dates in America/Los_Angeles", () => {
    expect(localDate(new Date("2026-04-28T06:00:00.000Z"))).toBe("2026-04-27");
  });

  it("detects the 9pm Los Angeles run window across UTC dates", () => {
    expect(isLosAngelesRunWindow(new Date("2026-04-28T04:05:00.000Z"))).toBe(true);
    expect(isLosAngelesRunWindow(new Date("2026-12-28T05:05:00.000Z"))).toBe(true);
    expect(isLosAngelesRunWindow(new Date("2026-04-28T03:05:00.000Z"))).toBe(false);
  });

  it("builds inclusive YYYY-MM-DD ranges", () => {
    expect([...dateRangeInclusive("2026-01-01", "2026-01-03")]).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
    ]);
  });
});
