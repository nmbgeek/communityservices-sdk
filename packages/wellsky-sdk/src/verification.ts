import { WellSkyError } from "./runtime.js";
import type { RequestOptions } from "./runtime.js";
import { AmbiguousCommitError, ValidationError } from "./errors.js";

export type ReadOutcome<T> = { kind: "found"; value: T } | { kind: "absent" } | { kind: "unknown"; error: WellSkyError };
export interface ReadBackEvidence {
  endpoint: string;
  readAt: string;
  ids: Record<string, number>;
  fields: Record<string, "match" | "absent" | "different">;
}
export interface FieldMismatch { field: string; expected: string; actual: string | null }
export interface AttemptInfo { correlationId: string; startedAt: string; durationMs: number; httpStatus?: number }
interface AttemptResult { requestHash: string; attempt: AttemptInfo }
export type WriteResult<T> =
  | (AttemptResult & { status: "verified"; committed: true; data: T; evidence: ReadBackEvidence })
  | (AttemptResult & { status: "unverified"; committed: true | "unknown"; data?: Partial<T>; mismatches?: FieldMismatch[]; evidence?: ReadBackEvidence; error?: WellSkyError })
  | (AttemptResult & { status: "failed"; committed: false; reason: "preflight" | "rejected" | "proven_absent"; error: WellSkyError });

function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || seen.has(value)) throw new ValidationError("semantic payload hash");
  seen.add(value);
  let result: string;
  // Array.from visits holes as undefined, which canonical rejects. map skips them
  // and would otherwise hash a one-hole array exactly like an empty array.
  if (Array.isArray(value)) result = `[${Array.from(value, item => canonical(item, seen)).join(",")}]`;
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new ValidationError("semantic payload hash");
    result = `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

/** Include tenant, target IDs, operation, effective date, and encoded answers in the input. */
export async function semanticHash(value: unknown, options: RequestOptions = {}): Promise<string> {
  options.signal?.throwIfAborted();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  options.signal?.throwIfAborted();
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function safeError(error: unknown, operation: string): WellSkyError {
  return error instanceof WellSkyError ? error : new WellSkyError("protocol", operation);
}

/** Absence semantics are endpoint-specific. No HTTP status means absent by default. */
export async function readOutcome<T>(reader: () => Promise<T>, options: { operation: string; isAbsent?: (value: T) => boolean; absentStatuses?: readonly number[]; signal?: AbortSignal }): Promise<ReadOutcome<T>> {
  try {
    options.signal?.throwIfAborted();
    const value = await reader();
    return options.isAbsent?.(value) ? { kind: "absent" } : { kind: "found", value };
  } catch (error) {
    const safe = safeError(error, options.operation);
    if (safe.status !== undefined && options.absentStatuses?.includes(safe.status)) return { kind: "absent" };
    return { kind: "unknown", error: safe };
  }
}

export interface ReadBackRecord<T> {
  data: T;
  ids: Record<string, number>;
  fields: Record<string, unknown>;
  /** Set only when the read proves this attempt committed, not just that an older record exists. */
  commitConfirmed?: boolean;
}
export interface VerificationPlan<T> extends RequestOptions {
  operation: string;
  readEndpoint: string;
  semanticPayload: unknown;
  expectedFields: Record<string, unknown>;
  preflight?: (options: RequestOptions) => Promise<void>;
  submit: (options: RequestOptions) => Promise<unknown>;
  readBack: (options: RequestOptions) => Promise<ReadOutcome<ReadBackRecord<T>>>;
  /** An authoritative proof supplied by an endpoint adapter, not merely an empty list or a 404. */
  proveNotCommitted?: (options: RequestOptions) => Promise<boolean>;
  mode?: "write" | "verify-only";
}

/** Sends at most once, always reads back, and never infers success or rollback from an HTTP status. */
export async function verifyWrite<T>(plan: VerificationPlan<T>): Promise<WriteResult<T>> {
  const started = Date.now();
  const correlationId = plan.correlationId ?? crypto.randomUUID();
  const context: RequestOptions = { correlationId, ...(plan.signal ? { signal: plan.signal } : {}), ...(plan.timeoutMs === undefined ? {} : { timeoutMs: plan.timeoutMs }) };
  // Hashing invalid semantic input throws before any network operation.
  const requestHash = await semanticHash(plan.semanticPayload);
  let httpStatus: number | undefined;
  const base = (): AttemptResult => ({ requestHash, attempt: { correlationId, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, ...(httpStatus === undefined ? {} : { httpStatus }) } });
  try {
    plan.signal?.throwIfAborted();
    await plan.preflight?.(context);
    if (!Object.keys(plan.expectedFields).length) throw new ValidationError(plan.operation, ["expectedFields"]);
    for (const value of Object.values(plan.expectedFields)) canonical(value);
    plan.signal?.throwIfAborted();
  } catch (error) { return { ...base(), status: "failed", committed: false, reason: "preflight", error: safeError(error, plan.operation) }; }
  let writeError: WellSkyError | undefined;
  if (plan.mode !== "verify-only") {
    try { await plan.submit(context); }
    catch (error) { writeError = safeError(error, plan.operation); httpStatus = writeError.status; }
  }
  let read: ReadOutcome<ReadBackRecord<T>>;
  try { read = await plan.readBack(context); }
  catch (error) { read = { kind: "unknown", error: safeError(error, plan.readEndpoint) }; }
  if (read.kind === "unknown") return { ...base(), status: "unverified", committed: "unknown", error: read.error };
  if (read.kind === "absent") {
    let proven = false;
    try { proven = await plan.proveNotCommitted?.(context) === true; } catch { /* An unavailable proof is not absence. */ }
    const error = writeError ?? new AmbiguousCommitError(plan.operation);
    return proven ? { ...base(), status: "failed", committed: false, reason: writeError?.status && writeError.status >= 400 && writeError.status < 500 ? "rejected" : "proven_absent", error } : { ...base(), status: "unverified", committed: "unknown", error };
  }
  const fields: ReadBackEvidence["fields"] = {};
  const mismatches: FieldMismatch[] = [];
  for (const [field, expected] of Object.entries(plan.expectedFields)) {
    const present = Object.hasOwn(read.value.fields, field);
    let equal = false;
    try { equal = present && canonical(expected) === canonical(read.value.fields[field]); } catch { /* Malformed read values cannot verify a write. */ }
    fields[field] = equal ? "match" : present ? "different" : "absent";
    if (!equal) mismatches.push({ field, expected: "[REDACTED]", actual: present ? "[REDACTED]" : null });
  }
  const evidence: ReadBackEvidence = { endpoint: plan.readEndpoint, readAt: new Date().toISOString(), ids: { ...read.value.ids }, fields };
  if (!mismatches.length) return { ...base(), status: "verified", committed: true, data: read.value.data, evidence };
  return { ...base(), status: "unverified", committed: read.value.commitConfirmed === true ? true : "unknown", data: read.value.data, mismatches, evidence, ...(writeError ? { error: writeError } : {}) };
}
