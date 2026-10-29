# Public API coverage requests

[WellSky feedback](README.md) · [Why the SDK combines methods](../integration-methods.md)

These are requests for documented capabilities or confirmation of an existing supported route. Absence from the pinned V2/V3 Swagger and the inspected workflows is not proof that WellSky has no other API. The browser behaviors were reproduced in a sandbox tenant through October 24, 2026.

| Capability requested | Why the integration needs it | Current method |
| --- | --- | --- |
| Provider-to-assessment assignments and entry/interim/exit defaults | A provider catalog and client question list do not identify the correct program instrument | Provider Admin discovery and counted GWT reads |
| Linked household enrollment, selected-member reviews, and exits | Independent client enrollments do not preserve the UI's group relationships and selected-member semantics | Current UI models and GWT operations, followed by separate assessment writes |
| Independent need creation and service-type catalogs | Recording a need must not require inventing a service or referral | Add Need form, counted GWT taxonomy and program quicklist reads |
| SSVF assistance start/end dates | Service dates and the financial assistance period are different values | REST for supported fields, UI completion for the period |
| Need outcome and funding allocation writes | Service creation alone did not establish Fully Met or persist funding allocations through a documented REST field | Fresh service form completion and independent stored-allocation readback |
| Contextual Funding Source choices | Permitted funds depend on provider, service code, cycle, and session; an unscoped catalog is insufficient | Current UI query context with counted GWT reads |
| Client Record Sex | Updating the legacy REST Gender field did not populate Sex | Current Client Record form |
| Goal case-note reads and writes | Goal case notes differ from Client Notes and were not exposed in the tested REST goal response | Browser workflow and GWT reads |
| Named-bed assignment and shelter check-in/checkout | An ordinary shelter service does not reserve or assign a bed | Current shelter UI with enrollment and stay verification |
| Complete bed/unit inventory and availability | Aggregate provider inventory does not identify individual beds, occupants, holds, or current vacancies | Read-only browser inventory views |
| Readable conditional form rules and historical option semantics | Current question metadata does not fully describe conditional visibility, required fields, or past picklist values | Current form discovery and explicitly dated rule snapshots |

## Contract details needed for a REST replacement

For each operation, request supported authentication and permissions, exact request fields, stable record identities, counted pagination, and authoritative readback. Writes also need documented validation order, partial-commit behavior, and a way to reconcile a lost response without creating duplicates.

For grouped operations, ask whether the server commits the group atomically and how it reports member-level failures. For inventory, ask how a write checks availability at commit time; a prior availability read cannot reserve a bed.

Browser automation can be removed only after a supported alternative preserves the business operation and the SDK's recovery guarantees. Generic mapped-query access or a captured GWT request is not a substitute for a documented public contract.
