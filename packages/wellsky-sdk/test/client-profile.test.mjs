const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientProfile} from '../browser/client-profile.mjs';

function fixture(){
 const base={firstName:'Synthetic',middleName:'Old',lastName:'Client',suffix:'',search_alias:'Alias',socSecNo:'999001234',nameDataQuality:'Full Name Reported',ssnDataQuality:'Full SSN Reported (HUD)',veteranStatus:'No (HUD)'};
 let rest={clientId:1,isActive:true,...base,svpprofdob:'1980/02/03',svpprofgender:'Legacy',hud_raceethnicity:'White'},sex='Male',restWrites=0,uiWrites=0;
 const entries=new Map(),calls=[];
 const store={withLock:async(_,work)=>work(),read:async k=>structuredClone(entries.get(k)??[]),write:async(k,v)=>entries.set(k,structuredClone(v))};
 const choices={nameDataQuality:['Full Name Reported'],ssnDataQuality:['Full SSN Reported (HUD)'],veteranStatus:['Yes (HUD)','No (HUD)'],sex:['Male','Female','Data not collected']};
 const snapshot=()=>({values:{...Object.fromEntries(Object.keys(base).map(k=>[k,rest[k]])),sex},choices});
 const api={tenant:testTenant,clients:{get:async()=>structuredClone(rest),update:async({body})=>{restWrites++;calls.push(structuredClone(body));rest={...rest,...body,socSecNo:body.socSecNo??''};}}};
 const ui={inspect:async()=>snapshot(),updateSex:async({sex:next,expected,beforeSave})=>{assert.equal(expected.socSecNo,rest.socSecNo);await beforeSave();uiWrites++;sex=next;return snapshot();}};
 return {api,ui,store,calls,entries,getRest:()=>rest,setRest:v=>{rest={...rest,...v};},setSex:v=>{sex=v;},counts:()=>({restWrites,uiWrites}),helper:()=>createClientProfile({api,ui,store})};
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
