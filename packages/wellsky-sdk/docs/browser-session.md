# Use a browser session

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

The examples below are integration fragments. Supply application-owned IDs and an authenticated session. The browser export runs in Node and controls a dedicated Playwright page; it is not frontend JavaScript.

## Experimental GWT enrollment helpers

`GwtEnrollmentHelpers` adds `addHouseholdMembers` and `createInterimUpdate` for the web application's GWT-RPC calls. This is an explicit browser-session integration, separate from `WellSkyClient` and REST authentication. Supply a trusted `GwtEnrollmentSession` adapter and a `GwtMutationStore`:

```ts
const helpers = new GwtEnrollmentHelpers({
  tenant: "your-tenant",
  moduleBaseUrl: "https://wscs.wellsky.com/your-tenant/com.bowmansystems.sp5.core.ServicePoint/",
  session, // Fresh GWT/UI reads, fresh request preparation, authenticated same-origin POST.
  store,   // Shared durable enrollment lock and attempt journal.
});

await helpers.addHouseholdMembers({ clientId, enrollmentId, memberClientIds: [memberClientId] });
await helpers.createInterimUpdate({
  clientId, enrollmentId, clientIds: [clientId, memberClientId],
  reviewDate: "2026-10-22T12:00:00-04:00",
});
```

Dates require an explicit offset and are compared as instants. No seven-hour correction is applied. The clients must already belong to the household before enrollment attachment. Interim clients must already be enrolled, and the target client must be included in `clientIds`.

For a client without a household, the browser adapter supports the UI's `createEntryExitReview` call with its implicit single client. The core accepts this signature only when the requested clients, enrolled members and household snapshot all identify that sole head. Household reviews continue to use `createEntryExitReviewWithHouseholdMembers`. Creating a review does not populate its assessment answers; discover the program's interim instrument and write its applicable answers at the review date separately.

The adapter must implement three operations:

- `readEnrollment`: return a fresh, complete enrollment model, household membership, enrolled members, and all reviews with their included clients. Supply a revision/digest covering those reads and a non-secret session identifier. Failed, truncated, stale, or REST-derived empty results are not valid snapshots.
- `prepare`: use current models to serialize the intended operation, or intercept a newly generated UI request and abort it **before** transmission. Return it with the matching intent, session, revision and capture timestamp. The SDK invokes preparation only when the requested state is missing; previously saved templates are not accepted. The adapter must verify the nested DTO identities and other stored values. The SDK validates the RPC envelope, known type signatures, endpoint, headers and freshness; it is not a general GWT object serializer.
- `send`: issue exactly one authenticated same-origin POST. Do not retry, redirect, log payloads, or replay after authentication refresh. The SDK does not acquire browser credentials or export browser cookies.

Before sending, the helper reads state again and checks session/revision stability, then persists an attempt. It verifies the result through another authoritative read even if the response is lost or contains an error. If the result cannot be established, it raises `AmbiguousCommitError` and leaves the attempt pending. A pending attempt blocks all subsequent writes to that enrollment until a fresh read proves it succeeded. An empty read alone never clears an uncertain attempt. A partially matching or duplicated Update at the same instant raises `GwtEnrollmentConflictError` instead of creating another review.

All processes must share the store and enrollment lock. `createInMemoryGwtMutationStore()` is for development and protects only callers sharing that instance; it does not survive restarts. The packaged [file-store example](../examples/gwt-file-store.mjs) re-exports a single-host durable file journal with exclusive locks and atomic writes. A crash intentionally leaves its lock for operator reconciliation. Multi-host deployments need a shared durable implementation. The server has no proven idempotency key or conditional-write contract, so this cannot prevent an unrelated user or integration writing outside that lock between read and send.

Sandbox acceptance through October 23, 2026 verified member attachment, interim creation, and same-key reconciliation across fresh helpers and browser logins without another mutation. See the [capability and evidence summary](capabilities.md).

## Headless browser adapter

The optional ESM export `@choiceapps/communityservices-sdk/browser` supplies the adapter, a configurable browser login, and a durable single-host file journal. Install `playwright-core` separately and provide an installed Chrome executable (or install Playwright's Chromium). Tested with Playwright Core 1.56.1. The REST entry points do not load Playwright.

```js
import { chromium } from 'playwright-core';
import {
  openEnrollmentSession,
  createFileGwtMutationStore,
} from '@choiceapps/communityservices-sdk/browser';

const session = await openEnrollmentSession({
  tenant: 'your-tenant',
  chromium,
  envFile: '.env', // HMIS_UI_USER and HMIS_UI_PASSWORD, distinct from REST credentials.
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  store: createFileGwtMutationStore('/private/path/hmis-journal'),
});
try {
  await session.helpers.addHouseholdMembers({
    clientId, enrollmentId, memberClientIds: [memberClientId],
  });
  await session.helpers.createInterimUpdate({
    clientId, enrollmentId, clientIds: [clientId, memberClientId],
    reviewDate: '2026-10-21T12:00:00-04:00',
  });
} finally {
  await session.close();
}
```

The login uses the required `tenant` option to build its URL, opens a fresh browser context, and never exports credentials or cookies. Use your application's configured tenant identifier. Supply `moduleBaseUrl` for another host; its path must match the tenant. Keep the page alive. Existing authenticated pages can use `createPlaywrightEnrollmentHelpers({page, store, tenant, moduleBaseUrl})`; all tenants use the same options and operations. The documented workflow was reproduced in a sandbox tenant. Each operation reads current GWT state, prepares through the current UI, intercepts and aborts Save, persists the attempt, sends the captured request once, and verifies it. Whole-second interim timestamps are required; ambiguous local daylight-saving times fail closed. Interim creation creates the review and its participant links, not additional assessment answers.

Use the page exclusively for these helpers. They serialize their operations on a shared page; do not drive it simultaneously through unrelated scripts. Selectors and GWT signatures are experimental. Unexpected UI/schema changes, incomplete lists (over 1,000 records), authentication loss, or conflicting records stop the operation. A new login does not clear an uncertain attempt. The file journal supports one host; use a shared durable store across multiple hosts. Keep journals private and retain them across restarts. A crash can leave a lock that requires manual reconciliation.

## Expired UI passwords

Password recovery is enabled by default for `openUiSession` and `openEnrollmentSession`. It uses `!` and a private durable journal under `~/.wellsky-sdk/password-recovery`, shared by UI account across callers on that host. Set `HMIS_UI_PASSWORD_RECOVERY_DIR` in the selected credentials file to use a persistent directory of your choice. The directory must remain available across restarts. You can override the store or suffix:

```js
const session = await openEnrollmentSession({
  tenant: 'your-tenant',
  chromium,
  envFile: '.env',
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  store: createFileGwtMutationStore('/private/path/enrollment-journal'),
  passwordRecovery: {
    store: createFileGwtMutationStore('/private/path/password-recovery-journal'),
    appendCharacter: '!', // Exactly one printable, non-space ASCII character.
  },
});
console.log(session.passwordRecovery); // 'not-needed' or 'restored-original'
```

On the expired-login form, the helper appends the character to the original `HMIS_UI_PASSWORD`, submits both reset fields, opens User Profile / Change Password, and restores the original. It then signs in with the original in a fresh browser context before returning success. The `.env` file stays unchanged. A normal login makes no password changes. Set `passwordRecovery: false` to disable password changes. With recovery disabled, expiration raises `LoginError` with code `PASSWORD_EXPIRED`.

Use one shared, durable recovery store for every caller of the same UI account. Multi-host deployments must override the default with shared durable storage and locking. Keep using an existing custom recovery store if it has a pending recovery; changing stores does not reconcile it. The per-account lock covers the entire recovery. Its journal contains stages and the append character, never either password. The original must be 8–49 characters when a reset is needed so the temporary password fits the observed 50-character limit. A 50-character password can still log in normally. Keep the original credential and append character unchanged while a recovery is pending. The SDK sanitizes login errors; do not enable Playwright tracing, request-body capture, or debug logging containing credentials.

A saved temporary-password attempt can resume with one authentication check of that temporary password. A saved restoration attempt can resume with one authentication check of the original. Neither uncertain password write is repeated. An interrupted or failed authentication check leaves a blocking journal stage and raises `RECOVERY_UNCERTAIN`; reconcile the account and journal before proceeding. A process crash may also leave the file store's exclusive lock. Do not delete journals or automatically expire locks to force retries. If server policy rejects restoring the original, the helper stops and the temporary password may remain active.

Both UI actions use GWT-RPC: the shipped expired-login handler calls `AuthenticationService.changePasswordHeartbeat`, while the user-settings restoration was observed calling `UserService.updateUserPassword` with HTTP 200 / GWT OK. The former uses the limited session established by the expired login. The helper currently drives the live forms to generate fresh requests. A standalone RPC-only password adapter has not been implemented or tested; captured password payloads must not be stored or replayed. See [sandbox findings](capabilities.md).

## Adopting existing enrollment records

If requested membership or a review already exists, the GWT helper records a verified journal entry before returning `already-present`. Later calls return `reconciled`; if the observed state disappears, they raise `previously-verified-missing` without preparing or sending another write. Journal persistence must succeed even when the operation adopts existing records. Older versions did not journal these observations, so an existing journal cannot prove an observation that was never saved.

## Reauthentication and interrupted writes

Sessions returned by the headless helpers retain the same `page` and `context` across reauthentication. Enrollment helpers, service UI, program discovery, attachments and exit helpers built from that managed page check authentication under the shared page lock before each browser operation. A visible login form or an HTTP 401 from the configured tenant triggers reauthentication using the same credentials and recovery journal. WellSky can also return HTTP 500 while leaving an expired dashboard visible. After an unclassified operation failure, the helper opens a separate read-only page to check authentication; it reconnects only if that page shows the login form. An inconclusive probe leaves the original error intact. Authentication failures block further automatic attempts until explicitly resolved.

```js
await session.ensureAuthenticated(); // Reconnect only when expiry has been detected.
await session.reauthenticate();      // Explicit reconnect, serialized with browser operations.
```

Confirmed attachment conflicts retain `AttachmentConflictError` and their `reason` without an authentication probe or reconnect. Authentication cannot resolve changed attachment identity, content, or intent. See [attachment recovery](files-and-notes.md). The next operation still performs normal authentication preflight.

For other failures that coincide with confirmed session expiration, the helper reconnects after the operation unwinds and throws `SessionInterruptedError`, code `SESSION_INTERRUPTED`. Its `reauthenticated` property says whether reconnecting succeeded. It never reruns the interrupted callback, resends a captured payload, clears a mutation journal, or restarts a bulk batch. If a failed authentication attempt needs to be retried after correction, call `session.reauthenticate()` explicitly.

Retry the enrollment or service operation with its original key, inputs and durable store. The existing journals reconcile confirmed commits and block unresolved writes. A changed key is not a recovery strategy. GWT snapshots and prepared requests from before reauthentication are invalidated, and the next operation reads fresh state. Bulk service recording still stops at the failed row; retry with the same row keys after resolving it.

This behavior applies to SDK helpers using the managed page lock. A raw Playwright action or low-level GWT session does not gain automatic retries or authentication recovery. Unknown GWT errors and HTTP 403 are not, by themselves, treated as proof of expiration. Use explicit reauthentication when session loss is established but the UI does not display its login form. Reauthentication can reset UI navigation and provider/Enter Data As context; operations must select and validate their requested provider again.

## Grouped-enrollment REST error

Sandbox REST enrollment-list and complete-enrollment reads returned HTTP 400 with `42703: column v.entry_date_effective does not exist` after household attachment. This occurred after both an ordinary UI save and a direct RPC replay. The replay fixture reproduced it before its interim was created. Fresh UI/GWT reads confirmed the stored enrollment and reviews.

This indicates a server query/schema problem in the observed grouped-enrollment read path. A schema/version mismatch is a possible explanation, not a confirmed root cause. It is distinct from the verification-date cutoff issue. The client cannot repair the server column/view, and changing record dates or repeating creation is not a workaround. Consumers relying on those REST reads need a verified GWT read path or an upstream WellSky fix; a failed REST read must never mean "record absent."
