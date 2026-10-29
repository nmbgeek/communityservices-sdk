const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemberEntryDatePort} from '../browser/member-entry-date.mjs';

const initial='2026-10-19T16:00:00.000Z',desired='2026-10-21T16:00:00.000Z';
const memberExit=(clientId,enrollmentId)=>({clientId,enrollmentId,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null,clientIds:[clientId],enrollmentIds:[enrollmentId]});
function fixture(){
 const cohort=[{clientId:1,enrollmentId:10,entryDate:initial,exit:memberExit(1,10)},{clientId:2,enrollmentId:11,entryDate:initial,exit:memberExit(2,11)}],calls=[];
 const snapshots=new Map(cohort.map(m=>[m.clientId,{source:'gwt-rpc',tenant:testTenant,sessionId:'session',revision:'version',clientId:m.clientId,enrollmentId:m.enrollmentId,providerId:99,enrollmentType:'HUD',projectStartDate:m.entryDate,householdClientIds:[1,2],members:cohort.map(({clientId,enrollmentId})=>({clientId,enrollmentId})),exits:cohort.map(m=>structuredClone(m.exit)),reviews:[]}])) ;
 const api={tenant:testTenant,enrollments:{async updateEntryAssessment(input){calls.push(structuredClone(input));snapshots.get(2).projectStartDate=input.body.projectStartDate;}}};
 const enrollmentSession={async readEnrollment({clientId}){return structuredClone(snapshots.get(clientId));}};
 const input={clientId:2,enrollmentId:11,providerId:99,type:'HUD',entryDate:desired,cohort};
 return {api,enrollmentSession,input,snapshots,calls,port:()=>createMemberEntryDatePort({api,enrollmentSession})};
}
test('member entry port changes only the target date and validates every cohort member before and after',async()=>{
 const f=fixture(),before=structuredClone(f.snapshots.get(1));await f.port().validateMemberEntryDate(f.input);assert.equal(f.calls.length,0);
 await f.port().saveMemberEntryDate(f.input);assert.deepEqual(f.calls,[{query:{enrollment_id:11},body:{projectStartDate:desired}}]);assert.deepEqual(f.snapshots.get(1),before);assert.equal(f.snapshots.get(2).projectStartDate,desired);
 await f.port().saveMemberEntryDate(f.input);assert.equal(f.calls.length,1);
});
test('port rejects a missing tenant and incomplete API or reader configuration',()=>{
 const f=fixture();f.api.tenant='';assert.throws(()=>f.port(),/tenant/);assert.throws(()=>createMemberEntryDatePort({api:{tenant:testTenant},enrollmentSession:f.enrollmentSession}),/REST API/);
});
test('invalid or backward date, duplicate identities and exited target cannot be written',async()=>{
 for(const change of [i=>{i.entryDate='2026-10-18T16:00:00Z';},i=>{i.entryDate='2026-02-30T16:00:00Z';},i=>{i.entryDate='2026-10-21T16:00:00';},i=>{i.cohort[1].clientId=1;},i=>{i.cohort[1].enrollmentId=10;},i=>{i.cohort[1].exit.projectExitDate='2026-10-22T16:00:00Z';},i=>{i.cohort.pop();}]){
  const f=fixture();change(f.input);await assert.rejects(f.port().saveMemberEntryDate(f.input));assert.equal(f.calls.length,0);
 }
});
test('authoritative provider, type, identity and existing dates must match before write',async()=>{
 for(const change of [s=>{s.providerId=100;},s=>{s.enrollmentType='VA';},s=>{s.clientId=3;},s=>{s.projectStartDate='2026-10-20T16:00:00Z';}]){
  const f=fixture();change(f.snapshots.get(1));await assert.rejects(f.port().saveMemberEntryDate(f.input));assert.equal(f.calls.length,0);
 }
});
test('complete exact enrollment and exit membership is required',async()=>{
 for(const change of [s=>s.members.pop(),s=>s.members.push(s.members[0]),s=>s.exits.pop(),s=>s.exits.push(s.exits[0]),s=>{s.exits[0].destination='Other';},s=>{s.exits[1].projectExitDate=desired;}]){
  const f=fixture();change(f.snapshots.get(2));await assert.rejects(f.port().saveMemberEntryDate(f.input),/cohort membership or exit/);assert.equal(f.calls.length,0);
 }
});
test('moving a child entry after its already recorded review is rejected',async()=>{
 const f=fixture();f.snapshots.get(2).reviews.push({reviewId:50,type:'Update',reviewDate:'2026-10-20T16:00:00Z',clientIds:[2]});await assert.rejects(f.port().saveMemberEntryDate(f.input),/review precedes/);assert.equal(f.calls.length,0);
});
test('save repeats preflight so a change after validation prevents the PUT',async()=>{
 const f=fixture();await f.port().validateMemberEntryDate(f.input);f.snapshots.get(1).projectStartDate=desired;await assert.rejects(f.port().saveMemberEntryDate(f.input),/existing member entry date changed/);assert.equal(f.calls.length,0);
});
test('ambiguous REST failure is thrown without retry; authoritative already-present state needs no write',async()=>{
 const f=fixture(),write=f.api.enrollments.updateEntryAssessment;
 f.api.enrollments.updateEntryAssessment=async input=>{await write(input);throw Error('HTTP400 after commit');};
 await assert.rejects(f.port().saveMemberEntryDate(f.input),/HTTP400 after commit/);assert.equal(f.calls.length,1);
 await f.port().validateMemberEntryDate(f.input);await f.port().saveMemberEntryDate(f.input);assert.equal(f.calls.length,1);
});
test('post-write readback rejects cohort date or exit side effects without issuing another PUT',async()=>{
 for(const mutate of [f=>{f.snapshots.get(1).projectStartDate=desired;},f=>{f.snapshots.get(2).exits[0].projectExitDate=desired;}]){
  const f=fixture(),write=f.api.enrollments.updateEntryAssessment;f.api.enrollments.updateEntryAssessment=async input=>{await write(input);mutate(f);};
  await assert.rejects(f.port().saveMemberEntryDate(f.input));assert.equal(f.calls.length,1);
 }
});
test('successful REST acknowledgement with unchanged target is not verification',async()=>{
 const f=fixture();f.api.enrollments.updateEntryAssessment=async input=>{f.calls.push(input);};await assert.rejects(f.port().saveMemberEntryDate(f.input),/target entry date changed unexpectedly/);assert.equal(f.calls.length,1);
});
