# Date and answer contracts

[Documentation index](README.md) · [Assessment guide](assessments.md)

The SDK deals with several kinds of dates. Applying one correction to all of them corrupts data.

| Value | Input | Behavior |
| --- | --- | --- |
| Raw REST date field | String required by that operation | No general timezone conversion or business calendar validation |
| Workflow entry, interim, exit, row start/end | Timezone-qualified ISO instant, whole-second precision | Validates dates and compares instants; does not shift stored dates |
| Workflow `SVPPROFDOB` | `{value:'1984-02-29'}` | Strict calendar date through `birthDates`; timestamp input is rejected |
| Standalone DOB helper | `dateOfBirth:'1984-02-29'`, separate `effectiveDate` instant | Encodes DOB at `07:00:00Z` for the tested fixed UTC-7 REST conversion; checks browser compatibility |
| Mobile answer effective date | ISO instant when correction is configured | Optional measured minutes adjust only the outgoing AddAssessmentAnswer query |
| Verification snapshot enrollment date | ISO instant with offset | Inclusive comparison against the original row start/end instants |
| Goal case-note date | `YYYY-MM-DD` | Browser-local calendar date |
| Service dates and financial-assistance period | Explicit timestamps | Separate fields; the period is not inferred from the service dates |

The observed seven-hour mobile effective-date shift and DOB conversion are separate server behaviors. `mobileAssessmentDateCorrectionMinutes: 420` compensates for a measured subtraction in one mobile query. It does not fix DOB values or verification array filtering. Never pre-adjust a timestamp and also enable the correction. Revalidate measured offsets against saved effective dates after deployment/server changes.

The DOB helper verifies client API, assessment effective date, and fresh UI values. At a new effective timestamp it uses REST. Correcting the latest existing timestamp requires the matching entry assessment context because the tested REST path returns an entity-tracking error. The helper does not move effective dates to avoid that error. Older history correction and same-timestamp interim/exit correction are not supported.

The current mobile assessment projection may show a blank value for a UI-created DOB. That is not proof of missing data. The DOB helper requires agreement between client API and fresh UI before accepting the mobile row's effective date.

## Verification intervals

`readEnrollmentVerifications` selects rows with `start <= enrollment <= end`. Null or empty end means open. It reads the current generic assessment once and retains original IDs and date strings. It does not round an end date to the end of a day or reconstruct historical edits. Invalid or ambiguous dates cause an error rather than an empty result.

The user workflow normally starts each applicable verification on or before entry. Unchanged records remain open. When a type changes, the application supplies the old row's end and a new row's start, normally on the next calendar day. The SDK does not select the program's day-boundary policy. An exit does not automatically end all verification records.

## Answer states and identity

`No`, client refusal, client uncertainty, data not collected, and an omitted value are different states. Use the discovered option or an explicit encoder state mapping. Never replace an unknown value with `No` to satisfy coverage.

Use option codes from the current question's picklist, not cached labels from another provider. `HUD_RACEETHNICITY` needs the combination option even for a single category. The encoder handles this standard field; raw numeric IDs can display a label in REST while remaining blank in the UI.

Question metadata supplies types and mandatory flags, but does not describe every conditional rule. The application decides applicability and child-specific questions. [SSVF rules](../SSVF.md) are an explicitly tested sandbox form snapshot, not a general branching engine.

## Current Living Situation dates

Every contact row starts at the selected client's program entry. Its information date is the contact date, and its end may remain null or empty. Later contacts retain earlier rows without closing or replacing them. This differs from changing income/benefit verification intervals. See [contact recording](current-living-situation.md) for date input, optional Verified By, and retry contracts.
