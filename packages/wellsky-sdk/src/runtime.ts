/** Matching credentials/providers share cached authentication in-process. No environment or disk reads. */
export type Authentication =
  | { kind: "credentials"; username: string; password: string }
  | { kind: "token"; token: string }
  | { kind: "provider"; getToken: (context: { forceRefresh: boolean; signal: AbortSignal }) => string | Promise<string> }
  | { kind: "none" };

export interface ClientOptions {
  tenant: string;
  auth: Authentication;

  maxConcurrency?: number;
  cooldown?: { threshold: number; windowMs: number; durationMs: number };
  hooks?: ClientHooks;
  /** Receives the same allowlisted events as hooks. No raw request/response data. */
  logger?: (event: ClientEvent) => void;
  metadataCacheTtlMs?: number;
  metadataCacheMaxEntries?: number;
  /** Opt-in correction for a measured upstream mobile assessment dateEffective shift.
   * Added to the requested instant on POST AddAssessmentAnswer only. No default timezone is assumed.
   * Revalidate against saved effective dates when the server's offset changes. */
  mobileAssessmentDateCorrectionMinutes?: number;
  /** Defaults to the public production API URL. Supply the target environment explicitly when needed. */
  baseUrl?: string;
  /** Inject a fetch-compatible transport for tests or network routing. */
  fetch?: typeof globalThis.fetch;
  /** Total request deadline including auth, read retries, and backoff. Default 30 seconds. */
  timeoutMs?: number;
  /** Additional attempts for GET only. Default 2; writes are never replayed. */
  maxReadRetries?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  correlationId?: string;
}

export interface ClientEvent {
  type: "request" | "response" | "tokenMint" | "throttle" | "cooldown";
  operation: string;
  correlationId: string;
  retryCount: number;
  durationMs?: number;
  status?: number;
  retryAfterMs?: number;
  until?: string;
}
export interface ClientHooks {
  onRequest?: (event: ClientEvent) => void;
  onResponse?: (event: ClientEvent) => void;
  onTokenMint?: (event: ClientEvent) => void;
  onThrottle?: (event: ClientEvent) => void;
  onCooldown?: (event: ClientEvent) => void;
}
export interface ClientHealth {
  state: "closed" | "open";
  until: string | null;
  activeRequests: number;
  queuedRequests: number;
  tokenMintCount: number;
}

export interface PaginationOptions {
  /** Safety limit. Reaching it throws rather than silently returning partial data. Default 10,000. */
  maxPages?: number;
}

export interface ODataCollection<T> {
  value: T[];
  "@odata.count"?: number;
  "@odata.nextLink"?: string;
}

/** WellSky's total_count response. Count covers the result set, not just this page. */
export interface CountedCollection<T> {
  count: number;
  values: T[];
}

/** WellSky may return an object, an array, or either collection envelope for the same model. */
export type ApiResponse<T> = T | T[] | ODataCollection<T> | CountedCollection<T> | null;

export function toItems<T>(response: ApiResponse<T>): T[] {
  if (response === null) return [];
  if (Array.isArray(response)) return response;
  if (typeof response === "object" && "value" in response && Array.isArray(response.value)) {
    return response.value;
  }
  if (typeof response === "object" && "count" in response && "values" in response && Array.isArray(response.values)) {
    return response.values;
  }
  // The envelope branch above has been checked at the boundary.
  return [response as T];
}

export type ErrorKind = "http" | "network" | "timeout" | "aborted" | "validation" | "protocol" | "pagination" | "tenant_mismatch" | "auth" | "throttled" | "cooldown" | "ambiguous_commit" | "definition_drift" | "unknown_picklist_value";

/** Deliberately contains no credentials, query values, response bodies, or client IDs. */
export class WellSkyError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | undefined;
  readonly operation: string;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  correlationId: string | undefined;

  constructor(kind: ErrorKind, operation: string, details: { status?: number; requestId?: string; retryAfterMs?: number } = {}) {
    super(`WellSky ${operation}: ${kind}${details.status === undefined ? "" : ` (HTTP ${details.status})`}`);
    this.name = "WellSkyError";
    this.kind = kind;
    this.operation = operation;
    this.status = details.status;
    this.requestId = details.requestId;
    this.retryAfterMs = details.retryAfterMs;
  }
}
