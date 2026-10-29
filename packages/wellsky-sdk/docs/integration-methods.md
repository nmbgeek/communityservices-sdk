# Why the SDK uses REST, GWT-RPC, and browser forms

[Documentation index](README.md) · [Capabilities](capabilities.md) · [WellSky feedback](vendor-issues/README.md)

The SDK uses the public Client API where its contract covers the operation and stored results can be verified. Some workflows need fields, relationships, or reads that the public API does not expose reliably. Those workflows combine REST with the authenticated web application's forms and GWT-RPC calls.

These choices apply to every configured tenant. The evidence summarized here was reproduced in a sandbox tenant on October 22–24, 2026. A sandbox reproduction establishes an observation, not a separate SDK mode or a guarantee about every deployment.

## What each method means

| Method | What it does | Main tradeoff |
| --- | --- | --- |
| Public REST Client API | Uses the pinned V2 or V3 operations with REST authentication and typed request models | A documented operation can still have incomplete fields, surprising update semantics, or server errors |
| GWT-RPC | Calls the web application's internal services using its authenticated browser session and current serialization context | Depends on application models, module headers, and serialization policy that can change with the UI build |
| Browser forms | Opens current forms, reads controls, selects intended values, and submits through the application | Preserves the application's current serialization and form behavior, but depends on layout and asynchronous UI updates |
| Browser multipart endpoints | Uploads or downloads files in the web application's authenticated context | Uses a different authentication and entity contract from REST attachments |
| Local workflow orchestration | Coordinates discovery, durable journals, locks, retries, and verification across those methods | Cannot turn separate server requests into one transaction or lock out unrelated writers |

GWT-RPC is also a server API. Browser forms and GWT-RPC are not mutually exclusive: submitting a form often sends a GWT request. A GWT POST can also be a read. HTTP method alone does not identify a business mutation.

## Decisions by workflow

| Workflow | Chosen method | Reason and alternative rejected |
| --- | --- | --- |
| Client creation, ordinary reads, and supported profile fields | REST, with durable orchestration for writes | These operations have usable REST contracts. The profile helper preserves current fields because an omitted SSN was cleared by a raw update. Replacing all REST operations with browser actions would add UI dependencies without solving that contract issue. See [profiles](profiles.md). |
| Program and assessment discovery | REST provider catalog and client-scoped question definitions; admin UI and counted GWT reads for assignments/defaults | The provider list does not identify the entry, interim, and exit instrument assigned to each program. Guessing an assessment from its name can select the wrong form. See [assessments](assessments.md) and [enrollments](enrollments.md). |
| Household membership, linked enrollments, interims, and exits | REST for supported records and answers; current UI/GWT for the grouped business operation | Household membership is distinct from linked enrollment membership. Separate ungrouped enrollments do not reproduce a household operation. Grouped REST reads also fail in the reproduced cases, so verification uses fresh UI/GWT evidence. See [enrollments](enrollments.md). |
| Verification rows at entry | Generic assessment REST reads plus explicit interval filtering | Complete-enrollment projections omitted valid rows. The alternative assessment read includes future-start rows, so returning its raw list would also be wrong. `readEnrollmentVerifications` compares original row intervals with the enrollment instant. See [dates and answers](dates-and-answers.md). |
| DOB | REST for a new effective timestamp; matching entry-assessment UI for the supported same-timestamp correction | The tested REST update failed at an existing effective timestamp. Moving the timestamp would change history rather than correct the answer. DOB encoding is separate from mobile answer effective-date correction. See [profiles](profiles.md). |
| Sex in Client Record | Current UI form, which submits GWT | The legacy REST Gender field did not populate Sex. Treating the fields as aliases would silently update the wrong information. See [profiles](profiles.md). |
| Services and SSVF | REST creation followed by current UI completion and REST/GWT verification | REST covers ordinary service fields and several SSVF choices. It does not cover all assistance-period, need-outcome, or funding-allocation fields used by the workflow. A successful REST create alone is not a completed service workflow. See [services](services.md). |
| Independent needs and service-type discovery | Add Need form and counted GWT reads | The pinned public API has need reads but no independent-need create operation or full service-type catalog. Creating a service solely to obtain a need would create a different business record. See [independent needs](independent-needs.md). |
| Shelter stays and bed assignments | REST provider settings; UI check-in/checkout with fresh enrollment and stay reads | An ordinary shelter-coded service does not assign a bed. Aggregate provider inventory is not a list of currently assignable beds. See [shelters](shelters.md). |
| Shelter vacancies | Read-only browser inventory views | The visible unit lists, bed states, holds, and counted availability provide the required detail. The reader reports unknown availability when those views are incomplete. See [inventory](shelter-inventory.md). |
| Attachments | Browser multipart upload/download, GWT metadata reads, and downloaded-byte verification | REST attachment authentication failed independently of SDK serialization. Browser uploads succeeded for the supported locations. This does not establish anonymous access or sharing permissions. See [files and notes](files-and-notes.md). |
| Client Notes, goals, and action steps | REST writes, with counted UI/GWT reads where an initial empty collection needs confirmation | An initial REST 404 cannot establish absence. The helper verifies ownership and supported saved fields before accepting completion. Goal case notes are separate records and use the browser workflow because the REST goal response did not expose them. See [durable records](durable-records.md). |

## Why fresh GWT context matters

The early enrollment experiment intercepted a request generated by the current form, prevented its original transmission, and submitted it once in the same session. It established that fresh UI-generated requests could perform the member and interim operations. It did not establish a portable request template or safe repetition of a successful mutation.

GWT payloads contain serialized models, object references, type signatures, and string-table indices as well as record IDs. Replacing numbers in a captured body can change unrelated values or retain stale state. The SDK therefore uses fresh models and current application serialization context rather than storing payloads for later replay.

For enrollment helpers that prepare an intercepted request, the original UI submission is aborted before the journaled send. Other adapters submit the current form directly. Both paths need readback of identities, dates, participants, and saved values. An HTTP 200 can contain a GWT exception response; transport success alone is insufficient. See [the session adapter contract](browser-session.md).

The browser dependency has a cost: UI layouts and GWT serialization can change independently of the public API. Helpers reject unsupported or ambiguous states instead of guessing a new control or payload. Browser credentials also remain separate from REST credentials.

## Why a failed write does not trigger a different method

Method selection happens before a mutation. The SDK does not interpret a failed REST write as permission to repeat the same operation through GWT or a browser form. A service creation was observed to persist despite an HTTP 400, and controlled tests also reproduce lost acknowledgements and session loss after a commit.

Durable journals preserve the original intent and attempted stages. A retry first reconciles saved state with that original operation. Reauthentication restores access; it does not replay the callback. A changed key, discarded journal, or alternate transport would lose the evidence needed to avoid a duplicate.

Some workflows intentionally have several stages, such as REST service creation followed by UI completion. Those stages are not atomic. A failed later stage can leave the earlier record saved. See [recovery](troubleshooting.md) and [write-contract feedback](vendor-issues/write-contracts.md).

## What would allow a simpler implementation

A documented REST operation could replace a browser dependency when it exposes the required fields and relationships, preserves unrelated data, and supports authoritative readback. A migration must also preserve existing source keys and journal reconciliation. Merely adding a route with a similar name is insufficient.

[WellSky feedback](vendor-issues/README.md) separates reproduced failures from contract questions and missing-capability requests. Existing SDK guides remain the integration contract; historical experiments are evidence for these choices, not procedures to replay.
