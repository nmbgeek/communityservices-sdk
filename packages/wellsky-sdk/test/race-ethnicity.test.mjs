import test from 'node:test';
import assert from 'node:assert/strict';
import {createRaceEthnicity} from '@choiceapps/communityservices-sdk/browser';
import {raceFixture} from './race-fixture.mjs';
const input={key:'race',clientId:1,assessmentCode:'ENTRY',effectiveDate:'2026-11-16T12:00:00Z',answer:{option:{code:'RACE_ETH_WHI'}}};
function fixture(faults={}){
 const f=raceFixture(faults);f.history.push({answerId:90,field:'REQUIRED',id:'20',text:'',date:'2026-11-15T12:00:00Z'});
 return {...f,helper:()=>createRaceEthnicity({api:f.api,enrollmentSession:f.reader,store:f.store,writeLabel:(_q,o)=>o.name})};
}
test('standalone race update works without an enrollment and retains required answers',async()=>{
 const f=fixture();assert.equal((await f.helper().update(input)).outcome,'verified');
 assert.equal((await f.helper().update(input)).outcome,'already-present');
 assert.equal(f.calls.length,1);assert.equal(f.history.find(h=>h.field==='REQUIRED').id,'20');
});
test('repair keeps the recorded choice and requested effective second',async()=>{
 const f=fixture();f.history.push({answerId:91,field:'HUD_RACEETHNICITY',id:'12',text:'',date:input.effectiveDate});
 const {answer,...target}=input;const result=await f.helper().repair(target);
 assert.equal(result.optionId,12);assert.equal(result.categoryText,'ASN,MES');assert.equal(result.requestedEffectiveDate,'2026-11-16T12:00:00.000Z');
 assert.equal((await f.helper().repair(target)).outcome,'already-present');assert.equal(f.calls.length,1);
});
test('standalone lost responses reconcile while missing UI text and failed writes block replay',async()=>{
 const lost=fixture({lostResponse:true});assert.equal((await lost.helper().update(input)).outcome,'reconciled');await lost.helper().update(input);assert.equal(lost.calls.length,1);
 for(const faults of [{noCommit:true},{badText:true}]){const f=fixture(faults);await assert.rejects(f.helper().update(input));await assert.rejects(f.helper().update(input));assert.equal(f.calls.length,1);}
});
test('changed input, missing repair answer, invalid dates and newer values cannot write',async()=>{
 const f=fixture();await f.helper().update(input);await assert.rejects(f.helper().update({...input,answer:{option:{code:'RACE_ETH_COMBO_ASN_MES'}}}));assert.equal(f.calls.length,1);
 const empty=fixture(),{answer,...target}=input;await assert.rejects(empty.helper().repair(target));assert.equal(empty.calls.length,0);
 for(const change of [{effectiveDate:'2026-02-30T12:00:00Z'},{effectiveDate:'2099-01-01T12:00:00Z'},{key:''},{clientId:0}])await assert.rejects(empty.helper().update({...input,...change}));assert.equal(empty.calls.length,0);
});
test('race helpers share the enrollment workflow client lock and retain their own journal',async()=>{
 const f=fixture(),scopes=[],store={...f.store,withLock:async(scope,work)=>{scopes.push(JSON.parse(scope));return work();}};
 const helper=createRaceEthnicity({api:f.api,enrollmentSession:f.reader,store,writeLabel:(_q,o)=>o.name});
 await helper.update(input);assert.deepEqual(scopes.map(s=>s[1]),['enrollment-workflow','race-ethnicity']);assert.ok(scopes.every(s=>s[0]===f.api.tenant&&s[2]===input.clientId));
});
test('missing-answer states retain their explicit category text',async()=>{
 for(const [atomic,combo,name]of [['DONTKNOW','DK',"Client does not know"],['REFUSE','R','Client prefers not to answer'],['DNC','DNC','Data not collected']]){
  const f=fixture(),definition=await f.api.assessments.getDefinition({assessmentCode:'ENTRY'}),question=definition.questions[0];
  question.options.push({id:30+question.options.length,code:'RACE_ETH_'+atomic,name,picklistId:1},{id:31+question.options.length,code:'RACE_ETH_COMBO_'+combo,name,picklistId:1});
  const r=await f.helper().update({...input,key:atomic,answer:{option:{code:'RACE_ETH_'+atomic}}});assert.equal(r.categoryText,combo);
 }
});
