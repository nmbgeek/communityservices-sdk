import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

// Read-only drift check. Updating snapshots requires reviewing the upstream diff.
for (const version of ['v2', 'v3']) {
  const response = await fetch(`https://csclientapi.wellsky.com/client-api-prod/swagger/${version}/swagger.json`, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${version}: HTTP ${response.status}`);
  const live = await response.json();
  const pinned = JSON.parse(readFileSync(`specs/${version}.json`, 'utf8'));
  if (!isDeepStrictEqual(live, pinned)) throw new Error(`${version}: upstream specification changed. Review and update specs/${version}.json, provenance.json, then npm run generate.`);
  console.log(`${version}: live specification matches pinned snapshot`);
}
