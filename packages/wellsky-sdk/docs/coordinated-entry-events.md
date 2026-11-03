# Record Coordinated Entry Events

[Documentation index](README.md) · [Assessment guide](assessments.md) · [Public contract](../browser/coordinated-entry-event.d.mts) · [Example](../examples/coordinated-entry-events.mts)

A Coordinated Entry Event records an access event, such as a referral to a crisis needs assessment, or a referral with its result, such as an emergency shelter or rapid rehousing referral. Each event is its own subassessment row. Recording another event does not close or replace an earlier one.

`createCoordinatedEntryEventRecorder` writes one row per event key through the standard assessment endpoint. The mobile answer endpoint is not used because it drops two kinds of answers in these rows without returning an error; see [the evidence](#why-the-standard-endpoint).

## Fields

Read `api.assessments.getDefinition({clientId, assessmentCode, refresh: true})` and supply the exact virtual fields. For clients in household enrollments, pass `enrollmentSession`; the REST enrollment read fails for them, as for [Current Living Situation](current-living-situation.md#record-and-retry). Readback queries one second after the later of now and the event date, because a read at exactly the event instant omits yes/no answers. A November 2, 2026 sandbox instrument exposed:

| Role | Virtual field | Type |
| --- | --- | --- |
| Parent | `SVP_COORDINATEDENTRYEVENT_SUBA` | sub_assessment |
| Start | `SVP_COORDINATEDENTRYEVENT_SUBASTART` | date |
| End | `SVP_COORDINATEDENTRYEVENT_SUBAEND` | date |
| Date of event | `SVP_COORDINATEDENTRYEVENT_DATE_EVENT` | date |
| Event | `SVP_COORDINATEDENTRYEVENT_EVENT` | lookup |
| Diversion result: client housed safely | `SVP_COORDINATEDENTRYEVENT_CLIENTHOUSEDSAFE` | yes_no |
| Follow-up result: enrolled in aftercare | `SVP_COORDINATEDENTRYEVENT_ENROLLEDAFTERCARE` | yes_no |
| Location of crisis or permanent housing referral | `SVP_COORDINATEDENTRYEVENT_LOCATIONCRISISPHPROJID` | provider |
| Referral result | `SVP_COORDINATEDENTRYEVENT_REFERRALRESULT` | lookup |
| Date of result | `SVP_COORDINATEDENTRY_DATE_RESULT` | date |

Map every role in `fields`. The recorder writes the start, event date and event, and takes the follow-up answers as named inputs. It checks them against the selected Event before any write:

| Event option code (`COORDINATEDENTRYEVENT_EVENT_…`) | `housedSafely` | `enrolledInAftercare` | `location` | `referralResult` + `resultDate` |
| --- | --- | --- | --- | --- |
| `PROBSOLV` | Optional | — | — | — |
| `POSTPLACEFOLLOWUP` | — | Optional | — | — |
| `EMERGSHELTER`, `TRANSITHOUSING`, `JOINTTHRRH`, `RRH`, `PSH`, `OTHERPH` | — | — | **Required** | Optional, both or neither |
| `PREVASSIST`, `CRISISNEEDS`, `HOUSINGNEEDS`, `STREETOUTREACH`, `HOUSINGNAVIGATION`, `NONCONT_INELIG`, `NONCONT_NOAVAIL` | — | — | — | — |

A dash means the answer is refused for that event. The mapping follows the form's own dependency labels for these fields. Requiring a location for placement referrals is the SDK's choice; HUD's data standards list it as a dependent field to collect. HUD also defines referral events for emergency assistance or flex funds, Emergency Housing Vouchers and Housing Stability Vouchers, which take a result but no location. The tested tenant's Event picklist had no options for them, so they are not in the table; their codes are refused as `unsupported-event` until verified and added. The result answers are optional because a referral's result is usually known only after the referral, and the result date cannot precede the event. Header options and any other Event code are refused as `unsupported-event`, so a tenant with different codes fails before writing rather than being guessed. Supply `location` as a provider ID; the recorder checks that it is a positive ID and that it reads back, not that the provider exists in the tenant. Use `additionalAnswers` only for other questions in the row; it cannot set the mapped fields. Malformed answers and lookups without a `writeLabel` result are rejected with the encoder's `ValidationError` before any write.

## Record and retry

```ts
const recorder = createCoordinatedEntryEventRecorder({
  api, store, fields,
  writeLabel: (question, option) => verifiedLabels.get(`${question.fieldName}:${option.code}`),
});
await recorder.record({
  key: `${sourceEventId}`, clientId, enrollmentId, assessmentCode,
  eventDate: '2026-11-02T12:20:00Z',
  event: {option: {code: 'COORDINATEDENTRYEVENT_EVENT_EMERGSHELTER'}},
  location: shelterProviderId,
  referralResult: {option: {code: 'COORDINATEDENTRYEVENT_REFERRALRESULT_SUCCESS'}},
  resultDate: '2026-11-02T12:30:00Z',
});
```

- The standard endpoint takes lookup **labels**, so `writeLabel` must return tenant-verified labels for the Event, the referral result and any other lookup answered. Readback compares the option IDs.
- The row start is the selected enrollment's entry date. The end is left empty. Events before entry or after a recorded exit are refused.
- The standard endpoint rejects a request that omits any mandatory answer of the instrument. The recorder sends only the event row, so it refuses an instrument with mandatory questions instead of resending other answers, which would create new dated rows for them. Use an instrument that contains the CE Event subassessment and has no mandatory questions; in the tested program that was the Standard interim instrument. Rows belong to the client, so they appear in the entry and interim assessments alike.
- The journal, snapshot and reconciliation rules match the [Current Living Situation recorder](current-living-situation.md#record-and-retry): each key gets one row, earlier rows must be unchanged, exactly one new matching row must appear, and an uncertain save blocks later event keys for that client until it reconciles. Same-key retries verify the original recordset ID and never submit again.

Use timezone-qualified whole-second instants for event and result dates.

## Add a referral result later

```ts
await recorder.recordResult({
  key: `${sourceEventId}`, clientId, assessmentCode,
  referralResult: {option: {code: 'COORDINATEDENTRYEVENT_REFERRALRESULT_SUCCESS'}},
  resultDate: '2026-11-05T15:00:00Z',
});
```

`recordResult` adds a result to a placement referral that `record` already verified under the same key and store. The standard endpoint can only create rows, so it sends just the result and result date to the event's `recordset_id` through the mobile endpoint, which changes those cells and keeps the rest of the row, including the location. Before sending, it journals a snapshot of every row. Afterwards it requires the result to read back, every earlier answer in the row to be unchanged, every other row to be unchanged and no row to be added. A lost acknowledgement reconciles; an unknown outcome leaves the update pending, blocks other event keys for the client, and is never resent. A row that already has the same result returns `already-present`; a different result already in the row is a `result-conflict`. Once a result has been attempted or recorded under a key, a different result for that key is refused as `result-intent-changed`. The result date cannot precede the event date; it may follow the client's exit, because a referral's outcome can arrive after the client leaves the program. Mobile writes use the client's configured date correction for their effective date; the result date inside the row is not shifted.

Yes/no results cannot be added later: the mobile endpoint drops yes/no answers in row updates as it does in new rows. Record a Problem Solving/Diversion or post-placement follow-up event once its result is known, with `housedSafely` or `enrolledInAftercare`, or record it without one. The standard endpoint stores the requested instant; the mobile date correction does not apply.

## Why the standard endpoint

On November 2, 2026, synthetic CE Event rows were written in a sandbox tenant through both endpoints:

| Row | Mobile `AddAssessmentAnswer` | Standard `assessments.create` |
| --- | --- | --- |
| Dates and event lookup | Saved | Saved |
| Yes/no result | Dropped, success response | Saved |
| Provider location | Dropped, success response | Saved |
| Referral result and date | Saved | Saved |

The standard request uses the row shape `{subAssessments: [...]}` without `recordset_id`/`isDeleted`. Other subassessment rows were unchanged afterwards. The recorder, before its event-type checks were added, then created an access event, a diversion with its yes/no result, and an emergency shelter referral with location and result through the interim instrument; all three verified and same-key retries made no writes. The UI's assessment table showed the referral's location and result. A mobile update of an existing row's `recordset_id` with only the result and result date added both and kept the location, with or without the location cell in the request; the same update with a yes/no result returned success and stored nothing. The yes/no result is not a table column, so it was confirmed through REST reads only.

Apart from adding a referral result, the recorder does not edit or delete events. End-date an event row with [`client.subassessments.setEndDate`](assessments.md#end-date-an-existing-subassessment) and the recorded `recordsetId`; it sends only the end-date cell, keeps the location and yes/no results, and verifies the whole subassessment. A later end date does not stop `record` from returning `already-present` for the event's key.
