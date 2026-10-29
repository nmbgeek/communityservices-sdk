import {apiScope} from './connection.mjs';
import { createHash } from 'node:crypto';
import { toItems } from '../dist/esm/index.js';
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const id = v => {
    if (!Number.isSafeInteger(v) || v < 1)
        throw Error('Positive shelter ID required');
    return v;
};
const text = (v, n) => {
    if (typeof v !== 'string' || !v.trim() || v.length > 200 || /[\0\r\n]/.test(v))
        throw Error(`Invalid ${n}`);
    return v;
};
const instant = v => {
    if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?(?:Z|[+-]\d\d:\d\d)$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v.slice(0, 19) + 'Z').toISOString().slice(0, 19) !== v.slice(0, 19))
        throw Error('Shelter time must be a valid timezone-qualified whole-second instant');
    return new Date(v).toISOString();
};
const rest = v => v == null ? null : instant(/[Zz]|[+-]\d\d:\d\d$/.test(v) ? v : v + 'Z');
const label = v => v?.replace(/\s*\(HUD\)\s*$/, '').trim();
export class ShelterConflictError extends Error {
    constructor(reason) { super(`Shelter conflict: ${reason}`); this.name = 'ShelterConflictError'; this.code = 'SHELTER_CONFLICT'; this.reason = reason; }
}
const fail = r => { throw new ShelterConflictError(r); };
/** Reads the actual provider setting; never infers ES mode from its name or AIRS code. */
export async function readShelterProgram(api, { providerId }) {
    id(providerId);
    const items = toItems(await api.providers.getComplete({ path: { providerId } }));
    if (items.length !== 1 || items[0].providerId !== providerId)
        fail('provider-unreadable');
    const p = items[0], th = /^Transitional housing/i.test(p.projectType ?? ''), es = /^Emergency Shelter/i.test(p.projectType ?? '');
    const mode = p.emergencyShelterTrackingMethod === 'Night-by-Night' ? 'night-by-night' : p.emergencyShelterTrackingMethod === 'Entry/Exit Date' ? 'entry-exit' : null;
    if (!mode || !th && !es || th && mode !== 'entry-exit')
        fail('unsupported-tracking-mode');
    return { providerId, name: p.providerName, projectType: p.projectType, trackingMethod: p.emergencyShelterTrackingMethod, mode };
}
const normalizeIn = input => {
    if (!input || Object.keys(input).some(k => !['key', 'providerId', 'unitListId', 'householdId', 'headClientId', 'entryDate', 'members', 'enrollmentStrategy'].includes(k)))
        throw Error('Unsupported shelter check-in input');
    const n = { key: text(input.key, 'source key'), providerId: id(input.providerId), unitListId: id(input.unitListId), householdId: id(input.householdId), headClientId: id(input.headClientId), entryDate: instant(input.entryDate), enrollmentStrategy: input.enrollmentStrategy ?? 'require-existing', members: input.members?.map(m => ({ clientId: id(m.clientId), bedName: text(m.bedName, 'bed name') })).sort((a, b) => a.clientId - b.clientId) };
    if (!['require-existing', 'create-if-missing'].includes(n.enrollmentStrategy) || !Array.isArray(n.members) || !n.members.length || n.members.length > 20 || !n.members.some(m => m.clientId === n.headClientId) || new Set(n.members.map(m => m.clientId)).size !== n.members.length || new Set(n.members.map(m => m.bedName)).size !== n.members.length || n.members.some(m => /^Overflow/i.test(m.bedName)))
        throw Error('Explicit unique household members and named beds required; overflow is not supported');
    return n;
};
const calendar = (date, timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
const normalizeOut = input => {
    if (!input || Object.keys(input).some(k => !['key', 'checkInKey', 'clientIds', 'checkoutDate', 'lastNight', 'timeZone', 'destination', 'reasonForLeaving'].includes(k)))
        throw Error('Unsupported shelter checkout input');
    const n = { key: text(input.key, 'source key'), checkInKey: text(input.checkInKey, 'check-in key'), clientIds: input.clientIds?.map(id).sort((a, b) => a - b), checkoutDate: instant(input.checkoutDate), lastNight: input.lastNight, timeZone: text(input.timeZone, 'program timezone'), destination: input.destination ?? null, reasonForLeaving: input.reasonForLeaving ?? null };
    if (!Array.isArray(n.clientIds) || !n.clientIds.length || new Set(n.clientIds).size !== n.clientIds.length || typeof n.lastNight !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(n.lastNight) || !Number.isFinite(Date.parse(n.lastNight + 'T12:00:00Z')) || new Date(n.lastNight + 'T12:00:00Z').toISOString().slice(0, 10) !== n.lastNight)
        throw Error('Exact checkout members and last shelter night required');
    const next = new Date(n.lastNight + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    if (calendar(n.checkoutDate, n.timeZone) !== next.toISOString().slice(0, 10))
        fail('exit-must-follow-last-night');
    for (const k of ['destination', 'reasonForLeaving'])
        if (n[k] !== null)
            text(n[k], k);
    return n;
};
/** Durable workflow. Enrollment metadata only; assessment completion remains a separate explicit operation. */
export function createShelters({ api, ui, store, enrollmentHelpers }) {
 const tenantScope=apiScope(api, ui, enrollmentHelpers);
    if (!ui?.listEnrollments || !ui?.verifyStayIdentity || !ui?.assertBedsAvailable || !ui?.getUnitList || !ui?.checkIn || !store?.withLock || !store?.read || !store?.write)
        throw Error('Shelter dependencies required');
    const scope = JSON.stringify([tenantScope, 'shelters']);
    const identity = async (record, found) => {
        const rows = await ui.verifyStayIdentity({ stays: found, unitListId: record.input.unitListId, marker: `[sdk-shelter:${hash(record.key)}]` });
        if (!Array.isArray(rows) || rows.length !== found.length || new Set(rows.map(r => r.serviceId)).size !== rows.length)
            fail('stay-identity-incomplete');
        const normalized = rows.map(r => {
            id(r.bedId);
            if (r.unitListId !== record.input.unitListId || !found.some(s => s.serviceId === r.serviceId && s.clientId === r.clientId))
                fail('stay-identity-changed');
            return { serviceId: r.serviceId, clientId: r.clientId, bedId: r.bedId, unitListId: r.unitListId };
        }).sort((a, b) => a.serviceId - b.serviceId);
        if (record.identities && JSON.stringify(normalized) !== JSON.stringify(record.identities))
            fail('stay-identity-changed');
        record.identities = normalized;
    };
    const readHousehold = async (n) => {
        const rows = toItems(await api.households.get({ path: { householdId: n.householdId } }));
        if (rows.length !== 1 || rows[0].householdId !== n.householdId || rows[0].isActive === false || !Array.isArray(rows[0].clients))
            fail('household-unreadable');
        const people = rows[0].clients;
        if(people.some(p=>!Number.isSafeInteger(p.clientId)||p.clientId<1||typeof p.headofhouseholdStatus!=='boolean'))fail('household-unreadable');
        if (new Set(people.map(p => p.clientId)).size !== people.length)
            fail('ambiguous-membership');
        const heads = people.filter(p => p.isActive !== false && !p.dateLeft && p.headofhouseholdStatus);
        if (heads.length !== 1 || heads[0].clientId !== n.headClientId)
            fail('head-of-household-missing-or-changed');
        for (const m of n.members) {
            const p = people.find(p => p.clientId === m.clientId);
            if (!p || p.isActive === false || p.dateLeft || !p.dateJoined || rest(p.dateJoined) > n.entryDate)
                fail('membership-does-not-cover-stay');
        }
        return people;
    };
    const entries = async (ids) => {
        const rows = await ui.listEnrollments({ clientIds: ids });
        if (!Array.isArray(rows) || new Set(rows.map(r => r.enrollmentId)).size !== rows.length)
            fail('enrollment-read-incomplete');
        for (const r of rows) {
            id(r.enrollmentId);
            id(r.providerId);
            if(r.groupId!==null)id(r.groupId);
            if (!ids.includes(r.clientId) || !r.entryDate || rest(r.entryDate) !== r.entryDate || r.exitDate !== null && rest(r.exitDate) !== r.exitDate)
                fail('enrollment-read-invalid');
        }
        return rows;
    };
    const stays = async (n) => {
        const result = [];
        for (const { clientId } of n.members) {
            let count;
            const seen = new Set();
            for (let startPage = 1; startPage <= 1000; startPage++) {
                let r;
                try {
                    r = await api.services.listForClient({ path: { clientId }, query: { perPage: 100, startPage, total_count: true } });
                }
                catch (error) {
                    if (startPage === 1 && error?.status === 404 && await ui.confirmNoServices?.({ clientId }))
                        r = { count: 0, values: [] };
                    else
                        throw error;
                }
                if (!Number.isSafeInteger(r?.count) || r.count < 0 || !Array.isArray(r.values) || count !== undefined && r.count !== count)
                    fail('stay-read-incomplete');
                count = r.count;
                for (const row of r.values) {
                    id(row.serviceId);
                    if (row.clientId !== clientId || seen.has(row.serviceId) || typeof row.isActive !== 'boolean' || typeof row.shelter_item !== 'boolean')
                        fail('stay-read-invalid');
                    if (row.shelter_item)
                        id(row.provider_id);
                    seen.add(row.serviceId);
                    if (row.isActive && row.shelter_item && row.provider_id === n.providerId) {
                        const detail = toItems(await api.services.getComplete({ path: { serviceId: row.serviceId } }));
                        if (detail.length !== 1 || detail[0].serviceId !== row.serviceId || detail[0].clientId !== clientId || detail[0].provider_id !== n.providerId || detail[0].shelter_item !== true || detail[0].isActive !== true)
                            fail('stay-detail-invalid');
                        const d = detail[0];
                        result.push({ serviceId: id(d.serviceId), clientId, providerId: n.providerId, needId: id(d.needId), start: rest(d.serviceStartDate), end: rest(d.serviceEndDate), unitListName: d.unitList, bedName: d.unitNameNumber, groupId: d.groupId, note: d.serviceNote ?? '' });
                    }
                }
                if (seen.size === count)
                    break;
                // Tenants can cap the page size below the requested 100 rows.
                if (!r.values.length || seen.size > count || startPage === 1000)
                    fail('stay-read-incomplete');
            }
        }
        return result;
    };
    const covering = (rows, n) => n.members.map(m => {
        const matches = rows.filter(e => e.clientId === m.clientId && e.providerId === n.providerId && e.entryDate <= n.entryDate && (e.exitDate === null || e.exitDate > n.entryDate));
        if (matches.length !== 1)
            fail(matches.length ? 'ambiguous-enrollment' : 'missing-same-program-enrollment');
        return matches[0];
    });
    const groupGuard = (es, n) => {
        const h = es.find(e => e.clientId === n.headClientId);
        if (!h || es.some(e => e.clientId !== n.headClientId && (h.groupId === null || e.groupId !== h.groupId || e.entryDate < h.entryDate || h.exitDate !== null && (e.exitDate === null || e.exitDate > h.exitDate))))
            fail('head-does-not-cover-enrollment-group');
    };
    const validateRecords = records => {
        if (!Array.isArray(records) || records.some(r => r.version !== 1 || !['check-in', 'checkout'].includes(r.kind) || !['pending', 'verified', 'cancelled'].includes(r.stage) || typeof r.hash !== 'string' || typeof r.key !== 'string') || new Set(records.map(r => r.key)).size !== records.length)
            fail('invalid-shelter-journal');
    };
    return {
        getProgram: input => readShelterProgram(api, input),
        async cancelUnsubmittedCheckIn({ key }) {
            text(key, 'source key');
            return store.withLock(scope, async () => {
                const records = await store.read(scope);
                validateRecords(records);
                const record = records.find(r => r.key === key);
                if (!record || record.kind !== 'check-in' || record.stage === 'verified' || record.steps.stay || record.steps.entry === 'attempted')
                    fail('check-in-cannot-be-cancelled');
                if (record.stage === 'cancelled')
                    return { key, outcome: 'already-cancelled', enrollments: record.cancelledEnrollments };
                const people = await readHousehold(record.input), all = await stays(record.input);
                if (all.some(s => !record.baseline.includes(s.serviceId)))
                    fail('check-in-cannot-be-cancelled');
                const es = await entries(people.map(p => p.clientId));
                const retained = record.steps.entry === 'verified' ? covering(es, record.input) : [];
                if (retained.length) {
                    groupGuard(retained, record.input);
                    if (!retained.some(e => e.enrollmentId === record.headEnrollmentId && e.clientId === record.input.headClientId))
                        fail('enrollment-changed');
                }
                record.cancelledEnrollments = retained;
                record.stage = 'cancelled';
                await store.write(scope, records);
                return { key, outcome: 'cancelled', enrollments: retained };
            });
        },
        async checkIn(raw) {
            const n = normalizeIn(raw);
            if (n.enrollmentStrategy === 'create-if-missing' && n.members.length > 1 && !enrollmentHelpers?.addHouseholdMembers)
                throw Error('Household enrollment helper required before creation');
            return store.withLock(scope, async () => {
                const records = await store.read(scope);
                validateRecords(records);
                let record = records.find(r => r.key === n.key);
                if (record?.stage === 'cancelled')
                    fail('check-in-cancelled');
                if (record && (record.hash !== hash(n) || record.kind !== 'check-in'))
                    fail('intent-changed');
                if (records.some(r => r.stage === 'pending' && r.key !== n.key))
                    fail('unfinished-shelter-operation');
                const people = await readHousehold(n), ids = people.map(p => p.clientId), program = await readShelterProgram(api, n);
                if (record && record.mode !== program.mode)
                    fail('tracking-mode-changed');
                const list = await ui.getUnitList(n);
                if (record && record.unitListName !== list.name)
                    fail('unit-list-changed');
                if (!record) {
                    record = { version: 1, kind: 'check-in', key: n.key, hash: hash(n), input: n, mode: program.mode, unitListName: list.name, stage: 'pending', steps: {}, baseline: (await stays(n)).map(s => s.serviceId) };
                    records.push(record);
                }
                const persist = () => store.write(scope, records);
                let es = await entries(ids);
                if (program.mode === 'night-by-night' && n.enrollmentStrategy === 'create-if-missing') {
                    const initial = es.filter(e => e.providerId === n.providerId && n.members.some(m => m.clientId === e.clientId) && (e.exitDate === null || e.exitDate > n.entryDate));
                    if (!initial.length && !record.steps.entry) {
                        await ui.assertBedsAvailable(n);
                        record.steps.entry = 'attempted';
                        await persist();
                        try {
                            await api.enrollments.createEntryAssessment({ body: { clientId: n.headClientId, providerId: n.providerId, type: 'HUD', projectStartDate: n.entryDate } });
                        }
                        catch { }
                        es = await entries(ids);
                    }
                    if (record.steps.entry) {
                        const head = es.filter(e => e.clientId === n.headClientId && e.providerId === n.providerId && e.entryDate === n.entryDate && e.exitDate === null);
                        if (head.length !== 1 || record.headEnrollmentId && record.headEnrollmentId !== head[0].enrollmentId)
                            fail('uncertain-enrollment-create');
                        record.headEnrollmentId = head[0].enrollmentId;
                        record.steps.entry = 'verified';
                        await persist();
                        const missing = n.members.filter(m => !es.some(e => e.clientId === m.clientId && e.providerId === n.providerId && e.groupId === head[0].groupId && e.entryDate === n.entryDate));
                        if (missing.length) {
                            if (!enrollmentHelpers?.addHouseholdMembers)
                                fail('household-enrollment-helper-required');
                            await enrollmentHelpers.addHouseholdMembers({ clientId: n.headClientId, enrollmentId: head[0].enrollmentId, memberClientIds: n.members.filter(m => m.clientId !== n.headClientId).map(m => m.clientId) });
                            es = await entries(ids);
                        }
                    }
                }
                let all = await stays(n), found = all.filter(s => !record.baseline.includes(s.serviceId) && s.start === n.entryDate && s.unitListName === list.name);
                const verify = () => {
                    if (found.length !== n.members.length || new Set(found.map(s => s.clientId)).size !== found.length)
                        fail('uncertain-or-partial-check-in');
                    for (const m of n.members) {
                        const s = found.find(s => s.clientId === m.clientId), pinned = record.stays?.find(s => s.clientId === m.clientId);
                        if (!s || s.bedName !== m.bedName || pinned && (pinned.serviceId !== s.serviceId || pinned.needId !== s.needId || pinned.groupId !== s.groupId || pinned.note !== s.note))
                            fail('stay-changed');
                        const exits = records.filter(r => r.kind === 'checkout' && r.input?.checkInKey === n.key && r.input.clientIds.includes(m.clientId) && (r.stage === 'verified' || r.attempted));
                        if (exits.length > 1 || s.end !== (exits[0]?.input.checkoutDate ?? null))
                            fail('stay-end-changed');
                    }
                    const stayGroup = found[0].groupId;
                    if (new Set(found.map(s => s.groupId)).size !== 1 || (stayGroup === null ? found.length > 1 : !Number.isSafeInteger(stayGroup) || stayGroup < 1))
                        fail('stay-household-group-mismatch');
                    const covered = covering(es, n);
                    groupGuard(covered, n);
                    if (record.enrollments && covered.some(e => !record.enrollments.some(p => p.enrollmentId === e.enrollmentId && p.clientId === e.clientId && p.entryDate === e.entryDate && p.groupId === e.groupId)))
                        fail('enrollment-changed');
                    if (record.stage === 'verified')
                        for (const e of covered) {
                            const exit = records.find(r => r.kind === 'checkout' && r.input?.checkInKey === n.key && r.input.clientIds.includes(e.clientId) && (r.stage === 'verified' || r.attempted));
                            const expectedExit = program.mode === 'entry-exit' && exit ? exit.input.checkoutDate : record.enrollments.find(p => p.enrollmentId === e.enrollmentId)?.exitDate;
                            if (e.exitDate !== expectedExit)
                                fail('enrollment-exit-changed');
                        }
                    return covered;
                };
                if (!found.length && !record.steps.stay) {
                    if (all.some(s => s.end === null || s.start <= n.entryDate && s.end > n.entryDate))
                        fail('overlapping-stay');
                    if (program.mode === 'night-by-night') {
                        const covered = covering(es, n);
                        groupGuard(covered, n);
                        record.enrollments = covered;
                    }
                    else if (es.some(e => e.providerId === n.providerId && n.members.some(m => m.clientId === e.clientId) && (e.exitDate === null || e.exitDate > n.entryDate)))
                        fail('existing-entry-exit-enrollment');
                    let attempted = false, failure;
                    try {
                        await ui.checkIn({ ...n, unitListName: list.name, mode: program.mode, marker: `[sdk-shelter:${hash(n.key)}]` }, async () => {
                            if (attempted)
                                fail('second-save');
                            record.steps.stay = 'attempted';
                            await persist();
                            attempted = true;
                        });
                    }
                    catch (e) {
                        failure = e;
                    }
                    if (!attempted)
                        throw failure ?? Error('Shelter save was not journaled');
                    all = await stays(n);
                    found = all.filter(s => !record.baseline.includes(s.serviceId) && s.start === n.entryDate && s.unitListName === list.name);
                    es = await entries(ids);
                    if (!found.length)
                        throw failure ?? new ShelterConflictError('uncertain-check-in');
                }
                const covered = verify();
                await identity(record, found);
                const outcome = record.stage === 'verified' ? 'already-present' : record.steps.stay === 'attempted' ? 'verified' : 'reconciled';
                record.stays = found;
                record.enrollments = covered;
                record.steps.stay = 'verified';
                record.stage = 'verified';
                await persist();
                return { key: n.key, outcome, mode: program.mode, stays: found, enrollments: covered };
            });
        },
        async checkout(raw) {
            const n = normalizeOut(raw);
            if (!ui.checkout)
                throw Error('Shelter checkout UI required');
            if (label(n.destination) === 'Other' || label(n.reasonForLeaving) === 'Other' || label(n.destination) === 'Rental by client, with ongoing housing subsidy')
                throw Error('Conditional exit details require a supported separate exit workflow');
            return store.withLock(scope, async () => {
                const records = await store.read(scope);
                validateRecords(records);
                let record = records.find(r => r.key === n.key);
                if (record && (record.hash !== hash(n) || record.kind !== 'checkout'))
                    fail('intent-changed');
                if (records.some(r => r.stage === 'pending' && r.key !== n.key))
                    fail('unfinished-shelter-operation');
                const entry = records.find(r => r.key === n.checkInKey && r.kind === 'check-in' && r.stage === 'verified');
                if (!entry || n.clientIds.some(c => !entry.input.members.some(m => m.clientId === c)))
                    fail('verified-check-in-required');
                const people = await readHousehold(entry.input), ids = people.map(p => p.clientId), program = await readShelterProgram(api, entry.input);
                if (program.mode !== entry.mode)
                    fail('tracking-mode-changed');
                if (program.mode === 'entry-exit' && (!n.destination || !n.reasonForLeaving))
                    fail('exit-choices-required');
                if (program.mode === 'night-by-night' && (n.destination || n.reasonForLeaving))
                    fail('nightly-checkout-must-not-exit-program');
                if (n.checkoutDate <= entry.input.entryDate || calendar(entry.input.entryDate, n.timeZone) > n.lastNight)
                    fail('checkout-precedes-stay');
                let es = await entries(ids), all = await stays(entry.input);
                await identity(entry, entry.stays);
                const selected = entry.stays.filter(s => n.clientIds.includes(s.clientId));
                const current = () => selected.map(p => {
                    const s = all.find(s => s.serviceId === p.serviceId);
                    if (!s || s.clientId !== p.clientId || s.providerId !== p.providerId || s.start !== p.start || s.bedName !== p.bedName || s.unitListName !== p.unitListName || s.needId !== p.needId || s.groupId !== p.groupId || s.note !== p.note)
                        fail('stay-changed');
                    return s;
                });
                const covered = covering(es, entry.input);
                groupGuard(covered, entry.input);
                for (const p of entry.enrollments) {
                    const e = covered.find(e => e.clientId === p.clientId);
                    if (!e || e.enrollmentId !== p.enrollmentId || e.entryDate !== p.entryDate || e.groupId !== p.groupId)
                        fail('enrollment-changed');
                }
                if (program.mode === 'entry-exit' && n.clientIds.includes(entry.input.headClientId) && es.some(e => e.providerId === entry.input.providerId && e.groupId === covered.find(e => e.clientId === entry.input.headClientId).groupId && !n.clientIds.includes(e.clientId) && (e.exitDate === null || e.exitDate > n.checkoutDate)))
                    fail('head-cannot-exit-first');
                if (current().some(s => s.end !== null && s.end !== n.checkoutDate))
                    fail('checkout-date-changed');
                if (!record) {
                    record = { version: 1, kind: 'checkout', key: n.key, hash: hash(n), input: n, stage: 'pending', beforeEntries: es, beforeStays: all };
                    records.push(record);
                }
                const persist = () => store.write(scope, records);
                const complete = () => current().every(s => s.end === n.checkoutDate) && covered.filter(e => n.clientIds.includes(e.clientId)).every(e => program.mode === 'night-by-night' ? e.exitDate === record.beforeEntries.find(p => p.enrollmentId === e.enrollmentId)?.exitDate : e.exitDate === n.checkoutDate && label(e.destination) === label(n.destination) && label(e.reason) === label(n.reasonForLeaving));
                if (!current().every(s => s.end === n.checkoutDate) && !record.attempted) {
                    if (current().some(s => s.end !== null) || program.mode === 'entry-exit' && covered.some(e => n.clientIds.includes(e.clientId) && e.exitDate !== null))
                        fail('partial-checkout');
                    let failure, attempted = false;
                    try {
                        await ui.checkout({ ...entry.input, ...n, mode: program.mode, unitListName: entry.unitListName, stays: selected }, async () => {
                            if (attempted)
                                fail('second-save');
                            record.attempted = true;
                            await persist();
                            attempted = true;
                        });
                    }
                    catch (e) {
                        failure = e;
                    }
                    if (!attempted)
                        throw failure ?? Error('Checkout save was not journaled');
                    es = await entries(ids);
                    all = await stays(entry.input);
                    if (!current().every(s => s.end === n.checkoutDate))
                        throw failure ?? new ShelterConflictError('uncertain-checkout');
                }
                const finalEntries = covering(es, entry.input);
                // Recheck pinned identities after the save, not only in preflight.
                for (const p of entry.enrollments) {
                    const e = finalEntries.find(e => e.clientId === p.clientId);
                    if (!e || e.enrollmentId !== p.enrollmentId || e.entryDate !== p.entryDate || e.groupId !== p.groupId)
                        fail('enrollment-changed');
                }
                groupGuard(finalEntries, entry.input);
                covered.splice(0, covered.length, ...finalEntries);
                if (!complete())
                    fail('checkout-enrollment-mismatch');
                await identity(entry, entry.stays);
                for (const before of record.beforeStays.filter(s => !selected.some(p => p.serviceId === s.serviceId))) {
                    if (JSON.stringify(all.find(s => s.serviceId === before.serviceId)) !== JSON.stringify(before))
                        fail('unselected-stay-changed');
                }
                for (const before of record.beforeEntries.filter(e => program.mode === 'night-by-night' || !covered.some(p => p.enrollmentId === e.enrollmentId && n.clientIds.includes(p.clientId)))) {
                    if (JSON.stringify(es.find(e => e.enrollmentId === before.enrollmentId)) !== JSON.stringify(before))
                        fail('unselected-enrollment-changed');
                }
                const outcome = record.stage === 'verified' ? 'already-present' : 'verified';
                record.stage = 'verified';
                await persist();
                return { key: n.key, outcome, mode: program.mode, stays: current(), enrollments: covered };
            });
        },
    };
}
