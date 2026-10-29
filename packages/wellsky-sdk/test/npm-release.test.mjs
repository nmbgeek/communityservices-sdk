import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateNpmRelease, readNpmDist} from '../scripts/npm-release.mjs';

const pkg = {name: '@choiceapps/communityservices-sdk', version: '0.1.0', license: 'Apache-2.0', repository: {url: 'git+https://github.com/nmbgeek/communityservices-sdk.git'}};
const archive = Buffer.from('tested tarball');
const artifact = {...pkg, integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`};
const env = {GITHUB_REPOSITORY: 'nmbgeek/communityservices-sdk', GITHUB_REF: 'refs/tags/v0.1.0'};

test('npm release binds package, tag, repository, license, and tested bytes', () => {
  validateNpmRelease(pkg, artifact, archive, env);
  for (const changed of [{...env, GITHUB_REF: 'refs/heads/main'}, {...env, GITHUB_REF: 'refs/tags/v0.2.0'}, {...env, GITHUB_REPOSITORY: 'someone/fork'}]) {
    assert.throws(() => validateNpmRelease(pkg, artifact, archive, changed));
  }
  assert.throws(() => validateNpmRelease(pkg, {...artifact, name: '@another/package'}, archive, env));
  assert.throws(() => validateNpmRelease(pkg, {...artifact, version: '0.2.0'}, archive, env));
  assert.throws(() => validateNpmRelease(pkg, artifact, Buffer.from('changed bytes'), env));
  assert.throws(() => validateNpmRelease({...pkg, license: undefined}, artifact, archive, env));
  assert.throws(() => validateNpmRelease({...pkg, repository: undefined}, artifact, archive, env));
});

test('npm lookup retries publication visibility without transmitting credentials', async () => {
  let calls = 0;
  const sleeps = [];
  const dist = {integrity: artifact.integrity};
  const result = await readNpmDist(artifact, true, {
    fetchImpl: async (url, options) => {
      assert.equal(new URL(url).origin, 'https://registry.npmjs.org');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers, undefined);
      return ++calls <= 9 ? new Response(null, {status: 404}) : Response.json({name: pkg.name, version: pkg.version, dist});
    },
    sleep: async ms => sleeps.push(ms),
  });
  assert.deepEqual(result, dist);
  assert.equal(calls, 10);
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000]);
});

test('npm lookup distinguishes a missing version from authorization failure and wrong metadata', async () => {
  assert.equal(await readNpmDist(artifact, false, {fetchImpl: async () => new Response(null, {status: 404})}), null);
  let calls = 0;
  await assert.rejects(readNpmDist(artifact, false, {fetchImpl: async () => {calls++; return new Response(null, {status: 403});}}), /HTTP 403/);
  assert.equal(calls, 1);
  await assert.rejects(readNpmDist(artifact, false, {fetchImpl: async () => Response.json({name: 'wrong', version: pkg.version, dist: {}})}), /invalid package metadata/);
});

test('npm lookup bounds unavailable-registry retries', async () => {
  let calls = 0;
  await assert.rejects(readNpmDist(artifact, true, {
    fetchImpl: async () => {calls++; return new Response(null, {status: 503});}, sleep: async () => {},
  }), /16 attempts/);
  assert.equal(calls, 16);
});

test('npm preflight bounds network failures without waiting for publication', async () => {
  let calls = 0;
  const sleeps = [];
  await assert.rejects(readNpmDist(artifact, false, {
    fetchImpl: async () => {calls++; throw Error('offline');}, sleep: async ms => sleeps.push(ms),
  }), /6 attempts/);
  assert.equal(calls, 6);
  assert.deepEqual(sleeps, [1000, 2000, 4000, 8000, 16000]);
});
