const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createShelterInventory, createShelterUi, ShelterInventoryError } from '@choiceapps/communityservices-sdk/browser';

const base = ('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html').replaceAll('tenant-b', testTenant);
const browserTest = { skip: !process.env.WELLSKY_TEST_CHROME };
const headers = ['', 'Date In', 'Unit', 'Address', 'Bed', 'Hold', 'Client', 'Date of Birth', 'Sex', 'Group ID', 'Conf.', 'Codes/Notes'];
const summaryHeaders = ['', 'Provider', 'Unit List', 'Type', 'Total Units', 'Used', 'Available', 'Overflow', 'Capacity'];
const occupied = (clientId, name, scheduled = false) => ({ name, client: `${scheduled ? '*' : ''}(${clientId}) Synthetic${scheduled ? '*' : ''}`, action: 'checkOut', title: scheduled ? 'Client scheduled for check out on 10/25/2026, 8:00:00 AM' : '' });
const empty = name => ({ name, client: 'EMPTY', action: 'checkIn' });
const defaults = [occupied(1, 'Bed 1'), occupied(2, 'Bed 2', true), empty('Bed 3'), { name: 'Bed 4', client: 'HELD' }, { ...occupied(3, 'Overflow'), unit: '', address: '' }, { ...empty('Overflow (New)'), unit: '', address: '' }];
function fixtureHtml({ rows = defaults, reported = [4, 3, 1, 1], secondReported = reported, unitLists = [{ id: 20, name: 'Synthetic Beds' }], pageSize = 10, badProvider = false, filter = 'FULL', noSummary = false, noTable = false, repeatPage = false } = {}) {
    const bedRows = rows.map((r, i) => {
        const action = r.action ? `<img id="ShelterPointMainView.shelter.${r.action}Image-${i + 1}" title="${r.action === 'checkIn' ? 'Check In' : 'Check Out'}">` : '';
        const cells = [action, r.action === 'checkOut' ? '10/24/2026' : '', r.unit ?? 'Unit A', r.address ?? 'Example address', r.name, r.client === 'EMPTY' ? 'Hold' : '', `<div id="ShelterPointMainView.shelter.clientLink-${i + 1}" title="${r.title ?? ''}">${r.client}</div>`, '', '', '', '', ''];
        return '<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>';
    }).join('');
    return `<button id="navigation-link.shelterpt" onclick="document.getElementById('inventory').hidden=true">Shelters</button>
      <table><tr><td>Provider</td><td><div>${badProvider ? 'Wrong (11)' : 'Synthetic Provider (10)'}</div><button onclick="document.getElementById('provider').hidden=false">Search</button></td></tr></table>
      <div role="dialog" id="provider" hidden>Showing 1-1 of 1<input aria-label="Provider ID #"><button>Submit</button><button id="SpProviderSearchPopup.setProvider-imageLink_10" onclick="this.parentElement.hidden=true">Choose</button></div>
      <select id="ShelterPointMainView.unitListBox"><option value="-1">-Select-</option>${unitLists.map(l => `<option value="${l.id}">${l.name}</option>`).join('')}</select>
      <button id="ShelterPointMainView.selectUnitListBtn">Submit</button>
      <button onclick="document.getElementById('inventory').hidden=false">View All</button>
      <button id="ShelterPointMainView.transmitTodaysCheckOutBtn">Transmit</button>
      <button id="ShelterPointMainView.checkUnitAvailabilityBtn" onclick="openSummary()">Check Unit Availability</button>
      <div id="inventory" hidden><select id="display"><option value="ALL">All Beds</option><option value="EMPTY">Empty Beds</option><option value="FULL">Full Beds</option></select>
      ${noTable ? '' : `<table><tr>${headers.map(h => `<td>${h}</td>`).join('')}</tr>${bedRows}</table>`}</div>
      <div role="dialog" id="availability" hidden><div id="summary"></div><button id="next" onclick="${repeatPage ? '' : 'offset+=' + pageSize + ';renderSummary()'}">Next</button><button id="UnitAvailabilityPopup.exit-button" onclick="this.parentElement.hidden=true">Exit</button></div>
      <script>
      document.getElementById('display').value=${JSON.stringify(filter)};
      const lists=${JSON.stringify(unitLists)}, initial=${JSON.stringify(reported)}, later=${JSON.stringify(secondReported)};
      let reads=0,offset=0;
      function openSummary(){reads++;offset=0;document.getElementById('availability').hidden=false;renderSummary()}
      function renderSummary(){const visible=lists.slice(offset,offset+${pageSize});const stats=reads>1?later:initial;
        document.getElementById('summary').innerHTML=${noSummary ? "'unavailable'" : `'<table role="grid"><tr>${summaryHeaders.map(h => `<td>${h}</td>`).join('')}</tr>'+visible.map(l=>'<tr role="row">'+['','Synthetic Provider',l.name,'TH - Single',...stats,'75%'].map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</table><div>Showing '+(lists.length?offset+1:0)+'-'+(offset+visible.length)+' of '+lists.length+'</div>'`};
        document.getElementById('next').hidden=offset+visible.length===lists.length;
      }
      </script>`;
}
async function browserFixture(options, work) {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.WELLSKY_TEST_CHROME, headless: true });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        const requests = [];
        await page.route('**/*', route => { requests.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: fixtureHtml(options) }); });
        await page.goto(base);
        await work(page, requests);
        assert.equal(requests.length, 1, 'Only synthetic document loaded; no mutation or external request');
    } finally { await browser.close(); }
}
const reader = (page, options = {}) => createShelterInventory({ page, timeoutMs: 3000, ...options });
const target = { providerId: 10, unitListId: 20 };
const reason = expected => error => error instanceof ShelterInventoryError && error.code === 'SHELTER_INVENTORY_UNAVAILABLE' && error.reason === expected;

test('inventory rejects invalid limits and target input before navigation', () => {
    const page = { evaluate() {}, locator() {}, url() {return base;} };
    for (const options of [{ maxBeds: 0 }, { maxPages: 101 }, { maxUnitLists: 1001 }, { timeoutMs: Infinity }]) assert.throws(() => reader(page, options), reason('invalid-input'));
    assert.throws(() => reader(page).getInventory({ ...target, asOf: 'tomorrow' }), reason('invalid-input'));
    assert.throws(() => reader(page).listUnitLists({ providerId: '10' }), reason('invalid-input'));
});
test('public inventory reader discovers lists and reports named beds, holds, overflow and future checkout', browserTest, async () => {
    await browserFixture({}, async page => {
        const api = reader(page);
        const catalog = await api.listUnitLists({ providerId: 10 });
        assert.deepEqual(catalog.unitLists, [{ ...target, name: 'Synthetic Beds', type: 'TH - Single', reported: { totalBeds: 4, usedBeds: 3, availableBeds: 1, overflowOccupants: 1 } }]);
        const snapshot = await api.getInventory(target);
        assert.deepEqual(snapshot.counts, { total: 4, occupied: 2, vacant: 1, unavailable: 1, unknown: 0 });
        assert.equal(snapshot.completeness, 'complete-visible-unit-list');
        assert.equal(snapshot.availability.status, 'known');
        assert.equal(snapshot.availability.vacantCount, 1);
        assert.equal(snapshot.beds[1].occupant.scheduledCheckout.localDateTimeText, '10/25/2026, 8:00:00 AM');
        assert.equal(snapshot.beds[1].occupant.displayName, 'Synthetic');
        assert.equal(snapshot.beds[1].status, 'occupied');
        assert.equal(snapshot.beds[3].reason, 'held');
        assert.deepEqual(snapshot.overflow.occupants.map(o => o.clientId), [3]);
        assert.equal(snapshot.overflow.entryAvailable, true);
        assert.ok(snapshot.beds.every(b => b.bedId === null));
        assert.deepEqual(JSON.parse(snapshot.beds[0].bedKey), [testTenant, 10, 20, 'Unit A', 'Example address', 'Bed 1']);
        assert.equal(snapshot.freshness.atomic, false);
        assert.equal(snapshot.freshness.sourceUpdatedAt, null);
        assert.ok(snapshot.freshness.startedAt <= snapshot.freshness.observedAt && snapshot.freshness.observedAt <= snapshot.freshness.completedAt);
        assert.equal(await page.locator('#display').inputValue(), 'ALL');
    });
});
test('bed keys survive row reordering and occupancy changes', browserTest, async () => {
    let keys;
    await browserFixture({}, async page => { keys = (await reader(page).getInventory(target)).beds.map(b => b.bedKey); });
    const rows = [empty('Bed 4'), empty('Bed 2'), occupied(9, 'Bed 3'), empty('Bed 1')];
    await browserFixture({ rows, reported: [4, 1, 3, 0] }, async page => assert.deepEqual((await reader(page).getInventory(target)).beds.map(b => b.bedKey), keys));
});
test('unit discovery reads every counted page and enforces page limits', browserTest, async () => {
    const options = { unitLists: [{ id: 20, name: 'A' }, { id: 21, name: 'B' }, { id: 22, name: 'C' }], pageSize: 1 };
    await browserFixture(options, async page => assert.deepEqual((await reader(page).listUnitLists({ providerId: 10 })).unitLists.map(l => l.unitListId), [20, 21, 22]));
    await browserFixture(options, async page => assert.rejects(reader(page, { maxPages: 2 }).listUnitLists({ providerId: 10 }), reason('page-limit')));
});
test('counted zero lists is empty; an unreadable availability view is not', browserTest, async () => {
    await browserFixture({ unitLists: [] }, async page => assert.deepEqual((await reader(page).listUnitLists({ providerId: 10 })).unitLists, []));
    await browserFixture({ noSummary: true }, async page => assert.rejects(reader(page).listUnitLists({ providerId: 10 }), reason('availability-unavailable')));
});
test('unknown rows suppress an authoritative vacancy count', browserTest, async () => {
    await browserFixture({ rows: [empty('Bed 1'), { name: 'Bed 2', client: 'EMPTY' }], reported: [2, 0, 2, 0] }, async page => {
        const result = await reader(page).getInventory(target);
        assert.equal(result.counts.unknown, 1);
        assert.equal(result.beds[1].reason, 'check-in-unavailable');
        assert.deepEqual(result.availability, { status: 'unknown', vacantCount: null, vacantBedKeys: [], reasons: ['unclassified-beds'] });
    });
});
test('incomplete bed tables and count changes never produce complete snapshots', browserTest, async () => {
    await browserFixture({ reported: [5, 3, 2, 1] }, async page => assert.rejects(reader(page).getInventory(target), reason('incomplete-inventory')));
    await browserFixture({ secondReported: [4, 4, 0, 1] }, async page => assert.rejects(reader(page).getInventory(target), reason('inventory-changed')));
});
test('duplicate bed paths and duplicate occupants reject ambiguous inventory', browserTest, async () => {
    await browserFixture({ rows: [empty('Bed 1'), empty('Bed 1')], reported: [2, 0, 2, 0] }, async page => assert.rejects(reader(page).getInventory(target), reason('ambiguous-bed-identity')));
    await browserFixture({ rows: [occupied(1, 'Bed 1'), occupied(1, 'Bed 2')], reported: [2, 2, 0, 0] }, async page => assert.rejects(reader(page).getInventory(target), reason('duplicate-occupant')));
});
test('provider mismatch, missing lists and unsupported inventory layout fail closed', browserTest, async () => {
    await browserFixture({ badProvider: true }, async page => assert.rejects(reader(page).getInventory(target), reason('provider-mismatch')));
    await browserFixture({}, async page => assert.rejects(reader(page).getInventory({ ...target, unitListId: 999 }), reason('unit-list-unavailable')));
    await browserFixture({ noTable: true }, async page => assert.rejects(reader(page).getInventory(target), reason('inventory-unavailable')));
});
test('reader refuses login screens, unfinished forms and pages outside the bound tenant before navigation', browserTest, async () => {
    for (const [html, expected] of [['<input id="formfield-password">', 'authentication-required'], ['<button id="ShelterPointCheckIn.saveExitBtn">Save</button>', 'unfinished-form'], ['<div role="dialog">Unfinished</div>', 'unfinished-form']]) {
        await browserFixture({}, async page => { await page.setContent(html); await assert.rejects(reader(page).getInventory(target), reason(expected)); assert.equal(await page.content().then(x => x.includes(html)), true); });
    }
    await browserFixture({}, async page => { const inventory=reader(page); await page.setContent('<main>untouched</main>'); await page.evaluate(() => history.replaceState(null, '', '/production/index.html')); await assert.rejects(inventory.getInventory(target), reason('application-page-required')); });
});
test('bed limits, inconsistent summaries and repeated pages return sanitized errors', browserTest, async () => {
    await browserFixture({}, async page => assert.rejects(reader(page, { maxBeds: 2 }).getInventory(target), reason('bed-limit')));
    await browserFixture({ reported: [4, 3, 99, 1] }, async page => assert.rejects(reader(page).getInventory(target), reason('inconsistent-counts')));
    await browserFixture({ unitLists: [{ id: 20, name: 'A' }, { id: 21, name: 'B' }], pageSize: 1, repeatPage: true }, async page => {
        await assert.rejects(reader(page).listUnitLists({ providerId: 10 }), error => reason('read-failed')(error) && !error.message.includes('Synthetic'));
        assert.equal(await page.getByRole('dialog').count(), 0);
        assert.equal(await page.locator('#availability').isVisible(), false);
    });
});
test('existing mutation adapter clears a persisted inventory display filter', browserTest, async () => {
    await browserFixture({}, async page => {
        assert.equal((await createShelterUi({ page }).getUnitList(target)).unitListId, 20);
        assert.equal(await page.locator('#display').inputValue(), 'ALL');
    });
});

test('a counted zero-bed list has a known zero vacancy without inventing overflow capacity', browserTest, async () => {
    await browserFixture({ rows: [], reported: [0, 0, 0, 0] }, async page => {
        const result = await reader(page).getInventory(target);
        assert.deepEqual(result.beds, []);
        assert.deepEqual(result.availability, { status: 'known', vacantCount: 0, vacantBedKeys: [] });
        assert.equal(result.overflow.entryAvailable, false);
    });
});
test('unrecognized statuses and conflicting controls never become vacant', browserTest, async () => {
    await browserFixture({ rows: [{ name: 'Bed 1', client: 'RESERVED', action: 'checkIn' }], reported: [1, 1, 0, 0] }, async page => {
        const result = await reader(page).getInventory(target);
        assert.equal(result.beds[0].status, 'unknown');
        assert.equal(result.availability.status, 'unknown');
    });
    await browserFixture({ rows: [{ ...empty('Bed 1'), title: 'Unrecognized restriction' }], reported: [1, 0, 1, 0] }, async page => assert.equal((await reader(page).getInventory(target)).availability.status, 'unknown'));
});
test('duplicate unit-list labels fail instead of guessing which counted row matches', browserTest, async () => {
    await browserFixture({ unitLists: [{ id: 20, name: 'Same name' }, { id: 21, name: 'Same name' }] }, async page => assert.rejects(reader(page).listUnitLists({ providerId: 10 }), reason('ambiguous-unit-lists')));
});
