const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShelters, readShelterProgram } from '@choiceapps/communityservices-sdk/browser';
const input = { key: 'in', providerId: 10, unitListId: 20, householdId: 30, headClientId: 1, entryDate: '2026-10-20T20:00:00-04:00', members: [{ clientId: 1, bedName: 'Bed 1' }, { clientId: 2, bedName: 'Bed 2' }] };
const output = { key: 'out', checkInKey: 'in', clientIds: [1, 2], checkoutDate: '2026-10-23T08:00:00-04:00', lastNight: '2026-10-22', timeZone: 'America/New_York', destination: 'Data not collected', reasonForLeaving: 'Left of own accord' };
function fixture(mode = 'entry-exit') {
    const records = [], enrollments = [], journal = new Map(), counts = { in: 0, out: 0, entry: 0, members: 0 };
    let fault, reading = false, heads = true;
    const store = { withLock: async (_s, fn) => fn(), read: async (s) => structuredClone(journal.get(s) ?? []), write: async (s, v) => journal.set(s, structuredClone(v)) };
    const entry = clientId => ({ enrollmentId: 100 + clientId, clientId, providerId: 10, entryDate: '2026-10-21T00:00:00.000Z', exitDate: null, groupId: 100, type: 'HUD', destination: null, reason: null });
    const api = { tenant: testTenant, providers: { getComplete: async () => ({ providerId: 10, providerName: 'Synthetic Shelter', projectType: 'Emergency Shelter', emergencyShelterTrackingMethod: mode === 'entry-exit' ? 'Entry/Exit Date' : 'Night-by-Night' }) }, households: { get: async () => ({ householdId: 30, isActive: true, clients: [1, 2].map(clientId => ({ clientId, isActive: true, headofhouseholdStatus: heads && clientId === 1, dateJoined: '2026-10-19T12:00:00', dateLeft: null })) }) }, services: { listForClient: async ({ path: { clientId } }) => {
                if (reading)
                    throw Object.assign(Error('server down'), { status: 500 });
                const values = records.filter(s => s.clientId === clientId);
                return { count: values.length, values: structuredClone(values) };
            }, getComplete: async ({ path: { serviceId } }) => structuredClone(records.filter(s => s.serviceId === serviceId)) }, enrollments: { createEntryAssessment: async () => {
                counts.entry++;
                if (fault === 'entry-before')
                    throw Error('lost');
                enrollments.push(entry(1));
                if (fault === 'entry-after')
                    throw Error('lost');
            } } };
    const ui = { assertBedsAvailable: async () => { }, verifyStayIdentity: async ({ stays, unitListId, marker }) => stays.map(s => {
            const r = records.find(r => r.serviceId === s.serviceId);
            if (r.serviceNote !== marker)
                throw Error('marker changed');
            return { serviceId: s.serviceId, clientId: s.clientId, bedId: r.bedId ?? s.clientId, unitListId };
        }), getUnitList: async () => ({ unitListId: 20, name: 'Synthetic Beds' }), listEnrollments: async () => structuredClone(enrollments), confirmNoServices: async () => false, checkIn: async (n, before) => {
            await before();
            counts.in++;
            if (fault === 'in-before')
                throw Error('lost');
            for (const m of n.members) {
                records.push({ isActive: true, shelter_item: true, serviceId: 200 + m.clientId, clientId: m.clientId, provider_id: 10, needId: 300 + m.clientId, serviceStartDate: n.entryDate, serviceEndDate: null, unitList: n.unitListName, unitNameNumber: m.bedName, groupId: 200, serviceNote: n.marker });
                if (mode === 'entry-exit')
                    enrollments.push(entry(m.clientId));
                if (fault === 'partial')
                    break;
            }
            if (fault === 'in-after')
                throw Error('lost');
        }, checkout: async (n, before) => {
            await before();
            counts.out++;
            if (fault === 'out-before')
                throw Error('lost');
            for (const s of records.filter(s => n.clientIds.includes(s.clientId)))
                s.serviceEndDate = n.checkoutDate;
            if (mode === 'entry-exit')
                for (const e of enrollments.filter(e => n.clientIds.includes(e.clientId))) {
                    e.exitDate = n.checkoutDate;
                    e.destination = n.destination;
                    e.reason = n.reasonForLeaving;
                }
            if (fault === 'out-after')
                throw Error('lost');
        } };
    const enrollmentHelpers = { addHouseholdMembers: async () => { counts.members++; enrollments.push(entry(2)); } };
    return { api, ui, store, counts, records, enrollments, journal, entry, helpers: () => createShelters({ api, ui, store, enrollmentHelpers }), fault: v => fault = v, readFail: v => reading = v, noHead: () => heads = false };
}
test('provider API distinguishes ES modes and rejects unknown/TH nightly configuration', async () => {
    for (const mode of ['entry-exit', 'night-by-night']) {
        const f = fixture(mode);
        assert.equal((await readShelterProgram(f.api, { providerId: 10 })).mode, mode);
    }
    const f = fixture();
    f.api.providers.getComplete = async () => ({ providerId: 10, projectType: 'Transitional housing', emergencyShelterTrackingMethod: 'Night-by-Night' });
    await assert.rejects(readShelterProgram(f.api, { providerId: 10 }), e => e.reason === 'unsupported-tracking-mode');
});
test('entry/exit household check-in and checkout retry without duplicate writes', async () => { const f = fixture(); const a = await f.helpers().checkIn(input); assert.equal(a.stays.length, 2); assert.equal((await f.helpers().checkIn(input)).outcome, 'already-present'); const b = await f.helpers().checkout(output); assert.equal(b.stays.length, 2); assert.equal((await f.helpers().checkout(output)).outcome, 'already-present'); await f.helpers().checkIn(input); assert.deepEqual(f.counts, { in: 1, out: 1, entry: 0, members: 0 }); });
test('nightly stays require same-program enrollment and can explicitly create it', async () => { const f = fixture('night-by-night'); await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'missing-same-program-enrollment'); assert.equal(f.counts.in, 0); await f.helpers().checkIn({ ...input, enrollmentStrategy: 'create-if-missing' }); await f.helpers().checkIn({ ...input, enrollmentStrategy: 'create-if-missing' }); await f.helpers().checkout({ ...output, destination: null, reasonForLeaving: null }); assert.ok(f.enrollments.every(e => e.exitDate === null)); assert.deepEqual(f.counts, { in: 1, out: 1, entry: 1, members: 1 }); });
test('another program does not cover a nightly stay', async () => { const f = fixture('night-by-night'); f.enrollments.push({ ...f.entry(1), providerId: 11 }, { ...f.entry(2), providerId: 11 }); await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'missing-same-program-enrollment'); assert.equal(f.counts.in, 0); });
test('changed intent, bed identity, and need identity fail without another save', async () => { const f = fixture(); await f.helpers().checkIn(input); await assert.rejects(f.helpers().checkIn({ ...input, entryDate: '2026-10-22T00:00:00Z' }), e => e.reason === 'intent-changed'); f.records[0].needId = 999; await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'stay-changed'); assert.equal(f.counts.in, 1); });
test('missing head blocks before writes', async () => { const f = fixture(); f.noHead(); await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'head-of-household-missing-or-changed'); assert.equal(f.counts.in, 0); });
test('head cannot exit first, member then head can exit separately', async () => { const f = fixture(); await f.helpers().checkIn(input); await assert.rejects(f.helpers().checkout({ ...output, clientIds: [1] }), e => e.reason === 'head-cannot-exit-first'); await f.helpers().checkout({ ...output, key: 'member-out', clientIds: [2] }); assert.equal(f.enrollments[0].exitDate, null); await f.helpers().checkout({ ...output, key: 'head-out', clientIds: [1] }); assert.equal(f.counts.out, 2); });
test('check-in response loss reconciles, precommit and partial failures never replay', async () => {
    for (const fault of ['in-after', 'in-before', 'partial']) {
        const f = fixture();
        f.fault(fault);
        if (fault === 'in-after') {
            await f.helpers().checkIn(input);
            await f.helpers().checkIn(input);
        }
        else {
            await assert.rejects(f.helpers().checkIn(input));
            await assert.rejects(f.helpers().checkIn(input));
            await assert.rejects(f.helpers().checkIn({ ...input, key: 'replacement' }), e => e.reason === 'unfinished-shelter-operation');
        }
        assert.equal(f.counts.in, 1);
    }
});
test('checkout response loss reconciles; missing commit cannot replay', async () => {
    for (const fault of ['out-after', 'out-before']) {
        const f = fixture();
        await f.helpers().checkIn(input);
        f.fault(fault);
        if (fault === 'out-after') {
            await f.helpers().checkout(output);
            await f.helpers().checkout(output);
        }
        else {
            await assert.rejects(f.helpers().checkout(output));
            await assert.rejects(f.helpers().checkout(output));
        }
        assert.equal(f.counts.out, 1);
    }
});
test('last-night contract validates calendar rollover and invalid dates', async () => {
    const f = fixture();
    await f.helpers().checkIn(input);
    for (const change of [{ lastNight: '2026-02-30' }, { lastNight: '2026-10-23' }, { timeZone: 'Invalid/Zone' }])
        await assert.rejects(f.helpers().checkout({ ...output, ...change }));
    assert.equal(f.counts.out, 0);
});
test('failed reads cannot authorize check-in or produce duplicate retry', async () => { const f = fixture(); f.readFail(true); await assert.rejects(f.helpers().checkIn(input)); assert.equal(f.counts.in, 0); });
test('existing entry/exit enrollment prevents implicit duplicate enrollment', async () => { const f = fixture(); f.enrollments.push(f.entry(1)); await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'existing-entry-exit-enrollment'); assert.equal(f.counts.in, 0); });
test('404 is empty only with an independently proven zero service count', async () => {
    for (const confirmed of [false, true]) {
        const f = fixture();
        const list = f.api.services.listForClient;
        f.api.services.listForClient = async (args) => { if (!f.records.length)
            throw Object.assign(Error('not found'), { status: 404 }); return list(args); };
        f.ui.confirmNoServices = async () => confirmed;
        if (confirmed)
            await f.helpers().checkIn(input);
        else
            await assert.rejects(f.helpers().checkIn(input));
        assert.equal(f.counts.in, confirmed ? 1 : 0);
    }
});
test('source marker and numeric bed identity drift block retries', async () => {
    for (const kind of ['marker', 'bed']) {
        const f = fixture();
        await f.helpers().checkIn(input);
        if (kind === 'marker')
            f.records[0].serviceNote = 'changed';
        else
            f.records[0].bedId = 999;
        await assert.rejects(f.helpers().checkIn(input));
        await assert.rejects(f.helpers().checkout(output));
        assert.equal(f.counts.in, 1);
        assert.equal(f.counts.out, 0);
    }
});
test('unrecorded end dates cannot be adopted by a check-in retry', async () => {
    const f = fixture();
    await f.helpers().checkIn(input);
    f.records[0].serviceEndDate = output.checkoutDate;
    await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'stay-end-changed');
    assert.equal(f.counts.in, 1);
});
test('real DOM waits for delayed required answers and rejects missing answers without filling defaults', { skip: !process.env.WELLSKY_TEST_CHROME }, async () => {
    const { waitForShelterAssessmentAnswers } = await import(new URL('./shelter-ui.mjs', import.meta.resolve('@choiceapps/communityservices-sdk/browser')));
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WELLSKY_TEST_CHROME });
    try {
        const page = await browser.newPage();
        await page.setContent('<select id="ClientProfileTab.disability" aria-label="Disabling Condition?" aria-required="true"><option>-Select-</option><option>No (HUD)</option></select><select id="ClientProfileTab.hidden" aria-required="true" style="display:none"><option>-Select-</option></select>');
        await page.evaluate(() => setTimeout(() => document.getElementById('ClientProfileTab.disability').value = 'No (HUD)', 150));
        await waitForShelterAssessmentAnswers(page, { timeout: 2000 });
        assert.equal(await page.getByLabel('Disabling Condition?', { exact: true }).inputValue(), 'No (HUD)');
        await page.getByLabel('Disabling Condition?', { exact: true }).selectOption('-Select-');
        await assert.rejects(waitForShelterAssessmentAnswers(page, { timeout: 100 }), /Complete required shelter assessment answers.*Disabling Condition/);
        assert.equal(await page.getByLabel('Disabling Condition?', { exact: true }).inputValue(), '-Select-');
    }
    finally {
        await browser.close();
    }
});
test('bed preflight fails before creating a nightly enrollment', async () => {
    const f = fixture('night-by-night');
    f.ui.assertBedsAvailable = async () => { throw Error('bed unavailable'); };
    await assert.rejects(f.helpers().checkIn({ ...input, enrollmentStrategy: 'create-if-missing' }), /bed unavailable/);
    assert.equal(f.counts.entry, 0);
    assert.equal(f.counts.in, 0);
});
test('explicit cancellation retains verified enrollments and never permits cancellation of an attempted save', async () => {
    const f = fixture('night-by-night');
    f.ui.checkIn = async () => { throw Error('form unavailable before Save'); };
    await assert.rejects(f.helpers().checkIn({ ...input, enrollmentStrategy: 'create-if-missing' }));
    const result = await f.helpers().cancelUnsubmittedCheckIn({ key: 'in' });
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.enrollments.length, 2);
    assert.equal((await f.helpers().cancelUnsubmittedCheckIn({ key: 'in' })).outcome, 'already-cancelled');
    assert.equal(f.enrollments.length, 2);
    await assert.rejects(f.helpers().checkIn({ ...input, enrollmentStrategy: 'create-if-missing' }), e => e.reason === 'check-in-cancelled');
    const uncertain = fixture();
    uncertain.fault('in-before');
    await assert.rejects(uncertain.helpers().checkIn(input));
    await assert.rejects(uncertain.helpers().cancelUnsubmittedCheckIn({ key: 'in' }), e => e.reason === 'check-in-cannot-be-cancelled');
    assert.equal(uncertain.counts.in, 1);
});

test('shelter history continues through capped short pages using the counted total', async () => {
    const f = fixture();
    f.records.push(...[401, 402].map(serviceId => ({ serviceId, clientId: 1, isActive: true, shelter_item: false })));
    const pages = [];
    f.api.services.listForClient = async ({ path: { clientId }, query: { startPage } }) => {
        pages.push([clientId, startPage]);
        const rows = f.records.filter(s => s.clientId === clientId);
        return { count: rows.length, values: structuredClone(rows.slice(startPage - 1, startPage)) };
    };
    await f.helpers().checkIn(input);
    assert.ok(pages.some(([clientId, page]) => clientId === 1 && page === 3));
    assert.equal((await f.helpers().checkIn(input)).outcome, 'already-present');
    assert.equal(f.counts.in, 1);
});

test('an empty shelter history page before the counted total blocks writes', async () => {
    const f = fixture();
    f.api.services.listForClient = async () => ({ count: 1, values: [] });
    await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'stay-read-incomplete');
    assert.equal(f.counts.in, 0);
});

test('checkout readback rejects replacement or regrouped selected enrollments without replay', async () => {
    for (const change of ['enrollmentId', 'groupId', 'entryDate']) {
        const f = fixture();
        await f.helpers().checkIn(input);
        const checkout = f.ui.checkout;
        f.ui.checkout = async (...args) => {
            await checkout(...args);
            if (change === 'entryDate') f.enrollments[0].entryDate = '2026-10-20T00:00:00.000Z';
            else f.enrollments[0][change] = 999;
        };
        await assert.rejects(f.helpers().checkout(output), e => e.reason === 'enrollment-changed');
        await assert.rejects(f.helpers().checkout(output));
        assert.equal(f.counts.out, 1);
    }
});

test('checkout detects changes to a selected client’s unrelated historical stay', async () => {
    const f = fixture();
    await f.helpers().checkIn(input);
    f.records.push({ ...f.records[0], serviceId: 900, needId: 901, groupId: 900, serviceStartDate: '2026-09-01T00:00:00.000Z', serviceEndDate: '2026-09-02T00:00:00.000Z' });
    await assert.rejects(f.helpers().checkout(output), e => e.reason === 'unselected-stay-changed');
    await assert.rejects(f.helpers().checkout(output), e => e.reason === 'unselected-stay-changed');
    assert.equal(f.counts.out, 1);
});

test('checkout detects changes to a selected client’s enrollment in another program', async () => {
    const f = fixture();
    await f.helpers().checkIn(input);
    f.enrollments.push({ ...f.entry(1), enrollmentId: 900, providerId: 11, groupId: 900 });
    await assert.rejects(f.helpers().checkout(output), e => e.reason === 'unselected-enrollment-changed');
    await assert.rejects(f.helpers().checkout(output), e => e.reason === 'unselected-enrollment-changed');
    assert.equal(f.counts.out, 1);
});

test('checkout accepts unchanged historical stays and other-program enrollments on retries', async () => {
    const f = fixture();
    await f.helpers().checkIn(input);
    const history = { ...f.records[0], serviceId: 900, needId: 901, groupId: 900, serviceStartDate: '2026-09-01T00:00:00.000Z', serviceEndDate: '2026-09-02T00:00:00.000Z' };
    const other = { ...f.entry(1), enrollmentId: 900, providerId: 11, groupId: 900 };
    f.records.push(structuredClone(history));
    f.enrollments.push(structuredClone(other));
    const save = f.ui.checkout;
    f.ui.checkout = async (...args) => {
        await save(...args);
        Object.assign(f.records.find(s => s.serviceId === history.serviceId), history);
        Object.assign(f.enrollments.find(e => e.enrollmentId === other.enrollmentId), other);
    };
    assert.equal((await f.helpers().checkout(output)).outcome, 'verified');
    assert.equal((await f.helpers().checkout(output)).outcome, 'already-present');
    assert.deepEqual(f.records.find(s => s.serviceId === history.serviceId), history);
    assert.deepEqual(f.enrollments.find(e => e.enrollmentId === other.enrollmentId), other);
    assert.equal(f.counts.out, 1);
});

test('real shelter adapter refuses unfinished check-in and checkout forms before navigation', { skip: !process.env.WELLSKY_TEST_CHROME }, async () => {
    const { createShelterUi } = await import('@choiceapps/communityservices-sdk/browser');
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WELLSKY_TEST_CHROME });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(250);
        const base = ('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html').replaceAll('tenant-b', testTenant);
        let requests = 0;
        await page.route('**/*', route => { requests++; return route.fulfill({ contentType: 'text/html', body: '<main></main>' }); });
        await page.goto(base);
        for (const form of ['ShelterPointCheckIn', 'ShelterPointCheckOut']) {
            await page.setContent(`<button id="${form}.saveExitBtn">Save & Exit</button><input aria-label="Unsaved answer" value="keep">`);
            const before = requests;
            await assert.rejects(createShelterUi({ page }).getUnitList(input), /Close unfinished forms/);
            assert.equal(await page.getByLabel('Unsaved answer').inputValue(), 'keep');
            assert.equal(requests, before);
        }
    } finally { await browser.close(); }
});

test('real shelter adapter navigates clean inventory and resolves the selected unit list', { skip: !process.env.WELLSKY_TEST_CHROME }, async () => {
    const { createShelterUi } = await import('@choiceapps/communityservices-sdk/browser');
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WELLSKY_TEST_CHROME });
    try {
        const page = await browser.newPage();
        const html = `<button id="navigation-link.shelterpt">Shelters</button>
          <button onclick="document.querySelector('[role=dialog]').style.display='block'">Search</button>
          <div role="dialog" style="display:none">Showing 1-1 of 1
            <input aria-label="Provider ID #"><button>Submit</button>
            <button id="SpProviderSearchPopup.setProvider-imageLink_10" onclick="this.parentElement.style.display='none'">Select provider</button>
          </div>
          <select id="ShelterPointMainView.unitListBox"><option value="20">Synthetic Beds</option></select>
          <button id="ShelterPointMainView.selectUnitListBtn">Submit</button><button>View All</button>
          <button id="ShelterPointMainView.transmitTodaysCheckOutBtn">Transmit</button>`;
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto(('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html').replaceAll('tenant-b', testTenant));
        assert.deepEqual(await createShelterUi({ page }).getUnitList(input), { unitListId: 20, name: 'Synthetic Beds' });
        assert.equal(await page.getByLabel('Provider ID #').inputValue(), '10');
    } finally { await browser.close(); }
});

test('a single-member stay may have no shelter or enrollment group', async () => {
    const f = fixture(), one = { ...input, members: [input.members[0]] };
    const save = f.ui.checkIn;
    f.ui.checkIn = async (...args) => {
        await save(...args);
        f.records[0].groupId = null;
        f.enrollments[0].groupId = null;
    };
    const result = await f.helpers().checkIn(one);
    assert.equal(result.stays[0].groupId, null);
    assert.equal((await f.helpers().checkIn(one)).outcome, 'already-present');
    await f.helpers().checkout({ ...output, clientIds: [1] });
    assert.equal((await f.helpers().checkout({ ...output, clientIds: [1] })).outcome, 'already-present');
    assert.deepEqual(f.counts, { in: 1, out: 1, entry: 0, members: 0 });
});

test('multiple selected members still require a non-null common shelter group', async () => {
    const f = fixture(), save = f.ui.checkIn;
    f.ui.checkIn = async (...args) => { await save(...args); for (const stay of f.records) stay.groupId = null; };
    await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'stay-household-group-mismatch');
    await assert.rejects(f.helpers().checkIn(input), e => e.reason === 'stay-household-group-mismatch');
    assert.equal(f.counts.in, 1);
});

test('real checkout adapter treats a lone anchor as implicit but never invents other members', { skip: !process.env.WELLSKY_TEST_CHROME }, async () => {
    const { createShelterUi } = await import('@choiceapps/communityservices-sdk/browser');
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ headless: true, executablePath: process.env.WELLSKY_TEST_CHROME });
    const base = ('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
    try {
        for (const clientIds of [[1], [1, 2]]) {
            const page = await browser.newPage({ timezoneId: output.timeZone });
            const fields = ['Month', 'Day', 'Year'].map(part => `<input aria-label="Date Out ${part}">`).join('') +
                Object.entries({ Hour: '8', Minute: '00', Second: '00', 'AM/PM': 'AM' }).map(([part, value]) => `<select aria-label="Date Out ${part}"><option>${value}</option></select>`).join('');
            const html = `<div id="inventory"><button id="navigation-link.shelterpt">Shelters</button>
              <button onclick="document.querySelector('[role=dialog]').hidden=false">Search</button>
              <div role="dialog" hidden>Showing 1-1 of 1<input aria-label="Provider ID #"><button>Submit</button>
                <button id="SpProviderSearchPopup.setProvider-imageLink_10" onclick="this.parentElement.hidden=true">Choose provider</button></div>
              <select id="ShelterPointMainView.unitListBox"><option value="20">Synthetic Beds</option></select>
              <button id="ShelterPointMainView.selectUnitListBtn">Submit</button><button>View All</button>
              <button id="ShelterPointMainView.transmitTodaysCheckOutBtn">Transmit</button>
              <table><tr><td><button id="ShelterPointMainView.shelter.checkOutImage-1" title="Check Out"
                onclick="fetch('${base}service/UnitListService',{method:'POST',body:'7|0|0|base|policy|service|getNeedService|201|'}).then(()=>{document.getElementById('inventory').hidden=true;document.getElementById('checkout').hidden=false})">Check Out</button></td><td>(1) Synthetic</td><td>Bed 1</td></tr></table></div>
              <div id="checkout" hidden>Unit Exit Data - (1) Synthetic${fields}
                <select aria-label="Destination"><option>Data not collected</option></select>
                <select aria-label="Reason For Leaving"><option>Left of own accord</option></select>
                <button id="ShelterPointCheckOut.saveExitBtn" onclick="fetch('${base}service/UnitListService',{method:'POST',body:'7|0|0|base|policy|service|saveNeedService|'}).catch(()=>this.remove())">Save & Exit</button>
                <button id="ShelterPointCheckOut.exitBtn" onclick="this.parentElement.hidden=true">Exit</button></div>`;
            let mutations = 0, journalCalls = 0;
            await page.route('**/*', route => {
                if (route.request().url().endsWith('service/UnitListService')) {
                    if (!route.request().postData().includes('|getNeedService|')) mutations++;
                    return route.fulfill({ contentType: 'text/plain', body: '//OK[]' });
                }
                return route.fulfill({ contentType: 'text/html', body: html });
            });
            await page.goto(base + 'index.html');
            const ui = createShelterUi({ page });
            await assert.rejects(ui.checkout({ ...input, ...output, clientIds, mode: 'entry-exit', unitListName: 'Synthetic Beds', stays: [{ clientId: 1, serviceId: 201, bedName: 'Bed 1' }] }, async () => { journalCalls++; throw Error('journal stop'); }), clientIds.length === 1 ? /journal stop/ : /selection incomplete/);
            assert.equal(journalCalls, clientIds.length === 1 ? 1 : 0);
            assert.equal(mutations, 0);
            await page.close();
        }
    } finally { await browser.close(); }
});
