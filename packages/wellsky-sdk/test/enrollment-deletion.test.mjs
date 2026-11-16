import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEnrollmentDeletion, createEnrollmentDeletionUi, createFileGwtMutationStore, resolveUiConnection} from '@choiceapps/communityservices-sdk/browser';

const tenant = process.env.WELLSKY_TEST_TENANT ?? 'tenant-b';
const input = {key:'source-delete-50',clientId:1,enrollmentId:50,providerId:2};
function fixture(faults = {}) {
  let rows = [50,51].map(enrollmentId => ({clientId:1,enrollmentId,enrollmentProvider:2,isActive:true}));
  let attempts = 0, reads = 0;
  const journals = new Map();
  const store = {withLock:async (_,work) => work(),read:async key => structuredClone(journals.get(key) ?? []),write:async (key,value) => {
    if (faults.journalFails) throw Error('journal unavailable');
    journals.set(key,structuredClone(value));
  }};
  const ui = {
    connection:resolveUiConnection({tenant}),withLock:async work => work(),
    listEnrollments:async () => {
      reads++;
      if (faults.readFails || faults.postReadFails && attempts) throw Error('read unavailable');
      const snapshot = {source:'gwt-rpc',tenant,clientId:1,count:rows.length,values:structuredClone(rows)};
      if (faults.badCount) snapshot.count++;
      if (faults.wrongTenant) snapshot.tenant='other-tenant';
      return snapshot;
    },
    confirmDelete:async (_,beforeConfirm) => {
      if (faults.prepareFails) throw Error('unsupported popup');
      await beforeConfirm();attempts++;
      if (!faults.noCommit) rows = rows.filter(row => row.enrollmentId !== 50);
      if (faults.otherDeleted) rows=[];
      if (faults.lostResponse) throw Error('response lost');
    },
  };
  return {ui,store,journals,faults,helper:()=>createEnrollmentDeletion({ui,store}),
    get attempts(){return attempts;},get reads(){return reads;},set rows(value){rows=value;}};
}

test('deletes once and verifies fresh reads across helper recreation', async () => {
  const f=fixture();
  assert.equal((await f.helper().deleteEnrollment(input)).outcome,'deleted');
  assert.equal((await f.helper().deleteEnrollment(input)).outcome,'already-deleted');
  assert.equal(f.attempts,1);assert.equal(f.reads,3);
});
test('reconciles a lost response without another confirmation', async () => {
  const f=fixture({lostResponse:true});
  assert.equal((await f.helper().deleteEnrollment(input)).outcome,'reconciled');
  await f.helper().deleteEnrollment(input);assert.equal(f.attempts,1);
});
test('failed post-write read remains pending and same-key retry reconciles', async () => {
  const f=fixture({postReadFails:true});
  await assert.rejects(f.helper().deleteEnrollment(input),/read unavailable/);
  f.faults.postReadFails=false;
  assert.equal((await f.helper().deleteEnrollment(input)).outcome,'reconciled');
  assert.equal(f.attempts,1);
});
test('uncertain noncommit blocks both same-key and new-key resend', async () => {
  const f=fixture({noCommit:true});
  for (const value of [input,input,{...input,key:'replacement'}])
    await assert.rejects(f.helper().deleteEnrollment(value),error=>error.reason==='unresolved-delete');
  assert.equal(f.attempts,1);
});
test('changed intent and reappearing records cannot silently delete again', async () => {
  const f=fixture();await f.helper().deleteEnrollment(input);
  await assert.rejects(f.helper().deleteEnrollment({...input,enrollmentId:51}),error=>error.reason==='intent-changed');
  f.rows=[{clientId:1,enrollmentId:50,enrollmentProvider:2,isActive:true}];
  await assert.rejects(f.helper().deleteEnrollment(input),error=>error.reason==='record-reappeared');
  assert.equal(f.attempts,1);
});
test('already absent is distinguished from a deletion receipt', async () => {
  const f=fixture();f.rows=[];
  assert.equal((await f.helper().deleteEnrollment(input)).outcome,'already-absent');
  assert.equal(f.attempts,0);assert.equal(f.journals.size,0);
});
test('invalid, failed and incomplete reads or wrong provider cannot confirm', async () => {
  for (const faults of [{badCount:true},{wrongTenant:true},{readFails:true},{prepareFails:true},{journalFails:true}]) {
    const f=fixture(faults);await assert.rejects(f.helper().deleteEnrollment(input));assert.equal(f.attempts,0);
  }
  for (const change of [{clientId:0},{enrollmentId:0},{providerId:0},{providerId:3},{key:''},{key:'a\nb'},{extra:true}]) {
    const f=fixture();await assert.rejects(f.helper().deleteEnrollment({...input,...change}));assert.equal(f.attempts,0);
  }
});
test('disappearance of an unrelated enrollment prevents a verified receipt', async () => {
  const f=fixture({otherDeleted:true});
  await assert.rejects(f.helper().deleteEnrollment(input),error=>error.reason==='other-enrollment-missing');
  assert.equal([...f.journals.values()][0][0].stage,'attempted');
});
test('real file journal survives store and helper recreation', async () => {
  const directory=await mkdtemp(join(tmpdir(),'enrollment-deletion-'));
  try {
    const f=fixture();
    const helper=()=>createEnrollmentDeletion({ui:f.ui,store:createFileGwtMutationStore(directory)});
    await helper().deleteEnrollment(input);
    assert.equal((await helper().deleteEnrollment(input)).outcome,'already-deleted');
    assert.equal(f.attempts,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('browser uses exact trash icon and numbered popup, journals before Yes, and cancels mismatches',
  {skip:!process.env.WELLSKY_TEST_CHROME}, async () => {
    const {chromium}=await import('playwright-core');
    const browser=await chromium.launch({executablePath:process.env.WELLSKY_TEST_CHROME,headless:true});
    try {
      for (const scenario of ['success','wrong-number','shelter','journal-fails','wrong-client','wrong-tenant']) {
        const page=await browser.newPage(),connection=resolveUiConnection({tenant});
        await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`
          <div>Client - (${scenario==='wrong-client'?2:1})</div>
          <img id="ClientEntryExitTab.deleteEntryExit-imageLink_50" title="Delete Entry Exit">
          <img id="ClientEntryExitTab.deleteEntryExit-imageLink_51" title="Delete Entry Exit">
          <div role="alertdialog" aria-label="Please Confirm" hidden>
            <p>${scenario==='shelter'?'The selected Entry/Exit is associated with a shelter stay.':`Are you sure you want to delete this Entry / Exit (#${scenario==='wrong-number'?51:50})?`}</p>
            <div role="button" tabindex="0">Yes</div><div role="button" tabindex="0">No</div>
          </div>
          <script>
            window.events=[];
            const dialog=document.querySelector('[role=alertdialog]');
            document.querySelectorAll('img')[0].onclick=()=>{events.push('trash-50');dialog.hidden=false;};
            document.querySelectorAll('img')[1].onclick=()=>{events.push('trash-51');};
            document.querySelectorAll('[role=button]')[0].onclick=()=>{events.push('yes');document.querySelectorAll('img')[0].remove();dialog.hidden=true;};
            document.querySelectorAll('[role=button]')[1].onclick=()=>{events.push('no');dialog.hidden=true;};
          </script>`}));
        await page.goto(connection.moduleBaseUrl+'index.html');
        const ui=createEnrollmentDeletionUi({page});
        if (scenario==='wrong-tenant') await page.goto(resolveUiConnection({tenant:'other'}).moduleBaseUrl+'index.html');
        const run=()=>ui.withLock(()=>ui.confirmDelete(input,async()=>{
          await page.evaluate(()=>events.push('journal'));
          if(scenario==='journal-fails')throw Error('journal unavailable');
        }));
        if(scenario==='success') await run();else await assert.rejects(run());
        const events=await page.evaluate(()=>window.events);
        assert.deepEqual(events,scenario==='success'?['trash-50','journal','yes']:
          scenario==='journal-fails'?['trash-50','journal','no']:
          ['wrong-client','wrong-tenant'].includes(scenario)?[]:['trash-50','no']);
        await page.close();
      }
    } finally {await browser.close();}
  });
