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

GitLab issue #2 reports a November 2, 2026 synthetic-client test: a combined 15-answer batch (1 `date`, 13 `lookup`, 1 `int`) returned HTTP 400 with `An error occurred while saving the entity changes. See the inner exception for details.` Only the integer score answer was stored afterwards. The issue says no row existed beforehand, that the error body was captured, and that the non-score batch and score-only batch each succeeded separately.

Separate retained run notes describe a batch sent shortly after household enrollment and entry answers, without a retained before-write assessment snapshot or raw error body. These accounts differ in their stated evidence. The SDK team cannot establish that they describe identical attempts or independently confirm their pre-write state. An existing answer shared by two instruments is one possible collision source, not an established explanation of the reported failure.

On November 3, the byte-identical batch returned 200 and read back completely on fresh synthetic clients without an enrollment, an enrolled single adult, and an enrolled household head. Splitting the batch, reordering it, or omitting the `int` answer made no difference in those successful controls. The original failure remains unreproduced in that follow-up. These controls do not disprove the original report or establish a score-specific serialization rule.

## SDK guard for an observed collision after preflight

A November 11 synthetic regression demonstrated a narrower SDK defect: enrollment creation populated a scalar after the initial preflight; the scalar-stage read observed that occupied instant, but the workflow still submitted the full mobile batch. SDK 0.8.1 now refuses that first scalar attempt before marking it attempted. This protects against an observed collision and unavailable evidence after an earlier lifecycle stage. It does not establish the cause of issue #2 or make mobile batches atomic.

A separate synthetic partial-commit control returned HTTP 400 after saving only one answer. Its stage stayed pending, same-key retries sent nothing, and later row stages did not run. Preserve that uncertain-write behavior. Do not split, replay, change the effective date, or replace the key to work around an already-attempted batch.

**Ask WellSky:** Can a mobile write that returns HTTP 400 commit part of its batch? Is a write to an assessment assigned to the provider affected by work the server does after enrollment creation? Which server-side diagnostic can identify the failing question and database constraint?
