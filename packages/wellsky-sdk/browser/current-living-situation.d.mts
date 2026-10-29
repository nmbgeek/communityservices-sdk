import type {Answers, AnswerValue, WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
/** Exact virtual fields from the target program's client-scoped metadata. No guessed codes. */
export interface CurrentLivingSituationFields {
    parentField: string;
    startDate: string;
    endDate: string;
    informationDate: string;
    livingSituation: string;
    verifiedBy?: string;
}
export interface CurrentLivingSituationInput {
    /** Unique upstream contact event within this client. Preserve it and the journal on retries. */
    key: string;
    clientId: number;
    enrollmentId: number;
    assessmentCode: string;
    /** Contact date as a timezone-qualified whole-second instant, in the program's calendar. */
    informationDate: string;
    livingSituation: AnswerValue;
    /** Open by default. Recording another contact does not close the previous contact row. */
    endDate?: null | '';
    /** Optional. A recording program may be supplied using the field's verified text or lookup representation. */
    verifiedBy?: AnswerValue;
    /** Only actual additional platform questions. Cannot override the mapped fields. */
    additionalAnswers?: Answers;
}
export interface CurrentLivingSituationResult {
    key: string; clientId: number; enrollmentId: number; recordsetId: number;
    startDate: string; endDate: null; informationDate: string;
    outcome: 'verified' | 'already-present' | 'reconciled';
}
export interface CurrentLivingSituationRecorder {
    record(input: CurrentLivingSituationInput): Promise<CurrentLivingSituationResult>;
}
export class CurrentLivingSituationConflictError extends Error {
    readonly code: 'CURRENT_LIVING_SITUATION_CONFLICT';
    readonly reason: string;
    constructor(reason: string);
}
/** REST orchestration. No browser launch, credential loading, or automatic interim. */
export function createCurrentLivingSituationRecorder(options: {
    api: WellSkyClient; store: UiMutationStore; fields: CurrentLivingSituationFields;
}): CurrentLivingSituationRecorder;
