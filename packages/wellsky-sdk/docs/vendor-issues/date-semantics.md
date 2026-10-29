# Date handling and enrollment projections need separate fixes

[WellSky feedback](README.md) · [SDK date contracts](../dates-and-answers.md)

Status: the observations below were reproduced in a sandbox tenant on October 22–23, 2026. They concern separate paths. Similar seven-hour differences do not establish one shared server cause or a configured timezone name. These are prepared reports, not confirmed vendor diagnoses.

## Complete entry projections omit valid verification rows

V2 and V3 complete-enrollment entry projections behaved as though the cutoff was seven hours before the enrollment instant. Generic readback retained the intended row starts.

| Row start relative to enrollment | Complete entry result |
| --- | --- |
| Seven hours and one second before | Included |
| Exactly seven hours before | Included |
| Six hours, 59 minutes, 59 seconds before | Excluded |
| One second before or exactly at enrollment | Excluded |
| One second after enrollment | Excluded |

The near-enrollment boundary was tested in income, benefits, insurance, and disability groups. Earlier boundary controls were tested in income. Correcting the mobile write's answer effective date did not change the inclusion pattern.

A separate control created an income row through the actual enrollment UI. The observed `addClientRecordsetLinkedToEE` request carried the intended instant, and the UI verified the subassessment. Generic readback confirmed its start and effective date. The complete entry projection still excluded it. This rules out SDK serialization or missing UI enrollment linkage as a sufficient explanation for that control.

The alternative enrollment-scoped assessment read included future-start rows as well. It is not an already-filtered entry snapshot. The SDK's `readEnrollmentVerifications` reads generic answers and applies explicit start/end interval checks. It does not move row starts to satisfy the projection.

**Ask WellSky:** Which timestamp and timezone conversion determine the complete entry cutoff? Can the projection include the UI-created control at its intended entry instant? Does the same issue affect interim or exit projections? Those additional projections were not established by this boundary experiment.

## Mobile answer writes shift the effective date

In the controlled fixture, an AddAssessmentAnswer request with `dateEffective=2026-10-18T16:00:00Z` stored a child effective date of `2026-10-18T09:00:00`. Sending `23:00:00Z` through a measured 420-minute correction stored the intended `16:00:00` value. Body row-start dates were controlled independently and retained their intended instants.

**Ask WellSky:** Is `dateEffective` interpreted as UTC, a local wall time, or another representation? Can the API preserve an explicit offset and document its response timezone? Is the observed subtraction intended?

The SDK exposes `mobileAssessmentDateCorrectionMinutes` for this measured query behavior only. It is not a global date shift and does not fix the complete-entry projection.

## DOB serialization can disagree with the UI calendar date

Winter and summer REST probes showed the same boundary: `06:59:00Z` became the previous calendar date, while `07:00:00Z` retained the intended date. The browser UI in America/New_York and the REST client date disagreed for a deliberately borderline value. These observations are consistent with a fixed UTC−7 conversion on that path; they do not prove the server's timezone configuration.

**Ask WellSky:** Can DOB use an explicit date-only contract without timezone conversion? Which interpretation is authoritative when REST and the UI display different dates?

`createDateOfBirth` accepts a calendar date and uses the tested encoding with a browser-date preflight. It rejects incompatible displays rather than silently changing the browser timezone. This behavior must not be applied to enrollment dates, contact dates, or all REST fields.

## Correcting DOB at an existing effective timestamp fails

A first DOB at a new effective timestamp succeeded. Reusing that timestamp failed with an entity-tracking error for `sp_client`, including unchanged-DOB and quality-only attempts. A new timestamp succeeded, and reusing it failed again. Mobile assessment writes also failed at an existing timestamp. Moving the timestamp by one second avoided the failure but changed history.

The supported SDK correction opens the matching latest entry assessment and uses the current UI serializer. It does not create a different effective date. Arbitrary older history corrections and same-timestamp interim or exit corrections remain unsupported.

**Ask WellSky:** Can the existing-answer update path update the tracked entity at the original timestamp? What is the documented operation for an in-place historical correction?

After a UI-created DOB answer, the mobile assessment projection could return a blank answer while the client API and UI agreed on the saved DOB. **Also ask:** Is that projection expected to expose the value, and can its blank result be corrected or documented? The SDK uses the row's effective timestamp without treating the blank value as proof of absence.
