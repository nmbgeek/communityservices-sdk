const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDateOfBirth} from '@choiceapps/communityservices-sdk/browser';
import {createEnrollmentWorkflow} from '@choiceapps/communityservices-sdk/browser';
import {createMemberEntryDatePort} from '@choiceapps/communityservices-sdk/browser';
import {createFileGwtMutationStore} from '@choiceapps/communityservices-sdk/browser';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const entryDate='2026-10-19T16:00:00Z',reviewDate='2026-10-22T16:00:00Z',exitDate='2026-10-23T16:00:00Z';
const question=(id,field,type,extra={})=>({questionId:id,fieldName:field,questionType:type,description:field,displayOrder:id,mandatory:false,showOnPrevious:true,picklistId:null,options:[],children:[],...extra});
const metadata=[question(1,'TOTAL','money'),question(2,'OPTIONAL','textbox'),question(3,'ROWS','sub_assessment',{children:[question(4,'TYPE','textbox'),question(5,'START','date'),question(6,'END','date')]})];
const row=(key,start=entryDate)=>({key,parentField:'ROWS',answers:{TYPE:{value:key},START:{value:start}}});
const assessment=(id)=>({answers:{TOTAL:{value:id}},notApplicable:{OPTIONAL:'Synthetic not applicable'},subassessments:[row('a'),row('b')]});
const entryInput=()=>({key:'entry',householdId:30,headClientId:1,providerId:2,type:'HUD',entryDate,members:[{clientId:1,assessment:assessment(1)},{clientId:2,assessment:assessment(2)}]});
const interimInput=()=>({key:'interim',enrollmentKey:'entry',headClientId:1,reviewDate,members:[1,2].map(clientId=>({clientId,assessment:{answers:{TOTAL:{value:clientId*100}},notApplicable:{OPTIONAL:'Synthetic not applicable'},carryForward:['ROWS']}}))});

/** The external server and durable store are simulated; discovery, encoding, coverage,
 * journal state, reconciliation and locking all run through the real workflow. */
function fixture(faults={}){
 const clients=new Map([1,2,3,4].map(id=>[id,{rows:[],history:[],reviews:[]}])) ,entries=[],exits=new Map(),exitDetails=new Map(),exitCounts={validate:0,save:0,end:0},journal=new Map(),locks=new Map(),held=new Set();
 const counts={entry:0,attach:0,review:0,scalar:0,rows:0};let nextRow=100,reviewAttempted=false;const attachmentAttempts=new Set(),additionCounts={date:0};
 const household={householdId:30,isActive:true,clients:[1,2,3,4].map(clientId=>({clientId,headofhouseholdStatus:clientId===1,isActive:true,dateJoined:entryDate,dateLeft:null}))};
 const store={async withLock(scope,work){const previous=locks.get(scope)??Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve;});locks.set(scope,gate);await previous;held.add(scope);try{return await work();}finally{held.delete(scope);release();}},async read(scope){assert.ok(held.has(scope),'read requires exact scope lock');return structuredClone(journal.get(scope)??[]);},async write(scope,data){assert.ok(held.has(scope),'write requires exact scope lock');journal.set(scope,structuredClone(data));}};
 const readAnswers=(clientId,at)=>metadata.map(q=>{if(q.questionType==='sub_assessment')return {virt_field_name:q.fieldName,question_type:q.questionType,sub_assessment_answer_list:structuredClone(clients.get(clientId).rows)};const found=clients.get(clientId).history.filter(h=>h.field===q.fieldName&&(!at||Date.parse(h.date)<=Date.parse(at))).at(-1);return {virt_field_name:q.fieldName,question_type:q.questionType,answer_value:found?.value??null,date_effective:found?.date??null};});
 const api={tenant:testTenant,clients:{get:async({path})=>({clientId:path.clientId,isActive:true})},households:{get:async()=>structuredClone(household)},providers:{list:async()=>({count:1,values:[{providerId:2,providerName:'Synthetic program',active:true,operational:true,hudCompliant:true,parentProviderID:null,providerGrantType:null,dateAdded:'2026-01-01',dateUpdated:'2026-01-01'}]})},
  enrollments:{async listForClient({path}){if(entries.some(e=>e.grouped&&e.clientId===path.clientId)){const error=new Error('Grouped REST view unavailable');error.status=400;throw error;}const values=entries.filter(e=>e.clientId===path.clientId);return {count:values.length,values:structuredClone(values)};},async createEntryAssessment({body}){counts.entry++;entries.push({enrollmentId:50,clientId:body.clientId,enrollmentProvider:body.providerId,type:body.type,projectStartDate:body.projectStartDate,isActive:true});},async updateEntryAssessment({query,body}){assert.deepEqual(Object.keys(body),['projectStartDate']);additionCounts.date++;const target=entries.find(e=>e.enrollmentId===query.enrollment_id);assert.ok(target);if(faults.dateNoCommit||faults.dateNoCommitClient===target.clientId)throw Error('Entry date response lost before commit');target.projectStartDate=body.projectStartDate;if(faults.corruptOtherDate)entries.find(e=>e.clientId!==target.clientId).projectStartDate='2026-10-18T16:00:00Z';if(faults.corruptOtherExit)setExit(entries.find(e=>e.clientId!==target.clientId).clientId);if(faults.lostDateResponse)throw Error('Entry date response lost after commit');}},
  assessments:{getDefinition:async({assessmentCode,effectiveDate})=>({tenant:api.tenant,assessmentCode,effectiveDate,retrievedAt:new Date().toISOString(),picklistEffectiveDate:'current',questions:structuredClone(assessmentCode==='EXIT'&&faults.exitMetadata?faults.exitMetadata:metadata),unresolvedPicklists:[]}),get:async({path,query})=>readAnswers(path.clientId,query?.dateEffective)},
  assessmentsMobile:{async addAnswer({path,query,body}){const state=clients.get(path.clientId),isRows=body.some(q=>q.question_type==='sub_assessment');counts[isRows?'rows':'scalar']++;for(const q of body){if(q.question_type==='sub_assessment'){for(const row of q.subAssessmentQuestionAnswers){state.rows.push({recordset_id:nextRow++,sub_assessment_list:row.subAssessments.map(q=>({...q,answer_value:q.answer_value||null}))});if(faults.partialRowsClient===path.clientId)throw Error('Partial batch response lost');}}else{state.history.push({field:q.virt_field_name,value:q.answer_value,date:query.dateEffective});if(path.assessmentCode==='EXIT'&&faults.partialExitScalarsClient===path.clientId)throw Error('Partial scalar response lost');}}return {success:true};}},
  subassessments:{async setEndDate({clientId,recordsetId,endDateField,endDate}){exitCounts.end++;clients.get(clientId).rows.find(r=>r.recordset_id===recordsetId).sub_assessment_list.find(q=>q.virt_field_name===endDateField).answer_value=endDate;}},
 };
 const discovery={getProviderAssessments:async({providerId})=>({providerId,defaults:['entry','interim','exit'].map((phase,i)=>({location:['showHudEntry','showHudInterim','showHudExit'][i],resolution:'resolved',assessment:{assessmentId:i+1,code:phase.toUpperCase(),name:phase,assignedToAssessmentTab:true}}))})};
 const enrollmentSession={async readEnrollment(target){const e=entries.find(e=>e.enrollmentId===target.enrollmentId&&e.clientId===target.clientId);assert.ok(e,'authoritative target exists');return {source:'gwt-rpc',tenant:api.tenant,sessionId:'session',revision:'fresh',...target,providerId:e.enrollmentProvider,enrollmentType:e.type,projectStartDate:e.projectStartDate,householdClientIds:[1,2,3,4],members:entries.filter(member=>e.grouped?member.grouped:member.enrollmentId===e.enrollmentId).map(e=>({clientId:e.clientId,enrollmentId:e.enrollmentId})),reviews:structuredClone(clients.get(target.clientId).reviews),exits:entries.filter(member=>e.grouped?member.grouped:member.enrollmentId===e.enrollmentId).map(m=>structuredClone(exits.get(m.clientId)??{clientId:m.clientId,enrollmentId:m.enrollmentId,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null,clientIds:[m.clientId],enrollmentIds:[m.enrollmentId]})),...(faults.snapshot??{})};}};
 const attachMember=clientId=>{if(!entries.some(e=>e.clientId===clientId)){entries.push({...entries[0],clientId,enrollmentId:50+clientId,grouped:true});}entries[0].grouped=true;};
 const helpers={
  async addHouseholdMembers(input){if(!input.memberClientIds.every(id=>entries.some(e=>e.clientId===id))){const attempt=JSON.stringify([input.clientId,input.enrollmentId,[...input.memberClientIds].sort((a,b)=>a-b)]);if(attachmentAttempts.has(attempt))throw Error('uncertain attachment');attachmentAttempts.add(attempt);counts.attach++;for(const id of input.memberClientIds){attachMember(id);if(faults.partialAttachment)throw Error('partial attachment');}if(faults.corruptAttachmentDate)entries[0].projectStartDate='2026-10-18T16:00:00Z';if(faults.lostAttachmentResponse)throw Error('attachment response lost');}return {outcome:'reconciled',snapshot:await enrollmentSession.readEnrollment(input)};},
  async createInterimUpdate(input){const existing=clients.get(input.clientId).reviews.filter(r=>r.type==='Update'&&Date.parse(r.reviewDate)===Date.parse(input.reviewDate));if(!existing.length){if(reviewAttempted)throw Error('uncertain review');reviewAttempted=true;counts.review++;for(const id of input.clientIds)clients.get(id).reviews.push({reviewId:60+id,type:'Update',reviewDate:input.reviewDate,clientIds:[...input.clientIds]});}return {outcome:'reconciled',snapshot:await enrollmentSession.readEnrollment(input)};},
 };
 const setExit=(clientId,input=exitInput(),overrides={})=>{const member=entries.find(e=>e.clientId===clientId);assert.ok(member);const selected=input.clientIds??input.members?.map(m=>m.clientId)??[1,2];exits.set(clientId,{clientId,enrollmentId:member.enrollmentId,projectExitDate:input.exitDate,destination:input.destination,destinationCode:'RENTAL',reasonForLeaving:input.reasonForLeaving,reasonForLeavingCode:'COMPLETED',exitSubgroupId:selected.length===2&&selected.includes(1)&&selected.includes(2)?'exit-group-50':'exit-group-'+selected.join('-'),clientIds:[...selected],enrollmentIds:selected.map(id=>entries.find(e=>e.clientId===id).enrollmentId),...overrides});exitDetails.set(clientId,{destinationDetails:structuredClone(input.destinationDetails??null),reasonForLeavingOther:input.reasonForLeavingOther??null});};
 const exitUi={async readExitDetails(target){if(faults.exitDetailsReadFails)throw Error('Exit detail read unavailable');return structuredClone(exitDetails.get(target.clientId)??{destinationDetails:null,reasonForLeavingOther:null});},async validateExit(input){exitCounts.validate++;assert.ok(input.clientIds.length>0);assert.ok(input.clientIds.includes(input.clientId));assert.equal(entries.find(e=>e.clientId===input.clientId)?.enrollmentId,input.enrollmentId);if(faults.exitValidation)throw Error('Invalid UI exit option');},async saveExit(input){exitCounts.save++;if(faults.exitNoCommit)throw Error('Exit response lost before commit');for(const id of input.clientIds){setExit(id,input);if(faults.partialExit)throw Error('Partial exit response lost');}const excluded=entries.find(e=>!input.clientIds.includes(e.clientId));if(excluded&&faults.changeUnselectedEntryDate)excluded.projectStartDate='2026-10-20T16:00:00Z';if(excluded&&faults.changeUnselectedExit)setExit(excluded.clientId,{...input,clientIds:[excluded.clientId]});if(excluded&&faults.changeUnselectedDetails)exitDetails.get(excluded.clientId).reasonForLeavingOther='Unexpected changed reason';if(faults.lostExitResponse)throw Error('Exit response lost after commit');}};
 const memberEntryDatePort=createMemberEntryDatePort({api,enrollmentSession});
 return {api,store,discovery,helpers,enrollmentSession,memberEntryDatePort,additionCounts,exitUi,entries,exits,exitDetails,exitCounts,setExit,clients,journal,counts,household,attachMember,workflow:()=>createEnrollmentWorkflow({api,store,discovery,helpers,enrollmentSession,exitUi,memberEntryDatePort})};
}

test('household entry and review retain distinct member identities and member-specific answers',async()=>{
 const f=fixture(),entry=await f.workflow().createHouseholdEnrollment(entryInput()),interim=await f.workflow().createHouseholdInterim(interimInput());
 assert.deepEqual(entry.members.map(m=>m.enrollmentId),[50,52]);assert.deepEqual(interim.members.map(m=>m.reviewId),[61,62]);
 assert.equal(new Set(entry.members.flatMap(m=>Object.values(m.recordsetIds))).size,4);
 for(const id of [1,2]){assert.equal(f.clients.get(id).history[0].value,String(id));assert.equal(f.clients.get(id).history.at(-1).value,String(id*100));assert.equal(f.clients.get(id).rows.length,2);}
 assert.deepEqual(f.counts,{entry:1,attach:1,review:1,scalar:4,rows:2});
});
test('reordered household input and new factory reconcile entry and interim with zero extra writes',async()=>{
 const f=fixture(),entry=await f.workflow().createHouseholdEnrollment(entryInput()),interim=await f.workflow().createHouseholdInterim(interimInput()),before=structuredClone(f.counts);
 const entryAgain=entryInput();entryAgain.members.reverse();const interimAgain=interimInput();interimAgain.members.reverse();
 assert.equal((await f.workflow().createHouseholdEnrollment(entryAgain)).outcome,'already-present');const result=await f.workflow().createHouseholdInterim(interimAgain);assert.equal(result.outcome,'already-present');assert.deepEqual(result.members,interim.members.map(member=>({...member,outcome:'already-present'})));assert.deepEqual(f.counts,before);assert.equal(entry.members.length,2);
});
test('lost household attachment response reconciles linked IDs without replaying writes',async()=>{
 const f=fixture({lostAttachmentResponse:true});await assert.rejects(f.workflow().createHouseholdEnrollment(entryInput()),/response lost/);const result=await f.workflow().createHouseholdEnrollment(entryInput());assert.equal(result.members.length,2);assert.equal(f.counts.attach,1);assert.equal(f.counts.entry,1);
});
test('partial household attachment blocks retry until authoritative membership reconciles',async()=>{
 const f=fixture({partialAttachment:true}),input=entryInput();input.members.push({clientId:3,assessment:assessment(3)});
 await assert.rejects(f.workflow().createHouseholdEnrollment(input),/partial attachment/);await assert.rejects(f.workflow().createHouseholdEnrollment(input),/uncertain attachment/);assert.equal(f.counts.attach,1);
 f.attachMember(3);const result=await f.workflow().createHouseholdEnrollment(input);assert.deepEqual(result.members.map(m=>m.enrollmentId),[50,52,53]);assert.equal(f.counts.attach,1);
});
test('partial member verification batch blocks resend and unrelated client workflows',async()=>{
 const f=fixture({partialRowsClient:2});await assert.rejects(f.workflow().createHouseholdEnrollment(entryInput()),/uncertain write/);const before=structuredClone(f.counts);await assert.rejects(f.workflow().createHouseholdEnrollment(entryInput()),/uncertain write/);assert.deepEqual(f.counts,before);
 await assert.rejects(f.workflow().createEnrollment({key:'other',clientId:1,providerId:2,type:'HUD',entryDate,assessment:assessment(1)}),/unfinished household/);
 const second=structuredClone(f.clients.get(2).rows[0]);second.recordset_id=999;second.sub_assessment_list.find(q=>q.virt_field_name==='TYPE').answer_value='b';f.clients.get(2).rows.push(second);
 await f.workflow().createHouseholdEnrollment(entryInput());assert.deepEqual(f.counts,before);
});
test('household stable keys reject changed members or assessment intent without writes',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts);
 for(const change of [input=>input.members.push({clientId:3,assessment:assessment(3)}),input=>{input.members[1].assessment.answers.TOTAL={value:99};}]){const input=entryInput();change(input);await assert.rejects(f.workflow().createHouseholdEnrollment(input),/conflicts/);}
 const interim=interimInput();interim.members.push({clientId:3,assessment:assessment(3)});await assert.rejects(f.workflow().createHouseholdInterim(interim),/identical members/);assert.deepEqual(f.counts,before);
});
test('every member assessment is preflighted before creating any enrollment',async()=>{
 for(const change of [input=>{delete input.members[1].assessment.notApplicable;},input=>{input.members[1].assessment.subassessments=[];},input=>{input.members[1].assessment.carryForward=['OPTIONAL'];delete input.members[1].assessment.notApplicable;}]){const f=fixture(),input=entryInput();change(input);await assert.rejects(f.workflow().createHouseholdEnrollment(input));assert.deepEqual(f.counts,{entry:0,attach:0,review:0,scalar:0,rows:0});}
});
test('authoritative enrollment context mismatch stops attachment and member writes',async()=>{
 for(const snapshot of [{providerId:99},{enrollmentType:'VA'},{projectStartDate:'2026-10-20T16:00:00Z'}]){const f=fixture({snapshot});await assert.rejects(f.workflow().createHouseholdEnrollment(entryInput()),/context mismatch/);assert.equal(f.counts.attach,0);assert.equal(f.counts.scalar,0);assert.equal(f.counts.rows,0);assert.equal(f.clients.get(2).rows.length,0);}
});
test('an adopted head enrollment with unexpected members is rejected before changing answers',async()=>{
 const f=fixture({snapshot:{members:[{clientId:1,enrollmentId:50},{clientId:3,enrollmentId:53}]}});
 f.entries.push({enrollmentId:50,clientId:1,enrollmentProvider:2,type:'HUD',projectStartDate:entryDate,isActive:true});
 await assert.rejects(f.workflow().createHouseholdEnrollment(entryInput()),/enrollment members changed/);
 assert.deepEqual(f.counts,{entry:0,attach:0,review:0,scalar:0,rows:0});
});
test('concurrent household calls serialize both entry and interim',async()=>{
 const f=fixture(),results=await Promise.all([f.workflow().createHouseholdEnrollment(entryInput()),f.workflow().createHouseholdEnrollment(entryInput())]);assert.deepEqual(results.map(r=>r.outcome),['verified','already-present']);
 const reviews=await Promise.all([f.workflow().createHouseholdInterim(interimInput()),f.workflow().createHouseholdInterim(interimInput())]);assert.deepEqual(reviews.map(r=>r.outcome),['verified','already-present']);assert.deepEqual(f.counts,{entry:1,attach:1,review:1,scalar:4,rows:2});
});
test('existing independent member interim prevents household review creation',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());f.clients.get(2).reviews.push({reviewId:999,type:'Update',reviewDate,clientIds:[2]});const before=structuredClone(f.counts);
 await assert.rejects(f.workflow().createHouseholdInterim(interimInput()));assert.deepEqual(f.counts,before);
});
test('every interim plan is validated before shared review creation',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const input=interimInput();input.members[1].assessment.endDates=[{parentField:'ROWS',recordsetId:999,startDateField:'START',endDateField:'END',endDate:'2026-10-21T16:00:00Z'}];input.members[1].assessment.carryForward=[];
 await assert.rejects(f.workflow().createHouseholdInterim(input),/target missing/);assert.equal(f.counts.review,0);
});
test('real durable file store supports household scope locks and restarted workflow retry',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wellsky-household-workflow-'));
 try{
  const f=fixture(),workflow=()=>createEnrollmentWorkflow({api:f.api,discovery:f.discovery,helpers:f.helpers,enrollmentSession:f.enrollmentSession,store:createFileGwtMutationStore(directory)});
  const entry=await workflow().createHouseholdEnrollment(entryInput()),interim=await workflow().createHouseholdInterim(interimInput()),before=structuredClone(f.counts);
  assert.equal((await workflow().createHouseholdEnrollment(entryInput())).outcome,'already-present');assert.equal((await workflow().createHouseholdInterim(interimInput())).outcome,'already-present');assert.deepEqual(f.counts,before);
  assert.deepEqual(entry.members.map(m=>m.enrollmentId),[50,52]);assert.deepEqual(interim.members.map(m=>m.reviewId),[61,62]);
 }finally{await rm(directory,{recursive:true,force:true});}
});

function exitInput(){return {key:'exit',enrollmentKey:'entry',headClientId:1,exitDate,destination:'Rental by client (HUD)',reasonForLeaving:'Completed program',members:[1,2].map(clientId=>({clientId,assessment:{answers:{TOTAL:{value:clientId*1000},OPTIONAL:{value:'Exit answer '+clientId}},carryForward:['ROWS']}}))};}

test('household exits populate every member and reordered retries perform no writes',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().createHouseholdInterim(interimInput());
 const result=await f.workflow().exitHousehold(exitInput());assert.equal(result.outcome,'verified');assert.deepEqual(result.members.map(m=>m.enrollmentId),[50,52]);
 for(const member of result.members){assert.equal(member.assessmentCode,'EXIT');assert.equal(Date.parse(member.projectExitDate),Date.parse(exitDate));assert.equal(member.exitSubgroupId,'exit-group-50');assert.equal(f.clients.get(member.clientId).history.at(-2).value,String(member.clientId*1000));}
 const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts}),again=exitInput();again.members.reverse();
 assert.equal((await f.workflow().exitHousehold(again)).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
});
test('all exit member plans preflight before the shared exit or assessment writes',async()=>{
 for(const change of [input=>{delete input.members[1].assessment.answers.OPTIONAL;},input=>{input.members[1].assessment.endDates=[{parentField:'ROWS',recordsetId:999,startDateField:'START',endDateField:'END',endDate:reviewDate}];input.members[1].assessment.carryForward=[];}]){
  const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts),input=exitInput();change(input);await assert.rejects(f.workflow().exitHousehold(input));assert.equal(f.exitCounts.save,0);assert.equal(f.exitCounts.validate,0);assert.deepEqual(f.counts,before);
 }
});
test('existing mixed exit dates, subgroup IDs, labels or memberships fail without writes',async()=>{
 for(const overrides of [{projectExitDate:reviewDate},{exitSubgroupId:'different-group'},{clientIds:[1,2,3],enrollmentIds:[50,52,53]},{clientIds:[2],enrollmentIds:[52]},{destination:'Emergency shelter'},{reasonForLeaving:'Other'},{exitSubgroupId:null}]){
  const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());f.setExit(1);f.setExit(2,exitInput(),overrides);const before=structuredClone(f.counts);
  await assert.rejects(f.workflow().exitHousehold(exitInput()));assert.equal(f.exitCounts.save,0);assert.deepEqual(f.counts,before);
 }
});
test('fully committed exit with a lost response reconciles without a second save',async()=>{
 const f=fixture({lostExitResponse:true});await f.workflow().createHouseholdEnrollment(entryInput());assert.equal((await f.workflow().exitHousehold(exitInput())).outcome,'verified');await f.workflow().exitHousehold(exitInput());assert.equal(f.exitCounts.save,1);
});
test('partial exit save is never retried and can resume after external reconciliation',async()=>{
 const f=fixture({partialExit:true});await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts);
 await assert.rejects(f.workflow().exitHousehold(exitInput()),/uncertain household exit/);await assert.rejects(f.workflow().exitHousehold(exitInput()),/without an enrolled head of household/);assert.equal(f.exitCounts.save,1);assert.deepEqual(f.counts,before);
 f.setExit(2);assert.equal((await f.workflow().exitHousehold(exitInput())).outcome,'verified');assert.equal(f.exitCounts.save,1);
});
test('an exit save with no observed commit blocks retry and a changed operation key',async()=>{
 const faults={exitNoCommit:true},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());
 await assert.rejects(f.workflow().exitHousehold(exitInput()),/uncertain household exit/);faults.exitNoCommit=false;
 await assert.rejects(f.workflow().exitHousehold(exitInput()),/uncertain household exit/);const different=exitInput();different.key='different';await assert.rejects(f.workflow().exitHousehold(different),/unfinished household/);assert.equal(f.exitCounts.save,1);
});
test('exit UI validation failure permits corrected same-intent retry before any save attempt',async()=>{
 const faults={exitValidation:true},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts);
 await assert.rejects(f.workflow().exitHousehold(exitInput()),/Invalid UI/);assert.equal(f.exitCounts.save,0);assert.deepEqual(f.counts,before);faults.exitValidation=false;await f.workflow().exitHousehold(exitInput());assert.equal(f.exitCounts.save,1);
});
test('partial member exit answers require reconciliation and preserve the completed member',async()=>{
 const faults={partialExitScalarsClient:2},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());
 await assert.rejects(f.workflow().exitHousehold(exitInput()),/uncertain write/);assert.equal(f.clients.get(1).history.at(-1).value,'Exit answer 1');const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});
 await assert.rejects(f.workflow().exitHousehold(exitInput()),/uncertain write/);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
 f.clients.get(2).history.push({field:'OPTIONAL',value:'Exit answer 2',date:exitDate});assert.equal((await f.workflow().exitHousehold(exitInput())).outcome,'verified');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
});
test('exit preceding an existing review and interim after a stored exit are rejected',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().createHouseholdInterim(interimInput());const early=exitInput();early.exitDate='2026-10-21T16:00:00Z';const before=structuredClone(f.counts);
 await assert.rejects(f.workflow().exitHousehold(early),/precedes an existing review/);assert.equal(f.exitCounts.save,0);assert.deepEqual(f.counts,before);
 const other=fixture();await other.workflow().createHouseholdEnrollment(entryInput());await other.workflow().exitHousehold(exitInput());const late=interimInput();late.reviewDate='2026-10-24T16:00:00Z';await assert.rejects(other.workflow().createHouseholdInterim(late),/review follows project exit/);assert.equal(other.counts.review,0);
});
test('entry retry after exit verification replacement recognizes the closed original rows',async()=>{
 const f=fixture(),entry=await f.workflow().createHouseholdEnrollment(entryInput()),input=exitInput();
 for(const member of input.members){const original=entry.members.find(m=>m.clientId===member.clientId);member.assessment.carryForward=[];member.assessment.endDates=[{parentField:'ROWS',recordsetId:original.recordsetIds.a,startDateField:'START',endDateField:'END',endDate:reviewDate}];member.assessment.subassessments=[row('replacement-'+member.clientId,exitDate)];}
 const result=await f.workflow().exitHousehold(input);assert.equal(f.exitCounts.end,2);assert.equal(new Set(result.members.flatMap(m=>Object.values(m.recordsetIds))).size,2);
 const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});assert.equal((await f.workflow().createHouseholdEnrollment(entryInput())).outcome,'already-present');assert.equal((await f.workflow().exitHousehold(input)).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);for(const id of [1,2])assert.equal(f.clients.get(id).rows.length,3);
});
test('exit definition drift and changed stable-key intent cannot mutate a verified exit',async()=>{
 const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(exitInput());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});
 const changed=exitInput();changed.members[1].assessment.answers.TOTAL={value:12};await assert.rejects(f.workflow().exitHousehold(changed),/key conflicts/);
 faults.exitMetadata=structuredClone(metadata);faults.exitMetadata[0].description='Changed exit question';await assert.rejects(f.workflow().exitHousehold(exitInput()),/configuration changed/);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
});
test('exit status exposes each member identity and never consults external services',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(exitInput());
 f.enrollmentSession.readEnrollment=async()=>{throw Error('Unexpected server read');};f.api.households.get=async()=>{throw Error('Unexpected household read');};
 const status=await f.workflow().getHouseholdStatus({headClientId:1,key:'exit'});assert.equal(status.kind,'exit');assert.equal(status.stage,'verified');assert.deepEqual(status.members.map(m=>[m.clientId,m.enrollmentId,m.projectExitDate,m.exitSubgroupId]),[[1,50,new Date(exitDate).toISOString(),'exit-group-50'],[2,52,new Date(exitDate).toISOString(),'exit-group-50']]);
 for(const member of status.members){const individual=await f.workflow().getStatus({clientId:member.clientId,key:member.key});assert.equal(individual.kind,'exit');assert.equal(individual.stage,'verified');assert.equal(individual.exitSubgroupId,'exit-group-50');}
});
test('stored exits missing, unlinked or reidentified after verification are not repaired by writes',async()=>{
 for(const mutation of [f=>f.exits.delete(2),f=>f.exits.get(2).exitSubgroupId='different',f=>{for(const e of f.exits.values())e.exitSubgroupId='replaced';}]){
  const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(exitInput());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});mutation(f);await assert.rejects(f.workflow().exitHousehold(exitInput()));assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
 }
});
test('partial exit verification rows block replay until the complete member batch is visible',async()=>{
 const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());faults.partialRowsClient=2;const input=exitInput();for(const member of input.members){member.assessment.carryForward=[];member.assessment.subassessments=[row('exit-a',exitDate),row('exit-b',exitDate)];}
 await assert.rejects(f.workflow().exitHousehold(input),/uncertain write/);const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});await assert.rejects(f.workflow().exitHousehold(input),/uncertain write/);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
 const remaining=structuredClone(f.clients.get(2).rows.at(-1));remaining.recordset_id=999;remaining.sub_assessment_list.find(q=>q.virt_field_name==='TYPE').answer_value='exit-b';f.clients.get(2).rows.push(remaining);
 await f.workflow().exitHousehold(input);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);for(const id of [1,2])assert.equal(f.clients.get(id).rows.length,4);
});
test('concurrent household exit requests serialize one shared save and one assessment per member',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const input=exitInput(),reordered=exitInput();reordered.members.reverse();
 const results=await Promise.all([f.workflow().exitHousehold(input),f.workflow().exitHousehold(reordered)]);assert.deepEqual(results.map(r=>r.outcome),['verified','already-present']);assert.equal(f.exitCounts.save,1);assert.equal(f.counts.scalar,4);
});
test('real durable store resumes a household exit through a new factory without another write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wellsky-household-exit-'));
 try{const f=fixture(),workflow=()=>createEnrollmentWorkflow({api:f.api,discovery:f.discovery,helpers:f.helpers,enrollmentSession:f.enrollmentSession,exitUi:f.exitUi,store:createFileGwtMutationStore(directory)});await workflow().createHouseholdEnrollment(entryInput());await workflow().exitHousehold(exitInput());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});assert.equal((await workflow().exitHousehold(exitInput())).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);}finally{await rm(directory,{recursive:true,force:true});}
});

const rentalDestination='Rental by client, with ongoing housing subsidy';
function subsidyExit(){return {...exitInput(),destination:rentalDestination,destinationDetails:{kind:'rental-subsidy',rentalSubsidyType:'HUD-VASH'}};}
function otherExit(){return {...exitInput(),destination:'Other (HUD)',destinationDetails:{kind:'other',explanation:'Synthetic destination explanation'},reasonForLeaving:'Other',reasonForLeavingOther:'Synthetic reason explanation'};}

test('household subsidy and separate Other exit details persist for every member and repeat without writes',async()=>{
 for(const input of [subsidyExit(),otherExit()]){
  const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(input);
  for(const id of [1,2])assert.deepEqual(f.exitDetails.get(id),{destinationDetails:input.destinationDetails,reasonForLeavingOther:input.reasonForLeavingOther??null});
  const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});input.members.reverse();assert.equal((await f.workflow().exitHousehold(input)).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
 }
});
test('exit details reject missing, irrelevant, mismatched or invalid text before writes',async()=>{
 const bad=[{...subsidyExit(),destinationDetails:undefined},{...otherExit(),destinationDetails:undefined},{...otherExit(),reasonForLeavingOther:undefined},{...exitInput(),destinationDetails:{kind:'other',explanation:'Irrelevant'}},{...exitInput(),reasonForLeavingOther:'Irrelevant'},{...subsidyExit(),destinationDetails:{kind:'other',explanation:'Wrong shape'}},{...otherExit(),destinationDetails:{kind:'rental-subsidy',rentalSubsidyType:'HUD-VASH'}},{...otherExit(),destinationDetails:{kind:'other',explanation:'Details',unexpected:true}}];
 for(const text of ['', ' ', ' leading','trailing ', 'a\nb','a\rb','a\tb','a\u0085b','a\u0000b','x'.repeat(101)]){bad.push({...otherExit(),destinationDetails:{kind:'other',explanation:text}});bad.push({...otherExit(),reasonForLeavingOther:text});}
 for(const input of bad){const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(input));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,0);assert.equal(f.exitCounts.validate,0);}
});
test('extra exit details require an authoritative details reader before saving',async()=>{
 const f=fixture();delete f.exitUi.readExitDetails;await f.workflow().createHouseholdEnrollment(entryInput());await assert.rejects(f.workflow().exitHousehold(subsidyExit()));assert.equal(f.exitCounts.save,0);
});
test('lost exit response reconciles exact extra details without replaying the save',async()=>{
 const f=fixture({lostExitResponse:true});await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(otherExit());assert.equal(f.exitCounts.save,1);await f.workflow().exitHousehold(otherExit());assert.equal(f.exitCounts.save,1);
});
test('existing and retried household exits reject per-member detail drift without writes',async()=>{
 for(const input of [subsidyExit(),otherExit()])for(const alreadyVerified of [false,true]){
  const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());if(alreadyVerified)await f.workflow().exitHousehold(input);else for(const id of [1,2])f.setExit(id,input);
  f.exitDetails.get(2).destinationDetails=input.destinationDetails.kind==='other'?{kind:'other',explanation:'Changed explanation'}:{kind:'rental-subsidy',rentalSubsidyType:'Other subsidy'};
  const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});await assert.rejects(f.workflow().exitHousehold(input));assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
 }
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(otherExit());f.exitDetails.get(2).reasonForLeavingOther='Changed reason';const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(otherExit()));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,1);
});
test('unexpected stored detail fields and failed detail reads block reconciliation',async()=>{
 const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(exitInput());f.exitDetails.get(2).reasonForLeavingOther='Unexpected hidden text';const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(exitInput()));assert.deepEqual(f.counts,before);
 f.exitDetails.get(2).reasonForLeavingOther=null;faults.exitDetailsReadFails=true;await assert.rejects(f.workflow().exitHousehold(exitInput()),/detail read/);assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,1);
});
test('durable restart retains subsidy exit intent and prevents another write',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wellsky-household-subsidy-exit-'));
 try{const f=fixture(),workflow=()=>createEnrollmentWorkflow({api:f.api,discovery:f.discovery,helpers:f.helpers,enrollmentSession:f.enrollmentSession,exitUi:f.exitUi,store:createFileGwtMutationStore(directory)});await workflow().createHouseholdEnrollment(entryInput());await workflow().exitHousehold(subsidyExit());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});assert.equal((await workflow().exitHousehold(subsidyExit())).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);const changed=subsidyExit();changed.destinationDetails.rentalSubsidyType='Different subsidy';await assert.rejects(workflow().exitHousehold(changed),/key conflicts/);}finally{await rm(directory,{recursive:true,force:true});}
});

function selectedExit(ids,key='selected-exit',at=exitDate){const value=exitInput();return {...value,key,exitDate:at,members:value.members.filter(m=>ids.includes(m.clientId))};}
test('a singleton exit may exclude the head while preserving every unselected record',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const untouched=structuredClone({entry:f.entries.find(e=>e.clientId===1),client:f.clients.get(1)}),result=await f.workflow().exitHousehold(selectedExit([2]));
 assert.deepEqual(result.members.map(m=>m.clientId),[2]);assert.equal(result.members[0].enrollmentId,52);assert.deepEqual(f.exits.get(2).clientIds,[2]);assert.equal(f.exits.has(1),false);assert.deepEqual({entry:f.entries.find(e=>e.clientId===1),client:f.clients.get(1)},untouched);const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});assert.equal((await f.workflow().exitHousehold(selectedExit([2]))).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
});
test('staggered singleton exits retain separate dates and groups and each retry writes nothing',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const first=selectedExit([2],'member-exit','2026-10-22T16:00:00Z'),second=selectedExit([1],'head-exit','2026-10-23T16:00:00Z');await f.workflow().exitHousehold(first);const preserved=structuredClone({entry:f.entries.find(e=>e.clientId===2),exit:f.exits.get(2),details:f.exitDetails.get(2),client:f.clients.get(2)});await f.workflow().exitHousehold(second);assert.deepEqual({entry:f.entries.find(e=>e.clientId===2),exit:f.exits.get(2),details:f.exitDetails.get(2),client:f.clients.get(2)},preserved);assert.notEqual(f.exits.get(1).exitSubgroupId,f.exits.get(2).exitSubgroupId);const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});await f.workflow().exitHousehold(first);await f.workflow().exitHousehold(second);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);assert.equal(f.exitCounts.save,2);
});
test('selected exits preserve the complete known cohort and reject unknown or duplicate members',async()=>{
 for(const ids of [[],[3],[2,2]]){const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const input=selectedExit([2]);input.members=ids.map(clientId=>({clientId,assessment:exitInput().members[1].assessment}));const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(input));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,0);}
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());f.attachMember(3);const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(selectedExit([2])));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,0);
});
test('an exit that changes an unselected enrollment date or exit fails closed without replay',async()=>{
 for(const fault of ['changeUnselectedEntryDate','changeUnselectedExit']){const faults={[fault]:true},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(selectedExit([2])));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,1);faults[fault]=false;await assert.rejects(f.workflow().exitHousehold(selectedExit([2])));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,1);}
});
test('a later selected exit refuses drift in an excluded members stored conditional details',async()=>{
 const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());const first={...otherExit(),key:'other-member-exit',members:[otherExit().members[1]]};await f.workflow().exitHousehold(first);faults.changeUnselectedDetails=true;const before=structuredClone(f.counts);await assert.rejects(f.workflow().exitHousehold(selectedExit([1],'later-head-exit')));assert.deepEqual(f.counts,before);assert.equal(f.exitCounts.save,2);
});
test('selected exit duplicate protection covers a lost response, stable membership and restarted journal',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wellsky-selected-exit-'));
 try{const f=fixture({lostExitResponse:true}),workflow=()=>createEnrollmentWorkflow({api:f.api,discovery:f.discovery,helpers:f.helpers,enrollmentSession:f.enrollmentSession,exitUi:f.exitUi,store:createFileGwtMutationStore(directory)});await workflow().createHouseholdEnrollment(entryInput());await workflow().exitHousehold(selectedExit([2]));const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});assert.equal((await workflow().exitHousehold(selectedExit([2]))).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);await assert.rejects(workflow().exitHousehold(selectedExit([1])),/key conflicts/);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);}finally{await rm(directory,{recursive:true,force:true});}
});

const childEntryDate='2026-10-21T16:00:00Z';
function additionInput(ids=[3]){return {key:'later-members',enrollmentKey:'entry',headClientId:1,entryDate:childEntryDate,members:ids.map(clientId=>({clientId,assessment:{...assessment(clientId),subassessments:[row('a',childEntryDate),row('b',childEntryDate)]}}))};}
function childExit(at=exitDate){return {...exitInput(),key:'child-exit',exitDate:at,members:[{clientId:3,assessment:{answers:{TOTAL:{value:3000},OPTIONAL:{value:'Child exit'}},carryForward:['ROWS']}}]};}
test('later child entry attaches once, applies only its date and preserves existing exits and answers',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(selectedExit([2],'early-exit','2026-10-20T16:00:00Z'));f.household.clients.find(c=>c.clientId===3).dateJoined=childEntryDate;
 const preserved=structuredClone({entries:f.entries,exits:[...f.exits],details:[...f.exitDetails],clients:[f.clients.get(1),f.clients.get(2)]});
 const result=await f.workflow().addHouseholdMembers(additionInput());assert.equal(result.outcome,'verified');assert.deepEqual(result.members.map(m=>[m.clientId,m.enrollmentId]),[[3,53]]);assert.equal(Date.parse(result.members[0].effectiveDate),Date.parse(childEntryDate));assert.equal(f.additionCounts.date,1);assert.equal(f.counts.entry,1);assert.equal(f.counts.attach,2);assert.equal(f.clients.get(3).rows.length,2);assert.deepEqual({entries:f.entries.filter(e=>e.clientId!==3),exits:[...f.exits],details:[...f.exitDetails],clients:[f.clients.get(1),f.clients.get(2)]},preserved);
 const status=await f.workflow().getHouseholdStatus({headClientId:1,key:'later-members'});assert.equal(status.kind,'addition');assert.equal(status.stage,'verified');assert.deepEqual(status.members.map(m=>m.clientId),[3]);assert.equal((await f.workflow().getStatus({clientId:3,key:status.members[0].key})).kind,'entry');
});
test('membership growth preserves addition, original entry and earlier selected-exit retries without writes',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const early=selectedExit([2],'early-exit','2026-10-20T16:00:00Z');await f.workflow().exitHousehold(early);await f.workflow().addHouseholdMembers(additionInput());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts,additionCounts:f.additionCounts});
 assert.equal((await f.workflow().addHouseholdMembers(additionInput())).outcome,'already-present');assert.equal((await f.workflow().createHouseholdEnrollment(entryInput())).outcome,'already-present');assert.equal((await f.workflow().exitHousehold(early)).outcome,'already-present');assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts,additionCounts:f.additionCounts},before);
});
test('selected later-child exit uses the addition entry key and rejects an earlier date',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().addHouseholdMembers(additionInput());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts});await assert.rejects(f.workflow().exitHousehold(childExit('2026-10-20T16:00:00Z')),/precedes entry/);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts},before);
 const result=await f.workflow().exitHousehold(childExit());assert.deepEqual(result.members.map(m=>[m.clientId,m.enrollmentId]),[[3,53]]);assert.equal(f.exits.has(1),false);assert.equal(f.exits.has(2),false);
 const after=structuredClone({counts:f.counts,exitCounts:f.exitCounts,additionCounts:f.additionCounts});await f.workflow().exitHousehold(childExit());await f.workflow().addHouseholdMembers(additionInput());assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts,additionCounts:f.additionCounts},after);
});
test('later entry refuses invalid plans, existing members, root dates and unavailable date ports before attachment',async()=>{
 for(const change of [value=>value.members=[{clientId:1,assessment:assessment(1)}],value=>value.members=[{clientId:2,assessment:assessment(2)}],value=>value.entryDate=entryDate,value=>delete value.members[0].assessment.notApplicable]){const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const before=structuredClone(f.counts),input=additionInput();change(input);await assert.rejects(f.workflow().addHouseholdMembers(input));assert.deepEqual(f.counts,before);assert.equal(f.additionCounts.date,0);}
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const workflow=createEnrollmentWorkflow({api:f.api,store:f.store,discovery:f.discovery,helpers:f.helpers,enrollmentSession:f.enrollmentSession,exitUi:f.exitUi});await assert.rejects(workflow.addHouseholdMembers(additionInput()),/date port/);assert.equal(f.counts.attach,1);
});
test('lost successful entry-date response reconciles once and a noncommitted date never retries',async()=>{
 for(const commits of [true,false]){const faults=commits?{lostDateResponse:true}:{dateNoCommit:true},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());if(commits){await f.workflow().addHouseholdMembers(additionInput());await f.workflow().addHouseholdMembers(additionInput());}else{await assert.rejects(f.workflow().addHouseholdMembers(additionInput()));const before=structuredClone(f.counts);faults.dateNoCommit=false;await assert.rejects(f.workflow().addHouseholdMembers(additionInput()),/uncertain member entry date/);assert.deepEqual(f.counts,before);f.entries.find(e=>e.clientId===3).projectStartDate=childEntryDate;await f.workflow().addHouseholdMembers(additionInput());}assert.equal(f.additionCounts.date,1);assert.equal(f.counts.attach,2);assert.equal(f.clients.get(3).rows.length,2);}
});
test('a partial multi-member date stage preserves the completed date and blocks replay of the uncertain one',async()=>{
 const faults={dateNoCommitClient:4},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());await assert.rejects(f.workflow().addHouseholdMembers(additionInput([3,4])));assert.equal(Date.parse(f.entries.find(e=>e.clientId===3).projectStartDate),Date.parse(childEntryDate));assert.equal(Date.parse(f.entries.find(e=>e.clientId===4).projectStartDate),Date.parse(entryDate));assert.equal(f.clients.get(3).rows.length,0);assert.equal(f.additionCounts.date,2);
 await assert.rejects(f.workflow().addHouseholdMembers(additionInput([3,4])),/uncertain member entry date/);assert.equal(f.additionCounts.date,2);f.entries.find(e=>e.clientId===4).projectStartDate=childEntryDate;const result=await f.workflow().addHouseholdMembers(additionInput([3,4]));assert.deepEqual(result.members.map(m=>m.clientId),[3,4]);assert.equal(f.additionCounts.date,2);assert.equal(f.counts.attach,2);
});
test('addition rejects changes to an existing member at attachment or date-write time and never resends',async()=>{
 for(const fault of ['corruptAttachmentDate','corruptOtherDate','corruptOtherExit']){const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());faults[fault]=true;const before=structuredClone({scalar:f.counts.scalar,rows:f.counts.rows});await assert.rejects(f.workflow().addHouseholdMembers(additionInput()));assert.deepEqual({scalar:f.counts.scalar,rows:f.counts.rows},before);const after=structuredClone({counts:f.counts,additionCounts:f.additionCounts});faults[fault]=false;await assert.rejects(f.workflow().addHouseholdMembers(additionInput()));assert.deepEqual({counts:f.counts,additionCounts:f.additionCounts},after);}
});
test('durable later-member intent survives a new factory and rejects changed input under the same key',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'wellsky-member-addition-'));
 try{const f=fixture(),workflow=()=>createEnrollmentWorkflow({api:f.api,discovery:f.discovery,helpers:f.helpers,enrollmentSession:f.enrollmentSession,exitUi:f.exitUi,memberEntryDatePort:f.memberEntryDatePort,store:createFileGwtMutationStore(directory)});await workflow().createHouseholdEnrollment(entryInput());await workflow().addHouseholdMembers(additionInput());const before=structuredClone({counts:f.counts,additionCounts:f.additionCounts});assert.equal((await workflow().addHouseholdMembers(additionInput())).outcome,'already-present');assert.deepEqual({counts:f.counts,additionCounts:f.additionCounts},before);const changed=additionInput();changed.entryDate='2026-10-22T16:00:00Z';await assert.rejects(workflow().addHouseholdMembers(changed),/key conflicts/);assert.deepEqual({counts:f.counts,additionCounts:f.additionCounts},before);}finally{await rm(directory,{recursive:true,force:true});}
});
test('partial later-member attachment never resends and resumes after all requested members appear',async()=>{
 const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());faults.partialAttachment=true;
 await assert.rejects(f.workflow().addHouseholdMembers(additionInput([3,4])),/partial attachment/);assert.equal(f.counts.attach,2);assert.equal(f.additionCounts.date,0);await assert.rejects(f.workflow().addHouseholdMembers(additionInput([3,4])),/uncertain attachment/);assert.equal(f.counts.attach,2);
 f.attachMember(4);const result=await f.workflow().addHouseholdMembers(additionInput([3,4]));assert.deepEqual(result.members.map(m=>m.clientId),[3,4]);assert.equal(f.counts.attach,2);assert.equal(f.additionCounts.date,2);
});
test('later addition requires an open anchor and does not reopen exited enrollments',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(exitInput());const before=structuredClone({counts:f.counts,exitCounts:f.exitCounts,exits:[...f.exits]});await assert.rejects(f.workflow().addHouseholdMembers(additionInput()),/without an enrolled head of household/);assert.deepEqual({counts:f.counts,exitCounts:f.exitCounts,exits:[...f.exits]},before);assert.equal(f.additionCounts.date,0);
});
test('selected later-child interim respects its own entry date while the original head remains enrolled',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().addHouseholdMembers(additionInput());await f.workflow().exitHousehold(selectedExit([2],'other-member-before-child-review',childEntryDate));
 const review={key:'child-interim',enrollmentKey:'entry',headClientId:1,reviewDate,members:[{clientId:3,assessment:{answers:{TOTAL:{value:333}},notApplicable:{OPTIONAL:'Not applicable'},carryForward:['ROWS']}}]};const before=structuredClone(f.counts);await assert.rejects(f.workflow().createHouseholdInterim({...review,reviewDate:'2026-10-20T16:00:00Z'}),/precedes entry/);assert.deepEqual(f.counts,before);
 const result=await f.workflow().createHouseholdInterim(review);assert.deepEqual(result.members.map(m=>[m.clientId,m.enrollmentId,m.reviewId]),[[3,53,63]]);assert.deepEqual(f.clients.get(3).reviews[0].clientIds,[3]);assert.equal(f.clients.get(1).reviews.length,0);const after=structuredClone(f.counts);assert.equal((await f.workflow().createHouseholdInterim(review)).outcome,'already-present');assert.deepEqual(f.counts,after);
});
test('pending addition pins assessment metadata before the first child assessment journal exists',async()=>{
 const faults={dateNoCommit:true},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());await assert.rejects(f.workflow().addHouseholdMembers(additionInput()));
 const pending=await f.workflow().getHouseholdStatus({headClientId:1,key:'later-members'});assert.equal(pending.stage,'pending');assert.equal(await f.workflow().getStatus({clientId:3,key:pending.members[0].key}),null);assert.equal(f.clients.get(3).history.length,0);assert.equal(f.clients.get(3).rows.length,0);
 // The date becomes visible after an uncertain response, while the provider's entry metadata changes.
 faults.dateNoCommit=false;f.entries.find(e=>e.clientId===3).projectStartDate=childEntryDate;
 const definition=f.api.assessments.getDefinition;f.api.assessments.getDefinition=async request=>{const result=await definition(request);if(request.assessmentCode==='ENTRY')result.questions[0].description='Changed provider entry question';return result;};
 const before=structuredClone({counts:f.counts,additionCounts:f.additionCounts,exitCounts:f.exitCounts});await assert.rejects(f.workflow().addHouseholdMembers(additionInput()),/additional member assessment configuration changed/);assert.deepEqual({counts:f.counts,additionCounts:f.additionCounts,exitCounts:f.exitCounts},before);assert.equal(f.clients.get(3).history.length,0);assert.equal(f.clients.get(3).rows.length,0);
});

function headFixture(){
 const f=fixture(),getDefinition=f.api.assessments.getDefinition,get=f.api.assessments.get;
 const headQuestion=question(20,'HUD_RELATIONTOHOH','lookup',{picklistId:8,options:[{id:10,code:'RELATIONHOH_SELF',name:'Self (head of household)',picklistId:8,picklistCode:'HUD_RELATIONHOH',displayOrder:1},{id:11,code:'RELATIONHOH_HEAD_CHILD',name:"Head of household's child",picklistId:8,picklistCode:'HUD_RELATIONHOH',displayOrder:2}]});
 f.api.assessments.getDefinition=async input=>{const definition=await getDefinition(input);definition.questions.push(headQuestion);return definition;};
 f.api.assessments.get=async input=>{const found=f.clients.get(input.path.clientId).history.filter(h=>h.field==='HUD_RELATIONTOHOH'&&(!input.query?.dateEffective||Date.parse(h.date)<=Date.parse(input.query.dateEffective))).at(-1);return [...await get(input),{virt_field_name:'HUD_RELATIONTOHOH',question_type:'lookup',answer_value:found?.value??null,date_effective:found?.date??null}];};
 const entry=entryInput();for(const m of entry.members)m.assessment.answers.HUD_RELATIONTOHOH={option:{code:m.clientId===1?'RELATIONHOH_SELF':'RELATIONHOH_HEAD_CHILD'}};
 return {...f,entry};
}
test('a fresh enrollment can establish head relationships different from prior assessment history',async()=>{
 const f=headFixture();f.clients.get(1).history.push({field:'HUD_RELATIONTOHOH',value:'11',date:'2026-10-01T16:00:00Z'});f.clients.get(2).history.push({field:'HUD_RELATIONTOHOH',value:'10',date:'2026-10-01T16:00:00Z'});await f.workflow().createHouseholdEnrollment(f.entry);assert.equal(f.clients.get(1).history.filter(h=>h.field==='HUD_RELATIONTOHOH').at(-1).value,'10');assert.equal(f.clients.get(2).history.filter(h=>h.field==='HUD_RELATIONTOHOH').at(-1).value,'11');
});
test('household assessment cannot promote another member or demote the enrollment head',async()=>{
 for(const clientId of [1,2]){const f=headFixture();await f.workflow().createHouseholdEnrollment(f.entry);const input=interimInput();for(const m of input.members)m.assessment.carryForward.push('HUD_RELATIONTOHOH');const member=input.members.find(m=>m.clientId===clientId);member.assessment.carryForward=member.assessment.carryForward.filter(f=>f!=='HUD_RELATIONTOHOH');member.assessment.answers.HUD_RELATIONTOHOH={option:{code:clientId===1?'RELATIONHOH_HEAD_CHILD':'RELATIONHOH_SELF'}};const before=structuredClone(f.counts);await assert.rejects(f.workflow().createHouseholdInterim(input),/head of household change is a red flag/);assert.deepEqual(f.counts,before);}
});
test('later entrant cannot become enrollment head and no implicit retroactive correction is allowed',async()=>{
 const f=headFixture();await f.workflow().createHouseholdEnrollment(f.entry);const input={key:'child',enrollmentKey:'entry',headClientId:1,entryDate:reviewDate,members:[{clientId:3,assessment:assessment(3)}]};input.members[0].assessment.answers.HUD_RELATIONTOHOH={option:{code:'RELATIONHOH_SELF'}};const before=structuredClone(f.counts);await assert.rejects(f.workflow().addHouseholdMembers(input),/head of household change is a red flag/);assert.deepEqual(f.counts,before);
 f.household.clients[0].headofhouseholdStatus=false;f.household.clients[1].headofhouseholdStatus=true;
 await assert.rejects(f.workflow().createHouseholdInterim(interimInput()),/household head mismatch/);assert.deepEqual(f.counts,before);
});
test('stored assessment head drift is a red flag even when the new plan carries it forward',async()=>{
 const f=headFixture();await f.workflow().createHouseholdEnrollment(f.entry);f.clients.get(2).history.push({field:'HUD_RELATIONTOHOH',value:'10',date:reviewDate});const input=interimInput();for(const m of input.members)m.assessment.carryForward.push('HUD_RELATIONTOHOH');const before=structuredClone(f.counts);await assert.rejects(f.workflow().createHouseholdInterim(input),/head of household change is a red flag/);assert.deepEqual(f.counts,before);
});
test('unchanged head relationships carry forward and a selected RPC target is never promoted',async()=>{
 const f=headFixture();await f.workflow().createHouseholdEnrollment(f.entry);const input=interimInput();input.members=input.members.filter(m=>m.clientId===2);input.members[0].assessment.carryForward.push('HUD_RELATIONTOHOH');await f.workflow().createHouseholdInterim(input);assert.equal(f.household.clients.find(m=>m.headofhouseholdStatus).clientId,1);assert.equal(f.clients.get(2).history.find(h=>h.field==='HUD_RELATIONTOHOH').value,'11');
});

const mutationState=f=>structuredClone({counts:f.counts,exits:f.exitCounts,dates:f.additionCounts,journal:[...f.journal]});
test('a missing household head is an explicit data error before entry or further writes',async()=>{
 for(const existing of [false,true]){const f=fixture();if(existing)await f.workflow().createHouseholdEnrollment(entryInput());f.household.clients[0].headofhouseholdStatus=false;const before=mutationState(f);await assert.rejects(existing?f.workflow().createHouseholdInterim(interimInput()):f.workflow().createHouseholdEnrollment(entryInput()),/invalid enrollment data: household has no active head of household/);assert.deepEqual(mutationState(f),before);}
});
test('missing head enrollment in an authoritative group is an explicit data error',async()=>{
 const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());faults.snapshot={members:[{clientId:2,enrollmentId:52}]};const before=mutationState(f);await assert.rejects(f.workflow().createHouseholdInterim(interimInput()),/invalid enrollment data: enrollment has no head of household/);assert.deepEqual(mutationState(f),before);
});
test('head relationship cannot be omitted as not applicable for household or standalone entry',async()=>{
 for(const household of [false,true]){const f=headFixture(),plan=f.entry.members[0].assessment;delete plan.answers.HUD_RELATIONTOHOH;plan.notApplicable.HUD_RELATIONTOHOH='No head';const before=mutationState(f);await assert.rejects(household?f.workflow().createHouseholdEnrollment(f.entry):f.workflow().createEnrollment({key:'standalone',clientId:1,providerId:2,type:'HUD',entryDate,assessment:plan}),/invalid enrollment data: head of household relationship is missing/);assert.deepEqual(mutationState(f),before);}
});
test('head exit cannot strand another member and rejected intent leaves no reservation',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());const headExit=selectedExit([1],'head-exit',reviewDate),before=mutationState(f);await assert.rejects(f.workflow().exitHousehold(headExit),/without an enrolled head of household/);assert.deepEqual(mutationState(f),before);
 // The member may exit separately at the same instant, then the head may exit.
 await f.workflow().exitHousehold(selectedExit([2],'member-exit',reviewDate));await f.workflow().exitHousehold(headExit);const saved=structuredClone({counts:f.counts,exits:f.exitCounts,dates:f.additionCounts});assert.equal((await f.workflow().exitHousehold(headExit)).outcome,'already-present');assert.deepEqual({counts:f.counts,exits:f.exitCounts,dates:f.additionCounts},saved);
});
test('a backdated head exit cannot precede an already recorded member exit',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(selectedExit([2],'member-exit',exitDate));const before=mutationState(f);await assert.rejects(f.workflow().exitHousehold(selectedExit([1],'head-exit',reviewDate)),/without an enrolled head of household/);assert.deepEqual(mutationState(f),before);
});
test('later child enrollment also prevents the head from exiting alone',async()=>{
 const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());await f.workflow().exitHousehold(selectedExit([2],'other-exit',reviewDate));await f.workflow().addHouseholdMembers(additionInput());const before=mutationState(f);await assert.rejects(f.workflow().exitHousehold(selectedExit([1],'head-exit',exitDate)),/without an enrolled head of household/);assert.deepEqual(mutationState(f),before);
 await f.workflow().exitHousehold(childExit());await f.workflow().exitHousehold(selectedExit([1],'head-exit',exitDate));const saved=structuredClone({counts:f.counts,exits:f.exitCounts,dates:f.additionCounts});await f.workflow().addHouseholdMembers(additionInput());await f.workflow().exitHousehold(childExit());await f.workflow().exitHousehold(selectedExit([1],'head-exit',exitDate));assert.deepEqual({counts:f.counts,exits:f.exitCounts,dates:f.additionCounts},saved);
});
test('existing orphaned enrollment blocks entry retries, additions, reviews and exits without writes',async()=>{
 for(const laterExit of [false,true])for(const operation of ['entry','addition','interim','exit']){const f=fixture();await f.workflow().createHouseholdEnrollment(entryInput());f.setExit(1,selectedExit([1],'external-head-exit',reviewDate));if(laterExit)f.setExit(2,selectedExit([2],'external-member-exit',exitDate));const before=mutationState(f);const attempt=()=>operation==='entry'?f.workflow().createHouseholdEnrollment(entryInput()):operation==='addition'?f.workflow().addHouseholdMembers(additionInput()):operation==='interim'?f.workflow().createHouseholdInterim(interimInput()):f.workflow().exitHousehold(selectedExit([2]));await assert.rejects(attempt(),/without an enrolled head of household/);assert.deepEqual(mutationState(f),before);}
});
test('missing or invalid authoritative head exit data cannot silently count as enrolled',async()=>{
 for(const exits of [[],[{clientId:1,enrollmentId:50,projectExitDate:'invalid'}]]){const faults={},f=fixture(faults);await f.workflow().createHouseholdEnrollment(entryInput());faults.snapshot={exits};const before=mutationState(f);await assert.rejects(f.workflow().createHouseholdInterim(interimInput()),/authoritative head of household exit dates required/);assert.deepEqual(mutationState(f),before);}
});

function householdBirthFixture(){
 const f=fixture(),births=new Map(),writes=new Map(),getDefinition=f.api.assessments.getDefinition;
 f.api.assessments.getDefinition=async args=>{const d=await getDefinition(args);d.questions.push(question(99,'SVPPROFDOB','date'));return d;};
 const get=f.api.assessments.get;f.api.assessments.get=async args=>[...await get(args),{virt_field_name:'SVPPROFDOB',question_type:'date',answer_value:'',date_effective:births.get(args.path.clientId)?.effectiveDate.replace(/\.000Z$/,'')??null}];
 f.api.assessmentsMobile.getAnswers=args=>f.api.assessments.get(args);
 f.api.clients.get=async({path})=>({clientId:path.clientId,isActive:true,svpprofdob:births.get(path.clientId)?.dateOfBirth??null});
 f.api.clients.update=async({path,body})=>{const id=path.client_id;writes.set(id,(writes.get(id)??0)+1);births.set(id,{dateOfBirth:body.svpprofdob.slice(0,10),effectiveDate:body.dateEffective});};
 const add=f.api.assessmentsMobile.addAnswer;f.api.assessmentsMobile.addAnswer=async args=>{assert.ok(!args.body.some(q=>q.virt_field_name==='SVPPROFDOB'));return add(args);};
 const ui={read:async id=>births.get(id)?.dateOfBirth??null,validateRestDate:async()=>{},correctAtEntry:async()=>{throw Error('Unexpected correction');}};
 const birthDates=createDateOfBirth({api:f.api,store:f.store,ui});
 const entry=entryInput();for(const member of entry.members)member.assessment.answers.SVPPROFDOB={value:member.clientId===1?'1984-02-29':'1992-07-03'};
 return {...f,births,writes,entry,birthDates,workflow:()=>createEnrollmentWorkflow({...f,birthDates})};
}
test('household DOB validation checks every member before enrollment or attachment',async()=>{
 const f=householdBirthFixture();f.entry.members[1].assessment.answers.SVPPROFDOB={value:'1999-02-29'};await assert.rejects(f.workflow().createHouseholdEnrollment(f.entry));assert.equal(f.counts.entry,0);assert.equal(f.counts.attach,0);assert.equal(f.writes.size,0);
});
test('household DOB values survive member-specific entry, later child addition, interim and reordered retries',async()=>{
 const f=householdBirthFixture();await f.workflow().createHouseholdEnrollment(f.entry);
 const child=additionInput();child.members[0].assessment.answers.SVPPROFDOB={value:'2026-10-20'};await f.workflow().addHouseholdMembers(child);
 const review=interimInput();review.members.push({clientId:3,assessment:{answers:{TOTAL:{value:300}},notApplicable:{OPTIONAL:'Synthetic not applicable'},carryForward:['ROWS']}});for(const member of review.members)member.assessment.carryForward.push('SVPPROFDOB');
 await f.workflow().createHouseholdInterim(review);const before=structuredClone({counts:f.counts,dates:f.additionCounts,writes:[...f.writes]});
 f.entry.members.reverse();review.members.reverse();assert.equal((await f.workflow().createHouseholdEnrollment(f.entry)).outcome,'already-present');assert.equal((await f.workflow().addHouseholdMembers(child)).outcome,'already-present');assert.equal((await f.workflow().createHouseholdInterim(review)).outcome,'already-present');
 assert.deepEqual({counts:f.counts,dates:f.additionCounts,writes:[...f.writes]},before);assert.deepEqual([...f.writes],[[1,1],[2,1],[3,1]]);assert.equal(f.births.get(1).dateOfBirth,'1984-02-29');assert.equal(f.births.get(2).dateOfBirth,'1992-07-03');assert.equal(f.births.get(3).dateOfBirth,'2026-10-20');assert.equal(f.births.get(3).effectiveDate,new Date(childEntryDate).toISOString());
});

test('household members retain distinct DOB-quality-only answers through entry and interim retries',async()=>{
 const f=fixture(),getDefinition=f.api.assessments.getDefinition,get=f.api.assessments.get;
 const extras=[question(99,'SVPPROFDOB','date'),question(100,'SVPPROFDOBTYPE','lookup',{options:[{id:91,code:'DOBTYPE_DONTKNOW',name:"Client doesn't know"},{id:92,code:'DOBTYPE_REFUSED',name:'Client prefers not to answer'}]})];
 f.api.assessments.getDefinition=async args=>{const d=await getDefinition(args);d.questions.push(...structuredClone(extras));return d;};
 f.api.assessments.get=async args=>[...await get(args),...extras.map(q=>{const h=f.clients.get(args.path.clientId).history.filter(h=>h.field===q.fieldName&&(!args.query?.dateEffective||Date.parse(h.date)<=Date.parse(args.query.dateEffective))).at(-1);return {virt_field_name:q.fieldName,question_type:q.questionType,answer_value:h?.value??null,date_effective:h?.date??null};})];
 f.api.enrollments.getComplete=async()=>assert.fail('Do not depend on complete enrollment reads');f.api.clients.update=async()=>assert.fail('Do not invent a DOB');
 const i=entryInput(),review=interimInput();for(const m of i.members){m.assessment.answers.SVPPROFDOBTYPE={option:{code:m.clientId===1?'DOBTYPE_DONTKNOW':'DOBTYPE_REFUSED'}};m.assessment.notApplicable.SVPPROFDOB='No DOB supplied';}
 for(const m of review.members){m.assessment.notApplicable.SVPPROFDOB='Still no DOB supplied';m.assessment.carryForward.push('SVPPROFDOBTYPE');}
 const first=await f.workflow().createHouseholdEnrollment(i),interim=await f.workflow().createHouseholdInterim(review);assert.ok([...first.members,...interim.members].every(m=>m.birthDate===undefined));
 const before=structuredClone(f.counts);i.members.reverse();review.members.reverse();assert.equal((await f.workflow().createHouseholdEnrollment(i)).outcome,'already-present');assert.equal((await f.workflow().createHouseholdInterim(review)).outcome,'already-present');assert.deepEqual(f.counts,before);
 for(const id of [1,2]){const history=f.clients.get(id).history;assert.equal(history.filter(h=>h.field==='SVPPROFDOB').length,0);assert.deepEqual(history.filter(h=>h.field==='SVPPROFDOBTYPE').map(h=>h.value),[id===1?'91':'92']);}
});
