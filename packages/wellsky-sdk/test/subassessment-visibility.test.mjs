import test from 'node:test';
import assert from 'node:assert/strict';
import {createFakeWellSkyClient,ValidationError} from '../dist/esm/index.js';

const context={clientId:123,assessmentCode:'SYNTHETIC'};
const input={...context,parentField:'ROWS',recordsetId:42,endDateField:'END',endDate:'2026-11-22'};
const row=recordset_id=>({recordset_id,sub_assessment_list:[{question_id:4,virt_field_name:'END',question_type:'date',answer_value:null}]});
const parent=rows=>[{question_id:2,virt_field_name:'ROWS',question_type:'sub_assessment',sub_assessment_question_list:[{question_id:4,virt_field_name:'END',question_type:'date'}],sub_assessment_answer_list:rows}];

for(const [rows,code,reason]of [
 [[row(43)],'SUBASSESSMENT_RECORDSET_NOT_VISIBLE','not_visible'],
 [[row(42),row(42)],'SUBASSESSMENT_RECORDSET_AMBIGUOUS','duplicate'],
])test(`end-date preflight reports ${reason} without submitting a write`,async()=>{
 const client=createFakeWellSkyClient();
 client.fake.set('GET /assessments/{clientId}/{assessmentCode}',{kind:'reply',body:parent([row(42)])});
 client.fake.set('GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}',{kind:'reply',body:parent(rows)});
 const generic=await client.assessments.get({path:context});
 assert.equal(generic[0].sub_assessment_answer_list[0].recordset_id,42);
 const result=await client.subassessments.setEndDate(input);
 assert.equal(result.status,'failed');assert.equal(result.reason,'preflight');assert.equal(result.committed,false);
 assert.ok(result.error instanceof ValidationError);
 assert.equal(result.error.name,'SubassessmentRecordsetError');
 assert.equal(result.error.code,code);assert.equal(result.error.reason,reason);
 assert.deepEqual(result.error.fields,['recordsetId']);
 assert.match(result.error.message,/mobile preflight read/);
 assert.equal(result.error.operation,'GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}');
 assert.equal(client.fake.calls.filter(c=>c.operation.startsWith('POST')).length,0);
});

test('invalid recordset input remains validation and does not imply missing mobile visibility',async()=>{
 const client=createFakeWellSkyClient(),result=await client.subassessments.setEndDate({...input,recordsetId:0});
 assert.equal(result.status,'failed');assert.equal(result.error.name,'ValidationError');assert.equal(result.error.code,undefined);
 assert.equal(client.fake.calls.length,0);
});

test('an unavailable mobile read is not diagnosed as an invisible target',async()=>{
 const client=createFakeWellSkyClient({maxReadRetries:0});
 client.fake.set('GET /assessmentsmobile/GetAssessmentAnswers/{clientId}/{assessmentCode}',{kind:'reply',status:500});
 const result=await client.subassessments.setEndDate(input);
 assert.equal(result.status,'failed');assert.equal(result.error.status,500);assert.equal(result.error.code,undefined);
 assert.equal(client.fake.calls.filter(c=>c.operation.startsWith('POST')).length,0);
});
