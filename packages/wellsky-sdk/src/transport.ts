import { WellSkyError, toItems } from "./runtime.js";
import type { ApiResponse, Authentication, ClientOptions, PaginationOptions, RequestOptions } from "./runtime.js";
import { decodeResponse, isRecord, matches } from "./validation.js";
import type { OperationDefinition, SchemaRegistry } from "./validation.js";
import { AuthError, TenantMismatchError, ThrottledError, UpstreamError, ValidationError } from "./errors.js";
import { emit, identity, requestControl, sharedAuthentication, tokenMintQueue } from "./control.js";
import type { RequestControl, SharedAuthentication } from "./control.js";
import type { ClientEvent, ClientHealth } from "./runtime.js";
import { correctMobileEffectiveDate } from "./effective-date.js";

interface Arguments extends RequestOptions {
  path?: object;
  query?: object;
  body?: unknown;
}
const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);

function positiveInteger(value: number, name: string, minimum = 1): number {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} must be an integer >= ${minimum}`);
  return value;
}

function expiry(token: string): number {
  try {
    const part = token.split(".")[1];
    if (!part) return 0;
    const base64 = part.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return isRecord(parsed) && typeof parsed.exp === "number" && Number.isFinite(parsed.exp) ? parsed.exp * 1000 : 0;
  } catch { return 0; }
}

function retryAfter(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(raw) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : undefined;
}

function abortError(signal: AbortSignal, operation: string): WellSkyError {
  return new WellSkyError(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "timeout" : "aborted", operation);
}

/** A caller can cancel its wait without cancelling authentication shared by other callers. */
function withSignal<T>(promise: Promise<T>, signal: AbortSignal, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError(signal, operation));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function delay(ms: number, signal: AbortSignal, operation: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(abortError(signal, operation)); return; }
    const abort = () => { clearTimeout(timer); reject(abortError(signal, operation)); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export class Transport {
  readonly #baseUrl: string;
  readonly #tenant: string;
  readonly #version: string;
  readonly #auth: Authentication;
  readonly #fetch: typeof globalThis.fetch;
  readonly #schemas: SchemaRegistry;
  readonly #timeout: number;
  readonly #retries: number;
  readonly #retryBase: number;
  readonly #retryMax: number;
  readonly #shared: Promise<SharedAuthentication>;
  readonly #control: RequestControl;
  readonly #observers: Pick<ClientOptions, "hooks" | "logger">;
  readonly #mobileDateCorrection: number | undefined;

  constructor(options: ClientOptions, version: string, schemas: SchemaRegistry) {
    if (typeof window !== "undefined" || !("process" in globalThis)) throw new TypeError("WellSky SDK requires a server-side Node.js runtime");
    if (!options.tenant.trim() || /[\r\n]/.test(options.tenant)) throw new TypeError("tenant is required and must be a valid header value");
    const url = new URL(options.baseUrl ?? "https://csclientapi.wellsky.com/client-api-prod");
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new TypeError("baseUrl must be an HTTP(S) URL without credentials, query, or fragment");
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new TypeError("Use HTTPS except for loopback testing");
    if (options.auth.kind === "credentials" && (!options.auth.username.trim() || !options.auth.password)) throw new TypeError("username and password are required");
    if (options.auth.kind === "token" && (!options.auth.token.trim() || /\s/.test(options.auth.token))) throw new TypeError("token must be a non-empty bearer token");
    this.#baseUrl = url.toString().replace(/\/$/, "");
    this.#tenant = options.tenant;
    this.#version = version;
    this.#auth = { ...options.auth };
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#schemas = schemas;
    const correction = options.mobileAssessmentDateCorrectionMinutes;
    if (correction !== undefined && (!Number.isSafeInteger(correction) || Math.abs(correction) > 840)) throw new ValidationError("client configuration", ["mobileAssessmentDateCorrectionMinutes"]);
    this.#mobileDateCorrection = correction;
    this.#timeout = positiveInteger(options.timeoutMs ?? 30_000, "timeoutMs");
    this.#retries = positiveInteger(options.maxReadRetries ?? 2, "maxReadRetries", 0);
    this.#retryBase = positiveInteger(options.retryBaseDelayMs ?? 250, "retryBaseDelayMs", 0);
    this.#retryMax = positiveInteger(options.maxRetryDelayMs ?? 30_000, "maxRetryDelayMs", 0);
    const scope = JSON.stringify([this.#baseUrl, this.#tenant, identity(this.#fetch)]);
    this.#control = requestControl(scope, options);
    this.#shared = sharedAuthentication(scope, this.#auth);
    this.#observers = { ...(options.hooks ? { hooks: { ...options.hooks } } : {}), ...(options.logger ? { logger: options.logger } : {}) };
    if (this.#auth.kind === "token") this.#checkTokenTenant(this.#auth.token);
  }

  get tenant(): string { return this.#tenant; }
  get baseUrl(): string { return this.#baseUrl; }
  health(): ClientHealth { return this.#control.health(); }

  #checkTenant(value: unknown, operation: string): void {
    if (!isRecord(value)) return;
    for (const key of ["tenant", "tenantCode", "tenant_code", "x-tenant"]) {
      if (value[key] !== undefined && value[key] !== null && value[key] !== this.#tenant) throw new TenantMismatchError(operation);
    }
  }
  #checkTokenTenant(token: string): void {
    let payload: unknown;
    try {
      const segment = token.split(".")[1];
      if (!segment) return;
      const base64 = segment.replaceAll("-", "+").replaceAll("_", "/");
      payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    } catch { return; }
    this.#checkTenant(payload, "authentication token");
  }

  async #send(url: string | URL, init: RequestInit & { signal: AbortSignal }, operation: string, correlationId: string, retryCount: number): Promise<Response> {
    this.#control.check(operation);
    const release = await this.#control.semaphore.acquire(init.signal, operation);
    const started = Date.now();
    const base = { operation, correlationId, retryCount };
    try {
      this.#control.check(operation);
      const headers = new Headers(init.headers);
      headers.set("x-correlation-id", correlationId);
      emit(this.#observers, { ...base, type: "request" });
      const response = await this.#fetch(url, { ...init, headers });
      const event: ClientEvent = { ...base, type: "response", status: response.status, durationMs: Date.now() - started };
      emit(this.#observers, event);
      if (response.status === 429) emit(this.#observers, { ...event, type: "throttle", retryAfterMs: retryAfter(response.headers) ?? this.#retryBase });
      const until = this.#control.failed(response.status);
      if (until !== undefined) emit(this.#observers, { ...base, type: "cooldown", until: new Date(until).toISOString() });
      if (response.headers.has("x-tenant") && response.headers.get("x-tenant") !== this.#tenant) {
        await response.body?.cancel(); throw new TenantMismatchError(operation);
      }
      // Hold the concurrency slot through body consumption, not merely until headers arrive.
      const body = await response.arrayBuffer();
      return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } finally { release(); }
  }

  #headers(token?: string): Headers {
    const headers = new Headers({ Accept: "application/json", "x-tenant": this.#tenant, "x-version": this.#version });
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return headers;
  }

  async #read(response: Response, operation: string, allowText = false): Promise<unknown> {
    if (!response.ok) {
      // Discard upstream error content; it may contain client data or credentials.
      await response.body?.cancel();
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? undefined;
      const wait = retryAfter(response.headers);
      if (response.status === 429) throw new ThrottledError(operation, wait ?? this.#retryBase, response.status, requestId);
      if (response.status === 401 || response.status === 403) throw new AuthError(operation, response.status);
      throw new UpstreamError(operation, response.status, requestId, wait);
    }
    const text = await response.text();
    if (!text.trim()) return null;
    let value: unknown;
    try { value = JSON.parse(text); }
    catch {
      if (allowText) return text;
      throw new WellSkyError("protocol", operation);
    }
    this.#checkTenant(value, operation);
    return value;
  }

  async #mint(forceRefresh: boolean, shared: SharedAuthentication): Promise<string> {
    const operation = "POST /authentication/SetAuthKey";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Deadline exceeded", "TimeoutError")), this.#timeout);
    const signal = controller.signal;
    let release: (() => void) | undefined;
    try {
      release = await tokenMintQueue.acquire(signal, operation);
      this.#control.check(operation);
      const correlationId = crypto.randomUUID();
      this.#control.tokenMintCount++;
      emit(this.#observers, { type: "tokenMint", operation, correlationId, retryCount: 0 });
      let token: unknown;
      if (this.#auth.kind === "provider") token = await withSignal(Promise.resolve().then(() => this.#auth.kind === "provider" ? this.#auth.getToken({ forceRefresh, signal }) : ""), signal, operation);
      else if (this.#auth.kind === "credentials") {
        const headers = this.#headers();
        headers.set("Content-Type", "application/json");
        const response = await this.#send(`${this.#baseUrl}/authentication/SetAuthKey`, {
          method: "POST", headers, body: JSON.stringify({ username: this.#auth.username, password: this.#auth.password }), signal, redirect: "error", cache: "no-store",
        }, operation, correlationId, 0);
        const result = await this.#read(response, operation);
        token = isRecord(result) ? result.token : undefined;
      }
      if (typeof token !== "string" || !token || /\s/.test(token)) throw new WellSkyError("protocol", operation);
      this.#checkTokenTenant(token);
      const expiresAt = expiry(token);
      if (expiresAt !== 0 && expiresAt <= Date.now()) throw new WellSkyError("protocol", operation);
      shared.cached = { token, expiresAt };
      return token;
    } catch (error) {
      if (signal.aborted) throw abortError(signal, operation);
      if (error instanceof WellSkyError) throw error;
      throw new WellSkyError("network", operation);
    } finally { release?.(); clearTimeout(timer); }
  }

  async #token(rejectedToken?: string): Promise<string | undefined> {
    if (this.#auth.kind === "none") return Promise.resolve(undefined);
    if (this.#auth.kind === "token") return Promise.resolve(this.#auth.token);
    const shared = await this.#shared;
    // An older request's late 401 must not evict a newer token.
    if (rejectedToken && shared.cached?.token !== rejectedToken && shared.cached) return shared.cached.token;
    if (shared.inFlight) return shared.inFlight;
    if (!rejectedToken && shared.cached && shared.cached.expiresAt > Date.now() + 120_000) return shared.cached.token;
    shared.cached = undefined;
    shared.inFlight = this.#mint(Boolean(rejectedToken), shared).finally(() => { shared.inFlight = undefined; });
    return shared.inFlight;
  }

  async execute<T>(definition: OperationDefinition, args: Arguments): Promise<T> {
    const operation = `${definition.method} ${definition.path}`;
    const correlationId = args.correlationId ?? crypto.randomUUID();
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(correlationId)) throw new ValidationError(operation, ["correlationId"]);
    const timeout = positiveInteger(args.timeoutMs ?? this.#timeout, "timeoutMs");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Deadline exceeded", "TimeoutError")), timeout);
    const signal = args.signal ? AbortSignal.any([args.signal, controller.signal]) : controller.signal;
    try {
      if (signal.aborted) throw abortError(signal, operation);
      this.#control.check(operation);
      if (!matches(args.path ?? {}, definition.pathSchema, this.#schemas, "request") || !matches(args.query ?? {}, definition.querySchema, this.#schemas, "request") || (definition.bodySchema && !matches(args.body, definition.bodySchema, this.#schemas, "request"))) throw new ValidationError(operation);
      // Check file bytes before multipart construction or credential authentication.
      if (definition.multipart && isRecord(args.body) && args.body.fileData instanceof Blob && args.body.fileData.size > 10_000_000) throw new ValidationError(operation, ["fileData"]);
      const pathValues = new Map(Object.entries(args.path ?? {}));
      const path = definition.path.replace(/\{([^}]+)\}/g, (_, name: string) => {
        const value = String(pathValues.get(name));
        if (value === "." || value === "..") throw new WellSkyError("validation", operation);
        return encodeURIComponent(value);
      });
      const url = new URL(this.#baseUrl + path);
      for (const [name, value] of Object.entries(args.query ?? {})) {
        if (value !== undefined && value !== null) {
          const encoded = this.#mobileDateCorrection !== undefined && name === "dateEffective" && operation === "POST /assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}"
            ? correctMobileEffectiveDate(value, this.#mobileDateCorrection, operation) : String(value);
          url.searchParams.set(name, encoded);
        }
      }
      let body: string | FormData | undefined;
      if (definition.multipart && isRecord(args.body)) {
        body = new FormData();
        for (const [name, value] of Object.entries(args.body)) {
          if (value !== undefined && value !== null) body.append(name, value instanceof Blob ? value : String(value));
        }
      } else if (args.body !== undefined) body = JSON.stringify(args.body);
      let token = definition.authenticated ? await withSignal(this.#token(), signal, operation) : undefined;
      let refreshed = false;
      let attempts = 0;
      while (true) {
        try {
          const headers = this.#headers(token);
          if (typeof body === "string") headers.set("Content-Type", "application/json");
          const response = await this.#send(url, { method: definition.method, headers, ...(body === undefined ? {} : { body }), signal, redirect: "error", cache: "no-store" }, operation, correlationId, attempts);
          // Reads can refresh once. Writes are never automatically sent twice, even after a 401.
          if (response.status === 401 && definition.method === "GET" && definition.authenticated && !refreshed && (this.#auth.kind === "credentials" || this.#auth.kind === "provider")) {
            await response.body?.cancel();
            refreshed = true;
            token = await withSignal(this.#token(token), signal, operation);
            continue;
          }
          const result = await this.#read(response, operation, definition.responseSchema === undefined);
          return decodeResponse<T>(result, definition.responseSchema, this.#schemas, operation);
        } catch (error) {
          if (signal.aborted) throw abortError(signal, operation);
          const failure = error instanceof WellSkyError ? error : new WellSkyError("network", operation);
          const retryable = failure.kind === "network" || ((failure.kind === "http" || failure.kind === "throttled") && retryStatuses.has(failure.status ?? 0));
          if (definition.method !== "GET" || failure.operation !== operation || !retryable || attempts >= this.#retries) throw failure;
          const wait = failure.retryAfterMs ?? Math.min(this.#retryMax, this.#retryBase * 2 ** attempts * (1 + Math.random() * 0.2));
          // Never retry earlier than Retry-After. Return the error if the delay exceeds our bound.
          if (wait > this.#retryMax) throw failure;
          attempts++;
          await delay(wait, signal, operation);
        }
      }
    } catch (error) {
      if (signal.aborted) { const error = abortError(signal, operation); error.correlationId = correlationId; throw error; }
      if (error instanceof WellSkyError) error.correlationId = correlationId;
      if (error instanceof WellSkyError || error instanceof TypeError) throw error;
      throw new WellSkyError("network", operation);
    } finally { clearTimeout(timer); }
  }

  async *paginate<T>(definition: OperationDefinition, args: Arguments & PaginationOptions): AsyncGenerator<T> {
    const operation = `${definition.method} ${definition.path}`;
    const query = Object.fromEntries(Object.entries(args.query ?? {}));
    const start = positiveInteger(typeof query.startPage === "number" ? query.startPage : 1, "startPage");
    positiveInteger(typeof query.perPage === "number" ? query.perPage : 30, "perPage");
    const maxPages = positiveInteger(args.maxPages ?? 10_000, "maxPages");
    for (let page = 0; page < maxPages; page++) {
      const response = await this.execute<ApiResponse<T>>(definition, { ...args, query: { perPage: 30, ...query, startPage: start + page } });
      const items = toItems(response);
      if (!items.length) return;
      yield* items;
      // Continue through short pages: some tenants cap perPage below the requested size.
    }
    throw new WellSkyError("pagination", operation);
  }
}
