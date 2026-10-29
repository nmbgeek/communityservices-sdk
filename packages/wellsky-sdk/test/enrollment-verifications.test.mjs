import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {WellSkyClient,readEnrollmentVerifications} from '../dist/esm/index.js';
import {WellSkyClient as V2Client} from '../dist/esm/v2.js';
const fields=[['MONTHLYINCOME','MONTHLYINCOMESTART','MONTHLYINCOMEEND'],['SVP_NONCASHBENEFITS','SVP_NONCASHBENEFITSSTART','SVP_NONCASHBENEFITSEND'],['HUDHEALTHINSURANCESUBA','HUDHEALTHINSURANCESUBASTART','HUDHEALTHINSURANCESUBAEND'],['DISABILITIES_1','DISABILITIES_1START','DISABILITIES_1END']];
const context={clientId:123,assessmentCode:'SYNTHETIC',enrollmentDate:'2026-10-18T12:00:00-04:00'};
const row=(id,group,start,end=null,effective='2026-10-22T16:00:00')=>({recordset_id:id,isActive:true,sub_assessment_list:[{virt_field_name:fields[group][1],question_type:'date',answer_value:start,date_effective:effective},{virt_field_name:fields[group][2],question_type:'date',answer_value:end,date_effective:effective},{virt_field_name:'RESPONSE',question_type:'lookup',answer_value:'42',answer_value_text:'No',answer_value_code:'SYNTHETIC_NO'}]});
const parents=(rows=[])=>fields.map(([field],i)=>({virt_field_name:field,question_type:'sub_assessment',sub_assessment_answer_list:rows[i]??[]}));
const source=questions=>({assessments:{get:async()=>questions}});
const ids=result=>result.groups.map(g=>g.records.map(r=>r.recordset_id));

for(const [Client,version] of [[WellSkyClient,'3.0'],[V2Client,'2.0']]){
 test(`${version}: current assessment GET selects exact boundaries in all four groups and preserves dates`,async()=>{
  const questions=parents(fields.map((_,i)=>[
   row(i*10+1,i,'2026-10-18T15:59:59Z'),row(i*10+2,i,'2026-10-18 09:00:00-07'),
   row(i*10+3,i,'2026-10-18T16:00:01+0000'),row(i*10+4,i,'2026-10-17T16:00:00Z','2026-10-18T15:59:59Z'),
   row(i*10+5,i,'2026-10-17T16:00:00Z','2026-10-18T16:00:00Z'),
  ]));const original=structuredClone(questions);let calls=0;
  const client=new Client({tenant:'synthetic',auth:{kind:'none'},mobileAssessmentDateCorrectionMinutes:420,fetch:async(url,init)=>{
   calls++;assert.equal(init.method,'GET');assert.equal(init.headers.get('x-version'),version);assert.equal(new URL(url).pathname,'/client-api-prod/assessments/123/SYNTHETIC');assert.equal(new URL(url).search,'');return new Response(JSON.stringify({value:questions}));
  }});
  const result=await readEnrollmentVerifications(client,context);assert.equal(calls,1);assert.equal(result.source,'current-assessment');assert.equal(result.enrollmentDate,context.enrollmentDate);
  assert.deepEqual(ids(result),fields.map((_,i)=>[i*10+1,i*10+2,i*10+5]));
  assert.deepEqual(result.groups.map(g=>g.excluded.map(x=>[x.record.recordset_id,x.reason])),fields.map((_,i)=>[[i*10+3,'not_started'],[i*10+4,'ended']]));
  assert.deepEqual(questions,original);assert.equal(result.groups[0].records[1].sub_assessment_list[0].answer_value,'2026-10-18 09:00:00-07');
  assert.equal(result.groups[0].records[0].sub_assessment_list[0].date_effective,'2026-10-22T16:00:00');
 });
}

test('fractional boundaries, positive offsets, leap dates and empty end values are deterministic',async()=>{
 const values=parents([[row(1,0,'2026-10-18T16:00:00.000000001Z'),row(2,0,'2026-10-18T16:00:00Z','2026-10-18T16:00:00.000000001Z'),row(3,0,'2026-10-18T21:30:00+05:30',''),row(4,0,'2024-02-29T16:00:00Z')]]);
 assert.deepEqual(ids(await readEnrollmentVerifications(source(values),context)),[[2,3,4],[],[],[]]);
 assert.deepEqual(ids(await readEnrollmentVerifications(source(values),{...context,enrollmentDate:'2026-10-18T16:00:00.000000001Z'})),[[1,2,3,4],[],[],[]]);
});

test('returns copies and retains overlapping historical records without inferring answer values',async()=>{
 const questions=parents([[row(1,0,'2026-10-17T16:00:00Z'),row(2,0,'2026-10-18T16:00:00Z')]]);const original=structuredClone(questions);
 const result=await readEnrollmentVerifications(source(questions),context);assert.deepEqual(ids(result),[[1,2],[],[],[]]);
 result.groups[0].records[0].sub_assessment_list[0].answer_value='edited copy';assert.deepEqual(questions,original);
});

test('invalid or ambiguous input dates fail before any read',async()=>{
 const reader={assessments:{get:async()=>assert.fail('must not read')}};
 for(const enrollmentDate of ['2026-10-18','2026-10-18T16:00:00','2026-02-30T16:00:00Z','2026-10-18T24:00:00Z','2026-10-18T16:60:00Z','2026-10-18T16:00:60Z','2026-10-18T16:00:00+14:01','2026-10-18T16:00:00+01:60','2026-10-18T16:00:00.0000000001Z'])await assert.rejects(readEnrollmentVerifications(reader,{...context,enrollmentDate}),e=>e.kind==='validation'&&e.fields.includes('enrollmentDate'));
 for(const clientId of [0,-1,1.5,NaN])await assert.rejects(readEnrollmentVerifications(reader,{...context,clientId}),e=>e.kind==='validation');
 await assert.rejects(readEnrollmentVerifications(reader,{...context,assessmentCode:' '}),e=>e.kind==='validation');
});

test('invalid row intervals and missing or duplicated date fields fail without pretending they are absent',async()=>{
 for(const [start,end]of [[null,null],['2026-10-18',null],['2026-10-18T16:00:00',null],['2026-02-30T00:00:00Z',null],['2026-10-18T16:00:00Z','bad'],['2026-10-18T16:00:00Z','2026-10-17T16:00:00Z']])await assert.rejects(readEnrollmentVerifications(source(parents([[row(1,0,start,end)]])),context),e=>e.kind==='protocol');
 for(const mutate of [r=>r.sub_assessment_list.splice(1,1),r=>r.sub_assessment_list.shift(),r=>r.sub_assessment_list.push({...r.sub_assessment_list[0]}),r=>r.sub_assessment_list[0].question_type='textbox']){
  const r=row(1,0,'2026-10-18T16:00:00Z');mutate(r);
  await assert.rejects(readEnrollmentVerifications(source(parents([[r]])),context),e=>e.kind==='protocol');
 }
});

test('missing groups and ambiguous identities are errors; present empty groups are legitimate empty results',async()=>{
 assert.deepEqual(ids(await readEnrollmentVerifications(source(parents()),context)),[[],[],[],[]]);
 for(const questions of [null,[],parents().slice(1),[...parents(),parents()[0]],parents([[row(1,0,'2026-10-18T16:00:00Z'),row(1,0,'2026-10-18T16:00:00Z')]]),parents([[row(0,0,'2026-10-18T16:00:00Z')]])])await assert.rejects(readEnrollmentVerifications(source(questions),context),e=>e.kind==='protocol');
 const nullRows=parents();nullRows[0].sub_assessment_answer_list=null;await assert.rejects(readEnrollmentVerifications(source(nullRows),context),e=>e.kind==='protocol');
});

test('forwards execution options, propagates read failures and does not retry on its own',async()=>{
 const signal=new AbortController().signal;let seen;
 await readEnrollmentVerifications({assessments:{get:async options=>{seen=options;return parents();}}},{...context,signal,timeoutMs:1234,correlationId:'synthetic'});
 assert.deepEqual(seen,{path:{clientId:123,assessmentCode:'SYNTHETIC'},signal,timeoutMs:1234,correlationId:'synthetic'});
 const failure=new Error('read failed');let calls=0;await assert.rejects(readEnrollmentVerifications({assessments:{get:async()=>{calls++;throw failure;}}},context),e=>e===failure);assert.equal(calls,1);
});

test('helper is exported through all ESM and CommonJS SDK entry points',async()=>{
 const require=createRequire(import.meta.url);
 for(const entry of ['index','v2','v3']){
  assert.equal(typeof (await import(`../dist/esm/${entry}.js`)).readEnrollmentVerifications,'function');
  assert.equal(typeof require(`../dist/cjs/${entry}.js`).readEnrollmentVerifications,'function');
 }
});
