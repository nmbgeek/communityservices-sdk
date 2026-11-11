# Discover programs and manage enrollments

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

The snippets are integration fragments. Your application supplies existing client and household IDs, stable source keys, and assessment plans. Use the [durable client and household helpers](durable-records.md) before enrolling new people. Client identity decisions and household membership remain separate from program participation.

## Programs, assessments and form definitions

```js
import {readProgramCatalog, flattenQuestions} from '@choiceapps/communityservices-sdk';
import {createProgramDiscovery} from '@choiceapps/communityservices-sdk/browser';
const catalog = await readProgramCatalog(api); // Counted REST pages, active/operational by default.
const discovery = createProgramDiscovery({page: session.page});
const configuration = await discovery.getProviderAssessments({providerId});
const entry = configuration.defaults.find(d => d.location === 'showVaEntry');
if (entry?.resolution !== 'resolved') throw new Error('Entry assessment not resolved');
const definition = await api.assessments.getDefinition({
  clientId:metadataClientId, assessmentCode:entry.assessment.code,
});
const questions = flattenQuestions(definition.questions); // Includes subassessment children.
const picklists = await api.picklists.list({clientId:metadataClientId, assessmentCode:entry.assessment.code});
```

Provider lists include agencies and parent organizations as well as programs. Listing a provider does not establish permission to enroll or provide services. Swagger lacks provider-to-assessment assignments, so the browser adapter reads Provider Admin display settings and the published catalog. It distinguishes assessment-tab assignment from entry/interim/exit defaults and leaves ambiguous names unresolved. `listAssessments()` returns the published top-level catalog. Browser discovery requires administrative read access and shares the page lock with the other helpers.

REST form metadata includes question paths, mandatory flags, current option IDs/codes/names, and nested subassessment definitions without recorded client answers. It requires a permitted client context and does not reproduce every UI conditional rule or historical picklist version. See [program discovery findings](capabilities.md) and [example](../examples/program-discovery.ts).

## Enrollment workflow from program discovery

`createEnrollmentWorkflow` composes the provider catalog, current program assessment defaults, question/picklist metadata, REST enrollment and answer writes, and the durable GWT interim helper. It accepts an **existing client ID**. It does not create clients or infer program eligibility, answers, conditional applicability, or which verification types a program requires.

The workflow's `EntryExitType` accepts `HUD`, `Basic`, `Standard`, `RHY`, `VA`, `Basic Center Program Entry/Exit`, `PATH`, `Quick Call`, and `Transitional Living Program Entry/Exit`. `type` identifies the Entry/Exit category; `assessmentCode` identifies its assessment instrument. The workflow sends the selected type unchanged to REST. The generated REST methods accept a string; neither contract guarantees that the server permits every type for a given provider.

HUD and VA retain built-in provider display locations. For another type, supply `assessmentLocations` when constructing the workflow. First inspect `getProviderAssessments({providerId}).defaults`, including each item's `label`, then map the desired type's entry, interim, and optional exit phases to their exact `location` values. These values are display-control identifiers, not assessment names, IDs, or codes. The workflow resolves the instruments from fresh provider discovery on every operation. It rejects missing, duplicate, unset, or unresolved defaults before record writes and never falls back to another type.

```ts
const workflow = createEnrollmentWorkflow({
  api, discovery, helpers, store,
  assessmentLocations: {
    PATH: {
      entry: selectedPathEntry.location,
      interim: selectedPathInterim.location,
      exit: selectedPathExit.location,
    },
  },
});
```

`assessmentLocations` is a partial map keyed by `EntryExitType`. Each supplied mapping requires nonempty `entry` and `interim` locations; `exit` is required for `discoverExit` and household exits. A supplied HUD or VA mapping replaces that type's built-in mapping. Keep the same configuration across retries and use separate workflow instances when providers need different location mappings. Existing journal checks still reject changed instruments or definitions. Additional types have synthetic workflow coverage, not new live acceptance evidence. The November 2, 2026 report of type rejection was traced to the SDK's former HUD/VA restriction, not a reproduced WellSky server failure.

```ts
import {
  openEnrollmentSession, createProgramDiscovery,
  createEnrollmentWorkflow, createFileGwtMutationStore,
  createDateOfBirth, createDateOfBirthUi,
} from '@choiceapps/communityservices-sdk/browser';

const store = createFileGwtMutationStore('/private/application/hmis-journal');
const session = await openEnrollmentSession({ chromium, store });
try {
  const workflow = createEnrollmentWorkflow({
    api, // WellSkyClient with the deployment's explicitly measured mobile date correction.
    discovery: createProgramDiscovery({ page: session.page }),
    helpers: session.helpers,
    store,
    birthDates: createDateOfBirth({
      api, store, ui: createDateOfBirthUi({page: session.page}),
    }),
  });
  const context = { clientId, providerId, type: 'HUD' as const, entryDate };
  const catalog = await workflow.discover(context);
  // Render catalog.entry.definition and catalog.interim.definition in the application.
  const entry = await workflow.createEnrollment({
    ...context, key: `${sourceEnrollmentId}:entry`, assessment: entryPlan,
  });
  const interim = await workflow.createInterim({
    key: `${sourceEnrollmentId}:review:${sourceReviewId}`,
    enrollmentKey: `${sourceEnrollmentId}:entry`, clientId, reviewDate,
    assessment: interimPlan,
  });
} finally {
  await session.close();
}
```

An assessment plan has these fields:

- `answers`: field names mapped to the SDK's `{value}`, `{option: {code|name}}`, or supported `{options}` selectors.
- `subassessments`: new rows with a stable `key`, `parentField`, and child `answers`. Results return `recordsetIds` keyed by those row keys. Equivalent duplicate rows are rejected, including reordered answer properties, equivalent dates and monetary representations.
- `endDates`: explicit `parentField`, `recordsetId`, `startDateField`, `endDateField`, and `endDate`. Interims and exits can close rows; entry plans cannot. The end must be on or after the stored start and enrollment, and strictly before that interim or exit timestamp. Closure readback verifies retained fields as well as the end date. A different existing end date is a conflict.
- `carryForward`: fields or subassessment groups that already have values at this effective date. Unchanged verification groups should be carried forward instead of recreated.
- `notApplicable`: field names mapped to nonempty explanations. Every editable top-level question must have exactly one applicable coverage choice; multiple new rows and closures in the same group are allowed. Display labels and blanks need no answers. Child fields omitted from a new row are encoded as empty; the application must decide which child questions apply.

A replacement-income interim closes the original row using `entry.recordsetIds['earned-income']`, adds one new earned-income row with a new stable key and review-date start, and writes the new overall income answer and amount. The other groups carry forward. Supply timezone-qualified whole-second timestamps; body dates are never shifted. Scalar verification checks both the saved value and its effective timestamp. It uses the assessment API, not the known-defective complete-enrollment entry arrays.

DOB plans use `answers: {SVPPROFDOB: {value: '1984-02-29'}}`, a strict `YYYY-MM-DD` calendar date. Supply the `birthDates` adapter above whenever a plan answers or carries forward DOB. The workflow removes DOB from the ordinary mobile answer batch and runs the dedicated helper after other assessment writes. It preserves the enrollment/effective timestamp, verifies the client API and fresh UI, and returns `result.birthDate`. Household operations apply this to every selected member, including children joining later at their own entry date. All member DOBs are preflighted before enrollment creation or attachment.

For an unknown or declined DOB, answer `SVPPROFDOBTYPE` with its discovered option code and provide a `notApplicable.SVPPROFDOB` explanation. Do not submit a DOB value or carry forward an absent date. This preserves missing DOBs for each household member and does not require the calendar-date writer. See [quality-only DOB plans](profiles.md#unknown-or-declined-birth-date).

When an actual DOB exists and the discovered interim or exit instrument includes DOB, use `carryForward: ['SVPPROFDOB', ...otherUnchangedFields]` if DOB has not changed. If the instrument does not include DOB, leave it out of that plan. This reads the client API and UI even when the mobile answer value is blank, and creates no new DOB history row. Completed workflow retries verify the saved DOB without restoring earlier assessment values. An explicit new DOB at a later effective timestamp uses the helper; correction at an existing timestamp is supported only with matching entry context. Earlier historical corrections stop before writes. Migrate older workflow DOB timestamps to calendar dates explicitly; the workflow rejects timestamp-shaped DOB input.

All cooperating writers must retain the same durable store and keys. The workflow pins program/assessment metadata, rejects changed intent or schema under an existing key, checks complete counted enrollment lists, and records each attempt before sending. It adopts a unique existing enrollment with the same client/provider/type/start and exact existing subassessment rows rather than duplicating them. Multiple matches fail. A lost response is reconciled by readback; an empty, partial or failed read does not authorize resending. Another unfinished workflow for the client blocks subsequent workflow keys until it is reconciled. Existing GWT helpers keep their separate durable review journal.

`await workflow.getStatus({clientId, key})` reads local progress and attempted/verified stages without making network requests. Its status describes the journal, not fresh server state. Retry the same intent to reconcile; do not delete the journal or change keys to bypass an uncertain write. The process is not a transaction: saved enrollment/review records remain when a later stage fails. Locks coordinate this integration on one host; unrelated users or integrations can still race it. These single-client methods populate one person's assessment per call; use the household methods below to coordinate linked enrollments and reviews.

See the [packaged enrollment example](../examples/enrollment-workflow.mts) for a typed application-owned plan builder. The optional browser export requires a dedicated authenticated application page with the administrative read access needed for program assessment discovery.

[Live workflow acceptance](capabilities.md) covers a new synthetic client, exact entry/interim UI values, all verification table pages, and repeated calls with zero REST writes or GWT creations. [DOB workflow acceptance](capabilities.md) covers a leap-day DOB, distinct household member DOBs, a later-entry newborn, and repeated entry/interim operations after later assessment changes.

### Yes/no answers

Mobile answer writes store yes/no values empty (see [yes/no acceptance](assessments.md#yesno-answer-acceptance)). With the default `yesNoWrites: 'mobile'`, a plan that answers a yes/no question leaves its `scalars` stage pending. To save those answers, construct the workflow with the standard endpoint:

```ts
const workflow = createEnrollmentWorkflow({
  api, discovery, helpers, store,
  yesNoWrites: 'standard',
  writeLabel: (question, option) => verifiedLabels.get(`${question.fieldName}:${option.code}`),
});
```

In this mode the mobile batch carries no yes/no answers. After it verifies, a separate `yesno` stage sends every yes/no answer to `assessments.create` together with each mandatory top-level answer, as that endpoint requires:

- Only mandatory lookups are supported, matching the live evidence. Any other mandatory type, including DOB, fails before any write.
- A mandatory lookup in `answers` is sent with its `writeLabel` label.
- A mandatory lookup in `notApplicable` is sent as `""` and stored empty at the assessment date. Blank acceptance was reproduced for a conditionally mandatory lookup only. The workflow refuses this before any write when the field already has a value at that date; answer it explicitly instead.
- A mandatory lookup in `carryForward` is resent with the label of its recorded option. Unlike ordinary carry-forward, this writes a new row for it at the assessment date.

Every mandatory label is resolved before the first write. The `yesno` stage verifies with a generic read one second after the effective instant, because a read at the instant omits yes/no answers, and requires each answer and its effective timestamp to match. The mode is recorded in the journal. An unfinished workflow started in one mode fails in the other rather than switching endpoints, including journals left pending by earlier mobile yes/no attempts; those require separate reconciliation. Yes/no children of new subassessment rows still use the mobile row write, which drops them, so leave them unanswered in workflow rows. Record Coordinated Entry Events, which need yes/no and provider answers, with the [event recorder](coordinated-entry-events.md).

## Correct an existing entry assessment

`correctEntry` patches an entry at its original effective timestamp. Supply the verified `createEnrollment` key as `enrollmentKey` and a new stable `key` for each correction. Configure `enrollmentSession`; built-in sessions discover exact lookup labels automatically. An explicit `writeLabel` callback overrides that discovery. A correction requires an open enrollment with no interim reviews or exit workflows.

```ts
const corrected = await workflow.correctEntry({
  key: sourceCorrectionId,
  enrollmentKey: sourceEnrollmentId,
  clientId,
  answers: changedScalarAnswers,
  clear: scalarFieldsNoLongerAsked,
  subassessments: [{
    key: originalEntryRowKey,
    parentField,
    answers: changedRowAnswers,
    clear: rowFieldsToClear,
  }],
});
```

`answers` uses the ordinary answer and option selectors. `clear` explicitly removes a recorded value; an omitted field stays unchanged. Yes/no fields cannot appear in `clear`: the SDK throws `UNSUPPORTED_YES_NO_CLEAR`, with the affected `fields`, before any correction write or new journal record. Use `{value: false}` to answer `No`; it does not mean blank. No alternative yes/no blanking route has been verified. Do not use `notApplicable` to clear an old answer. Every row key must identify an existing row returned by the original entry operation or explicitly bound with `registerEntryRows`. The correction never creates a second row, deletes a row, or changes the enrollment date.

Scalars use the standard assessment endpoint, which supports same-date updates. The batch includes every mandatory scalar, preserving its current value unless the patch explicitly answers or clears it. Missing mandatory values require an explicit answer, or an explicit clear for a supported non-yes/no type; lookup values require verified write labels. Readback checks one second after the original instant so stored yes/no values are visible.

Row edits send only the changed cells to the existing recordset through the mobile endpoint. Lookup, text, numeric and date cells are supported; provider and yes/no row cells are refused before any write. Untouched cells, all other rows and row IDs must remain unchanged. DOB and household-head changes require their dedicated workflows and cannot be supplied as corrections here. An unmodified mandatory DOB is also refused because the standard batch cannot safely resend it through the DOB helper.

All changes are validated before the first write. Scalar and row batches have separate journal stages, so a partial correction is not rolled back. Retry the same intent and key to reconcile; an uncertain batch is never resent automatically. `getStatus({clientId, key})` reports correction progress. Verified corrections update the original entry's verification expectations, so retrying `createEnrollment` under its old key does not restore the old path. A later correction uses a new correction key. See the [typed example](../examples/entry-correction-workflow.mts).

## Resolve a rejected correction

An attempted correction stays pending until its outcome is established. A 4xx response or an unchanged read alone does not prove non-application, so the SDK does not automatically reset or resend it. New failures expose `code: 'ENTRY_CORRECTION_UNCERTAIN'`, `step`, and an available HTTP `status`. The first failure retains its original `cause`; a failed reconciliation read retains both errors in an `AggregateError`. Only allowlisted failure kind/status are persisted and returned by `getStatus`. Response bodies, messages, credentials and stacks are not written to the journal. Older journals cannot recover diagnostics they never saved.

If independent server or administrative evidence establishes that an attempted correction was not applied, call:

```ts
await workflow.resolveEntryCorrection({
  key: failedCorrectionKey,
  enrollmentKey,
  clientId,
  evidenceReference: independentReviewReference,
  confirmNotApplied: async evidence => rejectionReview.confirmNotApplied(evidence),
});
```

`rejectionReview` is application-owned. Its callback must be read-only and confirm non-application from independent evidence; do not implement it as `() => true` or infer its answer only from HTTP status and `matchesBefore`. The callback receives identities, effective date and sanitized step diagnostics. Do not call the same client's workflow methods from the callback: the client journal lock remains held.

The SDK verifies the complete saved pre-write state before and after confirmation and rechecks enrollment context. A partial application, changed state or unavailable read prevents resolution. Successful resolution marks the correction `rejected` while retaining its original intent, attempted steps, diagnostics and evidence reference. It makes no SDK record writes to WellSky. Repeating the same resolution returns `already-rejected`; submitting that correction key again throws `ENTRY_CORRECTION_REJECTED`. Use a new correction key for the corrected intent only after resolution. A verified successful correction cannot be rejected.

This also supports pending 0.5.0 journals, including those without failure metadata, when the required independent evidence exists. For these journals the callback can receive only a step name and state, with no failure kind or status. The caller must retain its own original failure evidence; the SDK cannot reconstruct it and must not resend the write to obtain diagnostics. A new validation failure that occurs before journaling needs no resolution.

## Household enrollment and interim assessments

Enrollment creation and member preflight use the complete GWT list when the configured `enrollmentSession` supplies `listEnrollments`. The built-in sessions supply it. This avoids the REST `42703` failure for clients with existing household enrollments, including exited enrollments and enrollments in other programs. Reads verify the client, tenant, row identities and count; a failed GWT read never falls back to REST or means an empty list. The current GWT reader refuses lists above 1,000 records. Legacy custom readers without this method retain the counted REST path.

An unreadable list throws `EnrollmentReadError` with `code: 'ENROLLMENT_READ_FAILED'`, `source`, `clientId`, and the original error as `cause`. `phase: 'preflight'` and `committed: false` mean this workflow has not attempted a server write. After a write attempt, the error reports `phase: 'reconciliation'` and `committed: 'unknown'`. Retain the existing key and journal in both cases. A lost write followed by a failed read is never a non-commit.

The same workflow exposes `createHouseholdEnrollment` and `createHouseholdInterim`. Supply `enrollmentSession: session.enrollmentSession` when constructing it. Initial household enrollment requires an existing household and at least two existing clients, including its head. Later interims and exits accept a nonempty subset of enrolled members. Establish household membership separately before enrollment.

```ts
const workflow = createEnrollmentWorkflow({
  api, discovery: createProgramDiscovery({page: session.page}),
  helpers: session.helpers, enrollmentSession: session.enrollmentSession, store,
  birthDates: createDateOfBirth({api, store, ui: createDateOfBirthUi({page: session.page})}),
});
const entry = await workflow.createHouseholdEnrollment({
  key: sourceEnrollmentId, householdId, headClientId,
  providerId, type: 'HUD', entryDate,
  members: [
    {clientId: headClientId, assessment: headEntryPlan},
    {clientId: memberClientId, assessment: memberEntryPlan},
  ],
});
const interim = await workflow.createHouseholdInterim({
  key: sourceReviewId, enrollmentKey: sourceEnrollmentId,
  headClientId, reviewDate,
  members: [
    {clientId: headClientId, assessment: headInterimPlan},
    {clientId: memberClientId, assessment: memberInterimPlan},
  ],
});
```

Each member receives their own assessment plan, enrollment ID, interim ID and verification recordset IDs in `result.members`. Use that member's returned IDs when closing and replacing verification rows. Interims accept a nonempty subset of currently enrolled members, including later entrants. The selected set is fixed under that interim key. Array order may change on retries; membership, dates and answers may not change under an existing key. The application still determines applicability, including child-specific questions and verification types.

All member plans are validated before record creation. The workflow creates the head's entry through REST, attaches members using the existing GWT helper, then populates their assessments individually. One household interim operation creates the linked reviews, followed by each person's assessment writes. Fresh browser reads verify every member's provider, type, entry date, enrollment identity and review membership. These reads avoid the sandbox server's broken grouped enrollment REST projection. Existing independent member enrollments or same-date reviews cause a conflict instead of being silently merged.

Client locks coordinate overlapping household and single-client operations. Durable household reservations block unrelated work after partial completion. A failed attachment, review or answer batch must be reconciled with the same keys and journal; no uncertain mutation is automatically resent. `getHouseholdStatus({headClientId,key})` reports local member progress and generated member keys, which can be passed to `getStatus({clientId,key})`. This is a resumable sequence, not an atomic transaction. The file store fails closed on a concurrent writer or leftover crash lock; inspect and reconcile such a lock before removing it.

See the typed [household example](../examples/household-enrollment-workflow.mts) and [live household verification](capabilities.md). The integration uses the configured tenant and uses an isolated authenticated page.

## Public enrollment reads

The managed session exposes a GWT-backed catalog independently of the workflow:

```ts
const {values: enrollments} =
  await session.enrollmentSession.listEnrollments({clientId});

const detail = await session.enrollmentSession.readEnrollment({
  clientId: headClientId, enrollmentId: headEnrollmentId,
});
// detail.members contains the complete linked clientId/enrollmentId pairs.
```

Use the session returned by `openEnrollmentSession`. Lists include open and exited entries, validate complete counts, and refuse more than 1,000 records. List rows and details include `groupId` and `grouped`. The flag describes a stored group link, including a group with one participant; it is not a member count and requires no per-row detail reads. These fields are required on managed catalog rows and optional on custom detail-reader contracts for compatibility. `groupId` is never a household ID. For a verified household match from a head enrollment, use `discoverHouseholdEnrollment` below.

The same session also exposes `readPicklistOptions({clientId, optionIds})` for exact labels before answers exist. It uses fresh read context, validates counted results, and makes no record writes. Enrollment workflows use it automatically unless `writeLabel` is supplied. See [catalog lookup labels](assessments.md#resolve-lookup-labels-before-an-answer-exists).

## Individual enrollment exits

Use `exitEnrollment` to end a standalone person's program enrollment. It requires a verified `createEnrollment` entry in the same durable store. Supply `enrollmentSession: session.enrollmentSession` and `exitUi: createHouseholdExitUi({page: session.page})` when constructing the workflow. The same exit UI port serves individual and household forms.

Call `discoverExit` with the person's client, provider, type and entry date, then build their assessment plan from `catalog.exit.definition`.

```ts
const exit = await workflow.exitEnrollment({
  key: sourceExitId,
  enrollmentKey: sourceEnrollmentId,
  clientId,
  exitDate,
  destination: 'Rental by client, no ongoing housing subsidy',
  reasonForLeaving: 'Completed program',
  assessment: exitPlan,
});
```

The workflow verifies the exact enrollment and sole participant through fresh GWT reads, checks exit dates against entry and interim dates, and validates the assessment before saving. It journals one exit save attempt and verifies the date, destination, reason and conditional details before writing the assessment. Individual exits can have a null `exitSubgroupId`; the result preserves that value. The journal pins any returned subgroup identity on retries.

Retain the same key, intent and store after failures. A lost save response triggers readback, never an automatic resend. Use `getStatus({clientId, key})` to inspect local progress. Exit metadata and assessment writes are separate stages, so a saved exit can remain pending assessment verification. `endDates` closes only the explicitly selected verification rows; enrollment exit does not automatically end every verification record.

For a person in a linked household enrollment, use `exitHousehold` with that person as the only selected member. `exitEnrollment` rejects linked groups to preserve household head coverage. Neither method ends household membership. See the [typed individual exit example](../examples/individual-exit-workflow.mts). The integrator reported successful standalone exit and same-key no-write retry acceptance on November 10, 2026; see [reported sandbox acceptance](capabilities.md#integrator-reported-acceptance-november-10-2026).

## Adopt an enrollment entered manually in WellSky

Use `adoptEnrollment({key, clientId, enrollmentId})` for a standalone enrollment. For linked household enrollments, use `adoptHouseholdEnrollment({key, householdId, headClientId, members})`, where each member supplies both `clientId` and `enrollmentId`. Supply the complete linked cohort, including members already exited, and the original enrollment head. Adoption verifies authoritative GWT identities, program/type, entry dates, current household membership, head relationships when present, and head coverage across all enrollment intervals.

Adoption writes only to the local durable journal. It does not create, attach, exit or modify an HMIS record. Later entrants retain their own original entry dates. An enrollment already tracked under another entry key is rejected; use its existing key. Retry an interrupted adoption with the same inputs and store.

After standalone adoption, its key can be used as `enrollmentKey` for `createInterim`, scalar-only `correctEntry`, or `exitEnrollment`. After household adoption, the group key works with `createHouseholdInterim` and `exitHousehold`; use the returned member's `key` for that person's scalar-only `correctEntry`. Correction still requires an open entry without reviews or exits. Do not use an all-not-applicable `createEnrollment` call merely to link an existing entry: it can create an enrollment when no match exists. Exit assessment plans and normal household head rules still apply. Adoption initially returns empty `recordsetIds`. Use `registerEntryRows` below to bind verified existing recordsets before row corrections; a new invented key alone cannot identify a historical row. See [manual-entry exit examples](../examples/existing-enrollment-exits.mts).

### Discover a household from its head enrollment

```ts
const discovered = await workflow.discoverHouseholdEnrollment({
  headClientId, headEnrollmentId,
});
// discovered: householdId, householdSource, providerId, type, members
const adopted = await workflow.adoptHouseholdEnrollment({
  key: sourceEnrollmentKey, headClientId, headEnrollmentId,
});
```

Discovery reads the linked enrollment cohort through GWT and matches it against complete current household membership reads. It requires one household containing the cohort, the same head, and membership dates covering each entry. It verifies that household again before returning `householdSource: 'verified-membership'`. This is a verified membership match, not a native historical household pointer on the enrollment. Zero matches, multiple matches, incomplete reads or changed relationships fail without adopting. A unique current match does not prove the enrollment's original historical household association. If that original association is required, verify it independently; the SDK does not expose a native historical pointer. Explicit adoption inputs still require active household membership, the matching head and valid dates. Known historical IDs cannot bypass those guards, so inactive or changed historical households remain unsupported. No record is written to WellSky during discovery or adoption.

### Register existing entry rows

```ts
await workflow.registerEntryRows({
  key: sourceRegistrationKey,
  enrollmentKey: adoptedEntryKey,
  clientId,
  rows: [{key: 'entry-ce', parentField, recordsetId: existingRecordsetId}],
});
// correctEntry can now reference key: 'entry-ce' with the same parentField.
```

Select explicit recordset IDs from authorized assessment reads. Registration verifies the enrollment, question definition, and each row's presence in both entry-time and current reads. It stores immutable key/parent/recordset bindings in the local journal and makes no WellSky record writes. Same-key repeats return `already-present`; duplicate aliases, absent rows, rebinding, and pending operations are refused. Native entry row keys already work without registration. For household adoption, use each returned member's entry `key` and register that member's rows separately. Registration does not establish who originally created a row or make later edits eligible: `correctEntry` still enforces open-entry and no-review rules. See [the typed example](../examples/enrollment-discovery-and-correction.mts).

### Classify workflow failures

`EnrollmentWorkflowError` exposes a stable `code`, `operation`, and `committed`. Classify by code instead of message text. Pre-write validation, discovery and adoption failures report `committed: false`. Any attempted write, relevant prior attempt, or unreadable prior outcome remains `'unknown'`. The marker describes WellSky record writes for that operation, not local journal changes. `cause` preserves the original error where available.

A failed `resolveEntryCorrection` can have `committed: false` because resolution itself writes no WellSky records, while `originalCommitted: 'unknown'` describes the original correction. Never use a resolution error's marker to infer non-application of the original write. See [error codes and recovery](troubleshooting.md#workflow-error-codes).

## Household exits

Add `exitUi: createHouseholdExitUi({page: session.page})` to the workflow options. `discoverExit` returns the provider's entry, interim and exit definitions; use the exit definition to build each person's plan.

```ts
const exit = await workflow.exitHousehold({
  key: sourceExitId, enrollmentKey: sourceEnrollmentId,
  headClientId, exitDate,
  destination: 'Rental by client, no ongoing housing subsidy',
  reasonForLeaving: 'Completed program',
  members: [
    {clientId: headClientId, assessment: headExitPlan},
    {clientId: memberClientId, assessment: memberExitPlan},
  ],
});
```

This requires a verified household entry in the same durable workflow store. Supply only the members exiting on this date, including a single member if needed; the household head need not be selected. Use separate stable keys for exits on different dates. Every exit plan is validated before saving. The browser submits one shared exit, then authoritative GWT reads verify every member's exit date, destination, reason and exact linked exit group before individual assessment writes. The returned members include `projectExitDate`, `exitSubgroupId` and any new verification `recordsetIds`. Exit dates cannot precede entry or an existing interim.

To end the entire household's program enrollment, include every enrolled member who has not already exited. Already exited members retain their earlier dates. The existing head-coverage checks still apply.

Use `endDates` only for verification records that changed, with replacement rows in `subassessments`; use `carryForward` for unchanged groups. Ending enrollment does not automatically end all verification records. Stored dates are never shifted. Discovery and completeness checks do not decide individual eligibility or which verification types apply.

Reusing the same key and unchanged plans reconciles against fresh reads without repeating writes, including after a lost save response. A partial household exit, unexpected linked member, conflicting exit metadata, schema drift, or an uncertain uncommitted save fails closed. Do not change keys or delete journals to bypass these checks. This remains a non-atomic sequence and does not prevent unrelated integrations or users from editing concurrently.

The supplied Swagger has no exit mutation. The optional UI port exposes `listOptions({clientId,enrollmentId})` for available destination, reason and `rentalSubsidyTypes` choices. It opens the form and cancels without saving. Conditional exit details are shared by the selected members:

```ts
// Rental destination with an ongoing subsidy:
const subsidyDetails = {
  destination: 'Rental by client, with ongoing housing subsidy',
  destinationDetails: {
    kind: 'rental-subsidy' as const,
    rentalSubsidyType: 'RRH or equivalent subsidy',
  },
  reasonForLeaving: 'Completed program',
};
// Separate explanations for the destination and reason:
const otherDetails = {
  destination: 'Other',
  destinationDetails: {kind: 'other' as const, explanation: 'Application-provided destination explanation'},
  reasonForLeaving: 'Other',
  reasonForLeavingOther: 'Application-provided reason explanation',
};
// Spread the chosen details into exitHousehold alongside the key, date and member plans.
```

Subsidy types must match a currently available choice. Other explanations must contain 1 to 100 characters without leading/trailing whitespace or control characters. Missing, irrelevant or contradictory details fail before saving. The UI port fills each explanation beside its own labeled field and verifies the selected subsidy. `readExitDetails` reopens a saved member exit and reads its persisted details without saving. The workflow compares these details for every member on initial readback and retries; changed explanations or subsidy types conflict instead of being silently overwritten. Custom UI ports must implement `readExitDetails` to support conditional details. An unexpected legacy `Subsidy` form is still rejected because its storage contract has not been verified. Use the port through the journaled workflow, not as an independently idempotent writer. See the [typed exit example](../examples/household-exit-workflow.mts) and [live conditional-exit verification](capabilities.md).

## Later household members and staggered exits

`exitHousehold` and `createHouseholdInterim` accept selected members, including members added later. Continue supplying the original household `enrollmentKey` and `headClientId`. Each member retains their own enrollment ID and entry date. Exit subgroups are checked against the selected IDs; unselected enrollment dates, exits, conditional exit details and reviews are compared before and after a pending exit.

Head of household is fixed for the enrollment. A proposed or detected head change is a red flag, including after the original head exits. Using another member as the UI/RPC target never promotes that member, and a later entrant cannot become the enrollment head. When the discovered assessment includes `HUD_RELATIONTOHOH`, household workflow plans reject answers that promote another member, demote the original head, or clear the relationship. Interim and exit preflight also reject conflicting stored relationships in that assessment. These checks do not govern independent raw API writes.

An enrollment without a head of household is invalid data even when WellSky accepts it. Household helpers throw `EnrollmentWorkflowError` with an explicit `invalid enrollment data` reason when the designated head is absent or other members would remain enrolled beyond the head's exit. Preflight checks both existing records and the requested change before reserving or writing the operation, and readback checks the saved group. A head-only exit is allowed only after every other member has an exit at or before that date. A later child cannot join a group whose head has exited. Existing orphaned groups, including retries against them, require explicit reconciliation; the helper does not promote a replacement or silently repair dates. Closed groups with valid historical head coverage can still be retried without duplicate writes.

Selecting every enrolled member in one `exitHousehold` call saves their exit metadata through one UI-generated `updateEntryExitWithHouseholdMembers` GWT request. Per-member assessment writes follow through REST, so the complete workflow is not atomic. [Live required-head acceptance](capabilities.md) verifies blocked head-first exits, separate member exits, head-last and all-member exits, unchanged retries, and persisted UI forms on new synthetic clients.

When the discovered instrument exposes the head relationship question, the designated head must have a valid Self answer in the plan or at the assessment's effective date. Marking the question not applicable cannot substitute for a missing relationship. Standalone enrollment helpers treat the sole client as head. These guards cannot enforce constraints on writes made directly through WellSky or the raw REST/GWT APIs.

A head correction must be a separate, explicit retroactive correction, and the replacement must have the same first entry date as the original head. This workflow does not implement that correction or silently change its journal identity. An actual change of head during participation generally requires exiting all enrollments and creating a fresh enrollment with the new head. A fresh entry may establish relationships different from prior assessment history.

For a newborn or a child moving in later, establish the child in the existing household first, with the correct relationship and joined date. Then add a separate immutable operation:

```ts
const workflow = createEnrollmentWorkflow({
  api, discovery, helpers: session.helpers, store,
  birthDates: createDateOfBirth({api, store, ui: createDateOfBirthUi({page: session.page})}),
  enrollmentSession: session.enrollmentSession,
  exitUi: createHouseholdExitUi({page: session.page}),
  memberEntryDatePort: createMemberEntryDatePort({
    api, enrollmentSession: session.enrollmentSession,
  }),
});
const child = await workflow.addHouseholdMembers({
  key: sourceChildEntryId, enrollmentKey: sourceEnrollmentId, headClientId,
  entryDate: childEntryDate,
  members: [{clientId: childClientId, assessment: childEntryPlan}],
});
```

The later date must follow the original household entry, and an existing member must still be enrolled. The child must have joined the household on or before their own entry date. New client and household-member creation remain separate operations. The application supplies age-appropriate answers and explicit applicability reasons; the SDK does not infer them.

The workflow discovers and pins the new member's assessments, attaches the member through a fresh GWT request, then uses a date-only REST update for their enrollment. It verifies all linked enrollment dates and exits through GWT before populating answers and verification rows at the child's own entry date. Existing assessment dates are never rewritten. These stages are not atomic: a failure may leave a linked child awaiting the correct date or assessment completion. Keep the same journal and key to reconcile; an uncertain date update is never blindly resent.

Retries can verify an earlier entry, addition or exit after later household changes without creating duplicates. All cooperating writers must share the durable store. External changes to enrollment identity, selected exit membership, or pending-operation preserved state cause a conflict. The UI adapter scopes checkbox selection to the active dialog because the additional-members popup can overlay another visible household tree.

See the [typed lifecycle example](../examples/household-lifecycle-workflow.mts) and [sandbox verification](capabilities.md).

## Current Living Situation contacts

For street outreach and night-by-night shelter meaningful contacts, use the [Current Living Situation recorder](current-living-situation.md). Start always comes from program entry, information date comes from the contact, and end may be empty. Generic `subassessments` plans do not infer these event rules and can adopt an existing semantically matching row. They are not a distinct-contact recorder. Do not use the income replacement example to close or replace CLS contact history.
