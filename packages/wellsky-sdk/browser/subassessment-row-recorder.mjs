// Internal: shared journal, snapshot and reconciliation flow for recorders that add one
// subassessment row per upstream event key. Not a public entry point.
import {apiScope} from './connection.mjs';
import {toItems, semanticHash} from '../dist/esm/index.js';

export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const positive = value => Number.isSafeInteger(value) && value > 0;
export function nonempty(value) { return typeof value === 'string' && value.trim().length > 0 && value.length <= 200; }

/** Shape check for a recorder journal, including an optional in-place row update. */
export function checkJournal(entries, fail) {
    const update = u => u === undefined || object(u) && ['attempted', 'verified'].includes(u.stage) && typeof u.intentHash === 'string' && (u.stage === 'attempted') === Array.isArray(u.before);
    if (!Array.isArray(entries) || new Set(entries.map(e => e?.key)).size !== entries.length || entries.some(e => !object(e) || e.version !== 1 || !nonempty(e.key) || !['attempted', 'verified'].includes(e.stage) || typeof e.intentHash !== 'string' || !Array.isArray(e.baseline) || e.stage === 'verified' && !positive(e.recordsetId) || !update(e.update))) fail('invalid-journal');
}

export function rowHelpers(fail) {
    function instant(value, stored = false) {
        if (typeof value !== 'string') fail('invalid-date');
        // Enrollment/assessment reads emit UTC without a suffix or with a numeric hour offset.
        const text = stored ? value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00') + (/(?:Z|[+-]\d\d(?::\d\d)?)$/.test(value) ? '' : 'Z') : value;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(text) || !Number.isFinite(Date.parse(text)) || new Date(text.slice(0, 19) + 'Z').toISOString().slice(0, 19) !== text.slice(0, 19)) fail('invalid-date');
        return new Date(text).toISOString();
    }
    function exactFields(value, allowed) {
        if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid-input');
    }
    function valueOf(question) {
        if (question.answer_value === null || question.answer_value === undefined || question.answer_value === '') return null;
        if (question.question_type === 'date') return instant(question.answer_value, true);
        if (typeof question.answer_value !== 'string') fail('invalid-answer-read');
        return question.answer_value;
    }
    /** Every non-label child of the mapped parent, by field name, or a conflict. */
    function childIndex(definition, assessmentCode, parentField, tenant) {
        if (definition?.tenant !== tenant || definition.assessmentCode !== assessmentCode || !Array.isArray(definition.questions)) fail('invalid-definition');
        const parents = definition.questions.filter(q => q.fieldName === parentField && q.questionType === 'sub_assessment');
        if (parents.length !== 1 || !positive(parents[0].questionId) || !Array.isArray(parents[0].children)) fail('parent-unavailable');
        const parent = parents[0], index = new Map();
        for (const q of parent.children) {
            if (['label', 'blank'].includes(q.questionType)) continue;
            if (!nonempty(q.fieldName) || !positive(q.questionId) || index.has(q.fieldName)) fail('ambiguous-definition');
            index.set(q.fieldName, q);
        }
        return {parent, index};
    }
    return {instant, exactFields, valueOf, childIndex};
}

/**
 * kind: journal scope name; noun: used in event-specific conflict reasons; dateKey: the input's
 * event instant. compile(definition, input, enrollment) returns {expected, empty, intent, body}:
 * answers that must read back, fields that must read back empty, extra intent-hash content and
 * the write request. write(input, body) sends it once.
 */
export function createRowRecorder({api, store, enrollmentSession, fail, kind, noun, dateKey, parentField, normalize, compile, write}) {
    if (enrollmentSession !== undefined && typeof enrollmentSession?.readEnrollment !== 'function') fail('invalid-enrollment-session');
    const tenantScope = apiScope(api, enrollmentSession);
    const {instant, valueOf} = rowHelpers(fail);
    const checkDates = (input, entryDate, exitDate) => {
        if (input[dateKey] < entryDate || exitDate && input[dateKey] > instant(exitDate, true)) fail(`${noun}-outside-enrollment`);
    };
    // REST enrollment reads fail for grouped enrollments (42703), so households need the GWT reader.
    // It reads only active enrollments and throws when the target is missing.
    async function readEnrollment(input) {
        if (enrollmentSession) {
            const target = {clientId: input.clientId, enrollmentId: input.enrollmentId}, snapshot = await enrollmentSession.readEnrollment(target);
            if (snapshot?.source !== 'gwt-rpc' || snapshot.tenant !== api.tenant || snapshot.clientId !== target.clientId || snapshot.enrollmentId !== target.enrollmentId || !positive(snapshot.providerId) || !Array.isArray(snapshot.exits)) fail('enrollment-unavailable');
            const exits = snapshot.exits.filter(e => e?.clientId === target.clientId && e.enrollmentId === target.enrollmentId);
            if (exits.length !== 1 || exits[0].projectExitDate !== null && typeof exits[0].projectExitDate !== 'string') fail('enrollment-unavailable');
            const entryDate = instant(snapshot.projectStartDate, true);
            checkDates(input, entryDate, exits[0].projectExitDate);
            return {entryDate, providerId: snapshot.providerId};
        }
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
                checkDates(input, entryDate, row.projectExitDate);
                return {entryDate, providerId: row.enrollmentProvider};
            }
            if (rows.length > total || !response.values.length) fail('incomplete-enrollment-read');
        }
        fail('enrollment-page-limit');
    }
    async function readRows(input, instant = input[dateKey]) {
        // An undated read omits rows dated after the server's current time, and a read at exactly
        // a row's instant omits its yes/no answers. Read one second after the later of the two.
        const at = new Date(Math.max(Date.now(), Date.parse(instant)) + 1000).toISOString().slice(0, 19) + 'Z';
        const response = await api.assessments.get({path: {clientId: input.clientId, assessmentCode: input.assessmentCode}, query: {dateEffective: at}});
        const questions = toItems(response);
        if (!Array.isArray(questions) || object(response) && 'count' in response && response.count !== questions.length) fail('incomplete-assessment-read');
        const parents = questions.filter(q => q?.virt_field_name === parentField && q.question_type === 'sub_assessment');
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
    const answered = (row, {expected}) => expected.every(q => row.fields[q.virt_field_name]?.type === q.question_type && row.fields[q.virt_field_name]?.value === valueOf(q));
    // `empty` fields must be empty only on the new row; a later end date does not undo the event.
    const matches = (row, compiled) => compiled.empty.every(field => (row.fields[field]?.value ?? null) === null) && answered(row, compiled);

    const scopeOf = clientId => JSON.stringify([tenantScope, kind, clientId]);
    return {readRows, scopeOf, async record(raw) {
        const input = normalize(raw), scope = scopeOf(input.clientId);
        return store.withLock(scope, async () => {
            const entries = await store.read(scope);
            checkJournal(entries, fail);
            let entry = entries.find(e => e.key === input.key);
            // A pending in-place update of an earlier row is unfinished work too.
            if (entries.some(e => (e.stage === 'attempted' || e.update?.stage === 'attempted') && e.key !== input.key)) fail(`unfinished-${noun}`);
            const enrollment = await readEnrollment(input);
            const definition = await api.assessments.getDefinition({clientId: input.clientId, assessmentCode: input.assessmentCode, effectiveDate: input[dateKey], refresh: true});
            const compiled = compile(definition, input, enrollment);
            const intentHash = await semanticHash({input, enrollment, ...compiled.intent});
            if (entry && entry.intentHash !== intentHash) fail('intent-or-schema-changed');
            let rows = await readRows(input);
            const result = (row, outcome) => ({key: input.key, clientId: input.clientId, enrollmentId: input.enrollmentId, recordsetId: row.id, startDate: enrollment.entryDate, endDate: null, [dateKey]: input[dateKey], outcome});
            if (entry?.stage === 'verified') {
                const row = rows.find(row => row.id === entry.recordsetId);
                if (!row || !answered(row, compiled)) fail(`verified-${noun}-changed`);
                return result(row, 'already-present');
            }
            const reconcile = async () => {
                for (const before of entry.baseline) {
                    const after = rows.find(row => row.id === before.id);
                    if (!after || await semanticHash(after) !== await semanticHash(before)) fail(`existing-${noun}-changed`);
                }
                const added = rows.filter(row => !entry.baseline.some(before => before.id === row.id));
                if (added.length !== 1 || !matches(added[0], compiled)) fail(`uncertain-${noun}-save`);
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
            try { await write(input, compiled.body); } catch { failed = true; }
            rows = await readRows(input);
            const row = await reconcile();
            entry.stage = 'verified'; entry.recordsetId = row.id;
            await store.write(scope, structuredClone(entries));
            return result(row, failed ? 'reconciled' : 'verified');
        });
    }};
}
