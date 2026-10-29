const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createNeedRecorder,NeedConflictError} from '@choiceapps/communityservices-sdk/browser';
const {collectNeedPages}=await import(new URL('./need-ui.mjs',import.meta.resolve('@choiceapps/communityservices-sdk/browser')));
const input={key:'pit-source-1',clientId:1,providerId:3,serviceCodeId:60,needDate:'2026-01-22T20:00:00-05:00',status:'Identified',outcome:'Not Met',reasonUnmet:'All Services Full',note:'Synthetic PIT need'};
function fixture(){
 const records=[],journal=new Map();let writes=0,fail,readFail=false;
 const store={withLock:async(_s,fn)=>fn(),read:async s=>structuredClone(journal.get(s)??[]),write:async(s,e)=>journal.set(s,structuredClone(e))};
 const ui={list:async()=>{if(readFail)throw Error('Unavailable read');return structuredClone(records);},create:async(values,before)=>{await before();writes++;if(fail==='before')throw Error('Lost response');records.push({...values,needId:10,serviceCount:0});if(fail==='after')throw Error('Lost response');}};
 return {records,journal,store,ui,recorder:()=>createNeedRecorder({ui,store,tenant:testTenant}),writes:()=>writes,setFail:v=>{fail=v;},setReadFail:v=>{readFail=v;}};
}
test('independent need retains explicit PIT status, same-key retry does not write',async()=>{
 const f=fixture(),first=await f.recorder().record(input);assert.equal(first.outcome,'verified');assert.equal(first.need.status,'Identified');assert.equal(first.need.outcome,'Not Met');assert.equal(first.need.needDate,'2026-01-23T01:00:00.000Z');assert.equal(first.need.serviceCount,0);
 const retry=await f.recorder().record(input);assert.equal(retry.outcome,'already-present');assert.equal(retry.need.needId,10);assert.equal(f.writes(),1);
});
test('lost save response reconciles by durable marker, without another click',async()=>{
 const f=fixture();f.setFail('after');assert.equal((await f.recorder().record(input)).outcome,'reconciled');await f.recorder().record(input);assert.equal(f.writes(),1);
});
test('uncertain absence never permits a second write; delayed record can reconcile',async()=>{
 const f=fixture();f.setFail('before');await assert.rejects(f.recorder().record(input),/Lost response/);await assert.rejects(f.recorder().record(input),e=>e.reason==='unresolved-save');assert.equal(f.writes(),1);
});
test('failed reads never prove absence',async()=>{const f=fixture();f.setReadFail(true);await assert.rejects(f.recorder().record(input),/Unavailable/);assert.equal(f.writes(),0);assert.equal(f.journal.size,0);});
for(const change of [{clientId:2},{providerId:4},{status:'Closed'},{needDate:'2026-01-24T01:00:00Z'},{amount:10},{note:'Changed'}])test('source key rejects changed intent '+Object.keys(change)[0],async()=>{
 const f=fixture();await f.recorder().record(input);await assert.rejects(f.recorder().record({...input,...change}),e=>e instanceof NeedConflictError&&e.reason==='intent-changed');assert.equal(f.writes(),1);
});
for(const [change,reason]of [[{needId:11},'identity-changed'],[{note:'External change'},'identity-changed'],[{providerId:4},'stored-fields-changed'],[{amount:2},'stored-fields-changed'],[{status:'Closed'},'stored-fields-changed'],[{serviceCount:1},'service-attached']])test('external changes are never overwritten '+Object.keys(change)[0],async()=>{
 const f=fixture();await f.recorder().record(input);Object.assign(f.records[0],change);const before=structuredClone(f.records);await assert.rejects(f.recorder().record(input),e=>e.reason===reason);assert.deepEqual(f.records,before);assert.equal(f.writes(),1);
});
test('duplicate markers and missing records fail closed',async()=>{
 const f=fixture();await f.recorder().record(input);f.records.push({...f.records[0],needId:11});await assert.rejects(f.recorder().record(input),e=>e.reason==='duplicate-marker');f.records.length=0;await assert.rejects(f.recorder().record(input),e=>e.reason==='identity-changed');assert.equal(f.writes(),1);
});
test('read failure after successful save reconciles after helper replacement',async()=>{
 const f=fixture(),create=f.ui.create;f.ui.create=async(v,b)=>{await create(v,b);f.setReadFail(true);};await assert.rejects(f.recorder().record(input),/Unavailable/);f.setReadFail(false);assert.equal((await f.recorder().record(input)).outcome,'reconciled');assert.equal(f.writes(),1);
});
test('invalid input is rejected before reads, journals, or writes',async()=>{
 const f=fixture();for(const change of [{clientId:-1},{serviceCodeId:'60'},{needDate:'2026-02-30T00:00:00Z'},{needDate:'2026-01-22'},{needDate:'2026-01-22T00:00:00.123Z'},{status:''},{outcome:'Fully Met'},{amount:0.001},{note:'[sdk-need:forged]'},{extra:true}])await assert.rejects(f.recorder().record({...input,...change}));assert.equal(f.writes(),0);assert.equal(f.journal.size,0);
});
test('counted catalog pagination returns all unique ordered IDs',async()=>{
 const data=Array.from({length:501},(_,i)=>({id:i+1})),offsets=[];assert.deepEqual(await collectNeedPages(async(offset,size)=>{offsets.push(offset);return {total:data.length,rows:data.slice(offset,offset+size)};},'id'),data);assert.deepEqual(offsets,[0,500]);
});
test('catalog fails on truncation, changing counts, duplicate IDs, or excessive totals',async()=>{
 await assert.rejects(collectNeedPages(async()=>({total:1,rows:[]}),'id'),/Incomplete/);
 await assert.rejects(collectNeedPages(async()=>({total:2,rows:[{id:1},{id:1}]}),'id'),/Duplicate/);
 await assert.rejects(collectNeedPages(async()=>({total:50001,rows:[]}),'id'),/count/);
 await assert.rejects(collectNeedPages(async offset=>({total:offset?502:501,rows:offset?[{id:501}]:Array.from({length:500},(_,i)=>({id:i+1}))}),'id'),/count/);
 assert.deepEqual(await collectNeedPages(async()=>({total:0,rows:[]}),'id'),[]);
});
test('a journal persistence failure prevents the save',async()=>{
 const f=fixture();f.store.write=async()=>{throw Error('Journal disk unavailable');};await assert.rejects(f.recorder().record(input),/Journal disk unavailable/);assert.equal(f.writes(),0);assert.equal(f.records.length,0);
});
test('corrupt journal never permits a write',async()=>{
 const f=fixture();f.store.read=async()=>[{stage:'unknown'}];await assert.rejects(f.recorder().record(input),/Invalid independent need journal/);assert.equal(f.writes(),0);
});
test('a stale cached service code is rejected in the real UI adapter before journaling',async()=>{
 const {EventEmitter}=await import('node:events');
 const {createNeedUi}=await import('@choiceapps/communityservices-sdk/browser');
 const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
 const page=new EventEmitter();let journalCalls=0,reads=0;
 page.url=()=>base+'index.html#loadClient;clientId=1';page.waitForFunction=async()=>{};
 page.locator=selector=>({count:async()=>0,isVisible:async()=>false,waitFor:async()=>{},innerText:async()=>{assert.equal(selector,'body');return 'Client - (1)';}});
 page.getByText=label=>{assert.equal(label,'Provider');return {locator:()=>({innerText:async()=>'Provider (3)'})};};
 page.getByRole=(role,{name})=>({click:async()=>{
  assert.ok(role==='tab'||name==='Add Need');
  page.emit('request',{url:()=>base+'service/MetaQueryService',postData:()=> '7|0|0|base|policy|getMappedResults|',allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'fixture'})});
 }});
 page.evaluate=async(_fn,args)=>{
  reads++;assert.ok(args.body.includes('c.serviceCodeId = 60'));assert.ok(args.body.includes('c.active = true AND c.assignable = true'));assert.ok(!args.body.includes('serviceCodeTypeId IN'));
  return {status:200,body:'//OK[0,3,-1,0,0,2,1,["com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582","java.util.ArrayList/4159755760","java.lang.Integer/3438268394"],0,7]'};
 };
 await assert.rejects(createNeedUi({page}).create({...input,note:'synthetic',amount:null,reasonUnmet:null},async()=>{journalCalls++;}),/no longer active\/assignable/);
 assert.equal(reads,1);assert.equal(journalCalls,0);
 page.url=()=>base.replace(testTenant,'different-tenant')+'index.html';
 await assert.rejects(createNeedUi({page}).listServiceTypes({clientId:1}),/Configured application page required/);assert.equal(reads,1);
});
