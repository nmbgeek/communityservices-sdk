import { WellSkyError } from "./runtime.js";
import type { ClientEvent, ClientHealth, ClientOptions } from "./runtime.js";
import { CooldownError } from "./errors.js";

interface Waiter { grant: () => void; signal: AbortSignal; abort: () => void }
export class Semaphore {
  active = 0;
  readonly #capacity: number;
  readonly #queue: Waiter[] = [];
  constructor(capacity: number) { this.#capacity = capacity; }
  get queued(): number { return this.#queue.length; }
  acquire(signal: AbortSignal, operation: string): Promise<() => void> {
    return new Promise((resolve, reject) => {
      let released = false;
      const grant = () => {
        signal.removeEventListener("abort", abort);
        this.active++;
        resolve(() => {
          if (released) return;
          released = true; this.active--;
          this.#queue.shift()?.grant();
        });
      };
      const abort = () => {
        const index = this.#queue.indexOf(waiter);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(new WellSkyError(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "timeout" : "aborted", operation));
      };
      const waiter: Waiter = { grant, signal, abort };
      if (signal.aborted) { abort(); return; }
      if (this.active < this.#capacity) grant();
      else { this.#queue.push(waiter); signal.addEventListener("abort", abort, { once: true }); }
    });
  }
}

export interface SharedAuthentication {
  cached?: { token: string; expiresAt: number } | undefined;
  inFlight?: Promise<string> | undefined;
}
const identities = new WeakMap<object, number>();
let nextIdentity = 1;
export function identity(value: object): number {
  const prior = identities.get(value);
  if (prior !== undefined) return prior;
  const id = nextIdentity++; identities.set(value, id); return id;
}
const authentication = new Map<string, SharedAuthentication>();
/** Credentials are hashed for cache identity and never exposed in keys or diagnostics. */
export async function sharedAuthentication(scope: string, auth: ClientOptions["auth"]): Promise<SharedAuthentication> {
  const descriptor = auth.kind === "credentials" ? [scope, auth.kind, auth.username, auth.password] : auth.kind === "provider" ? [scope, auth.kind, identity(auth.getToken)] : [scope, auth.kind];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(descriptor)));
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const prior = authentication.get(key);
  if (prior) return prior;
  const state: SharedAuthentication = {};
  authentication.set(key, state);
  return state;
}
export const tokenMintQueue = new Semaphore(1);

export class RequestControl {
  readonly semaphore: Semaphore;
  readonly #settings: { threshold: number; windowMs: number; durationMs: number };
  #failures: number[] = [];
  #until = 0;
  tokenMintCount = 0;
  constructor(concurrency: number, settings: { threshold: number; windowMs: number; durationMs: number }) {
    for (const value of [concurrency, settings.threshold, settings.windowMs, settings.durationMs]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("Concurrency and cooldown settings must be positive integers");
    this.semaphore = new Semaphore(concurrency); this.#settings = { ...settings };
  }
  check(operation: string): void {
    if (this.#until > Date.now()) throw new CooldownError(operation, this.#until);
    if (this.#until !== 0) { this.#until = 0; this.#failures = []; }
  }
  failed(status: number): number | undefined {
    if (status !== 401 && status !== 403 && status !== 429 && status < 500) return undefined;
    const now = Date.now();
    this.#failures = this.#failures.filter(time => time > now - this.#settings.windowMs);
    this.#failures.push(now);
    if (this.#failures.length >= this.#settings.threshold && this.#until <= now) { this.#until = now + this.#settings.durationMs; return this.#until; }
    return undefined;
  }
  health(): ClientHealth {
    return { state: this.#until > Date.now() ? "open" : "closed", until: this.#until > Date.now() ? new Date(this.#until).toISOString() : null, activeRequests: this.semaphore.active, queuedRequests: this.semaphore.queued, tokenMintCount: this.tokenMintCount };
  }
}
const controls = new Map<string, { signature: string; value: RequestControl }>();
export function requestControl(scope: string, options: ClientOptions): RequestControl {
  const concurrency = options.maxConcurrency ?? 8;
  const cooldown = options.cooldown ?? { threshold: 5, windowMs: 10_000, durationMs: 30_000 };
  const signature = JSON.stringify([concurrency, cooldown.threshold, cooldown.windowMs, cooldown.durationMs]);
  const existing = controls.get(scope);
  if (existing && existing.signature !== signature) throw new TypeError("Clients sharing a tenant and transport must use the same concurrency/cooldown settings");
  if (existing) return existing.value;
  const value = new RequestControl(concurrency, cooldown);
  controls.set(scope, { signature, value }); return value;
}

export function emit(options: Pick<ClientOptions, "hooks" | "logger">, event: ClientEvent): void {
  const hooks = options.hooks;
  const handler = event.type === "request" ? hooks?.onRequest : event.type === "response" ? hooks?.onResponse : event.type === "tokenMint" ? hooks?.onTokenMint : event.type === "throttle" ? hooks?.onThrottle : hooks?.onCooldown;
  const safe = Object.freeze({ ...event });
  // Observers must not turn a completed write into a thrown error or a replay.
  try { void Promise.resolve(handler?.(safe)).catch(() => {}); } catch { /* Observer failures cannot change request outcomes. */ }
  try { void Promise.resolve(options.logger?.(safe)).catch(() => {}); } catch { /* Same boundary for user-supplied loggers. */ }
}
