const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCurrentLivingSituationRecorder, CurrentLivingSituationConflictError} from '@choiceapps/communityservices-sdk/browser';
const fields={parentField:'CONTACTS',startDate:'START',endDate:'END',informationDate:'INFO',livingSituation:'LIVING',verifiedBy:'BY'};
const input={key:'outreach-1',clientId:1,enrollmentId:10,assessmentCode:'SYNTHETIC',informationDate:'2026-10-24T09:00:00-04:00',livingSituation:{option:{code:'UNSHELTERED'}}};
const q=(fieldName,questionType,questionId,mandatory=false)=>({fieldName,questionType,questionId,mandatory,children:[],options:fieldName==='LIVING'?[{id:99,code:'UNSHELTERED',name:'Synthetic unsheltered'}]:[]});
const value=(row,field)=>row.sub_assessment_list.find(q=>q.virt_field_name===field)?.answer_value;
const reason=expected=>e=>e instanceof CurrentLivingSituationConflictError&&e.reason===expected;
function fixture(){
 const journal=new Map(),rows=[],writes=[];let mode,readFail=false;
 const parent={...q('CONTACTS','sub_assessment',100),children:[q('START','date',1,true),q('END','date',2),q('INFO','date',3,true),q('LIVING','lookup',4,true),q('BY','textbox',5),q('OPTIONAL','yes_no',6)]};
 const enrollment={clientId:1,enrollmentId:10,enrollmentProvider:20,projectStartDate:'2026-10-20T12:00:00',projectExitDate:null,isActive:true};
 const store={withLock:async(_s,fn)=>fn(),read:async s=>structuredClone(journal.get(s)??[]),write:async(s,r)=>journal.set(s,structuredClone(r))};
 const api={tenant:testTenant,enrollments:{listForClient:async()=>({count:1,values:[structuredClone(enrollment)]})},assessments:{getDefinition:async()=>({tenant:api.tenant,assessmentCode:input.assessmentCode,questions:[structuredClone(parent)]}),get:async()=>{if(readFail)throw Error('Read unavailable');return [{virt_field_name:'CONTACTS',question_type:'sub_assessment',sub_assessment_answer_list:structuredClone(rows)}];}},assessmentsMobile:{addAnswer:async req=>{
  writes.push(structuredClone(req));if(mode==='before')throw Error('Uncertain save');
  const row={recordset_id:rows.length+1000,sub_assessment_list:structuredClone(req.body[0].subAssessmentQuestionAnswers[0].subAssessments)};
  row.sub_assessment_list.find(q=>q.virt_field_name==='END').answer_value=null;
  if(mode!=='deduplicate'||!rows.length)rows.push(row);
  if(mode==='changed-start')row.sub_assessment_list.find(q=>q.virt_field_name==='START').answer_value=req.query.dateEffective;
  if(mode==='collateral'&&rows.length>1)rows[0].sub_assessment_list.find(q=>q.virt_field_name==='LIVING').answer_value='changed';
  if(mode==='duplicate')rows.push({...structuredClone(row),recordset_id:9999});
  if(mode==='read-fails')readFail=true;if(mode==='after')throw Error('Lost response');
 }}};
 return {api,store,rows,journal,parent,enrollment,writes,recorder:()=>createCurrentLivingSituationRecorder({api,store,fields}),mode:v=>{mode=v;},readFail:v=>{readFail=v;}};
}
test('program-entry start, contact information date, open end and no invented optional answers',async()=>{
 const f=fixture(),r=await f.recorder().record(input);assert.equal(r.startDate,'2026-10-20T12:00:00.000Z');assert.equal(r.informationDate,'2026-10-24T13:00:00.000Z');assert.equal(r.endDate,null);
 assert.equal(value(f.rows[0],'START'),r.startDate);assert.equal(value(f.rows[0],'INFO'),r.informationDate);assert.equal(value(f.rows[0],'LIVING'),'99');assert.equal(value(f.rows[0],'END'),null);assert.equal(value(f.rows[0],'BY'),undefined);assert.equal(value(f.rows[0],'OPTIONAL'),undefined);
 for(const endDate of [null,''])assert.equal((await f.recorder().record({...input,endDate})).outcome,'already-present');assert.equal(f.writes.length,1);
});
test('distinct contact keys preserve separate identical contacts and retry only their own row',async()=>{
 const f=fixture(),a=await f.recorder().record(input),before=structuredClone(f.rows[0]),b=await f.recorder().record({...input,key:'night-shelter-2'});
 assert.notEqual(a.recordsetId,b.recordsetId);assert.deepEqual(f.rows[0],before);assert.equal(f.rows.length,2);
 await f.recorder().record(input);await f.recorder().record({...input,key:'night-shelter-2'});assert.equal(f.writes.length,2);
});
test('later contact retains entry start and leaves every prior end open',async()=>{const f=fixture();await f.recorder().record(input);await f.recorder().record({...input,key:'later',informationDate:'2026-10-25T13:00:00Z'});assert.equal(value(f.rows[0],'START'),value(f.rows[1],'START'));assert.notEqual(value(f.rows[0],'INFO'),value(f.rows[1],'INFO'));assert.ok(f.rows.every(r=>value(r,'END')===null));});
test('Verified By can be recording-program text, but never coerces a numeric program ID',async()=>{const f=fixture();await f.recorder().record({...input,verifiedBy:{value:'Synthetic Outreach Program'}});assert.equal(value(f.rows[0],'BY'),'Synthetic Outreach Program');await assert.rejects(f.recorder().record({...input,key:'bad',verifiedBy:{value:20}}),reason('verified-by-text-required'));assert.equal(f.writes.length,1);});
test('Verified By lookup resolves the actual option representation',async()=>{const f=fixture(),by=f.parent.children.find(q=>q.fieldName==='BY');by.questionType='lookup';by.options=[{id:77,code:'PROGRAM',name:'Synthetic Shelter'}];await f.recorder().record({...input,verifiedBy:{option:{code:'PROGRAM'}}});assert.equal(value(f.rows[0],'BY'),'77');await assert.rejects(f.recorder().record({...input,key:'bad',verifiedBy:{value:20}}));assert.equal(f.writes.length,1);});
test('provider-valued Verified By refuses unsupported mobile writes while omission stays optional',async()=>{const f=fixture();f.parent.children.find(q=>q.fieldName==='BY').questionType='provider';await assert.rejects(f.recorder().record({...input,verifiedBy:{value:20}}),reason('verified-by-representation-unsupported'));assert.equal(f.journal.size,0);await f.recorder().record(input);assert.equal(value(f.rows[0],'BY'),undefined);});
test('only actual metadata-required extra questions are required',async()=>{const f=fixture();f.parent.children.push(q('REQUIRED','textbox',7,true));await assert.rejects(f.recorder().record(input),reason('platform-required-field:REQUIRED'));assert.equal(f.journal.size,0);await f.recorder().record({...input,additionalAnswers:{REQUIRED:{value:'Caller supplied'}}});assert.equal(value(f.rows[0],'REQUIRED'),'Caller supplied');});
test('platform mandatory end contradiction stops before journaling',async()=>{const f=fixture();f.parent.children.find(q=>q.fieldName==='END').mandatory=true;await assert.rejects(f.recorder().record(input),reason('platform-requires-end-date'));assert.equal(f.journal.size,0);assert.equal(f.writes.length,0);});
for(const mode of ['after','read-fails'])test('lost acknowledgement/read reconciles without replay: '+mode,async()=>{const f=fixture();f.mode(mode);if(mode==='after')assert.equal((await f.recorder().record(input)).outcome,'reconciled');else{await assert.rejects(f.recorder().record(input),/Read unavailable/);f.readFail(false);assert.equal((await f.recorder().record(input)).outcome,'reconciled');}assert.equal((await f.recorder().record(input)).outcome,'already-present');assert.equal(f.writes.length,1);});
test('uncertain absence blocks replay and competing contact keys',async()=>{const f=fixture();f.mode('before');for(let n=0;n<2;n++)await assert.rejects(f.recorder().record(input),reason('uncertain-contact-save'));await assert.rejects(f.recorder().record({...input,key:'other'}),reason('unfinished-contact'));assert.equal(f.writes.length,1);});
for(const mode of ['deduplicate','collateral','duplicate','changed-start'])test('vendor contradiction or ambiguous save blocks retries: '+mode,async()=>{const f=fixture();await f.recorder().record(input);f.mode(mode);await assert.rejects(f.recorder().record({...input,key:'another'}),reason(mode==='collateral'?'existing-contact-changed':'uncertain-contact-save'));await assert.rejects(f.recorder().record({...input,key:'another'}));assert.equal(f.writes.length,2);});
test('changed contact intent, program entry and saved row identity cannot be adopted',async()=>{const f=fixture();await f.recorder().record(input);await assert.rejects(f.recorder().record({...input,informationDate:'2026-10-24T14:00:00Z'}),reason('intent-or-schema-changed'));f.enrollment.projectStartDate='2026-10-21T12:00:00';await assert.rejects(f.recorder().record(input),reason('intent-or-schema-changed'));f.enrollment.projectStartDate='2026-10-20T12:00:00';f.rows[0].recordset_id++;await assert.rejects(f.recorder().record(input),reason('verified-contact-changed'));assert.equal(f.writes.length,1);});
test('failed or incomplete enrollment/assessment reads never authorize a save',async()=>{const f=fixture();f.api.enrollments.listForClient=async()=>({count:2,values:[]});await assert.rejects(f.recorder().record(input),reason('incomplete-enrollment-read'));assert.equal(f.journal.size,0);const g=fixture();g.api.assessments.get=async()=>[];await assert.rejects(g.recorder().record(input),reason('rows-unavailable'));assert.equal(g.journal.size,0);});
test('invalid dates, reserved overrides, unknown living situation and out-of-enrollment contacts stop before saves',async()=>{const f=fixture();for(const c of [{informationDate:'2026-02-30T12:00:00Z'},{informationDate:'2026-10-24'},{informationDate:'2026-10-19T12:00:00Z'},{startDate:input.informationDate},{endDate:input.informationDate},{additionalAnswers:{START:{value:input.informationDate}}},{livingSituation:{option:{code:'UNKNOWN'}}}])await assert.rejects(f.recorder().record({...input,...c}));f.enrollment.projectExitDate='2026-10-23T12:00:00';await assert.rejects(f.recorder().record(input),reason('contact-outside-enrollment'));assert.equal(f.journal.size,0);assert.equal(f.writes.length,0);});
test('missing tenant and failed journal persistence block mutations',async()=>{const f=fixture();f.api.tenant='';assert.throws(()=>f.recorder(),/tenant/);f.api.tenant=testTenant;f.store.write=async()=>{throw Error('Disk full');};await assert.rejects(f.recorder().record(input),/Disk full/);assert.equal(f.writes.length,0);});

test('shared CLS journals isolate identical IDs and event keys across tenants and API deployments',async()=>{
 const first=fixture(),second=fixture(),third=fixture();
 first.api.tenant='tenant-a';second.api.tenant='tenant-b';third.api.tenant='tenant-a';third.api.baseUrl='https://other.invalid/client-api-prod';
 const {createCurrentLivingSituationRecorder}=await import('@choiceapps/communityservices-sdk/browser');
 const recorders=[first,second,third].map(f=>createCurrentLivingSituationRecorder({api:f.api,store:first.store,fields}));
 for(const recorder of recorders)assert.equal((await recorder.record(input)).outcome,'verified');
 assert.equal(first.journal.size,3);
 for(const recorder of recorders)assert.equal((await recorder.record(input)).outcome,'already-present');
 for(const f of [first,second,third])assert.equal(f.writes.length,1);
});
