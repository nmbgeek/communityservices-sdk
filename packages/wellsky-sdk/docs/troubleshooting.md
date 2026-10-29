# Recover without duplicate writes

[Documentation index](README.md) · [Session recovery](browser-session.md#reauthentication-and-interrupted-writes)

## Resume a failed workflow

1. Preserve the original input, source key, durable journal, and returned IDs. Stop scheduling new dependent writes.
2. Read `getStatus({clientId,key})` or `getHouseholdStatus({headClientId,key})` when using the enrollment workflow. This is local journal progress, not proof of current server state.
3. If authentication failed, correct the credentials or session first. Use `session.reauthenticate()` after a latched UI login failure. REST token refresh and browser reauthentication are separate operations.
4. Call the same workflow operation with the same inputs, key, and store. Reordering household members or a service batch is allowed only where documented; do not change intent.
5. Accept completion only when the helper verifies the saved state. If it still reports ambiguity, inspect the target in the UI and authoritative reads. Retain the pending journal for reconciliation.

There is no universal force-retry, journal reset, or safe timeout after which an uncertain write can be resent. A failed response, 404, or empty read does not establish that the server rolled back. Raw `api.bulk` and generated writes do not perform this workflow reconciliation.

Successful adoption of an existing record also needs its journal. Retain it even when the result was `already-present` and no server write occurred. Missing previously observed GWT membership/reviews, changed attachment IDs, and changed service/need IDs require review rather than automatic recreation or replacement. Matching text, dates or file bytes alone does not override a saved identity.

## Diagnose the failure

| Signal | Meaning | Next action |
| --- | --- | --- |
| `ValidationError`, `kind: 'validation'` | Request does not meet its contract | Inspect `fields`; validate dates, casing, required values, and current options before submitting |
| `TenantMismatchError` | Configuration or response tenant indicator conflicts | Stop; correct tenant/environment. Do not disable checks |
| `AuthError`, HTTP 401 | REST authentication unavailable/rejected | Resolve REST account/token; do not replay a write from a generic HTTP retry handler |
| `ThrottledError`, `CooldownError` | Request scheduling/backoff limit reached | Observe `retryAfterMs` or `until`. Resume reads; reconcile mutations before any new attempt |
| `UpstreamError`, `kind: 'http'` | Upstream rejected or failed a request | Keep the operation and status, not raw body logs; inspect authoritative saved state if it was a write |
| `kind: 'timeout'`, `'network'`, `'aborted'` | Request ended without reliable completion evidence | Treat an attempted mutation as uncertain |
| `kind: 'protocol'`, `'pagination'` | Invalid/incomplete read evidence | Do not interpret as zero records or permission to create |
| `DefinitionDriftError`, `UnknownPicklistValueError` | Metadata or lookup assumption changed | Refresh/review definitions and application mapping. Do not guess a numeric option |
| `AmbiguousCommitError` | Mutation outcome not established | Keep journal pending; re-read through the workflow's authoritative path |
| `GwtEnrollmentConflictError` | Duplicate/partial/conflicting enrollment or review | Inspect membership and review instant. Do not replay the captured request |
| `EnrollmentWorkflowError` | Invalid plan, missing head, schema drift, conflict, or unresolved stage | Inspect the specific reason and local status; fix application inputs only before reservation, otherwise reconcile original intent |
| `SessionInterruptedError`, `SESSION_INTERRUPTED` | Managed page operation ended around session expiry | Check `reauthenticated`; retry the original workflow call, never its prepared RPC |
| `LoginError`, `PASSWORD_EXPIRED` | Expiration detected with recovery disabled | Use the documented recovery option or resolve the password outside the helper |
| `LoginError`, `RECOVERY_UNCERTAIN` | Password write/check outcome unresolved | Retain original password, suffix, and recovery journal; determine which credential is active without repeating password writes |
| `LoginError`, `RECOVERY_CONFIGURATION` or `LOGIN_FAILED` | Invalid recovery setup or login failure | Correct the supplied file/options/account; avoid automatic login loops |
| `SOURCE_ID_CONFLICT`, `CASE_NOTE_SOURCE_CONFLICT` | Source key reused with different intent | Restore the original intent for retries; use a new revision key only for an intentional supported update |
| `POSSIBLE_DUPLICATE` | Client creation found identity candidates | Review candidates; never automatically merge or select by names or DOB |
| `INVALID_VETERAN_STATUS` | Client creation received an unsupported label | Use an exact HUD label from [client creation](durable-records.md); no API access or journal reservation occurred |
| `AttachmentConflictError`, `ATTACHMENT_CONFLICT` | Attachment intent or saved state conflicts with the journal | Inspect `reason`, the original file and journal; authentication cannot resolve this conflict |
| `CLIENT_CREATE_UNCERTAIN` | Client create lacks a durably saved receipt | Verify the ID independently, then use `resolveCreated` with the original request; never resend the create |
| `CLIENT_CREATION_DRIFT`, `CLIENT_ALREADY_MAPPED` | Saved fields or source identity do not agree | Review the existing mapping and authoritative record before proceeding |
| `EEXIST` from file store lock | Another writer or leftover crash lock | Check the owning process and reconcile its saved attempt before manual lock removal |

Not every browser helper error is a `WellSkyError`; some validation/UI failures are ordinary `Error` objects. `verifyWrite` returns a discriminated result rather than using a thrown error as its success contract. Its `unverified` result may already be committed.

## Check unexpected values

- Empty complete-enrollment verification arrays: use [assessment-based snapshots](assessments.md#read-verification-records-at-enrollment). Do not shift stored dates.
- Seven-hour effective-date discrepancy: measure saved `date_effective`, then use the [mobile-only correction](assessments.md#mobile-effective-date-correction) if warranted.
- Wrong or blank DOB: compare current client API, assessment effective date, and fresh UI. Use the [DOB helper](profiles.md#birth-dates); blank mobile values alone are inconclusive.
- Sex not updated by REST Gender: use the Client Record UI adapter, as described in [profiles](profiles.md).
- `Non-static method requires a target.` on a complete enrollment read: the enrollment may still exist and its assessment reads may succeed. V2 also fails for fixture 680. Do not recreate the enrollment or invent missing answers. See the [individual enrollment comparison](vendor-issues/enrollment-complete-target-error.md) for the controlled date-only and quality-only tests. Unknown/declined DOB quality also clears the tested failure while DOB remains absent. Record the actual response; never invent a birth date to make a read succeed.
- `v.entry_date_effective` error: use authoritative GWT enrollment reads or obtain an upstream fix. It occurs after ordinary UI saves too and reproduces in both V2 and V3 for grouped records. Do not switch versions or skip failed pages as a workaround. See the [comparison and reproduction report](vendor-issues/enrollment-effective-date-column.md).
- REST attachments rejected with valid REST token: use the verified [browser attachment workflow](files-and-notes.md). Extra body credentials do not resolve the observed server failure.
- Provider catalog missing or incomplete: do not substitute a partial list. `readProgramCatalog` verifies counts and applies provider filters locally.

## Keep recovery evidence private

Record the operation, stable source key, target IDs, journal stage, correlation ID, and whether reads verified a commit. SDK transport hooks expose allowlisted metadata. Do not log credentials, cookies, JWTs, full RPC bodies, SSNs, note text, or attachment bytes. Application journals and returned data can still contain client information even when SDK errors are sanitized.

The file store coordinates one host and leaves crash locks intentionally. Multi-host operation requires a shared durable locking implementation. No local journal prevents unrelated WellSky users or integrations from editing between a read and a save.
