import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {verifyInstalledConsumer} from './verify-installed-consumer.mjs';
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this script through npm run package:check');
const temporary = mkdtempSync(join(tmpdir(), 'wellsky-sdk-consumer-'));
const runNpm = args => execFileSync(process.execPath, [npm, ...args, '--cache', join(temporary, 'cache')], { encoding: 'utf8' });
try {
  // Tests/build run in the enclosing npm script; avoid running prepack twice.
  const [packed] = JSON.parse(runNpm(['pack', '--ignore-scripts', '--json']));
  for (const file of packed.files) {
    if (!/^(dist\/|browser\/[a-z-]+\.(mjs|d\.mts)$|docs\/(?:[a-z-]+|README)\.md$|docs\/vendor-issues\/(?:[a-z0-9-]+|README)\.md$|examples\/(?:[a-z-]+|README)\.(md|mjs|mts|ts)$|LICENSE$|NOTICE$|AGENTS\.md$|llms\.txt$|README\.md$|API\.md$|SSVF\.md$|CHANGELOG\.md$|package\.json$|specs\/provenance\.json$)/.test(file.path)) throw new Error(`Unexpected packed file: ${file.path}`);
  }
  const archive = resolve(packed.filename);
  writeFileSync('package-artifact.json', JSON.stringify({ name: packed.name, version: packed.version, filename: packed.filename, integrity: packed.integrity, shasum: packed.shasum }, null, 2) + '\n');
  writeFileSync(join(temporary, 'package.json'), '{"private":true,"type":"module"}\n');
  // Install the optional browser peer from the already-installed local dependency.
  const [peer] = JSON.parse(runNpm(['pack', resolve('node_modules/playwright-core'), '--pack-destination', temporary, '--ignore-scripts', '--json']));
  runNpm(['install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', archive, join(temporary, peer.filename)]);
  await verifyInstalledConsumer(temporary,packed.version);
  console.log(`Verified ${packed.files.length} packed files; archive: ${archive}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
