import type { PicklistOption, PicklistSelector, QuestionDefinition } from "./metadata.js";
import { resolvePicklistOption } from "./metadata.js";
import { ValidationError } from "./errors.js";
import { resolveRaceCombination } from "./race.js";

export type AnswerState = "client_doesnt_know" | "client_refused" | "data_not_collected";
export type AnswerValue = { value: string | number | boolean | string[] } | { state: AnswerState } | { option: PicklistSelector } | { options: readonly PicklistSelector[] };
export type Answers = Record<string, AnswerValue>;
export interface EncodingOptions {
  endpoint: "standalone" | "enrollment" | "mobile";
  /** Tenant-verified display labels, including exact whitespace/HUD suffixes, for label-based endpoints. */
  writeLabel?: (question: QuestionDefinition, option: PicklistOption) => string | undefined;
  /** Application configuration supplies the relevant option codes. No answer-state labels are guessed. */
  stateCodes?: Partial<Record<AnswerState, readonly string[]>>;
  multiValue?: (question: QuestionDefinition, values: readonly string[]) => string;
}
export interface EncodedQuestion {
  question_id: number;
  question_type: string;
  virt_field_name: string;
  answer_value: string;
}

function encodeValue(question: QuestionDefinition, answer: AnswerValue, options: EncodingOptions): string | undefined {
  const field = question.fieldName ?? `#${question.questionId}`;
  if (["label", "blank", "sub_assessment"].includes(question.questionType)) throw new ValidationError("assessment encoding", [field]);
  if (question.questionType === "provider" && options.endpoint === "mobile") throw new ValidationError("mobile provider answers are unsupported", [field]);
  if ("state" in answer) {
    if (question.questionType !== "lookup") return undefined;
    const codes = options.stateCodes?.[answer.state];
    if (!codes) throw new ValidationError("answer-state code configuration required", [field]);
    const found = question.options.filter(option => option.code !== null && codes.includes(option.code));
    if (!found.length) return undefined;
    if (found.length !== 1 || !found[0]) throw new ValidationError("ambiguous answer-state option", [field]);
    const option = question.fieldName === "HUD_RACEETHNICITY" && found[0].code !== null
      ? resolveRaceCombination(question, [{ code: found[0].code }]) : found[0];
    return lookupLabel(question, option, options);
  }
  if (question.questionType === "lookup") {
    if (question.fieldName === "HUD_RACEETHNICITY") {
      const selectors = "options" in answer ? answer.options : "option" in answer ? [answer.option]
        : typeof answer.value === "string" ? [{ name: answer.value }]
        : Array.isArray(answer.value) ? answer.value.map(name => ({ name })) : undefined;
      if (!selectors) throw new ValidationError("race requires category selectors", [field]);
      return lookupLabel(question, resolveRaceCombination(question, selectors), options);
    }
    if ("options" in answer) throw new ValidationError("multiple options require a supported combination field", [field]);
    if ("option" in answer) return lookupLabel(question, resolvePicklistOption(question, answer.option), options);
    if (typeof answer.value !== "string") throw new ValidationError("lookup requires a code or name selector", [field]);
    return lookupLabel(question, resolvePicklistOption(question, { name: answer.value }), options);
  }
  if (!("value" in answer)) throw new ValidationError("picklist selector on a non-lookup question", [field]);
  const value = answer.value;
  if (Array.isArray(value)) {
    if (!options.multiValue) throw new ValidationError("multi-value encoding requires an explicit encoder", [field]);
    return options.multiValue(question, value);
  }
  switch (question.questionType) {
    case "yes_no":
      if (value === true || value === "Yes") return "Yes";
      if (value === false || value === "No") return "No";
      throw new ValidationError("yes_no encoding", [field]);
    case "int": case "provider":
      if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isSafeInteger(Number(value))) throw new ValidationError("integer encoding", [field]);
      return String(value);
    case "money":
      if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isFinite(Number(value))) throw new ValidationError("money encoding", [field]);
      return String(value);
    case "date": case "textbox": case "textarea": return String(value);
    default: throw new ValidationError("unsupported question type", [field]);
  }
}

function lookupLabel(question: QuestionDefinition, option: PicklistOption, options: EncodingOptions): string {
  if (options.endpoint === "mobile") return String(option.id);
  const label = options.writeLabel?.(question, option);
  if (!label) throw new ValidationError("verified lookup write label required", [question.fieldName ?? `#${question.questionId}`]);
  return label;
}

export function encodeAnswers(questions: readonly QuestionDefinition[], answers: Answers, options: EncodingOptions): EncodedQuestion[] {
  const index = new Map<string, QuestionDefinition>();
  for (const question of questions) if (question.fieldName) {
    if (index.has(question.fieldName)) throw new ValidationError("ambiguous question field", [question.fieldName]);
    index.set(question.fieldName, question);
  }
  const unknown = Object.keys(answers).filter(field => !index.has(field));
  if (unknown.length) throw new ValidationError("unknown assessment fields", unknown);
  const result: EncodedQuestion[] = [];
  for (const [field, answer] of Object.entries(answers)) {
    const question = index.get(field);
    if (!question) throw new ValidationError("unknown assessment fields", [field]);
    const value = encodeValue(question, answer, options);
    if (value !== undefined) result.push({ question_id: question.questionId, question_type: question.questionType, virt_field_name: field, answer_value: value });
  }
  return result;
}

/** Builds one new row only. Never accepts or echoes an existing recordset ID. */
export function encodeNewSubassessmentRow(parent: QuestionDefinition, answers: Answers, options: EncodingOptions): { subAssessments: EncodedQuestion[] } {
  if (parent.questionType !== "sub_assessment") throw new ValidationError("subassessment parent required");
  const encoded = encodeAnswers(parent.children, answers, options);
  const included = new Set(encoded.map(q => q.virt_field_name));
  for (const question of parent.children) {
    if (!question.fieldName || included.has(question.fieldName) || ["label", "blank", "yes_no"].includes(question.questionType)) continue;
    if (question.questionType === "provider" && options.endpoint === "mobile") throw new ValidationError("mobile provider answers are unsupported", [question.fieldName]);
    encoded.push({ question_id: question.questionId, question_type: question.questionType, virt_field_name: question.fieldName, answer_value: "" });
  }
  return { subAssessments: encoded };
}
