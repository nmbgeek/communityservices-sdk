import type { PicklistOption, PicklistSelector, QuestionDefinition } from "./metadata.js";
import { resolvePicklistOption } from "./metadata.js";
import { ValidationError } from "./errors.js";

const categories = ["AIAN", "ASN", "AFR", "HSP", "MES", "PI", "WHI"];
const missing = new Map([["DONTKNOW", "DK"], ["REFUSE", "R"], ["DNC", "DNC"], ["DK", "DK"], ["R", "R"]]);

/** HUD race is stored as one combination option, including single-category answers. */
export function resolveRaceCombination(question: QuestionDefinition, selectors: readonly PicklistSelector[]): PicklistOption {
  const field = question.fieldName ?? "HUD_RACEETHNICITY";
  if (!selectors.length) throw new ValidationError("race selection must not be empty", [field]);
  const combinations = question.options.filter(option => option.code?.startsWith("RACE_ETH_COMBO_"));
  const selected = new Set<string>();
  for (const selector of selectors) {
    // Names can occur twice in metadata. Only the combination entry is a writable answer.
    const option = selector.code === undefined
      ? resolvePicklistOption({ ...question, options: combinations }, selector)
      : resolvePicklistOption(question, { code: selector.code });
    const code = option.code;
    if (!code?.startsWith("RACE_ETH_")) throw new ValidationError("unsupported race option", [field]);
    const suffix = code.slice(code.startsWith("RACE_ETH_COMBO_") ? "RACE_ETH_COMBO_".length : "RACE_ETH_".length);
    const missingCode = missing.get(suffix);
    if (missingCode) selected.add(missingCode);
    else for (const category of suffix.split("_")) {
      if (!categories.includes(category)) throw new ValidationError("unsupported race option", [field]);
      selected.add(category);
    }
  }
  const absent = [...selected].filter(code => !categories.includes(code));
  if (absent.length && selected.size !== 1) throw new ValidationError("race categories cannot be mixed with missing-answer states", [field]);
  const suffix = absent.length ? absent[0] : categories.filter(code => selected.has(code)).join("_");
  return resolvePicklistOption({ ...question, options: combinations }, { code: `RACE_ETH_COMBO_${suffix}` });
}
