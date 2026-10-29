# Record Current Living Situation contacts

[Documentation index](README.md) · [Assessment guide](assessments.md) · [Public contract](../browser/current-living-situation.d.mts) · [Example](../examples/current-living-situation.mts)

Street outreach teams and night-by-night emergency shelter staff generally record Current Living Situation at each meaningful client contact. A contact is an event. An unchanged living situation does not make the next contact a duplicate.

| Field | Meaning |
| --- | --- |
| Subassessment Start Date | The selected client's program entry date, for every contact in that enrollment |
| Subassessment End Date | May be null or empty. A later contact does not close the previous contact row |
| Information Date | The date that contact happened |
| Current Living Situation | The client's actual living situation on that contact date, selected from this question's current picklist |
| Living Situation Verified By | Optional unless the actual platform requires it. May identify the program recording the data |

Do not use contact date as the row start, or replace the previous contact's information date or living-situation answer. Do not copy the income-verification close-and-replace pattern to these event records. Program entry, the contact's information date, and the assessment answer's effective timestamp have separate roles.

## Discover the fields and choices

Read `api.assessments.getDefinition({clientId, assessmentCode, refresh: true})` for the program's instrument. Supply its exact virtual fields to `createCurrentLivingSituationRecorder`. The SDK does not choose a program, assessment, project type, or living-situation answer from a shelter bed assignment.

An October 24, 2026 sandbox metadata read exposed this mapping:

| Role | Virtual field | Type |
| --- | --- | --- |
| Parent | `SVP_HUD_CURRENTLIVINGSITUATION` | sub_assessment |
| Start | `SVP_HUD_CURRENTLIVINGSITUATIONSTART` | date |
| End | `SVP_HUD_CURRENTLIVINGSITUATIONEND` | date |
| Information date | `SVP_HUD_CLS_INFODATE` | date |
| Living situation | `SVP_HUD_CLS_CURRENTLIVINGSIT` | lookup |
| Verified By | `SVP_HUD_CLS_LIVINGSITVERIFIEDBY` | lookup |

The form metadata explicitly labels Information Date as Date of Contact. Verified By had program options with separate **picklist option IDs**. Resolve the actual option from that question and use `{option: {code: discoveredCode}}`; do not send a numeric program ID or construct a code from it. A recording program is allowed, but it is not a required default. If another verified instrument exposes text instead, supply `{value: programDisplayName}`. Numeric values are rejected for text questions. Provider-valued questions are refused on the mobile path because the SDK cannot guarantee their persistence there.

The helper requires information date and living situation, derives start from the stored enrollment, and sends an empty end. It leaves other answers absent unless supplied. `additionalAnswers` accepts actual extra platform questions and cannot override the mapped fields. Metadata-required additional answers must be provided explicitly. Conditional rules not represented in metadata still require application/form validation; do not invent defaults. A platform requirement for a nonempty end raises `platform-requires-end-date` instead of changing this workflow's rule.

## Record and retry

Use the [typed example](../examples/current-living-situation.mts) with an API client configured for the target tenant and durable `createFileGwtMutationStore` or equivalent shared store. No browser is launched and no credentials are loaded by this recorder.

Each input specifies an existing client and enrollment, the instrument, a stable contact event key, information date, and the selected living-situation answer. It does not accept a caller-supplied start date. The helper reads the counted enrollment list and derives start from the selected enrollment's `projectStartDate`. This matters for a later-entering household member: use that person's enrollment, not another member's entry. Contacts before entry or after a recorded exit are refused. Failed, incomplete, or ambiguous enrollment/assessment reads block writes.

As with the existing enrollment workflow, date inputs use timezone-qualified ISO instants with whole-second precision. Supply the contact's intended date and time in the program's timezone, for example `2026-10-24T09:00:00-04:00`. The information-date answer and assessment effective-date query use that instant; the row start uses program entry. The helper does not use the host timezone or shift body dates. Only a separately configured, measured mobile query correction affects the query; see [date contracts](dates-and-answers.md). Date-only input is rejected rather than interpreted in an unknown timezone.

For outreach, record each meaningful outreach contact with its own upstream event key and the situation reported that day. For night-by-night shelter, record each meaningful contact with a separate key; do not assume a bed-night automatically supplies a contact or the client's answer. Two distinct contact keys create two rows even if the date and answers are identical. Same-key retries verify the original recordset ID and never submit again.

The recorder snapshots all existing CLS rows, journals the attempt before submitting one new `recordset_id: 0`, then requires exactly one additional matching row and preservation of earlier rows. It does not adopt a preexisting row merely because its answers match. Lost responses reconcile through the journal and fresh reads. Missing, changed, multiple, or ambiguous new rows leave the attempt unresolved, blocking resubmission and later contact keys for that client. Restore the same journal and reconcile the original operation; never clear it or generate a replacement key to force a retry.

All callers must share the durable store. The journal does not lock external writers or provide server-side idempotency. Coordinate other applications and manual edits during a save; one concurrent identical external row cannot be distinguished from the requested save by answer content alone. Journals contain contact snapshots and must remain private. Do not rebuild lost journals by guessing from date and living situation.

## Verification limits

The helper uses generic assessment reads for saved rows, not the complete-enrollment projection's scalar current-living-situation property. A scalar cannot represent contact history. It does not create an interim review, end an enrollment, overwrite a prior contact, or schedule contacts automatically.

The regression suite covers multiple identical contacts, later contacts, optional program verification, metadata-required fields, date and identity drift, preservation failures, lost responses, and no replay. On October 24, 2026, a test in a sandbox tenant created three rows for an existing synthetic client: two contacts with identical dates and answers, plus a later contact with recording-program verification. Fresh assessment reads confirmed all three recordset IDs, program-entry starts, contact information dates, null ends, and selected lookup values. Same-key retries retained those IDs without additional writes. No extra answers were required by that instrument.

That live test used a coordinated-entry instrument with an existing transitional-housing enrollment. It verifies the shared CLS storage and retry path, not every street outreach or night-by-night shelter form, conditional rule, role, or tenant deployment. If the counted enrollment read hits the documented grouped-enrollment server error, the recorder stops; it does not replace the entry date with the contact date or infer an empty enrollment list.
