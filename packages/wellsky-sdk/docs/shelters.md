# Shelters: household check-in and checkout

[Documentation index](README.md) · [Services](services.md) · [Enrollments](enrollments.md) · [Example](../examples/shelters.mts)

Use `createShelters` with `createShelterUi`, a dedicated managed application page, and a durable mutation store. Set the session and REST client to the same tenant. Recording an ordinary service with an Emergency Shelter AIRS code does not assign a bed.

For read-only unit-list discovery, all named beds, occupants, and current vacancies, use [shelter inventory reporting](shelter-inventory.md). Inventory observations do not reserve beds or replace the write workflow's immediate availability check.

## Discover the tracking mode

`readShelterProgram(api, {providerId})` reads the actual provider's `projectType` and `emergencyShelterTrackingMethod` from `GET /providers/complete/{providerId}`. Emergency Shelter can return `Night-by-Night` or `Entry/Exit Date`. TH must be entry/exit. Unknown or inconsistent settings are rejected; the helper does not infer mode from names or AIRS codes.

REST service reads expose shelter stays, and complete-service reads add the bed name and associated need. A reproduction in a sandbox tenant returned an array for complete-service despite the documented object response. Provider `bedAndUnitInventoryInformation` is aggregate reporting inventory, not current vacancies or assignable beds. The pinned Swagger has no dedicated shelter check-in or bed-assignment write route.

## Check in a household

Supply a stable `key`, provider, unit list, household, head, explicit timezone-qualified `entryDate`, and exact named bed for every selected member. Each member must already belong to the household on that date. Named beds must be unique and available. Overflow, holds, reservations, and later additions to an existing shelter group are not supported by this adapter.

| Mode | Enrollment behavior |
| --- | --- |
| Entry/exit | One fresh UI check-in creates the selected members' stays and enrollments. A preexisting covering enrollment blocks check-in to prevent an implicit duplicate enrollment. |
| Night-by-night | Default `enrollmentStrategy: 'require-existing'` requires one covering same-program enrollment per member. Explicit `create-if-missing` can journal creation of the head's enrollment and attach members through the existing GWT enrollment helper before checking in. Partial or ambiguous enrollment groups stop the operation. |

An enrollment in a different provider never covers the stay, even when the providers have similar names or belong to the same organization. Selected members must share a covering enrollment group with the head. Shelter service group IDs and enrollment group IDs are different identities; do not join them by equality.

A single selected member can have a null shelter group or enrollment group. Multiple selected members must have a common non-null group within each record type. On forms that omit a checkbox for the client named in the verified form heading, the adapter treats that client as selected. Every additional requested member must have an explicit checked control.

Close unfinished check-in and checkout forms before starting a helper operation. The adapter refuses navigation when either a Save or Save & Exit control identifies an unfinished shelter form.

Prepare program-required assessment answers explicitly. This helper does not complete the enrollment assessment or create HUD verification rows. It reports validation failures without choosing answers. The TH check-in sets the head's relationship to Self; application workflows remain responsible for each member's complete assessment.

## Check out selected members

Supply a new stable key, the verified `checkInKey`, exact `clientIds`, `checkoutDate`, `lastNight`, and IANA `timeZone`. Checkout must fall on the calendar day following the supplied last occupied night. The helper does not infer the last night from check-in or silently add seven hours.

- Entry/exit requires destination and reason for leaving, verifies each selected enrollment's exit, and blocks exiting the head before remaining members. Conditional Other explanations and rental-subsidy details are not supported by this shelter adapter; use a separately supported exit workflow when those are required.
- Night-by-night checkout preserves program enrollments. Omit destination and reason. A checkout does not mean the client has left the program.
- Unselected records in the readback scope must remain unchanged, including a selected client's historical same-provider stays and other-provider enrollments. The scope includes shelter history for the check-in's selected clients and provider, and enrollment rows read for the household's clients. This is not a tenant-wide change audit. Selected members can check out separately, with the head last in entry/exit mode.

The form may include a required exit assessment. Populate its answers before checkout and confirm they are visible in the applicable date/context. A missing required answer fails the save. The helper waits for asynchronous form loading before saving; UI visibility alone is not proof that answers have loaded.

The application's supplied night-by-night rule is to exit after 90 days without a stay, or an explicit program exit, dated the day following the last shelter night. **No inactivity scheduler or automatic exit operation is implemented.** Resolve open stays, incomplete history, and head-of-household conflicts before any separate inactivity process exits enrollments.

## Retry and recovery contract

The durable store records immutable intent and attempted writes before mutation requests are sent. It pins each stay, need, client, bed ID, unit-list ID, group, and enrollment. The UI Codes/Notes field contains an opaque source-key marker; this is distinct from REST `serviceNote`. Removing the marker or changing pinned identities causes a conflict.

Retry the same key and unchanged input with the same store after reauthentication. The helper reads current REST and counted GWT state first. A saved result is returned without another Save. A missing, partial, or uncertain attempted write blocks further writes, including replacement keys. Inspect and reconcile it; do not delete the journal to force a retry. The workflow is not an atomic server transaction and cannot prevent unrelated external writers from racing.

REST stay history follows the counted total through short pages, including tenants that cap the requested page size. Duplicate records, changing counts, an empty page before the total is reached, and the 1,000-page safety limit stop the workflow. Checkout verifies the original enrollment IDs, entry dates, and group IDs again after saving. Matching exit fields on a replacement enrollment do not count as success.

Checkout excludes only the selected stay IDs and, in entry/exit mode, the selected covering enrollment IDs from its unchanged-record checks. An unrelated record change produces a conflict after the save. It does not roll back server changes or permit another save on retry.

A verified retry checks current state. Later external edits can produce a conflict instead of a cached success. Persist the journal outside ephemeral containers, and supply shared locking/storage for multi-host writers. The bundled file store is for cooperating processes on one host.

If form preparation fails before any shelter save, `cancelUnsubmittedCheckIn({key})` can explicitly close that unfinished intent. It refuses any attempted shelter save, uncertain enrollment write, or new shelter record. It preserves the audit journal and all server records, returns any retained verified enrollments, and permanently rejects reuse of the cancelled key. After reviewing that result, an application can begin a corrected operation using the retained enrollments. This is not recovery for an ambiguous submitted save.

## Server issues and evidence

See the shareable [WellSky issue log](vendor-issues/README.md), including:

- [HTTP 404 for an existing client's empty service list](vendor-issues/empty-service-list-404.md). The helper only accepts this first-page response as empty when an independent counted GWT read proves zero active services.
- [Enrollment reads fail with `v.entry_date_effective` missing](vendor-issues/enrollment-effective-date-column.md). Current counted GWT enrollment reads provide the fallback. A failed REST read never authorizes a replacement enrollment.

Earlier read-only sandbox checks confirmed wrong-provider enrollments for the user-created night-by-night example and matching-provider enrollments for the TH example. Those originals were left unchanged. Complete-service reads exposed bed assignments; null bed names occurred for overflow. Associated shelter needs existed, but their REST status was null. Do not apply the ordinary service recorder's Closed/Fully Met guarantee to shelter-generated needs.

The live behavior described here was reproduced in a sandbox tenant. Emergency-shelter entry/exit, overflow, confirmations, inventory administration, conditional exit details, and automated inactivity closure require separate acceptance work.

October 24, 2026 write acceptance used two new two-member synthetic households. TH check-in created two stays and two enrollments; a single household checkout closed both stays and both enrollments with the requested destination and reason. The head-only exit was blocked. Night-by-night check-in required separate same-program enrollments, and checkout closed its two stays while preserving both open enrollments. Repeated check-in and checkout keys returned the original records, changed intent was rejected, and a simulated lost acknowledgement after the nightly UI save reconciled without a second save. Required assessment answers were prepared explicitly; these tests do not establish full assessment or HUD-verification completion.

A later October 24 audit manually saved and reopened a single-person TH check-in and a next-day checkout in the sandbox UI. The inventory showed a blank shelter group, and the single-client checkout form had no member checkboxes. The packaged adapter's implicit-client handling, nullable-group contract, collateral-change detection, and retry behavior are covered by synthetic source and installed-package tests. That later manual UI run did not execute the packaged Playwright/GWT adapter against the live tenant or repeat the earlier multi-member and night-by-night acceptance.

## Meaningful contacts in night-by-night shelter

Use the [Current Living Situation recorder](current-living-situation.md) for each meaningful client contact. A bed stay is not a substitute for a contact event or the client's actual living-situation answer. Keep the subassessment start at program entry, put the contact date in Information Date, and allow an empty end.
