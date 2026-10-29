import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {GwtEnrollmentHelpers,createInMemoryGwtMutationStore} from '../dist/esm/index.js';
const base='https://training.invalid/synthetic/com.bowmansystems.sp5.core.ServicePoint/';
const add={clientId:1,enrollmentId:10,memberClientIds:[2]};
const update={clientId:1,enrollmentId:10,clientIds:[1,2],reviewDate:'2026-10-21T12:00:00-04:00'};
const prepareBody=intent=>{
 const types=intent.kind==='add-household-members'?['updateEntryExitWithHouseholdMembers','com.bowmansystems.sp5.model.client.SpEntryExit/3620680162','java.util.ArrayList/4159755760','Z']:['createEntryExitReviewWithHouseholdMembers','com.bowmansystems.sp5.model.client.SpEntryExitReview/594863492','java.util.ArrayList/4159755760'];
 const strings=[base,'B'.repeat(32),'com.bowmansystems.sp5.core.client.services.GenericService',...types];
 return `7|0|${strings.length}|${strings.join('|')}|1|2|3|4|${types.length-1}|${types.slice(1).map((_,i)=>i+5).join('|')}|0|0|0|0|0|0|`;
};
function fixture({enrolled=false,store=createInMemoryGwtMutationStore()}={}){
 const state={source:'gwt-rpc',tenant:'synthetic',sessionId:'session-one',revision:'v1',clientId:1,enrollmentId:10,projectStartDate:'2026-10-18T16:00:00Z',householdClientIds:[1,2,3],members:[{clientId:1,enrollmentId:10}],reviews:[]};
 if(enrolled)state.members.push({clientId:2,enrollmentId:11});
 const counts={read:0,prepare:0,send:0};let preparedIntent;
 const commit=()=>{if(preparedIntent.kind==='add-household-members'){for(const clientId of preparedIntent.memberClientIds)if(!state.members.some(m=>m.clientId===clientId))state.members.push({clientId,enrollmentId:10+clientId});}else state.reviews.push({reviewId:20,type:'Update',reviewDate:preparedIntent.reviewDate,clientIds:preparedIntent.clientIds});state.revision+='x';};
 const session={
  async readEnrollment(){counts.read++;return structuredClone(state);},
  async prepare(intent,snapshot){counts.prepare++;preparedIntent=intent;return {intent,sessionId:snapshot.sessionId,revision:snapshot.revision,capturedAt:Date.now(),url:base+'service/ClientService',headers:{'Content-Type':'text/x-gwt-rpc; charset=utf-8','X-GWT-Module-Base':base,'X-GWT-Permutation':'A'.repeat(32)},body:prepareBody(intent)};},
  async send(){counts.send++;commit();return {status:200,body:'//OK[1]'};},
 };
 const options={tenant:'synthetic',moduleBaseUrl:base,session,store};
 return {state,counts,session,options,commit,helper:new GwtEnrollmentHelpers(options)};
}

function singleReviewFixture(){
 const f=fixture();f.state.householdClientIds=[1];
 const prepare=f.session.prepare;
 f.session.prepare=async(...args)=>{
  const p=await prepare(...args);
  // Match the observed one-parameter signature; the adapter owns model serialization.
  const strings=[base,'B'.repeat(32),'com.bowmansystems.sp5.core.client.services.GenericService','createEntryExitReview','com.bowmansystems.sp5.model.client.SpEntryExitReview/594863492'];
  p.body=`7|0|${strings.length}|${strings.join('|')}|1|2|3|4|1|5|0|0|0|0|0|0|`;
  return p;
 };
 return f;
}

test('fresh member payload writes once and repeated call reads without preparing or sending',async()=>{
 const f=fixture();assert.equal((await f.helper.addHouseholdMembers(add)).outcome,'written');
 assert.equal((await f.helper.addHouseholdMembers(add)).outcome,'reconciled');assert.equal(f.counts.prepare,1);assert.equal(f.counts.send,1);
});
test('interim date is canonicalized without shifting; equivalent offsets identify an existing review',async()=>{
 const f=fixture({enrolled:true});assert.equal((await f.helper.createInterimUpdate(update)).outcome,'written');assert.equal(f.state.reviews[0].reviewDate,'2026-10-21T16:00:00.000Z');
 assert.equal((await f.helper.createInterimUpdate({...update,clientIds:[2,1],reviewDate:'2026-10-21T16:00:00Z'})).outcome,'reconciled');assert.equal(f.counts.send,1);
});
test('single-client interim signature writes once and a fresh helper reconciles repeat calls',async()=>{
 const f=singleReviewFixture(),args={...update,clientIds:[1]};
 assert.equal((await f.helper.createInterimUpdate(args)).outcome,'written');
 assert.deepEqual(f.state.reviews[0].clientIds,[1]);
 const restarted=new GwtEnrollmentHelpers(f.options);
 assert.equal((await restarted.createInterimUpdate({...args,reviewDate:'2026-10-21T16:00:00Z'})).outcome,'reconciled');
 assert.equal(f.state.reviews.length,1);assert.equal(f.counts.prepare,1);assert.equal(f.counts.send,1);
});
test('single-client interim signature cannot submit household, subset, member-add or wrong-type payloads',async()=>{
 const cases=[
  f=>{f.state.householdClientIds=[1,2];f.state.members.push({clientId:2,enrollmentId:11});return {...update,clientIds:[1,2]};},
  f=>{f.state.householdClientIds=[1,2];f.state.members.push({clientId:2,enrollmentId:11});return {...update,clientIds:[1]};},
  f=>{f.state.householdClientIds=[1,2];return {...update,clientIds:[1]};},
  f=>{f.state.members.push({clientId:2,enrollmentId:11});return {...update,clientIds:[1]};},
 ];
 for(const configure of cases){const f=singleReviewFixture(),args=configure(f);await assert.rejects(f.helper.createInterimUpdate(args),e=>e.kind==='protocol');assert.equal(f.counts.send,0);}
 for(const change of [
  p=>{p.body=p.body.replace('SpEntryExitReview/594863492','SpEntryExit/3620680162');},
  p=>{p.body=p.body.replace('SpEntryExitReview/594863492','SpEntryExitReview/123');},
  p=>{p.body=p.body.replace('|1|2|3|4|1|5|','|1|2|3|4|2|5|');},
  p=>{p.capturedAt-=60000;},
  p=>{p.sessionId='another-session';},
 ]){
  const f=singleReviewFixture(),prepare=f.session.prepare;
  f.session.prepare=async(...args)=>{const p=await prepare(...args);change(p);return p;};
  await assert.rejects(f.helper.createInterimUpdate({...update,clientIds:[1]}),e=>e.kind==='protocol');assert.equal(f.counts.send,0);
 }
 const f=singleReviewFixture();f.state.householdClientIds=[1,2];
 await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.kind==='protocol');assert.equal(f.counts.send,0);
});
test('existing state is returned without preparing or sending a write',async()=>{
 const f=fixture({enrolled:true});assert.equal((await f.helper.addHouseholdMembers(add)).outcome,'already-present');assert.equal(f.counts.prepare,0);assert.equal(f.counts.send,0);
});

test('adopted membership and reviews survive restart and cannot be recreated after removal',async()=>{
 for(const kind of ['member','review']){
  const f=fixture({enrolled:true});
  if(kind==='review')f.state.reviews.push({reviewId:20,type:'Update',reviewDate:update.reviewDate,clientIds:[1,2]});
  const call=helper=>kind==='member'?helper.addHouseholdMembers(add):helper.createInterimUpdate(update);
  assert.equal((await call(f.helper)).outcome,'already-present');
  const restarted=new GwtEnrollmentHelpers(f.options);
  assert.equal((await call(restarted)).outcome,'reconciled');
  if(kind==='member')f.state.members=f.state.members.filter(m=>m.clientId!==2);else f.state.reviews=[];
  await assert.rejects(call(restarted),e=>e.reason==='previously-verified-missing');
  assert.equal(f.counts.send,0);assert.equal(f.counts.prepare,0);
 }
});

test('adopting existing state requires durable journal persistence',async()=>{
 const f=fixture({enrolled:true});f.options.store.write=async()=>{throw Error('disk full');};
 await assert.rejects(f.helper.addHouseholdMembers(add),/disk full/);assert.equal(f.counts.send,0);
});
test('two helper instances sharing a store serialize concurrent identical writes',async()=>{
 const f=fixture(),other=new GwtEnrollmentHelpers(f.options);
 await Promise.all([f.helper.addHouseholdMembers(add),other.addHouseholdMembers(add)]);assert.equal(f.counts.send,1);
});
test('response loss after commit is reconciled without retrying',async()=>{
 const f=fixture();f.session.send=async()=>{f.counts.send++;f.commit();throw Error('secret transport body');};
 assert.equal((await f.helper.addHouseholdMembers(add)).outcome,'reconciled');assert.equal(f.counts.send,1);
});
test('post-send read failure blocks same and different writes until original operation is observed',async()=>{
 const f=fixture();const read=f.session.readEnrollment;let failed=false;
 f.session.send=async()=>{f.counts.send++;failed=true;return {status:200,body:'//OK[1]'};};
 f.session.readEnrollment=async()=>{if(failed)throw Error('42703: column v.entry_date_effective does not exist');return read();};
 await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.kind==='ambiguous_commit'&&!e.message.includes('42703'));
 failed=false;const restarted=new GwtEnrollmentHelpers(f.options);
 await assert.rejects(restarted.addHouseholdMembers(add),e=>e.kind==='ambiguous_commit');
 await assert.rejects(restarted.addHouseholdMembers({...add,memberClientIds:[3]}),e=>e.kind==='ambiguous_commit');assert.equal(f.counts.send,1);
 f.commit();assert.equal((await restarted.addHouseholdMembers(add)).outcome,'reconciled');assert.equal(f.counts.send,1);
});
test('HTTP errors, network errors and GWT exceptions never trigger another send',async()=>{
 for(const result of [{status:401,body:'denied'},{status:500,body:'failed'},{status:200,body:'//EX["failure"]'},null]){
  const f=fixture();f.session.send=async()=>{f.counts.send++;if(!result)throw Error('network');return result;};
  await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.kind==='ambiguous_commit');await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.kind==='ambiguous_commit');assert.equal(f.counts.send,1);
 }
});
test('read failures, malformed snapshots and REST snapshots fail closed before preparation',async()=>{
 for(const change of [f=>{f.session.readEnrollment=async()=>{throw Error('private data');};},f=>f.state.source='rest',f=>f.state.members=[],f=>f.state.reviews=null,f=>f.state.tenant='production',f=>f.state.members.push({clientId:1,enrollmentId:12})]){
  const f=fixture();change(f);await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.kind==='protocol'&&!e.message.includes('private'));assert.equal(f.counts.prepare,0);assert.equal(f.counts.send,0);
 }
});
test('same-date partial or duplicate reviews are conflicts, not permission to create another',async()=>{
 for(const reviews of [[{reviewId:20,type:'Update',reviewDate:update.reviewDate,clientIds:[1]}],[{reviewId:20,type:'Update',reviewDate:update.reviewDate,clientIds:[1,2]},{reviewId:21,type:'Update',reviewDate:update.reviewDate,clientIds:[1,2]}]]){
  const f=fixture({enrolled:true});f.state.reviews=reviews;await assert.rejects(f.helper.createInterimUpdate(update),e=>e.reason==='review-conflict');assert.equal(f.counts.send,0);
 }
});
test('rejects non-household members, non-enrolled review members and reviews preceding entry',async()=>{
 const f=fixture();await assert.rejects(f.helper.addHouseholdMembers({...add,memberClientIds:[4]}),e=>e.reason==='not-household-member');await assert.rejects(f.helper.createInterimUpdate(update),e=>e.reason==='not-enrolled');
 f.state.members.push({clientId:2,enrollmentId:11});await assert.rejects(f.helper.createInterimUpdate({...update,reviewDate:'2026-10-17T16:00:00Z'}),e=>e.reason==='review-before-entry');assert.equal(f.counts.send,0);
});
test('invalid input is rejected while production classification does not gate access',async()=>{
 const f=fixture();for(const args of [{...add,clientId:0},{...add,memberClientIds:[]},{...add,memberClientIds:[2,2]},{...add,memberClientIds:[1]}])assert.throws(()=>f.helper.addHouseholdMembers(args),e=>e.kind==='validation');
 for(const reviewDate of ['2026-10-21T12:00:00','2026-02-30T12:00:00Z'])assert.throws(()=>f.helper.createInterimUpdate({...update,reviewDate}),e=>e.kind==='validation');
 assert.doesNotThrow(()=>new GwtEnrollmentHelpers({...f.options,}));assert.equal(f.counts.read,0);
});
test('stale, misbound, cross-origin, wrong-method, credential-bearing and schema-drift payloads are refused',async()=>{
 const changes=[p=>p.capturedAt-=60000,p=>p.capturedAt+=60000,p=>p.sessionId='other',p=>p.intent.enrollmentId=99,p=>p.url='https://evil.invalid/',p=>p.headers.Cookie='secret',p=>p.headers['X-GWT-Module-Base']='https://evil.invalid/',p=>p.body=p.body.replace('updateEntryExitWithHouseholdMembers','deleteEntryExit'),p=>p.body=p.body.replace('SpEntryExit/3620680162','SpEntryExit/123')];
 for(const change of changes){const f=fixture();const prepare=f.session.prepare;f.session.prepare=async(...args)=>{const p=await prepare(...args);change(p);return p;};await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.kind==='protocol');assert.equal(f.counts.send,0);}
});
test('enrollment or session changes during preparation prevent submission',async()=>{
 for(const field of ['revision','sessionId']){const f=fixture();const prepare=f.session.prepare;f.session.prepare=async(...args)=>{const p=await prepare(...args);f.state[field]='changed';return p;};await assert.rejects(f.helper.addHouseholdMembers(add),e=>e.reason==='concurrent-change');assert.equal(f.counts.send,0);}
});
test('journal persistence failure prevents send; verified state disappearing cannot silently recreate',async()=>{
 const f=fixture();f.options.store.write=async()=>{throw Error('disk full');};await assert.rejects(f.helper.addHouseholdMembers(add),/disk full/);assert.equal(f.counts.send,0);
 const g=fixture();await g.helper.addHouseholdMembers(add);g.state.members=g.state.members.filter(m=>m.clientId!==2);await assert.rejects(g.helper.addHouseholdMembers(add),e=>e.reason==='previously-verified-missing');assert.equal(g.counts.send,1);
});
test('exports work from all six package entry points',async()=>{
 const require=createRequire(import.meta.url);for(const name of ['index','v2','v3'])for(const mod of [await import(`../dist/esm/${name}.js`),require(`../dist/cjs/${name}.js`)]){assert.equal(typeof mod.GwtEnrollmentHelpers,'function');assert.equal(typeof mod.createInMemoryGwtMutationStore,'function');}
});

for(const committed of [true,false])test(`reauthentication after an interrupted enrollment write ${committed?'reconciles its commit':'blocks an uncertain absent write'}`,async()=>{
 const {EventEmitter}=await import('node:events');
 const {attachAuthentication,SessionInterruptedError}=await import('../browser/session-authentication.mjs');
 const {withPageLock}=await import('../browser/page-lock.mjs');
 const f=fixture(),page=new EventEmitter();page.url=()=>base+'index.html';let expired=false,reconnections=0;
 page.locator=()=>({count:async()=>Number(expired)});
 attachAuthentication(page,async()=>{expired=false;reconnections++;f.state.sessionId='refreshed-session';});
 const originalRead=f.session.readEnrollment;
 f.session.readEnrollment=async()=>{if(expired)throw Error('Session expired during verification');return originalRead();};
 f.session.send=async()=>{f.counts.send++;if(committed)f.commit();expired=true;throw Error('Lost save response');};
 const store={...f.options.store,withLock:(scope,work)=>withPageLock(page,()=>f.options.store.withLock(scope,work))};
 const helper=new GwtEnrollmentHelpers({...f.options,store});
 await assert.rejects(helper.addHouseholdMembers(add),e=>e instanceof SessionInterruptedError&&e.reauthenticated);
 assert.equal(reconnections,1);assert.equal(f.counts.send,1);
 if(committed)assert.equal((await helper.addHouseholdMembers(add)).outcome,'reconciled');
 else await assert.rejects(helper.addHouseholdMembers(add),e=>e.kind==='ambiguous_commit');
 assert.equal(f.counts.send,1);assert.equal(f.counts.prepare,1);
});
