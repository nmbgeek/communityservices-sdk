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

Use the raw `assessments.get`, `assessmentsMobile.getAnswers`, and `enrollments.getAssessment` methods for recorded answers. Use `encodeAnswers` and `encodeNewSubassessmentRow` for endpoint-specific encoding. Mobile lookups use option IDs; standalone/enrollment lookups require an explicit `writeLabel` resolver with tenant-verified labels. Raw option names are not assumed to be valid write labels. Provider answers are refused for mobile writes because that endpoint can silently discard them. Answer-state code mappings and multi-value serialization are caller-supplied; a refusal is never converted to `No`.

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

Live testing found that `POST /assessmentsmobile/AddAssessmentAnswer` recorded effective dates seven hours earlier than the requested instant, with `Z`, explicit offsets, and no suffix. Winter and summer test dates both shifted seven hours in that session. Standalone assessment writes preserved the requested instant. This does not establish the upstream timezone or guarantee that its offset stays constant.

For a deployment with a measured mobile shift, configure `mobileAssessmentDateCorrectionMinutes` on `WellSkyClient`. For example, **420 adds seven hours to the outgoing mobile query**, compensating for a verified upstream subtraction of seven hours. The default is unset and preserves raw behavior; the SDK never infers a correction from the host timezone or tenant name.

With correction enabled, supply an ISO timestamp with `Z` or an explicit numeric offset. Invalid calendar dates, ambiguous timestamps, and correction values outside integer minutes from -840 to 840 are rejected before authentication/network activity. Only the mobile write's `dateEffective` query is corrected. Read queries, standalone/enrollment writes, and date values inside answer bodies are unchanged. Do not pre-adjust dates as well as configuring the client.

Verify `date_effective` through a generic assessment read and check UI history after writes. Revalidate the correction when upstream behavior changes, including seasonal clock changes; it is a measured compatibility setting, not automatic timezone handling. Mobile reads can omit UI-visible combination answers, so an empty mobile answer alone does not prove absence. Standard standalone writes are preferable for scalar answers when that endpoint fits the application; mobile remains necessary for verified in-place recordset updates.

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

This is generic recordset handling. It reads the current row, targets its existing `recordset_id` with `isDeleted: false`, preserves the other returned values, and verifies the end date, preserved values, and recordset list. It never deletes/recreates the row or retries the write. The result is a `WriteResult`, including `unverified` if the server silently ignores the update. Rows containing provider questions are refused because mobile writes cannot preserve those values reliably.

An October 22, 2026 sandbox probe confirmed that an existing recordset could be end-dated in place and retained the same ID. Application policy decides when historical records should end or be replaced; the SDK verifies the requested operation.

## Current Living Situation history

The [contact recorder](current-living-situation.md) retains one row per meaningful contact, with program-entry start, contact information date, actual living-situation answer, and an open end. The complete-enrollment scalar is not the contact history. Optional Verified By may identify the recording program using its discovered question representation.
