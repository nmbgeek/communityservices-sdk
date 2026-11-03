const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCoordinatedEntryEventRecorder, CoordinatedEntryEventConflictError} from '@choiceapps/communityservices-sdk/browser';
const fields={parentField:'EVENTS',startDate:'START',endDate:'END',eventDate:'EVENT_DATE',event:'EVENT',housedSafely:'HOUSED_SAFE',enrolledInAftercare:'AFTERCARE',location:'LOCATION',referralResult:'RESULT',resultDate:'RESULT_DATE'};
const E=code=>'COORDINATEDENTRYEVENT_EVENT_'+code;
const options={EVENT:[{id:50,code:E('HDR_ACCESS'),name:'----- ACCESS EVENTS -----'},{id:51,code:E('RRH'),name:'Synthetic RRH referral '},{id:52,code:E('PROBSOLV'),name:'Synthetic diversion'},{id:53,code:E('POSTPLACEFOLLOWUP'),name:'Synthetic follow-up'},{id:54,code:E('CRISISNEEDS'),name:'Synthetic crisis assessment'},{id:55,code:'TENANT_CUSTOM_EVENT',name:'Synthetic custom'}],RESULT:[{id:61,code:'SUCCESS',name:'Synthetic success'},{id:62,code:'REJECTED',name:'Synthetic rejected'}]};
const q=(fieldName,questionType,questionId,mandatory=false)=>({fieldName,questionType,questionId,mandatory,children:[],options:options[fieldName]??[]});
const ev=code=>({option:{code:E(code)}});
const input={key:'referral-1',clientId:1,enrollmentId:10,assessmentCode:'SYNTHETIC',eventDate:'2026-10-24T09:00:00-04:00',event:ev('RRH'),location:9001,referralResult:{option:{code:'SUCCESS'}},resultDate:'2026-10-25T13:00:00Z'};
const {location:_l,referralResult:_r,resultDate:_d,...base}=input;
const writeLabel=(_q,o)=>o.name;
const reason=expected=>e=>e instanceof CoordinatedEntryEventConflictError&&e.reason===expected;
const value=(row,field)=>row.sub_assessment_list.find(c=>c.virt_field_name===field)?.answer_value;
// Stored like the live standard endpoint: lookup labels become option IDs; dates read back as MST wall time with -07.
const persist=c=>{const meta=[...Object.values(options)].flat().find(o=>o.name===c.answer_value);return {...c,answer_value:c.question_type==='lookup'?String(meta.id):c.question_type==='date'?new Date(Date.parse(c.answer_value)-7*3600e3).toISOString().replace('T',' ').replace('.000Z','-07'):c.answer_value};};
function fixture(){
 const journal=new Map(),rows=[],writes=[],mobile=[];let mode;
 const parent={...q('EVENTS','sub_assessment',100),children:[q('START','date',1),q('END','date',2),q('EVENT_DATE','date',3),q('EVENT','lookup',4),q('HEADER','label',5),q('HOUSED_SAFE','yes_no',6),q('AFTERCARE','yes_no',7),q('LOCATION','provider',8),q('RESULT','lookup',9),q('RESULT_DATE','date',10),q('NOTES','textbox',11)]};
 const definition={tenant:testTenant,assessmentCode:input.assessmentCode,questions:[parent,q('OTHER','textbox',200)]};
 const enrollment={clientId:1,enrollmentId:10,enrollmentProvider:20,projectStartDate:'2026-10-20T12:00:00',projectExitDate:null,isActive:true};
 const store={withLock:async(_s,fn)=>fn(),read:async s=>structuredClone(journal.get(s)??[]),write:async(s,r)=>journal.set(s,structuredClone(r))};
 const api={tenant:testTenant,enrollments:{listForClient:async()=>({count:1,values:[structuredClone(enrollment)]})},
  assessments:{getDefinition:async()=>structuredClone(definition),get:async()=>[{virt_field_name:'EVENTS',question_type:'sub_assessment',sub_assessment_answer_list:structuredClone(rows)}],
   create:async req=>{writes.push(structuredClone(req));if(mode==='before')throw Error('Uncertain save');
    const sent=req.body[0].subAssessmentQuestionAnswers[0];assert.deepEqual(Object.keys(sent),['subAssessments']);
    rows.push({recordset_id:rows.length+1000,sub_assessment_list:sent.subAssessments.map(persist)});
    if(mode==='changed')rows.at(-1).sub_assessment_list.find(c=>c.virt_field_name==='LOCATION').answer_value=null;
    if(mode==='after')throw Error('Lost response');}},
  // Like the live mobile endpoint: updates only the sent cells of the targeted recordset.
  assessmentsMobile:{addAnswer:async req=>{mobile.push(structuredClone(req));if(mode==='mobile-before')throw Error('Uncertain update');
   const update=req.body[0].subAssessmentQuestionAnswers[0],row=rows.find(r=>r.recordset_id===update.recordset_id);
   for(const c of update.subAssessments){const stored={...c,answer_value:c.question_type==='date'?persist(c).answer_value:c.answer_value};const i=row.sub_assessment_list.findIndex(x=>x.virt_field_name===c.virt_field_name);if(i<0)row.sub_assessment_list.push(stored);else row.sub_assessment_list[i]=stored;}
   if(mode==='mobile-clears-location')row.sub_assessment_list.find(c=>c.virt_field_name==='LOCATION').answer_value=null;
   if(mode==='mobile-after')throw Error('Lost update response');}}};
 return {api,store,rows,journal,parent,definition,writes,mobile,recorder:()=>createCoordinatedEntryEventRecorder({api,store,fields,writeLabel}),mode:v=>{mode=v;}};
}
test('a referral keeps its provider location, result and lookup labels through the standard endpoint',async()=>{
 const f=fixture(),r=await f.recorder().record(input);
 assert.equal(r.outcome,'verified');assert.equal(r.startDate,'2026-10-20T12:00:00.000Z');assert.equal(r.eventDate,'2026-10-24T13:00:00.000Z');
 const sent=f.writes[0].body[0].subAssessmentQuestionAnswers[0].subAssessments,cell=field=>sent.find(c=>c.virt_field_name===field)?.answer_value;
 assert.equal(cell('EVENT'),'Synthetic RRH referral ');assert.equal(cell('RESULT'),'Synthetic success');assert.equal(cell('LOCATION'),'9001');
 assert.equal(cell('END'),undefined);assert.equal(cell('HOUSED_SAFE'),undefined);assert.equal(f.writes[0].query.dateEffective,r.eventDate);assert.equal(f.mobile.length,0);
 assert.equal(value(f.rows[0],'LOCATION'),'9001');assert.equal(value(f.rows[0],'EVENT'),'51');
 assert.equal((await f.recorder().record(input)).outcome,'already-present');assert.equal(f.writes.length,1);
});
test('each event accepts only its own follow-up answers',async()=>{
 const f=fixture(),cases=[
  [{...base,key:'a',event:ev('RRH')},'location-required'],
  [{...base,key:'b',event:ev('CRISISNEEDS'),location:9001},'location-not-applicable'],
  [{...base,key:'c',event:ev('CRISISNEEDS'),housedSafely:true},'housedSafely-not-applicable'],
  [{...base,key:'d',event:ev('PROBSOLV'),enrolledInAftercare:true},'enrolledInAftercare-not-applicable'],
  [{...base,key:'e',event:ev('PROBSOLV'),referralResult:{option:{code:'SUCCESS'}},resultDate:'2026-10-25T13:00:00Z'},'referral-result-not-applicable'],
  [{...base,key:'f',event:ev('RRH'),location:9001,referralResult:{option:{code:'SUCCESS'}}},'referral-result-and-date-required-together'],
  [{...base,key:'g',event:ev('RRH'),location:9001,resultDate:'2026-10-25T13:00:00Z'},'referral-result-and-date-required-together'],
  [{...base,key:'h',event:ev('RRH'),location:9001,referralResult:{option:{code:'SUCCESS'}},resultDate:'2026-10-23T13:00:00Z'},'result-before-event'],
  [{...base,key:'i',event:ev('HDR_ACCESS')},'unsupported-event'],
  [{...base,key:'j',event:{option:{code:'TENANT_CUSTOM_EVENT'}}},'unsupported-event'],
  [{...base,key:'k',event:{value:'Synthetic diversion'}},'event-option-required'],
  [{...base,key:'l',event:ev('RRH'),location:'Synthetic Shelter'},'location-provider-id-required'],
  [{...base,key:'m',event:ev('CRISISNEEDS'),additionalAnswers:{LOCATION:{value:9001}}},'reserved-field-override'],
 ];
 for(const [event,expected] of cases)await assert.rejects(f.recorder().record(event),reason(expected),expected);
 assert.equal(f.writes.length,0);
 const diversion=await f.recorder().record({...base,key:'diversion',event:ev('PROBSOLV'),housedSafely:true});assert.equal(value(f.rows[0],'HOUSED_SAFE'),'Yes');
 await f.recorder().record({...base,key:'follow-up',event:ev('POSTPLACEFOLLOWUP'),enrolledInAftercare:false});assert.equal(value(f.rows[1],'AFTERCARE'),'No');
 await f.recorder().record({...base,key:'pending-result',event:ev('RRH'),location:9001});assert.equal(value(f.rows[2],'RESULT'),undefined);
 await f.recorder().record({...base,key:'access',event:{option:{name:'Synthetic crisis assessment'}},additionalAnswers:{NOTES:{value:'Synthetic note'}}});assert.equal(value(f.rows[3],'NOTES'),'Synthetic note');
 assert.equal(diversion.outcome,'verified');assert.equal(f.writes.length,4);
});
test('distinct event keys create separate rows; lost and failed acknowledgements reconcile without resending',async()=>{
 const f=fixture();await f.recorder().record(input);await f.recorder().record({...input,key:'referral-2'});assert.equal(f.rows.length,2);
 const lost=fixture();lost.mode('after');assert.equal((await lost.recorder().record(input)).outcome,'reconciled');assert.equal(lost.writes.length,1);
 const none=fixture();none.mode('before');await assert.rejects(none.recorder().record(input),reason('uncertain-event-save'));
 await assert.rejects(none.recorder().record(input),reason('uncertain-event-save'));await assert.rejects(none.recorder().record({...input,key:'other'}),reason('unfinished-event'));
 assert.equal(none.writes.length,1);
});
test('a dropped answer leaves the event uncertain instead of verified',async()=>{
 const f=fixture();f.mode('changed');await assert.rejects(f.recorder().record(input),reason('uncertain-event-save'));assert.equal(f.writes.length,1);
});
test('instruments with mandatory questions, missing mapped fields and events outside the enrollment are refused before writing',async()=>{
 const f=fixture();f.definition.questions[1].mandatory=true;await assert.rejects(f.recorder().record(input),reason('instrument-has-mandatory-questions'));
 const g=fixture();g.parent.children=g.parent.children.filter(c=>c.fieldName!=='AFTERCARE');await assert.rejects(g.recorder().record(input),reason('enrolledInAftercare-field-unavailable'));
 const h=fixture();await assert.rejects(h.recorder().record({...input,eventDate:'2026-10-19T00:00:00Z'}),reason('event-outside-enrollment'));
 assert.throws(()=>createCoordinatedEntryEventRecorder({api:h.api,store:h.store,fields}),reason('write-label-required'));
 const {location:_,...missing}=fields;assert.throws(()=>createCoordinatedEntryEventRecorder({api:h.api,store:h.store,fields:missing,writeLabel}),reason('invalid-field-mapping'));
 assert.equal(f.writes.length+g.writes.length+h.writes.length,0);
});
test('a mandatory child must be answered, and later changes to verified or existing rows are refused',async()=>{
 const f=fixture();f.parent.children.find(c=>c.fieldName==='NOTES').mandatory=true;
 await assert.rejects(f.recorder().record(input),reason('platform-required-field:NOTES'));assert.equal(f.writes.length,0);
 const g=fixture();await g.recorder().record(input);g.rows[0].sub_assessment_list.find(c=>c.virt_field_name==='RESULT').answer_value=null;
 await assert.rejects(g.recorder().record(input),reason('verified-event-changed'));
 const h=fixture();await h.recorder().record(input);h.mode('before');await assert.rejects(h.recorder().record({...input,key:'referral-2'}),reason('uncertain-event-save'));
 h.rows[0].sub_assessment_list.find(c=>c.virt_field_name==='RESULT').answer_value=null;
 await assert.rejects(h.recorder().record({...input,key:'referral-2'}),reason('existing-event-changed'));assert.equal(h.writes.length,2);
});
test('a changed intent under an existing key is refused',async()=>{
 const f=fixture();await f.recorder().record(input);
 await assert.rejects(f.recorder().record({...input,location:14260}),reason('intent-or-schema-changed'));assert.equal(f.writes.length,1);
});
test('a future-dated diversion verifies its yes/no result through a read after the event instant',async()=>{
 const f=fixture(),get=f.api.assessments.get,eventDate='2099-01-01T16:00:00Z',queries=[];
 // Live reads hide rows dated after the query, and omit yes/no answers saved at exactly the queried instant.
 f.api.assessments.get=async args=>{const at=args.query?.dateEffective;queries.push(at);const result=await get(args);
  result[0].sub_assessment_list=undefined;result[0].sub_assessment_answer_list=result[0].sub_assessment_answer_list.map(r=>{const when=Date.parse(f.writes.at(-1)?.query.dateEffective??0);return {...r,sub_assessment_list:r.sub_assessment_list.map(c=>c.question_type==='yes_no'&&Date.parse(at)===when?{...c,answer_value:null}:c)};}).filter(()=>Date.parse(at)>=Date.parse(eventDate)||!f.writes.length);
  return result;};
 const r=await f.recorder().record({...base,key:'future-diversion',eventDate,event:ev('PROBSOLV'),housedSafely:false});
 assert.equal(r.outcome,'verified');assert.ok(queries.every(at=>at==='2099-01-01T16:00:01Z'));
});
test('referral results need an option selector, and a mandatory parent question blocks the instrument',async()=>{
 const f=fixture();
 await assert.rejects(f.recorder().record({...input,referralResult:{value:'Synthetic success'}}),reason('referral-result-option-required'));
 await assert.rejects(f.recorder().record({...input,additionalAnswers:{NOTES:null}}),reason('invalid-input'));
 f.definition.questions[0].mandatory=true;await assert.rejects(f.recorder().record(input),reason('instrument-has-mandatory-questions'));
 assert.equal(f.writes.length,0);
});
const pending={...base,key:'pending',event:ev('RRH'),location:9001};
const later={key:'pending',clientId:1,assessmentCode:'SYNTHETIC',referralResult:{option:{code:'SUCCESS'}},resultDate:'2026-10-26T13:00:00Z'};
test('a referral result added later updates only its row and keeps the location',async()=>{
 const f=fixture();await f.recorder().record(pending);await f.recorder().record({...base,key:'other',event:ev('CRISISNEEDS')});
 const other=structuredClone(f.rows[1]),r=await f.recorder().recordResult(later);
 assert.equal(r.outcome,'verified');assert.equal(r.recordsetId,1000);assert.equal(f.mobile.length,1);
 const update=f.mobile[0].body[0].subAssessmentQuestionAnswers[0];assert.equal(update.recordset_id,1000);assert.deepEqual(update.subAssessments.map(c=>c.virt_field_name),['RESULT','RESULT_DATE']);
 assert.equal(value(f.rows[0],'RESULT'),'61');assert.equal(value(f.rows[0],'LOCATION'),'9001');assert.deepEqual(f.rows[1],other);
 assert.equal((await f.recorder().recordResult(later)).outcome,'already-present');assert.equal((await f.recorder().record(pending)).outcome,'already-present');assert.equal(f.mobile.length,1);
});
test('results are refused for events that do not take them, unverified keys, early dates and conflicting results',async()=>{
 const f=fixture();await f.recorder().record({...base,key:'diversion',event:ev('PROBSOLV')});await f.recorder().record(input);
 await assert.rejects(f.recorder().recordResult({...later,key:'diversion'}),reason('referral-result-not-applicable'));
 await assert.rejects(f.recorder().recordResult({...later,key:'missing'}),reason('event-not-verified'));
 await assert.rejects(f.recorder().recordResult({...later,key:'referral-1',resultDate:'2026-10-23T13:00:00Z'}),reason('result-before-event'));
 await assert.rejects(f.recorder().recordResult({...later,key:'referral-1',referralResult:{option:{code:'REJECTED'}}}),reason('result-conflict'));
 await assert.rejects(f.recorder().recordResult({...later,key:'referral-1',referralResult:{value:'Synthetic success'}}),reason('referral-result-option-required'));
 assert.equal((await f.recorder().recordResult({...later,key:'referral-1',resultDate:'2026-10-25T13:00:00Z'})).outcome,'already-present');
 assert.equal(f.mobile.length,0);
});
test('a lost result acknowledgement reconciles; an unknown outcome blocks without resending',async()=>{
 const lost=fixture();await lost.recorder().record(pending);lost.mode('mobile-after');assert.equal((await lost.recorder().recordResult(later)).outcome,'reconciled');
 const none=fixture();await none.recorder().record(pending);none.mode('mobile-before');
 await assert.rejects(none.recorder().recordResult(later),reason('uncertain-result-save'));await assert.rejects(none.recorder().recordResult(later),reason('uncertain-result-save'));
 none.mode(undefined);await assert.rejects(none.recorder().record({...input,key:'next'}),reason('unfinished-event'));
 await assert.rejects(none.recorder().recordResult({...later,referralResult:{option:{code:'REJECTED'}}}),reason('result-intent-changed'));
 assert.equal(none.mobile.length,1);assert.equal(none.writes.length,1);
});
test('an update that clears the location is not treated as saved',async()=>{
 const f=fixture();await f.recorder().record(pending);f.mode('mobile-clears-location');
 await assert.rejects(f.recorder().recordResult(later),reason('verified-event-changed'));assert.equal(f.mobile.length,1);
});
test('recordResult journal and drift cases: blocked keys, row changes, verified drift and changed intents',async()=>{
 // An unfinished update blocks results for other keys too.
 const a=fixture();await a.recorder().record(pending);await a.recorder().record({...pending,key:'second',eventDate:'2026-10-24T10:00:00-04:00'});a.mode('mobile-before');
 await assert.rejects(a.recorder().recordResult(later),reason('uncertain-result-save'));a.mode(undefined);
 await assert.rejects(a.recorder().recordResult({...later,key:'second'}),reason('unfinished-event'));
 // Another row changing during the update is not accepted.
 const b=fixture();await b.recorder().record(pending);await b.recorder().record({...base,key:'other',event:ev('CRISISNEEDS')});
 const add=b.api.assessmentsMobile.addAnswer;b.api.assessmentsMobile.addAnswer=async req=>{await add(req);b.rows[1].sub_assessment_list.find(c=>c.virt_field_name==='EVENT').answer_value='52';};
 await assert.rejects(b.recorder().recordResult(later),reason('existing-event-changed'));
 // A verified result that later changes, and a different result after verification.
 const c=fixture();await c.recorder().record(pending);await c.recorder().recordResult(later);
 await assert.rejects(c.recorder().recordResult({...later,referralResult:{option:{code:'REJECTED'}}}),reason('result-intent-changed'));
 c.rows[0].sub_assessment_list.find(x=>x.virt_field_name==='RESULT').answer_value='62';
 await assert.rejects(c.recorder().recordResult(later),reason('verified-result-changed'));
 // After a reconciled lost acknowledgement, a retry is already present.
 const d=fixture();await d.recorder().record(pending);d.mode('mobile-after');await d.recorder().recordResult(later);d.mode(undefined);
 assert.equal((await d.recorder().recordResult(later)).outcome,'already-present');assert.equal(d.mobile.length,1);
 // A malformed update entry in the journal is refused.
 const e=fixture();await e.recorder().record(pending);const [scope,entries]=[...e.journal][0];entries[0].update={stage:'attempted',intentHash:'x'};e.journal.set(scope,entries);
 await assert.rejects(e.recorder().recordResult(later),reason('invalid-journal'));await assert.rejects(e.recorder().record(pending),reason('invalid-journal'));
});
test('an event end-dated after it was recorded is still already present',async()=>{
 const f=fixture();await f.recorder().record(input);
 f.rows[0].sub_assessment_list.push({question_id:2,question_type:'date',virt_field_name:'END',answer_value:'2026-10-30 10:00:00-07'});
 assert.equal((await f.recorder().record(input)).outcome,'already-present');assert.equal(f.writes.length,1);
});
test('an enrollment session records events for household enrollments that the REST list cannot read',async()=>{
 const f=fixture(),reads=[];f.api.enrollments.listForClient=async()=>{throw Object.assign(Error('42703: column v.entry_date_effective does not exist'),{status:400});};
 const enrollmentSession={readEnrollment:async target=>{reads.push(target);return {source:'gwt-rpc',tenant:testTenant,clientId:1,enrollmentId:10,projectStartDate:'2026-10-20T12:00:00.000Z',providerId:20,enrollmentType:'HUD',members:[{clientId:1,enrollmentId:10}],exits:[{clientId:1,enrollmentId:10,projectExitDate:null}],reviews:[]};}};
 const recorder=()=>createCoordinatedEntryEventRecorder({api:f.api,store:f.store,fields,writeLabel,enrollmentSession});
 const r=await recorder().record(input);assert.equal(r.outcome,'verified');assert.equal(r.startDate,'2026-10-20T12:00:00.000Z');assert.deepEqual(reads,[{clientId:1,enrollmentId:10}]);
 assert.equal((await recorder().record(input)).outcome,'already-present');assert.equal(f.writes.length,1);
});
