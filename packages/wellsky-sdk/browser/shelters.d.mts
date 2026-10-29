import type { Page } from 'playwright-core';
import type { WellSkyClient, GwtEnrollmentHelpers } from '../dist/esm/index.js';
import type { UiMutationStore } from './index.mjs';
export type ShelterMode = 'night-by-night' | 'entry-exit';
export interface ShelterProgram {
    providerId: number;
    name: string;
    projectType: string;
    trackingMethod: string;
    mode: ShelterMode;
}
export interface ShelterMemberBed {
    clientId: number; /** Exact unique bed name within the selected unit list. Overflow is currently unsupported. */
    bedName: string;
}
export interface ShelterCheckInInput {
    key: string;
    providerId: number;
    unitListId: number;
    householdId: number;
    headClientId: number;
    entryDate: string;
    members: ShelterMemberBed[];
    /** Night-by-night only. Default requires covering enrollments. Explicit creation journals the first head enrollment and attaches members. Entry/exit check-in creates its own enrollments through the UI. */
    enrollmentStrategy?: 'require-existing' | 'create-if-missing';
}
export interface ShelterCheckoutInput {
    key: string;
    checkInKey: string;
    clientIds: number[];
    checkoutDate: string;
    /** Calendar date of the last occupied night, established by the caller. Checkout must be the following calendar day in timeZone. */
    lastNight: string;
    timeZone: string;
    /** Required only for entry/exit mode. Conditional Other/subsidy destinations are not supported by this initial shelter adapter. */
    destination?: string | null;
    reasonForLeaving?: string | null;
}
export interface ShelterStay {
    serviceId: number;
    clientId: number;
    providerId: number;
    needId: number;
    start: string;
    end: string | null;
    unitListName: string;
    bedName: string;
    groupId: number | null;
    note: string;
}
export interface ShelterEnrollment {
    enrollmentId: number;
    clientId: number;
    providerId: number;
    entryDate: string;
    exitDate: string | null;
    groupId: number | null;
    type: string;
    destination: string | null;
    reason: string | null;
}
export interface ShelterResult {
    key: string;
    outcome: 'verified' | 'already-present' | 'reconciled';
    mode: ShelterMode;
    stays: ShelterStay[];
    enrollments: ShelterEnrollment[];
}
export interface ShelterUiPort {
    assertBedsAvailable(input: ShelterCheckInInput): Promise<void>;
    verifyStayIdentity(input: {
        stays: ShelterStay[];
        unitListId: number;
        marker: string;
    }): Promise<Array<{
        serviceId: number;
        clientId: number;
        bedId: number;
        unitListId: number;
    }>>;
    listEnrollments(input: {
        clientIds: number[];
    }): Promise<ShelterEnrollment[]>;
    confirmNoServices(input: {
        clientId: number;
    }): Promise<boolean>;
    getUnitList(input: {
        providerId: number;
        unitListId: number;
    }): Promise<{
        unitListId: number;
        name: string;
    }>;
    /** One fresh UI save, after beforeSave resolves. Never replay a failed save. */
    checkIn(input: ShelterCheckInInput & {
        mode: ShelterMode;
        unitListName: string;
        marker: string;
    }, beforeSave: () => Promise<void>): Promise<void>;
    /** One fresh UI save, after beforeSave resolves. Exact selected stay IDs must be verified first. */
    checkout(input: ShelterCheckInInput & ShelterCheckoutInput & {
        mode: ShelterMode;
        unitListName: string;
        stays: ShelterStay[];
    }, beforeSave: () => Promise<void>): Promise<void>;
}
export interface Shelters {
    /** Cancels only a journaled check-in with no shelter save attempt and no uncertain enrollment write. Never deletes server records. Retained enrollments are returned explicitly. */
    cancelUnsubmittedCheckIn(input: {
        key: string;
    }): Promise<{
        key: string;
        outcome: 'cancelled' | 'already-cancelled';
        enrollments: ShelterEnrollment[];
    }>;
    getProgram(input: {
        providerId: number;
    }): Promise<ShelterProgram>;
    checkIn(input: ShelterCheckInInput): Promise<ShelterResult>;
    /** Night-by-night checkout preserves program enrollment. Entry/exit checkout requires an enrollment exit for selected members. */
    checkout(input: ShelterCheckoutInput): Promise<ShelterResult>;
}
export function readShelterProgram(api: Pick<WellSkyClient, 'providers'>, input: {
    providerId: number;
}): Promise<ShelterProgram>;
export function createShelters(options: {
    api: Pick<WellSkyClient, 'tenant' | 'providers' | 'households' | 'services' | 'enrollments'>;
    ui: ShelterUiPort;
    store: UiMutationStore;
    enrollmentHelpers?: Pick<GwtEnrollmentHelpers, 'addHouseholdMembers'>;
}): Shelters;
export function createShelterUi(options: {
    page: Page;
}): ShelterUiPort;
export class ShelterConflictError extends Error {
    readonly code: 'SHELTER_CONFLICT';
    readonly reason: string;
    constructor(reason: string);
}
