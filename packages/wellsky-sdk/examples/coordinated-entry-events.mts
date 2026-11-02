import type {WellSkyClient, PicklistSelector} from '@choiceapps/communityservices-sdk';
import {createCoordinatedEntryEventRecorder, type CoordinatedEntryEventFields, type UiMutationStore} from '@choiceapps/communityservices-sdk/browser';

/** Source events from the application. The recorder checks each event's follow-up answers. */
export async function recordCoordinatedEntryEvents(
    api: WellSkyClient,
    store: UiMutationStore,
    fields: CoordinatedEntryEventFields,
    /** Tenant-verified write labels keyed by field and option code. */
    verifiedLabels: ReadonlyMap<string, string>,
    target: {clientId: number; enrollmentId: number; assessmentCode: string},
    events: readonly {
        eventKey: string; eventDate: string; event: PicklistSelector;
        housedSafely?: boolean; enrolledInAftercare?: boolean;
        locationProviderId?: number; result?: {option: PicklistSelector; date: string};
    }[],
) {
    const recorder = createCoordinatedEntryEventRecorder({
        api, store, fields,
        writeLabel: (question, option) => verifiedLabels.get(`${question.fieldName}:${option.code}`),
    });
    const receipts = [];
    for (const event of events) {
        receipts.push(await recorder.record({
            ...target,
            key: event.eventKey,
            eventDate: event.eventDate,
            event: {option: event.event},
            ...(event.housedSafely !== undefined ? {housedSafely: event.housedSafely} : {}),
            ...(event.enrolledInAftercare !== undefined ? {enrolledInAftercare: event.enrolledInAftercare} : {}),
            ...(event.locationProviderId !== undefined ? {location: event.locationProviderId} : {}),
            ...(event.result ? {referralResult: {option: event.result.option}, resultDate: event.result.date} : {}),
        }));
    }
    // Replay the same event keys with the same store to verify without another save.
    return receipts;
}
