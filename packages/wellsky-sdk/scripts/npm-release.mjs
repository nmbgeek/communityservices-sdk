import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

export function validateNpmRelease(pkg, artifact, archive, env) {
  if (env.GITHUB_REPOSITORY !== 'nmbgeek/communityservices-sdk' || env.GITHUB_REF !== `refs/tags/v${pkg.version}`) {
    throw Error('npm releases require the matching version tag in the GitHub mirror');
  }
  if (pkg.name !== '@choiceapps/communityservices-sdk' || artifact.name !== pkg.name || artifact.version !== pkg.version) {
    throw Error('Package and tested artifact identity/version must match');
  }
  if (pkg.license !== 'Apache-2.0' || pkg.repository?.url !== 'git+https://github.com/nmbgeek/communityservices-sdk.git') {
    throw Error('Release license or provenance repository is incorrect');
  }
  if (`sha512-${createHash('sha512').update(archive).digest('base64')}` !== artifact.integrity) {
    throw Error('Archive does not match the tested artifact integrity');
  }
}

export async function readNpmDist(artifact, waitForPublication, {fetchImpl = fetch, sleep = delay} = {}) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(artifact.name)}/${encodeURIComponent(artifact.version)}`;
  // npm can accept an upload before its metadata becomes publicly visible.
  const attempts = waitForPublication ? 16 : 6;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000)});
    } catch {
      if (attempt === attempts - 1) throw Error(`npm registry metadata request failed after ${attempts} attempts`);
      await sleep(Math.min(1000 * 2 ** attempt, 30_000));
      continue;
    }
    if (response.ok) {
      const metadata = await response.json();
      if (metadata.name !== artifact.name || metadata.version !== artifact.version || !metadata.dist) {
        throw Error('npm registry returned invalid package metadata');
      }
      return metadata.dist;
    }
    await response.body?.cancel();
    if (response.status === 404 && !waitForPublication) return null;
    if (response.status !== 404 && response.status !== 429 && response.status < 500) {
      throw Error(`npm registry metadata request failed (HTTP ${response.status})`);
    }
    if (attempt === attempts - 1) throw Error(`npm registry metadata did not become available after ${attempts} attempts`);
    await sleep(Math.min(1000 * 2 ** attempt, 30_000));
  }
}
