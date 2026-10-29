import { WellSkyError } from "./runtime.js";

export class TenantMismatchError extends WellSkyError {
  constructor(operation: string) { super("tenant_mismatch", operation); this.name = "TenantMismatchError"; }
}
export class AuthError extends WellSkyError {
  constructor(operation: string, status?: number) { super("auth", operation, status === undefined ? {} : { status }); this.name = "AuthError"; }
}
export class ThrottledError extends WellSkyError {
  constructor(operation: string, retryAfterMs: number, status = 429, requestId?: string) { super("throttled", operation, { status, retryAfterMs, ...(requestId === undefined ? {} : { requestId }) }); this.name = "ThrottledError"; }
}
export class CooldownError extends WellSkyError {
  readonly until: string;
  constructor(operation: string, until: number) { super("cooldown", operation); this.name = "CooldownError"; this.until = new Date(until).toISOString(); }
}
export class ValidationError extends WellSkyError {
  readonly fields: readonly string[];
  constructor(operation: string, fields: readonly string[] = []) { super("validation", operation); this.name = "ValidationError"; this.fields = [...fields]; }
}
export class UpstreamError extends WellSkyError {
  constructor(operation: string, status: number, requestId?: string, retryAfterMs?: number) { super("http", operation, { status, ...(requestId === undefined ? {} : { requestId }), ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }); this.name = "UpstreamError"; }
}
export class AmbiguousCommitError extends WellSkyError {
  constructor(operation: string) { super("ambiguous_commit", operation); this.name = "AmbiguousCommitError"; }
}
export class DefinitionDriftError extends WellSkyError {
  readonly fields: readonly string[];
  constructor(fields: readonly string[]) { super("definition_drift", "assessment metadata"); this.name = "DefinitionDriftError"; this.fields = [...fields]; }
}
export class UnknownPicklistValueError extends WellSkyError {
  readonly field: string;
  constructor(field: string) { super("unknown_picklist_value", "picklist resolution"); this.name = "UnknownPicklistValueError"; this.field = field; }
}
