import {pageConnection} from './connection.mjs';
import { withPageLock } from './page-lock.mjs';

export class ShelterInventoryError extends Error {
    constructor(reason) {
        super(`Shelter inventory unavailable: ${reason}`);
        this.name = 'ShelterInventoryError';
        this.code = 'SHELTER_INVENTORY_UNAVAILABLE';
        this.reason = reason;
    }
}
const fail = reason => { throw new ShelterInventoryError(reason); };
const positive = value => {
    if (!Number.isSafeInteger(value) || value < 1) fail('invalid-input');
    return value;
};
const count = value => {
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail('invalid-count');
    return Number(value);
};

// Serialized into the page. Read visible DOM only, never GWT state or credentials.
function readDocument() {
    const visible = e => !!e?.getClientRects().length;
    const clean = e => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const providerRows = [...document.querySelectorAll('tr')].filter(r => visible(r) && clean(r.cells[0]) === 'Provider' && r.cells.length >= 2);
    const providerLabel = providerRows.length === 1 ? providerRows[0].cells[1].innerText.split('\n').map(t => t.trim()).find(Boolean) : null;
    const lists = [...document.querySelectorAll('[id="ShelterPointMainView.unitListBox"]')].filter(visible);
    const filters = [...document.querySelectorAll('select')].filter(e => visible(e) && [...e.options].some(o => o.value === 'ALL' && clean(o) === 'All Beds'));
    const tables = [...document.querySelectorAll('table')].filter(t => visible(t) && t.rows[0] && [...t.rows[0].cells].map(clean).join('|') === '|Date In|Unit|Address|Bed|Hold|Client|Date of Birth|Sex|Group ID|Conf.|Codes/Notes');
    return {
        url: location.href,
        busy: /Processing\.\.\.|Loading\.\.\./.test(document.body.innerText),
        login: [...document.querySelectorAll('[id="formfield-password"]')].some(visible),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].filter(visible).length,
        unfinished: [...document.querySelectorAll('[id^="ShelterPointCheckIn.save"], [id^="ShelterPointCheckOut.save"]')].some(visible),
        providerLabel,
        lists: lists.length === 1 ? [...lists[0].options].map(o => ({ value: o.value, name: clean(o), disabled: o.disabled })) : null,
        selectedList: lists.length === 1 ? lists[0].value : null,
        filter: filters.length === 1 ? filters[0].value : null,
        inventory: tables.length === 1 ? [...tables[0].rows].slice(1).filter(visible).map(r => {
            const client = r.cells[6]?.querySelector('[id^="ShelterPointMainView.shelter.clientLink-"]');
            const controls = [...r.querySelectorAll('img')].filter(visible);
            return {
                cells: r.cells.length,
                dateInText: clean(r.cells[1]), unit: clean(r.cells[2]), address: clean(r.cells[3]), bed: clean(r.cells[4]),
                client: clean(client), clientTitle: client?.getAttribute('title') ?? '', group: clean(r.cells[9]),
                checkIn: controls.filter(e => e.id.startsWith('ShelterPointMainView.shelter.checkInImage-') && e.title === 'Check In').length,
                checkOut: controls.filter(e => e.id.startsWith('ShelterPointMainView.shelter.checkOutImage-') && e.title === 'Check Out').length,
            };
        }) : null,
    };
}
function readAvailabilityDocument() {
    const visible = e => !!e?.getClientRects().length;
    const clean = e => e.textContent.replace(/\s+/g, ' ').trim();
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].filter(visible);
    const d = dialogs.length === 1 ? dialogs[0] : null;
    const tables = d ? [...d.querySelectorAll('table[role="grid"]')].filter(t => t.rows[0] && [...t.rows[0].cells].map(clean).join('|') === '|Provider|Unit List|Type|Total Units|Used|Available|Overflow|Capacity') : [];
    return {
        rows: tables.length === 1 ? [...tables[0].rows].slice(1).filter(r => r.getAttribute('role') === 'row').map(r => [...r.cells].map(clean)) : null,
        ranges: d ? [...d.innerText.matchAll(/Showing (\d+)-(\d+) of (\d+)/g)].map(m => m.slice(1).map(Number)) : [],
    };
}
function providerFrom(document, providerId) {
    const m = document.providerLabel?.match(/^(.*?) \((\d+)\)$/);
    if (!m || Number(m[2]) !== providerId || !m[1]) fail('provider-mismatch');
    return { providerId, name: m[1] };
}
function listsFrom(document, providerId, maxUnitLists) {
    if (!Array.isArray(document.lists)) fail('unit-lists-unavailable');
    const lists = document.lists.filter(o => o.value !== '-1').map(o => {
        if (!/^\d+$/.test(o.value) || !o.name || o.disabled) fail('unit-list-unavailable');
        return { providerId, unitListId: positive(Number(o.value)), name: o.name };
    });
    if (lists.length > maxUnitLists) fail('unit-list-limit');
    if (new Set(lists.map(l => l.unitListId)).size !== lists.length || new Set(lists.map(l => l.name)).size !== lists.length) fail('ambiguous-unit-lists');
    return lists.sort((a, b) => a.unitListId - b.unitListId);
}
function reconcileCatalog(provider, lists, summaries) {
    if (lists.length !== summaries.length) fail('incomplete-unit-lists');
    return lists.map(list => {
        const matches = summaries.filter(s => s.providerName === provider.name && s.name === list.name);
        if (matches.length !== 1) fail('unit-list-summary-mismatch');
        return { ...list, type: matches[0].type, reported: matches[0].reported };
    });
}
function normalizeRows(rows, providerId, unitListId, maxBeds, tenantScope) {
    if (!Array.isArray(rows)) fail('inventory-unavailable');
    if (rows.length > maxBeds + 1) fail('bed-limit');
    const beds = [], overflow = [];
    let overflowEntryAvailable = false;
    for (const r of rows) {
        if (r.cells !== 12 || !r.bed) fail('unsupported-inventory-layout');
        const match = r.client.match(/^\*?\((\d+)\)\s+(.+?)\*?$/);
        let status = 'unknown', reason = 'unrecognized-row', occupant = null;
        if (match && r.checkOut === 1 && r.checkIn === 0) {
            status = 'occupied'; reason = null;
            const scheduled = r.clientTitle.match(/^Client scheduled for check out on (.+)$/);
            occupant = {
                clientId: positive(Number(match[1])), displayName: match[2], dateInText: r.dateInText || null,
                groupId: r.group ? positive(count(r.group)) : null,
                scheduledCheckout: scheduled ? { status: 'scheduled', localDateTimeText: scheduled[1] } : r.clientTitle || r.client.startsWith('*') ? { status: 'unknown' } : { status: 'not-indicated' },
            };
        } else if (r.client === 'EMPTY' && r.checkIn === 1 && r.checkOut === 0 && !r.clientTitle) {
            status = 'vacant'; reason = null;
        } else if (r.client === 'HELD' && r.checkIn === 0 && r.checkOut === 0) {
            status = 'unavailable'; reason = 'held';
        } else if (r.client === 'EMPTY') reason = 'check-in-unavailable';
        if (!r.unit && !r.address && r.bed === 'Overflow (New)') {
            if (overflowEntryAvailable || status !== 'vacant') fail('unsupported-overflow-row');
            overflowEntryAvailable = true;
            continue;
        }
        if (!r.unit && !r.address && r.bed === 'Overflow') {
            if (!occupant) fail('unsupported-overflow-row');
            overflow.push(occupant);
            continue;
        }
        const bedKey = JSON.stringify([tenantScope, providerId, unitListId, r.unit, r.address, r.bed]);
        beds.push({ bedKey, bedId: null, unit: r.unit, address: r.address, name: r.bed, status, reason, occupant });
    }
    if (beds.length > maxBeds) fail('bed-limit');
    if (new Set(beds.map(b => b.bedKey)).size !== beds.length) fail('ambiguous-bed-identity');
    const clients = [...beds.flatMap(b => b.occupant ? [b.occupant.clientId] : []), ...overflow.map(o => o.clientId)];
    if (new Set(clients).size !== clients.length) fail('duplicate-occupant');
    beds.sort((a, b) => a.bedKey < b.bedKey ? -1 : a.bedKey > b.bedKey ? 1 : 0);
    overflow.sort((a, b) => a.clientId - b.clientId);
    return { beds, overflow: { occupants: overflow, entryAvailable: overflowEntryAvailable } };
}

/** Read-only inventory. Navigates a dedicated Page; never reserves or assigns beds. */
export function createShelterInventory({ page, maxPages = 100, maxUnitLists = 1000, maxBeds = 10000, timeoutMs = 30000 }) {
    if (!page?.evaluate || !page?.locator || !page?.url) fail('page-required');
    for (const [value, ceiling] of [[maxPages, 100], [maxUnitLists, 1000], [maxBeds, 10000], [timeoutMs, 60000]]) {
        positive(value);
        if (value > ceiling) fail('invalid-input');
    }
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
    const control = name => page.locator(`[id="${name}"]:visible`);
    const guard = () => {
        const url = new URL(page.url());
        if (url.origin + url.pathname !== base + 'index.html') fail('application-page-required');
    };
    const ready = async () => {
        guard();
        await page.waitForFunction(() => !/Processing\.\.\.|Loading\.\.\./.test(document.body.innerText), null, { timeout: timeoutMs });
        guard();
    };
    const read = async () => {
        await ready();
        const document = await page.evaluate(readDocument);
        if (document.login) fail('authentication-required');
        if (document.unfinished) fail('unfinished-form');
        return document;
    };
    const selectProvider = async providerId => {
        const initial = await read();
        if (initial.dialogs) fail('unfinished-form');
        await control('navigation-link.shelterpt').click({ timeout: timeoutMs });
        await ready();
        await page.getByRole('button', { name: 'Search', exact: true }).click({ timeout: timeoutMs });
        const dialog = page.getByRole('dialog');
        await dialog.getByText(/Showing \d+-\d+ of \d+/).waitFor({ timeout: timeoutMs });
        await dialog.getByLabel('Provider ID #', { exact: true }).fill(String(providerId));
        await dialog.getByLabel('Provider ID #', { exact: true }).press('Tab');
        await dialog.getByRole('button', { name: 'Submit', exact: true }).click();
        await control(`SpProviderSearchPopup.setProvider-imageLink_${providerId}`).click({ timeout: timeoutMs });
        await dialog.waitFor({ state: 'hidden', timeout: timeoutMs });
        const document = await read();
        return { provider: providerFrom(document, providerId), lists: listsFrom(document, providerId, maxUnitLists) };
    };
    const readSummaries = async () => {
        await control('ShelterPointMainView.checkUnitAvailabilityBtn').click({ timeout: timeoutMs });
        const dialog = page.getByRole('dialog');
        try {
            await control('UnitAvailabilityPopup.exit-button').waitFor({ timeout: timeoutMs });
            const summaries = [];
            let expectedTotal, previousEnd = 0;
            for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
                await ready();
                const document = await page.evaluate(readAvailabilityDocument);
                if (!document.rows || document.ranges.length !== 1) fail('availability-unavailable');
                const [start, end, total] = document.ranges[0];
                if (![start, end, total].every(Number.isSafeInteger) || total < 0 || total > maxUnitLists) fail('unit-list-limit');
                if (expectedTotal !== undefined && total !== expectedTotal) fail('inventory-changed');
                expectedTotal = total;
                if (total === 0) {
                    if (start !== 0 || end !== 0 || document.rows.length) fail('incomplete-unit-lists');
                    return [];
                }
                if (start !== previousEnd + 1 || end < start || end > total || end - start + 1 !== document.rows.length) fail('incomplete-unit-lists');
                for (const row of document.rows) {
                    if (row.length !== 9 || !row[1] || !row[2] || !row[3]) fail('unsupported-availability-layout');
                    const reported = { totalBeds: count(row[4]), usedBeds: count(row[5]), availableBeds: count(row[6]), overflowOccupants: count(row[7]) };
                    if (reported.totalBeds !== reported.usedBeds + reported.availableBeds) fail('inconsistent-counts');
                    summaries.push({ providerName: row[1], name: row[2], type: row[3], reported });
                }
                if (new Set(summaries.map(s => JSON.stringify([s.providerName, s.name]))).size !== summaries.length) fail('ambiguous-unit-lists');
                if (end === total) return summaries;
                if (pageNumber === maxPages) fail('page-limit');
                previousEnd = end;
                await dialog.getByRole('button', { name: 'Next', exact: true }).click({ timeout: timeoutMs });
                await page.waitForFunction(oldEnd => {
                    const d = [...document.querySelectorAll('[role="dialog"]')].find(e => e.getClientRects().length);
                    const m = d?.innerText.match(/Showing (\d+)-(\d+) of (\d+)/);
                    return m && Number(m[1]) === oldEnd + 1;
                }, end, { timeout: timeoutMs });
            }
            fail('page-limit');
        } finally {
            if (await control('UnitAvailabilityPopup.exit-button').count()) {
                await control('UnitAvailabilityPopup.exit-button').click();
                await dialog.waitFor({ state: 'hidden', timeout: timeoutMs });
            }
        }
    };
    const run = work => withPageLock(page, async () => {
        try { return await work(); }
        catch (error) { if (error instanceof ShelterInventoryError) throw error; fail('read-failed'); }
    });
    const freshness = (startedAt, observedAt) => ({ startedAt, observedAt, completedAt: new Date().toISOString(), sourceUpdatedAt: null, atomic: false });
    const limits = { maxPages, maxUnitLists, maxBeds };
    return {connection,
        listUnitLists(input) {
            if (!input || Object.keys(input).some(k => k !== 'providerId')) fail('invalid-input');
            const providerId = positive(input.providerId);
            return run(async () => {
                const startedAt = new Date().toISOString();
                const { provider, lists } = await selectProvider(providerId);
                const unitLists = reconcileCatalog(provider, lists, await readSummaries());
                const document = await read();
                providerFrom(document, providerId);
                if (JSON.stringify(listsFrom(document, providerId, maxUnitLists)) !== JSON.stringify(lists)) fail('inventory-changed');
                return { provider, unitLists, source: 'ui', completeness: 'complete-visible-provider', freshness: freshness(startedAt, new Date().toISOString()), limits };
            });
        },
        getInventory(input) {
            if (!input || Object.keys(input).some(k => !['providerId', 'unitListId'].includes(k))) fail('invalid-input');
            const providerId = positive(input.providerId), unitListId = positive(input.unitListId);
            return run(async () => {
                const startedAt = new Date().toISOString();
                const { provider, lists } = await selectProvider(providerId);
                const catalog = reconcileCatalog(provider, lists, await readSummaries());
                const unitList = catalog.find(l => l.unitListId === unitListId);
                if (!unitList) fail('unit-list-unavailable');
                if (unitList.reported.totalBeds + unitList.reported.overflowOccupants > maxBeds) fail('bed-limit');
                await control('ShelterPointMainView.unitListBox').selectOption(String(unitListId));
                await control('ShelterPointMainView.selectUnitListBtn').click();
                await page.getByText('View All', { exact: true }).click({ timeout: timeoutMs });
                await control('ShelterPointMainView.transmitTodaysCheckOutBtn').waitFor({ timeout: timeoutMs });
                const display = page.locator('select:visible').filter({ has: page.locator('option[value="ALL"]', { hasText: 'All Beds' }) });
                await display.selectOption('ALL', { timeout: timeoutMs });
                const document = await read();
                providerFrom(document, providerId);
                if (document.selectedList !== String(unitListId) || document.filter !== 'ALL' || document.dialogs) fail('inventory-context-mismatch');
                const observedAt = new Date().toISOString();
                const { beds, overflow } = normalizeRows(document.inventory, providerId, unitListId, maxBeds, connection.scope);
                const after = reconcileCatalog(provider, lists, await readSummaries()).find(l => l.unitListId === unitListId);
                if (JSON.stringify(after) !== JSON.stringify(unitList)) fail('inventory-changed');
                const final = await read();
                providerFrom(final, providerId);
                if (final.dialogs || final.selectedList !== String(unitListId) || final.filter !== 'ALL' || JSON.stringify(listsFrom(final, providerId, maxUnitLists)) !== JSON.stringify(lists) || JSON.stringify(final.inventory) !== JSON.stringify(document.inventory)) fail('inventory-changed');
                if (beds.length !== unitList.reported.totalBeds || overflow.occupants.length !== unitList.reported.overflowOccupants) fail('incomplete-inventory');
                const counts = { total: beds.length, occupied: 0, vacant: 0, unavailable: 0, unknown: 0 };
                for (const bed of beds) counts[bed.status]++;
                if (!counts.unknown && (counts.vacant !== unitList.reported.availableBeds || counts.occupied + counts.unavailable !== unitList.reported.usedBeds)) fail('inventory-changed');
                const availability = counts.unknown ? { status: 'unknown', vacantCount: null, vacantBedKeys: [], reasons: ['unclassified-beds'] } : { status: 'known', vacantCount: counts.vacant, vacantBedKeys: beds.filter(b => b.status === 'vacant').map(b => b.bedKey) };
                return { provider, unitList, source: 'ui', completeness: 'complete-visible-unit-list', freshness: freshness(startedAt, observedAt), limits, beds, counts, overflow, availability };
            });
        },
    };
}
