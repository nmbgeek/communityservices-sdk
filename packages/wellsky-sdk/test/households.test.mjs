const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHouseholds} from '@choiceapps/communityservices-sdk/browser';
const date='2026-10-20T16:00:00Z';
const input=()=>({key:'create',headClientId:1,householdType:'Couple With No Children',members:[{clientId:1,relationship:'Self',dateJoined:date},{clientId:2,relationship:'Other relative',dateJoined:date}]});
function fixture(){
 const rows=[],entries=new Map(),calls=[];let fault;
 const store={withLock:async(_,fn)=>fn(),read:async k=>structuredClone(entries.get(k)??[]),write:async(k,v)=>entries.set(k,structuredClone(v))};
 const save=(householdId,body)=>({householdId,householdType:body.householdType,isActive:true,clients:body.householdClients.map(m=>({clientId:m.clientId,headofhouseholdStatus:m.headOfHouseholdStatus,headofhouseholdRelationship:m.headOfHouseholdRelationship,dateJoined:m.dateJoined,dateLeft:m.dateEnded??null,isActive:m.isActive??true}))});
 const api={tenant:testTenant,clients:{get:async({path})=>({clientId:path.clientId,isActive:true})},households:{
  get:async({path})=>structuredClone(rows.find(h=>h.householdId===path.householdId)),
  listForClient:async({path})=>{const values=rows.filter(h=>h.clients.some(c=>c.clientId===path.clientId));if(!values.length)throw Object.assign(Error('missing'),{status:404});return {count:values.length,values:structuredClone(values)};},
  create:async({body})=>{calls.push(body);if(fault!=='before')rows.push(save(rows.length+10,body));if(fault)throw Error('lost');},
  update:async({path,body})=>{calls.push(body);if(fault!=='before')rows[rows.findIndex(h=>h.householdId===path.householdId)]=save(path.householdId,body);if(fault)throw Error('lost');}
 }};
 const ui={confirmNoHouseholds:async()=>true};return {rows,entries,calls,api,store,ui,fault:v=>{fault=v;},helper:()=>createHouseholds({api,store,ui})};
}
test('create, later child, relationship change and end preserve head and old dates; reordered retries make no writes',async()=>{
 const f=fixture(),a=input();await f.helper().create(a);
 const b={key:'child',householdId:10,headClientId:1,householdType:'Two Parent Family',members:[{clientId:3,relationship:'Daughter',dateJoined:'2026-10-22T16:00:00Z'}]};await f.helper().addMembers(b);
 const c={key:'relation',householdId:10,headClientId:1,members:[{clientId:2,relationship:'Significant other'}]};await f.helper().updateRelationships(c);
 const d={key:'leave',householdId:10,headClientId:1,clientIds:[2],dateEnded:'2026-10-23T16:00:00Z'};await f.helper().endMembers(d);
 for(const [method,body] of [['create',{...a,members:a.members.reverse()}],['addMembers',b],['updateRelationships',c],['endMembers',d]])assert.equal((await f.helper()[method](body)).outcome,'already-present');
 assert.equal(f.calls.length,4);assert.equal(f.rows[0].clients[0].dateJoined,new Date(date).toISOString());assert.equal(f.rows[0].clients[1].dateLeft,'2026-10-23T16:00:00.000Z');assert.equal(f.rows[0].clients[2].dateJoined,'2026-10-22T16:00:00.000Z');
});
test('head, invalid date, duplicate and unknown field guards precede writes',async()=>{
 const f=fixture();for(const a of [{...input(),headClientId:9},{...input(),members:[...input().members,input().members[0]]},{...input(),members:[{...input().members[0],dateJoined:'2026-02-30T12:00:00Z'}]},{...input(),headOfHouseholdStatus:false}])await assert.rejects(f.helper().create(a));
 assert.equal(f.calls.length,0);await f.helper().create(input());
 await assert.rejects(f.helper().endMembers({key:'end',householdId:10,headClientId:1,clientIds:[1],dateEnded:date}),/Head cannot/);
 await assert.rejects(f.helper().updateRelationships({key:'head',householdId:10,headClientId:1,members:[{clientId:2,relationship:'Self'}]}),/Head changes/);
 await assert.rejects(f.helper().addMembers({key:'early',householdId:10,headClientId:1,members:[{clientId:3,relationship:'Son',dateJoined:'2026-10-19T16:00:00Z'}]}),/Head must cover/);
 assert.equal(f.calls.length,1);
});
for(const mode of ['before','after'])test(`lost create response ${mode} commit never repeats`,async()=>{
 const f=fixture();f.fault(mode);if(mode==='before'){await assert.rejects(f.helper().create(input()));await assert.rejects(f.helper().create(input()));}else{await f.helper().create(input());await f.helper().create(input());}assert.equal(f.calls.length,1);
});
for(const mode of ['before','after'])test(`lost membership response ${mode} commit never repeats`,async()=>{
 const f=fixture();await f.helper().create(input());f.fault(mode);const b={key:'add',householdId:10,headClientId:1,members:[{clientId:3,relationship:'Son',dateJoined:date}]};
 if(mode==='before'){await assert.rejects(f.helper().addMembers(b));await assert.rejects(f.helper().addMembers(b),/unresolved/);}else{await f.helper().addMembers(b);await f.helper().addMembers(b);}assert.equal(f.calls.length,2);
});
test('conflicting keys, external drift and absent head fail closed',async()=>{
 const f=fixture();await f.helper().create(input());await assert.rejects(f.helper().create({...input(),householdType:'Other'}),/conflicts/);
 f.rows[0].clients[0].headofhouseholdStatus=false;await assert.rejects(f.helper().read(10),/data error/);await assert.rejects(f.helper().create(input()),/data error/);assert.equal(f.calls.length,1);
});
test('UI disagreement, incomplete reads, failed storage and missing tenant never write',async()=>{
 const f=fixture();f.ui.confirmNoHouseholds=async()=>false;await assert.rejects(f.helper().create(input()));assert.equal(f.calls.length,0);
 const g=fixture();g.store.write=async()=>{throw Error('disk');};await assert.rejects(g.helper().create(input()),/disk/);assert.equal(g.calls.length,0);
 const h=fixture();h.api.households.listForClient=async()=>({count:2,values:[]});await assert.rejects(h.helper().create(input()),/Incomplete/);assert.equal(h.calls.length,0);h.api.tenant='';assert.throws(()=>h.helper(),/tenant/);
});

function reuseFixture(){
 const f=fixture(),i=input();
 const clients=i.members.map(m=>({clientId:m.clientId,dateJoined:'2026-01-01T00:00:00Z',dateLeft:null,isActive:true,headofhouseholdStatus:m.clientId===1,headofhouseholdRelationship:m.relationship}));
 const old={...clients[1],dateLeft:'2026-03-01T00:00:00Z',isActive:false};clients[1].dateJoined='2026-05-01T00:00:00Z';
 clients.push(old,{...clients[1],clientId:3});
 f.rows.push({householdId:99,isActive:true,householdType:i.householdType,clients});
 return {...f,i,old,clients,reuse:()=>f.helper().create(i,{reuseContainingHousehold:true})};
}
test('containing household selection uses disjoint intervals at entry and selection and pins the chosen household',async()=>{
 const f=reuseFixture();f.i.members[1].dateJoined='2026-02-20T12:00:00Z';f.i.members[0].dateJoined=f.i.members[1].dateJoined;
 const a=await f.reuse();assert.equal(a.household.householdId,99);assert.equal(a.household.members.length,4);
 assert.equal((await f.reuse()).outcome,'already-present');
 f.rows.push({...f.rows[0],householdId:100});
 await assert.rejects(f.reuse(),e=>e.code==='HOUSEHOLD_MEMBERSHIP_AMBIGUOUS');
 f.rows.shift();await assert.rejects(f.reuse(),e=>e.code==='HOUSEHOLD_MEMBERSHIP_AMBIGUOUS');
 assert.equal(f.calls.length,0);
});
test('ambiguous intervals, boundaries, selection drift and disagreements never create a household',async()=>{
 for(const mode of ['overlap','touch','ended','gap','different relationship','other head','changed detail','drift','multiple']){
  const f=reuseFixture();
  if(mode==='overlap')f.old.dateLeft=date;
  if(mode==='touch')f.old.dateLeft=f.clients[1].dateJoined;
  if(mode==='ended'||mode==='gap')for(const m of f.i.members)m.dateJoined=mode==='ended'?f.old.dateLeft:'2026-04-01T00:00:00Z';
  if(mode==='different relationship')f.clients[1].headofhouseholdRelationship='Son';
  if(mode==='other head')Object.assign(f.clients[3],{headofhouseholdStatus:true,headofhouseholdRelationship:'Self'});
  if(mode==='changed detail'){const get=f.api.households.get;f.api.households.get=async args=>{const h=await get(args);h.clients[1].dateJoined='2026-06-01T00:00:00Z';return h;};}
  if(mode==='drift'){await f.reuse();f.clients[1].dateJoined='2026-07-01T00:00:00Z';}
  if(mode==='multiple')f.rows.push({...f.rows[0],householdId:100});
  await assert.rejects(f.reuse(),e=>e.code==='HOUSEHOLD_MEMBERSHIP_AMBIGUOUS'&&e.nextAction==='staff-review',mode);
  assert.equal(f.calls.length,0);
 }
});
test('opt-in create with no containing household keeps the original write journal',async()=>{
 const f=fixture(),i=input(),options={reuseContainingHousehold:true};
 await f.helper().create(i,options);assert.equal((await f.helper().create(i,options)).outcome,'already-present');assert.equal(f.calls.length,1);
});

test('a prior household with a clearly ended membership does not hide the sole eligible current household',async()=>{
 const f=reuseFixture(),former=structuredClone(f.rows[0]);former.householdId=100;
 Object.assign(former.clients[1],{dateLeft:'2026-09-01T00:00:00Z',isActive:false});f.rows.unshift(former);
 assert.equal((await f.reuse()).household.householdId,99);assert.equal(f.calls.length,0);
});

test('a proven different head does not block the sole eligible household',async()=>{
 const f=reuseFixture(),other=structuredClone(f.rows[0]);other.householdId=100;
 for(const row of other.clients){
  row.headofhouseholdStatus=row.clientId===2;
  row.headofhouseholdRelationship=row.clientId===2?'Self':'Other relative';
 }
 // The other head covers the full known membership history on this candidate.
 other.clients=other.clients.filter(row=>!row.dateLeft);
 other.clients.find(row=>row.clientId===2).dateJoined='2026-01-01T00:00:00Z';
 f.rows.unshift(other);
 const detailReads=[],get=f.api.households.get;
 f.api.households.get=async args=>{detailReads.push(args.path.householdId);return get(args);};
 assert.equal((await f.reuse()).household.householdId,99);
 assert.equal((await f.reuse()).outcome,'already-present');
 assert.deepEqual(detailReads,[99,99]);
 assert.equal(f.calls.length,0);
 // If that candidate's head evidence becomes contradictory or incomplete, require staff review.
 const head=other.clients.find(row=>row.clientId===2),member=other.clients.find(row=>row.clientId===1);
 member.headofhouseholdStatus=true;member.headofhouseholdRelationship='Self';
 await assert.rejects(f.reuse(),{code:'HOUSEHOLD_MEMBERSHIP_AMBIGUOUS'});
 member.headofhouseholdStatus=false;member.headofhouseholdRelationship='Other relative';
 head.dateJoined='2026-10-21T16:00:00Z';
 await assert.rejects(f.reuse(),{code:'HOUSEHOLD_MEMBERSHIP_AMBIGUOUS'});
 assert.equal(f.calls.length,0);
});

const membershipOnly={reuseContainingHousehold:'membership-only'};
const separate={createSeparateHousehold:true};

test('membership-only reuse ignores Household tab labels during selection and on same-key retry',async()=>{
 const f=reuseFixture(),request={key:f.i.key,headClientId:1,members:f.i.members.map(({clientId,dateJoined})=>({clientId,dateJoined}))};
 f.rows[0].householdType='Female Single Parent';
 f.old.headofhouseholdRelationship='Grandson';
 f.clients[1].headofhouseholdRelationship='Other relative';
 for(const member of request.members)member.dateJoined='2026-02-20T12:00:00Z';
 const get=f.api.households.get;
 f.api.households.get=async args=>{
  const result=await get(args);
  result.householdType=null;
  result.clients.find(member=>member.clientId===2&&member.isActive).headofhouseholdRelationship=null;
  return result;
 };
 const first=await f.helper().create(request,membershipOnly);
 assert.equal(first.household.householdId,99);
 assert.equal(first.household.householdType,null);
 assert.equal(first.household.members.find(member=>member.clientId===2&&member.isActive).relationship,null);
 f.rows[0].householdType='Other';
 f.clients[1].headofhouseholdRelationship='Son';
 assert.equal((await f.helper().create({...request,householdType:'Individual'},membershipOnly)).outcome,'already-present');
 f.old.dateLeft=f.clients[1].dateJoined;
 await assert.rejects(f.helper().create(request,membershipOnly),{code:'HOUSEHOLD_MEMBERSHIP_AMBIGUOUS'});
 assert.equal(f.calls.length,0);
});

test('membership-only reuse requires a unique dated roster and a sole head across Household types',async()=>{
 for(const mode of ['no match','multiple','multiple heads','member unavailable','head changed','detail drift']){
  const f=reuseFixture();
  if(mode==='no match'){f.rows.length=0;}
  if(mode==='multiple')f.rows.push({...structuredClone(f.rows[0]),householdId:100,householdType:'Individual'});
  if(mode==='multiple heads')f.clients[1].headofhouseholdStatus=true;
  if(mode==='member unavailable')f.clients[1].isActive=false;
  if(mode==='head changed'){
   f.clients[0].dateJoined='2026-05-01T00:00:00Z';
   f.clients.push({...f.clients[3],isActive:false,headofhouseholdStatus:true,dateJoined:'2026-01-01T00:00:00Z',dateLeft:'2026-03-01T00:00:00Z'});
   f.i.members.forEach(member=>{member.dateJoined='2026-02-20T12:00:00Z';});
  }
  if(mode==='detail drift'){
   const get=f.api.households.get;
   f.api.households.get=async args=>{
    const result=await get(args);result.clients.find(member=>member.clientId===2&&member.isActive).dateJoined='2026-06-01T00:00:00Z';
    return result;
   };
  }
  await assert.rejects(f.helper().create(f.i,membershipOnly),{
   code:mode==='no match'?'HOUSEHOLD_REUSE_NOT_FOUND':'HOUSEHOLD_MEMBERSHIP_AMBIGUOUS',
  },mode);
  assert.equal(f.calls.length,0);
 }
});

test('explicit separate creation creates an exact duplicate once, even with an unsuitable baseline roster',async()=>{
 const f=fixture(),i=input();
 await f.helper().create(i);
 const previous=structuredClone(f.rows[0]);
 f.rows.push({...structuredClone(previous),householdId:20,clients:[...previous.clients,{...previous.clients[1]}]});
 const request={...i,key:'authorized-separate'};
 const result=await f.helper().create(request,separate);
 assert.equal(result.household.householdId,12);
 assert.deepEqual(f.rows[0],previous);
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[1].householdClients.map(member=>member.clientId),[1,2]);
 assert.equal((await f.helper().create(request,separate)).outcome,'already-present');
 await assert.rejects(f.helper().create(request),/key conflicts/);
 await assert.rejects(f.helper().create({...request,key:'conflicting-options'},{...membershipOnly,...separate}),/cannot be combined/);
 assert.equal(f.calls.length,2);
});

test('a separate create with a lost response reconciles the new ID and ignores the exact baseline match',async()=>{
 const f=fixture(),i=input();
 await f.helper().create(i);
 const request={...i,key:'authorized-separate'},create=f.api.households.create,list=f.api.households.listForClient;
 let readUnavailable=false;
 f.fault('after');
 f.api.households.create=async args=>{try{return await create(args);}finally{readUnavailable=true;}};
 f.api.households.listForClient=async args=>{if(readUnavailable)throw Error('List temporarily unavailable');return list(args);};
 await assert.rejects(f.helper().create(request,separate),/lost/);
 assert.deepEqual(f.rows.map(row=>row.householdId),[10,11]);
 readUnavailable=false;
 assert.equal((await f.helper().create(request,separate)).household.householdId,11);
 assert.equal((await f.helper().create(request,separate)).outcome,'already-present');
 assert.equal(f.calls.length,2);
});

test('an attempted create never adopts a baseline ID that becomes an exact match',async()=>{
 const f=fixture(),i=input();
 await f.helper().create({...i,members:[i.members[0],{...i.members[1],relationship:'Son'}]});
 f.fault('before');
 const request={...i,key:'new-attempt'};
 await assert.rejects(f.helper().create(request),/lost/);
 f.rows[0].clients[1].headofhouseholdRelationship=i.members[1].relationship;
 await assert.rejects(f.helper().create(request),/write unresolved/);
 assert.equal(f.calls.length,2);
});

test('a returned household ID remains pinned if readback is interrupted',async()=>{
 const f=fixture(),i=input();
 await f.helper().create(i);
 const request={...i,key:'with-receipt'},create=f.api.households.create,get=f.api.households.get;
 f.api.households.create=async args=>{await create(args);return structuredClone(f.rows.at(-1));};
 f.api.households.get=async()=>{throw Error('Detail unavailable');};
 await assert.rejects(f.helper().create(request,separate),/Detail unavailable/);
 f.rows.push({...structuredClone(f.rows.at(-1)),householdId:50});
 await assert.rejects(f.helper().resolveCreateNotApplied({key:request.key,headClientId:1,confirmedNotApplied:true,evidenceReference:'case-a'}),/without a receipt/);
 f.api.households.get=get;
 assert.equal((await f.helper().create(request,separate)).household.householdId,11);
 assert.equal(f.calls.length,2);
});

test('a legacy unresolved create blocks the same head but an independent head can create and update',async()=>{
 const f=fixture(),i=input();f.fault('before');
 await assert.rejects(f.helper().create(i),/lost/);
 for(const entries of f.entries.values())delete entries[0].headClientId;
 f.fault(null);
 await assert.rejects(f.helper().create({...i,key:'same-head'},separate),/unresolved for this household or head/);
 const other={...i,key:'other-head',headClientId:3,members:[{...i.members[0],clientId:3},{...i.members[1],clientId:4}]};
 const result=await f.helper().create(other,separate);
 await f.helper().updateRelationships({key:'other-update',householdId:result.household.householdId,headClientId:3,members:[{clientId:4,relationship:'Grandson'}]});
 assert.equal(f.calls.length,3);
});

test('an unresolved update blocks writes aimed at the same household even under a different head',async()=>{
 const f=fixture();
 await f.helper().create(input());
 f.fault('before');
 const request={key:'update',householdId:10,headClientId:1,members:[{clientId:2,relationship:'Grandson'}]};
 await assert.rejects(f.helper().updateRelationships(request),/lost/);
 await assert.rejects(f.helper().updateRelationships({...request,key:'another-head',headClientId:2,members:[{clientId:1,relationship:'Grandson'}]}),/unresolved for this household or head/);
 assert.equal(f.calls.length,2);
});

test('an operator can resolve a confirmed unapplied create without releasing its key for replay',async()=>{
 const f=fixture(),i=input(),post=f.api.households.create;
 f.api.households.create=async args=>{
  f.fault('before');
  try{await post(args);}catch{throw Object.assign(Error('Synthetic server rejection'),{status:400});}
 };
 await assert.rejects(f.helper().create(i,separate),{status:400});
 const resolution={key:i.key,headClientId:1,evidenceReference:'staff-case-1',confirmedNotApplied:true};
 await assert.rejects(f.helper().resolveCreateNotApplied({...resolution,confirmedNotApplied:false}),/independent confirmation/);
 f.rows.push({householdId:20,householdType:'Other',isActive:true,clients:[{clientId:1}]});
 await assert.rejects(f.helper().resolveCreateNotApplied(resolution),/requires reconciliation/);
 f.rows.length=0;
 const confirm=f.ui.confirmNoHouseholds;
 f.ui.confirmNoHouseholds=async()=>false;
 await assert.rejects(f.helper().resolveCreateNotApplied(resolution),{status:404});
 f.ui.confirmNoHouseholds=confirm;
 assert.equal((await f.helper().resolveCreateNotApplied(resolution)).outcome,'not-applied');
 assert.equal((await f.helper().resolveCreateNotApplied(resolution)).outcome,'already-resolved');
 await assert.rejects(f.helper().resolveCreateNotApplied({...resolution,evidenceReference:'different-evidence'}),/evidence changed/);
 await assert.rejects(f.helper().create(i,separate),/resolved as not applied/);
 assert.equal(f.calls.length,1);
 f.api.households.create=post;
 f.fault(null);
 assert.equal((await f.helper().create({...i,key:'new-authorized-create'},separate)).household.householdId,10);
 assert.equal(f.calls.length,2);
});

test('multiple new matching households leave an uncertain separate create unresolved',async()=>{
 const f=fixture(),i=input();
 await f.helper().create(i);
 f.fault('before');
 const request={...i,key:'uncertain-separate'};
 await assert.rejects(f.helper().create(request,separate),/lost/);
 f.rows.push(...[20,21].map(householdId=>({...structuredClone(f.rows[0]),householdId})));
 await assert.rejects(f.helper().create(request,separate),/not uniquely verified/);
 assert.equal(f.calls.length,2);
});
