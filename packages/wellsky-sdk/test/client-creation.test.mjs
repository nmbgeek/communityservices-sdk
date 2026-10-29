const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientCreator} from '@choiceapps/communityservices-sdk/browser';
function fixture(){
 const rows=[],entries=new Map();let writes=0,fault;
 const store={withLock:async(_,fn)=>fn(),read:async k=>structuredClone(entries.get(k)??[]),write:async(k,v)=>entries.set(k,structuredClone(v))};
 const api={tenant:testTenant,clients:{list:async()=>({count:rows.length,values:rows}),get:async({path})=>rows.find(c=>c.clientId===path.clientId),create:async({body})=>{writes++;if(fault==='before')throw Error('lost');const r={clientId:rows.length+1,isActive:true,...body};rows.push(r);if(fault==='after')throw Error('lost');return r;}}};
 return {api,store,rows,entries,helper:()=>createClientCreator({api,store}),fault:v=>{fault=v;},writes:()=>writes};
}
const input=()=>({sourceId:'source-person-1',body:{firstName:'Synthetic',lastName:'Person',dateEffective:'2026-10-20T16:00:00Z'}});
test('invalid veteran labels fail before API access or journal reservation',async()=>{
 for(const veteranStatus of ['Yes','No','',"Client doesn't know",'yes (HUD)',' Yes (HUD)','ENHANCEDYESNO_YES_NONHUD']){
  const f=fixture();f.api.clients.list=async()=>assert.fail('invalid input must not query clients');
  await assert.rejects(f.helper().create({...input(),body:{...input().body,veteranStatus}}),e=>e.code==='INVALID_VETERAN_STATUS');
  assert.equal(f.entries.size,0);assert.equal(f.writes(),0);
 }
});
test('all supported HUD veteran labels survive creation and same-source retries unchanged',async()=>{
 for(const veteranStatus of ['Yes (HUD)','No (HUD)',"Client doesn't know (HUD)",'Client prefers not to answer (HUD)','Data not collected (HUD)']){
  const f=fixture(),request={...input(),body:{...input().body,veteranStatus}};
  await f.helper().create(request);assert.equal((await f.helper().create(request)).outcome,'already-present');
  assert.equal(f.rows[0].veteranStatus,veteranStatus);assert.equal(f.writes(),1);
 }
});
test('rejected veteran input can be corrected under the same unreserved source key',async()=>{
 const f=fixture();await assert.rejects(f.helper().create({...input(),body:{...input().body,veteranStatus:'Yes'}}),e=>e.code==='INVALID_VETERAN_STATUS');
 const request={...input(),body:{...input().body,veteranStatus:'Yes (HUD)'}};
 await f.helper().create(request);await f.helper().create(request);assert.equal(f.writes(),1);
});
test('client source mapping survives replacement and rejects changed intent',async()=>{
 const f=fixture();await f.helper().create(input());assert.equal((await f.helper().create(input())).outcome,'already-present');assert.equal(f.writes(),1);assert.deepEqual(await f.helper().lookup('source-person-1'),{clientId:1,stage:'verified'});await assert.rejects(f.helper().create({...input(),body:{...input().body,firstName:'Changed'}}),e=>e.code==='SOURCE_ID_CONFLICT');
});
test('matching names flag candidates without merging; explicit distinct creation gets its own ID',async()=>{
 const f=fixture();await f.helper().create(input());await assert.rejects(f.helper().create({...input(),sourceId:'second'}),e=>e.code==='POSSIBLE_DUPLICATE'&&e.candidateClientIds[0]===1);assert.equal(f.writes(),1);assert.equal((await f.helper().create({...input(),sourceId:'second',allowDistinctClient:true})).clientId,2);
});
for(const fault of ['before','after'])test(`lost ${fault} creation cannot auto-match or repost`,async()=>{
 const f=fixture();f.fault(fault);await assert.rejects(f.helper().create(input()),e=>e.code==='CLIENT_CREATE_UNCERTAIN');await assert.rejects(f.helper().create(input()),e=>e.code==='CLIENT_CREATE_UNCERTAIN');assert.equal(f.writes(),1);
 if(fault==='after'){await f.helper().resolveCreated({...input(),clientId:1});await f.helper().create(input());assert.equal(f.writes(),1);}else await assert.rejects(f.helper().resolveCreated({...input(),clientId:99}));
});
test('receipt persistence survives failed verification; unresolved IDs require a matching active record',async()=>{
 const f=fixture(),get=f.api.clients.get;let fail=true;f.api.clients.get=async a=>{if(fail)throw Error('read failed');return get(a);};await assert.rejects(f.helper().create(input()));fail=false;await f.helper().create(input());assert.equal(f.writes(),1);
 const g=fixture();g.fault('after');await assert.rejects(g.helper().create(input()));g.rows[0].lastName='Wrong';await assert.rejects(g.helper().resolveCreated({...input(),clientId:1}),e=>e.code==='CLIENT_CREATION_DRIFT');assert.equal(g.writes(),1);
});
test('journal failure, unsupported DOB fields, invalid dates and incomplete candidates prevent creates',async()=>{
 const f=fixture();await assert.rejects(f.helper().create({...input(),body:{...input().body,svpprofdob:'1990-01-01'}}));await assert.rejects(f.helper().create({...input(),body:{...input().body,dateEffective:'2026-02-30T12:00:00Z'}}));f.api.clients.list=async()=>({count:2,values:[]});await assert.rejects(f.helper().create(input()));assert.equal(f.writes(),0);
 const g=fixture();g.store.write=async()=>{throw Error('disk');};await assert.rejects(g.helper().create(input()));assert.equal(g.writes(),0);
});
