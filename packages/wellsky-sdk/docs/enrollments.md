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

`createEnrollmentWorkflow` composes the provider catalog, current program assessment defaults, question/picklist metadata, REST enrollment and answer writes, and the durable GWT interim helper. It accepts an **existing client ID** and supports HUD and VA program defaults. It does not create clients or infer program eligibility, answers, conditional applicability, or which verification types a program requires.

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

## Household enrollment and interim assessments

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
