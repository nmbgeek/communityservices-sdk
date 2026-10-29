import test from 'node:test';
import assert from 'node:assert/strict';
import {withPageLock} from '../browser/page-lock.mjs';
import {createClientWorkflows} from '../browser/client-workflows.mjs';

test('browser operations serialize by page and release after failures', async () => {
  const page = {}, otherPage = {}, events = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withPageLock(page, async () => { events.push('first'); await gate; throw Error('failed'); });
  const rejected = assert.rejects(first, /failed/);
  const second = withPageLock(page, async () => events.push('second'));
  await withPageLock(otherPage, async () => events.push('other'));
  assert.deepEqual(events, ['first', 'other']);
  release(); await rejected; await second;
  assert.deepEqual(events, ['first', 'other', 'second']);
  await withPageLock(page, async () => events.push('released'));
  assert.equal(events.at(-1), 'released');
});

test('invalid uploads and case notes fail before browser or journal access', async () => {
  const forbidden = new Proxy({}, {get(_target,key) { if(key==='url')return ()=>'https://wscs.wellsky.com/synthetic/com.bowmansystems.sp5.core.ServicePoint/index.html';throw Error('Unexpected external access'); }});
  const workflows = createClientWorkflows({page:forbidden, store:forbidden});
  for (const file of [
    {name:'../secret.txt',buffer:new Uint8Array([1])},
    {name:'empty.txt',buffer:new Uint8Array()},
    {name:'large.txt',buffer:new Uint8Array(10_000_001)},
  ]) await assert.rejects(workflows.uploadAttachment({clientId:1,location:{kind:'profile'},file}), /Invalid attachment/);
  await assert.rejects(workflows.uploadAttachment({clientId:1,location:{kind:'goal',goalId:-1},file:{name:'x',buffer:new Uint8Array([1])}}), /Positive integer ID/);
  for (const noteDate of ['2026-02-30','2026-10-21T12:00:00Z']) {
    await assert.rejects(workflows.createCaseNote({clientId:1,goalId:2,providerId:3,noteDate,note:'synthetic'}), /valid calendar date/);
  }
});
test('explicit goal case-note source keys reject changed intent before touching the page',async()=>{
 const stored={intent:{clientId:1,goalId:2,providerId:3,noteDate:'2026-10-24',checksum:'original-hash'},state:'verified',noteId:5};let touched=false,scope;
 const page=new Proxy({},{get(_target,key){if(key==='url')return ()=>'https://wscs.wellsky.com/synthetic/com.bowmansystems.sp5.core.ServicePoint/index.html';touched=true;throw Error('Page must not be used');}});
 const store={withLock:async(s,f)=>{scope=s;return f();},read:async()=>[stored],write:async()=>{throw Error('Must not write');}};
 const workflows=createClientWorkflows({page,store});
 await assert.rejects(workflows.createCaseNote({key:'source-1',clientId:1,goalId:2,providerId:3,noteDate:'2026-10-24',note:'Changed'}),e=>e.code==='CASE_NOTE_SOURCE_CONFLICT');assert.equal(touched,false);assert.match(scope,/case-note-source/);assert.doesNotMatch(scope,/source-1/);
});
