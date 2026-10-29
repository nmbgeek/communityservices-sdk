# Shelter inventory and vacancies

[Documentation index](README.md) · [Shelter writes](shelters.md) · [Types](../browser/shelter-inventory.d.mts) · [Example](../examples/shelter-inventory.mts)

`createShelterInventory({page})` provides read-only reporting for an authenticated, dedicated Playwright page for the target tenant. It discovers the provider's visible unit lists, lists named beds and their occupants, and reports current vacancies when the visible evidence supports a complete count. It does not require a REST client or mutation journal.

```ts
import {createShelterInventory} from '@choiceapps/communityservices-sdk/browser';

const inventory = createShelterInventory({page: session.page});
const catalog = await inventory.listUnitLists({providerId});
for (const {unitListId} of catalog.unitLists) {
  const snapshot = await inventory.getInventory({providerId, unitListId});
  if (snapshot.availability.status === 'known') {
    // Use snapshot.availability.vacantCount and vacantBedKeys for this observation.
  } else {
    // Report unavailable information. Do not turn null into zero vacancies.
  }
}
```

Each operation navigates the page. Use the same page object as other SDK helpers so their shared page lock serializes operations. Close unfinished forms first. Open dialogs, shelter Save controls, login screens, and URLs outside the bound tenant block the read. No Save, Hold, Release, Check In, Check Out, or Transmit action is clicked by the inventory API. Discovery selects a provider, reads its unit-list dropdown, and opens the read-only Unit Availability view. The bed scan selects a unit list, chooses View All, and clears the display filter to All Beds.

## What the result means

| Field | Meaning |
| --- | --- |
| `provider`, `unitList.unitListId` | Provider identity and unit-list ID from the selected UI context and dropdown. |
| `beds` | Every named bed in the verified visible list, including vacant and held beds. This excludes overflow rows. |
| `beds[].status` | `occupied`, `vacant`, `unavailable`, or `unknown`. HELD is unavailable. An unrecognized status or EMPTY row without an available check-in control is unknown. |
| `beds[].occupant` | Client ID, displayed name, displayed entry date, group, and scheduled-checkout indication for a recognized occupied row. DOB and sex are not returned. Unknown rows do not establish an occupant identity. |
| `counts` | Named beds by observed status. `unavailable` is currently the verified HELD state. `unknown` must remain separate. |
| `overflow.occupants` | Occupants shown in overflow, outside named-bed counts. |
| `overflow.entryAvailable` | Whether the UI offers an EMPTY Overflow (New) action. This is not a number of additional beds or a capacity guarantee. |
| `unitList.reported` | Counts from the live Unit Availability view. Its `usedBeds` includes held beds, so it is not an occupant count. These are not the provider REST reporting-inventory fields. |
| `availability` | A known vacancy count and matching bed keys only when all named rows are classified and counts reconcile. Otherwise status is unknown, count is null, and the candidate-key list is empty. |

Future-dated checkouts stay occupied while the UI displays the occupant. The tooltip's checkout time is returned as `localDateTimeText`; it is not converted to UTC or used to predict future availability. `dateInText` is also display text, not an exact check-in instant. `not-indicated` means the UI supplies no scheduled-checkout indication, not that a backend exit date is definitely null. Refresh the inventory after the scheduled time to learn the actual current state.

Availability is a snapshot, not a reservation. A vacant bed may have eligibility, referral, operational, or permission restrictions this reader cannot determine. The write workflow must check availability again immediately before check-in.

## Identifiers and freshness

The inventory table's numbered control IDs are row positions. They are never returned as server bed IDs. `bedId` is explicitly null because the verified visible table does not expose that identifier.

`bedKey` is a JSON tuple of tenant, provider ID, unit-list ID, unit label, address label, and bed label. It stays stable across sorting and occupancy changes. A renamed or moved bed changes the key. Duplicate paths reject the read because the UI cannot distinguish them reliably. Use the key to match reports under that identity contract; do not pass it to a backend write expecting a numeric bed ID. Occupant client IDs and unit-list IDs remain numeric server identities.

`freshness.startedAt`, `observedAt`, and `completedAt` are host UTC timestamps spanning the reads. `observedAt` marks the bed-table observation, or the completed catalog observation. `sourceUpdatedAt` is null because no server update timestamp is exposed. `atomic` is false. There is no cache, historical as-of query, or future-vacancy projection. Separate unit-list calls have separate observation windows; combining them does not create an atomic provider-wide snapshot.

## Completeness and failure behavior

Catalog discovery matches the selected provider's dropdown IDs and unique names against every counted page of the Unit Availability popup. It checks page ranges, counts, duplicates, and provider names. The bed scan requires the verified All Beds table, separates occupied overflow from the new-overflow action, and reconciles named-bed and overflow totals. It reads availability again afterward and rejects changed totals or rows. An unchanged count cannot exclude every concurrent change between reads.

Successful results explicitly say `complete-visible-provider` or `complete-visible-unit-list`. These mean complete within this account's visible UI scope, not every configured or inactive bed in the tenant. They do not override row-level unknown statuses. A missing table, clipped bed list, incomplete page sequence, duplicate identity, changed counts, unexpected layout, or failed read produces `ShelterInventoryError` with code `SHELTER_INVENTORY_UNAVAILABLE` and a sanitized `reason`. It never becomes an empty successful result. A zero-list result requires a counted zero in the popup as well as an empty dropdown. A known zero vacancy requires complete evidence.

Default limits are 100 availability pages, 1,000 unit lists, and 10,000 named-bed plus occupied-overflow rows. Callers may lower `maxPages`, `maxUnitLists`, and `maxBeds`; these are also the maximum permitted values. The bed table has no verified pagination control. If its row count falls below the counted total, `incomplete-inventory` stops the read instead of guessing how to fetch more. `timeoutMs` defaults to 30,000 ms per wait, with a maximum of 60,000 ms; it is not an overall multi-page deadline.

Useful error reasons include `authentication-required`, `application-page-required`, `unfinished-form`, `unit-list-unavailable`, `availability-unavailable`, `incomplete-unit-lists`, `incomplete-inventory`, `inventory-changed`, `ambiguous-bed-identity`, `duplicate-occupant`, `page-limit`, and `bed-limit`. Unexpected browser errors become `read-failed` without embedding client names, page text, or raw browser errors. Managed sessions can also surface the existing session-interruption contract. Correct the cause and perform a fresh read; reads do not create mutation receipts.

## Evidence and limits

October 24, 2026 sandbox UI discovery verified the provider selector, numeric unit-list dropdown, full bed table, scheduled-checkout tooltip, counted Unit Availability popup, and HELD behavior. A temporary single-bed hold increased Used and decreased Available by one; releasing it restored the EMPTY row. The live table distinguished named beds, occupied overflow, and Overflow (New).

Source and installed-package tests run the public inventory reader in local Chrome against synthetic pages with all network requests intercepted. They cover counted pagination, row ordering, future checkout, holds, overflow, unknown states, mismatches, limits, and blocked forms. The live checks directly exercised UI controls and DOM extraction; they did not execute the installed package through the attached browser. That browser lacks the full Page interface. This new reader avoids GWT interception and authenticated fetch, but its automated live integration still needs a supported authenticated Playwright Page. Multi-page availability, alternative roles, and other inventory layouts have synthetic coverage only. No production behavior is claimed.
