# Independent needs and service types

`createNeedRecorder` records a need without a service or referral. This supports workflows such as a Point in Time count's need for emergency shelter. The supplied V2/V3 Swagger documents reads of needs, but no independent-need create operation or service taxonomy catalog. These helpers therefore use the authenticated UI and counted GWT reads in the configured tenant.

```ts
import {
  createNeedUi, createNeedRecorder,
} from '@choiceapps/communityservices-sdk/browser';

const ui = createNeedUi({page: session.page});
const catalog = await ui.listServiceTypes({clientId});
const quicklist = await ui.listServiceQuicklist({clientId, providerId});
// Let the application choose from quicklist.types or catalog.types.
const chosen = catalog.types.find(t => t.serviceCodeId === selectedServiceCodeId);
if (!chosen) throw new Error('Select an available service type');
const needs = createNeedRecorder({ui, store});
await needs.record({
  key: sourceEventId, clientId, providerId,
  serviceCodeId: chosen.serviceCodeId,
  needDate: observedAt, // timezone-qualified instant, whole seconds
  status: selectedStatus, outcome: selectedOutcome,
  note: 'Synthetic PIT emergency shelter need',
});
```

Custom adapters must supply an explicit `tenant` to `createNeedRecorder`; the packaged UI adapter supplies its bound connection automatically.

The application supplies the provider, source event ID, date, and status/outcome. Choose labels from `quicklist.needOptions`. Independent needs do not default to Closed/Fully Met. A `Not Met` outcome can include `reasonUnmet`; `amount` optionally records a nonnegative financial amount with up to two decimal places. No household members are silently included.

## REST route investigation

Authenticated sandbox probes on October 24, 2026 found no standalone need-create route among eight candidates in either API V2 or V3. Live Swagger matched the pinned specifications.

| POST route tested | V2 and V3 result |
| --- | --- |
| `/needs`, `/needs/create`, `/needs/add` | 405 Method Not Allowed; `Allow: GET` |
| `/need/create`, `/services/needs/create`, `/needs/household/create` | 404 Not Found |
| `/needs/create/0`, `/needs/household/create/0` | 404 Not Found |

Probes used malformed JSON with no valid client IDs or write data. As a control, documented `POST /services/create` reached JSON validation and returned 400. `GET /needs/create` returned a validation error identifying `create` as an invalid `clientId`, confirming that this path matches `/needs/{clientId}` rather than a create action. No probe reached a valid write.

These results rule out the tested routes, not every possible undocumented URL. The SDK continues to use the verified UI/GWT `saveNeeds` operation for independent creation. `/services/needs/household/update/{serviceId}` is an update associated with an existing service, not an independent create operation.

## Discover types for both needs and services

`listServiceTypes({clientId})` returns the **tenant-wide** catalog:

- `codeSets`: configured code-set IDs and names, including AIRS Taxonomy when configured.
- `types`: active assignable terms, each with `serviceCodeId`, taxonomy `code`, `description`, `codeSetId`, and `parentServiceCodeId`.

`listServiceQuicklist({clientId, providerId})` separately returns the selected program/provider's `types` and `needOptions` (status, outcome, and unmet-reason picklists). It reads only that quicklist's terms, without fetching the full catalog. Service types are configured at the tenant level, not per user or program; quicklists are configured per program/provider. Both methods require an authenticated session. `clientId` supplies browser navigation context, not a catalog filter.

The catalog follows the UI's exclusion of target-population Y codes and Modality/Delivery Format facets. It reads ordered, counted pages and rejects inconsistent counts, duplicate IDs, or catalogs above 50,000 terms. The provider quicklist is a convenience subset, not the full lookup. A parent ID can refer to an unassignable hierarchy node omitted from this selection list. Preserve the source code-set identity; do not assume every deployment uses AIRS or the same numeric IDs.

Pass `chosen.serviceCodeId` to independent needs; pass `chosen.code` as `body.serviceCode` to the [service recorder](services.md). These choices describe service types, not eligibility, SSVF conditional fields, funding availability, or authorization to use a provider. Use the service recorder's separate SSVF and funding contracts for those fields. The SDK does not bundle the licensed taxonomy or publish tenant catalogs.

## Cache the catalog in your application

Cache `listServiceTypes` results **once per instance/tenant**, instead of fetching the full catalog for every form, user, program, or transaction. The sandbox catalog contained 2,835 assignable terms when verified; its count and contents can change. Serve the cached list to your type selector and reuse the selected ID/code for subsequent transactions. The write helper opens its own fresh form and checks that the selected code is still active and assignable; it does not enumerate the entire catalog before every save.

Cache `listServiceQuicklist` separately by **instance/tenant and provider/program ID**. When the application switches programs, fetch or reuse that program's small quicklist and combine it with the existing tenant catalog. Do not invalidate the tenant catalog just because the program or user changes. The application still controls which users may access its cached data.

Use a configurable TTL appropriate to how often your organization changes configuration, such as one hour as an application starting point, and offer an explicit refresh. Invalidate the tenant catalog when service-type/code-set configuration changes, and invalidate the affected program's quicklist when its configuration changes. If a selected code is no longer accepted, refresh and have the application resolve the choice; do not substitute another code automatically. Coalesce concurrent refreshes so several forms do not fetch the same catalog repeatedly. Keep cached tenant/licensed taxonomy data within your application's authorized scope.

This is an application cache recommendation, not a built-in SDK cache or a promise that an old selection remains valid. Do **not** cache need-record reads used for duplicate detection, journal reconciliation, or post-save verification. Those reads must remain fresh.

## Retry and verification contract

Keep a persistent [mutation store](browser-session.md) and the same source key across restarts. A hash marker is appended to the need note. Source keys are scoped across clients, so reusing a key for another client or changed input is rejected before any browser operation.

The adapter opens a fresh Add Need form, journals immediately before its single Save & Exit click, and performs counted reads of active needs and service/referral links. It verifies the client, provider, code ID, exact stored instant, note, amount, status, outcome, unmet reason, and absence of associated service records. Stored dates are not shifted.

An identical retry verifies the original ID without another save. A lost response can reconcile if the marker and fields identify one saved record. Missing records after an attempted save, duplicate markers, replaced IDs, edited fields, or subsequently attached services produce `NeedConflictError` (`code: NEED_CONFLICT`). Inspect its `reason`; do not regenerate the key to bypass it. A failed read never proves absence. There is no server-side idempotency key and no protection against unrelated external writers copying the marker.

Use a dedicated managed page. Close any unfinished form or dialog before reconciling an interrupted save. Reauthentication never replays the save. `ui.list({clientId})` provides counted stored readback; the REST SDK's `needs.getComplete` remains available for a second read. The REST representation may omit the financial amount.

See the shipped [independent-needs example](../examples/independent-needs.mts) for discovery, PIT recording, and using the same selected type with a service.
