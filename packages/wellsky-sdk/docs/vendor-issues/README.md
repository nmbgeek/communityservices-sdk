# Issues for WellSky support

[Documentation index](../README.md)

These reports describe observed Community Services Client API behavior. Reproductions use synthetic records in a sandbox tenant. They do not establish behavior in other tenant deployments. Credentials, client demographics, and raw authenticated browser payloads are excluded.

This is a feedback queue prepared for WellSky. It does not claim that these reports have been submitted, acknowledged, or fixed. The priorities below reflect integration impact. [Implementation rationale](../integration-methods.md) explains how each limitation affects the SDK's choice of REST, GWT-RPC, or browser operations.

## Reproduced failures to raise first

| Issue | Status | Impact |
| --- | --- | --- |
| [Empty service collection returns HTTP 404](empty-service-list-404.md) | V3 reproduced October 24, 2026 | An existing client with zero services cannot be recognized as an empty collection from the REST status alone. |
| [Grouped enrollment reads report a missing database column](enrollment-effective-date-column.md) | V2 and V3 compared October 24, 2026 | All 16 tested grouped complete reads per version failed; individual enrollment pages in the same client could succeed. V2 is not a workaround. |
| [Missing DOB information triggers a complete-read target error](enrollment-complete-target-error.md) | V2 and V3 reproduced October 24, 2026 | DOB alone or unknown/declined DOB quality alone cleared the error in four synthetic fixtures; no birth date is needed for the tested quality responses. |
| [Service creation persists despite an HTTP 400](write-contracts.md#a-service-persisted-despite-http-400) | Reproduced October 24, 2026 | Retrying the failed create can duplicate a saved service. |
| [Omitted SSN is cleared by a client update](write-contracts.md#omitting-ssn-from-a-client-update-cleared-it) | Reproduced October 23, 2026; intended update semantics need clarification | A middle-name-only request cleared another field; the SDK preserves current fields before updating. |
| [Complete entry projection omits valid verification rows](date-semantics.md#complete-entry-projections-omit-valid-verification-rows) | V2 and V3 reproduced October 22, 2026, including a UI-created control | A complete response can omit rows valid at enrollment; changing the write method did not fix it. |
| [DOB correction fails at an existing effective timestamp](date-semantics.md#correcting-dob-at-an-existing-effective-timestamp-fails) | Reproduced October 23, 2026 | Changing the timestamp avoids the error by changing history; the SDK uses a limited matching-entry UI correction. |
| [Attachment authentication fails after a successful client read](attachment-authentication.md) | V2/V3 reads and native multipart create investigated October 22, 2026 | REST attachment operations remain unusable with the tested account; cause and additional permission requirements are unconfirmed. |

Prioritize write outcomes, omitted-field data preservation, and verification/date correctness because they can cause duplicate, cleared, or misinterpreted data. Attachment authentication and grouped reads block public-API-only integrations. Empty-collection responses complicate safe reconciliation.

For the grouped-enrollment issue, create an entry/exit shelter stay for a synthetic household through the UI, verify the resulting enrollment, then request its client enrollment list and complete enrollment. Expected: the existing enrollments and their details. Actual in the tested tenant: the SQL error above. This failure also occurred on previously created household enrollments; shelter creation is one reproduction path, not a proven cause.

The enrollment report includes a read-only reproduction using existing synthetic IDs, a V2/V3 result matrix, and pagination controls. The [separate target-error investigation](enrollment-complete-target-error.md) compares sparse enrollment 680 with three successful individual enrollments and compares DOB-only and quality-only answers through four controlled synthetic fixtures. The grouped report also records an empty enrollment-list HTTP 404 observed in both versions.

## Contract and response questions

- [Client update semantics](write-contracts.md#omitting-ssn-from-a-client-update-cleared-it): omitting SSN cleared its value. Clarify replacement versus partial-update behavior before classifying the omission rule as a defect.
- [Goal update and relationship contract](write-contracts.md#goal-updates-require-a-field-marked-optional): `clientId` was required despite an optional schema field; returned household rows did not match the inspected goal association.
- [Mobile effective dates](date-semantics.md#mobile-answer-writes-shift-the-effective-date) and [DOB serialization](date-semantics.md#dob-serialization-can-disagree-with-the-ui-calendar-date): document timezone/date-only rules and resolve inconsistent stored or displayed values. These are separate from complete-entry filtering.
- [Filtering, empty reads, and response shapes](write-contracts.md#filtering-and-response-shapes-vary-by-operation): document per-endpoint syntax and align responses with schemas.
- [Household head coverage](household-head-validation.md): the server accepted writes that left members enrolled after the original head exited. Clarify the intended validation and supported head-transfer/repair workflow; the SDK rejects that state.

## Missing public capabilities

[Public API coverage requests](api-coverage.md) covers program assessment assignments, grouped workflows, independent needs, SSVF periods, need outcomes, funding allocations, Sex, goal case notes, and shelter beds. These are capability requests or questions about an existing supported route, not automatically server bugs.

## Evidence to include with a report

Use the smallest authorized reproduction, with API version, endpoint, exact sanitized request fields, expected and observed behavior, and a successful control where available. Include request timestamps and correlation identifiers when available. Identify whether the same result was reproduced outside the SDK or through an ordinary UI save.

Keep suspected causes separate from observations. Do not send tokens, passwords, raw GWT payloads, or client records. Obtain any tenant-specific evidence through the authorized support channel. Do not rerun historical mutation scripts simply to regenerate evidence.

[Capabilities](../capabilities.md) records the current SDK limits and acceptance evidence. These reports preserve the useful observations, reproduction controls, implementation consequences, and questions for WellSky.
