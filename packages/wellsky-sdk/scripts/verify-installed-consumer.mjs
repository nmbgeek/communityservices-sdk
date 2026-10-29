import {writeFileSync,readFileSync,readdirSync,cpSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {checkDocumentation} from './check-docs.mjs';
const require=createRequire(import.meta.url);

/** Verify only imports from the installed SDK; source files supply tests and expectations. */
export async function verifyInstalledConsumer(temporary,expectedVersion){
  const installed=join(temporary,'node_modules/@choiceapps/communityservices-sdk');
  const manifest=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));
  if(manifest.name!=='@choiceapps/communityservices-sdk'||manifest.version!==expectedVersion)throw Error('Installed package identity/version mismatch');
  if(manifest.license!=='Apache-2.0')throw Error('Installed package license mismatch');
  for(const file of ['LICENSE','NOTICE'])if(!readFileSync(file).equals(readFileSync(join(installed,file))))throw Error('Installed license notice differs: '+file);
  await checkDocumentation(installed);
  const examples=readdirSync('examples').sort();
  if(JSON.stringify(examples)!==JSON.stringify(readdirSync(join(installed,'examples')).sort()))throw Error('Installed example inventory differs from source');
  for(const file of examples)if(!readFileSync(join('examples',file)).equals(readFileSync(join(installed,'examples',file))))throw Error('Installed example differs: '+file);
  cpSync(join(installed,'examples'),join(temporary,'examples'),{recursive:true});
  writeFileSync(join(temporary,'examples.tsconfig.json'),JSON.stringify({compilerOptions:{target:'ES2022',module:'NodeNext',moduleResolution:'NodeNext',strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,skipLibCheck:true,types:[],allowJs:true,rootDir:'examples',outDir:'compiled-examples'},include:['examples/*.ts','examples/*.mts','examples/*.mjs']}));
  execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'-p',join(temporary,'examples.tsconfig.json')],{stdio:'inherit'});
  cpSync('scripts/verify-installed-examples.mjs',join(temporary,'check-examples.mjs'));
  execFileSync(process.execPath,[join(temporary,'check-examples.mjs')],{cwd:temporary,stdio:'inherit'});
  // Resolve the installed public entry point, including its private authentication
  // hooks for fault injection, without source fallbacks or import rewriting.
  const regressionFiles=['tenant-connections.test.mjs','attachment-retry.test.mjs','client-creation.test.mjs','session-authentication.test.mjs','needs.test.mjs','gwt-mapped.test.mjs','shelters.test.mjs','shelter-inventory.test.mjs','current-living-situation.test.mjs','enrollment-workflow.test.mjs','household-enrollment-workflow.test.mjs','date-of-birth.test.mjs','review-regressions.test.mjs'];
  for(const file of regressionFiles)cpSync(join('test',file),join(temporary,file));
  execFileSync(process.execPath,['--test','--test-concurrency=2',...regressionFiles.map(file=>join(temporary,file))],{cwd:temporary,stdio:'inherit'});
  writeFileSync(join(temporary, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { WellSkyClient as Root } from '@choiceapps/communityservices-sdk';
import { WellSkyClient as V2 } from '@choiceapps/communityservices-sdk/v2';
import { WellSkyClient as V3 } from '@choiceapps/communityservices-sdk/v3';
import { openEnrollmentSession, createClientWorkflows, createServiceUi, createServiceRecorder, createProgramDiscovery, createEnrollmentWorkflow, getSsvfServiceRules, createClientProfile, createClientProfileUi, createDateOfBirth, createDateOfBirthUi, createHouseholds, createHouseholdUi, createClientCreator, createCasePlans, createCasePlanUi, createNeedUi, createNeedRecorder } from '@choiceapps/communityservices-sdk/browser';
import { readProgramCatalog } from '@choiceapps/communityservices-sdk';
assert.equal(typeof openEnrollmentSession, 'function');
assert.equal(typeof createClientWorkflows, 'function');
assert.equal(getSsvfServiceRules().serviceTypes.length, 10);
for (const helper of [createServiceUi, createServiceRecorder, createProgramDiscovery, createEnrollmentWorkflow, readProgramCatalog, createClientProfile, createClientProfileUi, createDateOfBirth, createDateOfBirthUi, createHouseholds, createHouseholdUi, createClientCreator, createCasePlans, createCasePlanUi, createNeedUi, createNeedRecorder]) assert.equal(typeof helper, 'function');
const require = createRequire(import.meta.url);
for (const [Client, version] of [[Root, '3.0'], [V2, '2.0'], [V3, '3.0'], [require('@choiceapps/communityservices-sdk').WellSkyClient, '3.0'], [require('@choiceapps/communityservices-sdk/v2').WellSkyClient, '2.0'], [require('@choiceapps/communityservices-sdk/v3').WellSkyClient, '3.0']]) {
  const client = new Client({ tenant: 'synthetic', auth: { kind: 'token', token: 'example' }, fetch: async (url, init) => {
    assert.equal(init.headers.get('x-version'), version);
    assert.equal(new URL(url).pathname, '/client-api-prod/clients/123');
    return new Response('[{"clientId":123}]');
  } });
  assert.deepEqual(await client.clients.get({ path: { clientId: 123 } }), [{ clientId: 123 }]);
}
console.log('Installed package: all six REST ESM/CommonJS entry points and the optional ESM browser entry work');
`);
  const browserTypeConsumer = `
import { AttachmentConflictError, type VeteranStatus, type ClientCreationInput } from '@choiceapps/communityservices-sdk/browser';
const veteranStatus: VeteranStatus = 'Yes (HUD)';
const clientCreation: ClientCreationInput = {sourceId:'synthetic',body:{firstName:'Synthetic',lastName:'Test',dateEffective:'2026-10-24T16:00:00Z',veteranStatus}};
// @ts-expect-error Unsuffixed labels are rejected before creation.
clientCreation.body.veteranStatus = 'Yes';
const conflictCode: 'ATTACHMENT_CONFLICT' = new AttachmentConflictError('identity-changed','Synthetic conflict').code;
void conflictCode;
`;
  writeFileSync(join(temporary,'browser-consumer.mts'),browserTypeConsumer);
  // Match the browser examples' peer-declaration settings while checking our
  // actual consumer assignments, including the rejected veteran label.
  execFileSync(process.execPath,[require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext',join(temporary,'browser-consumer.mts')],{stdio:'inherit'});
  const typeConsumer = `
import { WellSkyClient, type ClientViewModelV2, type CountedCollection, toItems } from '@choiceapps/communityservices-sdk';
import { WellSkyClient as V2 } from '@choiceapps/communityservices-sdk/v2';
import { WellSkyClient as V3 } from '@choiceapps/communityservices-sdk/v3';
const options = { tenant: 'synthetic', auth: { kind: 'none' as const } };
const client = new WellSkyClient(options);
const result: Promise<ClientViewModelV2[]> = client.clients.get({ path: { clientId: 123 } }).then(toItems);
const counted: CountedCollection<ClientViewModelV2> = {count:1,values:[{clientId:123}]};
const countedItems: ClientViewModelV2[] = toItems(counted);
void new V2(options).clients.list();
void new V3(options).clients.list();
// @ts-expect-error Packaged declarations must enforce required request fields.
void client.clients.get({ path: { clientId: 'bad' } });
`;
  writeFileSync(join(temporary, 'consumer.mts'), typeConsumer);
  writeFileSync(join(temporary, 'consumer.cts'), typeConsumer);
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', join(temporary, 'consumer.mts'), join(temporary, 'consumer.cts')], { stdio: 'inherit' });
  execFileSync(process.execPath, [join(temporary, 'smoke.mjs')], { stdio: 'inherit' });
}
