import { WellSkyClient, operationRoutes } from "./generated/v3.js";
import type { Operation } from "./generated/v3.js";
import type { Authentication, ClientOptions } from "./runtime.js";

export interface FakeRequest {
  operation: Operation;
  path: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  signal: AbortSignal | null;
}
export type FakeReply = { status?: number; body?: unknown; headers?: Record<string, string> };
export type FakeBehavior =
  | ({ kind: "reply" } & FakeReply)
  | { kind: "network-error" }
  | { kind: "commit-then-error"; commit: (request: FakeRequest) => void; status: number }
  | { kind: "handler"; handle: (request: FakeRequest) => FakeReply | Promise<FakeReply> };

const routes = [...operationRoutes].sort((a, b) => (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0)).map(route => ({ ...route, parts: route.path.split("/") }));

/** A synthetic-only transport. No unhandled request can reach the network. */
export class FakeControl {
  readonly calls: FakeRequest[] = [];
  readonly #scripts = new Map<Operation, FakeBehavior[]>();
  readonly #defaults = new Map<Operation, FakeBehavior>();
  readonly state = new Map<string, unknown>();
  enqueue(operation: Operation, ...behaviors: FakeBehavior[]): void { this.#scripts.set(operation, [...(this.#scripts.get(operation) ?? []), ...behaviors]); }
  set(operation: Operation, behavior: FakeBehavior): void { this.#defaults.set(operation, behavior); }
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const url = new URL(request.url);
    const relative = url.pathname.replace(/^\/client-api-prod/, "");
    const parts = relative.split("/");
    const route = routes.find(candidate => candidate.method === request.method && candidate.parts.length === parts.length && candidate.parts.every((part, i) => part.startsWith("{") || part === parts[i]));
    if (!route) throw new Error("Unscripted fake endpoint");
    const path: Record<string, string> = {};
    for (let i = 0; i < route.parts.length; i++) {
      const part = route.parts[i];
      if (part?.startsWith("{")) path[part.slice(1, -1)] = decodeURIComponent(parts[i] ?? "");
    }
    const body = request.headers.get("content-type")?.includes("application/json") ? await request.json() : request.method === "GET" ? undefined : await request.text();
    const call: FakeRequest = { operation: route.operation, path, query: Object.fromEntries(url.searchParams), body, signal: request.signal };
    this.calls.push(call);
    const behavior = this.#scripts.get(route.operation)?.shift() ?? this.#defaults.get(route.operation);
    if (!behavior) return new Response('{"error":"No synthetic response configured"}', { status: 501 });
    let reply: FakeReply;
    switch (behavior.kind) {
      case "network-error": throw new TypeError("Synthetic network error");
      case "commit-then-error": behavior.commit(call); reply = { status: behavior.status }; break;
      case "handler": reply = await behavior.handle(call); break;
      case "reply": reply = behavior; break;
    }
    request.signal.throwIfAborted();
    const status = reply.status ?? 200;
    return new Response(status === 204 || status === 205 || status === 304 ? null : JSON.stringify(reply.body ?? null), { status, headers: { "content-type": "application/json", ...reply.headers } });
  };
}

export type FakeClientOptions = Omit<Partial<ClientOptions>, "fetch" | "baseUrl" | "auth"> & { auth?: Authentication };
export class FakeWellSkyClient extends WellSkyClient {
  readonly fake: FakeControl;
  constructor(options: FakeClientOptions = {}) {
    const fake = new FakeControl();
    super({ ...options, tenant: options.tenant ?? "synthetic", auth: options.auth ?? { kind: "none" }, baseUrl: "https://synthetic.invalid/client-api-prod", fetch: fake.fetch, retryBaseDelayMs: options.retryBaseDelayMs ?? 0 });
    this.fake = fake;
  }
}
export function createFakeWellSkyClient(options: FakeClientOptions = {}): FakeWellSkyClient { return new FakeWellSkyClient(options); }
