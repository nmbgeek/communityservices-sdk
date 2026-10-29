import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { WellSkyClient, WellSkyError, toItems } from '../dist/esm/index.js';
import { WellSkyClient as V2Client } from '../dist/esm/v2.js';

const token = (id = 'first', exp = Date.now() / 1000 + 3600) => `e30.${Buffer.from(JSON.stringify({ exp, id })).toString('base64url')}.signature`;
const service = { clientId: 123, serviceProvider: 456, serviceCode: 'BH-1800', needStatus: 'fully met', serviceStartDate: '2026-10-22T00:00:00Z' };
const options = { tenant: 'example_training', cooldown: { threshold: 100, windowMs: 10000, durationMs: 30000 }, auth: { kind: 'token', token: 'test-token' }, retryBaseDelayMs: 0 };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

async function server(t, handler) {
  const requests = [];
  const instance = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
    try { await handler(req, res, raw, requests); }
    catch { res.writeHead(500).end(); }
  });
  instance.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  t.after(async () => { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); });
  return { baseUrl: `http://127.0.0.1:${instance.address().port}/client-api-prod`, requests };
}

test('real HTTP: concurrent credential auth is shared; tenant, version, filters and bodies reach the server', async t => {
  const fixed = token('fixed', 4_000_000_000);
  const http = await server(t, async (req, res, raw) => {
    res.setHeader('content-type', 'application/json');
    if (req.url.endsWith('/authentication/SetAuthKey')) {
      assert.equal(req.headers.authorization, undefined);
      assert.deepEqual(JSON.parse(raw), { username: 'user', password: 'secret' });
      await new Promise(resolve => setTimeout(resolve, 15));
      res.end(JSON.stringify({ token: fixed }));
    } else {
      assert.equal(req.headers.authorization, `Bearer ${fixed}`);
      res.end(JSON.stringify([{ clientId: 123 }]));
    }
  });
  const client = new WellSkyClient({ ...options, baseUrl: http.baseUrl, auth: { kind: 'credentials', username: 'user', password: 'secret' } });
  const results = await Promise.all(Array.from({ length: 8 }, () => client.clients.list({ query: { '$filter': "lastName eq 'Example & Test'", total_count: false, perPage: 5 } })));
  assert.equal(results.length, 8);
  assert.equal(http.requests.filter(r => r.url.endsWith('/SetAuthKey')).length, 1);
  for (const request of http.requests.slice(1)) {
    assert.equal(request.headers.authorization, `Bearer ${fixed}`);
    assert.equal(request.headers['x-tenant'], 'example_training');
    assert.equal(request.headers['x-version'], '3.0');
    const url = new URL(request.url, http.baseUrl);
    assert.equal(url.searchParams.get('$filter'), "lastName eq 'Example & Test'");
    assert.equal(url.searchParams.get('total_count'), 'false');
  }
});

test('real HTTP: serializes JSON writes and multipart attachments', async t => {
  const http = await server(t, (_req, res) => res.end('{}'));
  const client = new WellSkyClient({ ...options, baseUrl: http.baseUrl });
  await client.services.create({ body: service });
  await client.fileAttachments.createForClient({ body: { username: 'user', password: 'secret', client_id: 123, fileData: new File(['example file'], 'note.txt', { type: 'text/plain' }) } });
  assert.deepEqual(JSON.parse(http.requests[0].body), service);
  assert.equal(http.requests[0].headers['content-type'], 'application/json');
  assert.match(http.requests[1].headers['content-type'], /^multipart\/form-data; boundary=/);
  assert.match(http.requests[1].body, /filename="note.txt"/);
  assert.match(http.requests[1].body, /example file/);
});

test('real HTTP: read retries honor Retry-After and preserve request headers', async t => {
  const http = await server(t, (_req, res, _raw, requests) => requests.length === 1 ? res.writeHead(429, { 'Retry-After': '0' }).end('do not expose') : res.end('[{"clientId":123}]'));
  const client = new WellSkyClient({ ...options, baseUrl: http.baseUrl });
  assert.deepEqual(await client.clients.list(), [{ clientId: 123 }]);
  assert.equal(http.requests.length, 2);
});

for (const Client of [WellSkyClient, V2Client]) {
  test(`${Client === V2Client ? 'v2' : 'v3'}: oversized attachments fail before auth or network; exact limit is accepted`, async () => {
    const calls = [];
    const client = new Client({ ...options, auth: { kind: 'credentials', username: 'user', password: 'secret' }, fetch: async (url, init) => {
      calls.push({ url: String(url), body: init.body });
      return json(String(url).endsWith('/SetAuthKey') ? { token: token() } : {});
    } });
    const body = { username: 'user', password: 'secret', client_id: 123 };
    for (const fileData of [new Blob([new Uint8Array(10_000_001)]), new File([new Uint8Array(10_000_001)], 'private-name.txt')]) {
      await assert.rejects(client.fileAttachments.createForClient({ body: { ...body, fileData } }), e => {
        assert.equal(e.kind, 'validation');
        assert.deepEqual(e.fields, ['fileData']);
        assert.ok(!JSON.stringify(e).includes('private-name'));
        return true;
      });
    }
    assert.equal(calls.length, 0);
    assert.equal(client.health().tokenMintCount, 0);
    await client.fileAttachments.createForClient({ body: { ...body, fileData: new File([new Uint8Array(10_000_000)], 'boundary.txt') } });
    assert.equal(calls.length, 2);
    assert.ok(calls[1].body instanceof FormData);
    assert.equal(calls[1].body.get('fileData').size, 10_000_000);
  });
}

test('real HTTP: redirects are rejected without forwarding credentials', async t => {
  const http = await server(t, (_req, res) => res.writeHead(302, { Location: '/unexpected-target' }).end());
  const client = new WellSkyClient({ ...options, baseUrl: http.baseUrl, maxReadRetries: 0 });
  await assert.rejects(client.clients.list(), e => e.kind === 'network');
  assert.equal(http.requests.length, 1);
});

test('real HTTP: deadline covers reading the body', async t => {
  const http = await server(t, (_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('['); });
  const client = new WellSkyClient({ ...options, baseUrl: http.baseUrl, timeoutMs: 40 });
  await assert.rejects(client.clients.list(), e => e.kind === 'timeout');
});

test('pre-cancelled requests do not authenticate or fetch', async () => {
  let calls = 0;
  const client = new WellSkyClient({ ...options, fetch: async () => { calls++; return json([]); } });
  await assert.rejects(client.clients.list({ signal: AbortSignal.abort() }), e => e.kind === 'aborted');
  assert.equal(calls, 0);
});

test('read refresh occurs once; concurrent 401s share the new token', async () => {
  let mints = 0;
  let reads = 0;
  const old = token('old'); const fresh = token('new');
  const client = new WellSkyClient({ ...options, auth: { kind: 'credentials', username: 'user', password: 'secret' }, fetch: async (url, init) => {
    if (String(url).endsWith('/SetAuthKey')) { mints++; await new Promise(r => setTimeout(r, 5)); return json({ token: mints === 1 ? old : fresh }); }
    reads++;
    if (init.headers.get('Authorization') === `Bearer ${old}`) { await new Promise(r => setTimeout(r, 15)); return json({}, 401); }
    return json([]);
  } });
  await Promise.all(Array.from({ length: 10 }, () => client.clients.list()));
  assert.equal(mints, 2);
  assert.equal(reads, 20);
});

test('repeated 401 stops after one refresh; 403 never remints', async () => {
  for (const status of [401, 403]) {
    let mints = 0; let reads = 0;
    const client = new WellSkyClient({ ...options, auth: { kind: 'credentials', username: 'user', password: 'secret' }, fetch: async url => String(url).endsWith('/SetAuthKey') ? (mints++, json({ token: token(String(mints)) })) : (reads++, json({}, status)) });
    await assert.rejects(client.clients.list(), e => e.status === status);
    assert.equal(mints, status === 401 ? 2 : 1);
    assert.equal(reads, status === 401 ? 2 : 1);
  }
});

test('late 401 from an old token does not discard the newer token', async () => {
  let mints = 0; let firstReads = 0;
  const old = token('old'); const fresh = token('fresh');
  const client = new WellSkyClient({ ...options, auth: { kind: 'provider', getToken: () => ++mints === 1 ? old : fresh }, fetch: async (_url, init) => {
    if (init.headers.get('Authorization') === `Bearer ${old}`) {
      firstReads++;
      await new Promise(resolve => setTimeout(resolve, firstReads === 1 ? 5 : 30));
      return json({}, 401);
    }
    return json([]);
  } });
  await Promise.all([client.clients.list(), client.clients.list()]);
  assert.equal(mints, 2);
});

test('cancelled auth waiter leaves shared authentication usable for other requests', async () => {
  let providers = 0;
  const client = new WellSkyClient({ ...options, auth: { kind: 'provider', getToken: async () => { providers++; await new Promise(r => setTimeout(r, 30)); return token(); } }, fetch: async () => json([]) });
  const controller = new AbortController();
  const first = client.clients.list({ signal: controller.signal });
  const other = client.clients.list();
  controller.abort();
  await assert.rejects(first, e => e.kind === 'aborted');
  assert.deepEqual(await other, []);
  assert.equal(providers, 1);
});

test('expired tokens are rejected; soon-expiring tokens refresh before reuse', async () => {
  let count = 0;
  const expired = new WellSkyClient({ ...options, auth: { kind: 'provider', getToken: () => token('old', 1) }, fetch: async () => { count++; return json([]); } });
  await assert.rejects(expired.clients.list(), e => e.kind === 'protocol');
  assert.equal(count, 0);
  const client = new WellSkyClient({ ...options, auth: { kind: 'provider', getToken: () => { count++; return token('soon', Date.now() / 1000 + 60); } }, fetch: async () => json([]) });
  await client.clients.list(); await client.clients.list();
  assert.equal(count, 2);
});

test('auth failures are sanitized and failed in-flight mint can be retried by the caller', async () => {
  let attempts = 0;
  const client = new WellSkyClient({ ...options, auth: { kind: 'credentials', username: 'user', password: 'private-password' }, fetch: async url => {
    if (String(url).endsWith('/SetAuthKey')) return ++attempts === 1 ? json({ token: 'private-password' }, 401) : json({ token: token() });
    return json([]);
  } });
  await assert.rejects(client.clients.list(), e => { assert.ok(e instanceof WellSkyError); assert.equal(JSON.stringify(e).includes('private-password'), false); return e.status === 401; });
  assert.deepEqual(await client.clients.list(), []);
  assert.equal(attempts, 2);
});

test('write failures are never replayed, including auth, throttling, and network errors', async () => {
  for (const status of [401, 403, 408, 429, 500, 502, 503, 504, 'network']) {
    let calls = 0;
    const client = new WellSkyClient({ ...options, fetch: async () => { calls++; if (status === 'network') throw new Error('private details'); return json({ private: 'data' }, status); } });
    await assert.rejects(client.services.create({ body: service }), e => !String(e).includes('private'));
    assert.equal(calls, 1);
  }
});

test('Retry-After above the configured cap returns the error without early retry', async () => {
  let calls = 0;
  const client = new WellSkyClient({ ...options, maxRetryDelayMs: 1, fetch: async () => { calls++; return json({}, 429, { 'Retry-After': '120', 'x-request-id': 'request-123' }); } });
  await assert.rejects(client.clients.list(), e => e.retryAfterMs === 120_000 && e.requestId === 'request-123');
  assert.equal(calls, 1);
});

test('HTTP-date Retry-After is parsed; read retry budget is bounded', async () => {
  let calls = 0;
  const client = new WellSkyClient({ ...options, fetch: async () => { calls++; return json({}, 503, { 'Retry-After': new Date(0).toUTCString() }); } });
  await assert.rejects(client.clients.list(), e => e.status === 503);
  assert.equal(calls, 3);
});

test('schema validation rejects missing fields and incorrect values before HTTP', async () => {
  let calls = 0;
  const client = new WellSkyClient({ ...options, fetch: async () => { calls++; return json({}); } });
  for (const operation of [() => client.clients.get({ path: { clientId: 'bad' } }), () => client.services.create({ body: {} }), () => client.services.create({ body: { ...service, typo: true } })]) await assert.rejects(operation(), e => e.kind === 'validation');
  assert.equal(calls, 0);
});

test('response model validation checks arrays and OData wrappers, preserving extra fields', async () => {
  for (const response of [{ clientId: 123, extra: true }, [{ clientId: 123 }], { value: [{ clientId: 123 }], '@odata.count': 1 }, null]) {
    const client = new WellSkyClient({ ...options, fetch: async () => json(response) });
    assert.deepEqual(await client.clients.get({ path: { clientId: 123 } }), response);
  }
  for (const response of [{ clientId: 'bad' }, [{ clientId: 'bad' }], { value: [{ clientId: 'bad' }] }]) {
    const client = new WellSkyClient({ ...options, fetch: async () => json(response) });
    await assert.rejects(client.clients.list(), e => e.kind === 'protocol');
  }
});

test('malformed JSON fails once; 204 is null', async () => {
  let calls = 0;
  const broken = new WellSkyClient({ ...options, fetch: async () => { calls++; return new Response('not-json'); } });
  await assert.rejects(broken.clients.list(), e => e.kind === 'protocol');
  assert.equal(calls, 1);
  const empty = new WellSkyClient({ ...options, fetch: async () => new Response(null, { status: 204 }) });
  assert.equal(await empty.clients.list(), null);
});

test('endpoints without response schemas preserve plain text', async () => {
  const client = new WellSkyClient({ ...options, fetch: async () => new Response('Healthy') });
  assert.equal(await client.healthCheck.get(), 'Healthy');
});

test('authentication deadline bounds stalled token providers', async () => {
  const client = new WellSkyClient({ ...options, timeoutMs: 20, auth: { kind: 'provider', getToken: () => new Promise(() => {}) }, fetch: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(client.clients.list(), e => e.kind === 'timeout');
});

test('cancellation during retry backoff stops further requests', async () => {
  let calls = 0;
  const controller = new AbortController();
  const client = new WellSkyClient({ ...options, fetch: async () => { calls++; setTimeout(() => controller.abort(), 5); return json({}, 429, { 'Retry-After': '10' }); } });
  await assert.rejects(client.clients.list({ signal: controller.signal }), e => e.kind === 'aborted');
  assert.equal(calls, 1);
});

test('pagination continues through server-capped short pages and preserves query parameters', async () => {
  const pages = [];
  const client = new WellSkyClient({ ...options, fetch: async url => {
    const page = Number(url.searchParams.get('startPage')); pages.push(page);
    assert.equal(url.searchParams.get('query'), 'clientId gt 0');
    return json(page < 4 ? [{ clientId: page }] : []);
  } });
  const items = [];
  for await (const item of client.paginate('GET /clients', { query: { startPage: 2, perPage: 50, query: 'clientId gt 0' } })) items.push(item);
  assert.deepEqual(items, [{ clientId: 2 }, { clientId: 3 }]);
  assert.deepEqual(pages, [2, 3, 4]);
});

test('pagination bounds non-terminating servers and supports early break', async () => {
  let calls = 0;
  const client = new WellSkyClient({ ...options, fetch: async () => { calls++; return json([{ clientId: 123 }]); } });
  await assert.rejects(async () => { for await (const _ of client.paginate('GET /clients', { maxPages: 2 })) {} }, e => e.kind === 'pagination');
  assert.equal(calls, 2);
  for await (const _ of client.paginate('GET /clients', {})) break;
  assert.equal(calls, 3);
});

test('path segments are encoded; dot-segment escapes are rejected', async () => {
  const client = new WellSkyClient({ ...options, fetch: async url => { assert.ok(String(url).includes('/ABC%2F%3F%23')); return json([]); } });
  await client.assessments.get({ path: { clientId: 123, assessmentCode: 'ABC/?#' } });
  await assert.rejects(client.assessments.get({ path: { clientId: 123, assessmentCode: '..' } }), e => e.kind === 'validation');
});

test('instances isolate tenants and tokens; V2 and V3 send matching headers', async () => {
  const seen = [];
  for (const [Client, tenant, version] of [[V2Client, 'tenant_a', '2.0'], [WellSkyClient, 'tenant_b', '3.0']]) {
    const client = new Client({ ...options, tenant, auth: { kind: 'provider', getToken: () => tenant }, fetch: async (_url, init) => { seen.push([init.headers.get('x-tenant'), init.headers.get('x-version'), init.headers.get('authorization')]); return json([]); } });
    await client.clients.list();
    assert.deepEqual(seen.at(-1), [tenant, version, `Bearer ${tenant}`]);
  }
});

test('configuration validation, anonymous authentication, and toItems helpers', async () => {
  for (const extra of [{ tenant: '' }, { baseUrl: 'http://example.com' }, { baseUrl: 'https://user:secret@example.com' }, { timeoutMs: -1 }, { maxReadRetries: -1 }]) assert.throws(() => new WellSkyClient({ ...options, ...extra }));
  const client = new WellSkyClient({ ...options, auth: { kind: 'none' }, fetch: async (_url, init) => { assert.equal(init.headers.has('authorization'), false); return json({ token: 'example' }); } });
  await client.authentication.setAuthKey({ body: { username: 'user', password: 'secret' } });
  assert.deepEqual(toItems(null), []);
  assert.deepEqual(toItems({ clientId: 1 }), [{ clientId: 1 }]);
  assert.deepEqual(toItems({ value: [{ clientId: 1 }] }), [{ clientId: 1 }]);
});

function sample(schema, schemas, depth = 0) {
  if (depth > 20) throw new Error('recursive fixture');
  if (schema.$ref) return sample(schemas[schema.$ref.split('/').at(-1)], schemas, depth + 1);
  switch (schema.type.toLowerCase()) {
    case 'object': return Object.fromEntries((schema.required ?? []).map(k => [k, sample(schema.properties[k], schemas, depth + 1)]));
    case 'array': return [];
    case 'string': return schema.format === 'binary' ? new Blob(['synthetic']) : 'Example1!'.padEnd(schema.minLength ?? 1, 'x').slice(0, schema.maxLength ?? Infinity);
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    default: throw new Error('unknown schema');
  }
}

for (const [version, Client] of [['v2', V2Client], ['v3', WellSkyClient]]) {
  test(`${version}: every Swagger operation is callable by named method and typed request`, async () => {
    const spec = JSON.parse(readFileSync(new URL(`../specs/${version}.json`, import.meta.url)));
    const docs = readFileSync(new URL('../API.md', import.meta.url), 'utf8');
    let calls = 0;
    for (const [path, methods] of Object.entries(spec.paths)) for (const [method, definition] of Object.entries(methods)) {
      const schemas = spec.components.schemas;
      const args = {};
      for (const p of definition.parameters ?? []) {
        if (p.in === 'path' || (p.in === 'query' && p.required)) (args[p.in] ??= {})[p.name] = sample(p.schema, schemas);
      }
      const content = definition.requestBody?.content;
      if (content) args.body = sample((content['application/json'] ?? content['multipart/form-data']).schema, schemas);
      const responseContent = definition.responses['200']?.content;
      const response = responseContent ? sample((responseContent['application/json'] ?? Object.values(responseContent)[0]).schema, schemas) : null;
      const client = new Client({ ...options, fetch: async (url, init) => {
        calls++;
        assert.equal(init.method, method.toUpperCase());
        assert.equal(new URL(url).pathname, '/client-api-prod' + path.replace(/\{([^}]+)\}/g, (_, k) => encodeURIComponent(args.path[k])));
        assert.equal(init.headers.get('x-version'), version === 'v2' ? '2.0' : '3.0');
        return json(response);
      } });
      await client.request(`${method.toUpperCase()} ${path}`, args);
      const row = docs.split('\n').find(line => line.includes(`| ${method.toUpperCase()} | \`${path}\` |`));
      const [group, name] = row.split('`')[1].split('.');
      await client[group][name](args);
    }
    assert.equal(calls, 156);
  });
}

test('CommonJS entry points expose both clients', () => {
  const require = createRequire(import.meta.url);
  assert.equal(typeof require('../dist/cjs/index.js').WellSkyClient, 'function');
  assert.equal(require('../dist/cjs/v2.js').apiVersion, '2.0');
  assert.equal(require('../dist/cjs/v3.js').apiVersion, '3.0');
});
