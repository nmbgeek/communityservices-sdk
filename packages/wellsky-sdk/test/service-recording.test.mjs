const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceRecorder} from '../browser/service-recording.mjs';

function fixture({lostResponse=false,uncertain=false,uiFailure=false}={}) {
  const journal=new Map(),services=[],snapshots=new Map();let creates=0,saves=0;
  const store={async withLock(_,f){return f();},async read(k){return structuredClone(journal.get(k)??[]);},async write(k,v){journal.set(k,structuredClone(v));}};
  const api={tenant:testTenant,services:{async listForClient(){return {count:services.length,values:services};},async create({body}){creates++;if(uncertain)throw Error('network');const row={...structuredClone(body),serviceId:100+creates,needId:200+creates,isActive:true};services.push(row);if(lostResponse)throw Error('network after commit');return row;},async getComplete({path}){return services.find(s=>s.serviceId===path.serviceId);}},needs:{async getComplete({path}){const s=services.find(s=>s.needId===path.needId);return {...s,needProvider:s.serviceProvider,statusInformation:{needStatus:'Closed',needOutcome:snapshots.has(s.serviceId)?'Fully Met':''}};}}};
  const ui={async assertReady(){},async inspect(c){return snapshots.get(c.serviceId)??{done:false};},matches(s){return s.done===true;},async complete(c,e,before){await before();saves++;if(uiFailure)throw Error('UI failed');const s={done:true};snapshots.set(c.serviceId,s);return s;}};
  return {api,ui,store,journal,services,snapshots,counts:()=>({creates,saves}),recorder:()=>createServiceRecorder({api,ui,store})};
}
const row=(key='one')=>({key,body:{clientId:1,serviceProvider:2,serviceCode:'BH-3800.7000',serviceStartDate:'2026-10-22T16:00:00Z',serviceEndDate:'2026-10-22T16:00:00Z'}});
test('durable row keys survive helper replacement and reordered bulk input',async()=>{
  const f=fixture();await f.recorder().recordBulk([row('one'),row('two')]);const again=await f.recorder().recordBulk([row('two'),row('one')]);
  assert.deepEqual(f.counts(),{creates:2,saves:2});assert.ok(again.results.every(r=>r.value.outcome==='already-present'));
  await assert.rejects(f.recorder().record({...row(),body:{...row().body,serviceCode:'different'}}),/conflicts/);
});
test('committed REST response loss reconciles by marker and never repeats POST',async()=>{
  const f=fixture({lostResponse:true});await f.recorder().record(row());await f.recorder().record(row());assert.deepEqual(f.counts(),{creates:1,saves:1});
});
test('unknown REST outcome blocks subsequent create attempts',async()=>{
  const f=fixture({uncertain:true});await assert.rejects(f.recorder().record(row()),/uncertain/);await assert.rejects(f.recorder().record(row()),/Unresolved/);assert.equal(f.counts().creates,1);
});
test('UI partial failure stops the batch and blocks unsafe save replay',async()=>{
  const f=fixture({uiFailure:true});const r=await f.recorder().recordBulk([row('one'),row('two')]);assert.deepEqual(r.results.map(r=>r.outcome),['rejected','skipped']);
  await assert.rejects(f.recorder().record(row('one')),/unresolved/);assert.deepEqual(f.counts(),{creates:1,saves:1});
});
test('lost UI acknowledgement reconciles if readback proves all fields',async()=>{
  const f=fixture();const complete=f.ui.complete;f.ui.complete=async(...a)=>{await complete(...a);throw Error('lost acknowledgement');};
  await assert.rejects(f.recorder().record(row()));assert.equal((await f.recorder().record(row())).outcome,'verified');assert.deepEqual(f.counts(),{creates:1,saves:1});
});
test('validate entire batch before writing and reject ambiguous funding/key input',async()=>{
  const f=fixture();await assert.rejects(f.recorder().recordBulk([row('one'),{...row('two'),body:{...row().body,serviceStartDate:'2026-10-22'}}]));
  await assert.rejects(f.recorder().recordBulk([row(),row()]));assert.equal(f.counts().creates,0);
  await assert.rejects(async()=>f.recorder().record({...row(),fundingSources:[{fundId:1,fundCycleId:1,name:'A',amount:1.001}]}));
});
test('cancel and callback failure skip remaining rows, never silently restart',async()=>{
  const f=fixture();const r=await f.recorder().recordBulk([row(),row('two')],{onResult(){throw Error('disk');}});assert.equal(r.callbackFailed,true);assert.equal(r.results[1].outcome,'skipped');assert.equal(f.counts().creates,1);
  const cancelled=await f.recorder().recordBulk([row('three')],{signal:AbortSignal.abort()});assert.equal(cancelled.results[0].outcome,'skipped');assert.equal(f.counts().creates,1);
});
test('verify associated need and reject a missing tenant',async()=>{
  const f=fixture();f.api.needs.getComplete=async()=>({clientId:999,needProvider:2,statusInformation:{needStatus:'Closed',needOutcome:'Fully Met'}});await assert.rejects(f.recorder().record(row()),/Associated need/);
  f.api.tenant='';assert.throws(()=>f.recorder(),/tenant/);
});
test('invalid detail objects and calendar dates fail before journaling or creating',async()=>{
 const f=fixture();for(const change of [{serviceCosts:[]},{serviceCosts:false},{ssvfInformation:false},{serviceStartDate:'2026-02-30T12:00:00Z'}])await assert.rejects(f.recorder().recordBulk([row(),{...row('bad'),body:{...row().body,...change}}]));
 assert.equal(f.journal.size,0);assert.equal(f.counts().creates,0);
});
test('expired or occupied UI blocks REST creation before journaling',async()=>{
 const f=fixture();f.ui.assertReady=async()=>{throw Error('Session unavailable');};await assert.rejects(f.recorder().record(row()));assert.equal(f.counts().creates,0);assert.equal(f.journal.size,0);
});
test('counted service pagination rejects changing totals and accepts only initial no-records 404',async()=>{
 const f=fixture();f.api.services.listForClient=async()=>{throw Object.assign(Error('Not found'),{status:404});};await f.recorder().record(row());assert.equal(f.counts().creates,1);
 const g=fixture({uncertain:true});g.api.services.listForClient=async()=>{throw Object.assign(Error('Not found'),{status:404});};await assert.rejects(g.recorder().record(row()));await assert.rejects(g.recorder().record(row()));assert.equal(g.counts().creates,1);
 const h=fixture();h.api.services.listForClient=async({query})=>({count:query.startPage===1?2:3,values:[{clientId:1,serviceId:query.startPage,serviceProvider:999}]});await assert.rejects(h.recorder().record(row()),/count/);assert.equal(h.counts().creates,0);
});

for(const committed of [true,false])test(`expired service save ${committed?'reconciles after reconnect':'remains blocked after reconnect'} without another REST or UI write`,async()=>{
 const {EventEmitter}=await import('node:events');
 const {attachAuthentication,SessionInterruptedError}=await import('../browser/session-authentication.mjs');
 const {withPageLock}=await import('../browser/page-lock.mjs');
 const f=fixture({uiFailure:!committed}),page=new EventEmitter();page.url=()=>`https://wscs.wellsky.com/${testTenant}/com.bowmansystems.sp5.core.ServicePoint/index.html`;let expired=false,reconnections=0;
 page.locator=()=>({count:async()=>Number(expired)});
 attachAuthentication(page,async()=>{expired=false;reconnections++;});
 for(const method of ['assertReady','inspect']){const original=f.ui[method];f.ui[method]=(...args)=>withPageLock(page,()=>original(...args));}
 const complete=f.ui.complete;
 f.ui.complete=(...args)=>withPageLock(page,async()=>{try{await complete(...args);}finally{expired=true;}throw Error('Expired after save');});
 await assert.rejects(f.recorder().record(row()),e=>e instanceof SessionInterruptedError&&e.reauthenticated);
 assert.equal(reconnections,1);
 if(committed)assert.equal((await f.recorder().record(row())).outcome,'verified');
 else await assert.rejects(f.recorder().record(row()),/unresolved/);
 assert.deepEqual(f.counts(),{creates:1,saves:1});
});
test('expired UI between service REST creation and UI completion resumes without a second service',async()=>{
 const {EventEmitter}=await import('node:events');const {attachAuthentication}=await import('../browser/session-authentication.mjs');const {withPageLock}=await import('../browser/page-lock.mjs');
 const f=fixture(),page=new EventEmitter();page.url=()=>`https://wscs.wellsky.com/${testTenant}/com.bowmansystems.sp5.core.ServicePoint/index.html`;let expired=false,reconnections=0;page.locator=()=>({count:async()=>Number(expired)});attachAuthentication(page,async()=>{expired=false;reconnections++;});
 const create=f.api.services.create;f.api.services.create=async(...args)=>{const result=await create(...args);expired=true;return result;};
 for(const method of ['assertReady','inspect','complete']){const original=f.ui[method];f.ui[method]=(...args)=>withPageLock(page,()=>original(...args));}
 await f.recorder().record(row());await f.recorder().record(row());assert.equal(reconnections,1);assert.deepEqual(f.counts(),{creates:1,saves:1});
});
test('bulk diagnostics retain reauthentication status and failed stage without copying payloads',async()=>{
 const f=fixture();f.ui.inspect=async()=>{throw Object.assign(new Error('session'),{name:'SessionInterruptedError',code:'SESSION_INTERRUPTED',reauthenticated:true,headers:{authorization:'secret'},body:'private'});};
 const result=await f.recorder().recordBulk([row(),row('skipped')]);assert.deepEqual(result.results[0].error,{name:'SessionInterruptedError',code:'SESSION_INTERRUPTED',stage:'ui-inspect',reauthenticated:true});assert.equal(result.results[1].outcome,'skipped');assert.doesNotMatch(JSON.stringify(result),/secret|private/);
});
test('REST reconciliation failures preserve the original structured cause',async()=>{
 const f=fixture();f.api.services.create=async()=>{throw Object.assign(Error('upstream'),{code:'ECONNRESET',kind:'network',operation:'POST /services/create',requestId:'test-request'});};
 const result=await f.recorder().recordBulk([row()]);assert.equal(result.results[0].error.stage,'rest-reconcile');assert.equal(result.results[0].error.cause.code,'ECONNRESET');assert.equal(result.results[0].error.cause.requestId,'test-request');
});

test('service retries reject replacement service and need identities without further saves',async()=>{
 for(const field of ['serviceId','needId']){
  const f=fixture();await f.recorder().record(row());
  const get=f.api.services.getComplete;
  f.api.services.getComplete=async args=>({...await get(args),[field]:999});
  await assert.rejects(f.recorder().record(row()),/identity/);
  assert.deepEqual(f.counts(),{creates:1,saves:1});
 }
});

test('wrong service detail identity during reconciliation blocks UI completion',async()=>{
 const f=fixture({lostResponse:true}),get=f.api.services.getComplete;
 f.api.services.getComplete=async args=>({...await get(args),serviceId:999});
 await assert.rejects(f.recorder().record(row()),/identity/);
 assert.deepEqual(f.counts(),{creates:1,saves:0});
});

test('need readback must identify the requested active need, not just matching status',async()=>{
 for(const change of [{needId:999},{isActive:false}]){
  const f=fixture(),get=f.api.needs.getComplete;
  f.api.needs.getComplete=async args=>({...await get(args),...change});
  await assert.rejects(f.recorder().record(row()),/Associated need/);
  await assert.rejects(f.recorder().record(row()),/Associated need/);
  assert.deepEqual(f.counts(),{creates:1,saves:1});
 }
});

test('older service journals acquire a need identity without another save',async()=>{
 const f=fixture();await f.recorder().record(row());
 for(const entries of f.journal.values())delete entries[0].needId;
 assert.equal((await f.recorder().record(row())).outcome,'already-present');
 assert.equal([...f.journal.values()][0][0].needId,201);
 const get=f.api.services.getComplete;
 f.api.services.getComplete=async args=>({...await get(args),needId:999});
 await assert.rejects(f.recorder().record(row()),/identity/);
 assert.deepEqual(f.counts(),{creates:1,saves:1});
});

test('service need association changing during UI completion remains unresolved',async()=>{
 const f=fixture(),complete=f.ui.complete;
 f.ui.complete=async(...args)=>{const result=await complete(...args);f.services[0].needId=999;return result;};
 await assert.rejects(f.recorder().record(row()),/identity/);
 await assert.rejects(f.recorder().record(row()),/identity/);
 assert.deepEqual(f.counts(),{creates:1,saves:1});
});
