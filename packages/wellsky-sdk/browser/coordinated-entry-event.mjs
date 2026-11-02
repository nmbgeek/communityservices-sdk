import {encodeAnswers, resolvePicklistOption, semanticHash} from '../dist/esm/index.js';
import {createRowRecorder, rowHelpers, checkJournal, object, positive, nonempty} from './subassessment-row-recorder.mjs';

const fail = reason => { throw new CoordinatedEntryEventConflictError(reason); };
export class CoordinatedEntryEventConflictError extends Error {
    constructor(reason) { super(`Coordinated Entry Event: ${reason}`); this.name = 'CoordinatedEntryEventConflictError'; this.code = 'COORDINATED_ENTRY_EVENT_CONFLICT'; this.reason = reason; }
}
const {instant, exactFields, valueOf, childIndex} = rowHelpers(fail);
const roles = ['parentField', 'startDate', 'endDate', 'eventDate', 'event', 'housedSafely', 'enrolledInAftercare', 'location', 'referralResult', 'resultDate'];
const roleTypes = {startDate: 'date', endDate: 'date', eventDate: 'date', event: 'lookup', housedSafely: 'yes_no', enrolledInAftercare: 'yes_no', location: 'provider', referralResult: 'lookup', resultDate: 'date'};
// Follow-up answers each Event option allows, matching the form's dependency labels.
// Placement referrals require a location; results usually arrive later and stay optional.
const placement = {location: 'required', result: 'optional'};
const EVENT_RULES = Object.freeze({
    PREVASSIST: {}, PROBSOLV: {housedSafely: 'optional'}, CRISISNEEDS: {}, HOUSINGNEEDS: {},
    POSTPLACEFOLLOWUP: {enrolledInAftercare: 'optional'}, STREETOUTREACH: {}, HOUSINGNAVIGATION: {}, NONCONT_INELIG: {}, NONCONT_NOAVAIL: {},
    EMERGSHELTER: placement, TRANSITHOUSING: placement, JOINTTHRRH: placement, RRH: placement, PSH: placement, OTHERPH: placement,
});
const EVENT_PREFIX = 'COORDINATEDENTRYEVENT_EVENT_';

function normalize(raw) {
    exactFields(raw, ['key', 'clientId', 'enrollmentId', 'assessmentCode', 'eventDate', 'event', 'housedSafely', 'enrolledInAftercare', 'location', 'referralResult', 'resultDate', 'additionalAnswers']);
    if (!nonempty(raw.key) || !positive(raw.clientId) || !positive(raw.enrollmentId) || !nonempty(raw.assessmentCode) || !object(raw.event) || raw.additionalAnswers !== undefined && !object(raw.additionalAnswers)) fail('invalid-input');
    for (const flag of ['housedSafely', 'enrolledInAftercare']) if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') fail('invalid-input');
    if (raw.location !== undefined && !positive(raw.location)) fail('location-provider-id-required');
    if (raw.referralResult !== undefined && !(object(raw.referralResult) && object(raw.referralResult.option))) fail('referral-result-option-required');
    if (raw.additionalAnswers !== undefined && Object.values(raw.additionalAnswers).some(answer => !object(answer))) fail('invalid-input');
    return {key: raw.key, clientId: raw.clientId, enrollmentId: raw.enrollmentId, assessmentCode: raw.assessmentCode, eventDate: instant(raw.eventDate), event: structuredClone(raw.event),
        ...Object.fromEntries(['housedSafely', 'enrolledInAftercare', 'location'].filter(k => raw[k] !== undefined).map(k => [k, raw[k]])),
        ...(raw.referralResult !== undefined ? {referralResult: structuredClone(raw.referralResult)} : {}),
        ...(raw.resultDate !== undefined ? {resultDate: instant(raw.resultDate)} : {}),
        additionalAnswers: structuredClone(raw.additionalAnswers ?? {})};
}
function ruleFor(option) {
    const rule = option?.code?.startsWith(EVENT_PREFIX) ? EVENT_RULES[option.code.slice(EVENT_PREFIX.length)] : undefined;
    if (!rule) fail('unsupported-event');
    return rule;
}
function eventRule(question, selector) {
    if (!('option' in selector)) fail('event-option-required');
    let option;
    try { option = resolvePicklistOption(question, selector.option); } catch { fail('unsupported-event'); }
    return ruleFor(option);
}
function mappedChildren(definition, fields, assessmentCode, tenant) {
    const {parent, index} = childIndex(definition, assessmentCode, fields.parentField, tenant);
    for (const [role, type] of Object.entries(roleTypes)) if (index.get(fields[role])?.questionType !== type) fail(`${role}-field-unavailable`);
    return {parent, index};
}
function normalizeResult(raw) {
    exactFields(raw, ['key', 'clientId', 'assessmentCode', 'referralResult', 'resultDate']);
    if (!nonempty(raw.key) || !positive(raw.clientId) || !nonempty(raw.assessmentCode)) fail('invalid-input');
    if (!(object(raw.referralResult) && object(raw.referralResult.option))) fail('referral-result-option-required');
    return {key: raw.key, clientId: raw.clientId, assessmentCode: raw.assessmentCode, referralResult: structuredClone(raw.referralResult), resultDate: instant(raw.resultDate)};
}
function compile(definition, fields, input, entryDate, tenant, writeLabel) {
    // The standard endpoint rejects any request that omits a mandatory answer. Resending
    // other answers would create new dated rows for them, so such instruments are refused.
    if (definition?.questions?.some?.(q => q.mandatory === true && !['label', 'blank'].includes(q.questionType))) fail('instrument-has-mandatory-questions');
    const {parent, index} = mappedChildren(definition, fields, input.assessmentCode, tenant);
    if (index.get(fields.endDate).mandatory === true) fail('platform-requires-end-date');
    if (Object.keys(input.additionalAnswers).some(field => Object.values(fields).includes(field))) fail('reserved-field-override');
    const rule = eventRule(index.get(fields.event), input.event);
    for (const flag of ['housedSafely', 'enrolledInAftercare']) if (input[flag] !== undefined && !rule[flag]) fail(`${flag}-not-applicable`);
    if (rule.location === 'required' && input.location === undefined) fail('location-required');
    if (!rule.location && input.location !== undefined) fail('location-not-applicable');
    const hasResult = input.referralResult !== undefined, hasResultDate = input.resultDate !== undefined;
    if ((hasResult || hasResultDate) && !rule.result) fail('referral-result-not-applicable');
    if (hasResult !== hasResultDate) fail('referral-result-and-date-required-together');
    if (hasResultDate && input.resultDate < input.eventDate) fail('result-before-event');
    const answers = {...input.additionalAnswers, [fields.startDate]: {value: entryDate}, [fields.eventDate]: {value: input.eventDate}, [fields.event]: input.event,
        ...(input.housedSafely !== undefined ? {[fields.housedSafely]: {value: input.housedSafely}} : {}),
        ...(input.enrolledInAftercare !== undefined ? {[fields.enrolledInAftercare]: {value: input.enrolledInAftercare}} : {}),
        ...(input.location !== undefined ? {[fields.location]: {value: input.location}} : {}),
        ...(hasResult ? {[fields.referralResult]: input.referralResult, [fields.resultDate]: {value: input.resultDate}} : {})};
    for (const [field, answer] of Object.entries(input.additionalAnswers)) if (index.get(field)?.questionType === 'date' && object(answer) && 'value' in answer) answers[field] = {value: instant(answer.value)};
    // Labels are sent; the same selectors encoded as option IDs are what reads return.
    const sent = encodeAnswers(parent.children, answers, {endpoint: 'standalone', writeLabel});
    const stored = encodeAnswers(parent.children, answers, {endpoint: 'standalone', writeLabel: (_q, option) => String(option.id)});
    for (const q of index.values()) {
        if (q.mandatory === true && !sent.some(answer => answer.virt_field_name === q.fieldName && answer.answer_value !== '')) fail(`platform-required-field:${q.fieldName}`);
    }
    return {parent, sent, stored};
}

/** One new CE Event recordset per event key, written through the standard assessment endpoint,
 * which keeps provider and yes/no answers that mobile writes drop. Follow-up answers are
 * checked against the selected Event. */
export function createCoordinatedEntryEventRecorder({api, store, fields: mapping, writeLabel}) {
    if (!store?.withLock || !store?.read || !store?.write || typeof api?.assessments?.create !== 'function') fail('api-and-store-required');
    if (typeof writeLabel !== 'function') fail('write-label-required');
    exactFields(mapping, roles);
    const fields = structuredClone(mapping);
    if (roles.some(role => !nonempty(fields[role])) || new Set(Object.values(fields)).size !== roles.length) fail('invalid-field-mapping');
    const recorder = createRowRecorder({api, store, fail, kind: 'coordinated-entry-event', noun: 'event', dateKey: 'eventDate', parentField: fields.parentField, normalize,
        compile(definition, input, enrollment) {
            const {parent, sent, stored} = compile(definition, fields, input, enrollment.entryDate, api.tenant, writeLabel);
            // Hash option IDs, not labels, so a relabelled option does not invalidate verified keys.
            return {expected: stored, empty: [fields.endDate], intent: {fields, stored},
                body: [{question_id: parent.questionId, question_type: 'sub_assessment', virt_field_name: fields.parentField, answer_value: '', subAssessmentQuestionAnswers: [{subAssessments: sent}]}]};
        },
        write: (input, body) => api.assessments.create({path: {clientId: input.clientId, assessmentCode: input.assessmentCode}, query: {dateEffective: input.eventDate}, body}),
    });
    /** Adds a referral result to an event this recorder verified. The standard endpoint only
     * creates rows, so this sends just the result cells to the event's recordset through the
     * mobile endpoint, which updates those cells and keeps the others, including the location. */
    async function recordResult(raw) {
        if (typeof api.assessmentsMobile?.addAnswer !== 'function') fail('api-and-store-required');
        const input = normalizeResult(raw), scope = recorder.scopeOf(input.clientId);
        return store.withLock(scope, async () => {
            const entries = await store.read(scope);
            checkJournal(entries, fail);
            const entry = entries.find(e => e.key === input.key);
            if (entry?.stage !== 'verified' || !positive(entry.recordsetId)) fail('event-not-verified');
            if (entries.some(e => (e.stage === 'attempted' || e.update?.stage === 'attempted') && e.key !== input.key)) fail('unfinished-event');
            const definition = await api.assessments.getDefinition({clientId: input.clientId, assessmentCode: input.assessmentCode, effectiveDate: input.resultDate, refresh: true});
            const {parent, index} = mappedChildren(definition, fields, input.assessmentCode, api.tenant);
            const cells = encodeAnswers(parent.children, {[fields.referralResult]: input.referralResult, [fields.resultDate]: {value: input.resultDate}}, {endpoint: 'mobile'});
            const intentHash = await semanticHash({input, fields, cells});
            if (entry.update && entry.update.intentHash !== intentHash) fail('result-intent-changed');
            const read = () => recorder.readRows({clientId: input.clientId, assessmentCode: input.assessmentCode}, input.resultDate);
            const result = outcome => ({key: input.key, clientId: input.clientId, recordsetId: entry.recordsetId, resultDate: input.resultDate, outcome});
            const resultFields = [fields.referralResult, fields.resultDate];
            const saved = row => cells.every(q => row.fields[q.virt_field_name]?.type === q.question_type && row.fields[q.virt_field_name]?.value === valueOf(q));
            let rows = await read(), row = rows.find(row => row.id === entry.recordsetId);
            if (!row) fail('verified-event-changed');
            const eventOptions = index.get(fields.event).options, storedEvent = row.fields[fields.event]?.value, storedDate = row.fields[fields.eventDate]?.value;
            if (!Array.isArray(eventOptions)) fail('event-picklist-unavailable');
            const eventOption = eventOptions.find(o => String(o.id) === storedEvent);
            if (!eventOption || typeof storedDate !== 'string') fail('verified-event-changed');
            if (!ruleFor(eventOption).result) fail('referral-result-not-applicable');
            // A result may follow the client's exit; only the event itself must fall within the enrollment.
            if (input.resultDate < storedDate) fail('result-before-event');
            // Only the result cells may change: earlier answers, other rows and the row count stay.
            const reconcile = async () => {
                const before = entry.update.before, target = before.find(r => r.id === entry.recordsetId);
                if (rows.length !== before.length) fail('existing-event-changed');
                for (const prior of before) {
                    const after = rows.find(r => r.id === prior.id);
                    if (!after) fail('existing-event-changed');
                    if (prior.id !== entry.recordsetId && await semanticHash(after) !== await semanticHash(prior)) fail('existing-event-changed');
                }
                const after = rows.find(r => r.id === entry.recordsetId);
                for (const [field, answer] of Object.entries(target.fields)) if (!resultFields.includes(field) && await semanticHash(after.fields[field]) !== await semanticHash(answer)) fail('verified-event-changed');
                if (!saved(after)) fail('uncertain-result-save');
            };
            // Drift in the event's other answers is reported by record() under the same key.
            if (entry.update?.stage === 'verified') { if (!saved(row)) fail('verified-result-changed'); return result('already-present'); }
            if (entry.update?.stage === 'attempted') {
                await reconcile();
                entry.update = {stage: 'verified', intentHash};
                await store.write(scope, structuredClone(entries));
                return result('reconciled');
            }
            if (resultFields.some(field => (row.fields[field]?.value ?? null) !== null)) {
                if (!saved(row)) fail('result-conflict');
                entry.update = {stage: 'verified', intentHash};
                await store.write(scope, structuredClone(entries));
                return result('already-present');
            }
            entry.update = {stage: 'attempted', intentHash, before: rows};
            await store.write(scope, structuredClone(entries));
            let failed = false;
            try {
                await api.assessmentsMobile.addAnswer({path: {clientId: input.clientId, assessmentCode: input.assessmentCode}, query: {dateEffective: input.resultDate}, body: [{question_id: parent.questionId, question_type: 'sub_assessment', virt_field_name: fields.parentField, answer_value: '', subAssessmentQuestionAnswers: [{recordset_id: entry.recordsetId, isDeleted: false, subAssessments: cells}]}]});
            } catch { failed = true; }
            rows = await read();
            await reconcile();
            entry.update = {stage: 'verified', intentHash};
            await store.write(scope, structuredClone(entries));
            return result(failed ? 'reconciled' : 'verified');
        });
    }
    return {record: recorder.record, recordResult};
}
