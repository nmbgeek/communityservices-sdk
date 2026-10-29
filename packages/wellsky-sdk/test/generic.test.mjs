import test from 'node:test';
import assert from 'node:assert/strict';
import { WellSkyClient, createFakeWellSkyClient, buildAssessmentDefinition, compareDefinition, encodeAnswers, encodeNewSubassessmentRow, semanticHash, verifyWrite, readOutcome, mapBulk, WellSkyError } from '../dist/esm/index.js';
import { WellSkyClient as V2Client } from '../dist/esm/v2.js';

const config = { tenant: 'synthetic', auth: { kind: 'none' }, maxReadRetries: 0 };
const context = { clientId: 123, assessmentCode: 'SYNTHETIC_INSTRUMENT' };
const option = { picklist_value_id: 11, picklist_id: 10, code: 'ANSWER_YES', name: 'Yes ', picklist_code: 'SYNTHETIC', disp_order: 1 };
const mobile = [
  { question_id: 1, virt_field_name: 'CHOICE', question_type: 'lookup', picklist_id: 10, mandatory_flag: null, picklist_value_list: [option], answer_value: 'PRIVATE ANSWER', client_id: 123 },
  { question_id: 2, virt_field_name: 'ROWS', question_type: 'sub_assessment', sub_assessment_question_list: [
    { question_id: 3, virt_field_name: 'START', question_type: 'date' },
    { question_id: 4, virt_field_name: 'END', question_type: 'date' },
    { question_id: 5, virt_field_name: 'CONFIRMED', question_type: 'yes_no' },
  ], sub_assessment_answer_list: [{ recordset_id: 42, sub_assessment_list: [
    { question_id: 3, virt_field_name: 'START', question_type: 'date', answer_value: '2026-10-20T12:00:00-04:00' },
    { question_id: 4, virt_field_name: 'END', question_type: 'date', answer_value: null },
    { question_id: 5, virt_field_name: 'CONFIRMED', question_type: 'yes_no', answer_value: 'Yes' },
  ] }] },
];
const generic = [{ question_id: 1, virt_field_name: 'CHOICE', question_type: 'lookup', picklist_id: 10, mandatory_flag: true }];
const definition = () => buildAssessmentDefinition({ tenant: 'synthetic', assessmentCode: context.assessmentCode, mobile, generic });

test('metadata combines mandatory flags, nested questions, and options without client answers', () => {
  const def = definition();
  assert.equal(def.questions[0].mandatory, true);
  assert.equal(def.questions[1].children.length, 3);
  assert.equal(def.questions[0].options[0].code, 'ANSWER_YES');
  const serialized = JSON.stringify(def);
  for (const forbidden of ['PRIVATE ANSWER', 'answer_value', 'client_id', 'recordset_id']) assert.equal(serialized.includes(forbidden), false);
  assert.equal(def.picklistEffectiveDate, 'current');
});

test('metadata cache is bounded by context and returns independent copies', async () => {
  const client = createFakeWellSkyClient();
  client.fake.set('GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}', { kind: 'reply', body: mobile });
  client.fake.set('GET /assessments/{clientId}/{assessmentCode}', { kind: 'reply', body: generic });
  const first = await client.assessments.getDefinition({ ...context, effectiveDate: '2026-10-20' });
  first.questions[0].options.length = 0;
  const second = await client.assessments.getDefinition({ ...context, effectiveDate: '2026-10-20' });
  assert.equal(second.questions[0].options.length, 1);
  assert.equal(client.fake.calls.length, 2);
  assert.equal((await client.questions.get({ ...context, effectiveDate: '2026-10-20', fieldName: 'END', parentPath: ['ROWS'] })).questionId, 4);
  assert.equal((await client.picklists.resolve({ ...context, effectiveDate: '2026-10-20', fieldName: 'CHOICE', code: 'ANSWER_YES' })).id, 11);
  await client.assessments.getDefinition({ ...context, effectiveDate: '2026-10-21' });
  assert.equal(client.fake.calls.length, 4);
  client.clearMetadataCache();
  await client.assessments.getDefinition(context);
  assert.equal(client.fake.calls.length, 6);
});

test('conflicting metadata fails closed; unknown options never disappear silently', async () => {
  assert.throws(() => buildAssessmentDefinition({ tenant: 'synthetic', assessmentCode: 'X', mobile, generic: [{ ...generic[0], question_type: 'date' }] }), e => e.name === 'DefinitionDriftError');
  const client = createFakeWellSkyClient();
  client.fake.set('GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}', { kind: 'reply', body: mobile });
  client.fake.set('GET /assessments/{clientId}/{assessmentCode}', { kind: 'reply', body: generic });
  await assert.rejects(client.picklists.resolve({ ...context, fieldName: 'CHOICE', code: 'PRIVATE_UNKNOWN' }), e => e.name === 'UnknownPicklistValueError' && !JSON.stringify(e).includes('PRIVATE_UNKNOWN'));
});

test('drift distinguishes added fields, removals, changed types, and mandatory changes', () => {
  const report = compareDefinition({ questions: [{ path: ['CHOICE'], questionType: 'date', mandatory: false }, { path: ['GONE'], questionType: 'textbox' }] }, definition());
  assert.equal(report.breaking, true);
  assert.deepEqual(report.removed, ['GONE']);
  assert.deepEqual(report.retyped, ['CHOICE']);
  assert.deepEqual(report.newlyMandatory, ['CHOICE']);
});

test('encoding distinguishes mobile IDs and verified labels; refusals are never No', () => {
  const def = definition();
  assert.equal(encodeAnswers(def.questions, { CHOICE: { option: { code: 'ANSWER_YES' } } }, { endpoint: 'mobile' })[0].answer_value, '11');
  assert.throws(() => encodeAnswers(def.questions, { CHOICE: { option: { code: 'ANSWER_YES' } } }, { endpoint: 'enrollment' }), e => e.name === 'ValidationError');
  assert.equal(encodeAnswers(def.questions, { CHOICE: { option: { code: 'ANSWER_YES' } } }, { endpoint: 'enrollment', writeLabel: () => 'Yes (HUD)' })[0].answer_value, 'Yes (HUD)');
  assert.deepEqual(encodeAnswers(def.questions[1].children, { CONFIRMED: { state: 'client_refused' } }, { endpoint: 'enrollment' }), []);
  assert.throws(() => encodeAnswers(def.questions, { MISSING: { value: 'private' } }, { endpoint: 'enrollment' }), e => e.fields.includes('MISSING'));
  const row = encodeNewSubassessmentRow(def.questions[1], { START: { value: '2026-10-20' } }, { endpoint: 'enrollment' });
  assert.equal(row.subAssessments.some(q => q.virt_field_name === 'CONFIRMED'), false);
  assert.equal(row.subAssessments.find(q => q.virt_field_name === 'END').answer_value, '');
});

test('tenant configuration is sufficient and cannot be reassigned', () => {
  assert.doesNotThrow(() => new WellSkyClient({ tenant: 'synthetic', auth: { kind: 'none' } }));
  const client = new WellSkyClient({ ...config, });
  assert.equal(client.tenant, 'synthetic');
  assert.throws(() => { client.tenant = 'different'; });
});

test('tenant mismatches in JWTs, response headers, and envelopes fail closed', async () => {
  const token = `e30.${Buffer.from(JSON.stringify({ tenant: 'other', exp: 4e9 })).toString('base64url')}.sig`;
  assert.throws(() => new WellSkyClient({ ...config, auth: { kind: 'token', token } }), e => e.name === 'TenantMismatchError');
  for (const response of [new Response('[]', { headers: { 'x-tenant': 'other' } }), new Response('{"tenant":"other","value":[]}')]) {
    const client = new WellSkyClient({ ...config, fetch: async () => response });
    await assert.rejects(client.clients.list(), e => e.name === 'TenantMismatchError');
  }
});

test('concurrency is shared across clients with the same tenant and transport', async () => {
  let active = 0, maximum = 0;
  const fetch = async () => { active++; maximum = Math.max(active, maximum); await new Promise(r => setTimeout(r, 10)); active--; return new Response('[]'); };
  const first = new WellSkyClient({ ...config, fetch, maxConcurrency: 2 });
  const second = new WellSkyClient({ ...config, fetch, maxConcurrency: 2 });
  await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? first : second).clients.list()));
  assert.equal(maximum, 2);
  assert.equal(first.health().activeRequests, 0);
});

test('token minting is single-flight across client instances', async () => {
  let mints = 0;
  const token = `e30.${Buffer.from(JSON.stringify({ tenant: 'synthetic', exp: 4e9 })).toString('base64url')}.sig`;
  const fetch = async url => String(url).endsWith('/SetAuthKey') ? (mints++, new Response(JSON.stringify({ token }))) : new Response('[]');
  const auth = { kind: 'credentials', username: 'synthetic', password: 'synthetic-secret' };
  const a = new WellSkyClient({ ...config, fetch, auth });
  const b = new V2Client({ ...config, fetch, auth });
  await Promise.all([a.clients.list(), b.clients.list(), a.clients.list()]);
  assert.equal(mints, 1);
  assert.equal(a.health().tokenMintCount, 1);
});

test('cooldown is shared and blocks requests until it expires', async () => {
  let calls = 0;
  const events = [];
  const fetch = async () => { calls++; return new Response('[]', { status: calls <= 2 ? 503 : 200 }); };
  const opts = { ...config, fetch, cooldown: { threshold: 2, windowMs: 1000, durationMs: 30 }, hooks: { onCooldown: e => events.push(e) } };
  const a = new WellSkyClient(opts), b = new WellSkyClient(opts);
  await assert.rejects(a.clients.list()); await assert.rejects(b.clients.list());
  await assert.rejects(a.clients.list(), e => e.name === 'CooldownError' && Boolean(e.until));
  assert.equal(calls, 2); assert.equal(b.health().state, 'open'); assert.equal(events.length, 1);
  await new Promise(r => setTimeout(r, 40));
  assert.deepEqual(await b.clients.list(), []);
});

test('hooks contain correlation and templates without filters, bodies, tokens, or names', async () => {
  const events = [];
  const client = new WellSkyClient({ ...config, logger: event => events.push(event), hooks: { onResponse: () => { throw new Error('observer failure'); } }, fetch: async (_url, init) => { assert.equal(init.headers.get('x-correlation-id'), 'job-123'); return new Response('[]'); } });
  await client.clients.list({ correlationId: 'job-123', query: { '$filter': "firstName eq 'PrivateName'" } });
  assert.equal(events.length, 2);
  assert.equal(JSON.stringify(events).includes('PrivateName'), false);
  assert.equal(events[0].operation, 'GET /clients');
});

test('semantic hashes are stable by object key order but include targets and array order', async () => {
  assert.equal(await semanticHash({ a: 1, b: 2 }), await semanticHash({ b: 2, a: 1 }));
  assert.notEqual(await semanticHash({ ids: [1, 2] }), await semanticHash({ ids: [2, 1] }));
  await assert.rejects(semanticHash({ a: undefined }));
});

test('a commit followed by HTTP 400 is verified by read-back, with no write replay', async () => {
  let writes = 0;
  const result = await verifyWrite({ operation: 'POST /synthetic', readEndpoint: 'GET /synthetic/{id}', semanticPayload: { id: 1, value: 'private' }, expectedFields: { value: 'private' }, submit: async () => { writes++; throw new WellSkyError('http', 'POST /synthetic', { status: 400 }); }, readBack: async () => ({ kind: 'found', value: { data: { id: 1 }, ids: { id: 1 }, fields: { value: 'private' } } }) });
  assert.equal(result.status, 'verified'); assert.equal(result.attempt.httpStatus, 400); assert.equal(writes, 1);
  assert.equal(JSON.stringify(result.evidence).includes('private'), false);
});

test('failed reads and simple absence cannot prove a rollback; mismatches are redacted', async () => {
  const base = { operation: 'POST /synthetic', readEndpoint: 'GET /synthetic/{id}', semanticPayload: { id: 1 }, expectedFields: { name: 'private expected' }, submit: async () => ({}) };
  for (const outcome of [{ kind: 'absent' }, { kind: 'unknown', error: new WellSkyError('http', 'GET /synthetic/{id}', { status: 400 }) }]) {
    const result = await verifyWrite({ ...base, readBack: async () => outcome }); assert.equal(result.status, 'unverified'); assert.equal(result.committed, 'unknown');
  }
  const mismatch = await verifyWrite({ ...base, readBack: async () => ({ kind: 'found', value: { data: { id: 1 }, ids: { id: 1 }, fields: { name: 'private actual' }, commitConfirmed: true } }) });
  assert.equal(mismatch.committed, true); assert.equal(mismatch.status, 'unverified');
  assert.equal(JSON.stringify(mismatch).includes('private'), false);
  const unknown = await readOutcome(async () => { throw new WellSkyError('http', 'GET /x', { status: 404 }); }, { operation: 'GET /x' });
  assert.equal(unknown.kind, 'unknown');
});

test('preflight failures do not submit; verify-only mode does not submit', async () => {
  let writes = 0;
  const base = { operation: 'POST /x', readEndpoint: 'GET /x', semanticPayload: { id: 1 }, expectedFields: { id: 1 }, submit: async () => { writes++; }, readBack: async () => ({ kind: 'found', value: { data: { id: 1 }, ids: { id: 1 }, fields: { id: 1 } } }) };
  assert.equal((await verifyWrite({ ...base, preflight: async () => { throw new Error('private'); } })).status, 'failed');
  assert.equal((await verifyWrite({ ...base, mode: 'verify-only' })).status, 'verified');
  assert.equal(writes, 0);
});

test('fake commit-then-error updates state and returns a failed HTTP response', async () => {
  const client = createFakeWellSkyClient();
  client.fake.enqueue('POST /clients/create', { kind: 'commit-then-error', status: 400, commit: () => client.fake.state.set('created', true) });
  await assert.rejects(client.clients.create({ body: { firstName: 'Synthetic', lastName: 'Example' } }), e => e.status === 400);
  assert.equal(client.fake.state.get('created'), true); assert.equal(client.fake.calls.length, 1);
});

test('bulk preserves input order, limits workers, and records independent failures', async () => {
  let active = 0, max = 0;
  const report = await mapBulk([1, 2, 3, 4], async value => { active++; max = Math.max(max, active); await new Promise(r => setTimeout(r, 5)); active--; if (value === 2) throw new Error('private'); return value * 2; }, { concurrency: 2 });
  assert.equal(max, 2); assert.deepEqual(report.results.map(r => r.index), [0, 1, 2, 3]);
  assert.equal(report.results[1].outcome, 'rejected'); assert.equal(report.results[3].value, 8);
});

test('bulk callback failure stops scheduling but preserves completed writes', async () => {
  let calls = 0;
  const report = await mapBulk([1, 2, 3], async value => { calls++; return value; }, { concurrency: 1, onResult: async () => { throw new Error('database unavailable'); } });
  assert.equal(calls, 1); assert.equal(report.results[0].outcome, 'fulfilled'); assert.equal(report.results[1].outcome, 'skipped'); assert.equal(report.callbackErrors.length, 1);
});

test('bulk cancellation skips unstarted items and empty inputs are total', async () => {
  const controller = new AbortController();
  const report = await mapBulk([1, 2, 3], async value => { controller.abort(); return value; }, { concurrency: 1, signal: controller.signal });
  assert.equal(report.results[0].outcome, 'fulfilled'); assert.equal(report.results[1].reason, 'cancelled');
  assert.deepEqual(await mapBulk([], async () => null), { results: [], callbackErrors: [] });
});

test('typed client bulk dispatches writes at most once per item', async () => {
  const client = createFakeWellSkyClient();
  client.fake.set('POST /clients/create', { kind: 'reply', status: 500 });
  const results = await client.bulk('POST /clients/create', [1, 2, 3].map(i => ({ body: { firstName: 'Synthetic', lastName: String(i) } })), { concurrency: 2 });
  assert.equal(client.fake.calls.length, 3); assert.ok(results.results.every(r => r.outcome === 'rejected'));
});

test('generic end-date update keeps the recordset and verifies every returned field', async () => {
  const client = createFakeWellSkyClient();
  const state = structuredClone(mobile);
  client.fake.set('GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}', { kind: 'handler', handle: () => ({ body: state }) });
  client.fake.set('POST /assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}', { kind: 'handler', handle: request => {
    const write = request.body[0].subAssessmentQuestionAnswers[0];
    assert.equal(write.recordset_id, 42); assert.equal(write.isDeleted, false);
    state[1].sub_assessment_answer_list[0].sub_assessment_list.find(q => q.virt_field_name === 'END').answer_value = write.subAssessments.find(q => q.virt_field_name === 'END').answer_value;
    return { status: 400 }; // Deliberately reproduce partial-commit semantics.
  } });
  const result = await client.subassessments.setEndDate({ ...context, parentField: 'ROWS', recordsetId: 42, endDateField: 'END', endDate: '2026-10-21' });
  assert.equal(result.status, 'verified'); assert.equal(result.data.recordsetId, 42);
  assert.equal(client.fake.calls.filter(c => c.operation.startsWith('POST')).length, 1);
  assert.equal(result.evidence.fields['42/CONFIRMED'], 'match');
});

test('silent no-op end-date updates are unverified, never deleted or retried', async () => {
  const client = createFakeWellSkyClient();
  client.fake.set('GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}', { kind: 'reply', body: mobile });
  client.fake.set('POST /assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}', { kind: 'reply', body: {} });
  const result = await client.subassessments.setEndDate({ ...context, parentField: 'ROWS', recordsetId: 42, endDateField: 'END', endDate: '2026-10-21' });
  assert.equal(result.status, 'unverified'); assert.equal(client.fake.calls.filter(c => c.operation.startsWith('POST')).length, 1);
});

test('live service response nulls are accepted by both generated versions', async () => {
  for (const Client of [WellSkyClient, V2Client]) {
    const client = new Client({ ...config, fetch: async () => new Response(JSON.stringify([{ serviceId: 1, rhyInformation: null, hopwaInformation: null, pathInformation: null, ssvfInformation: null }])) });
    const response = toItemsForTest(await client.services.getComplete({ path: { serviceId: 1 } }));
    assert.equal(response[0].serviceId, 1);
    assert.equal(response[0].ssvfInformation, null);
  }
});

function toItemsForTest(value) { return Array.isArray(value) ? value : [value]; }

test('async observer failures cannot reject or replay an HTTP request', async () => {
  let calls = 0;
  const client = new WellSkyClient({ ...config, hooks: { onResponse: async () => { throw new Error('private'); } }, logger: async () => { throw new Error('private'); }, fetch: async () => { calls++; return new Response('[]'); } });
  await client.clients.list();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
});

test('impossible calendar end dates fail before any API request', async () => {
  const client = createFakeWellSkyClient();
  const result = await client.subassessments.setEndDate({ ...context, parentField: 'ROWS', recordsetId: 42, endDateField: 'END', endDate: '2026-02-30' });
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'preflight'); assert.equal(client.fake.calls.length, 0);
});
