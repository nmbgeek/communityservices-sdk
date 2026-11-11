import test from 'node:test';
import assert from 'node:assert/strict';
import {writeMobileAnswersChecked,MobileAnswerPreflightError} from '@choiceapps/communityservices-sdk';

const at='2026-11-09T16:00:00Z';
const input=()=>({path:{clientId:1,assessmentCode:'SECOND_INSTRUMENT'},query:{dateEffective:at},body:[{question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:'12'}]});
function fixture(row={question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:null,date_effective:null}){
 const calls=[];const api={assessments:{get:async options=>{calls.push({kind:'read',options});return [row];}},assessmentsMobile:{addAnswer:async options=>{calls.push({kind:'write',options});return [];}}};return {api,calls};
}
test('checked mobile writer rejects a shared same-instant scalar without sending',async()=>{
 for(const answer_value of ['0','12',null]){
  const f=fixture({question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value,date_effective:at});
  await assert.rejects(writeMobileAnswersChecked(f.api,input()),e=>e instanceof MobileAnswerPreflightError&&e.code==='MOBILE_ANSWER_EXISTS'&&e.committed===false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.query.dateEffective,'2026-11-09T16:00:01.000Z');
 }
});
test('checked mobile writer sends a new instant once and preserves the unshifted requested timestamp',async()=>{
 const f=fixture({question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:'0',date_effective:'2026-11-08T16:00:00Z'});await writeMobileAnswersChecked(f.api,input());assert.deepEqual(f.calls.map(c=>c.kind),['read','write']);assert.equal(f.calls[1].options.query.dateEffective,at);
});
test('unavailable, malformed and newer readbacks refuse the whole mobile batch',async()=>{
 for(const row of [{},{question_id:99,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:null,date_effective:null},{question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:'1',date_effective:null},{question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:'1',date_effective:'2026-11-09T16:00:01Z'}]){
  const f=fixture(row);await assert.rejects(writeMobileAnswersChecked(f.api,input()),e=>e.code==='MOBILE_PREFLIGHT_UNAVAILABLE');assert.equal(f.calls.length,1);
 }
 const f=fixture();f.api.assessments.get=async()=>{throw Object.assign(new Error('Read failed'),{status:400});};await assert.rejects(writeMobileAnswersChecked(f.api,input()),e=>e.code==='MOBILE_PREFLIGHT_READ_FAILED'&&e.committed===false&&e.cause.status===400);assert.equal(f.calls.length,0);
});
test('checked writer never relabels a failed write as a preflight non-commit or retries it',async()=>{
 const f=fixture(),failure=Object.assign(new Error('Possibly committed'),{status:400});let writes=0;f.api.assessmentsMobile.addAnswer=async()=>{writes++;throw failure;};await assert.rejects(writeMobileAnswersChecked(f.api,input()),e=>e===failure);assert.equal(writes,1);
});
test('invalid dates and duplicate scalar identities fail before any request',async()=>{
 for(const modify of [i=>i.query.dateEffective='2026-02-30T16:00:00Z',i=>i.query.dateEffective='2026-11-09',i=>i.body.push({...i.body[0]}),i=>i.body=[],i=>i.body.push({...i.body[0],virt_field_name:'ALIAS'})]){
  const f=fixture(),i=input();modify(i);await assert.rejects(writeMobileAnswersChecked(f.api,i),e=>e.code==='MOBILE_PREFLIGHT_INPUT_INVALID');assert.equal(f.calls.length,0);
 }
});
test('checked writer uses the real SDK transport and its configured mobile-only date correction',async()=>{
 const {createFakeWellSkyClient}=await import('@choiceapps/communityservices-sdk/testing');
 const api=createFakeWellSkyClient({tenant:'synthetic',mobileAssessmentDateCorrectionMinutes:420});
 api.fake.set('GET /assessments/{clientId}/{assessmentCode}',{kind:'reply',body:[{question_id:12,question_type:'int',virt_field_name:'SHARED_SCORE',answer_value:null,date_effective:null}]});
 api.fake.set('POST /assessmentsmobile/AddAssessmentAnswer/{clientId}/{assessmentCode}',{kind:'reply',body:[]});
 await writeMobileAnswersChecked(api,input());assert.equal(api.fake.calls.length,2);assert.equal(Date.parse(api.fake.calls[0].query.dateEffective),Date.parse(at)+1000);assert.equal(Date.parse(api.fake.calls[1].query.dateEffective),Date.parse(at)+420*60000);
});
