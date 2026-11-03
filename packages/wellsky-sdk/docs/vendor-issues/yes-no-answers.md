# Yes/no answers through assessment endpoints

[WellSky feedback](README.md)

Status: reproduced November 2, 2026 in a sandbox tenant on synthetic clients, with private HTTP error bodies captured. A coordinated-entry housing needs assessment, effective instant `2026-10-30T16:00:00Z`, mobile writes using a measured 420-minute date correction.

## Mobile writes store yes/no answers empty

On a fresh client with no prior answers, `POST /assessmentsmobile/AddAssessmentAnswer` returned success for a `yes_no` question with `answer_value` `"Yes"`, `"1"`/`"0"`, and `"true"`/`"false"`. Each request created a row at the intended effective date, but its value read back empty through the generic assessment read and `assessmentsmobile` answer read. Lookup, text, date, integer, and money answers and a new subassessment row sent through the same endpoint saved normally. An integrator's 30-answer entry batch showed the same empty values.

**Ask WellSky:** What `answer_value` does the mobile endpoint accept for `yes_no` questions? Should a write that stores no value return an error?

The same loss occurs in new subassessment rows: a Coordinated Entry Event row written through the mobile endpoint kept its dates, event and referral result but lost a yes/no result and a provider-valued location. The standard endpoint saved both.

A mobile update to an existing row's `recordset_id` changed only the cells sent and kept the others, including a provider-valued location, but a yes/no cell sent the same way was not stored.

**Ask WellSky:** Are provider-valued answers supported by the mobile endpoint, and in what format? Can the standard endpoint update an existing row, so yes/no results recorded after an event can be saved?

## Mobile writes fail for an existing row

A second mobile write for a question that already had a row at the same effective date returned HTTP 400 with the body `An error occurred while saving the entity changes. See the inner exception for details.` It happened for a yes/no question and an integer question. No row changed.

**Ask WellSky:** Is the mobile endpoint intended to only insert rows? Can the response identify the conflicting question instead of hiding the database error?

## Standard writes require every mandatory answer

`POST` to the standard assessment endpoint stored `"Yes"` and `"No"`, rejected `"true"`/`"false"`, updated existing rows at the same date (including empty yes/no rows created by mobile writes), and changed no answers outside the request. A request that omitted any mandatory answer returned `All mandatory answers are not provided`, even when that answer was already recorded at the same date. A conditionally mandatory lookup sent as `""` was accepted and stored empty.

**Ask WellSky:** Can an update supply only the changed answers? How should a client mark a conditionally mandatory answer as not applicable?

## Generic reads omit yes/no answers at their effective instant

After a successful standard write, the generic assessment read with `dateEffective` equal to the saved instant returned `null` for the yes/no answers, while other types at the same instant read normally. A query one second later, and the mobile read, returned the saved values. The standard create response also returned `null` for them.

**Ask WellSky:** Is the effective-date comparison for yes/no answers intended to exclude the queried instant?

## A failed mobile batch saved one of its answers

Observed by an integrator on November 2, 2026, with synthetic records. A 15-answer `AddAssessmentAnswer` batch (1 `date`, 13 `lookup`, 1 `int`) was sent a few seconds after the client's household enrollment and entry-assessment answers were created. It returned HTTP 400; the error body was not captured. Afterwards the `int` answer was stored at the correct effective date and the other 14 were empty. The client's rows for this assessment were not read just before the send, so the absence of prior rows is inferred from the integration's own writes. Resends failed as in [the existing-row case](#mobile-writes-fail-for-an-existing-row).

On November 3, the byte-identical batch returned 200 and read back completely on fresh synthetic clients without an enrollment, an enrolled single adult, and an enrolled household head. Splitting the batch, reordering it, or omitting the `int` answer made no difference. The failure has not been reproduced.

**Ask WellSky:** Can a mobile write that returns HTTP 400 commit part of its batch? Is a write to an assessment assigned to the provider affected by work the server does after enrollment creation?
