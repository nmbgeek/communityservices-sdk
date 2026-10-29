import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {verifyInstalledConsumer} from './verify-installed-consumer.mjs';
import {readRegistryDist, ensureRegistryArtifact} from './release-registry.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const artifact = JSON.parse(readFileSync('package-artifact.json', 'utf8'));
const tag = process.env.CI_COMMIT_TAG;
const version = tag ? tag.replace(/^v/, '') : process.env.RELEASE_VERSION;
if (!version || version !== pkg.version || artifact.version !== pkg.version || artifact.name !== pkg.name) throw new Error('Release version, package, and tested artifact must match');
if (!tag && process.env.CI_COMMIT_BRANCH !== process.env.CI_DEFAULT_BRANCH) throw new Error('Manual releases must run from the default branch');
if (!process.env.CI_JOB_TOKEN || !process.env.CI_API_V4_URL || !/^\d+$/.test(process.env.CI_PROJECT_ID ?? '')) throw new Error('Publishing requires GitLab CI job credentials and project identity');
const registry = new URL(`${process.env.CI_API_V4_URL.replace(/\/$/, '')}/projects/${process.env.CI_PROJECT_ID}/packages/npm/`);
if (registry.protocol !== 'https:' || registry.username || registry.password) throw new Error('GitLab npm registry must use HTTPS');
const temporary = mkdtempSync(join(tmpdir(), 'wellsky-publish-'));
try {
  const npmrc = join(temporary, '.npmrc');
  const scope = pkg.name.split('/')[0];
  if (!scope.startsWith('@')) throw new Error('SDK package must be scoped');
  // Keep a literal environment reference in this temporary file, never the token value.
  writeFileSync(npmrc, `${scope}:registry=${registry.href}\n//${registry.host}${registry.pathname}:_authToken=\${CI_JOB_TOKEN}\n`, { mode: 0o600 });
  const env = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_CACHE: join(temporary, 'cache') };
  const publication = await ensureRegistryArtifact(artifact, {
    readDist: waitForPublication => readRegistryDist(registry, artifact, process.env.CI_JOB_TOKEN, {waitForPublication}),
    publish: () => execFileSync('npm', ['publish', resolve(artifact.filename), '--ignore-scripts', '--registry', registry.href, '--tag', pkg.version.includes('-') ? 'next' : 'latest'], { env, stdio: 'inherit' }),
  });
  writeFileSync(join(temporary, 'package.json'), '{"private":true,"type":"module"}\n');
  const peerVersion=JSON.parse(readFileSync('node_modules/playwright-core/package.json','utf8')).version;
  execFileSync('npm', ['install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `${pkg.name}@${pkg.version}`, `playwright-core@${peerVersion}`], { env, stdio: 'inherit' });
  await verifyInstalledConsumer(temporary,pkg.version);
  console.log(`Verified ${publication} artifact and installed ${pkg.name}@${pkg.version} from the GitLab package registry.`);
} finally { rmSync(temporary, { recursive: true, force: true }); }
