# Grouped enrollment reads fail in V2 and V3

Status: reproduced in a sandbox tenant on October 24, 2026, with Client API V2 and V3. Other tenant deployments were not tested. The comparison used existing synthetic records and made no client, household, enrollment, assessment, or shelter writes.

## Summary for WellSky

Both versions return HTTP 400 with the same missing-column error for grouped enrollment reads. All 16 tested grouped complete-enrollment requests per version failed. None of the six individual enrollments produced this particular error, although one had a separate complete-read failure.

The strongest comparison is within client 575: direct reads of its individual enrollments succeed, its grouped enrollment fails, and pagination can return the individual rows successfully. This points toward processing a grouped enrollment rather than the client simply belonging to a household. The underlying SQL/view defect remains unconfirmed.

## Request contract and exact error

```http
GET /client-api-prod/enrollments/{clientId}?perPage=100&startPage=1&total_count=true
GET /client-api-prod/enrollments/complete/{enrollmentId}
Host: csclientapi.wellsky.com
Accept: application/json
x-tenant: your-tenant
x-version: 2.0
Authorization: Bearer <redacted>
```

Repeat each request with `x-version: 3.0`, keeping the other inputs unchanged. The server returned HTTP 400 and this JSON string value:

```text
42703: column v.entry_date_effective does not exist

POSITION: 116
```

Response headers advertised `api-supported-versions: 3.0` and `api-deprecated-versions: 2.0`. V2 still accepted requests; switching to it did not avoid the defect. A provider-complete control request returned HTTP 200 in each version with the same credentials.

## Method and results

The main comparison ran at 15:56 UTC, 11:56 a.m. Eastern, on October 24. Follow-up pagination and filter checks ran through 15:57:01 UTC. Requests used raw HTTP, bypassing SDK response handling, with the same bearer token within each comparison run. Only `x-version` changed between each pair.

Fresh, counted GWT reads established 22 active enrollment records across the synthetic cohort. Six had a null `groupId`; 16 had a non-null group ID across eight household groups. Here, “individual” describes the enrollment's grouping, not whether the client belongs to a household elsewhere.

Results below are counts **per API version**. V2 and V3 had identical outcomes.

| Read and cohort | Tested per version | V2 | V3 |
| --- | ---: | --- | --- |
| Client list, individual enrollments only | 4 clients | 4 HTTP 200 | 4 HTTP 200 |
| Client list, grouped enrollments only | 13 clients | 13 HTTP 400, missing column | 13 HTTP 400, missing column |
| Client list, individual and grouped enrollments mixed | 1 client | HTTP 400, missing column | HTTP 400, missing column |
| Complete individual enrollment | 6 enrollments | 5 HTTP 200; 1 different HTTP 400 | 5 HTTP 200; 1 different HTTP 400 |
| Complete grouped enrollment | 16 enrollments | 16 HTTP 400, missing column | 16 HTTP 400, missing column |
| Client list, no active enrollments | 1 client | HTTP 404 | HTTP 404 |

The grouped cohort included HUD and Basic enrollments, household heads and other members, open and exited records, and RRH, TH, and ES programs. Earlier capture established the error after ordinary UI saves and after RPC replay, including before interim creation. It is not confined to shelter-created enrollments or interims.

## Concrete reproduction pairs

These identifiers refer only to existing synthetic sandbox fixtures. They contain no client demographics.

| Client | Enrollment | Group ID | Result in both versions |
| --- | --- | --- | --- |
| 577 | 679 | null | List and complete read succeed |
| 581 | 682 | 682 | List and complete read fail with missing column |
| 582 | 684 | 682 | Other household member also fails |
| 575 | 677, 678 | null | Both direct complete reads succeed |
| 575 | 725 | 725 | Direct complete read fails; full client list also fails |
| 644, 645 | 729, 730 | 729 | Both exited TH enrollments fail |
| 642, 643 | 731, 732 | 731 | Both open nightly ES enrollments fail |

Enrollments 679 and 682 use the same provider, 16951, the same HUD type, and the same entry instant, `2026-10-18T16:00:00Z`. Their different grouping provides a closer comparison than records from unrelated programs. Both were confirmed present by fresh GWT reads.

To reproduce without changing records:

1. Call `/enrollments/577` and `/enrollments/complete/679` with `x-version: 2.0`, then `3.0`. Expect HTTP 200 for these fixtures.
2. Call `/enrollments/581` and `/enrollments/complete/682` with each version. Observe HTTP 400 and the missing-column message.
3. Compare `/enrollments/complete/678` and `/enrollments/complete/725`, both belonging to client 575. The individual enrollment succeeds; the grouped enrollment fails.
4. Compare the client-575 pagination cases below. Preserve the response status, timestamp, version, and any support correlation ID. Do not include credentials in a ticket.

## Pagination and query isolation

These follow-up results were identical in V2 and V3:

| Request | Result |
| --- | --- |
| `/enrollments/575?perPage=1&startPage=1&total_count=true` | HTTP 400, missing column |
| Same request with `startPage=2` | HTTP 200, enrollment 678, null group, total count 3 |
| Same request with `startPage=3` | HTTP 200, enrollment 677, null group, total count 3 |
| `/enrollments/575?perPage=100&startPage=1&total_count=false` | HTTP 400, missing column |
| `/enrollments/577` with no query parameters | HTTP 200 |
| `/enrollments/581` with no query parameters | HTTP 400, missing column |
| Client 575, normal counted request plus `$filter=groupId eq null` | HTTP 400, missing column |

The only other active enrollment for client 575 was grouped enrollment 725. Successful individual pages can still report a total count of three, so the evidence points toward processing the returned grouped row rather than calculating the collection count. The failure does not require explicit pagination parameters.

The filter did not produce a usable response. This test cannot establish whether the server ignored the filter, applied it after the failing query, or handled it another way. Neither filtering nor skipping failed pages is a verified workaround. Page order can change, and skipping a page would omit existing enrollments.

## Separate observations

- Individual enrollment 680 for client 579 returned HTTP 400, `Non-static method requires a target.`, in both versions. Its client enrollment list succeeded. This is a separate complete-read failure, not the missing-column error. The [follow-up investigation](enrollment-complete-target-error.md) isolated missing DOB information through four new synthetic enrollments: DOB alone or either tested unknown/declined quality response cleared the error. It also documents working alternate reads. A historical observation of that message on enrollment 677 did not reproduce in this run; 677 returned HTTP 200 in both versions.
- Client 619 had zero active enrollments in the counted GWT read, and its REST enrollment collection returned HTTP 404 in both versions. This is an additional empty-collection behavior, separate from both errors above. It should not be interpreted as proof that the client is missing.

## Impact and SDK workaround

Applications cannot use these REST endpoints to read the affected household enrollments. A mixed client's full list can fail even when its individual enrollments are readable. V2 is not a fallback. Returning only successful pages would hide household participation and could undermine duplicate protection.

The shelter and enrollment workflows use authenticated, current UI/GWT reads and verify complete row counts. A failed REST read must never trigger a replacement enrollment write. The records remained present in GWT and the UI; this test found a read failure, not evidence of failed enrollment creation.

## Questions for WellSky

- Which grouped-enrollment query or projection references `v.entry_date_effective` at SQL position 116? Is the alias or column incorrect, or is the deployed sandbox view/schema out of sync with the API?
- Do V2 and V3 share this grouped-record query? The tested versions returned identical errors while individual records in the same client remained readable.
- Why does the null-group filter fail to isolate readable individual records? Is `$filter` supported on this endpoint before grouped-record expansion?
- Can a database schema failure return a server-error status with a support correlation ID rather than HTTP 400?
- Can the separate complete-read target error and empty-enrollment 404 convention be tracked independently?

Private evidence retains sanitized response statuses, timestamps, returned IDs, body hashes, and response-header metadata. No credentials, raw authenticated GWT payloads, or client demographics are included in this report. The comparison was observational; it did not add or remove household membership to prove causality, inspect the database, or test production.
