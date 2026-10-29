import {pageConnection} from './connection.mjs';
import { decodeMappedResponse } from './gwt-mapped.mjs';
import { withPageLock } from './page-lock.mjs';
const id = n => {
    if (!Number.isSafeInteger(n) || n < 1)
        throw Error('Positive shelter ID required');
    return n;
};
// Internal acceptance seam: required controls can be visible before values arrive.
export async function waitForShelterAssessmentAnswers(page, { timeout = 30000 } = {}) {
    try {
        await page.waitForFunction(() => [...document.querySelectorAll('[id^="ClientProfileTab."][aria-required="true"]')]
            .filter(e => e.getClientRects().length)
            .every(e => e.value && e.value !== '-Select-'), null, { timeout });
    }
    catch {
        const missing = await page.locator('[id^="ClientProfileTab."][aria-required="true"]:visible')
            .evaluateAll(es => es.filter(e => !e.value || e.value === '-Select-').map(e => e.getAttribute('aria-label')));
        throw Error('Complete required shelter assessment answers before saving: ' + missing.join(', '));
    }
}
/** Fresh forms only. Call through createShelters to journal writes. */
export function createShelterUi({ page }) {
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
    let readWire;
    let formRequests;
    const ctl = name => page.locator(`[id="${name}"]:visible`);
    const ready = () => page.waitForFunction(() => !document.body.innerText.includes('Processing...') && !document.body.innerText.includes('Loading...'), null, { timeout: 30000 });
    // Assessment loading can continue after the form's Processing overlay disappears.
    // Do not save the initially empty controls before the asynchronous answers arrive.
    const settleForm = async () => {
        if (!formRequests)
            throw Error('Shelter form request tracking required');
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            await ready();
            if (!formRequests.pending.size && Date.now() - formRequests.changed >= 500)
                return;
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        throw Error('Shelter assessment requests did not settle');
    };
    const trackForm = async (work) => {
        formRequests = { pending: new Set(), changed: Date.now() };
        const started = request => { if (request.url().startsWith(base + 'service/')) {
            formRequests.pending.add(request);
            formRequests.changed = Date.now();
        } };
        const finished = request => { if (formRequests.pending.delete(request))
            formRequests.changed = Date.now(); };
        page.on('request', started);
        page.on('requestfinished', finished);
        page.on('requestfailed', finished);
        try {
            return await work();
        }
        finally {
            page.off('request', started);
            page.off('requestfinished', finished);
            page.off('requestfailed', finished);
            formRequests = undefined;
        }
    };
    const requireAssessmentAnswers = () => waitForShelterAssessmentAnswers(page);
    const guard = () => {
        const u = new URL(page.url());
        if (u.origin + u.pathname !== base + 'index.html')
            throw Error('Configured shelter page required');
    };
    const noForms = async () => {
        guard();
        if (await page.locator('[role=dialog]:visible').count() || await ctl('ShelterPointCheckIn.saveBtn').count() || await ctl('ShelterPointCheckOut.saveBtn').count() || await ctl('ShelterPointCheckIn.saveExitBtn').count() || await ctl('ShelterPointCheckOut.saveExitBtn').count() || await ctl('formfield-password').count())
            throw Error('Close unfinished forms before shelter workflow');
    };
    const provider = async (providerId) => {
        await page.getByRole('button', { name: 'Search', exact: true }).click();
        const d = page.getByRole('dialog');
        await d.getByText(/Showing \d+-\d+ of \d+/).waitFor();
        await d.getByLabel('Provider ID #', { exact: true }).fill(String(id(providerId)));
        await d.getByLabel('Provider ID #', { exact: true }).press('Tab');
        await d.getByRole('button', { name: 'Submit', exact: true }).click();
        await ctl(`SpProviderSearchPopup.setProvider-imageLink_${providerId}`).click();
        await d.waitFor({ state: 'hidden' });
        await ready();
    };
    const inventory = async ({ providerId, unitListId }) => {
        await noForms();
        await ctl('navigation-link.shelterpt').click();
        await ready();
        await provider(providerId);
        const list = ctl('ShelterPointMainView.unitListBox');
        await list.locator(`option[value="${id(unitListId)}"]`).waitFor({ state: 'attached' });
        const name = await list.locator(`option[value="${unitListId}"]`).textContent();
        await list.selectOption(String(unitListId));
        await ctl('ShelterPointMainView.selectUnitListBtn').click();
        await page.getByText('View All', { exact: true }).click();
        await ctl('ShelterPointMainView.transmitTodaysCheckOutBtn').waitFor();
        await ready();
        const display = page.locator('select:visible').filter({ has: page.locator('option[value="ALL"]', { hasText: 'All Beds' }) });
        if (await display.count()) {
            await display.selectOption('ALL');
            await ready();
            if (await display.inputValue() !== 'ALL')
                throw Error('Shelter inventory filter mismatch');
        }
        return name;
    };
    const setDate = async (prefix, value) => {
        const parts = await page.evaluate(value => {
            const d = new Date(value);
            if (+new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) !== +d)
                throw Error('Ambiguous local shelter time');
            return { Month: String(d.getMonth() + 1).padStart(2, '0'), Day: String(d.getDate()).padStart(2, '0'), Year: String(d.getFullYear()), Hour: String(d.getHours() % 12 || 12), Minute: String(d.getMinutes()).padStart(2, '0'), Second: String(d.getSeconds()).padStart(2, '0'), 'AM/PM': d.getHours() < 12 ? 'AM' : 'PM' };
        }, value);
        for (const [part, text] of Object.entries(parts)) {
            const field = page.getByLabel(`${prefix} ${part}`, { exact: true });
            if (['Month', 'Day', 'Year'].includes(part))
                await field.fill(text);
            else
                await field.selectOption({ label: text });
            await field.press('Tab');
            if (await field.inputValue() !== text)
                throw Error('Shelter date mismatch');
        }
        await ready();
    };
    const chooseMembers = async (ids, prefix, anchorClientId) => {
        const boxes = page.locator(`[id^="${prefix}"]:visible input[type=checkbox]`);
        for (let i = 0; i < await boxes.count(); i++) {
            const box = boxes.nth(i), clientId = await box.evaluate(e => Number(e.parentElement.id.match(/client-(\d+)$/)?.[1]));
            if (await box.isEnabled())
                await box.setChecked(ids.includes(clientId));
            if (await box.isChecked() !== ids.includes(clientId))
                throw Error('Shelter household selection mismatch');
        }
        const selected = await boxes.evaluateAll(es => es.filter(e => e.checked).map(e => Number(e.parentElement.id.match(/client-(\d+)$/)?.[1])).sort((a, b) => a - b));
        // A single-client form can omit the anchor's checkbox. Its identity was
        // checked against the form heading; every other member must be explicit.
        const rendered = await boxes.evaluateAll(es => es.map(e => Number(e.parentElement.id.match(/client-(\d+)$/)?.[1])));
        if (!rendered.includes(anchorClientId) && ids.includes(anchorClientId))
            selected.push(anchorClientId);
        selected.sort((a, b) => a - b);
        if (JSON.stringify(selected) !== JSON.stringify([...ids].sort((a, b) => a - b)))
            throw Error('Shelter household selection incomplete');
    };
    const readEnrollments = async ({ clientIds, serviceIds = false, stayIds }) => {
        if (!Array.isArray(clientIds) || !clientIds.length)
            throw Error('Client IDs required');
        clientIds.forEach(id);
        await noForms();
        let seed, pending;
        const listener = r => {
            if (r.url() === base + 'service/MetaQueryService' && r.postData()?.startsWith('7|0|'))
                pending = r.allHeaders().then(headers => { seed = { policy: r.postData().split('|')[4], headers: Object.fromEntries(['content-type', 'x-gwt-module-base', 'x-gwt-permutation'].map(k => [k, headers[k]])) }; });
        };
        page.on('request', listener);
        try {
            await ctl('navigation-link.shelterpt').click();
            await ready();
            await page.goto(base + `index.html#loadClient;clientId=${clientIds[0]}`);
            await page.getByText(new RegExp(`^Client - \\(${clientIds[0]}\\)`)).waitFor();
            await page.getByRole('tab', { name: 'Summary', exact: true }).click();
            await page.getByRole('tab', { name: 'Entry / Exit', exact: true }).click();
            await ready();
            await pending;
        }
        finally {
            page.off('request', listener);
        }
        if (!seed)
            throw Error('Fresh enrollment read context unavailable');
        if (stayIds)
            stayIds.forEach(id);
        readWire = seed;
        const query = stayIds ? `SELECT s.needServiceId AS serviceId, s.clientId AS clientId, s.shelterBedId AS bedId, s.shelterBedlistId AS unitListId FROM SpNeedService AS s WHERE s.active = TRUE AND s.shelterItem = TRUE AND s.clientId IN (${clientIds.join(',')}) AND s.needServiceId IN (${stayIds.join(',')}) ORDER BY s.needServiceId LIMIT 1001,0` : serviceIds ? `SELECT s.needServiceId AS serviceId FROM SpNeedService AS s WHERE s.active = TRUE AND s.clientId IN (${clientIds.join(',')}) ORDER BY s.needServiceId LIMIT 1001,0` : `SELECT e.entryExitId AS enrollmentId, e.clientId AS clientId, e.entryDate AS entryDate, e.exitDate AS exitDate, e.groupId AS groupId, e.providerId AS providerId, e.typeEntryExit.name AS type, e.destinationValue.name AS destination, e.reasonLeavingValue.name AS reason FROM SpEntryExit AS e WHERE e.active = TRUE AND e.client.active = TRUE AND e.clientId IN (${clientIds.join(',')}) ORDER BY e.entryExitId LIMIT 1001,0`;
        const strings = [base, seed.policy, 'com.bowmansystems.sp5.core.client.services.GenericService', 'getMappedResults', 'java.lang.String/2004016611', 'java.util.HashMap/1797211028', 'I', 'Z', query];
        const r = await page.evaluate(async (w) => { const r = await fetch(w.url, { method: 'POST', headers: w.headers, body: w.body, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(30000) }); return { status: r.status, body: await r.text() }; }, { url: base + 'service/MetaQueryService', headers: seed.headers, body: ['7', '0', 9, ...strings, 1, 2, 3, 4, 5, 5, 6, 7, 7, 8, 9, 0, 0, 1001, 1, ''].join('|') });
        if (r.status !== 200)
            throw Error('Enrollment read failed');
        const result = decodeMappedResponse(r.body);
        if (result.total !== result.rows.length || result.total > 1000 || new Set(result.rows.map(r => serviceIds || stayIds ? r.serviceId : r.enrollmentId)).size !== result.rows.length)
            throw Error('Incomplete enrollment read');
        return result.rows;
    };
    const save = async (button, beforeSave) => {
        let journaled = false, journalPromise, routeFailure;
        const route = async (r) => {
            try {
                const request = r.request(), body = request.postData(), method = body?.split('|')[6];
                const read = typeof method === 'string' && (method.startsWith('get') || method === 'heartbeat' || ['verifyHudSubassessment', 'loadScoringRules', 'isClientAlreadyCheckedIn', 'isProviderHouseholdDataSharingAssessmentVisible', 'loadReportConfiguration'].includes(method) || request.url() === base + 'service/MetaQueryService' && method === 'execute' && body.includes('|SELECT '));
                if (!read) {
                    if (!body?.startsWith('7|0|'))
                        throw Error('Unknown shelter request format');
                    if (!journalPromise)
                        journalPromise = Promise.resolve().then(beforeSave);
                    await journalPromise;
                    journaled = true;
                }
                await r.continue();
            }
            catch (e) {
                routeFailure = e;
                await r.abort();
            }
        };
        await page.route(base + 'service/**', route);
        try {
            await ctl(button).click();
            await page.waitForFunction(name => !document.getElementById(name)?.getClientRects().length || [...document.querySelectorAll('[role=dialog]')].some(d => /Validation Warning/.test(d.innerText)), button, { timeout: 30000 });
            const warning = page.getByRole('dialog').filter({ hasText: 'Validation Warning' });
            if (await warning.count()) {
                const detail = await warning.innerText();
                await warning.getByRole('button', { name: 'OK', exact: true }).click();
                throw Error('Shelter validation rejected the save: ' + detail);
            }
            if (routeFailure)
                throw routeFailure;
            if (!journaled)
                throw Error('No shelter mutation was submitted');
            await ready();
        }
        finally {
            await page.unroute(base + 'service/**', route);
        }
    };
    const checkIn = async (input, beforeSave) => {
        const name = await inventory(input);
        if (name !== input.unitListName)
            throw Error('Unit list changed');
        const head = input.members.find(m => m.clientId === input.headClientId);
        if (!head)
            throw Error('Head required');
        const row = page.getByText(head.bedName, { exact: true }).locator('xpath=ancestor::tr[1]');
        if (await row.count() !== 1 || !await row.getByText('EMPTY', { exact: true }).isVisible())
            throw Error('Selected head bed unavailable');
        await row.locator('[id^="ShelterPointMainView.shelter.checkInImage-"]').click();
        await page.waitForFunction(() => !!document.getElementById('ClientSearchView.clientId-textbox') && [...document.querySelectorAll('select option')].some(o => o.textContent === 'Full Name Reported'));
        await ready();
        await ctl('ClientSearchView.clientId-textbox').fill(String(input.headClientId));
        await ctl('ClientSearchView.clientId-textbox').press('Tab');
        if (await ctl('ClientSearchView.clientId-textbox').inputValue() !== String(input.headClientId))
            throw Error('Shelter client search mismatch');
        await ctl('ClientSearchView.clientIdSubmitBtn').click();
        await ctl('ShelterPointCheckIn.saveExitBtn').waitFor();
        await settleForm();
        try {
            if (!(await page.locator('body').innerText()).includes(`Unit Entry Data - (${input.headClientId})`))
                throw Error('Shelter client mismatch');
            const hasEntry = await page.locator('select[aria-label="Type"]').isVisible();
            if (hasEntry !== (input.mode === 'entry-exit'))
                throw Error('Shelter configuration disagrees with provider tracking mode');
            await setDate('Date In', input.entryDate);
            await settleForm();
            await chooseMembers(input.members.map(m => m.clientId), 'ShelterHouseholdsCheckboxTree.checkbox.', input.headClientId);
            for (const member of input.members) {
                if (member.clientId === input.headClientId)
                    continue;
                const box = page.locator(`[id^="ShelterHouseholdsCheckboxTree.checkbox."][id$=".client-${member.clientId}"]`);
                const row = box.locator('xpath=ancestor::tr[1]');
                await row.getByRole('button', { name: 'Assign Unit', exact: true }).click();
                const d = page.getByRole('dialog').filter({ has: ctl('ChooseUnitPopup.selectBtn') });
                const select = d.locator('select');
                await select.locator('option').filter({ hasText: member.bedName }).waitFor({ state: 'attached' });
                await ready();
                const matches = await select.locator('option').evaluateAll((es, name) => es.filter(e => e.textContent === name || e.textContent.endsWith(' / ' + name)).map(e => ({ value: e.value, text: e.textContent })), member.bedName);
                if (matches.length !== 1 || matches[0].value === '-1')
                    throw Error('Selected household bed unavailable or ambiguous');
                await select.selectOption(matches[0].value);
                await ctl('ChooseUnitPopup.selectBtn').click();
                await d.waitFor({ state: 'hidden' });
                await ready();
                if (!(await row.innerText()).includes(member.bedName))
                    throw Error('Bed selection mismatch');
            }
            if (hasEntry) {
                await provider(input.providerId);
                await page.locator('select[aria-label="Type"]').selectOption({ label: 'HUD' });
                await ready();
            }
            await settleForm();
            const relationship = page.locator('select[aria-label="Relationship to Head of Household"]:visible');
            if (hasEntry && await relationship.count() !== 1)
                throw Error('Head relationship field unavailable');
            if (await relationship.count()) {
                if (await relationship.count() !== 1)
                    throw Error('Ambiguous head relationship field');
                const current = await relationship.inputValue();
                if (current !== '-Select-' && current !== 'Self (head of household)')
                    throw Error('Conflicting head relationship must be reviewed');
                await relationship.selectOption({ label: 'Self (head of household)' });
            }
            await page.locator('textarea[name="codesNotesBox"]').fill(input.marker);
            await settleForm();
            await requireAssessmentAnswers();
            await save('ShelterPointCheckIn.saveExitBtn', beforeSave);
        }
        finally {
            if (await ctl('ChooseUnitPopup.cancelBtn').count())
                await ctl('ChooseUnitPopup.cancelBtn').click();
            if (await ctl('ShelterPointCheckIn.exitBtn').count()) {
                await ctl('ShelterPointCheckIn.exitBtn').click();
                await ready();
            }
        }
    };
    const identity = async ({ stays, unitListId, marker }) => {
        const rows = await readEnrollments({ clientIds: stays.map(s => s.clientId), stayIds: stays.map(s => s.serviceId) });
        if (rows.length !== stays.length)
            throw Error('Shelter identity read incomplete');
        for (const row of rows) {
            if (!stays.some(s => s.serviceId === row.serviceId && s.clientId === row.clientId) || row.unitListId !== unitListId)
                throw Error('Shelter identity mismatch');
            id(row.bedId);
            const strings = [base, readWire.policy, 'com.bowmansystems.sp5.core.client.services.GenericService', 'getNeedService', 'I'];
            const result = await page.evaluate(async (w) => { const r = await fetch(w.url, { method: 'POST', headers: w.headers, body: w.body, credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(30000) }); return { status: r.status, body: await r.text() }; }, { url: base + 'service/UnitListService', headers: readWire.headers, body: ['7', '0', 5, ...strings, 1, 2, 3, 4, 1, 5, row.serviceId, ''].join('|') });
            if (result.status !== 200 || !result.body.startsWith('//OK[') || !result.body.includes(JSON.stringify(marker)))
                throw Error('Shelter source marker missing or changed');
        }
        return rows;
    };
    const checkout = async (input, beforeSave) => {
        if (await inventory(input) !== input.unitListName)
            throw Error('Unit list changed');
        const anchor = input.stays.find(s => s.clientId === input.clientIds[0]);
        if (!anchor)
            throw Error('Checkout target missing');
        const row = page.locator('[id^="ShelterPointMainView.shelter.checkOutImage-"]:visible').locator('xpath=ancestor::tr[1]').filter({ hasText: '(' + anchor.clientId + ')' });
        if (await row.count() !== 1 || !await row.getByText(anchor.bedName, { exact: true }).isVisible())
            throw Error('Checkout bed or client changed');
        const load = page.waitForResponse(r => r.url() === base + 'service/UnitListService' && r.request().postData()?.includes('|getNeedService|'));
        void load.catch(() => { });
        await row.locator('[title="Check Out"]').click();
        const response = await load;
        if (!response.request().postData().endsWith('|' + anchor.serviceId + '|') || response.status() !== 200 || !(await response.text()).startsWith('//OK['))
            throw Error('Checkout stay identity mismatch');
        await ctl('ShelterPointCheckOut.saveExitBtn').waitFor();
        await settleForm();
        try {
            if (!(await page.locator('body').innerText()).includes('Unit Exit Data - (' + anchor.clientId + ')'))
                throw Error('Checkout client mismatch');
            await setDate('Date Out', input.checkoutDate);
            await settleForm();
            await chooseMembers(input.clientIds, 'HouseholdsCheckboxTree.householdCheckbox.', anchor.clientId);
            for (const [field, value] of [['Destination', input.destination], ['Reason For Leaving', input.reasonForLeaving]]) {
                const select = page.locator('select[aria-label="' + field + '"]');
                if (input.mode === 'entry-exit') {
                    const matches = await select.locator('option').evaluateAll((es, label) => es.filter(e => e.textContent.replace(/\s*\(HUD\)\s*$/, '').trim() === label.replace(/\s*\(HUD\)\s*$/, '').trim()).map(e => e.value), value);
                    if (matches.length !== 1)
                        throw Error('Checkout choice unavailable or ambiguous');
                    await select.selectOption(matches[0]);
                }
                else if (await select.isVisible() && await select.inputValue() !== '-Select-')
                    throw Error('Unexpected nightly exit choices');
            }
            await settleForm();
            await requireAssessmentAnswers();
            await save('ShelterPointCheckOut.saveExitBtn', beforeSave);
        }
        finally {
            if (await ctl('ShelterPointCheckOut.exitBtn').count()) {
                await ctl('ShelterPointCheckOut.exitBtn').click();
                await ready();
            }
        }
    };
    return {connection,
        assertBedsAvailable: input => withPageLock(page, async () => {
            await inventory(input);
            for (const member of input.members) {
                const row = page.getByText(member.bedName, { exact: true }).locator('xpath=ancestor::tr[1]');
                if (await row.count() !== 1 || !await row.getByText('EMPTY', { exact: true }).isVisible() || await row.locator('[id^="ShelterPointMainView.shelter.checkInImage-"]').count() !== 1)
                    throw Error('Selected household bed unavailable');
            }
        }),
        listEnrollments: input => withPageLock(page, () => readEnrollments(input)),
        verifyStayIdentity: input => withPageLock(page, () => identity(input)),
        checkout: (input, beforeSave) => withPageLock(page, () => trackForm(() => checkout(input, beforeSave))),
        confirmNoServices: input => withPageLock(page, async () => (await readEnrollments({ clientIds: [id(input.clientId)], serviceIds: true })).length === 0),
        getUnitList: input => withPageLock(page, async () => ({ unitListId: input.unitListId, name: await inventory(input) })),
        checkIn: (input, beforeSave) => withPageLock(page, () => trackForm(() => checkIn(input, beforeSave))),
    };
}
