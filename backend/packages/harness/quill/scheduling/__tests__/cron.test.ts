import { describe, expect, it } from "vitest";

import { isCronExpression, nextCronRun, parseCronExpression } from "../cron.ts";

describe("parseCronExpression", () => {
  it("parses a fully wildcard expression", () => {
    const c = parseCronExpression("* * * * *");
    expect(c.minute.any).toBe(true);
    expect(c.hour.any).toBe(true);
    expect(c.dom.any).toBe(true);
    expect(c.month.any).toBe(true);
    expect(c.dow.any).toBe(true);
    expect(c.expression).toBe("* * * * *");
  });

  it("parses single values, ranges, steps and lists", () => {
    const c = parseCronExpression("5 14 1,15 */2 1-5");
    expect(c.minute.values?.has(5)).toBe(true);
    expect(c.minute.values?.size).toBe(1);
    expect(c.hour.values?.has(14)).toBe(true);
    expect(c.dom.values?.has(1)).toBe(true);
    expect(c.dom.values?.has(15)).toBe(true);
    expect(c.dom.values?.size).toBe(2);
    // month every 2 starting at 1: {1,3,5,7,9,11}
    expect([...c.month.values ?? []].sort((a, b) => a - b)).toEqual([1, 3, 5, 7, 9, 11]);
    expect(c.dow.values?.has(1)).toBe(true);
    expect(c.dow.values?.has(5)).toBe(true);
    expect(c.dow.values?.has(6)).toBe(false);
  });

  it("normalizes dow 7 to 0 (Sunday)", () => {
    const c = parseCronExpression("0 0 * * 7");
    expect(c.dow.values?.has(0)).toBe(true);
    expect(c.dow.values?.has(7)).toBe(false);
  });

  it("rejects wrong field counts", () => {
    expect(() => parseCronExpression("* * * *")).toThrow(/exactly 5 fields/);
    expect(() => parseCronExpression("* * * * * *")).toThrow(/exactly 5 fields/);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseCronExpression("60 * * * *")).toThrow(/Invalid value '60'/);
    expect(() => parseCronExpression("* 24 * * *")).toThrow(/Invalid value '24'/);
    expect(() => parseCronExpression("* * 0 * *")).toThrow(/Invalid value '0'/);
    expect(() => parseCronExpression("* * 32 * *")).toThrow(/Invalid value '32'/);
    expect(() => parseCronExpression("* * * 0 *")).toThrow(/Invalid value '0'/);
    expect(() => parseCronExpression("* * * 13 *")).toThrow(/Invalid value '13'/);
    expect(() => parseCronExpression("* * * * 8")).toThrow(/Invalid value '8'/);
  });

  it("rejects inverted and non-numeric ranges", () => {
    expect(() => parseCronExpression("10-5 * * * *")).toThrow(/Invalid range/);
    expect(() => parseCronExpression("a * * * *")).toThrow(/Invalid value 'a'/);
    expect(() => parseCronExpression("*/0 * * * *")).toThrow(/Invalid step/);
  });
});

describe("isCronExpression", () => {
  it("returns true for valid expressions", () => {
    expect(isCronExpression("0 9 * * 1-5")).toBe(true);
    expect(isCronExpression("*/15 * * * *")).toBe(true);
  });

  it("returns false for invalid expressions", () => {
    expect(isCronExpression("not a cron")).toBe(false);
    expect(isCronExpression("60 * * * *")).toBe(false);
  });
});

describe("nextCronRun", () => {
  it("finds the next matching minute for a fully wildcard expression", () => {
    // Use Date.UTC() for timezone-independent test dates.
    const after = new Date(Date.UTC(2026, 0, 15, 10, 30, 45)); // Jan 15 2026 10:30:45 UTC
    const next = nextCronRun("* * * * *", after);
    expect(next).toEqual(new Date(Date.UTC(2026, 0, 15, 10, 31, 0)));
  });

  it("advances to the next minute when the minute matches exactly", () => {
    const after = new Date(Date.UTC(2026, 0, 15, 10, 30, 0));
    const next = nextCronRun("30 * * * *", after);
    // Cron "30 * * * *" matches minute 30 of every hour. Next match after 10:30 is 11:30.
    expect(next).toEqual(new Date(Date.UTC(2026, 0, 15, 11, 30, 0)));
  });

  it("finds the next 09:00 weekday", () => {
    // 2026-01-16 is a Friday; 09:00 that day is in the future.
    const after = new Date(Date.UTC(2026, 0, 16, 10, 0, 0));
    const next = nextCronRun("0 9 * * 1-5", after);
    // Next weekday 09:00 after Fri Jan 16 10:00 is Mon Jan 19 09:00.
    expect(next).toEqual(new Date(Date.UTC(2026, 0, 19, 9, 0, 0)));
  });

  it("handles the end of month (Jan 31 -> Feb)", () => {
    const after = new Date(Date.UTC(2026, 0, 31, 23, 59, 0));
    const next = nextCronRun("0 0 1 * *", after);
    expect(next).toEqual(new Date(Date.UTC(2026, 1, 1, 0, 0, 0)));
  });

  it("applies dom/dow OR semantics when both are restricted", () => {
    // dom=13 and dow=1 (Monday): fires on the 13th OR on Mondays.
    // 2026-02-09 is a Monday. 2026-02-13 is a Friday.
    const after = new Date(Date.UTC(2026, 1, 8, 0, 0, 0)); // Sun Feb 8 2026
    const next = nextCronRun("0 9 13 * 1", after);
    expect(next).toEqual(new Date(Date.UTC(2026, 1, 9, 9, 0, 0))); // Mon Feb 9
    const next2 = nextCronRun("0 9 13 * 1", new Date(Date.UTC(2026, 1, 10, 0, 0, 0)));
    expect(next2).toEqual(new Date(Date.UTC(2026, 1, 13, 9, 0, 0))); // Fri Feb 13 (dom)
  });

  it("returns null when the expression can never match (Feb 31)", () => {
    const next = nextCronRun("0 0 31 2 *", new Date(Date.UTC(2026, 0, 1, 0, 0, 0)));
    expect(next).toBeNull();
  });

  it("accepts a pre-parsed expression without re-parsing", () => {
    const parsed = parseCronExpression("0 12 * * *");
    const after = new Date(Date.UTC(2026, 0, 15, 13, 0, 0));
    expect(nextCronRun(parsed, after)).toEqual(new Date(Date.UTC(2026, 0, 16, 12, 0, 0)));
  });
});
