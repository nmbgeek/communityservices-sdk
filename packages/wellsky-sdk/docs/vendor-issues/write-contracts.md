# Write outcomes and update contracts need clarification

[WellSky feedback](README.md) · [Recovery](../troubleshooting.md)

Status: reproduced observations from a sandbox tenant on October 22–24, 2026. Some indicate a failure; others need a contract clarification before they can be called defects. No vendor acknowledgement or resolution is recorded here.

## A service persisted despite HTTP 400

During the October 24 run, a fixture had veteran status `Yes` rather than the UI's accepted `Yes (HUD)`. The service create returned HTTP 400 with `Requested value 'ENHANCEDYESNO_YES_NONHUD' was not found.` A subsequent service list also failed with that error.

After an explicit correction of the fixture's veteran status, a counted list showed the service already existed. There had been exactly one POST to `/services/create`. The SDK reconciled the original service key and journal, then completed the associated need without creating another service.

The SDK's veteran-label validation was subsequently corrected. That client-side fix reduces exposure to the trigger but does not establish rollback semantics for server errors. The observation proves persistence despite the failed response; it does not establish the server's internal transaction sequence.

**Ask WellSky:** Can validation occur before commit, or can an error after commit return the created identity and commit status? What recovery contract should callers use after a failed create? Is there a supported idempotency key or external-reference lookup?

Treat this as a high-priority integration issue because retrying a failed create can duplicate records. The SDK retains the attempted stage and reconciles before any further mutation.

## Omitting SSN from a client update cleared it

A raw middle-name-only update cleared the existing synthetic SSN when `socSecNo` was omitted. Other observed fields remained. The profile helper now reads and preserves all nine supported REST Client Record fields when making a change, then verifies the stored result.

The October 23 reproduction compared the existing Client Record with a raw REST update containing only the intended middle-name change. The later helper control preserved SSN and Sex while changing the middle name, with REST and UI readback. The observation is specific to the tested payload; it does not establish omission semantics for every field.

**Ask WellSky:** Is this endpoint a replacement operation or a partial update? What do omission, null, and empty string mean for each field? If clearing on omission is intended, can the contract require or clearly document the preserved fields?

This is an observed data-loss risk, but whether the server behavior violates the intended update contract remains a question. Do not assume PATCH semantics from a method named update.

## Goal updates require a field marked optional

The tested server rejected a goal update without `clientId`, although the pinned Swagger model marks that field optional. The SDK supplies and verifies the owning client.

For a support reproduction, compare otherwise identical updates to an authorized synthetic goal with and without its owning `clientId`. Record the validation response and stored values after each attempt. Keep this schema mismatch separate from the nested relationship question below.

**Ask WellSky:** Is `clientId` always required for updates? If so, can the schema and validation message reflect that requirement?

Goal responses also included unrelated `households` rows when the inspected goal had no household association. This is a separate response-integrity question. **Ask:** What relationship does that nested collection represent, and should it be scoped to the requested goal or client? The SDK does not use it to select write targets. The observation does not establish cross-tenant exposure.

## Filtering and response shapes vary by operation

| Observation | Current handling | Question for WellSky |
| --- | --- | --- |
| Counted client candidate queries required `first_name`, `last_name`, and `soc_sec_no`; simplified camel-case forms could fail | Uses the verified field names and bounds candidate counts | Can accepted filter fields and endpoint-specific syntax be documented? |
| Counted Client Notes accepted `query=client_id eq …`; `$filter` failed HTTP 400 | Uses the operation's native query form | Is this intentional, and can the contract distinguish it from other collection endpoints? |
| ROI `$filter=client_id eq …` returned an empty success while the documented `query` form returned 404 in the checked case | Preserves operation-specific evidence; does not treat every 404 as empty | Which query form and no-results response are supported? |
| Complete-service reads returned an array despite the documented object shape | Normalizes supported collection shapes while preserving HTTP errors | Can the schema or response be aligned? |
| Follow-up fields were not available in the REST case-plan read model | Does not expose unverifiable follow-up writes through the durable helper | Which endpoint provides authoritative readback? |

These observations should be submitted with the exact API version, endpoint, sanitized request, and response shape from an authorized reproduction. They are not evidence that every endpoint supports the same query syntax or update behavior.

The mobile configuration routes are described by Swagger as internal WellSky endpoints. An HTTP 401 from a service account on those routes alone is not evidence of a public API authentication defect or a need for another SDK login flow.
