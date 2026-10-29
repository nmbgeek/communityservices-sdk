import {setTimeout as delay} from 'node:timers/promises';

// GitLab can forward an absent package to npmjs.org. Never follow that redirect
// for release verification or populate npm's cache with a pre-publication miss.
export async function readRegistryDist(registry, artifact, token, {
  waitForPublication = false, fetchImpl = fetch, sleep = delay,
} = {}) {
  const url = new URL(encodeURIComponent(artifact.name), registry);
  for (let attempt = 0; attempt < 6; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(10_000),
        headers: {authorization: `Bearer ${token}`, accept: 'application/json', 'cache-control': 'no-cache'},
      });
    } catch {
      // Retry reads only. Do not include credentials or network error payloads.
      if (attempt === 5) throw Error('GitLab registry metadata request failed after six attempts');
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    let missing = response.status === 404;
    const transient = response.status === 429 || response.status >= 500;
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const target = location ? new URL(location, url) : null;
      missing = target?.origin === 'https://registry.npmjs.org';
      if (!missing) {
        await response.body?.cancel();
        throw Error('GitLab registry returned an unexpected metadata redirect');
      }
    }
    if (response.ok) {
      const metadata = await response.json();
      if (metadata.name !== artifact.name || !metadata.versions || typeof metadata.versions !== 'object' || Array.isArray(metadata.versions)) {
        throw Error('GitLab registry returned invalid package metadata');
      }
      if (Object.hasOwn(metadata.versions, artifact.version)) {
        const version = metadata.versions[artifact.version];
        if (!version?.dist || typeof version.dist !== 'object') throw Error('GitLab registry version has no distribution metadata');
        return version.dist;
      }
      missing = true;
    } else {
      await response.body?.cancel();
    }
    if (missing && !waitForPublication) return null;
    if (!missing && !transient) throw Error(`GitLab registry metadata request failed (HTTP ${response.status})`);
    if (attempt === 5) throw Error('GitLab registry metadata did not become available after six attempts');
    await sleep(1000 * 2 ** attempt);
  }
}

export function assertRegistryArtifact(dist, artifact) {
  const matches = typeof dist?.integrity === 'string'
    ? dist.integrity === artifact.integrity
    : typeof dist?.shasum === 'string' && dist.shasum === artifact.shasum;
  if (!matches) throw Error('Registry artifact does not match the tested tarball; refusing to overwrite it');
}

export async function ensureRegistryArtifact(artifact, {readDist, publish}) {
  const existing = await readDist(false);
  if (existing !== null) {
    assertRegistryArtifact(existing, artifact);
    return 'already-published';
  }
  // A lost publish response must stop this run. A later run reconciles by hash.
  await publish();
  assertRegistryArtifact(await readDist(true), artifact);
  return 'published';
}
