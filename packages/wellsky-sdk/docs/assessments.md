# Read and encode assessments

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

## Assessments, questions, and picklists

```ts
const context = {
  clientId,
  assessmentCode: assessmentCodeFromYourConfiguration,
  effectiveDate: '2026-10-22',
};
const definition = await client.assessments.getDefinition(context);
const questions = await client.questions.list(context);
const question = await client.questions.get({ ...context, fieldName: fieldFromYourMapping });
const picklists = await client.picklists.list(context);
const option = await client.picklists.resolve({
  ...context,
  fieldName: fieldFromYourMapping,
  code: optionCodeFromYourConfiguration,
});
```

These are read-only operations. Definitions combine generic assessment reads with mobile metadata reads, preserving mandatory flags, nested questions, option IDs/codes/names, and unresolved lookups. Client answers and recordset data are excluded from definitions and their cache. Option catalogs can still contain private tenant labels; do not publish them.

Use `parentPath` to distinguish duplicate field names in different subassessments. Resolution prefers a supplied code, then a supplied name; missing or ambiguous options throw `UnknownPicklistValueError`. Picklists remain scoped to their questions so narrower allowed sets are not combined incorrectly.

The default metadata cache TTL is 60 seconds with 100 entries per client. Configure `metadataCacheTtlMs` and `metadataCacheMaxEntries`, pass `refresh: true`, or call `clearMetadataCache()`. Returned objects are copies. `compareDefinition(expected, definition)` compares expectations supplied by the application and reports added, removed, retyped, and newly mandatory fields.

WellSky requires a client context and known assessment code for these reads. There is no documented global assessment-list or standalone picklist-list endpoint. Mobile option metadata has no effective-date filter, so definitions explicitly identify its options as current even when the generic assessment read is dated. Metadata also does not provide a complete questionnaire branching engine.

Use the raw `assessments.get`, `assessmentsMobile.getAnswers`, and `enrollments.getAssessment` methods for recorded answers. Use `encodeAnswers` and `encodeNewSubassessmentRow` for endpoint-specific encoding. Mobile lookups use option IDs; standalone/enrollment lookups require an explicit `writeLabel` resolver with tenant-verified labels. Raw option names are not assumed to be valid write labels. Some HUD-marked choices require `(HUD)` in the full write label even when metadata `name` omits it. Do not infer this from trailing whitespace or append the suffix to every option. Continue supplying tenant-verified labels until a label resolver has authoritative metadata; recorded `answer_value_text` is useful evidence for the corresponding option. Provider answers are refused for mobile writes because that endpoint can silently discard them. Answer-state code mappings and multi-value serialization are caller-supplied; a refusal is never converted to `No`.

## Yes/no answer acceptance

`encodeAnswers` encodes a `yes_no` value of `true` or `"Yes"` as `"Yes"`, and `false` or `"No"` as `"No"`. Which endpoint persists that value matters more than the encoding.

Reproduced on November 2, 2026 in a sandbox tenant with synthetic clients:

- **Mobile `AddAssessmentAnswer` does not store yes/no values.** Requests with `"Yes"`, `"1"`/`"0"`, and `"true"`/`"false"` returned success and created a row at the intended effective date, but its value read back empty through both the generic and mobile reads. An integrator's 30-answer entry batch showed the same result.
- **Mobile writes are insert-only per question and effective date.** A second mobile write to any question that already has a row at that date returned HTTP 400 `An error occurred while saving the entity changes`. This affected yes/no and integer questions alike, so a mobile retry cannot repair an empty yes/no row.
- **A failed mobile batch can still save part of its answers.** On November 2, 2026, an integrator's 15-answer batch returned HTTP 400 a few seconds after the client's household enrollment and entry answers were created. Afterwards one of the 15 answers was stored and the others were empty. Its error body was not captured, and the client's rows just before the send were not read. Later sends of the batch failed with the insert-only error above because that row existed. On November 3, the same byte-identical batch returned 200 and read back completely on fresh synthetic clients with no enrollment, an enrolled single adult, and an enrolled household head; batches with and without the score total question, and in either order, also succeeded. The cause is unknown; a race with enrollment creation is possible but unproven. Treat a failed mobile write as uncertain and reconcile it from a read, as the enrollment workflow does; never resend it.
- **Standard `assessments.create` stores `"Yes"`/`"No"`.** It rejects `"true"`/`"false"`. It updates existing rows at the same effective date, including empty yes/no rows created by mobile writes, and changed only the answers it was sent in a full before/after comparison.
- **Every standard write must include every mandatory answer**, even one already recorded at that date; otherwise it returns `All mandatory answers are not provided`. A conditionally mandatory lookup that does not apply can be sent as `""`; it is stored empty at that date.
- **Generic reads omit yes/no answers at exactly their effective instant.** `assessments.get` with `dateEffective` equal to the saved instant returns `null` for those yes/no answers while other types read normally. One second later returns the saved value. The standard create response has the same omission. Mobile reads return the value, but they have no date filter and show only the latest row, so a later record hides the date being checked.
- **Mobile row writes drop yes/no and provider answers too.** In new Coordinated Entry Event rows, a yes/no result and a provider location were missing after a successful mobile write, while the standard endpoint saved both. `encodeNewSubassessmentRow` refuses answered provider children for mobile and omits unanswered ones. See [Coordinated Entry Events](coordinated-entry-events.md).
- **The mobile date correction does not apply to standard writes.** A standard create sent the uncorrected instant and stored it unchanged.

The enrollment workflow writes yes/no answers through the mobile batch by default. That keeps their stage pending because the saved values never verify. Construct it with `yesNoWrites: 'standard'` and a `writeLabel` resolver to send them through `assessments.create` instead; see [the enrollment workflow](enrollments.md#yesno-answers). It never treats an empty yes/no answer as `No`, skips a requested field, or switches endpoints for a stage that was already attempted. For a minimal reproduction, [enable private error diagnostics](troubleshooting.md#inspect-an-upstream-error-privately) and retain the question's current metadata.

## Shared questions across assessment instruments

An entry assessment and a standalone form can reference the same stored question. Changing `assessmentCode` does not make a second answer at the same client/question/effective instant available for a mobile insert. The integrator reported this for `HPTARGETINGSCORETOTAL` on an entry and form 1002: when the stored value differed, the mobile batch was rejected. Compare question identifiers and effective dates, not only form names.

Read the existing answer before planning a mobile scalar insert. If it already exists at that instant with another value, use a supported standard correction/update path after resolving the original operation; do not move its timestamp to evade the collision. Raw `assessmentsMobile.addAnswer` remains a raw write and performs no implicit read or cross-form collision check. Never switch endpoints to retry an uncertain batch.

## Race and ethnicity combinations

`encodeAnswers` recognizes the standard `HUD_RACEETHNICITY` field. It resolves single-category and multiple-category answers to the tenant's `RACE_ETH_COMBO_*` option IDs. A single White answer uses `RACE_ETH_COMBO_WHI`, even when the caller supplies `RACE_ETH_WHI`. Atomic option IDs can read back with a label while appearing blank in the UI.

```ts
const answers = encodeAnswers(definition.questions, {
  HUD_RACEETHNICITY: {
    options: [{ code: 'RACE_ETH_HSP' }, { code: 'RACE_ETH_PI' }],
  },
}, { endpoint: 'mobile' });
```

Category order is normalized and duplicates are removed. Missing combinations and mixtures of categories with missing-answer states fail validation. Names resolve only among combination entries to avoid duplicate-label ambiguity. Other lookup fields keep their existing behavior. Raw methods still send the supplied answer payload; use the encoder rather than hardcoding numeric IDs. Standalone/enrollment encoding still requires `writeLabel` for the resolved combination option.

## Mobile effective-date correction

Live testing found that `POST /assessmentsmobile/AddAssessmentAnswer` recorded effective dates seven hours earlier than the requested instant, with `Z`, explicit offsets, and no suffix. Winter and summer test dates both shifted seven hours in that session. Standalone assessment writes preserved the requested instant. The project maintainers report that WellSky servers run on Mountain Standard Time (UTC−7, no daylight saving), which matches the constant seven-hour shift and the UTC−7 DOB conversion. WellSky has not documented this as an API contract, so the SDK still does not infer the correction.

For a deployment with a measured mobile shift, configure `mobileAssessmentDateCorrectionMinutes` on `WellSkyClient`. For example, **420 adds seven hours to the outgoing mobile query**, compensating for a verified upstream subtraction of seven hours. The default is unset and preserves raw behavior; the SDK never infers a correction from the host timezone or tenant name.

With correction enabled, supply an ISO timestamp with `Z` or an explicit numeric offset. Invalid calendar dates, ambiguous timestamps, and correction values outside integer minutes from -840 to 840 are rejected before authentication/network activity. Only the mobile write's `dateEffective` query is corrected. Read queries, standalone/enrollment writes, and date values inside answer bodies are unchanged. Do not pre-adjust dates as well as configuring the client.

Verify `date_effective` through a generic assessment read and check UI history after writes. Generic reads return date answers such as `2026-11-20 10:00:00-07`. `Date.parse` handles that form differently across JavaScript engines, returning NaN on some, and reads a value without an offset as host-local time. Compare instants with `parseRestInstant` from the package root, which treats a missing offset as UTC. Revalidate the correction when upstream behavior changes, including seasonal clock changes; it is a measured compatibility setting, not automatic timezone handling. Mobile reads can omit UI-visible combination answers, so an empty mobile answer alone does not prove absence. Standard standalone writes are preferable for scalar answers when that endpoint fits the application; mobile remains necessary for verified in-place recordset updates. Mobile scalar writes only insert a row for a question and date; see [yes/no answer acceptance](#yesno-answer-acceptance).

## Read verification records at enrollment

`readEnrollmentVerifications` explicitly reads the current generic assessment and filters the four standard groups: income, non-cash benefits, health insurance, and disabilities. This avoids the observed complete-enrollment entry projection defect, which excluded records near enrollment even when they were created correctly through the UI.

```ts
import { readEnrollmentVerifications } from '@choiceapps/communityservices-sdk';

const snapshot = await readEnrollmentVerifications(client, {
  clientId,
  assessmentCode, // Your instrument must expose all four verification groups.
  enrollmentDate: '2026-10-18T12:00:00-04:00',
});

const income = snapshot.groups.find(g => g.fieldName === 'MONTHLYINCOME');
// income.records contains the original recordset IDs and answer fields.
// income.excluded explains each exclusion as "not_started" or "ended".
```

Available from the root, V2, and V3 entry points in ESM and CommonJS. The helper makes one assessment GET, without `dateEffective`, and forwards `signal`, `timeoutMs`, and `correlationId`. An effective-date read can omit backdated records, so selection uses each row's own start/end values instead of its answer effective timestamp or `isActive` flag.

Intervals are inclusive: **start <= enrollment <= end**, with null/empty ends open. Comparisons use exact instants, including fractional seconds; end dates are not rounded to the end of a calendar day. Supply an enrollment timestamp with `Z` or a numeric offset. Offset-bearing ISO and WellSky SQL-style row dates such as `2026-10-18 09:00:00-07` are supported. No host timezone, seven-hour correction, or date-only timezone is inferred. Invalid input fails before a read. Missing/duplicate groups or date fields, invalid/ambiguous intervals, and duplicate record IDs produce protocol errors instead of silently implying zero records. Present empty groups return empty arrays.

Results contain detached copies of the original records and dates, plus `source: 'current-assessment'`. The helper never writes, changes stored dates, verifies HUD badges, merges overlapping records, or changes the raw complete-enrollment response. It returns the currently accessible record versions filtered by dates, not an audit-history reconstruction: later edits and access restrictions can affect what the assessment API exposes. No tenant-specific assessment code or expected type count is built in.

## End-date an existing subassessment

```ts
const result = await client.subassessments.setEndDate({
  clientId,
  assessmentCode,
  parentField,
  recordsetId: 456,
  endDateField,
  endDate: '2026-10-22',
  effectiveDate: '2026-10-22T12:00:00-04:00',
  preflight: async (options) => { /* Apply your program's review-date and eligibility rules. */ },
});
```

This is generic recordset handling. It reads the current row and sends only the end-date cell to its existing `recordset_id` with `isDeleted: false`. When the row has never had an end date, the cell's question comes from the parent's question list. It then verifies the end date, every other row and cell of the subassessment, and the recordset list. It never deletes/recreates the row or retries the write. The result is a `WriteResult`, including `unverified` if the server silently ignores the update or changes another value.

On November 2, 2026, sandbox mobile updates that sent only the end-date cell kept the row's other answers, including provider-valued locations and yes/no answers that mobile cannot write itself, so rows with provider questions, such as Coordinated Entry Events, can be end-dated. Earlier versions resent every cell and refused those rows.

An October 22, 2026 sandbox probe confirmed that an existing recordset could be end-dated in place and retained the same ID. Application policy decides when historical records should end or be replaced; the SDK verifies the requested operation.

## Current Living Situation history

The [contact recorder](current-living-situation.md) retains one row per meaningful contact, with program-entry start, contact information date, actual living-situation answer, and an open end. The complete-enrollment scalar is not the contact history. Optional Verified By may identify the recording program using its discovered question representation.
