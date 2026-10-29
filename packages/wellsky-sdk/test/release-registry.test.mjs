import test from 'node:test';
import assert from 'node:assert/strict';
import {readRegistryDist, assertRegistryArtifact, ensureRegistryArtifact} from '../scripts/release-registry.mjs';

const registry = new URL('https://gitlab.example/api/v4/projects/48/packages/npm/');
const artifact = {name: '@synthetic/sdk', version: '0.1.0', integrity: 'sha512-tested', shasum: 'tested-sha1'};
const dist = {integrity: artifact.integrity, shasum: artifact.shasum};
const manifest = versions => Response.json({name: artifact.name, versions});
const available = () => manifest({[artifact.version]: {dist}});
const forwarding = () => new Response(null, {status: 302, headers: {location: 'https://registry.npmjs.org/@synthetic%2fsdk'}});

test('release lookup reads authenticated GitLab metadata without following or caching forwarding redirects', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({url: String(url), options});
    return requests.length === 1 ? forwarding() : available();
  };
  assert.equal(await readRegistryDist(registry, artifact, 'synthetic-token', {fetchImpl}), null);
  assert.deepEqual(await readRegistryDist(registry, artifact, 'synthetic-token', {fetchImpl, waitForPublication: true}), dist);
  assert.equal(requests.length, 2);
  for (const {url, options} of requests) {
    assert.equal(url, registry.href + '%40synthetic%2Fsdk');
    assert.equal(options.headers.authorization, 'Bearer synthetic-token');
    assert.equal(options.headers['cache-control'], 'no-cache');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('post-upload lookup waits for forwarding, missing package, missing version, and temporary server errors', async () => {
  const responses = [forwarding(), new Response(null, {status: 404}), manifest({}), new Response(null, {status: 503}), available()];
  const delays = [];
  assert.deepEqual(await readRegistryDist(registry, artifact, 'token', {
    waitForPublication: true, fetchImpl: async () => responses.shift(), sleep: async ms => delays.push(ms),
  }), dist);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
});

test('lookup retries temporary network and rate-limit failures but bounds persistent missing metadata', async () => {
  let calls = 0;
  assert.deepEqual(await readRegistryDist(registry, artifact, 'token', {
    fetchImpl: async () => {
      if (++calls === 1) throw Error('temporary network error');
      return calls === 2 ? new Response(null, {status: 429}) : available();
    }, sleep: async () => {},
  }), dist);
  calls = 0;
  await assert.rejects(readRegistryDist(registry, artifact, 'token', {
    waitForPublication: true, fetchImpl: async () => {calls++; return forwarding();}, sleep: async () => {},
  }), /after six attempts/);
  assert.equal(calls, 6);
});

test('authentication failures and unexpected redirects never become permission to publish', async () => {
  for (const response of [new Response(null, {status: 401}), new Response(null, {status: 403}), new Response(null, {status: 302, headers: {location: 'https://other.example/package'}})]) {
    let calls = 0, writes = 0;
    await assert.rejects(ensureRegistryArtifact(artifact, {
      readDist: waitForPublication => readRegistryDist(registry, artifact, 'token', {
        waitForPublication, fetchImpl: async () => {calls++; return response;},
        sleep: async () => assert.fail('must not retry'),
      }), publish: async () => {writes++;},
    }), /HTTP 40[13]|unexpected metadata redirect/);
    assert.equal(calls, 1);
    assert.equal(writes, 0);
  }
});

test('malformed or unrelated metadata fails instead of being treated as an absent version', async () => {
  for (const value of [{}, {name: 'wrong', versions: {}}, {name: artifact.name, versions: []}, {name: artifact.name, versions: {[artifact.version]: {}}}]) {
    await assert.rejects(readRegistryDist(registry, artifact, 'token', {fetchImpl: async () => Response.json(value)}), /invalid package metadata|no distribution metadata/);
  }
});

test('first publication sends once and reconciles post-upload metadata', async () => {
  let writes = 0;
  const reads = [];
  assert.equal(await ensureRegistryArtifact(artifact, {
    readDist: async wait => {reads.push(wait); return writes ? dist : null;},
    publish: async () => {writes++;},
  }), 'published');
  assert.deepEqual(reads, [false, true]);
  assert.equal(writes, 1);
});

test('release retry accepts only the identical published artifact and never overwrites it', async () => {
  assert.equal(await ensureRegistryArtifact(artifact, {readDist: async () => dist, publish: async () => assert.fail('must not republish')}), 'already-published');
  for (const existing of [{integrity: 'sha512-different', shasum: artifact.shasum}, {}, {shasum: 'different'}]) {
    await assert.rejects(ensureRegistryArtifact(artifact, {readDist: async () => existing, publish: async () => assert.fail('must not overwrite')}), /does not match/);
  }
  assert.doesNotThrow(() => assertRegistryArtifact({shasum: artifact.shasum}, artifact));
});

test('lost publish acknowledgement stops the attempt and a new run reconciles the saved artifact', async () => {
  let saved = false, writes = 0;
  const actions = {
    readDist: async () => saved ? dist : null,
    publish: async () => {saved = true; writes++; throw Error('lost acknowledgement');},
  };
  await assert.rejects(ensureRegistryArtifact(artifact, actions), /lost acknowledgement/);
  assert.equal(writes, 1);
  assert.equal(await ensureRegistryArtifact(artifact, actions), 'already-published');
  assert.equal(writes, 1);
});
