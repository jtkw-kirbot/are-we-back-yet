import { describe, expect, it } from "vitest";
import { endOfLocalDateUnixSeconds, isLosAngelesRunWindow, localDate } from "../src/time.js";

describe("time helpers", () => {
  it("formats dates in America/Los_Angeles", () => {
    expect(localDate(new Date("2026-04-28T06:00:00.000Z"))).toBe("2026-04-27");
  });

  it("detects the 9pm Los Angeles run window across UTC dates", () => {
    expect(isLosAngelesRunWindow(new Date("2026-04-28T04:05:00.000Z"))).toBe(true);
    expect(isLosAngelesRunWindow(new Date("2026-12-28T05:05:00.000Z"))).toBe(true);
    expect(isLosAngelesRunWindow(new Date("2026-04-28T03:05:00.000Z"))).toBe(false);
  });

  it("computes the end of a Los Angeles calendar date across DST", () => {
    expect(new Date(endOfLocalDateUnixSeconds("2026-04-28") * 1000).toISOString()).toBe("2026-04-29T06:59:59.000Z");
    expect(new Date(endOfLocalDateUnixSeconds("2026-12-28") * 1000).toISOString()).toBe("2026-12-29T07:59:59.000Z");
  });
});
