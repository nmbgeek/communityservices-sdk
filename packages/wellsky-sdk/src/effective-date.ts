import { ValidationError } from "./errors.js";

/** Explicit deployment correction for an observed upstream mobile-write date shift. */
export function correctMobileEffectiveDate(value: unknown, minutes: number, operation: string): string {
  const invalid = () => new ValidationError(operation, ["dateEffective"]);
  if (typeof value !== "string") throw invalid();
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) throw invalid();
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw invalid();
  if (zone !== "Z" && (!zone || Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))) throw invalid();
  const corrected = Date.parse(value) + minutes * 60_000;
  if (!Number.isFinite(corrected)) throw invalid();
  const encoded = new Date(corrected).toISOString();
  if (!/^\d{4}-/.test(encoded)) throw invalid();
  return encoded;
}
