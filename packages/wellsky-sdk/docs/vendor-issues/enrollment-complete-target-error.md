# Missing DOB and DOB quality trigger a complete-enrollment target error

Status: reproduced in a sandbox tenant on October 24, 2026, in Client API V2 and V3. Other tenant deployments were not tested. An initial read-only comparison was followed by DOB-only tests on two new synthetic clients and DOB-quality-only tests on two more. Existing client 579 and the original comparison records were not changed.

## Summary for WellSky

`GET /enrollments/complete/680` for client 579 returns HTTP 400 with the JSON string value `Non-static method requires a target.` in both API versions. The client, its enrollment list, and three assessment read routes all return HTTP 200. The enrollment also opens through the authenticated UI/GWT reader.

The isolated discrepancy is missing DOB information: the failing original has neither `SVPPROFDOB` nor `SVPPROFDOBTYPE`. DOB-only tests first cleared the error. Follow-up tests then showed that an actual birth date is **not required**: recording only `DOBTYPE_DONTKNOW` or `DOBTYPE_REFUSED` also changed the complete read from HTTP 400 to HTTP 200 in both V2 and V3. DOB and its effective timestamp remained empty. Applications must record the client's actual response, never fabricate a date to recover this GET. The exact server-side dereference still requires a stack trace.

This is separate from the [grouped-enrollment missing-column error](enrollment-effective-date-column.md). All four existing enrollments in the initial comparison have null `groupId` and `householdId`, and their clients have no household membership in the client response.

## Request and comparison

```http
GET /client-api-prod/enrollments/complete/680
Host: csclientapi.wellsky.com
Accept: application/json
x-tenant: your-tenant
x-version: 3.0
Authorization: Bearer <redacted>
```

Repeat with `x-version: 2.0`. Actual response in both versions:

```text
HTTP 400
"Non-static method requires a target."
```

The raw HTTP comparison ran October 24 at 16:35:38–16:35:45 UTC. It bypassed SDK response processing and used the same bearer token across the comparison. Response headers advertised V3 as supported and V2 as deprecated. No `x-request-id` or `x-correlation-id` was returned in the inspected headers.

| Client / enrollment | Entry instant, UTC | V2 complete | V3 complete | V3 client and enrollment list | Active interim reviews, UI/GWT |
| --- | --- | --- | --- | --- | --- |
| 579 / 680 | October 18, 16:00 | 400, target error | 400, target error | Both 200 | None |
| 577 / 679 | October 18, 16:00 | 200 | 200 | Both 200 | Update 151 |
| 580 / 681 | October 18, 16:00 | 200 | 200 | Both 200 | None |
| 628 / 719 | October 20, 16:00 | 200 | 200 | Both 200 | None |

All four use HUD enrollment type and provider 16951, `TCHC - ECHO - COC - Priority RRH`. All are open, with null exit date, destination, reason for leaving, and exit subgroup. Each has one enrolled client. Fresh UI/GWT reads confirmed the enrollment IDs, provider, type, entry dates, member lists, exit metadata, and review lists without saving forms.

Consequences of these controls:

- The same provider, type, and entry instant work for 679 and 681. The failure is not universal to that program or date.
- Absence of an interim does not by itself cause the error: 681 and 719 have none and read successfully.
- Null exit fields and absence of household grouping also occur in successful controls.
- V2 does not avoid the error. Neither an SDK parser nor RPC replay is needed to reproduce the failing GET.

## Assessment reads and field presence

All three routes below returned HTTP 200 and 35 question definitions for each of the four clients:

```http
GET /assessments/{clientId}/HUD_COCESGENTRY_SOESSH_2020?dateEffective={entryDate}
GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/HUD_COCESGENTRY_SOESSH_2020
GET /enrollments/assessment/{clientId}/HUD_COCESGENTRY_SOESSH_2020?dataCollectionPoint=entry&providerName=TCHC%20-%20ECHO%20-%20COC%20-%20Priority%20RRH&enrollmentType=HUD&startDate={entryDate}
```

Use `2026-10-18T16:00:00` for 579, 577, and 580, and `2026-10-20T16:00:00` for 628. The instrument is the common API entry assessment; this is not a claim to have inspected every program-specific question.

The following counts come from the enrollment-scoped entry route. A scalar counts as populated when at least one of `answer_value`, `answer_value_text`, or `answer_value_code` is non-null and non-empty; zero is a value. Labels are not populated answers.

| Client | Populated scalars | Income rows | Non-cash rows | Insurance rows | Disability rows |
| --- | ---: | ---: | ---: | ---: | ---: |
| 579 | 2 | 0 | 0 | 0 | 0 |
| 577 | 18 | 15 | 6 | 10 | 8 |
| 580 | 18 | 15 | 6 | 6 | 6 |
| 628 | 17 | 15 | 6 | 10 | 8 |

These are recorded-row counts from that route, **not** proof that every row is active at entry. Mobile and entry-scoped results can differ; do not treat them as interchangeable snapshots or infer that missing verification rows explain this exception.

Client 579's two populated fields are `HUD_RACEETHNICITY` and `HUD_RACEETHNICITYDETAIL`. Its client record represents missing DOB, DOB quality, and veteran status as empty strings, and missing Sex as null. The following 15 scalar fields are populated in all three successful entry controls and empty for 579:

```text
SVPPROFDOB
SVPPROFDOBTYPE
HUD_DISABLINGCONDITION
HUD_RELATIONTOHOH
HUD_COCCLIENTLOCATION
TYPEOFLIVINGSITUATION
HUD_LENGTHOFSTAY
HUD_HOMELESSSTARTDATE
HUD_NUMBEROFTIMESTREETESSH
HUD_NOMONTHSTREETESSHIN3YRS
SVP_ANYSOURCE30DAYINCOME
HUD_TOTALMONTHLYINCOME
SVP_ANYSOURCE30DAYNONCASH
HUD_COVEREDBYHLTHINS
DOMESTICVIOLENCEVICTIM
```

This list is a comparison set for debugging, **not a newly established API requirement**. Missing Sex alone is insufficient to explain the failure: client 628 has a null Sex value and reads successfully. Missing translation-assistance answer alone is also insufficient: 628 lacks it. Veteran status, name quality, and SSN quality are empty strings in all four client responses, including the successful controls.

### Historical before/after evidence

The October 22 boundary test on client 580 / enrollment 681 recorded the target exception before adding baseline profile/entry scalars. A subsequent batch supplied the 15 fields above plus race/ethnicity, Sex, and translation assistance; the complete read then succeeded. Verification rows were not replayed during that recovery.

Because 18 fields changed together, that observation cannot isolate DOB, a lookup, relationship to head, or another field as the trigger. The initial comparison preserved client 579's sparse data for vendor reproduction. The controlled tests below then isolated DOB on new synthetic clients, without changing 579.

## Projection checks

V3 follow-up reads at 16:36:09–16:36:12 UTC tested `$expand=projectStartData`, `projectExitData`, `projectReviewData`, and `enrolledClients` separately on enrollments 680 and 681.

- Every requested expansion on 680 returned the same target error.
- Every requested expansion on 681 returned HTTP 200, with the requested section and base enrollment fields while omitting the other tested sections.
- An explicitly empty `$expand=` returned HTTP 400 for both: the target error for 680 and a different error for 681. Empty expansion is not a valid workaround established by this test.

Omitting entry data from the requested response therefore did not recover 680. This is consistent with failure during shared construction before output selection, but the server execution order is unverified. The experiment does not isolate a particular projection branch.

## Controlled isolation: DOB alone clears the error

After the initial comparison, two new synthetic clients were created in a sandbox tenant. Each received one HUD enrollment in provider 16951 with the same entry instant as 680, `2026-10-18T16:00:00Z`. Mutations were journaled before submission and were not automatically replayed.

| Client / enrollment | Assessment state | V3 complete result |
| --- | --- | --- |
| 646 / 733 | No answers | 400, target error |
| 646 / 733 | Race/ethnicity and detail only | 400, target error |
| 646 / 733 | Added only `SVPPROFDOB` to the preceding state | 200 |
| 647 / 734 | No answers | 400, target error |
| 647 / 734 | Added only `SVPPROFDOB`, with no other answers | 200 |

The DOB writes used the existing mobile assessment endpoint, `POST /assessmentsmobile/AddAssessmentAnswer/{clientId}/HUD_COCESGENTRY_SOESSH_2020`, through the SDK encoder and configured effective-date correction. Each DOB request contained exactly one question, `SVPPROFDOB`. The new clients used different valid synthetic birth dates. Readback confirmed that 646 had exactly three populated scalar fields and 647 had exactly one. Neither had verification rows. Their client records still had empty DOB-quality values and null Sex values.

Fresh raw HTTP confirmation at 16:38:32–16:38:36 UTC established:

- Complete enrollments 733 and 734 returned HTTP 200 in **both V2 and V3**.
- Enrollment 680 continued to return the target error in both versions, using the same token as the successful reads.
- Client 579's client, enrollment-list, generic-assessment, mobile-assessment, and scoped-entry responses were unchanged from the initial snapshots.
- Each new client had exactly one enrollment. UI/GWT reads opened both records and confirmed their provider, entry date, single-member state, absent exits, and empty review lists.

The test made seven domain write requests in total: two client creations, two enrollment creations, one race/detail batch on 646, and one DOB answer per new client. An initial harness allowlist blocked a metadata read after creating 646/733; the continuation verified and reused those IDs without repeating creation. No writes were made to the original fixtures.

This resolves the field-level discrepancy that the earlier 18-field batch could not isolate. Missing verification rows, DOB quality, race, Sex, relationship to head, and absence of an interim do not independently prevent a successful complete read of fixture 734. That response does **not** mean the sparse enrollment satisfies HMIS data-quality or SDK workflow requirements.

The DOB-only experiment did not establish that an actual date was necessary. The quality-only follow-up below answers that question for the two requested responses. The internal mapper or expression responsible for the exception remains unverified; no server stack trace was available.

## Quality-only follow-up: unknown or declined DOB also succeeds

At 16:42:14–16:42:19 UTC on October 24, two new synthetic clients received individual HUD enrollments in provider 16951 at the same entry instant as 680. Each complete read failed before any DOB or quality answer was recorded. Then one assessment question, `SVPPROFDOBTYPE`, was written using a choice resolved from fresh client-scoped metadata. No DOB field was sent.

| Client / enrollment | Only assessment answer added | V2 before → after | V3 before → after |
| --- | --- | --- | --- |
| 648 / 735 | `DOBTYPE_DONTKNOW`, Client doesn't know | 400 target error → 200 | 400 target error → 200 |
| 649 / 736 | `DOBTYPE_REFUSED`, Client prefers not to answer | 400 target error → 200 | 400 target error → 200 |

The Client API readback returned an empty string for `svpprofdob` on both clients. Generic assessment readback returned null DOB answer and null DOB effective date. Client DOB quality was `Client doesn't know (HUD)` or `Client prefers not to answer (HUD)`, respectively. Codes were verified exactly; metadata labels had trailing whitespace, so the writes resolved by code.

The existing SDK DOB reader independently checked the client API, mobile assessment, and fresh UI Summary. It returned `dateOfBirth: null` and `effectiveDate: null` for both clients. UI/GWT enrollment reads confirmed one enrolled member and one enrollment each. Six successful domain requests created the two clients, two enrollments, and two quality answers. Repeating source-ID client creation with the original inputs performed no additional writes. The harness explicitly rejected any assessment write that was not a single `SVPPROFDOBTYPE` answer.

This narrows the defect to the tested state where both DOB and DOB quality are absent. Either the tested DOB-only answer or either tested quality-only response is sufficient to avoid it. It does not prove behavior for every DOB-quality option or every occurrence of this generic exception. Full/approximate DOB quality without a date and other quality codes were not tested.

### SDK behavior and regression coverage

No SDK runtime workaround is needed for these responses. In an enrollment assessment plan, set `answers.SVPPROFDOBTYPE` to the discovered option code and cover `SVPPROFDOB` with an explicit `notApplicable` explanation that the client did not supply a date. This coverage choice skips the date write; it does not clear a previously recorded DOB. The calendar-date helper is used only for an actual supplied date. Never pass a placeholder date, empty date answer, or a DOB carry-forward when no DOB exists.

Regression tests exercise the real workflow and encoder with simulated external services: both quality options, lost scalar acknowledgements, same-key entry and interim retries, changed-intent rejection, and distinct quality-only responses for household members. They assert zero DOB writes and no dependency on the complete-enrollment endpoint. DOB-reader tests preserve a missing date and reject attempts to update it with null, undefined, or an empty string. The same tests are included in clean installed-package verification through public exports.

The quality-only live fixtures were created through the SDK client-creation helper and raw enrollment/assessment methods; household and interim quality-only retries were verified locally against simulated services, not through new live household writes in this follow-up.

## Reproduction and requested vendor investigation

1. Read `/clients/579` and `/enrollments/579`; confirm the existing client and enrollment 680.
2. Read `/enrollments/complete/680` in V2 and V3; observe the target error.
3. Compare complete enrollments 679 and 681 with the same credentials. They share provider, type, and entry time and succeed.
4. Read the three assessment routes above for client 579. They return its sparse answers without this exception.
5. Compare 733 and 734, which now succeed after DOB-only changes. Fixture 734 has DOB as its only assessment answer.
6. Compare 735 and 736, which succeed with no DOB and only the unknown/declined quality response.
7. Inspect the server stack trace for 680. Identify the missing DOB/DOB-quality target, mapping, or expression and whether V2 and V3 share it. A vendor regression should compare neither field populated, DOB only, unknown quality only, and declined quality only.

Please clarify whether incomplete entry answers are intended to be readable. Expected behavior is a complete-enrollment response with missing answers represented explicitly, or a documented, field-specific validation error. A generic target exception gives applications no reliable recovery action. Please include absent DOB and unknown/declined DOB cases in regression coverage. Both unknown and declined responses already return successful reads without a date in the tested versions. Preserve that behavior while fixing the unhandled case where both fields are missing.

## Application handling and limits

Use the successful enrollment list to establish that enrollment 680 exists. Read recorded answers through the assessment API and use the SDK's date-aware verification reader when active-at-date filtering is needed. The authenticated UI/GWT reader provides enrollment/member/review metadata. These are separate reads, not a guarantee of an atomic replacement for the complete endpoint.

Never create a replacement enrollment, add an interim, shift dates, or invent a DOB merely because this GET fails. If the actual DOB is known and recording it is authorized, the existing DOB helper can save it; the controlled tests show that a saved DOB clears this failure in these fixtures. If the client does not know or prefers not to answer, record that actual quality response and leave DOB absent; both cases read successfully in the controlled tests. Otherwise use alternate reads and report the upstream defect. Preserve duplicate-protection state. No SDK runtime change was made for this investigation.

Private evidence retains the request/status matrix, field-presence comparison, projection results, and sanitized UI/GWT metadata. This shareable report excludes credentials, client demographics, and raw authenticated payloads. The initial comparison comprised 38 REST GETs and four UI/GWT enrollment reads. Controlled writes were followed by 21 raw HTTP confirmation reads, field-by-field assertions, and two additional UI/GWT enrollment reads. Server code and the database were not inspected. The later quality-only evidence is retained separately, including before/after V2/V3 statuses and blank-DOB UI readback. Both date-only and the two quality-only responses resolve the tested failure; the internal exception source remains for WellSky to diagnose.
