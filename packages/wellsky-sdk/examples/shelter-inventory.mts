import type { Page } from 'playwright-core';
import { createShelterInventory, type ShelterInventorySnapshot, type ShelterStay } from '@choiceapps/communityservices-sdk/browser';

/** Uses the caller's dedicated authenticated application page. No credential loading. */
export async function reportShelterInventory(page: Page, providerId: number) {
  const inventory = createShelterInventory({ page });
  const catalog = await inventory.listUnitLists({ providerId });
  // Each list has its own observation interval. The provider report is not atomic.
  const snapshots: ShelterInventorySnapshot[] = [];
  for (const { unitListId } of catalog.unitLists) {
    snapshots.push(await inventory.getInventory({ providerId, unitListId }));
  }
  return { catalog, snapshots };
}

export function vacancyReport(snapshot: ShelterInventorySnapshot) {
  if (snapshot.availability.status === 'unknown') {
    return { status: 'unknown', reasons: snapshot.availability.reasons };
  }
  return {
    status: 'known',
    observedAt: snapshot.freshness.observedAt,
    count: snapshot.availability.vacantCount,
    beds: snapshot.beds.filter(bed => bed.status === 'vacant'),
  };
  // A later check-in must recheck availability. These keys are not server bed IDs.
}

// Null is a valid group for a single-person stay, including installed declarations.
export const singlePersonGroup: ShelterStay['groupId'] = null;
