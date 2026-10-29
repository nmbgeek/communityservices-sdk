import {apiScope} from './connection.mjs';
import {encodeAnswers, toItems, semanticHash} from '../dist/esm/index.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const fail = reason => { throw new CurrentLivingSituationConflictError(reason); };
export class CurrentLivingSituationConflictError extends Error {
    constructor(reason) { super(`Current Living Situation: ${reason}`); this.name = 'CurrentLivingSituationConflictError'; this.code = 'CURRENT_LIVING_SITUATION_CONFLICT'; this.reason = reason; }
}
function instant(value, stored = false) {
    if (typeof value !== 'string') fail('invalid-date');
    // Enrollment/assessment reads emit UTC without a suffix.
    const text = stored ? value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00') + (/(?:Z|[+-]\d\d(?::\d\d)?)$/.test(value) ? '' : 'Z') : value;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text.slice(0, 19) + 'Z').toISOString().slice(0, 19) !== text.slice(0, 19)) fail('invalid-date');
    return new Date(text).toISOString();
}
function exactFields(value, allowed) {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid-input');
}
function nonempty(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }
function normalize(raw) {
    exactFields(raw, ['key', 'clientId', 'enrollmentId', 'assessmentCode', 'informationDate', 'livingSituation', 'endDate', 'verifiedBy', 'additionalAnswers']);
    if (!nonempty(raw.key) || !positive(raw.clientId) || !positive(raw.enrollmentId) || !nonempty(raw.assessmentCode) || !object(raw.livingSituation) || (raw.endDate !== undefined && raw.endDate !== null && raw.endDate !== '')) fail('invalid-input');
    if (raw.verifiedBy !== undefined && !object(raw.verifiedBy) || raw.additionalAnswers !== undefined && !object(raw.additionalAnswers)) fail('invalid-input');
    return {key: raw.key, clientId: raw.clientId, enrollmentId: raw.enrollmentId, assessmentCode: raw.assessmentCode, informationDate: instant(raw.informationDate), livingSituation: structuredClone(raw.livingSituation), endDate: '', ...(raw.verifiedBy !== undefined ? {verifiedBy: structuredClone(raw.verifiedBy)} : {}), additionalAnswers: structuredClone(raw.additionalAnswers ?? {})};
}
async function readEnrollment(api, input) {
    const rows = [], ids = new Set(); let total;
    for (let page = 1; page <= 100; page++) {
        const response = await api.enrollments.listForClient({path: {clientId: input.clientId}, query: {perPage: 100, startPage: page, total_count: true}});
        if (!Number.isSafeInteger(response?.count) || response.count < 0 || !Array.isArray(response.values) || total !== undefined && total !== response.count) fail('enrollment-count-unavailable');
        total = response.count;
        for (const row of response.values) {
            if (!object(row) || !positive(row.enrollmentId) || row.clientId !== input.clientId || ids.has(row.enrollmentId)) fail('invalid-enrollment-read');
            ids.add(row.enrollmentId); rows.push(row);
        }
        if (rows.length === total) {
            const row = rows.find(row => row.enrollmentId === input.enrollmentId);
            if (!row || row.isActive !== true || !positive(row.enrollmentProvider)) fail('enrollment-unavailable');
            const entryDate = instant(row.projectStartDate, true);
            if (input.informationDate < entryDate || row.projectExitDate && input.informationDate > instant(row.projectExitDate, true)) fail('contact-outside-enrollment');
            return {entryDate, providerId: row.enrollmentProvider};
        }
        if (rows.length > total || !response.values.length) fail('incomplete-enrollment-read');
    }
    fail('enrollment-page-limit');
}
function compile(definition, fields, input, entryDate, tenant) {
    if (definition?.tenant !== tenant || definition.assessmentCode !== input.assessmentCode || !Array.isArray(definition.questions)) fail('invalid-definition');
    const parents = definition.questions.filter(q => q.fieldName === fields.parentField && q.questionType === 'sub_assessment');
    if (parents.length !== 1 || !positive(parents[0].questionId) || !Array.isArray(parents[0].children)) fail('parent-unavailable');
    const parent = parents[0], index = new Map();
    for (const q of parent.children) {
        if (['label', 'blank'].includes(q.questionType)) continue;
        if (!nonempty(q.fieldName) || !positive(q.questionId) || index.has(q.fieldName)) fail('ambiguous-definition');
        index.set(q.fieldName, q);
    }
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
function valueOf(question) {
    if (question.answer_value === null || question.answer_value === undefined || question.answer_value === '') return null;
    if (question.question_type === 'date') return instant(question.answer_value, true);
    if (typeof question.answer_value !== 'string') fail('invalid-answer-read');
    return question.answer_value;
}
async function readRows(api, input, fields) {
    const response = await api.assessments.get({path: {clientId: input.clientId, assessmentCode: input.assessmentCode}});
    const questions = toItems(response);
    if (!Array.isArray(questions) || object(response) && 'count' in response && response.count !== questions.length) fail('incomplete-assessment-read');
    const parents = questions.filter(q => q?.virt_field_name === fields.parentField && q.question_type === 'sub_assessment');
    if (parents.length !== 1 || !Array.isArray(parents[0].sub_assessment_answer_list)) fail('rows-unavailable');
    const rows = parents[0].sub_assessment_answer_list, ids = new Set();
    if (rows.length > 10000) fail('row-limit');
    return rows.map(row => {
        if (!positive(row.recordset_id) || ids.has(row.recordset_id) || !Array.isArray(row.sub_assessment_list)) fail('ambiguous-row-read');
        ids.add(row.recordset_id);
        const fields = {};
        for (const q of row.sub_assessment_list) {
            if (['label', 'blank'].includes(q.question_type)) continue;
            if (!nonempty(q.virt_field_name) || Object.hasOwn(fields, q.virt_field_name) || typeof q.question_type !== 'string') fail('ambiguous-answer-read');
            Object.defineProperty(fields, q.virt_field_name, {value: {type: q.question_type, value: valueOf(q)}, enumerable: true});
        }
        return {id: row.recordset_id, fields};
    });
}
const matches = (row, encoded) => encoded.every(q => row.fields[q.virt_field_name]?.type === q.question_type && row.fields[q.virt_field_name]?.value === valueOf(q));

/** One new recordset per contact key, even when two contacts have identical answers. */
export function createCurrentLivingSituationRecorder({api, store, fields: mapping}) {
 const tenantScope=apiScope(api);
    if (!store?.withLock || !store?.read || !store?.write) fail('api-and-store-required');
    exactFields(mapping, ['parentField', 'startDate', 'endDate', 'informationDate', 'livingSituation', 'verifiedBy']);
    const fields = structuredClone(Object.fromEntries(Object.entries(mapping).filter(([, value]) => value !== undefined)));
    if (['parentField', 'startDate', 'endDate', 'informationDate', 'livingSituation'].some(role => !nonempty(fields[role])) || fields.verifiedBy !== undefined && !nonempty(fields.verifiedBy) || new Set(Object.values(fields)).size !== Object.keys(fields).length) fail('invalid-field-mapping');
    return {async record(raw) {
        const input = normalize(raw), scope = JSON.stringify([tenantScope, 'current-living-situation', input.clientId]);
        return store.withLock(scope, async () => {
            const entries = await store.read(scope);
            if (!Array.isArray(entries) || new Set(entries.map(e => e?.key)).size !== entries.length || entries.some(e => !object(e) || e.version !== 1 || !nonempty(e.key) || !['attempted', 'verified'].includes(e.stage) || typeof e.intentHash !== 'string' || !Array.isArray(e.baseline) || e.stage === 'verified' && !positive(e.recordsetId))) fail('invalid-journal');
            let entry = entries.find(e => e.key === input.key);
            if (entries.some(e => e.stage === 'attempted' && e.key !== input.key)) fail('unfinished-contact');
            const enrollment = await readEnrollment(api, input);
            const definition = await api.assessments.getDefinition({clientId: input.clientId, assessmentCode: input.assessmentCode, effectiveDate: input.informationDate, refresh: true});
            const {parent, encoded} = compile(definition, fields, input, enrollment.entryDate, api.tenant);
            const intentHash = await semanticHash({input, fields, enrollment, encoded});
            if (entry && entry.intentHash !== intentHash) fail('intent-or-schema-changed');
            let rows = await readRows(api, input, fields);
            const result = (row, outcome) => ({key: input.key, clientId: input.clientId, enrollmentId: input.enrollmentId, recordsetId: row.id, startDate: enrollment.entryDate, endDate: null, informationDate: input.informationDate, outcome});
            if (entry?.stage === 'verified') {
                const row = rows.find(row => row.id === entry.recordsetId);
                if (!row || !matches(row, encoded)) fail('verified-contact-changed');
                return result(row, 'already-present');
            }
            const reconcile = async () => {
                for (const before of entry.baseline) {
                    const after = rows.find(row => row.id === before.id);
                    if (!after || await semanticHash(after) !== await semanticHash(before)) fail('existing-contact-changed');
                }
                const added = rows.filter(row => !entry.baseline.some(before => before.id === row.id));
                if (added.length !== 1 || !matches(added[0], encoded)) fail('uncertain-contact-save');
                return added[0];
            };
            if (entry) {
                const row = await reconcile();
                entry.stage = 'verified'; entry.recordsetId = row.id;
                await store.write(scope, structuredClone(entries));
                return result(row, 'reconciled');
            }
            entry = {version: 1, key: input.key, intentHash, stage: 'attempted', baseline: rows};
            entries.push(entry);
            await store.write(scope, structuredClone(entries));
            let failed = false;
            try {
                await api.assessmentsMobile.addAnswer({path: {clientId: input.clientId, assessmentCode: input.assessmentCode}, query: {dateEffective: input.informationDate}, body: [{question_id: parent.questionId, question_type: 'sub_assessment', virt_field_name: fields.parentField, answer_value: '', subAssessmentQuestionAnswers: [{recordset_id: 0, isDeleted: false, subAssessments: encoded}]}]});
            } catch { failed = true; }
            rows = await readRows(api, input, fields);
            const row = await reconcile();
            entry.stage = 'verified'; entry.recordsetId = row.id;
            await store.write(scope, structuredClone(entries));
            return result(row, failed ? 'reconciled' : 'verified');
        });
    }};
}
