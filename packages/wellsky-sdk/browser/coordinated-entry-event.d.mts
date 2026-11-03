import type {Answers, EncodingOptions, PicklistSelector, WellSkyClient} from '../dist/esm/index.js';
import type {EnrollmentReader, UiMutationStore} from './index.mjs';
/** Exact virtual fields from the target instrument's client-scoped metadata. No guessed codes. */
export interface CoordinatedEntryEventFields {
    parentField: string;
    startDate: string;
    endDate: string;
    eventDate: string;
    event: string;
    /** yes_no: Problem Solving/Diversion result, client housed or re-housed in a safe alternative. */
    housedSafely: string;
    /** yes_no: post-placement/follow-up case management result, enrolled in aftercare. */
    enrolledInAftercare: string;
    /** provider: location of the crisis or permanent housing referral. */
    location: string;
    /** lookup: referral result. */
    referralResult: string;
    /** date: date of the referral result. */
    resultDate: string;
}
export interface CoordinatedEntryEventInput {
    /** Unique upstream event within this client. Preserve it and the journal on retries. */
    key: string;
    clientId: number;
    enrollmentId: number;
    /** An instrument containing the CE Event subassessment and no mandatory questions. */
    assessmentCode: string;
    /** Date of the event as a timezone-qualified whole-second instant. */
    eventDate: string;
    /** The Event option. Its code selects which follow-up answers are allowed or required. */
    event: {option: PicklistSelector};
    /** Optional; only for a Problem Solving/Diversion event. */
    housedSafely?: boolean;
    /** Optional; only for a post-placement/follow-up case management referral. */
    enrolledInAftercare?: boolean;
    /** Provider ID. Required for, and only allowed on, ES, TH, Joint TH-RRH, RRH, PSH and Other PH referrals. */
    location?: number;
    /** Only on those referrals, together with resultDate. Usually known after the referral. */
    referralResult?: {option: PicklistSelector};
    resultDate?: string;
    /** Other actual platform questions in the row. Cannot override the mapped fields. */
    additionalAnswers?: Answers;
}
export interface CoordinatedEntryEventResult {
    key: string; clientId: number; enrollmentId: number; recordsetId: number;
    startDate: string; endDate: null; eventDate: string;
    outcome: 'verified' | 'already-present' | 'reconciled';
}
export interface CoordinatedEntryResultInput {
    /** The event key used with record(). The event must already be verified. */
    key: string;
    clientId: number;
    assessmentCode: string;
    referralResult: {option: PicklistSelector};
    /** Date of the result; not before the event date. */
    resultDate: string;
}
export interface CoordinatedEntryResultReceipt {
    key: string; clientId: number; recordsetId: number; resultDate: string;
    outcome: 'verified' | 'already-present' | 'reconciled';
}
export interface CoordinatedEntryEventRecorder {
    record(input: CoordinatedEntryEventInput): Promise<CoordinatedEntryEventResult>;
    /** Adds a referral result and date to a recorded ES, TH, Joint TH-RRH, RRH, PSH or Other PH
     * referral. Updates only those cells through the mobile endpoint; journaled and never resent. */
    recordResult(input: CoordinatedEntryResultInput): Promise<CoordinatedEntryResultReceipt>;
}
export class CoordinatedEntryEventConflictError extends Error {
    readonly code: 'COORDINATED_ENTRY_EVENT_CONFLICT';
    readonly reason: string;
    constructor(reason: string);
}
/** REST orchestration through the standard assessment endpoint. No browser launch or credential loading. */
export function createCoordinatedEntryEventRecorder(options: {
    api: WellSkyClient; store: UiMutationStore; fields: CoordinatedEntryEventFields;
    /** Tenant-verified labels for lookup answers, including the Event. */
    writeLabel: NonNullable<EncodingOptions['writeLabel']>;
    /** Read the enrollment through this GWT reader instead of REST, which fails for grouped
     * (household) enrollments. Use the reader `openEnrollmentSession` returns. */
    enrollmentSession?: EnrollmentReader;
}): CoordinatedEntryEventRecorder;
