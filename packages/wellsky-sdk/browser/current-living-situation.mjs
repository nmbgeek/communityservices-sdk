import {encodeAnswers} from '../dist/esm/index.js';
import {createRowRecorder, rowHelpers, object, positive, nonempty} from './subassessment-row-recorder.mjs';

const fail = reason => { throw new CurrentLivingSituationConflictError(reason); };
export class CurrentLivingSituationConflictError extends Error {
    constructor(reason) { super(`Current Living Situation: ${reason}`); this.name = 'CurrentLivingSituationConflictError'; this.code = 'CURRENT_LIVING_SITUATION_CONFLICT'; this.reason = reason; }
}
const {instant, exactFields, childIndex} = rowHelpers(fail);
function normalize(raw) {
    exactFields(raw, ['key', 'clientId', 'enrollmentId', 'assessmentCode', 'informationDate', 'livingSituation', 'endDate', 'verifiedBy', 'additionalAnswers']);
    if (!nonempty(raw.key) || !positive(raw.clientId) || !positive(raw.enrollmentId) || !nonempty(raw.assessmentCode) || !object(raw.livingSituation) || (raw.endDate !== undefined && raw.endDate !== null && raw.endDate !== '')) fail('invalid-input');
    if (raw.verifiedBy !== undefined && !object(raw.verifiedBy) || raw.additionalAnswers !== undefined && !object(raw.additionalAnswers)) fail('invalid-input');
    return {key: raw.key, clientId: raw.clientId, enrollmentId: raw.enrollmentId, assessmentCode: raw.assessmentCode, informationDate: instant(raw.informationDate), livingSituation: structuredClone(raw.livingSituation), endDate: '', ...(raw.verifiedBy !== undefined ? {verifiedBy: structuredClone(raw.verifiedBy)} : {}), additionalAnswers: structuredClone(raw.additionalAnswers ?? {})};
}
function compile(definition, fields, input, entryDate, tenant) {
    const {parent, index} = childIndex(definition, input.assessmentCode, fields.parentField, tenant);
    for (const role of ['startDate', 'endDate', 'informationDate']) if (index.get(fields[role])?.questionType !== 'date') fail('date-field-unavailable');
    if (index.get(fields.livingSituation)?.questionType !== 'lookup') fail('living-situation-picklist-unavailable');
    if (index.get(fields.endDate).mandatory === true) fail('platform-requires-end-date');
    const reserved = Object.values(fields);
    if (Object.keys(input.additionalAnswers).some(field => reserved.includes(field))) fail('reserved-field-override');
    const answers = {...input.additionalAnswers, [fields.startDate]: {value: entryDate}, [fields.endDate]: {value: ''}, [fields.informationDate]: {value: input.informationDate}, [fields.livingSituation]: input.livingSituation};
    if (input.verifiedBy !== undefined) {
        const question = index.get(fields.verifiedBy);
        if (!question || !['textbox', 'textarea', 'lookup'].includes(question.questionType)) fail('verified-by-representation-unsupported');
        if (['textbox', 'textarea'].includes(question.questionType) && (!('value' in input.verifiedBy) || typeof input.verifiedBy.value !== 'string' || !input.verifiedBy.value.trim())) fail('verified-by-text-required');
        answers[fields.verifiedBy] = input.verifiedBy;
    }
    const encoded = encodeAnswers(parent.children, answers, {endpoint: 'mobile'});
    if (!encoded.some(q => q.virt_field_name === fields.livingSituation && q.answer_value)) fail('living-situation-required');
    for (const q of index.values()) {
        if (q.mandatory === true && !encoded.some(answer => answer.virt_field_name === q.fieldName && answer.answer_value !== '')) fail(`platform-required-field:${q.fieldName}`);
    }
    // Do not invent answers for omitted optional questions. Verify every answer sent.
    return {parent, encoded};
}

/** One new recordset per contact key, even when two contacts have identical answers. */
export function createCurrentLivingSituationRecorder({api, store, fields: mapping, enrollmentSession}) {
    if (!store?.withLock || !store?.read || !store?.write) fail('api-and-store-required');
    exactFields(mapping, ['parentField', 'startDate', 'endDate', 'informationDate', 'livingSituation', 'verifiedBy']);
    const fields = structuredClone(Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== undefined)));
    if (['parentField', 'startDate', 'endDate', 'informationDate', 'livingSituation'].some(role => !nonempty(fields[role])) || fields.verifiedBy !== undefined && !nonempty(fields.verifiedBy) || new Set(Object.values(fields)).size !== Object.keys(fields).length) fail('invalid-field-mapping');
    return createRowRecorder({api, store, enrollmentSession, fail, kind: 'current-living-situation', noun: 'contact', dateKey: 'informationDate', parentField: fields.parentField, normalize,
        compile(definition, input, enrollment) {
            const {parent, encoded} = compile(definition, fields, input, enrollment.entryDate, api.tenant);
            return {expected: encoded, empty: [], intent: {fields, encoded},
                body: [{question_id: parent.questionId, question_type: 'sub_assessment', virt_field_name: fields.parentField, answer_value: '', subAssessmentQuestionAnswers: [{recordset_id: 0, isDeleted: false, subAssessments: encoded}]}]};
        },
        write: (input, body) => api.assessmentsMobile.addAnswer({path: {clientId: input.clientId, assessmentCode: input.assessmentCode}, query: {dateEffective: input.informationDate}, body}),
    });
}
