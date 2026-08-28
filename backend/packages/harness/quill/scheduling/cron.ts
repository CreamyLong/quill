/**
 * Minimal, dependency-free 5-field cron expression parser.
 *
 * Supports the standard cron fields:
 *   minute (0-59), hour (0-23), day-of-month (1-31),
 *   month (1-12), day-of-week (0-7 where 0 and 7 are Sunday).
 *
 * Each field accepts:
 *   - (asterisk)        any value
 *   - (star-slash-n)     every n steps from the field minimum
 *   - (single)       single value
 *   - (range)     inclusive range
 *   - (range-slash-n)   range with step
 *   - lists     comma-separated combination of the above
 *
 * Day matching follows classic cron semantics: when BOTH day-of-month and
 * day-of-week are restricted (i.e. not (asterisk)), the date fires when EITHER
 * matches; otherwise the restricted field alone decides.
 *
 * (nextCronRun) scans forward one minute at a time from the given lower
 * bound. The scan is capped so pathological expressions cannot loop forever.
 */

export interface CronFieldSet {
  /** All allowed values for this field, or null when the field is (asterisk) (any). */
  values: ReadonlySet<number> | null;
  /** True when the source field was exactly (asterisk) (unrestricted). */
  any: boolean;
}

export interface ParsedCron {
  minute: CronFieldSet;
  hour: CronFieldSet;
  dom: CronFieldSet;
  month: CronFieldSet;
  dow: CronFieldSet;
  /** Normalized expression string (lower-cased, single spaces). */
  expression: string;
}

const FIELD_RANGES: ReadonlyArray<{ key: "minute" | "hour" | "dom" | "month" | "dow"; min: number; max: number }> = [
  { key: "minute", min: 0, max: 59 },
  { key: "hour", min: 0, max: 23 },
  { key: "dom", min: 1, max: 31 },
  { key: "month", min: 1, max: 12 },
  { key: "dow", min: 0, max: 7 },
];

function parseField(field: string, min: number, max: number, key: string): CronFieldSet {
  if (field === "*") {
    return { values: null, any: true };
  }
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) {
      throw new Error(`Empty element in cron '${key}' field`);
    }
    const [rangePart, stepPart] = trimmed.split("/");
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid step '${stepPart ?? ""}' in cron '${key}' field`);
    }
    let lo: number;
    let hi: number;
    if (rangePart === "*") {
      lo = min;
      hi = max;
    } else if (rangePart.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = Number(b);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Invalid range '${rangePart}' in cron '${key}' field (expected ${min}-${max})`);
      }
    } else {
      const single = Number(rangePart);
      if (stepPart !== undefined) {
        // A bare value with a step, e.g. `5/10`, is treated as `5-max/10`.
        lo = single;
        hi = max;
      } else {
        if (!Number.isInteger(single) || single < min || single > max) {
          throw new Error(`Invalid value '${rangePart}' in cron '${key}' field (expected ${min}-${max})`);
        }
        values.add(single);
        continue;
      }
    }
    for (let v = lo; v <= hi; v += step) {
      values.add(v);
    }
  }
  // Normalize dow: treat 7 as 0 (Sunday) so downstream comparisons are uniform.
  if (key === "dow" && values.has(7)) {
    values.delete(7);
    values.add(0);
  }
  return { values, any: false };
}

/**
 * Parse a 5-field cron expression.
 *
 * @throws {Error} When the expression has the wrong field count or an invalid
 *   field value.
 */
export function parseCronExpression(expression: string): ParsedCron {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have exactly 5 fields, got ${fields.length}: '${expression}'`);
  }
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
  const parsed = {
    minute: parseField(minute, 0, 59, "minute"),
    hour: parseField(hour, 0, 23, "hour"),
    dom: parseField(dom, 1, 31, "dom"),
    month: parseField(month, 1, 12, "month"),
    dow: parseField(dow, 0, 7, "dow"),
  };
  return { ...parsed, expression: fields.join(" ") };
}

/** True when the string parses as a valid 5-field cron expression. */
export function isCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(cron: ParsedCron, date: Date): boolean {
  // Use UTC getters so the function is timezone-independent.
  // JS getUTCDay(): 0 = Sunday .. 6 = Saturday — same numbering as cron dow (with 7 normalized to 0).
  const domOk = cron.dom.any || cron.dom.values!.has(date.getUTCDate());
  const dowOk = cron.dow.any || cron.dow.values!.has(date.getUTCDay());
  // Classic cron: if both dom and dow are restricted, EITHER may match.
  if (!cron.dom.any && !cron.dow.any) {
    return domOk || dowOk;
  }
  return domOk && dowOk;
}

/**
 * Compute the next fire time strictly after `after` for a cron expression.
 *
 * Scans minute-by-minute; returns `null` when no fire time is found within
 * roughly four years (a defensive cap for near-impossible expressions such as
 * `0 0 31 2 *`).
 *
 * NOTE: Uses UTC-based getters/setters so the function is timezone-independent
 * (cron fields are interpreted as UTC values).
 */
export function nextCronRun(expression: string | ParsedCron, after: Date): Date | null {
  const cron = typeof expression === "string" ? parseCronExpression(expression) : expression;
  // Start from the next whole minute strictly after `after`.
  const cursor = new Date(after.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  // Roughly four years of minutes as a safety cap.
  const maxIterations = 4 * 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    // UTC month is 0-based; cron uses 1-based.
    if (cron.month.values !== null && !cron.month.values.has(cursor.getUTCMonth() + 1)) {
      // Skip to the first of the next month to save iterations.
      cursor.setUTCMonth(cursor.getUTCMonth() + 1, 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(cron, cursor)) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      cursor.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (cron.hour.values !== null && !cron.hour.values.has(cursor.getUTCHours())) {
      cursor.setUTCHours(cursor.getUTCHours() + 1, 0, 0, 0);
      continue;
    }
    if (cron.minute.values !== null && !cron.minute.values.has(cursor.getUTCMinutes())) {
      cursor.setUTCMinutes(cursor.getUTCMinutes() + 1, 0, 0);
      continue;
    }
    return new Date(cursor.getTime());
  }
  return null;
}
