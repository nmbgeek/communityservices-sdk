# Update Client Profile fields and birth dates

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

These helpers require a REST client and dedicated authenticated page for the same tenant, plus a durable mutation store. The snippets assume those dependencies and application-owned client IDs.

## Client Record fields and Sex

The tenant-configured `createClientProfile` helper updates Client Profile > Client Record. REST saves names, suffix, alias, SSN, name/SSN data quality and veteran status. The separate Sex field is saved through a fresh Client Record UI form, using the application's current GWT serializer. REST legacy `svpprofgender` does not update this Sex field.

```ts
import {createClientProfile, createClientProfileUi}
  from '@choiceapps/communityservices-sdk/browser';

const profile = createClientProfile({
  api: client, store, ui: createClientProfileUi({page: session.page}),
});
const current = await profile.read(clientId); // Values and live picklist choices.
await profile.update({
  clientId, key: 'source-profile-change-42',
  dateEffective: '2026-10-23T16:00:00Z',
  changes: {middleName: 'Synthetic', sex: 'Female'},
});
```

Use the same key, input and durable store for retries. The helper verifies fresh UI and REST values, preserves the entire Client Record in REST updates, and journals attempts before sending. This avoids an observed WellSky behavior where omitting SSN from a partial update clears it. A Sex-only change does not send a REST update. Picklist values and text lengths are validated before writes; blank strings explicitly clear optional text. Conflicting keys, unexpected field changes and unresolved saves block replay. Journal entries hold hashes rather than plaintext profile values, but returned values contain personal information and need application-level protection.

REST changes require a timezone-qualified `dateEffective`; Sex uses the current UI audit context. The two writes are not atomic. DOB, DOB quality, legacy Gender, race/ethnicity, phone and email are outside this helper's changes. Use the Birth dates helper below for the separately verified DOB conversion and existing-answer correction path. The Client Record helper does not apply any DOB correction. Use [Race and Ethnicity](assessments.md#race-and-ethnicity-combinations) for verified race writes and explicit repair. Existing assessment helpers remain separate from Client Record updates.

On sc211, pressing Save validates the existing Name and Alias together, even for a Sex-only edit. With the synthetic alias `Alex (AJ) Example` the dialog stayed open and displayed “enter valid characters for the name and alias” before sending a write request. Changing the alias to `Alex AJ Example` allowed the intercepted request to proceed. This observation covers literal parentheses on that tenant.

Get Help removes only `(` and `)` from a carried alias during an authorized profile update. Other applications should confirm with staff before changing an existing alias. An observed validation alert together with no outgoing write identifies a client-side rejection. A timeout or a completed Save click alone leaves the outcome unknown. Use the diagnostics below and keep the original journal, key and write history. Read Sex in a newly opened Client Record and compare Alias in both REST and that fresh form before deciding how to recover.

### Diagnose a stopped profile update

Pass `onDiagnostic` to `createClientProfile` to receive structured verification events for `update`. Leave it unset to disable diagnostics. The callback runs after the journal lock is released. A thrown error or rejected listener promise leaves the update result and replay rules intact.

```ts
const profile = createClientProfile({
  api: client, store, ui: createClientProfileUi({page: session.page}),
  onDiagnostic(event) {
    if (event.nextAction === 'staff-review') showSyncWarning(event);
  },
});
```

| Event evidence | How to use it |
| --- | --- |
| `phase`, `stage`, `reason`, `transport` | Identify the specific read, write, or comparison and the journal stage it reached. |
| `writes.rest`, `writes.ui` | Activity on this call through the reported check. `read-only` means no write on that transport. `dispatched` means the SDK observed a REST response or a completed UI Save click/adapter call. `unknown` means an attempt was recorded and dispatch could not be confirmed. Readback establishes whether the intended values were saved. |
| `firstFailure` | The earliest classified failure recorded with diagnostics enabled. It retains the stage, dispatch evidence, original HTTP status or browser failure when known. A later verification error has its own reason. |
| `comparison` | For a target comparison the flags describe requested and preserved fields on the reported transport. For `rest-ui` they describe agreement between the two reads. A list contains only allowlisted field names. An older or previously uninstrumented journal can report aggregate matches with `fieldDetail: 'unavailable'`. |
| `nextAction` | `verify-same-key` calls for a fresh read using the original inputs and journal. `staff-review` calls for reviewing the outstanding discrepancy or rejection. `none` means that check passed. Only the terminal `PROFILE_VERIFIED` event confirms the whole update. |

For example, a PUT rejected with HTTP 401 can be followed by a same-key read that still finds a mismatch. The second call reports `writes.rest: 'read-only'` and retains the rejection in `firstFailure`. A timed-out UI Save may instead verify on a later call. Neither case authorizes sending the failed write again.

Newly planned, instrumented operations keep operation-keyed comparison tags for unrequested fields in the private journal. Keep the same application key and protect the store. Events include only classified evidence and field names. Local input, lock, and journal errors are still returned to the caller. A process interruption or storage failure can leave the original attempt marker without optional failure detail.

## Birth dates

Use `createDateOfBirth` for DOB changes in the configured tenant. Its input is a calendar date, not an instant. The tested REST path converts DOB values to fixed UTC−7, while the browser formats dates in its own timezone. This helper encodes a REST DOB at `07:00:00Z`, verifies browser compatibility before sending, then requires matching client API and fresh UI dates. It does not change shared date encoding or shift the effective timestamp.

```ts
import {createDateOfBirth, createDateOfBirthUi}
  from '@choiceapps/communityservices-sdk/browser';

const birthDate = createDateOfBirth({
  api: client, store, ui: createDateOfBirthUi({page: session.page}),
});
await birthDate.update({
  clientId, key: 'source-dob-correction-42',
  assessmentCode: 'TCHCECHOHUDCOCESGENTRYFORRRH2026',
  dateOfBirth: '1984-02-29', effectiveDate: '2026-10-23T18:00:00Z',
  entry: {enrollmentId, assessmentName: 'TCHC ECHO HUD CoC & ESG Entry for RRH 2026'},
});
```

A new effective timestamp uses REST and does not need `entry`. Correcting the latest existing timestamp uses the UI because REST returned an entity-tracking error on that path. The supplied enrollment must have that exact entry timestamp and expose the named assessment. Its existing mandatory answers must be complete; the helper does not populate other answers. Earlier historical corrections, interim/exit contexts and clearing DOB are outside this helper. Incompatible browser timezones fail before REST writes rather than silently changing the displayed calendar date.

Keep the same key, input and durable store for retries. Attempts are journaled before writes, uncertain results are reconciled without replay, and changed intent or later drift is rejected. Verification checks both current client API and fresh UI values because the mobile assessment projection can leave UI-created DOB values blank. Other Client Record fields, including SSN and DOB quality, and other exposed assessment answers are preserved. For UI corrections, the browser generates the current `addClientAnswersLinkedToEE` request; no captured payload is replayed.

### Backdated entry with a later DOB

For an individual or household entry, the SDK compares the current profile, fresh UI and mobile DOB with the dated assessment question. A verified blank at entry and a matching later revision raise `DOB_HISTORICAL_BACKFILL_UNSUPPORTED` with `dobHistoryReason: 'blank-at-effective-date'` and `nextAction: 'staff-review'`. The same code and next action report `dobHistoryReason: 'exact-instant-required'` when a matching earlier answer exists and the operation requires an exact effective instant. The DOB helper and enrollment workflow errors both expose this reason. A conflicting value raises `DOB_HISTORY_CONFLICT`. Incomplete readback, such as an omitted answer or effective date, or an ambiguous question raises `DOB_HISTORY_EVIDENCE_UNAVAILABLE`. The SDK has no verified operation to fill a blank at entry while preserving the later revision.

Retain the original key and journal. After an authorized correction, retry the original entry. A dated assessment answer in effect at entry can be verified through reads alone (`method: 'historical-read'`). It must match the current profile and fresh UI DOB. The later mobile row may have a blank value when it still supplies its effective timestamp and identifies the same question as the dated answer. The result's `effectiveDate` remains the requested verification instant. `historicalEffectiveDate` and `laterEffectiveDate` identify the stored revisions that the SDK rechecks on same-key calls. Household preflight checks every member before creating the first enrollment.

## Unknown or declined birth date

When no DOB was supplied, record the actual quality response through assessment answers. Resolve `SVPPROFDOBTYPE` choices from current metadata: `DOBTYPE_DONTKNOW` means Client doesn't know; `DOBTYPE_REFUSED` means Client prefers not to answer. Do not call the calendar-date update helper or invent a date.

For the enrollment workflow, merge these field choices into the application's fully covered assessment plan:

```ts
const dobQualityFields = {
  answers: {SVPPROFDOBTYPE: {option: {code: 'DOBTYPE_DONTKNOW'}}},
  notApplicable: {SVPPROFDOB: "Client doesn't know their DOB; no date supplied"},
};
```

Use the declined code and matching explanation when that is the client's response. `notApplicable` is the workflow's explanation for skipping a field; it neither writes a date nor clears an existing one. Do not combine it with a DOB answer or DOB carry-forward. At interim or exit, carry forward an existing quality answer if appropriate, while continuing to explain the absent date. Other assessment fields still require their own explicit coverage and head-of-household guards still apply.

The DOB reader returns `dateOfBirth: null` for a genuinely absent date. In sandbox, both quality-only choices let complete-enrollment reads succeed in V2 and V3 without a DOB. See the [controlled vendor report](vendor-issues/enrollment-complete-target-error.md). A failed complete read must never trigger a replacement enrollment or a fabricated date.
