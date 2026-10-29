import type { Page } from 'playwright-core';

export interface ShelterInventoryFreshness {
    /** Host UTC timestamps spanning the reads, not a server transaction timestamp. */
    startedAt: string;
    observedAt: string;
    completedAt: string;
    sourceUpdatedAt: null;
    atomic: false;
}
export interface ShelterInventoryLimits {
    maxPages: number;
    maxUnitLists: number;
    /** Named beds plus occupied overflow rows. The new-overflow action is excluded. */
    maxBeds: number;
}
export interface ShelterInventoryReportedCounts {
    totalBeds: number;
    /** Includes held beds. Do not use this as the number of occupants. */
    usedBeds: number;
    availableBeds: number;
    overflowOccupants: number;
}
export interface ShelterUnitList {
    providerId: number;
    unitListId: number;
    name: string;
    type: string;
    reported: ShelterInventoryReportedCounts;
}
export interface ShelterInventoryOccupant {
    clientId: number;
    displayName: string;
    /** UI text only. No timezone or exact check-in instant is inferred. */
    dateInText: string | null;
    groupId: number | null;
    /** A scheduled checkout never makes the bed vacant in this snapshot. */
    scheduledCheckout: { status: 'scheduled'; localDateTimeText: string } | { status: 'not-indicated' | 'unknown' };
}
interface ShelterInventoryBedIdentity {
    /** JSON tuple of tenant, providerId, unitListId, unit, address, name.
     * Stable across row ordering and occupancy changes, changes on renaming.
     * Never pass this key as a server bed ID. Duplicate paths reject the read.
     */
    bedKey: string;
    /** The visible inventory does not expose a server bed ID. */
    bedId: null;
    unit: string;
    address: string;
    name: string;
}
export type ShelterInventoryBed = ShelterInventoryBedIdentity & (
    { status: 'occupied'; reason: null; occupant: ShelterInventoryOccupant } |
    { status: 'vacant'; reason: null; occupant: null } |
    { status: 'unavailable'; reason: 'held'; occupant: null } |
    { status: 'unknown'; reason: 'unrecognized-row' | 'check-in-unavailable'; occupant: null }
);
export type ShelterVacancySnapshot = {
    status: 'known'; vacantCount: number; vacantBedKeys: string[];
} | {
    status: 'unknown'; vacantCount: null; vacantBedKeys: []; reasons: ['unclassified-beds'];
};
interface ShelterInventoryObservation {
    provider: { providerId: number; name: string };
    source: 'ui';
    freshness: ShelterInventoryFreshness;
    limits: ShelterInventoryLimits;
}
export interface ShelterUnitListSnapshot extends ShelterInventoryObservation {
    completeness: 'complete-visible-provider';
    unitLists: ShelterUnitList[];
}
export interface ShelterInventorySnapshot extends ShelterInventoryObservation {
    completeness: 'complete-visible-unit-list';
    unitList: ShelterUnitList;
    beds: ShelterInventoryBed[];
    counts: { total: number; occupied: number; vacant: number; unavailable: number; unknown: number };
    overflow: { occupants: ShelterInventoryOccupant[]; entryAvailable: boolean };
    /** A snapshot, not a reservation or an admission/eligibility decision. */
    availability: ShelterVacancySnapshot;
}
export interface ShelterInventory {
 readonly connection?:import("./connection.mjs").UiConnection;
    listUnitLists(input: { providerId: number }): Promise<ShelterUnitListSnapshot>;
    getInventory(input: { providerId: number; unitListId: number }): Promise<ShelterInventorySnapshot>;
}
export function createShelterInventory(options: {
    /** Dedicated authenticated application Page, shared with other SDK helpers through their page lock. */
    page: Page;
    /** Default and maximum 100 counted availability pages. */
    maxPages?: number;
    /** Default and maximum 1,000 visible unit lists. */
    maxUnitLists?: number;
    /** Default and maximum 10,000 bed/occupied-overflow rows. */
    maxBeds?: number;
    /** Per-wait timeout, default 30,000 ms, maximum 60,000 ms. */
    timeoutMs?: number;
}): ShelterInventory;
export class ShelterInventoryError extends Error {
    readonly code: 'SHELTER_INVENTORY_UNAVAILABLE';
    readonly reason: string;
    constructor(reason: string);
}
