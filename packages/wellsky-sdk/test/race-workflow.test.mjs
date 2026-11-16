import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnrollmentWorkflow} from '@choiceapps/communityservices-sdk/browser';
import {raceFixture} from './race-fixture.mjs';
test('race writes use standard labels and verify UI category text; retry makes no write',async()=>{
 const f=raceFixture();await f.workflow().createEnrollment(f.input);
 assert.equal(f.calls.filter(c=>c.method==='standard').length,1);
 assert.ok(f.calls.filter(c=>c.method==='mobile').every(c=>c.body.every(q=>q.virt_field_name!=='HUD_RACEETHNICITY')));
 assert.equal(f.history.find(h=>h.field==='HUD_RACEETHNICITY').text,'WHI');
 const count=f.calls.length;await f.workflow().createEnrollment(f.input);assert.equal(f.calls.length,count);
});

test('multiple selections use the resolved combination and preserve required values',async()=>{
 const f=raceFixture();f.input.assessment.answers.HUD_RACEETHNICITY={option:{code:'RACE_ETH_COMBO_ASN_MES'}};
 await f.workflow().createEnrollment(f.input);
 assert.equal(f.history.find(h=>h.field==='HUD_RACEETHNICITY').text,'ASN,MES');
 assert.equal(f.history.find(h=>h.field==='REQUIRED').id,'20');
 assert.deepEqual(f.calls.find(c=>c.method==='standard').body.map(q=>q.answer_value),['Asian; Middle Eastern','Keep this']);
});
test('matching numeric lookup with missing UI text cannot verify or trigger another write',async()=>{
 const f=raceFixture({badText:true});await assert.rejects(f.workflow().createEnrollment(f.input));
 await assert.rejects(f.workflow().createEnrollment(f.input));assert.equal(f.calls.filter(c=>c.method==='standard').length,1);
});
test('lost standard response reconciles through raw UI text without resending',async()=>{
 const f=raceFixture({lostResponse:true});await f.workflow().createEnrollment(f.input);await f.workflow().createEnrollment(f.input);
 assert.equal(f.calls.filter(c=>c.method==='standard').length,1);
});
test('unresolved race writes remain blocked on the original journal',async()=>{
 const f=raceFixture({noCommit:true});await assert.rejects(f.workflow().createEnrollment(f.input));
 await assert.rejects(f.workflow().createEnrollment(f.input));assert.equal(f.calls.filter(c=>c.method==='standard').length,1);
});
test('missing authoritative reader and newer answers refuse before enrollment creation',async()=>{
 const missing=raceFixture();delete missing.reader.readRaceEthnicity;
 await assert.rejects(missing.workflow().createEnrollment(missing.input),e=>e.code==='RACE_ETHNICITY_READER_REQUIRED');assert.equal(missing.calls.length,0);
 const newer=raceFixture();newer.history.push({answerId:90,field:'HUD_RACEETHNICITY',id:'11',text:'WHI',date:'2026-11-17T12:00:00Z'});
 await assert.rejects(newer.workflow().createEnrollment(newer.input));assert.equal(newer.calls.length,0);
});
test('legacy verified race answers require explicit repair rather than silently resending old work',async()=>{
 const f=raceFixture();await f.workflow().createEnrollment(f.input);
 for(const records of f.journals.values())for(const r of records){delete r.raceWrites;delete r.steps?.raceEthnicity;}
 f.history.find(h=>h.field==='HUD_RACEETHNICITY').text='';const before=f.calls.length;
 await assert.rejects(f.workflow().createEnrollment(f.input),e=>e.code==='RACE_ETHNICITY_REPAIR_REQUIRED');assert.equal(f.calls.length,before);
});

function managedFixture(faults={}){
 const f=raceFixture(faults),reviews=[];
 const exit={clientId:1,enrollmentId:50,projectExitDate:null,destination:null,reasonForLeaving:null,exitSubgroupId:null,clientIds:[1],enrollmentIds:[50]};
 f.reader.readEnrollment=async()=>({source:'gwt-rpc',tenant:f.api.tenant,clientId:1,enrollmentId:50,providerId:2,enrollmentType:'HUD',projectStartDate:f.input.entryDate,grouped:false,groupId:null,householdId:null,members:[{clientId:1,enrollmentId:50}],exits:[{...exit}],reviews});
 const original=f.discovery.getProviderAssessments;f.discovery.getProviderAssessments=async()=>{const d=await original();d.defaults.push({location:'showHudExit',resolution:'resolved',assessment:{assessmentId:3,code:'EXIT',name:'exit',assignedToAssessmentTab:true}});return d;};
 const helpers={createInterimUpdate:async input=>{if(!reviews.some(r=>r.reviewDate===input.reviewDate))reviews.push({reviewId:60,type:'Update',reviewDate:input.reviewDate,clientIds:[1]});return {snapshot:{reviews}};}};
 const exitUi={validateExit:async()=>{},saveExit:async input=>{f.calls.push('exit');Object.assign(exit,{projectExitDate:input.exitDate,destination:input.destination,reasonForLeaving:input.reasonForLeaving});}};
 f.workflow=()=>createEnrollmentWorkflow({api:f.api,store:f.store,discovery:f.discovery,helpers,enrollmentSession:f.reader,exitUi,writeLabel:(_q,o)=>o.name});
 return f;
}
test('same-selection entry correction repairs missing UI text and reconciles its original key',async()=>{
 const f=managedFixture();await f.workflow().createEnrollment(f.input);f.history.find(h=>h.field==='HUD_RACEETHNICITY').text='';
 const correction={key:'race-correction',enrollmentKey:'entry',clientId:1,answers:{HUD_RACEETHNICITY:{option:{code:'RACE_ETH_WHI'}}}};
 await f.workflow().correctEntry(correction);assert.equal(f.history.find(h=>h.field==='HUD_RACEETHNICITY').text,'WHI');
 const count=f.calls.length;await f.workflow().correctEntry(correction);await f.workflow().createEnrollment(f.input);assert.equal(f.calls.length,count);
});
test('entry correction cannot verify a lookup-only write or automatically repeat it',async()=>{
 const faults={},f=managedFixture(faults);await f.workflow().createEnrollment(f.input);faults.badText=true;
 const correction={key:'race-correction',enrollmentKey:'entry',clientId:1,answers:{HUD_RACEETHNICITY:{option:{code:'RACE_ETH_COMBO_ASN_MES'}}}};
 await assert.rejects(f.workflow().correctEntry(correction),e=>e.code==='ENTRY_CORRECTION_UNCERTAIN');const count=f.calls.length;
 await assert.rejects(f.workflow().correctEntry(correction),e=>e.code==='ENTRY_CORRECTION_UNCERTAIN');assert.equal(f.calls.length,count);
});
test('interim race answers use standard writes and no-write repeats',async()=>{
 const f=managedFixture();await f.workflow().createEnrollment(f.input);
 const input={key:'interim-race',enrollmentKey:'entry',clientId:1,reviewDate:'2026-11-16T13:00:00Z',assessment:{answers:{HUD_RACEETHNICITY:{option:{code:'RACE_ETH_COMBO_ASN_MES'}}},carryForward:['REQUIRED']}};
 await f.workflow().createInterim(input);assert.equal(f.history.at(-2).text,'ASN,MES');const count=f.calls.length;
 await f.workflow().createInterim(input);assert.equal(f.calls.length,count);
});
test('exit race answers use standard writes and no-write repeats',async()=>{
 const f=managedFixture();await f.workflow().createEnrollment(f.input);
 const input={key:'exit-race',enrollmentKey:'entry',clientId:1,exitDate:'2026-11-16T14:00:00Z',destination:'Rental by client',reasonForLeaving:'Completed program',assessment:{answers:{HUD_RACEETHNICITY:{option:{code:'RACE_ETH_COMBO_ASN_MES'}}},carryForward:['REQUIRED']}};
 await f.workflow().exitEnrollment(input);assert.equal(f.history.at(-2).text,'ASN,MES');const count=f.calls.length;
 await f.workflow().exitEnrollment(input);assert.equal(f.calls.length,count);
});
test('legacy entry retry honors its verified race correction',async()=>{
 const f=managedFixture();await f.workflow().createEnrollment(f.input);
 await f.workflow().correctEntry({key:'change-race',enrollmentKey:'entry',clientId:1,answers:{HUD_RACEETHNICITY:{option:{code:'RACE_ETH_COMBO_ASN_MES'}}}});
 for(const records of f.journals.values())for(const r of records)if(r.kind==='entry')delete r.raceWrites;
 const count=f.calls.length;await f.workflow().createEnrollment(f.input);assert.equal(f.calls.length,count);
});
