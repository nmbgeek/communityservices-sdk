import test from 'node:test';
import assert from 'node:assert/strict';
import { WellSkyClient, toItems, semanticHash, verifyWrite } from '@choiceapps/communityservices-sdk';
import { WellSkyClient as V2Client } from '@choiceapps/communityservices-sdk/v2';

const config = { tenant: 'synthetic-review', auth: { kind: 'none' }, retryBaseDelayMs: 0 };

test('semantic hashes reject sparse arrays instead of colliding with empty arrays', async () => {
  for (const values of [new Array(1), [1, , 3], { nested: new Array(2) }]) {
    await assert.rejects(semanticHash(values), error => error.kind === 'validation');
  }
  assert.equal(await semanticHash([null]), await semanticHash([null]));
  assert.notEqual(await semanticHash([null]), await semanticHash([]));
});

test('sparse expected fields fail before submission, and sparse readback cannot verify', async () => {
  let writes = 0;
  const plan = {
    operation: 'POST /synthetic', readEndpoint: 'GET /synthetic', semanticPayload: { id: 1 },
    expectedFields: { values: new Array(1) },
    submit: async () => { writes++; },
    readBack: async () => ({ kind: 'found', value: { data: { id: 1 }, ids: { id: 1 }, fields: { values: [] } } }),
  };
  const invalid = await verifyWrite(plan);
  assert.equal(invalid.status, 'failed');
  assert.equal(invalid.reason, 'preflight');
  assert.equal(writes, 0);
  const mismatch = await verifyWrite({ ...plan, expectedFields: { values: [] }, readBack: async () => ({ kind: 'found', value: { data: { id: 1 }, ids: { id: 1 }, fields: { values: new Array(1) } } }) });
  assert.equal(mismatch.status, 'unverified');
  assert.equal(writes, 1);
});

for (const Client of [WellSkyClient, V2Client]) {
  const version = Client === V2Client ? 'V2' : 'V3';
  test(`${version}: counted responses retain their envelope and normalize to records`, async () => {
    const body = { count: 1, values: [{ clientId: 123 }] };
    const client = new Client({ ...config, fetch: async () => Response.json(body) });
    const response = await client.clients.list({ query: { total_count: true } });
    assert.deepEqual(response, body);
    assert.deepEqual(toItems(response), body.values);
    assert.deepEqual(toItems({ count: 0, values: [] }), []);
  });

  test(`${version}: pagination yields counted records through short pages and stops on empty values`, async () => {
    const pages = [];
    const client = new Client({ ...config, fetch: async url => {
      const page = Number(new URL(url).searchParams.get('startPage'));
      pages.push(page);
      return Response.json({ count: 2, values: page <= 2 ? [{ clientId: page }] : [] });
    } });
    const items = [];
    for await (const item of client.paginate('GET /clients', { query: { total_count: true, perPage: 100 }, maxPages: 3 })) items.push(item);
    assert.deepEqual(items, [{ clientId: 1 }, { clientId: 2 }]);
    assert.deepEqual(pages, [1, 2, 3]);
  });

  test(`${version}: malformed collection envelopes cannot bypass response validation`, async () => {
    for (const body of [
      { count: 1, values: [{ clientId: 'invalid' }] },
      { count: -1, values: [] }, { count: 0.5, values: [] },
      { count: '1', values: [] }, { count: 1, values: {} },
      { values: [] }, { count: 0 },
      { value: [{ clientId: 'invalid' }] }, { value: {} },
      { value: [], '@odata.count': -1 },
    ]) {
      const client = new Client({ ...config, fetch: async () => Response.json(body) });
      await assert.rejects(client.clients.list(), error => error.kind === 'protocol');
    }
  });

  test(`${version}: 503 Retry-After beyond the configured bound returns without retrying`, async () => {
    for (const retryAfter of ['60', new Date(Date.now() + 60_000).toUTCString()]) {
      let calls = 0;
      const client = new Client({ ...config, maxRetryDelayMs: 10, fetch: async () => {
        calls++;
        return calls === 1 ? new Response('', { status: 503, headers: { 'Retry-After': retryAfter, 'x-request-id': 'synthetic-request' } }) : Response.json([]);
      } });
      await assert.rejects(client.clients.list(), error => error.name === 'UpstreamError' && error.status === 503 && error.retryAfterMs > 10 && error.requestId === 'synthetic-request');
      assert.equal(calls, 1);
    }
  });

  test(`${version}: bounded 503 delays remain cancellable and writes never replay`, async () => {
    let calls = 0;
    const controller = new AbortController();
    const client = new Client({ ...config, maxRetryDelayMs: 2000, fetch: async () => {
      calls++;
      setTimeout(() => controller.abort(), 25);
      return new Response('', { status: 503, headers: { 'Retry-After': '1' } });
    } });
    await assert.rejects(client.clients.list({ signal: controller.signal }), error => error.kind === 'aborted');
    assert.equal(calls, 1);
    let writes = 0;
    const writer = new Client({ ...config, fetch: async () => {
      writes++;
      return new Response('', { status: 503, headers: { 'Retry-After': '60' } });
    } });
    await assert.rejects(writer.clients.create({ body: { firstName: 'Synthetic', lastName: 'Review' } }), error => error.status === 503 && error.retryAfterMs === 60_000);
    assert.equal(writes, 1);
  });
}
