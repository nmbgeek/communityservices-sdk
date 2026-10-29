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

REST changes require a timezone-qualified `dateEffective`; Sex uses the current UI audit context. The two writes are not atomic. DOB, DOB quality, legacy Gender, race/ethnicity, phone and email are outside this helper's changes. Use the Birth dates helper below for the separately verified DOB conversion and existing-answer correction path. The Client Record helper does not apply any DOB correction. Existing assessment helpers remain separate from Client Record updates.

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
