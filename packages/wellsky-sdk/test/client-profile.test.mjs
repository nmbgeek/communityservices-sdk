const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientProfile} from '@choiceapps/communityservices-sdk/browser';

function fixture(){
 const base={firstName:'Synthetic',middleName:'Old',lastName:'Client',suffix:'',search_alias:'Alias',socSecNo:'999001234',nameDataQuality:'Full Name Reported',ssnDataQuality:'Full SSN Reported (HUD)',veteranStatus:'No (HUD)'};
 let rest={clientId:1,isActive:true,...base,svpprofdob:'1980/02/03',svpprofgender:'Legacy',hud_raceethnicity:'White'},sex='Male',restWrites=0,uiWrites=0;
 const entries=new Map(),calls=[];
 const store={withLock:async(_,work)=>work(),read:async k=>structuredClone(entries.get(k)??[]),write:async(k,v)=>entries.set(k,structuredClone(v))};
 const choices={nameDataQuality:['Full Name Reported'],ssnDataQuality:['Full SSN Reported (HUD)'],veteranStatus:['Yes (HUD)','No (HUD)'],sex:['Male','Female','Data not collected']};
 const snapshot=()=>({values:{...Object.fromEntries(Object.keys(base).map(k=>[k,rest[k]])),sex},choices});
 const api={tenant:testTenant,clients:{get:async()=>structuredClone(rest),update:async({body})=>{restWrites++;calls.push(structuredClone(body));rest={...rest,...body,socSecNo:body.socSecNo??''};}}};
 const ui={inspect:async()=>snapshot(),updateSex:async({sex:next,expected,beforeSave})=>{assert.equal(expected.socSecNo,rest.socSecNo);await beforeSave();uiWrites++;sex=next;return snapshot();}};
 return {api,ui,store,calls,entries,getRest:()=>rest,setRest:v=>{rest={...rest,...v};},setSex:v=>{sex=v;},counts:()=>({restWrites,uiWrites}),helper:onDiagnostic=>createClientProfile({api,ui,store,onDiagnostic})};
}
const input=(changes={middleName:'New',sex:'Female'})=>({key:'stable',clientId:1,changes,dateEffective:'2026-10-23T16:00:00Z'});
test('profile veteran updates use exact UI choices and preserve retry identity',async()=>{
 const f=fixture();await assert.rejects(f.helper().update(input({veteranStatus:'Yes'})),/Unavailable Client Record choice: veteranStatus/);
 assert.equal(f.entries.size,0);assert.deepEqual(f.counts(),{restWrites:0,uiWrites:0});
 const request=input({veteranStatus:'Yes (HUD)'});await f.helper().update(request);
 assert.equal((await f.helper().update(request)).outcome,'already-present');
 assert.equal(f.getRest().veteranStatus,'Yes (HUD)');assert.deepEqual(f.counts(),{restWrites:1,uiWrites:0});
});

test('profile updates preserve SSN and all unrequested fields; replacement helpers reuse the journal',async()=>{
 const f=fixture();const first=await f.helper().update(input());assert.equal(first.values.socSecNo,'999001234');assert.equal(first.values.sex,'Female');
 assert.equal(f.calls[0].socSecNo,'999001234');assert.equal(f.calls[0].lastName,'Client');assert.equal(f.calls[0].sex,undefined);
 assert.equal((await f.helper().update(input())).outcome,'already-present');assert.deepEqual(f.counts(),{restWrites:1,uiWrites:1});
 assert.equal(f.getRest().svpprofdob,'1980/02/03');assert.equal(f.getRest().svpprofgender,'Legacy');
});
test('Sex-only update makes no REST write and read reconciles both sources',async()=>{
 const f=fixture();await f.helper().update({key:'sex',clientId:1,changes:{sex:'Female'}});assert.deepEqual(f.counts(),{restWrites:0,uiWrites:1});assert.equal((await f.helper().read(1)).values.sex,'Female');
});
test('unknown, out-of-range and invalid choices fail without reserving a write',async()=>{
 for(const changes of [{sex:'Other'},{svpprofgender:'Female'},{firstName:'x'.repeat(31)},{socSecNo:'123'},{phone:'555'},{sex:null},{}]){
  const f=fixture();await assert.rejects(f.helper().update(input(changes)));assert.deepEqual(f.counts(),{restWrites:0,uiWrites:0});assert.equal(f.entries.size,0);
 }
 const f=fixture();await assert.rejects(f.helper().update({...input(),dateEffective:'2026-02-30T16:00:00Z'}));await assert.rejects(f.helper().update({...input(),dateEffective:undefined}));assert.equal(f.entries.size,0);
});
for(const committed of [true,false])test(`lost REST response ${committed?'reconciles':'blocks repetition'}`,async()=>{
 const f=fixture(),original=f.api.clients.update;let attempts=0;
 f.api.clients.update=async args=>{attempts++;if(committed)await original(args);throw Error('network');};
 if(committed){await f.helper().update(input());await f.helper().update(input());}
 else{await assert.rejects(f.helper().update(input()));await assert.rejects(f.helper().update(input()),/unresolved/);}
 assert.equal(attempts,1);
});
for(const committed of [true,false])test(`lost Sex acknowledgement ${committed?'reconciles':'blocks repetition'}`,async()=>{
 const f=fixture(),original=f.ui.updateSex;let attempts=0;
 f.ui.updateSex=async args=>{attempts++;if(committed)await original(args);else await args.beforeSave();throw Error('interrupted');};
 await assert.rejects(f.helper().update(input()));
 if(committed)assert.equal((await f.helper().update(input())).outcome,'verified');
 else await assert.rejects(f.helper().update(input()),/unresolved/);
 assert.equal(attempts,1);assert.equal(f.counts().restWrites,1);
});
test('failed journal persistence stops mutations; unresolved work blocks a different key',async()=>{
 const f=fixture();f.store.write=async()=>{throw Error('disk');};await assert.rejects(f.helper().update(input()),/disk/);assert.deepEqual(f.counts(),{restWrites:0,uiWrites:0});
 const g=fixture();g.api.clients.update=async()=>{throw Error('network');};await assert.rejects(g.helper().update(input()));await assert.rejects(g.helper().update({...input(),key:'new'}),/unresolved/);
});
test('reject conflicting keys and drift rather than overwrite later edits',async()=>{
 const f=fixture();await f.helper().update(input());await assert.rejects(f.helper().update(input({middleName:'Different'})),/conflicts/);
 f.setSex('Male');await assert.rejects(f.helper().update(input()),/unresolved or changed/);assert.deepEqual(f.counts(),{restWrites:1,uiWrites:1});
 const g=fixture();const update=g.api.clients.update;g.api.clients.update=async args=>{await update(args);g.setRest({svpprofdob:'1999/01/01'});};await assert.rejects(g.helper().update(input()),/readback mismatch/);assert.equal(g.counts().uiWrites,0);
});
test('no-op updates avoid writes and actual clear requests preserve other fields',async()=>{
 const f=fixture();await f.helper().update(input({middleName:'Old'}));assert.deepEqual(f.counts(),{restWrites:0,uiWrites:0});
 await f.helper().update({...input({middleName:'',search_alias:''}),key:'clear'});assert.equal(f.getRest().socSecNo,'999001234');assert.equal(f.getRest().middleName,'');
});
test('UI and API disagreement prevents writes, and a missing tenant is rejected',async()=>{
 const f=fixture();const inspect=f.ui.inspect;f.ui.inspect=async()=>{const result=await inspect();result.values.middleName='Concurrent';return result;};await assert.rejects(f.helper().update(input()),/disagree/);assert.equal(f.entries.size,0);
 f.api.tenant='';assert.throws(()=>f.helper(),/tenant/);
});

test('a rejected PUT retains its HTTP status across a read-only retry without leaking its error or identifiers',async()=>{
 const f=fixture(),events=[];let puts=0,locked=false;
 f.store.withLock=async(_,work)=>{assert.equal(locked,false);locked=true;try{return await work();}finally{locked=false;}};
 const rejected=Object.assign(Error('private response body 999001234'),{status:401,requestId:'private-request',operation:'private-url',responseBody:'private-body'});
 f.api.clients.update=async()=>{puts++;throw rejected;};
 const request={...input({middleName:'New'}),key:'private-operation-key'};
 const listener=event=>{assert.equal(locked,false);events.push(event);};
 await assert.rejects(f.helper(listener).update(request),e=>e===rejected);
 const original=events.find(e=>e.reason==='REST_WRITE_REJECTED');
 assert.equal(original.httpStatus,401);assert.equal(original.writes.rest,'dispatched');assert.equal(original.stage,'rest-attempted');
 events.length=0;
 await assert.rejects(f.helper(listener).update(request),/refusing another write/);
 const [retry]=events;
 assert.equal(puts,1);assert.equal(retry.phase,'reconciliation');assert.equal(retry.reason,'REST_TARGET_MISMATCH');
 assert.deepEqual(retry.writes,{rest:'read-only',ui:'read-only'});
 assert.deepEqual(retry.firstFailure,{transport:'rest',phase:'write',stage:'rest-attempted',dispatch:'dispatched',reason:'REST_WRITE_REJECTED',httpStatus:401});
 assert.deepEqual(retry.comparison,{kind:'rest-target',fieldDetail:'available',differingFields:['middleName'],intendedFieldsMatch:false,protectedFieldsMatch:true});
 const json=JSON.stringify([original,retry]);
 assert.doesNotMatch(json,/private|999001234|Synthetic|1980|Old|New|clientId|keyHash|Tag|[a-f0-9]{64}/);
});

for(const committed of [false,true])test('UI timeout with later readback, committed='+committed,async()=>{
 const f=fixture(),events=[];let saves=0;
 f.ui.updateSex=async({beforeSave,afterSaveClick})=>{
  await beforeSave();saves++;afterSaveClick();if(committed)f.setSex('Female');
  throw Object.assign(Error('private DOM content'),{name:'TimeoutError'});
 };
 const request=input({sex:'Female'});
 await assert.rejects(f.helper(e=>events.push(e)).update(request));
 const first=events.at(-1);
 assert.equal(first.reason,'UI_SAVE_UNCONFIRMED');assert.equal(first.writes.ui,'dispatched');
 assert.equal(first.browserFailure,'timeout');assert.equal(first.nextAction,'verify-same-key');
 events.length=0;
 const retry=f.helper(e=>events.push(e)).update(request);
 if(committed)assert.equal((await retry).outcome,'verified');
 else await assert.rejects(retry,/refusing another save/);
 const last=events.at(-1);assert.equal(last.firstFailure.browserFailure,'timeout');
 assert.deepEqual(last.writes,{rest:'read-only',ui:'read-only'});assert.equal(saves,1);
 assert.equal(last.reason,committed?'PROFILE_VERIFIED':'UI_TARGET_MISMATCH');
 assert.equal(last.nextAction,committed?'none':'staff-review');
 assert.deepEqual(last.comparison.differingFields,committed?[]:['sex']);
 assert.equal(last.comparison.intendedFieldsMatch,committed);assert.equal(last.comparison.protectedFieldsMatch,true);
 assert.doesNotMatch(JSON.stringify(events),/Female|Male|private|999001234/);
});

test('protected discrepancies survive restarts and legacy whole-record journals retain the replay guard',async()=>{
 for(const legacy of [false,true]){
  const f=fixture(),events=[],put=f.api.clients.update;let puts=0;
  f.api.clients.update=async args=>{puts++;await put(args);f.setRest({svpprofdob:'private-date',phone:'private-phone'});};
  const request=input({middleName:'New'});
  await assert.rejects(f.helper(legacy?undefined:e=>events.push(e)).update(request),/readback mismatch/);
  const [entry]=[...f.entries.values()][0];
  if(legacy){assert.equal(entry.protectedFieldTags,undefined);assert.equal(entry.firstFailure,undefined);}
  events.length=0;
  await assert.rejects(f.helper(e=>events.push(e)).update(request),/Unrequested profile fields changed/);
  const event=events.at(-1);assert.equal(puts,1);assert.equal(event.writes.rest,'read-only');
  assert.equal(event.reason,'PROTECTED_FIELDS_CHANGED');assert.equal(event.nextAction,'staff-review');
  assert.equal(event.comparison.intendedFieldsMatch,true);assert.equal(event.comparison.protectedFieldsMatch,false);
  assert.equal(event.comparison.fieldDetail,legacy?'unavailable':'available');
  if(legacy)assert.ok(!Object.hasOwn(event.comparison,'differingFields'));
  else assert.deepEqual(event.comparison.differingFields,['svpprofdob','phone']);
  assert.doesNotMatch(JSON.stringify(events),/private-|Synthetic|New|1980|999001234|[a-f0-9]{64}/);
 }
});

test('unknown dispatch and an unavailable follow-up read keep the original failure',async()=>{
 const f=fixture(),events=[],get=f.api.clients.get;
 f.api.clients.update=async()=>{f.api.clients.get=async()=>{throw Object.assign(Error('read'),{status:503});};throw Error('connection lost');};
 await assert.rejects(f.helper(e=>events.push(e)).update(input()),/read/);
 assert.equal(events[0].reason,'REST_WRITE_UNCONFIRMED');assert.equal(events[0].writes.rest,'unknown');
 assert.equal(events.at(-1).reason,'REST_READ_FAILED');assert.equal(events.at(-1).httpStatus,503);
 assert.equal(events.at(-1).firstFailure.reason,'REST_WRITE_UNCONFIRMED');
 f.api.clients.get=get;events.length=0;
 await assert.rejects(f.helper(e=>events.push(e)).update(input()),/refusing another write/);
 assert.equal(events[0].writes.rest,'read-only');assert.equal(events[0].firstFailure.reason,'REST_WRITE_UNCONFIRMED');
});

test('observer failures cannot block, mutate or replay profile work',async()=>{
 const f=fixture();
 let observed=0,underLock=false;
 f.store.withLock=async(_,work)=>{underLock=true;try{return await work();}finally{underLock=false;}};
 const observer=e=>{
  assert.equal(underLock,false);observed++;e.writes.rest='changed';e.comparison.differingFields.push('secret');
  if(observed===1)throw Error('listener failed');
  return Promise.reject(Error('async listener failed'));
 };
 assert.equal((await f.helper(observer).update(input())).outcome,'verified');
 assert.equal(observed,2);assert.deepEqual(f.counts(),{restWrites:1,uiWrites:1});
 assert.equal((await f.helper(()=>new Promise(()=>{})).update(input())).outcome,'already-present');
 await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(JSON.stringify([...f.entries.values()]),/secret|listener/);
});

test('a pre-dispatch authentication failure differs from an unconfirmed Save click',async()=>{
 const f=fixture(),events=[];
 f.api.clients.update=async()=>{throw Object.assign(Error('private'),{operation:'POST /authentication/SetAuthKey',status:401});};
 await assert.rejects(f.helper(e=>events.push(e)).update(input()));
 assert.equal(events[0].reason,'REST_WRITE_NOT_SENT');assert.equal(events[0].writes.rest,'read-only');
 const g=fixture();events.length=0;
 g.ui.updateSex=async({beforeSave})=>{await beforeSave();throw Object.assign(Error('private'),{name:'TimeoutError'});};
 await assert.rejects(g.helper(e=>events.push(e)).update(input({sex:'Female'})));
 assert.equal(events.at(-1).writes.ui,'unknown');assert.equal(events.at(-1).firstFailure.dispatch,'unknown');
});

test('unrequested Client Record fields are attributed individually across a retry',async()=>{
 const f=fixture(),events=[],put=f.api.clients.update;
 f.api.clients.update=async args=>{await put(args);f.setRest({lastName:'private-drift'});};
 await assert.rejects(f.helper(e=>events.push(e)).update(input({middleName:'New'})));
 events.length=0;
 await assert.rejects(f.helper(e=>events.push(e)).update(input({middleName:'New'})),/refusing another write/);
 assert.equal(events[0].reason,'PROTECTED_FIELDS_CHANGED');assert.equal(events[0].comparison.protectedFieldsMatch,false);
 assert.deepEqual(events[0].comparison.differingFields,['lastName']);assert.equal(f.counts().restWrites,1);
});

test('a successful readback of a PUT with a lost response retains first failure on verified retries',async()=>{
 const f=fixture(),events=[],put=f.api.clients.update;
 f.api.clients.update=async args=>{await put(args);throw Error('private');};
 assert.equal((await f.helper(e=>events.push(e)).update(input({middleName:'New'}))).outcome,'verified');
 assert.equal(events.at(-1).reason,'PROFILE_VERIFIED');assert.equal(events.at(-1).firstFailure.reason,'REST_WRITE_UNCONFIRMED');
 events.length=0;
 assert.equal((await f.helper(e=>events.push(e)).update(input({middleName:'New'}))).outcome,'already-present');
 assert.deepEqual(events.at(-1).writes,{rest:'read-only',ui:'read-only'});
 assert.equal(events.at(-1).firstFailure.dispatch,'unknown');assert.equal(f.counts().restWrites,1);
});
