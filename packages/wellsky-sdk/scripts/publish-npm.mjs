import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, basename, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateNpmRelease, readNpmDist} from './npm-release.mjs';
import {ensureRegistryArtifact} from './release-registry.mjs';
import {verifyInstalledConsumer} from './verify-installed-consumer.mjs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const artifact = JSON.parse(readFileSync('package-artifact.json', 'utf8'));
if (typeof artifact.filename !== 'string' || basename(artifact.filename) !== artifact.filename || !artifact.filename.endsWith('.tgz')) {
  throw Error('Expected a tested tarball in the package directory');
}
const archive = resolve(artifact.filename);
validateNpmRelease(pkg, artifact, readFileSync(archive), process.env);
const temporary = mkdtempSync(join(tmpdir(), 'communityservices-npm-'));
try {
  const npmrc = join(temporary, '.npmrc');
  writeFileSync(npmrc, 'registry=https://registry.npmjs.org/\n@choiceapps:registry=https://registry.npmjs.org/\n', {mode: 0o600});
  const env = {...process.env, NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_CACHE: join(temporary, 'cache')};
  const publication = await ensureRegistryArtifact(artifact, {
    readDist: wait => readNpmDist(artifact, wait),
    publish: () => execFileSync('npm', ['publish', archive, '--ignore-scripts', '--access', 'public', '--provenance', '--registry', 'https://registry.npmjs.org/', '--tag', pkg.version.includes('-') ? 'next' : 'latest'], {env, stdio: 'inherit'}),
  });
  const dist = await readNpmDist(artifact, true);
  if (!dist.attestations?.provenance) throw Error('Published npm package has no provenance attestation');
  writeFileSync(join(temporary, 'package.json'), '{"private":true,"type":"module"}\n');
  const peerVersion = JSON.parse(readFileSync('node_modules/playwright-core/package.json', 'utf8')).version;
  execFileSync('npm', ['install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `${pkg.name}@${pkg.version}`, `playwright-core@${peerVersion}`], {env, stdio: 'inherit'});
  await verifyInstalledConsumer(temporary, pkg.version);
  console.log(`Verified ${publication} ${pkg.name}@${pkg.version}, npm provenance, and installed consumers.`);
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
