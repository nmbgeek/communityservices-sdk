import type {WellSkyClient, PicklistSelector} from '@choiceapps/communityservices-sdk';
import {createCurrentLivingSituationRecorder, type CurrentLivingSituationFields, type UiMutationStore} from '@choiceapps/communityservices-sdk/browser';

/** Both outreach and night-by-night shelter callers supply actual contact events. */
export async function recordMeaningfulContacts(
    api: WellSkyClient,
    store: UiMutationStore,
    fields: CurrentLivingSituationFields,
    target: {clientId: number; enrollmentId: number; assessmentCode: string},
    contacts: readonly {eventKey: string; informationDate: string; livingSituation: PicklistSelector; recordingProgramOption?: PicklistSelector}[],
) {
    const recorder = createCurrentLivingSituationRecorder({api, store, fields});
    const receipts = [];
    for (const contact of contacts) {
        receipts.push(await recorder.record({
            ...target,
            key: contact.eventKey,
            informationDate: contact.informationDate,
            livingSituation: {option: contact.livingSituation},
            endDate: null,
            ...(contact.recordingProgramOption ? {verifiedBy: {option: contact.recordingProgramOption}} : {}),
        }));
    }
    // Each distinct event keeps its own row, even when date and answers match.
    // Replay these same event keys with the same store to verify without another save.
    return receipts;
}
