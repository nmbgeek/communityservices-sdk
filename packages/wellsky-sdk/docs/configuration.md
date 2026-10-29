# Configuration reference

[Documentation index](README.md) · [REST usage](rest-client.md)

The root export selects V3. `/v2` and `/v3` fix their own `x-version` headers. Options are defined in [ClientOptions](../dist/esm/runtime.d.ts); response models and route parameters are version-specific.

## REST client options

| Option | Default | Contract |
| --- | --- | --- |
| `tenant` | Required | Explicit tenant identifier; read-only on the client |
| `auth` | Required | One of the modes below |
| `baseUrl` | `https://csclientapi.wellsky.com/client-api-prod` | The explicit tenant selects the system on this shared host |
| `fetch` | Global `fetch` | Injectable transport for tests or routing |
| `timeoutMs` | `30000` | Total request deadline, including authentication, queueing, backoff, and body reads |
| `maxConcurrency` | `8` | Shared in-process scheduler for matching clients |
| `maxReadRetries` | `2` | Additional GET attempts; writes are not replayed |
| `retryBaseDelayMs` | `250` | Initial backoff setting |
| `maxRetryDelayMs` | `30000` | Backoff/Retry-After bound |
| `cooldown` | `{threshold:5, windowMs:10000, durationMs:30000}` | Shared failure-window cooldown |
| `metadataCacheTtlMs` | `60000` | Definition cache lifetime |
| `metadataCacheMaxEntries` | `100` | Per-client metadata cache bound |
| `mobileAssessmentDateCorrectionMinutes` | Unset | Measured integer offset from -840 to 840, applied only to AddAssessmentAnswer's effective-date query |
| `hooks`, `logger` | Unset | Allowlisted events without bodies, credentials, filters, or tokens |

Matching tenant/base URL/transport clients share scheduling state and must use consistent scheduler settings. Coordination is within one process. Tenant consistency checks are described in [REST configuration](rest-client.md#configure-a-client).

## Authentication modes

| `auth.kind` | Required fields | Lifecycle |
| --- | --- | --- |
| `credentials` | `username`, `password` | Automatic `SetAuthKey`; matching credentials share cache and in-flight mint |
| `token` | `token` | Caller owns expiry and replacement |
| `provider` | `getToken({forceRefresh, signal})` | Caller returns a token; honors cancellation and refresh requests |
| `none` | None | Only for deliberately unauthenticated operations or synthetic tests |

REST authentication does not read `.env`. A GET can refresh authentication once after 401. A write is not replayed after 401. Mint failures return to the caller. Token minting can affect other processes using that account; keep token lifecycle coordinated in your application.

## Per-request controls

Every request accepts `signal`, `timeoutMs`, and `correlationId`. Use an opaque correlation ID. `WellSkyError` reports `kind`, operation template, and optional status/request ID/retry delay. Upstream bodies are discarded. See [error recovery](troubleshooting.md).

## Browser session options

`openUiSession` and `openEnrollmentSession` use [LoginOptions](../browser/index.d.mts):

| Option | Meaning |
| --- | --- |
| `tenant` | Required tenant identifier, for example `your-tenant` |
| `moduleBaseUrl` | Optional complete application module URL; must match `tenant` |
| `chromium` | Required Playwright browser type supplied by the application |
| `envFile` | Selected local credentials file; defaults to `.env` |
| `executablePath` | Path to an installed compatible browser; needed when no Playwright browser is installed |
| `timeoutMs` | Per-action login/bootstrap timeout; defaults to `90000` milliseconds. This is not a total workflow deadline |
| `passwordRecovery` | Enabled by default; `false` disables password mutations, or supply `{store, appendCharacter}` |
| `store` | Required by `openEnrollmentSession` for enrollment/client mutation journals |

Only the selected file supplies UI credentials:

```dotenv
HMIS_UI_USER=your-browser-login
HMIS_UI_PASSWORD=your-browser-password
# Optional persistent recovery directory:
HMIS_UI_PASSWORD_RECOVERY_DIR=/private/application/password-recovery
```

The recovery directory defaults to `~/.wellsky-sdk/password-recovery`. Its journal is separate from workflow mutation journals. The default temporary suffix is `!`. Read [password recovery](browser-session.md#expired-ui-passwords) before enabling an account: the helper changes an expired password and then attempts to restore the original. REST credentials can differ from these UI credentials.

No browser binary is bundled. The browser helper uses a fresh context, configured tenant URL, and a dedicated page. Sessions expose `ensureAuthenticated`, `reauthenticate`, and `close`. Close the session in `finally`.

## Tenant connections

Use the neutral exports, such as `openUiSession`, `openEnrollmentSession`, `createServiceRecorder`, and `createCurrentLivingSituationRecorder`. Browser login requires an explicit tenant.

Supply `tenant` when opening a browser session. For the default host, `tenant: 'your-tenant'` resolves to `https://wscs.wellsky.com/your-tenant/com.bowmansystems.sp5.core.ServicePoint/`. Changing the tenant selects another path; the SDK methods stay the same. `moduleBaseUrl` can select another HTTPS host, but its tenant path must match. REST and browser credentials remain separate.

Pass `session.page` to UI adapters. Each adapter binds to that page's application URL and rejects later navigation into another tenant. REST/UI compositions reject mismatched tenant identifiers. Keep program, provider, client, assessment, and picklist IDs specific to the selected tenant.

Browser sessions expose `session.connection`. A need recorder gets its tenant from `createNeedUi({page: session.page})`. When supplying a custom need adapter, pass `tenant` explicitly because there is no REST client from which to derive it.

Keep durable journals separate for each tenant and deployment. Retain the same journal when resuming an operation so uncertain writes are reconciled. Password-recovery records include the connection scope and account identity.
