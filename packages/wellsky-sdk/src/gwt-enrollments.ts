import { AmbiguousCommitError, ValidationError } from "./errors.js";
import { correctMobileEffectiveDate } from "./effective-date.js";
import { WellSkyError } from "./runtime.js";

/** Experimental browser-session operations. REST authentication cannot implement this adapter. */
export type GwtEnrollmentIntent =
  | { kind: "add-household-members"; clientId: number; enrollmentId: number; memberClientIds: readonly number[] }
  | { kind: "create-interim-update"; clientId: number; enrollmentId: number; clientIds: readonly number[]; reviewDate: string };

/** Authoritative stored exit state for one enrollment and its complete exit subgroup. */
export interface GwtEnrollmentExit {
  clientId: number;
  enrollmentId: number;
  projectExitDate: string | null;
  destination: string | null;
  destinationCode: string | null;
  reasonForLeaving: string | null;
  reasonForLeavingCode: string | null;
  exitSubgroupId: string | null;
  /** Exact active membership of the stored exit subgroup, or the single client when unset. */
  clientIds: readonly number[];
  enrollmentIds: readonly number[];
}

export interface GwtEnrollmentSnapshot {
  source: "gwt-rpc";
  tenant: string;
  /** Non-secret identifier that changes when the authenticated session changes. */
  sessionId: string;
  /** Version/digest of the fresh enrollment model AND complete membership/review lists. */
  revision: string;
  clientId: number;
  enrollmentId: number;
  projectStartDate: string;
  /** Authoritative program context supplied by the Playwright adapter. Optional for older adapters. */
  providerId?: number;
  enrollmentType?: string;
  householdClientIds: readonly number[];
  members: readonly { clientId: number; enrollmentId: number }[];
  /** Fresh per-member exit metadata; optional only for older custom adapters. */
  exits?: readonly GwtEnrollmentExit[];
  reviews: readonly { reviewId: number; type: string; reviewDate: string; clientIds: readonly number[] }[];
}

export interface GwtPreparedEnrollmentMutation {
  intent: GwtEnrollmentIntent;
  sessionId: string;
  revision: string;
  /** Milliseconds since epoch; capture must occur during prepare(), not before it. */
  capturedAt: number;
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string;
}

export interface GwtEnrollmentSession {
  /** Perform fresh, complete GWT/UI reads. Never turn a failed/partial REST read into empty arrays. */
  readEnrollment(target: { clientId: number; enrollmentId: number }): Promise<GwtEnrollmentSnapshot>;
  /** Build from current UI models or intercept and ABORT a fresh UI request BEFORE server transmission.
   * Must verify that the serialized DTO targets exactly intent and preserves other stored values.
   * No stored request template or previously submitted payload may be returned. */
  prepare(intent: GwtEnrollmentIntent, snapshot: GwtEnrollmentSnapshot): Promise<GwtPreparedEnrollmentMutation>;
  /** Exactly one authenticated same-origin POST. No retry, redirect, token-refresh replay, or logging of payloads. */
  send(request: { url: string; headers: Readonly<Record<string, string>>; body: string }): Promise<{ status: number; body: string }>;
}

export interface GwtMutationAttempt {
  intent: GwtEnrollmentIntent;
  state: "attempted" | "verified";
}

/** The store must serialize all cooperating writers for an enrollment, and persist writes before resolving.
 * Retain attempted records after crashes/timeouts. Production implementations need a shared durable store. */
export interface GwtMutationStore {
  withLock<T>(scope: string, work: () => Promise<T>): Promise<T>;
  read(scope: string): Promise<readonly GwtMutationAttempt[]>;
  write(scope: string, attempts: readonly GwtMutationAttempt[]): Promise<void>;
}

export interface GwtEnrollmentOptions {
  tenant: string;
  /** Exact HTTPS web-app module URL, ending in /com.bowmansystems.sp5.core.ServicePoint/. */
  moduleBaseUrl: string;

  session: GwtEnrollmentSession;
  store: GwtMutationStore;
  /** Default 30 seconds, maximum 60 seconds. Includes post-capture readback time. */
  maxPayloadAgeMs?: number;
}

export interface GwtEnrollmentMutationResult {
  outcome: "already-present" | "written" | "reconciled";
  snapshot: GwtEnrollmentSnapshot;
}

export class GwtEnrollmentConflictError extends WellSkyError {
  constructor(readonly reason: "concurrent-change" | "review-conflict" | "previously-verified-missing" | "not-household-member" | "not-enrolled" | "review-before-entry") {
    super("validation", "GWT enrollment mutation");
    this.name = "GwtEnrollmentConflictError";
  }
}

const operation = "GWT enrollment mutation";
const moduleSuffix = "/com.bowmansystems.sp5.core.ServicePoint/";
const signatures = {
  "add-household-members": ["updateEntryExitWithHouseholdMembers", "com.bowmansystems.sp5.model.client.SpEntryExit/3620680162", "java.util.ArrayList/4159755760", "Z"],
  "create-interim-update": ["createEntryExitReviewWithHouseholdMembers", "com.bowmansystems.sp5.model.client.SpEntryExitReview/594863492", "java.util.ArrayList/4159755760"],
};

function id(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new ValidationError(operation, ["id"]);
  return value;
}
function ids(values: readonly number[]): number[] {
  if (!Array.isArray(values) || values.length === 0) throw new ValidationError(operation, ["clientIds"]);
  const result = [...new Set(values.map(id))].sort((a, b) => a - b);
  if (result.length !== values.length) throw new ValidationError(operation, ["clientIds"]);
  return result;
}
function instant(value: string): string {
  // Zero correction only validates/canonicalizes the instant. GWT dates are never shifted.
  return correctMobileEffectiveDate(value, 0, operation);
}
function normalize(value: GwtEnrollmentIntent): GwtEnrollmentIntent {
  const target = { clientId: id(value.clientId), enrollmentId: id(value.enrollmentId) };
  switch (value.kind) {
    case "add-household-members": {
      const memberClientIds = ids(value.memberClientIds);
      if (memberClientIds.includes(target.clientId)) throw new ValidationError(operation, ["memberClientIds"]);
      return { kind: value.kind, ...target, memberClientIds };
    }
    case "create-interim-update": {
      const clientIds = ids(value.clientIds);
      if (!clientIds.includes(target.clientId)) throw new ValidationError(operation, ["clientIds"]);
      return { kind: value.kind, ...target, clientIds, reviewDate: instant(value.reviewDate) };
    }
    default: throw new ValidationError(operation, ["kind"]);
  }
}
function key(intent: GwtEnrollmentIntent): string { return JSON.stringify(normalize(intent)); }
function protocol(): WellSkyError { return new WellSkyError("protocol", operation); }

function validateSnapshot(value: GwtEnrollmentSnapshot, intent: GwtEnrollmentIntent, tenant: string): GwtEnrollmentSnapshot {
  try {
    if (value.source !== "gwt-rpc" || value.tenant !== tenant || value.clientId !== intent.clientId || value.enrollmentId !== intent.enrollmentId || typeof value.sessionId !== "string" || !value.sessionId || typeof value.revision !== "string" || !value.revision) throw protocol();
    instant(value.projectStartDate);
    ids(value.householdClientIds);
    ids(value.members.map(m => m.clientId));
    ids(value.members.map(m => m.enrollmentId));
    if (!value.members.some(m => m.clientId === intent.clientId && m.enrollmentId === intent.enrollmentId)) throw protocol();
    if (!Array.isArray(value.reviews) || new Set(value.reviews.map(r => id(r.reviewId))).size !== value.reviews.length) throw protocol();
    for (const review of value.reviews) {
      if (typeof review.type !== "string" || !review.type) throw protocol();
      instant(review.reviewDate); const reviewClientIds = ids(review.clientIds);
      if (!reviewClientIds.includes(intent.clientId) || reviewClientIds.some(clientId => !value.members.some(m => m.clientId === clientId))) throw protocol();
    }
    return structuredClone(value);
  } catch { throw protocol(); }
}

function present(intent: GwtEnrollmentIntent, snapshot: GwtEnrollmentSnapshot): boolean {
  if (intent.kind === "add-household-members") return intent.memberClientIds.every(clientId => snapshot.members.some(m => m.clientId === clientId));
  const matches = snapshot.reviews.filter(r => r.type === "Update" && instant(r.reviewDate) === intent.reviewDate);
  if (matches.length > 1 || matches.some(r => !intent.clientIds.every(clientId => r.clientIds.includes(clientId)))) throw new GwtEnrollmentConflictError("review-conflict");
  return matches.length === 1;
}

function validateRequest(value: GwtPreparedEnrollmentMutation, intent: GwtEnrollmentIntent, snapshot: GwtEnrollmentSnapshot, moduleBaseUrl: string, startedAt: number, maxAge: number): { url: string; headers: Record<string, string>; body: string } {
  try {
    if (key(value.intent) !== key(intent) || value.sessionId !== snapshot.sessionId || value.revision !== snapshot.revision) throw protocol();
    if (!Number.isFinite(value.capturedAt) || value.capturedAt < startedAt || value.capturedAt > Date.now() || Date.now() - value.capturedAt > maxAge) throw protocol();
    if (value.url !== `${moduleBaseUrl}service/ClientService` || typeof value.body !== "string" || value.body.length > 2_000_000 || !value.body.endsWith("|")) throw protocol();
    const headers: Record<string, string> = {};
    for (const [name, content] of Object.entries(value.headers)) {
      const lower = name.toLowerCase();
      if (!["content-type", "x-gwt-module-base", "x-gwt-permutation"].includes(lower) || lower in headers || typeof content !== "string" || /[\r\n]/.test(content)) throw protocol();
      headers[lower] = content;
    }
    if (!/^text\/x-gwt-rpc(?:;\s*charset=utf-8)?$/i.test(headers["content-type"] ?? "") || headers["x-gwt-module-base"] !== moduleBaseUrl || !/^[A-F0-9]{32}$/i.test(headers["x-gwt-permutation"] ?? "")) throw protocol();
    const tokens = value.body.split("|"), count = Number(tokens[2]);
    if (tokens[0] !== "7" || tokens[1] !== "0" || !Number.isSafeInteger(count) || count < 5 || count > 10_000 || tokens.length <= count + 10) throw protocol();
    const strings = tokens.slice(3, 3 + count), data = tokens.slice(3 + count);
    const stringAt = (index: string | undefined) => index && /^[1-9]\d*$/.test(index) ? strings[Number(index) - 1] : undefined;
    let expected = signatures[intent.kind];
    // The UI uses this one-parameter RPC for a client with no household members.
    // Never treat it as a shortcut for a household review or a selected subset.
    if (stringAt(data[3]) === "createEntryExitReview") {
      if (intent.kind !== "create-interim-update" || intent.clientIds.length !== 1 || intent.clientIds[0] !== intent.clientId ||
          snapshot.members.length !== 1 || snapshot.members[0]?.clientId !== intent.clientId || snapshot.members[0]?.enrollmentId !== intent.enrollmentId ||
          snapshot.householdClientIds.length !== 1 || snapshot.householdClientIds[0] !== intent.clientId) throw protocol();
      expected = ["createEntryExitReview", "com.bowmansystems.sp5.model.client.SpEntryExitReview/594863492"];
    }
    if (stringAt(data[0]) !== moduleBaseUrl || !/^[A-F0-9]{32}$/i.test(stringAt(data[1]) ?? "") || stringAt(data[2]) !== "com.bowmansystems.sp5.core.client.services.GenericService" || stringAt(data[3]) !== expected[0] || data[4] !== String(expected.length - 1) || expected.slice(1).some((type, index) => stringAt(data[5 + index]) !== type)) throw protocol();
    return { url: value.url, headers, body: value.body };
  } catch { throw protocol(); }
}

/** Browser-session helper with read-before-write, freshness checks and no automatic write retries.
 * The adapter owns GWT model serialization and complete authoritative reads. This is not a REST fallback. */
export class GwtEnrollmentHelpers {
  readonly #options: GwtEnrollmentOptions;
  readonly #maxAge: number;
  constructor(options: GwtEnrollmentOptions) {
    const url = new URL(options.moduleBaseUrl);
    if (!/^[A-Za-z0-9_-]+$/.test(options.tenant) || url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== `/${options.tenant}${moduleSuffix}` || url.href !== options.moduleBaseUrl) throw new ValidationError(operation, ["configuration"]);
    this.#maxAge = options.maxPayloadAgeMs ?? 30_000;
    if (!Number.isSafeInteger(this.#maxAge) || this.#maxAge < 1 || this.#maxAge > 60_000) throw new ValidationError(operation, ["maxPayloadAgeMs"]);
    this.#options = { ...options };
  }

  get tenant(): string { return this.#options.tenant; }
  get moduleBaseUrl(): string { return this.#options.moduleBaseUrl; }

  addHouseholdMembers(input: Omit<Extract<GwtEnrollmentIntent, { kind: "add-household-members" }>, "kind">): Promise<GwtEnrollmentMutationResult> {
    return this.#execute(normalize({ ...input, kind: "add-household-members" }));
  }
  createInterimUpdate(input: Omit<Extract<GwtEnrollmentIntent, { kind: "create-interim-update" }>, "kind">): Promise<GwtEnrollmentMutationResult> {
    return this.#execute(normalize({ ...input, kind: "create-interim-update" }));
  }

  async #read(intent: GwtEnrollmentIntent): Promise<GwtEnrollmentSnapshot> {
    try {
      return validateSnapshot(await this.#options.session.readEnrollment({ clientId: intent.clientId, enrollmentId: intent.enrollmentId }), intent, this.#options.tenant);
    } catch { throw protocol(); }
  }

  async #execute(intent: GwtEnrollmentIntent): Promise<GwtEnrollmentMutationResult> {
    const { store, session, tenant, moduleBaseUrl } = this.#options;
    // Enrollment-wide lock also prevents overlapping member lists and different review intents racing.
    const scope = JSON.stringify([moduleBaseUrl, tenant, intent.enrollmentId]);
    return store.withLock(scope, async () => {
      let snapshot = await this.#read(intent);
      let attempts: GwtMutationAttempt[];
      try {
        attempts = (await store.read(scope)).map(a => {
          if (!["attempted", "verified"].includes(a.state) || a.intent.clientId !== intent.clientId || a.intent.enrollmentId !== intent.enrollmentId) throw protocol();
          return { intent: normalize(a.intent), state: a.state };
        });
      } catch { throw protocol(); }
      // An uncertain earlier request blocks ALL further writes to this enrollment until reconciled.
      for (const attempt of attempts) {
        if (attempt.state !== "attempted") continue;
        try { if (!present(attempt.intent, snapshot)) throw protocol(); } catch { throw new AmbiguousCommitError(operation); }
        attempt.state = "verified";
        await store.write(scope, structuredClone(attempts));
      }
      const previous = attempts.find(a => key(a.intent) === key(intent));
      if (present(intent, snapshot)) {
        // Adopting existing state is also a durable decision. A later missing
        // record must not turn the same operation into permission to recreate it.
        if (!previous) {
          attempts.push({ intent, state: "verified" });
          await store.write(scope, structuredClone(attempts));
        }
        return { outcome: previous ? "reconciled" : "already-present", snapshot };
      }
      if (previous) throw new GwtEnrollmentConflictError("previously-verified-missing");
      if (intent.kind === "add-household-members") {
        if (intent.memberClientIds.some(clientId => !snapshot.householdClientIds.includes(clientId))) throw new GwtEnrollmentConflictError("not-household-member");
      } else {
        if (intent.clientIds.some(clientId => !snapshot.members.some(m => m.clientId === clientId))) throw new GwtEnrollmentConflictError("not-enrolled");
        if (Date.parse(intent.reviewDate) < Date.parse(snapshot.projectStartDate)) throw new GwtEnrollmentConflictError("review-before-entry");
      }
      const startedAt = Date.now();
      let prepared: GwtPreparedEnrollmentMutation;
      try { prepared = structuredClone(await session.prepare(structuredClone(intent), structuredClone(snapshot))); } catch { throw protocol(); }
      validateRequest(prepared, intent, snapshot, moduleBaseUrl, startedAt, this.#maxAge);
      const latest = await this.#read(intent);
      if (latest.sessionId !== snapshot.sessionId || latest.revision !== snapshot.revision) throw new GwtEnrollmentConflictError("concurrent-change");
      snapshot = latest;
      const request = validateRequest(prepared, intent, snapshot, moduleBaseUrl, startedAt, this.#maxAge);
      attempts.push({ intent, state: "attempted" });
      await store.write(scope, structuredClone(attempts)); // Must be durable BEFORE send.
      let acknowledged = false;
      try {
        validateRequest(prepared, intent, snapshot, moduleBaseUrl, startedAt, this.#maxAge);
        const response = await session.send(request); // Exactly one call, even on network/auth errors.
        acknowledged = response.status === 200 && response.body.startsWith("//OK[");
      } catch { /* The server may have committed; authoritative readback decides. */ }
      try {
        snapshot = await this.#read(intent);
        if (!present(intent, snapshot)) throw protocol();
        attempts[attempts.length - 1] = { intent, state: "verified" };
        await store.write(scope, structuredClone(attempts));
      } catch { throw new AmbiguousCommitError(operation); }
      return { outcome: acknowledged ? "written" : "reconciled", snapshot };
    });
  }
}

/** Development only: serializes callers sharing THIS instance. Does not survive process restarts.
 * Pass a durable shared implementation of GwtMutationStore for real integrations. */
export function createInMemoryGwtMutationStore(): GwtMutationStore {
  const records = new Map<string, readonly GwtMutationAttempt[]>();
  const queues = new Map<string, Promise<void>>();
  return {
    async withLock(scope, work) {
      const previous = queues.get(scope) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>(resolve => { release = resolve; });
      queues.set(scope, current);
      await previous;
      try { return await work(); } finally { release(); if (queues.get(scope) === current) queues.delete(scope); }
    },
    async read(scope) { return structuredClone(records.get(scope) ?? []); },
    async write(scope, attempts) { records.set(scope, structuredClone(attempts)); },
  };
}
