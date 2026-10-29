import type { WellSkyClient } from "./generated/v3.js";
import type { SubAssessmentAnswer } from "./generated/v3-models.js";
import { ValidationError } from "./errors.js";
import { toItems, WellSkyError } from "./runtime.js";
import type { RequestOptions } from "./runtime.js";

/** Structural interface accepted by both V2 and V3 clients. Only a GET is used. */
export interface VerificationAssessmentReader {
  assessments: Pick<WellSkyClient["assessments"], "get">;
}
export interface EnrollmentVerificationRequest extends RequestOptions {
  clientId: number;
  /** An instrument exposing all four standard verification groups. */
  assessmentCode: string;
  /** Exact enrollment instant with Z or a numeric offset. No host timezone is inferred. */
  enrollmentDate: string;
}
export type VerificationField = "MONTHLYINCOME" | "SVP_NONCASHBENEFITS" | "HUDHEALTHINSURANCESUBA" | "DISABILITIES_1";
export type VerificationRecord = SubAssessmentAnswer & { recordset_id: number };
export interface VerificationGroupSnapshot {
  fieldName: VerificationField;
  records: VerificationRecord[];
  excluded: { record: VerificationRecord; reason: "not_started" | "ended" }[];
}
export interface EnrollmentVerificationSnapshot {
  clientId: number;
  assessmentCode: string;
  enrollmentDate: string;
  /** Current recorded versions filtered by row dates, not an answer-history reconstruction. */
  source: "current-assessment";
  groups: VerificationGroupSnapshot[];
}

const fields: { field: VerificationField; start: string; end: string }[] = [
  { field: "MONTHLYINCOME", start: "MONTHLYINCOMESTART", end: "MONTHLYINCOMEEND" },
  { field: "SVP_NONCASHBENEFITS", start: "SVP_NONCASHBENEFITSSTART", end: "SVP_NONCASHBENEFITSEND" },
  { field: "HUDHEALTHINSURANCESUBA", start: "HUDHEALTHINSURANCESUBASTART", end: "HUDHEALTHINSURANCESUBAEND" },
  { field: "DISABILITIES_1", start: "DISABILITIES_1START", end: "DISABILITIES_1END" },
];

/** Parses ISO and WellSky's offset-bearing SQL date strings without local-time conversion.
 * Nanoseconds preserve fractional boundaries instead of rounding a future row into the snapshot. */
function verificationInstant(value: unknown): bigint | undefined {
  if (typeof value !== "string") return undefined;
  const parts = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!parts) return undefined;
  const [, calendar, hour, minute, second, fraction = "", zone] = parts;
  if (!calendar || !zone || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return undefined;
  const day = new Date(`${calendar}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendar) return undefined;
  const offset = zone.slice(1).replace(":", "");
  const offsetHours = zone === "Z" ? 0 : Number(offset.slice(0, 2));
  const offsetMinutes = zone === "Z" ? 0 : Number(offset.slice(2) || "0");
  if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return undefined;
  const signedOffset = (zone.startsWith("-") ? -1 : 1) * (offsetHours * 60 + offsetMinutes);
  const millis = day.getTime() + (Number(hour) * 3600 + Number(minute) * 60 + Number(second) - signedOffset * 60) * 1000;
  return BigInt(millis) * 1_000_000n + BigInt(fraction.padEnd(9, "0"));
}

function recordDate(record: VerificationRecord, field: string): string | null {
  const matches = record.sub_assessment_list?.filter(q => q.virt_field_name === field) ?? [];
  const question = matches[0];
  if (matches.length !== 1 || !question || question.question_type !== "date") throw new WellSkyError("protocol", `verification date field ${field}`);
  const value = question.answer_value;
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") throw new WellSkyError("protocol", `verification date field ${field}`);
  return value;
}

/** Read current recorded verification rows and select start <= enrollment <= end.
 * Never writes, changes dates, applies a seven-hour correction, or treats isActive as a date filter.
 * Missing groups, ambiguous rows and invalid/zoneless dates fail rather than imply no records. */
export async function readEnrollmentVerifications(client: VerificationAssessmentReader, input: EnrollmentVerificationRequest): Promise<EnrollmentVerificationSnapshot> {
  const operation = "read enrollment verifications";
  const at = verificationInstant(input.enrollmentDate);
  if (at === undefined) throw new ValidationError(operation, ["enrollmentDate"]);
  if (!Number.isSafeInteger(input.clientId) || input.clientId < 1) throw new ValidationError(operation, ["clientId"]);
  if (typeof input.assessmentCode !== "string" || !input.assessmentCode.trim()) throw new ValidationError(operation, ["assessmentCode"]);
  // Do not send dateEffective: it can suppress backdated rows needed for this projection.
  const response = await client.assessments.get({
    path: { clientId: input.clientId, assessmentCode: input.assessmentCode },
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
  });
  const questions = toItems(response);
  const groups: VerificationGroupSnapshot[] = [];
  const seenIds = new Set<number>();
  for (const { field, start, end } of fields) {
    const matches = questions.filter(q => q.virt_field_name === field);
    const parent = matches[0];
    if (matches.length !== 1 || !parent || parent.question_type !== "sub_assessment" || !Array.isArray(parent.sub_assessment_answer_list)) throw new WellSkyError("protocol", `verification group ${field}`);
    const group: VerificationGroupSnapshot = { fieldName: field, records: [], excluded: [] };
    for (const raw of parent.sub_assessment_answer_list) {
      const id = raw.recordset_id;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || seenIds.has(id)) throw new WellSkyError("protocol", "verification record identity");
      seenIds.add(id);
      const record: VerificationRecord = { ...structuredClone(raw), recordset_id: id };
      const startValue = recordDate(record, start), endValue = recordDate(record, end);
      const from = verificationInstant(startValue), through = endValue === null ? null : verificationInstant(endValue);
      if (from === undefined || through === undefined || (through !== null && through < from)) throw new WellSkyError("protocol", `verification interval ${field}`);
      if (from > at) group.excluded.push({ record, reason: "not_started" });
      else if (through !== null && through < at) group.excluded.push({ record, reason: "ended" });
      else group.records.push(record);
    }
    groups.push(group);
  }
  return { clientId: input.clientId, assessmentCode: input.assessmentCode, enrollmentDate: input.enrollmentDate, source: "current-assessment", groups };
}
