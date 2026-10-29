# REST client configuration and requests

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

## Configure a client

```ts
import { createWellSkyClient, toItems } from '@choiceapps/communityservices-sdk';

const client = createWellSkyClient({
  tenant: 'your-tenant',
  baseUrl: 'https://csclientapi.wellsky.com/client-api-prod',
  auth: { kind: 'credentials', username, password },
});

const people = toItems(await client.clients.get({ path: { clientId } }));
```

Supply credentials from your server's secret store. The REST client reads no environment variables or credential files. The optional headless login reads its explicitly selected local credentials file. Construction rejects browser runtimes. `client.tenant` is read-only.

`tenant` selects the system. All configured tenants support the same methods. Callers select the tenant through connection configuration and credentials.

Authentication modes are `credentials`, a caller-managed static `token`, a `provider` with `getToken({ forceRefresh, signal })`, or `none` for explicitly unauthenticated operations. Automatic authentication uses `SetAuthKey` only. Matching clients share cached credentials and one in-flight mint; mints for different accounts are serialized. Opaque tokens without a usable JWT expiration are not reused between calls. Static-token lifecycle remains the caller's responsibility.

Detected mismatches in the `x-tenant` response header, supported tenant claims in JWTs, or top-level response tenant indicators fail closed. These checks detect mismatches; they do not cryptographically verify JWT signatures or establish a tenant when the server omits all indicators.

## Select an API version

```ts
import { WellSkyClient as V2 } from '@choiceapps/communityservices-sdk/v2';
import { WellSkyClient as V3 } from '@choiceapps/communityservices-sdk/v3';
```

The root export defaults to V3. Each entry point fixes its `x-version` header and exposes the matching models. Payloads are not translated between versions. All three entry points also support `require()`.

## Read and write resources

[API.md](../API.md) lists every named method. Requests use one object with typed `path`, `query`, and `body` properties. Parameter spelling matches Swagger, including `clientId`, `client_id`, and `$filter`.

```ts
await client.services.listForClient({ path: { clientId } });
await client.request('GET /clients/{clientId}', { path: { clientId } });
```

Responses retain WellSky's object, array, OData `{ value: [...] }`, counted `{ count: number, values: [...] }`, or empty/null shape. Requests with `total_count: true` can return the counted format. `ApiResponse<T>` includes both collection types, and `toItems()` extracts their records. The count describes the whole result set, not the current page. Both envelopes validate each record against the endpoint's response model. Models with no documented response schema return `unknown`. HTTP errors, including 404, throw by default. A 404 is not globally interpreted as absence.

Attachment uploads accept a `Blob` or `File` in `body.fileData`. Files larger than 10 MB, defined as 10,000,000 bytes, throw `ValidationError` with `fields: ['fileData']` before authentication or upload. The limit applies to file bytes, excluding multipart overhead. Server permissions, MIME restrictions, and entity identifiers still require tenant-specific verification.

Dates remain strings. The SDK does not convert a calendar date through a timezone. Request validation checks declared types, required fields, nullability, integer safety, string lengths, and unexpected properties. Response validation checks structure and declared fields while allowing extra fields. Date formats, .NET regular expressions, tenant picklists, and program rules remain explicit caller/server concerns, except for the explicit corrections in the [date contracts](dates-and-answers.md).

In the SDK source checkout, `specs/overrides.json` records observed response-only corrections where Swagger differs from live behavior. In particular, optional service program-information objects can be null. It does not loosen request validation.

## Bulk execution and pagination

```ts
const report = await client.bulk(
  'GET /clients/{clientId}',
  clientIds.map(clientId => ({ path: { clientId } })),
  { concurrency: 4, signal, onResult: async result => persistProgress(result) },
);

for await (const person of client.paginate('GET /clients', {
  query: { perPage: 30, startPage: 1 },
  maxPages: 100,
  signal,
})) {
  await consume(person);
}
```

Bulk execution schedules individual API calls. It preserves input order in the final report and returns each item's `fulfilled`, `rejected`, or `skipped` outcome. It does not retry items itself. `mapBulk(items, worker, options)` supports custom per-item operations such as verified writes. The callback runs in completion order and is awaited. If it fails, new scheduling stops, active items finish, and callback errors are reported separately without changing successful write outcomes. Cancellation skips unstarted items.

A rejected write promise does not prove rollback. Use verified-write results when the application needs commit certainty. Persist the returned report, including skipped items.

Pagination uses one-based `startPage` and `perPage`, extracts records from either collection envelope, continues through short pages, and stops on an empty page. It throws at `maxPages` instead of silently truncating. It never follows arbitrary next-link URLs or treats a 404 as an empty page. For providers, use `readProgramCatalog()`: that endpoint returns 404 beyond its last page, so the helper checks the counted total instead. Concurrent changes and delayed query visibility can affect paginated results; this is not a snapshot or proof of absence.

## Verify writes and classify reads

`verifyWrite()` sends at most once and then reads back, including after an HTTP error. Supply the semantic payload, expected fields, a submit function, and a read-back adapter. It returns:

- `verified`, `committed: true` when every expected field matches.
- `unverified`, `committed: true | 'unknown'` for mismatches or unavailable evidence.
- `failed`, `committed: false` for preflight failure or an explicit authoritative proof of non-commit.

A successful HTTP response alone is not verification. A failed write followed by an empty read is still unverified unless an endpoint-specific adapter supplies authoritative proof. Mismatch values are redacted, and evidence includes field match states and IDs. The adapter's `data` and expected values can contain private data and remain the application's responsibility. `semanticHash()` sorts object keys and hashes JSON values; include tenant, operation, target IDs, and effective date. Undefined values, sparse arrays, cycles, non-finite numbers, and non-plain objects are rejected. Use explicit `null` for an intentionally empty array element. Invalid expected fields fail before submission; malformed readback cannot verify a write. Hashing is not a server idempotency guarantee or a database transaction.

`readOutcome()` returns `found`, `absent`, or `unknown`. It maps no status to absence by default; the caller must explicitly supply endpoint-specific absence rules. Resume decisions and persisted step logs belong to the application.

## Request controls and observability

Default controls are 8 concurrent HTTP requests, a 30-second request deadline, and two additional GET attempts for network failures or HTTP 408, 429, 500, 502, 503, and 504. Configure `maxConcurrency`, `timeoutMs`, `maxReadRetries`, `retryBaseDelayMs`, and `maxRetryDelayMs`. The deadline includes authentication waits, queued requests, body reads, and backoff.

GET requests can refresh authentication once after 401. Writes are never replayed, including after 401. Authentication mint failures return to the caller. Retry-After seconds and HTTP dates are honored for retryable HTTP responses, including 429 and 503. If the delay exceeds `maxRetryDelayMs`, the original error returns immediately with `retryAfterMs`: `ThrottledError` for 429 or `UpstreamError` for other HTTP failures. A deadline or cancellation can interrupt an allowed wait. Retry-After on a write is exposed for diagnostics and does not authorize an automatic replay.

A shared cooldown opens after five qualifying HTTP failures in ten seconds and lasts thirty seconds by default. Configure `cooldown: { threshold, windowMs, durationMs }`. Matching tenant/base URL/transport clients share concurrency and cooldown state and must use consistent settings. `client.health()` exposes cooldown state, active/queued counts, and mint count. Coordination is in-process; multiple application processes need application-level scheduling controls.

Supply `correlationId` per request or let the SDK generate one. `hooks.onRequest`, `onResponse`, `onTokenMint`, `onThrottle`, `onCooldown`, and `logger` receive allowlisted events with endpoint templates, status, duration, retry count, and correlation ID. They receive no bodies, filters, credentials, or tokens. Use opaque correlation IDs, not client identity data. The SDK discards upstream error bodies and rejects redirects.
