import { WellSkyError } from "./runtime.js";
import type { RequestOptions } from "./runtime.js";
import { DefinitionDriftError, UnknownPicklistValueError, ValidationError } from "./errors.js";
import { isRecord } from "./validation.js";

export interface AssessmentContext extends RequestOptions {
  clientId: number;
  assessmentCode: string;
  effectiveDate?: string;
  refresh?: boolean;
}
export interface PicklistOption {
  id: number;
  picklistId: number | null;
  code: string | null;
  picklistCode: string | null;
  /** Raw metadata name. Not proof of a valid standalone/enrollment write label. */
  name: string | null;
  displayOrder: number | null;
  hudVisibility: number | null;
}
export interface QuestionDefinition {
  questionId: number;
  fieldName: string | null;
  description: string | null;
  questionType: string;
  displayOrder: number | null;
  mandatory: boolean | null;
  showOnPrevious: boolean | null;
  picklistId: number | null;
  options: PicklistOption[];
  children: QuestionDefinition[];
}
export interface AssessmentDefinition {
  tenant: string;
  assessmentCode: string;
  effectiveDate: string | null;
  retrievedAt: string;
  /** The mobile metadata endpoint cannot filter its option catalog by date. */
  picklistEffectiveDate: "current";
  questions: QuestionDefinition[];
  unresolvedPicklists: string[];
}
export interface QuestionReference { fieldName: string; parentPath?: readonly string[] }
export interface QuestionEntry { path: string[]; question: QuestionDefinition }
export interface PicklistDefinition {
  picklistId: number | null;
  questionPath: string[];
  options: PicklistOption[];
  status: "enumerated" | "unresolved";
}
export type PicklistSelector = { code: string; name?: string } | { name: string; code?: never };
export interface MetadataSource {
  generic: (context: AssessmentContext) => Promise<unknown>;
  mobile: (context: AssessmentContext) => Promise<unknown>;
}
export interface DefinitionExpectation { questions: ReadonlyArray<{ path: readonly string[]; questionType: string; mandatory?: boolean | null }> }
export interface DefinitionDrift {
  breaking: boolean;
  added: string[];
  removed: string[];
  retyped: string[];
  newlyMandatory: string[];
}

function numberOrNull(value: unknown): number | null { return typeof value === "number" && Number.isSafeInteger(value) ? value : null; }
function stringOrNull(value: unknown): string | null { return typeof value === "string" ? value : null; }
function boolOrNull(value: unknown): boolean | null { return typeof value === "boolean" ? value : null; }
function rows(value: unknown): Record<string, unknown>[] {
  const items: unknown = isRecord(value) && Array.isArray(value.value) ? value.value : Array.isArray(value) ? value : value === null ? [] : [value];
  if (!Array.isArray(items) || items.some(item => !isRecord(item))) throw new WellSkyError("protocol", "assessment metadata");
  return items.filter(isRecord);
}

function options(value: unknown): PicklistOption[] {
  if (value === undefined || value === null) return [];
  return rows(value).map(raw => {
    const id = numberOrNull(raw.picklist_value_id);
    if (id === null) throw new WellSkyError("protocol", "picklist metadata");
    return { id, picklistId: numberOrNull(raw.picklist_id), code: stringOrNull(raw.code), picklistCode: stringOrNull(raw.picklist_code), name: stringOrNull(raw.name), displayOrder: numberOrNull(raw.disp_order), hudVisibility: numberOrNull(raw.show_on_hud_nonhud_site) };
  });
}

function mergeQuestions(documents: unknown[], depth = 0): QuestionDefinition[] {
  if (depth > 30) throw new WellSkyError("protocol", "assessment metadata");
  const merged = new Map<string, QuestionDefinition>();
  const childSources = new Map<string, unknown[]>();
  for (const document of documents) for (const raw of rows(document)) {
    const id = numberOrNull(raw.question_id);
    const kind = stringOrNull(raw.question_type);
    if (id === null || !kind) throw new WellSkyError("protocol", "assessment metadata");
    const fieldName = stringOrNull(raw.virt_field_name);
    const key = fieldName ?? `#${id}`;
    const prior = merged.get(key);
    const picklistId = numberOrNull(raw.picklist_id);
    if (prior && (prior.questionId !== id || prior.questionType !== kind || (prior.picklistId !== null && picklistId !== null && prior.picklistId !== picklistId))) throw new DefinitionDriftError([key]);
    const optionMap = new Map((prior?.options ?? []).map(option => [option.id, option]));
    for (const option of options(raw.picklist_value_list)) {
      const previous = optionMap.get(option.id);
      if (previous && JSON.stringify(previous) !== JSON.stringify(option)) throw new DefinitionDriftError([key]);
      if (picklistId !== null && option.picklistId !== null && option.picklistId !== picklistId) throw new DefinitionDriftError([key]);
      optionMap.set(option.id, option);
    }
    merged.set(key, {
      questionId: id, fieldName, questionType: kind,
      description: stringOrNull(raw.description) ?? prior?.description ?? null,
      displayOrder: numberOrNull(raw.disp_order) ?? prior?.displayOrder ?? null,
      mandatory: boolOrNull(raw.mandatory_flag) ?? boolOrNull(raw.manditory_flag) ?? prior?.mandatory ?? null,
      showOnPrevious: boolOrNull(raw.show_on_prev) ?? prior?.showOnPrevious ?? null,
      picklistId: picklistId ?? prior?.picklistId ?? null,
      options: [...optionMap.values()].sort((a, b) => (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity) || a.id - b.id),
      children: [],
    });
    const children = childSources.get(key) ?? [];
    if (raw.sub_assessment_question_list != null) children.push(raw.sub_assessment_question_list);
    for (const record of rows(raw.sub_assessment_answer_list ?? [])) if (record.sub_assessment_list != null) children.push(record.sub_assessment_list);
    childSources.set(key, children);
  }
  for (const [key, question] of merged) question.children = mergeQuestions(childSources.get(key) ?? [], depth + 1);
  return [...merged.values()].sort((a, b) => (a.displayOrder ?? Infinity) - (b.displayOrder ?? Infinity) || a.questionId - b.questionId);
}

export function flattenQuestions(questions: readonly QuestionDefinition[], parent: readonly string[] = []): QuestionEntry[] {
  return questions.flatMap(question => {
    const path = [...parent, question.fieldName ?? `#${question.questionId}`];
    return [{ path, question }, ...flattenQuestions(question.children, path)];
  });
}

/** Only metadata fields are copied; no answers, client IDs, recordsets, or staff IDs survive. */
export function buildAssessmentDefinition(input: { tenant: string; assessmentCode: string; effectiveDate?: string; mobile: unknown; generic: unknown }): AssessmentDefinition {
  const questions = mergeQuestions([input.mobile, input.generic]);
  if (!questions.length) throw new WellSkyError("protocol", "assessment metadata");
  return { tenant: input.tenant, assessmentCode: input.assessmentCode, effectiveDate: input.effectiveDate ?? null, retrievedAt: new Date().toISOString(), picklistEffectiveDate: "current", questions, unresolvedPicklists: flattenQuestions(questions).filter(({ question }) => question.questionType === "lookup" && !question.options.length).map(({ path }) => path.join("/")) };
}

export function compareDefinition(expected: DefinitionExpectation, definition: AssessmentDefinition): DefinitionDrift {
  const old = new Map(expected.questions.map(q => [JSON.stringify(q.path), q]));
  const current = new Map(flattenQuestions(definition.questions).map(q => [JSON.stringify(q.path), q]));
  const added: string[] = [], removed: string[] = [], retyped: string[] = [], newlyMandatory: string[] = [];
  for (const [key, entry] of current) {
    const previous = old.get(key);
    if (!previous) added.push(entry.path.join("/"));
    if (previous && previous.questionType !== entry.question.questionType) retyped.push(entry.path.join("/"));
    if (entry.question.mandatory === true && previous?.mandatory !== true) newlyMandatory.push(entry.path.join("/"));
  }
  for (const [key, entry] of old) if (!current.has(key)) removed.push(entry.path.join("/"));
  return { breaking: Boolean(removed.length || retyped.length || newlyMandatory.length), added, removed, retyped, newlyMandatory };
}

export function resolvePicklistOption(question: QuestionDefinition, selector: PicklistSelector): PicklistOption {
  let found = selector.code === undefined ? [] : question.options.filter(option => option.code === selector.code);
  if (!found.length && selector.name !== undefined) found = question.options.filter(option => option.name?.trim() === selector.name?.trim());
  if (found.length !== 1 || !found[0]) throw new UnknownPicklistValueError(question.fieldName ?? `#${question.questionId}`);
  return structuredClone(found[0]);
}

export class AssessmentMetadata {
  readonly #source: MetadataSource;
  readonly #tenant: string;
  readonly #ttl: number;
  readonly #max: number;
  readonly #cache = new Map<string, { expires: number; value: AssessmentDefinition }>();
  constructor(tenant: string, source: MetadataSource, ttlMs = 60_000, maxEntries = 100) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 0 || !Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new ValidationError("metadata configuration");
    this.#tenant = tenant; this.#source = source; this.#ttl = ttlMs; this.#max = maxEntries;
  }
  async getDefinition(context: AssessmentContext): Promise<AssessmentDefinition> {
    context.signal?.throwIfAborted();
    if (!Number.isSafeInteger(context.clientId) || context.clientId < 1 || !context.assessmentCode) throw new ValidationError("assessment metadata", ["clientId", "assessmentCode"]);
    const key = JSON.stringify([context.clientId, context.assessmentCode, context.effectiveDate ?? null]);
    const cached = this.#cache.get(key);
    if (!context.refresh && cached && cached.expires > Date.now()) return structuredClone(cached.value);
    const [mobile, generic] = await Promise.all([this.#source.mobile(context), this.#source.generic(context)]);
    context.signal?.throwIfAborted();
    const value = buildAssessmentDefinition({ tenant: this.#tenant, assessmentCode: context.assessmentCode, ...(context.effectiveDate === undefined ? {} : { effectiveDate: context.effectiveDate }), mobile, generic });
    this.#cache.delete(key);
    if (this.#cache.size >= this.#max) { const first = this.#cache.keys().next().value; if (first !== undefined) this.#cache.delete(first); }
    this.#cache.set(key, { expires: Date.now() + this.#ttl, value });
    return structuredClone(value);
  }
  async listQuestions(context: AssessmentContext): Promise<QuestionEntry[]> { return flattenQuestions((await this.getDefinition(context)).questions); }
  async getQuestion(context: AssessmentContext & QuestionReference): Promise<QuestionDefinition> {
    const matches = (await this.listQuestions(context)).filter(entry => entry.question.fieldName === context.fieldName && (context.parentPath === undefined || JSON.stringify(entry.path.slice(0, -1)) === JSON.stringify(context.parentPath)));
    if (matches.length !== 1 || !matches[0]) throw new ValidationError("question resolution", [context.fieldName]);
    return matches[0].question;
  }
  async listPicklists(context: AssessmentContext): Promise<PicklistDefinition[]> {
    return (await this.listQuestions(context)).filter(({ question }) => question.questionType === "lookup" || question.options.length).map(({ path, question }) => ({ picklistId: question.picklistId, questionPath: path, options: question.options, status: question.options.length ? "enumerated" : "unresolved" }));
  }
  async resolve(context: AssessmentContext & QuestionReference & PicklistSelector): Promise<PicklistOption> { return resolvePicklistOption(await this.getQuestion(context), context); }
  clearCache(): void { this.#cache.clear(); }
}
