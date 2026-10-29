import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import * as browser from '@choiceapps/communityservices-sdk/browser';
import {WellSkyClient} from '@choiceapps/communityservices-sdk';
import {WellSkyClient as V2} from '@choiceapps/communityservices-sdk/v2';

const base = tenant => `https://wscs.wellsky.com/${tenant}/com.bowmansystems.sp5.core.ServicePoint/`;
const uiFactories = ['createCasePlanUi','createClientProfileUi','createClientWorkflows','createDateOfBirthUi','createHouseholdExitUi','createHouseholdUi','createNeedUi','createProgramDiscovery','createServiceUi','createShelterUi','createShelterInventory'];

test('browser exports contain only the current API', () => {
    assert.equal(Object.keys(browser).some(name => /training/i.test(name)), false);
    for (const name of [...uiFactories, 'openUiSession', 'openEnrollmentSession', 'createServiceRecorder', 'createCurrentLivingSituationRecorder']) assert.equal(typeof browser[name], 'function', name);
});

for (const tenant of ['tenant-a', 'tenant-b', 'another-tenant']) {
    test(`${tenant}: every UI factory binds to the actual tenant`, () => {
        const page = {url: () => base(tenant) + 'index.html', setDefaultTimeout() {}, evaluate() {}, locator() {}};
        for (const name of uiFactories) {
            const adapter = browser[name]({page, store: {}});
            assert.equal(adapter.connection.tenant, tenant, name);
            assert.equal(adapter.connection.moduleBaseUrl, base(tenant), name);
            assert.ok(Object.isFrozen(adapter.connection));
        }
    });

    for (const Client of [WellSkyClient, V2]) test(`${tenant}: REST works without environment classification in ${Client === V2 ? 'V2' : 'V3'}`, async () => {
        let calls = 0;
        const client = new Client({tenant, auth: {kind: 'token', token: 'synthetic'}, fetch: async (url, init) => {
            calls++;
            assert.equal(init.headers.get('x-tenant'), tenant);
            assert.equal(new URL(url).pathname, '/client-api-prod/clients/1');
            return new Response('[{"clientId":1}]');
        }});
        assert.equal(client.baseUrl, 'https://csclientapi.wellsky.com/client-api-prod');
        assert.deepEqual(await client.clients.get({path: {clientId: 1}}), [{clientId: 1}]);
        assert.equal(calls, 1);
    });
}

test('connection configuration validates the tenant and module path', () => {
    assert.equal(browser.resolveUiConnection({tenant: 'tenant-a'}).moduleBaseUrl, base('tenant-a'));
    const custom = browser.resolveUiConnection({tenant: 'tenant-a', moduleBaseUrl: 'https://other.invalid/tenant-a/com.bowmansystems.sp5.core.ServicePoint/'});
    assert.notEqual(custom.scope, 'tenant-a');
    for (const tenant of ['', '../tenant-a', 'tenant-a/other', 'tenant-a?x', undefined]) assert.throws(() => browser.resolveUiConnection({tenant}));
    for (const moduleBaseUrl of [base('tenant-b'), base('tenant-a') + '?x=1', base('tenant-a').replace('https:', 'http:'), base('tenant-a').replace('https://', 'https://user:pass@')]) {
        assert.throws(() => browser.resolveUiConnection({tenant: 'tenant-a', moduleBaseUrl}));
    }
});

test('a bound helper rejects another tenant before any UI operation', async () => {
    let url = base('tenant-a') + 'index.html';
    const page = {url: () => url, locator() {assert.fail('Must reject before reading the page');}};
    const discovery = browser.createProgramDiscovery({page});
    url = base('tenant-b') + 'index.html';
    await assert.rejects(discovery.listAssessments(), /Configured application page/);
});

test('REST/UI tenant mismatches fail before any journal or network access', () => {
    const page = {url: () => base('tenant-b') + 'index.html'};
    const ui = browser.createServiceUi({page});
    assert.throws(() => browser.createServiceRecorder({api: {tenant: 'tenant-a'}, ui, store: {}}), /tenants must match/);
});

test('authentication expiry follows only the configured tenant', async () => {
    const {attachAuthentication} = await import(new URL('./session-authentication.mjs', import.meta.resolve('@choiceapps/communityservices-sdk/browser')));
    const page = new EventEmitter();
    page.url = () => base('tenant-a') + 'index.html';
    page.locator = () => ({count: async () => 0});
    const auth = attachAuthentication(page, async () => {});
    page.emit('response', {url: () => base('tenant-b') + 'service/ClientService', status: () => 401});
    assert.equal(await auth.isExpired(), false);
    page.emit('response', {url: () => base('tenant-a') + 'service/ClientService', status: () => 401});
    assert.equal(await auth.isExpired(), true);
    auth.close();
});

test('independent needs require a tenant for custom adapters and keep shared journals separate', async () => {
    const journals = new Map();
    const store = {withLock: async (_scope, work) => work(), read: async scope => structuredClone(journals.get(scope) ?? []), write: async (scope, rows) => journals.set(scope, structuredClone(rows))};
    const input = {key: 'same-event', clientId: 1, providerId: 2, serviceCodeId: 3, needDate: '2026-10-28T12:00:00Z', status: 'Identified', outcome: 'Not Met'};
    const recorders = [];
    for (const tenant of ['tenant-a', 'tenant-b']) {
        const rows = [];
        const ui = {list: async () => structuredClone(rows), create: async (values, beforeSave) => {await beforeSave(); rows.push({...values, needId: 1, serviceCount: 0});}};
        assert.throws(() => browser.createNeedRecorder({ui, store}), /tenant/);
        recorders.push(browser.createNeedRecorder({tenant, ui, store}));
    }
    for (const recorder of recorders) assert.equal((await recorder.record(input)).outcome, 'verified');
    assert.equal(journals.size, 2);
    assert.deepEqual([...journals.keys()].map(key => JSON.parse(key)[0]).sort(), ['tenant-a', 'tenant-b']);
    for (const recorder of recorders) assert.equal((await recorder.record(input)).outcome, 'already-present');
});

test('composed enrollment and shelter workflows reject a GWT helper for another tenant',async()=>{
 const {GwtEnrollmentHelpers}=await import('@choiceapps/communityservices-sdk');
 const helpers=new GwtEnrollmentHelpers({tenant:'tenant-b',moduleBaseUrl:base('tenant-b'),session:{},store:{}});
 assert.equal(helpers.tenant,'tenant-b');
 assert.throws(()=>browser.createEnrollmentWorkflow({api:{tenant:'tenant-a'},helpers,store:{}}),/tenants must match/);
 assert.throws(()=>browser.createShelters({api:{tenant:'tenant-a'},enrollmentHelpers:helpers,store:{}}),/tenants must match/);
});
