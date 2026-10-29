import { isRecord } from "./validation.js";
import { WellSkyError } from "./runtime.js";
import type { RequestOptions } from "./runtime.js";
import { ValidationError } from "./errors.js";
import { verifyWrite } from "./verification.js";
import type { WriteResult } from "./verification.js";
import type { AddSubAssessmentQuestionWithAnswerViewModel } from "./generated/v3-models.js";

export interface SubassessmentContext extends RequestOptions {
  clientId: number;
  assessmentCode: string;
  effectiveDate?: string;
}
export interface EndDateRequest extends SubassessmentContext {
  parentField: string;
  recordsetId: number;
  endDateField: string;
  endDate: string;
  /** Optional caller preflight for program-specific review-date or other policies. */
  preflight?: (options: RequestOptions) => Promise<void>;
}
export interface SubassessmentSource {
  read: (context: SubassessmentContext) => Promise<unknown>;
  write: (context: SubassessmentContext, body: AddSubAssessmentQuestionWithAnswerViewModel[]) => Promise<unknown>;
}
function objectRows(value: unknown): Record<string, unknown>[] {
  const rows = isRecord(value) && Array.isArray(value.value) ? value.value : Array.isArray(value) ? value : value === null ? [] : [value];
  if (!rows.every(isRecord)) throw new WellSkyError("protocol", "subassessment read");
  return rows;
}
function parentFrom(value: unknown, field: string): Record<string, unknown> {
  const matches = objectRows(value).filter(q => q.virt_field_name === field);
  if (matches.length !== 1 || !matches[0] || matches[0].question_type !== "sub_assessment") throw new ValidationError("subassessment resolution", [field]);
  return matches[0];
}
function dateValue(value: unknown, calendarOnly = false): unknown {
  if (value === null || value === "" || value === undefined) return null;
  if (typeof value !== "string") return value;
  if (calendarOnly || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.slice(0, 10);
  const iso = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) return value;
  const millis = Date.parse(iso);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : value;
}
function snapshot(parent: Record<string, unknown>, endDateField: string, calendarOnly: boolean): Record<string, unknown> {
  const records = objectRows(parent.sub_assessment_answer_list ?? []);
  const fields: Record<string, unknown> = { "$recordsets": records.map(r => r.recordset_id).sort((a, b) => Number(a) - Number(b)) };
  for (const record of records) for (const q of objectRows(record.sub_assessment_list ?? [])) {
    if (typeof q.virt_field_name !== "string" || typeof record.recordset_id !== "number") throw new WellSkyError("protocol", "subassessment read");
    fields[`${record.recordset_id}/${q.virt_field_name}`] = q.question_type === "date" ? dateValue(q.answer_value, calendarOnly && q.virt_field_name === endDateField) : q.answer_value ?? null;
  }
  return fields;
}

/** Generic recordset editing; no program names, assessment codes, or replacement policy. */
export class SubassessmentEditor {
  readonly #tenant: string;
  readonly #source: SubassessmentSource;
  constructor(tenant: string, source: SubassessmentSource) { this.#tenant = tenant; this.#source = source; }

  async setEndDate(input: EndDateRequest): Promise<WriteResult<{ recordsetId: number }>> {
    const operation = "POST /assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}";
    const readEndpoint = "GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}";
    const expected: Record<string, unknown> = {};
    let body: AddSubAssessmentQuestionWithAnswerViewModel[] = [];
    const calendarOnly = /^\d{4}-\d{2}-\d{2}$/.test(input.endDate);
    const semanticPayload = { tenant: this.#tenant, operation, clientId: input.clientId, assessmentCode: input.assessmentCode, parentField: input.parentField, recordsetId: input.recordsetId, endDateField: input.endDateField, endDate: input.endDate, effectiveDate: input.effectiveDate ?? null };
    return verifyWrite({
      operation, readEndpoint, semanticPayload, expectedFields: expected,
      ...(input.signal ? { signal: input.signal } : {}), ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      preflight: async options => {
        if (!Number.isSafeInteger(input.recordsetId) || input.recordsetId < 1 || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(input.endDate)) throw new ValidationError(operation, ["recordsetId", "endDate"]);
        const calendar = input.endDate.slice(0, 10);
        const day = new Date(`${calendar}T00:00:00Z`);
        if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== calendar) throw new ValidationError(operation, ["endDate"]);
        if (!calendarOnly && !Number.isFinite(Date.parse(input.endDate.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00")))) throw new ValidationError(operation, ["endDate"]);
        await input.preflight?.(options);
        const parent = parentFrom(await this.#source.read({ ...input, ...options }), input.parentField);
        const records = objectRows(parent.sub_assessment_answer_list ?? []);
        const selected = records.filter(r => r.recordset_id === input.recordsetId);
        if (selected.length !== 1 || !selected[0]) throw new ValidationError(operation, ["recordsetId"]);
        const questions = objectRows(selected[0].sub_assessment_list ?? []);
        const end = questions.filter(q => q.virt_field_name === input.endDateField && q.question_type === "date");
        if (end.length !== 1 || typeof parent.question_id !== "number") throw new ValidationError(operation, [input.endDateField]);
        const encoded = questions.filter(q => !["label", "blank"].includes(String(q.question_type))).flatMap(q => {
          if (q.question_type === "provider") throw new ValidationError("mobile provider answers are unsupported", [String(q.virt_field_name)]);
          if (typeof q.question_id !== "number" || typeof q.question_type !== "string" || typeof q.virt_field_name !== "string") throw new WellSkyError("protocol", readEndpoint);
          const value = q.virt_field_name === input.endDateField ? input.endDate : q.answer_value ?? "";
          if (typeof value !== "string") throw new WellSkyError("protocol", readEndpoint);
          if (q.question_type === "yes_no" && value === "") return [];
          return [{ question_id: q.question_id, question_type: q.question_type, virt_field_name: q.virt_field_name, answer_value: value }];
        });
        Object.assign(expected, snapshot(parent, input.endDateField, calendarOnly));
        expected[`${input.recordsetId}/${input.endDateField}`] = dateValue(input.endDate, calendarOnly);
        body = [{ question_id: parent.question_id, question_type: "sub_assessment", virt_field_name: input.parentField, answer_value: "", subAssessmentQuestionAnswers: [{ recordset_id: input.recordsetId, isDeleted: false, subAssessments: encoded }] }];
      },
      submit: options => this.#source.write({ ...input, ...options }, body),
      readBack: async options => {
        const parent = parentFrom(await this.#source.read({ ...input, ...options }), input.parentField);
        const records = objectRows(parent.sub_assessment_answer_list ?? []);
        if (!records.some(r => r.recordset_id === input.recordsetId)) return { kind: "absent" };
        return { kind: "found", value: { data: { recordsetId: input.recordsetId }, ids: { clientId: input.clientId, recordsetId: input.recordsetId }, fields: snapshot(parent, input.endDateField, calendarOnly) } };
      },
    });
  }
}
