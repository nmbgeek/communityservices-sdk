const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createEnrollmentWorkflow} from '@choiceapps/communityservices-sdk/browser';
import {createDateOfBirth} from '@choiceapps/communityservices-sdk/browser';

const entryDate='2026-10-19T16:00:00Z',reviewDate='2026-10-22T16:00:00Z';
const option=(id,code)=>({id,code,name:code,picklistId:1,picklistCode:'TEST',displayOrder:id,hudVisibility:null});
const question=(questionId,fieldName,questionType,extra={})=>({questionId,fieldName,questionType,description:fieldName,displayOrder:questionId,mandatory:false,showOnPrevious:true,picklistId:null,options:[],children:[],...extra});
const definition=()=>[
  question(1,'TOTAL','money'),question(2,'OPTIONAL','textbox'),
  question(3,'ROWS','sub_assessment',{children:[
    question(4,'TYPE','lookup',{options:[option(11,'A'),option(12,'B')]}),
    question(5,'RECEIVING','lookup',{options:[option(21,'NO'),option(22,'YES')]}),
    question(6,'START','date'),question(7,'END','date'),question(8,'AMOUNT','money'),
  ]}),
];
const row=(key,type,start=entryDate,receiving='NO')=>({key,parentField:'ROWS',answers:{TYPE:{option:{code:type}},RECEIVING:{option:{code:receiving}},START:{value:start},...(receiving==='YES'?{AMOUNT:{value:1000}}:{})}});
const entryInput=()=>({key:'entry-1',clientId:1,providerId:2,type:'HUD',entryDate,assessment:{answers:{TOTAL:{value:0}},notApplicable:{OPTIONAL:'Not applicable to this synthetic scenario'},subassessments:[row('a','A'),row('b','B')]}});

const exitInput=()=>({key:'exit-1',enrollmentKey:'entry-1',clientId:1,exitDate:'2026-10-24T16:00:00Z',destination:'Rental by client',reasonForLeaving:'Completed program',assessment:{answers:{TOTAL:{value:500}},carryForward:['ROWS'],notApplicable:{OPTIONAL:'Not applicable'}}});

/** Only external storage/API behavior is simulated; encoding, discovery, coverage,
 * semantic matching, journal stages, and workflow recovery use the real SDK. */
function fixture(faults={}) {
  const entries=[],reviews=[],rows=[],history=[],journal=new Map(),locks=new Map();
  const counts={enrollment:0,scalars:0,rows:0,endDates:0,review:0};let nextRow=100;
  const metadata=definition();
  const store={
    async withLock(scope,work){const previous=locks.get(scope)??Promise.resolve();let release;const gate=new Promise(resolve=>{release=resolve;});locks.set(scope,gate);await previous;try{return await work();}finally{release();}},
    async read(scope){return structuredClone(journal.get(scope)??[]);},
    async write(scope,records){journal.set(scope,structuredClone(records));},
  };
  const readAnswers=at=>metadata.map(q=>{
    if(q.questionType==='sub_assessment')return {virt_field_name:q.fieldName,question_type:q.questionType,sub_assessment_answer_list:structuredClone(rows.filter(r=>r.parentField===q.fieldName||!r.parentField&&q.fieldName==='ROWS'))};
    // Live generic reads omit yes/no answers saved at exactly the queried instant.
    const found=history.filter(h=>h.field===q.fieldName&&(!at||(q.questionType==='yes_no'?Date.parse(h.date)<Date.parse(at):Date.parse(h.date)<=Date.parse(at)))).at(-1);
    return {virt_field_name:q.fieldName,question_type:q.questionType,answer_value:found?.value??null,date_effective:found?.date.replace(/Z$/,'')??null};
  });
  const api={
    tenant:testTenant,
    clients:{async get(){return {clientId:1,isActive:true};}},
    providers:{async list(){return {count:1,values:[{providerId:2,providerName:'Synthetic program',active:true,operational:true,hudCompliant:true,parentProviderID:null,providerGrantType:null,dateAdded:'2026-01-01',dateUpdated:'2026-01-01'}]};}},
    enrollments:{
      async listForClient(){return {count:entries.length,values:structuredClone(entries)};},
      async createEntryAssessment({body}){counts.enrollment++;if(faults.noEnrollmentCommit)throw Error('Connection failed before acknowledgement');entries.push({enrollmentId:50,clientId:body.clientId,enrollmentProvider:body.providerId,type:body.type,projectStartDate:body.projectStartDate,isActive:true});if(faults.lostEnrollmentResponse)throw Error('Response lost after commit');return entries[0];},
    },
    assessments:{
      async getDefinition({assessmentCode,effectiveDate}){return {tenant:api.tenant,assessmentCode,effectiveDate,retrievedAt:new Date().toISOString(),picklistEffectiveDate:'current',questions:structuredClone(metadata),unresolvedPicklists:[]};},
      async get({query}){return readAnswers(query?.dateEffective);},
      async create({body,query}){
        counts.standard=(counts.standard??0)+1;if(faults.noStandardCommit)throw Error('Standard write failed without acknowledgement');
        if(body.some(q=>q.question_type==='yes_no'&&q.answer_value===''))throw Object.assign(new Error('Provided answer for yes/no question is invalid'),{status:400,kind:'http'});
        const missing=metadata.filter(q=>q.mandatory&&!body.some(b=>b.virt_field_name===q.fieldName));if(missing.length)throw Error('All mandatory answers are not provided');
        for(const q of body){const meta=metadata.find(m=>m.fieldName===q.virt_field_name),value=q.answer_value===''?null:meta.questionType==='lookup'?String(meta.options.find(o=>o.name===q.answer_value).id):q.answer_value;history.push({field:q.virt_field_name,value,date:query.dateEffective});}
        if(faults.lostStandardResponse)throw Error('Response lost after commit');return {success:true};
      },
    },
    assessmentsMobile:{async addAnswer({body,query}){
      const isRows=body.some(q=>q.question_type==='sub_assessment');counts[isRows?'rows':'scalars']++;
      if(isRows&&faults.noRowsCommit)throw Error('Rows failed without acknowledgement');
      for(const q of body){
        if(q.question_type==='sub_assessment')for(const r of q.subAssessmentQuestionAnswers){
         if(r.recordset_id>0){
          const existing=rows.find(row=>row.recordset_id===r.recordset_id);assert.ok(existing,'update targets an existing row');assert.equal(r.isDeleted,false);
          for(const c of r.subAssessments){const cell=existing.sub_assessment_list.find(v=>v.virt_field_name===c.virt_field_name);assert.ok(cell);Object.assign(cell,c,{answer_value:c.answer_value||null});if(faults.partialCorrection)throw Error('Only one corrected cell committed');}
         }else rows.push({recordset_id:nextRow++,parentField:q.virt_field_name,sub_assessment_list:r.subAssessments.map(c=>({...c,answer_value:c.answer_value||null,date_effective:query.dateEffective.replace(/Z$/,'')}))});
         if(faults.partialRows)throw Error('Only first row committed');
        }
        else history.push({field:q.virt_field_name,value:q.answer_value,date:query.dateEffective});
      }
      if(isRows&&faults.lostRowsResponse||!isRows&&faults.lostScalarResponse)throw Error('Response lost after commit');
      return {success:true};
    }},
    subassessments:{async setEndDate({recordsetId,endDateField,endDate}){counts.endDates++;const record=rows.find(r=>r.recordset_id===recordsetId),cell=record?.sub_assessment_list.find(q=>q.virt_field_name===endDateField);assert.ok(cell);cell.answer_value=endDate;if(faults.lostEndResponse)throw Error('End response lost');return {status:'verified'};}},
  };
  const discovery={async getProviderAssessments({providerId}){return {providerId,defaults:['entry','interim'].map((phase,index)=>({location:index?'showHudInterim':'showHudEntry',resolution:'resolved',assessment:{assessmentId:index+1,code:phase.toUpperCase(),name:phase,assignedToAssessmentTab:true}}))};}};
  const helpers={async createInterimUpdate(input){if(!reviews.some(r=>r.reviewDate===input.reviewDate)){counts.review++;reviews.push({reviewId:60,type:'Update',reviewDate:input.reviewDate,clientIds:[input.clientId]});}return {outcome:'reconciled',snapshot:{reviews:structuredClone(reviews)}};}};
  return {api,store,discovery,helpers,entries,reviews,rows,history,journal,counts,metadata,workflow:(options={})=>createEnrollmentWorkflow({api,store,discovery,helpers,...options})};
}

function exitFixture(faults={}) {
 const f=fixture(faults),discover=f.discovery.getProviderAssessments;
 f.discovery.getProviderAssessments=async input=>{const catalog=await discover(input);catalog.defaults.push({location:'showHudExit',resolution:'resolved',assessment:{assessmentId:3,code:'EXIT',name:'exit',assignedToAssessmentTab:true}});return catalog;};
 const exit={clientId:1,enrollmentId:50,projectExitDate:null,destination:null,reasonForLeaving:null,exitSubgroupId:null,clientIds:[1],enrollmentIds:[50]};
 const details={destinationDetails:null,reasonForLeavingOther:null},counts={saves:0,validations:0};
 const enrollmentSession={async readEnrollment(target){
  assert.deepEqual(target,{clientId:1,enrollmentId:50});
  const snapshot={source:'gwt-rpc',tenant:testTenant,...target,providerId:2,enrollmentType:'HUD',projectStartDate:entryDate,members:[target],householdClientIds:[1],exits:[structuredClone(exit)],reviews:structuredClone(f.reviews)};
  faults.changeSnapshot?.(snapshot);return snapshot;
 }};
 const exitUi={
  async validateExit(){counts.validations++;if(faults.validationFailure)throw Error('Exit choice unavailable');},
  async readExitDetails(){return structuredClone(details);},
  async saveExit(input){
   counts.saves++;
   assert.ok([...f.journal.values()].flat().some(r=>r.key==='exit-1'&&r.steps.exit?.state==='attempted'),'journal precedes save');
   assert.deepEqual(input.clientIds,[1]);
   if(faults.noExitCommit)throw Error('Exit not acknowledged');
   Object.assign(exit,{projectExitDate:input.exitDate,destination:input.destination,reasonForLeaving:input.reasonForLeaving,exitSubgroupId:faults.subgroup??null});
   Object.assign(details,{destinationDetails:input.destinationDetails??null,reasonForLeavingOther:input.reasonForLeavingOther??null});
   if(faults.lostExitResponse)throw Error('Exit response lost');
  },
 };
 return {...f,exit,details,exitCounts:counts,enrollmentSession,exitUi,workflow:(options={})=>f.workflow({enrollmentSession,exitUi,...options})};
}

test('standalone exit verifies metadata and assessment, with no household journal or API',async()=>{
 for(const subgroup of [undefined,'singleton-subgroup']){
  const f=exitFixture({subgroup});await f.workflow().createEnrollment(entryInput());
  const result=await f.workflow().exitEnrollment(exitInput());
  assert.equal(result.enrollmentId,50);assert.equal(result.projectExitDate,exitInput().exitDate.replace('Z','.000Z'));assert.equal(result.exitSubgroupId,subgroup??null);assert.equal(result.assessmentCode,'EXIT');
  assert.equal(f.history.at(-1).value,'500');assert.equal(f.history.at(-1).date,result.projectExitDate);
  const before=structuredClone(f.counts);
  const again=await f.workflow().exitEnrollment(exitInput());assert.equal(again.outcome,'already-present');assert.equal(f.exitCounts.saves,1);assert.deepEqual(f.counts,before);
  const status=await f.workflow().getStatus({clientId:1,key:'exit-1'});assert.equal(status.stage,'verified');assert.equal(status.kind,'exit');assert.equal(status.exitSubgroupId,subgroup??null);assert.ok(status.steps.some(s=>s.name==='exit'&&s.state==='verified'));
 }
});

test('adopting a manually entered standalone enrollment performs no server writes and enables exit',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());f.journal.clear();const before=structuredClone(f.counts);
 const input={key:'manual-entry',clientId:1,enrollmentId:50},adopted=await f.workflow().adoptEnrollment(input);
 assert.equal(adopted.enrollmentId,50);assert.deepEqual(adopted.recordsetIds,{});assert.deepEqual(f.counts,before);
 assert.equal((await f.workflow().adoptEnrollment(input)).outcome,'already-present');assert.deepEqual(f.counts,before);
 await assert.rejects(f.workflow().adoptEnrollment({...input,key:'different'}),/already journaled/);
 const exited=await f.workflow().exitEnrollment({...exitInput(),enrollmentKey:input.key});assert.equal(exited.enrollmentId,50);assert.equal(f.exitCounts.saves,1);
});
test('standalone adoption rejects incomplete context and linked groups before journaling',async()=>{
 for(const changeSnapshot of [s=>s.tenant='wrong',s=>s.enrollmentId=51,s=>s.members.push({clientId:2,enrollmentId:51}),s=>s.exits=[],s=>s.projectStartDate='bad']){
  const f=exitFixture({changeSnapshot});await f.workflow().createEnrollment(entryInput());f.journal.clear();const before=structuredClone(f.counts);
  await assert.rejects(f.workflow().adoptEnrollment({key:'manual',clientId:1,enrollmentId:50}));assert.equal(f.journal.size,0);assert.deepEqual(f.counts,before);
 }
});
test('adopted standalone entries support interims and scalar-only corrections',async()=>{
 for(const action of ['interim','correction']){
  const f=exitFixture();await f.workflow().createEnrollment(entryInput());f.journal.clear();await f.workflow().adoptEnrollment({key:'adopted',clientId:1,enrollmentId:50});
  const result=action==='interim'?await f.workflow().createInterim({key:'review',enrollmentKey:'adopted',clientId:1,reviewDate,assessment:exitInput().assessment}):await f.workflow().correctEntry({key:'correct',enrollmentKey:'adopted',clientId:1,answers:{TOTAL:{value:12}}});
  assert.equal(result.enrollmentId,50);assert.equal(f.counts.enrollment,1);
 }
});
test('adopted entries can bind existing row IDs and correct them without creating another row',async()=>{
 const f=exitFixture(),created=await f.workflow().createEnrollment(entryInput());f.journal.clear();await f.workflow().adoptEnrollment({key:'adopted',clientId:1,enrollmentId:50});
 const input={key:'bind-existing',enrollmentKey:'adopted',clientId:1,rows:[{key:'existing-a',parentField:'ROWS',recordsetId:created.recordsetIds.a},{key:'existing-b',parentField:'ROWS',recordsetId:created.recordsetIds.b}]},before=structuredClone(f.counts);
 const result=await f.workflow().registerEntryRows(input);assert.deepEqual(result.recordsetIds,{'existing-a':created.recordsetIds.a,'existing-b':created.recordsetIds.b});assert.deepEqual(f.counts,before);
 assert.equal((await f.workflow().registerEntryRows({...input,rows:[...input.rows].reverse()})).outcome,'already-present');assert.deepEqual(f.counts,before);
 await f.workflow().correctEntry({key:'change-path',enrollmentKey:'adopted',clientId:1,subassessments:[{key:'existing-a',parentField:'ROWS',answers:{TYPE:{option:{code:'B'}}}}]});assert.equal(f.rows.length,2);
 assert.equal(f.rows.find(r=>r.recordset_id===created.recordsetIds.a).sub_assessment_list.find(c=>c.virt_field_name==='TYPE').answer_value,'12');
 const after=structuredClone(f.counts);await f.workflow().registerEntryRows(input);assert.deepEqual(f.counts,after);
 await assert.rejects(f.workflow().registerEntryRows({...input,rows:[{...input.rows[0],recordsetId:created.recordsetIds.b}]}),e=>e.code==='ROW_REGISTRATION_INTENT_CONFLICT'&&e.committed===false);
});
test('row registration refuses absent, wrongly scoped and duplicate bindings before writes',async()=>{
 const f=exitFixture(),created=await f.workflow().createEnrollment(entryInput());f.journal.clear();await f.workflow().adoptEnrollment({key:'adopted',clientId:1,enrollmentId:50});const before=structuredClone(f.counts);
 for(const rows of [[{key:'wrong',parentField:'ROWS',recordsetId:999}],[{key:'wrong',parentField:'OTHER',recordsetId:created.recordsetIds.a}],[{key:'a',parentField:'ROWS',recordsetId:created.recordsetIds.a},{key:'b',parentField:'ROWS',recordsetId:created.recordsetIds.a}]])await assert.rejects(f.workflow().registerEntryRows({key:'registration',enrollmentKey:'adopted',clientId:1,rows}),e=>typeof e.code==='string'&&e.committed===false);
 assert.deepEqual(f.counts,before);assert.deepEqual((await f.workflow().getStatus({clientId:1,key:'adopted'})).recordsetIds,{});
});
test('workflow errors classify known preflight failures and retain unknown after a write attempt',async()=>{
 const f=exitFixture();await assert.rejects(f.workflow().createEnrollment({...entryInput(),clientId:0}),e=>e.code==='CLIENT_ID_REQUIRED'&&e.committed===false&&e.operation==='createEnrollment');
 await f.workflow().createEnrollment(entryInput());
 f.api.assessments.create=async()=>{throw Object.assign(new Error('Rejected'),{status:400});};
 const correction={key:'bad',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}}};
 await assert.rejects(f.workflow().correctEntry(correction),e=>e.code==='ENTRY_CORRECTION_UNCERTAIN'&&e.committed==='unknown');
 await assert.rejects(f.workflow().resolveEntryCorrection({key:'bad',enrollmentKey:'entry-1',clientId:1,evidenceReference:'ref',confirmNotApplied:async()=>false}),e=>e.code==='INDEPENDENT_CONFIRMATION_REQUIRED'&&e.committed===false&&e.originalCommitted==='unknown');
});
test('standalone lost exit acknowledgement reconciles without resaving',async()=>{
 const f=exitFixture({lostExitResponse:true});await f.workflow().createEnrollment(entryInput());await f.workflow().exitEnrollment(exitInput());await f.workflow().exitEnrollment(exitInput());assert.equal(f.exitCounts.saves,1);
});
test('standalone unknown exit blocks resave and competing operations',async()=>{
 const f=exitFixture({noExitCommit:true});await f.workflow().createEnrollment(entryInput());const before=f.counts.scalars;
 await assert.rejects(f.workflow().exitEnrollment(exitInput()),/uncertain write/);
 await assert.rejects(f.workflow().exitEnrollment(exitInput()),/uncertain write/);
 await assert.rejects(f.workflow().exitEnrollment({...exitInput(),key:'another'}),/unfinished workflow/);
 await assert.rejects(f.workflow().createInterim({key:'review',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:exitInput().assessment}),/unfinished workflow/);
 assert.equal(f.exitCounts.saves,1);assert.equal(f.counts.scalars,before);
});
test('standalone exit requires the original verified entry and exit dependencies',async()=>{
 const f=exitFixture();await assert.rejects(f.workflow().exitEnrollment(exitInput()),/verified enrollment workflow/);
 await f.workflow().createEnrollment(entryInput());
 for(const options of [{enrollmentSession:undefined},{exitUi:undefined}])await assert.rejects(f.workflow(options).exitEnrollment(exitInput()),/exit UI and authoritative/);
 assert.equal(f.exitCounts.saves,0);
});
test('standalone exit validates dates, complete plans and UI choices before writes',async()=>{
 for(const change of [i=>i.exitDate='2026-10-18T16:00:00Z',i=>i.exitDate='2026-02-30T16:00:00Z',i=>i.assessment={},i=>i.destination='',i=>i.reasonForLeaving='']){
  const f=exitFixture();await f.workflow().createEnrollment(entryInput());const before=structuredClone(f.counts),input=exitInput();change(input);
  await assert.rejects(f.workflow().exitEnrollment(input));assert.equal(f.exitCounts.saves,0);assert.deepEqual(f.counts,before);
 }
 const f=exitFixture({validationFailure:true});await f.workflow().createEnrollment(entryInput());await assert.rejects(f.workflow().exitEnrollment(exitInput()),/choice unavailable/);assert.equal(await f.workflow().getStatus({clientId:1,key:'exit-1'}),null);
});
test('standalone exit refuses linked groups, mismatched context and incomplete authoritative reads',async()=>{
 const changes=[s=>s.members.push({clientId:2,enrollmentId:51}),s=>s.tenant='other',s=>s.providerId=3,s=>s.enrollmentType='VA',s=>s.enrollmentId=51,s=>s.projectStartDate=reviewDate,s=>s.exits=[],s=>s.exits[0].clientIds=[1,2],s=>s.exits[0].enrollmentIds=[50,51],s=>s.reviews=[{reviewDate:'2026-10-25T16:00:00Z'}]];
 for(const changeSnapshot of changes){
  const f=exitFixture({changeSnapshot});await f.workflow().createEnrollment(entryInput());const before=structuredClone(f.counts);
  await assert.rejects(f.workflow().exitEnrollment(exitInput()));assert.equal(f.exitCounts.saves,0);assert.deepEqual(f.counts,before);
 }
});
test('standalone exit adopts an exact existing exit and rejects conflicts or identity drift',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());Object.assign(f.exit,{projectExitDate:exitInput().exitDate,destination:'Rental by client (HUD)',reasonForLeaving:'Completed program'});
 await f.workflow().exitEnrollment(exitInput());assert.equal(f.exitCounts.saves,0);
 await assert.rejects(f.workflow().exitEnrollment({...exitInput(),destination:'Changed'}),/previous intent/);
 f.exit.exitSubgroupId='changed';await assert.rejects(f.workflow().exitEnrollment(exitInput()),/exit identity changed/);
});
test('standalone exit cannot overwrite a different existing exit',async()=>{
 for(const change of [e=>e.projectExitDate=reviewDate,e=>e.destination='Other',e=>e.reasonForLeaving='Other',e=>e.exitSubgroupId=undefined]){
  const f=exitFixture();await f.workflow().createEnrollment(entryInput());Object.assign(f.exit,{projectExitDate:exitInput().exitDate,destination:exitInput().destination,reasonForLeaving:exitInput().reasonForLeaving});change(f.exit);
  await assert.rejects(f.workflow().exitEnrollment(exitInput()),/conflicts/);assert.equal(f.exitCounts.saves,0);
 }
});
test('standalone exit retains conditional details and detects changed readback',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());
 const input={...exitInput(),destination:'Other',destinationDetails:{kind:'other',explanation:'Synthetic destination'},reasonForLeaving:'Other',reasonForLeavingOther:'Synthetic reason'};
 await f.workflow().exitEnrollment(input);assert.deepEqual(f.details.destinationDetails,input.destinationDetails);await f.workflow().exitEnrollment(input);assert.equal(f.exitCounts.saves,1);
 f.details.reasonForLeavingOther='Changed';await assert.rejects(f.workflow().exitEnrollment(input),/stored exit details conflict/);
});
test('standalone exit resumes assessment failure without repeating the saved exit',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());const save=f.api.assessmentsMobile.addAnswer;
 f.api.assessmentsMobile.addAnswer=async input=>{await save(input);throw Error('Lost scalar acknowledgement');};
 await f.workflow().exitEnrollment(exitInput());await f.workflow().exitEnrollment(exitInput());assert.equal(f.exitCounts.saves,1);
});
test('concurrent standalone exit calls share the client journal lock',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());const results=await Promise.all([f.workflow().exitEnrollment(exitInput()),f.workflow().exitEnrollment(exitInput())]);assert.equal(f.exitCounts.saves,1);assert.deepEqual(results.map(r=>r.outcome),['verified','already-present']);
});

test('yes/no clear is rejected before any scalar or row write and before a correction journal is created',async()=>{
 const f=exitFixture();f.metadata.push(question(9,'YESNO','yes_no'));const entry=entryInput();entry.assessment.notApplicable.YESNO='Not collected';await f.workflow().createEnrollment(entry);let sent=0;
 f.api.assessments.create=async()=>{sent++;throw Object.assign(new Error('Provided answer for yes/no question is invalid'),{status:400,kind:'http'});};
 const before=structuredClone(f.counts);
 await assert.rejects(f.workflow().correctEntry({key:'bad-clear',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}},clear:['YESNO'],subassessments:[{key:'a',parentField:'ROWS',clear:['AMOUNT']}]}),e=>e.code==='UNSUPPORTED_YES_NO_CLEAR'&&e.fields.includes('YESNO'));
 assert.equal(sent,0);assert.deepEqual(f.counts,before);assert.equal(await f.workflow().getStatus({clientId:1,key:'bad-clear'}),null);
});
test('correction HTTP status survives helper replacement without persisting response bodies or replaying a 400',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());let sent=0;
 const cause=Object.assign(new Error('Synthetic invalid lookup'),{status:400,kind:'http',responseBody:'PRIVATE_RESPONSE_SENTINEL'});
 f.api.assessments.create=async()=>{sent++;throw cause;};
 const input={key:'rejected-correction',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}}};
 await assert.rejects(f.workflow().correctEntry(input),e=>e.status===400&&e.cause===cause&&e.code==='ENTRY_CORRECTION_UNCERTAIN');
 await assert.rejects(f.workflow().correctEntry(input),e=>e.status===400&&e.code==='ENTRY_CORRECTION_UNCERTAIN');
 assert.equal(sent,1);const status=await f.workflow().getStatus({clientId:1,key:input.key});assert.deepEqual(status.steps.find(s=>s.name==='scalars').failure,{status:400,kind:'http'});
 assert.ok(!JSON.stringify([...f.journal]).includes('PRIVATE_RESPONSE_SENTINEL'));
});
test('explicit rejection resolution keeps history and requires independent confirmation before a new correction key',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());const originalWrite=f.api.assessments.create;let attempts=0;
 f.api.assessments.create=async()=>{attempts++;throw Object.assign(new Error('Invalid input'),{status:400,kind:'http'});};
 const input={key:'rejected',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}}};await assert.rejects(f.workflow().correctEntry(input));
 const record=[...f.journal.values()].flat().find(r=>r.key===input.key),originalHash=record.intentHash;
 const resolution={key:input.key,enrollmentKey:input.enrollmentKey,clientId:1,evidenceReference:'review-123',confirmNotApplied:async evidence=>{assert.equal(evidence.matchesBefore,true);assert.equal(evidence.steps[0].failure.status,400);return true;}};
 await assert.rejects(f.workflow().resolveEntryCorrection({...resolution,confirmNotApplied:async()=>false}),/independent non-application/);
 const resolved=await f.workflow().resolveEntryCorrection(resolution);assert.equal(resolved.outcome,'rejected');assert.equal(attempts,1);
 const status=await f.workflow().getStatus({clientId:1,key:input.key});assert.equal(status.stage,'rejected');assert.equal(status.steps[0].state,'attempted');assert.equal(status.resolution.evidenceReference,'review-123');
 assert.equal([...f.journal.values()].flat().find(r=>r.key===input.key).intentHash,originalHash);
 await assert.rejects(f.workflow().correctEntry(input),e=>e.code==='ENTRY_CORRECTION_REJECTED');
 f.api.assessments.create=originalWrite;await f.workflow().correctEntry({...input,key:'corrected-intent',answers:{TOTAL:{value:13}}});
 assert.equal((await f.workflow().resolveEntryCorrection(resolution)).outcome,'already-rejected');await f.workflow().createEnrollment(entryInput());assert.equal(f.history.filter(h=>h.field==='TOTAL').at(-1).value,'13');
});
test('rejection resolution supports older journals without failure metadata but cannot erase a partial commit',async()=>{
 for(const partial of [false,true]){
  const f=exitFixture();await f.workflow().createEnrollment(entryInput());let confirmed=0;
  f.api.assessments.create=async({query})=>{if(partial)f.history.push({field:'TOTAL',value:'12',date:query.dateEffective});throw Object.assign(new Error('Rejected'),{status:400});};
  const input={key:'old-correction',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12},OPTIONAL:{value:'Changed'}}};await assert.rejects(f.workflow().correctEntry(input));
  for(const records of f.journal.values()){const r=records.find(r=>r.key===input.key);if(r)delete r.steps.scalars.failure;}
  const resolution={key:input.key,enrollmentKey:input.enrollmentKey,clientId:1,evidenceReference:'external-verification',confirmNotApplied:async()=>{confirmed++;return true;}};
  if(partial){await assert.rejects(f.workflow().resolveEntryCorrection(resolution),/differs from its pre-write/);assert.equal(confirmed,0);assert.equal((await f.workflow().getStatus({clientId:1,key:input.key})).stage,'pending');}
  else assert.equal((await f.workflow().resolveEntryCorrection(resolution)).outcome,'rejected');
 }
});
test('resolution rechecks state after independent confirmation and refuses intervening changes',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());f.api.assessments.create=async()=>{throw Object.assign(new Error('Rejected'),{status:400});};
 const input={key:'correction',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}}};await assert.rejects(f.workflow().correctEntry(input));
 await assert.rejects(f.workflow().resolveEntryCorrection({key:input.key,enrollmentKey:input.enrollmentKey,clientId:1,evidenceReference:'review',confirmNotApplied:async()=>{f.history.push({field:'TOTAL',value:'99',date:entryDate});return true;}}),/changed during resolution/);
 assert.equal((await f.workflow().getStatus({clientId:1,key:input.key})).stage,'pending');
});
test('correction keeps both write and reconciliation errors while surfacing the original HTTP status',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());const read=f.api.assessments.get;let attempted=false;
 const writeError=Object.assign(new Error('Rejected'),{status:400,kind:'http'}),readError=Object.assign(new Error('Read failed'),{status:503,kind:'http'});
 f.api.assessments.create=async()=>{attempted=true;throw writeError;};f.api.assessments.get=async input=>{if(attempted)throw readError;return read(input);};
 await assert.rejects(f.workflow().correctEntry({key:'correction',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}}}),e=>e.status===400&&e.cause instanceof AggregateError&&e.cause.errors[0]===writeError&&e.cause.errors[1]===readError);
});
test('a 400 after a committed correction verifies successfully and cannot be resolved as rejected',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());const write=f.api.assessments.create;
 f.api.assessments.create=async input=>{await write(input);throw Object.assign(new Error('Response failure after commit'),{status:400,kind:'http'});};
 const input={key:'correction',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}}};assert.equal((await f.workflow().correctEntry(input)).outcome,'verified');
 await assert.rejects(f.workflow().resolveEntryCorrection({key:input.key,enrollmentKey:input.enrollmentKey,clientId:1,evidenceReference:'incorrect-claim',confirmNotApplied:async()=>true}),/verified correction cannot be rejected/);
});
test('entry correction updates scalars and existing rows, clears values and preserves original entry retries',async()=>{
 const f=exitFixture();f.metadata.push(question(9,'YESNO','yes_no'));
 const entry=entryInput();delete entry.assessment.notApplicable.OPTIONAL;entry.assessment.answers.OPTIONAL={value:'Old location'};entry.assessment.answers.YESNO={value:true};
 const workflow=()=>f.workflow({yesNoWrites:'standard',writeLabel:(_q,o)=>o.name}),created=await workflow().createEnrollment(entry),ids=created.recordsetIds;
 const input={key:'path-change',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12},YESNO:{value:false}},clear:['OPTIONAL'],subassessments:[{key:'a',parentField:'ROWS',answers:{TYPE:{option:{code:'B'}}},clear:['AMOUNT']},{key:'b',parentField:'ROWS',answers:{TYPE:{option:{code:'A'}}}}]};
 const result=await workflow().correctEntry(input);assert.deepEqual(result.recordsetIds,ids);assert.equal(f.rows.length,2);
 assert.equal(f.rows.find(r=>r.recordset_id===ids.a).sub_assessment_list.find(q=>q.virt_field_name==='TYPE').answer_value,'12');
 assert.equal(f.rows[0].sub_assessment_list.find(q=>q.virt_field_name==='START').answer_value,entryDate);
 assert.equal(f.history.filter(h=>h.field==='OPTIONAL').at(-1).value,null);assert.equal(f.history.filter(h=>h.field==='YESNO').at(-1).value,'No');
 const before=structuredClone(f.counts);assert.equal((await workflow().correctEntry(input)).outcome,'already-present');
 assert.equal((await workflow().createEnrollment(entry)).outcome,'already-present');assert.deepEqual(f.counts,before);
 const reverse={...input,key:'path-change-back',answers:{TOTAL:{value:0},OPTIONAL:{value:'Old location'},YESNO:{value:true}},clear:[],subassessments:[{key:'a',parentField:'ROWS',answers:{TYPE:{option:{code:'A'}}}},{key:'b',parentField:'ROWS',answers:{TYPE:{option:{code:'B'}}}}]};
 await workflow().correctEntry(reverse);assert.equal(f.history.filter(h=>h.field==='YESNO').at(-1).value,'Yes');assert.equal(f.rows.length,2);
 const after=structuredClone(f.counts);await workflow().correctEntry(input);await workflow().createEnrollment(entry);assert.deepEqual(f.counts,after);
});
test('entry correction preflights unsupported row types and unknown row keys before scalar writes',async()=>{
 for(const patch of [{key:'missing',parentField:'ROWS',answers:{TYPE:{option:{code:'A'}}}},{key:'a',parentField:'wrong',answers:{TYPE:{option:{code:'A'}}}}]){
  const f=exitFixture();await f.workflow().createEnrollment(entryInput());const before=structuredClone(f.counts);
  await assert.rejects(f.workflow({writeLabel:(_q,o)=>o.name}).correctEntry({key:'correction',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}},subassessments:[patch]}),/existing entry row/);assert.deepEqual(f.counts,before);
 }
});
test('unsupported provider or yes/no row patches fail before any requested scalar write',async()=>{
 for(const type of ['provider','yes_no']){
  const f=exitFixture();f.metadata.find(q=>q.fieldName==='ROWS').children.push(question(20,'UNSUPPORTED',type));await f.workflow().createEnrollment(entryInput());const before=structuredClone(f.counts);
  await assert.rejects(f.workflow({writeLabel:(_q,o)=>o.name}).correctEntry({key:'correct',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}},subassessments:[{key:'a',parentField:'ROWS',answers:{UNSUPPORTED:{value:type==='yes_no'?true:123}}}]}),/unsupported correction field/);assert.deepEqual(f.counts,before);
 }
});
test('entry correction refuses unexpected changes to another row and never resends the uncertain patch',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());const write=f.api.assessmentsMobile.addAnswer;
 f.api.assessmentsMobile.addAnswer=async input=>{await write(input);f.rows[1].sub_assessment_list.find(c=>c.virt_field_name==='AMOUNT').answer_value='999';};
 const input={key:'correct',enrollmentKey:'entry-1',clientId:1,subassessments:[{key:'a',parentField:'ROWS',answers:{TYPE:{option:{code:'B'}}}}]};
 await assert.rejects(f.workflow().correctEntry(input),/uncertain entry correction/);const before=structuredClone(f.counts);await assert.rejects(f.workflow().correctEntry(input),/uncertain entry correction/);assert.deepEqual(f.counts,before);
});
test('entry correction reconciles lost scalar and row acknowledgements without duplicate rows',async()=>{
 const faults={},f=exitFixture(faults);await f.workflow().createEnrollment(entryInput());faults.lostStandardResponse=true;faults.lostRowsResponse=true;
 const input={key:'correct',enrollmentKey:'entry-1',clientId:1,answers:{TOTAL:{value:12}},subassessments:[{key:'a',parentField:'ROWS',answers:{TYPE:{option:{code:'B'}}}}]},workflow=()=>f.workflow({writeLabel:(_q,o)=>o.name});
 await workflow().correctEntry(input);const before=structuredClone(f.counts);await workflow().correctEntry(input);assert.deepEqual(f.counts,before);assert.equal(f.rows.length,2);
});
test('partial entry row correction stays pending and never replays the patch',async()=>{
 const faults={},f=exitFixture(faults);await f.workflow().createEnrollment(entryInput());faults.partialCorrection=true;
 const input={key:'correct',enrollmentKey:'entry-1',clientId:1,subassessments:[{key:'a',parentField:'ROWS',answers:{TYPE:{option:{code:'B'}},RECEIVING:{option:{code:'YES'}}}}]},workflow=()=>f.workflow({writeLabel:(_q,o)=>o.name});
 await assert.rejects(workflow().correctEntry(input),/uncertain entry correction/);const before=structuredClone(f.counts);
 await assert.rejects(workflow().correctEntry(input),/uncertain entry correction/);await assert.rejects(workflow().createEnrollment(entryInput()),/unfinished workflow/);assert.deepEqual(f.counts,before);assert.equal(f.rows.length,2);
});

test('original entry retries accept a verified correction of an originally blank mandatory lookup',async()=>{
 const f=exitFixture();f.metadata.push(question(9,'MANDATORY','lookup',{mandatory:true,options:[option(11,'A'),option(12,'B')]}),question(10,'YESNO','yes_no'));
 const input=entryInput();input.assessment.notApplicable.MANDATORY='Not asked on the original path';input.assessment.answers.YESNO={value:true};
 const workflow=()=>f.workflow({yesNoWrites:'standard',writeLabel:(_q,o)=>o.name});await workflow().createEnrollment(input);
 await workflow().correctEntry({key:'correction',enrollmentKey:input.key,clientId:1,answers:{MANDATORY:{option:{code:'B'}}}});
 const before=structuredClone(f.counts);await workflow().createEnrollment(input);assert.deepEqual(f.counts,before);
});

test('path correction rejects yes/no clears and edits supported fields and two existing rows',async()=>{
 const at='2026-11-09T16:00:00Z',f=exitFixture({changeSnapshot:s=>s.projectStartDate=at});
 const options=[option(11,'OLD'),option(12,'NEW')],lookup=(id,field)=>question(id,field,'lookup',{options});
 const yesFields=Array.from({length:27},(_,i)=>`LOCAL_YES_NO_${i+1}`);
 const clearFields=['HUD_HOMELESSSTARTDATE','HUD_NUMBEROFTIMESTREETESSH','HUD_NOMONTHSTREETESSHIN3YRS','HOWMANYTIMESHAVEYOUBE_2','HOWMANYTIMESHAVEYOUBE_3','ONAREGULARDAYWHEREISI_1',...yesFields];
 const cls='SVP_HUD_CURRENTLIVINGSITUATION',ce='SVP_HUD_COORDINATEDENTRYASSESS';
 f.metadata.splice(0,f.metadata.length,
  lookup(1,'TYPEOFLIVINGSITUATION'),lookup(2,'HUD_LENGTHOFSTAY'),question(3,'HPTARGETINGSCORETOTAL','int'),question(4,'HUD_LENGTHSTAY_LESS7NIGHTS','yes_no'),
  question(5,clearFields[0],'date'),...clearFields.slice(1,5).map((field,i)=>lookup(6+i,field)),question(10,clearFields[5],'textbox'),...yesFields.map((field,i)=>question(20+i,field,'yes_no')),
  question(60,cls,'sub_assessment',{children:[question(61,'SVP_HUD_CURRENTLIVINGSITUATIONSTART','date'),question(62,'SVP_HUD_CLS_INFODATE','date'),lookup(63,'SVP_HUD_CLS_CURRENTLIVINGSIT'),question(64,'SVP_HUD_CLS_LOCATIONDETAILS','textbox')]}),
  question(70,ce,'sub_assessment',{children:[question(71,'SVP_HUD_COORDINATEDENTRYASSESSSTART','date'),lookup(72,'SVP_HUD_COORDENTRYASSESS_ASSESSLOCATION'),lookup(73,'SVP_HUD_COORDENTRYASSESS_ASSESSTYPE'),lookup(74,'SVP_HUD_COORDENTRYASSESS_ASSESSLEVEL'),lookup(75,'SVP_HUD_COORDENTRYASSESS_PRIORITYSTATUS')]}),
 );
 const oldAnswers=Object.fromEntries(clearFields.map((field,i)=>[field,i===0?{value:at}:i<5?{option:{code:'OLD'}}:i===5?{value:'Old path text'}:{value:true}]));
 const entry={...entryInput(),entryDate:at,assessment:{answers:{...oldAnswers,TYPEOFLIVINGSITUATION:{option:{code:'OLD'}},HUD_LENGTHOFSTAY:{option:{code:'OLD'}},HPTARGETINGSCORETOTAL:{value:0}},notApplicable:{HUD_LENGTHSTAY_LESS7NIGHTS:'Old path does not ask this'},subassessments:[
  {key:'cls-entry',parentField:cls,answers:{SVP_HUD_CURRENTLIVINGSITUATIONSTART:{value:at},SVP_HUD_CLS_INFODATE:{value:at},SVP_HUD_CLS_CURRENTLIVINGSIT:{option:{code:'OLD'}},SVP_HUD_CLS_LOCATIONDETAILS:{value:'Mornings at the library'}}},
  {key:'ce-entry',parentField:ce,answers:{SVP_HUD_COORDINATEDENTRYASSESSSTART:{value:at},SVP_HUD_COORDENTRYASSESS_ASSESSLOCATION:{option:{code:'OLD'}},SVP_HUD_COORDENTRYASSESS_ASSESSTYPE:{option:{code:'OLD'}},SVP_HUD_COORDENTRYASSESS_ASSESSLEVEL:{option:{code:'OLD'}},SVP_HUD_COORDENTRYASSESS_PRIORITYSTATUS:{option:{code:'OLD'}}}},
 ]}};
 const workflow=()=>f.workflow({yesNoWrites:'standard',writeLabel:(_q,o)=>o.name}),created=await workflow().createEnrollment(entry);
 const beforeRows=structuredClone(f.rows),input={key:'eviction-path',enrollmentKey:'entry-1',clientId:1,answers:{TYPEOFLIVINGSITUATION:{option:{code:'NEW'}},HUD_LENGTHOFSTAY:{option:{code:'NEW'}},HPTARGETINGSCORETOTAL:{value:12},HUD_LENGTHSTAY_LESS7NIGHTS:{value:false}},clear:clearFields,subassessments:[
  {key:'cls-entry',parentField:cls,answers:{SVP_HUD_CLS_CURRENTLIVINGSIT:{option:{code:'NEW'}}},clear:['SVP_HUD_CLS_LOCATIONDETAILS']},
  {key:'ce-entry',parentField:ce,answers:{SVP_HUD_COORDENTRYASSESS_ASSESSLEVEL:{option:{code:'NEW'}}}},
 ]};
 const beforeRejected=structuredClone(f.counts);await assert.rejects(workflow().correctEntry(input),e=>e.code==='UNSUPPORTED_YES_NO_CLEAR');assert.deepEqual(f.counts,beforeRejected);assert.deepEqual(f.rows,beforeRows);assert.equal(clearFields.length,33);
 // This explicit application change exercises only supported clears; the SDK never drops fields itself.
 input.clear=clearFields.slice(0,6);
 const corrected=await workflow().correctEntry(input);assert.deepEqual(corrected.recordsetIds,created.recordsetIds);assert.equal(f.rows.length,2);
 for(const field of input.clear)assert.equal(f.history.filter(h=>h.field===field).at(-1).value,null);
 assert.equal(f.history.filter(h=>h.field==='HUD_LENGTHSTAY_LESS7NIGHTS').at(-1).value,'No');
 for(const original of beforeRows){
  const current=f.rows.find(r=>r.recordset_id===original.recordset_id);assert.ok(current);
  for(const cell of original.sub_assessment_list){const actual=current.sub_assessment_list.find(q=>q.virt_field_name===cell.virt_field_name);const expected=['SVP_HUD_CLS_CURRENTLIVINGSIT','SVP_HUD_COORDENTRYASSESS_ASSESSLEVEL'].includes(cell.virt_field_name)?'12':cell.virt_field_name==='SVP_HUD_CLS_LOCATIONDETAILS'?null:cell.answer_value;assert.equal(actual.answer_value,expected,cell.virt_field_name);}
 }
 const writes=structuredClone(f.counts);await workflow().correctEntry(input);await workflow().createEnrollment(entry);assert.deepEqual(f.counts,writes);
 const reverse={...input,key:'literal-homeless-path',answers:{...oldAnswers,TYPEOFLIVINGSITUATION:{option:{code:'OLD'}},HUD_LENGTHOFSTAY:{option:{code:'OLD'}},HPTARGETINGSCORETOTAL:{value:0}},clear:['HUD_LENGTHSTAY_LESS7NIGHTS'],subassessments:[{key:'cls-entry',parentField:cls,answers:{SVP_HUD_CLS_CURRENTLIVINGSIT:{option:{code:'OLD'}},SVP_HUD_CLS_LOCATIONDETAILS:{value:'Mornings at the library'}}},{key:'ce-entry',parentField:ce,answers:{SVP_HUD_COORDENTRYASSESS_ASSESSLEVEL:{option:{code:'OLD'}}}}]};
 await assert.rejects(workflow().correctEntry(reverse),e=>e.code==='UNSUPPORTED_YES_NO_CLEAR');reverse.clear=[];
 await workflow().correctEntry(reverse);assert.equal(f.history.filter(h=>h.field==='HUD_LENGTHSTAY_LESS7NIGHTS').at(-1).value,'No');assert.deepEqual(f.rows,beforeRows);
 const finalWrites=structuredClone(f.counts);await workflow().correctEntry(input);await workflow().createEnrollment(entry);assert.deepEqual(f.counts,finalWrites);
});

test('standalone exit preserves its identity if interrupted after persisting exit verification',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());
 const write=f.store.write;let interrupt=true;
 f.store.write=async(scope,records)=>{await write(scope,records);if(interrupt&&records.some(r=>r.key==='exit-1'&&r.steps?.exit?.state==='verified'&&!Object.hasOwn(r,'exitSubgroupId'))){interrupt=false;throw Error('Journal acknowledgement lost');}};
 await assert.rejects(f.workflow().exitEnrollment(exitInput()),/Journal acknowledgement lost/);
 f.exit.exitSubgroupId='unexpected-new-group';
 await assert.rejects(f.workflow().exitEnrollment(exitInput()),/exit identity changed/);assert.equal(f.exitCounts.saves,1);
});
test('saved standalone exit stays pending after an uncommitted assessment and never replays either write',async()=>{
 const f=exitFixture();await f.workflow().createEnrollment(entryInput());let attempts=0;
 f.api.assessmentsMobile.addAnswer=async()=>{attempts++;throw Error('Assessment response unknown');};
 await assert.rejects(f.workflow().exitEnrollment(exitInput()),/uncertain write/);
 const status=await f.workflow().getStatus({clientId:1,key:'exit-1'});assert.equal(status.stage,'pending');assert.ok(status.steps.some(s=>s.name==='exit'&&s.state==='verified'));
 await assert.rejects(f.workflow().exitEnrollment(exitInput()),/uncertain write/);assert.equal(f.exitCounts.saves,1);assert.equal(attempts,1);
 // A subsequent authoritative read can establish that the original assessment committed.
 f.history.push({field:'TOTAL',value:'500',date:exitInput().exitDate.replace('Z','.000Z')});
 await f.workflow().exitEnrollment(exitInput());assert.equal(f.exitCounts.saves,1);assert.equal(attempts,1);
});

test('entry discovers configured instruments and reuses all writes across helper replacement',async()=>{
  const f=fixture(),first=await f.workflow().createEnrollment(entryInput());
  assert.equal(first.enrollmentId,50);assert.equal(first.assessmentCode,'ENTRY');assert.deepEqual(Object.keys(first.recordsetIds),['a','b']);
  const second=await f.workflow().createEnrollment(entryInput());assert.equal(second.outcome,'already-present');assert.deepEqual(second.recordsetIds,first.recordsetIds);
  assert.deepEqual(f.counts,{enrollment:1,scalars:1,rows:1,endDates:0,review:0});
});

test('entry creation uses the configured GWT list when a prior household makes REST unreadable',async()=>{
 const f=fixture();let restReads=0,gwtReads=0;
 f.api.enrollments.listForClient=async()=>{restReads++;const error=new Error('42703: grouped enrollment list unavailable');error.status=400;throw error;};
 const enrollmentSession={async listEnrollments({clientId}){gwtReads++;return {source:'gwt-rpc',tenant:testTenant,clientId,count:f.entries.length,values:f.entries.map(e=>({...e,projectExitDate:null}))};}};
 const result=await f.workflow({enrollmentSession}).createEnrollment(entryInput());
 assert.equal(result.enrollmentId,50);assert.equal(restReads,0);assert.ok(gwtReads>=2);assert.equal(f.counts.enrollment,1);
 const again=await f.workflow({enrollmentSession}).createEnrollment(entryInput());assert.equal(again.outcome,'already-present');assert.equal(f.counts.enrollment,1);
});
test('a shared scalar collision fails before enrollment creation or mobile batch writes',async()=>{
 const f=fixture();f.history.push({field:'TOTAL',value:'9',date:entryDate});const before=structuredClone(f.counts);
 await assert.rejects(f.workflow().createEnrollment(entryInput()),e=>e.code==='MOBILE_ANSWER_EXISTS'&&e.committed===false&&e.operation==='createEnrollment');assert.deepEqual(f.counts,before);assert.equal(await f.workflow().getStatus({clientId:1,key:'entry-1'}),null);
});

test('a fresh entry never adopts a matching exited enrollment and an old keyed retry retains its own ID',async()=>{
 const f=fixture();f.entries.push({clientId:1,enrollmentId:49,enrollmentProvider:2,type:'HUD',projectStartDate:entryDate,projectExitDate:reviewDate,isActive:true});
 const created=await f.workflow().createEnrollment(entryInput());assert.equal(created.enrollmentId,50);assert.equal(f.counts.enrollment,1);
 f.entries.find(e=>e.enrollmentId===50).projectExitDate=reviewDate;f.entries.push({...f.entries[1],enrollmentId:51,projectExitDate:null});
 assert.equal((await f.workflow().createEnrollment(entryInput())).enrollmentId,50);assert.equal(f.counts.enrollment,1);
});
test('unreadable pre-create lists are typed non-commits, while post-create reads remain uncertain',async()=>{
 const {EnrollmentReadError}=await import('@choiceapps/communityservices-sdk/browser');
 for(const source of ['rest','gwt-rpc']){
  const f=fixture();const cause=Object.assign(new Error('Synthetic unreadable list'),{status:400});
  const bad=async()=>{throw cause;};
  const options=source==='rest'?{}:{enrollmentSession:{listEnrollments:bad}};
  f.api.enrollments.listForClient=bad;
  await assert.rejects(f.workflow(options).createEnrollment(entryInput()),e=>e instanceof EnrollmentReadError&&e.code==='ENROLLMENT_READ_FAILED'&&e.phase==='preflight'&&e.committed===false&&e.source===source&&e.cause===cause);
  assert.equal(f.counts.enrollment,0);
 }
 const f=fixture(),read=f.api.enrollments.listForClient;
 f.api.enrollments.listForClient=async()=>{if(f.counts.enrollment)throw Error('Read lost after create');return read();};
 for(let retry=0;retry<2;retry++)await assert.rejects(f.workflow().createEnrollment(entryInput()),e=>e instanceof EnrollmentReadError&&e.phase==='reconciliation'&&e.committed==='unknown');
 assert.equal(f.counts.enrollment,1);
});
test('GWT list failures and incomplete or mismatched lists never fall back to REST or create',async()=>{
 for(const change of [s=>s.tenant='wrong',s=>s.clientId=2,s=>s.count=1,s=>s.source='rest',s=>s.values=[{}]]){
  const f=fixture();let rest=0;f.api.enrollments.listForClient=async()=>{rest++;throw Error('REST must not run');};
  const enrollmentSession={async listEnrollments(){const s={source:'gwt-rpc',tenant:testTenant,clientId:1,count:0,values:[]};change(s);return s;}};
  await assert.rejects(f.workflow({enrollmentSession}).createEnrollment(entryInput()),e=>e.code==='ENROLLMENT_READ_FAILED'&&e.committed===false);assert.equal(rest,0);assert.equal(f.counts.enrollment,0);
 }
});
test('lost enrollment, scalar and row acknowledgements reconcile without replay',async()=>{
  const f=fixture({lostEnrollmentResponse:true,lostScalarResponse:true,lostRowsResponse:true});
  await f.workflow().createEnrollment(entryInput());await f.workflow().createEnrollment(entryInput());
  assert.equal(f.counts.enrollment,1);assert.equal(f.counts.scalars,1);assert.equal(f.counts.rows,1);assert.equal(f.rows.length,2);
});
test('unknown enrollment outcome blocks retry and any other unfinished workflow',async()=>{
  const f=fixture({noEnrollmentCommit:true});await assert.rejects(f.workflow().createEnrollment(entryInput()),/uncertain write/);
  await assert.rejects(f.workflow().createEnrollment(entryInput()),/uncertain write/);
  await assert.rejects(f.workflow().createEnrollment({...entryInput(),key:'another'}),/unfinished workflow/);
  assert.equal(f.counts.enrollment,1);assert.equal(f.counts.scalars,0);
});
test('failed yes/no scalar writes preserve their HTTP cause and remain pending without retry or endpoint fallback',async()=>{
 const f=fixture();f.metadata.push(question(9,'SYNTHETIC_YES_NO','yes_no'));
 const input=entryInput();input.assessment.answers.SYNTHETIC_YES_NO={value:true};
 const {WellSkyClient}=await import('@choiceapps/communityservices-sdk');
 let writes=0,standardWrites=0;const payloads=[];
 const transport=new WellSkyClient({tenant:testTenant,auth:{kind:'none'},captureErrorBody:true,fetch:async(_url,init)=>{writes++;payloads.push(JSON.parse(init.body));return new Response('{"message":"Synthetic yes/no failure"}',{status:400,headers:{'x-request-id':'synthetic-request'}});}});
 f.api.assessmentsMobile.addAnswer=transport.assessmentsMobile.addAnswer;
 f.api.assessments.create=async()=>{standardWrites++;};
 await assert.rejects(f.workflow().createEnrollment(input),error=>{
  assert.equal(error.name,'EnrollmentWorkflowError');assert.equal(error.reason,'uncertain write requires reconciliation');assert.equal(error.step,'scalars');
  assert.equal(error.cause.name,'UpstreamError');assert.equal(error.cause.status,400);assert.equal(error.cause.requestId,'synthetic-request');
  assert.equal(error.cause.responseBody,'{"message":"Synthetic yes/no failure"}');
  assert.ok(!JSON.stringify(error).includes('Synthetic yes/no failure'));return true;
 });
 assert.equal(payloads[0].find(q=>q.virt_field_name==='SYNTHETIC_YES_NO').answer_value,'Yes');
 assert.equal((await f.workflow().getStatus({clientId:1,key:input.key})).stage,'pending');
 assert.ok(!JSON.stringify([...f.journal]).includes('Synthetic yes/no failure'));
 await assert.rejects(f.workflow().createEnrollment(input),error=>error.step==='scalars'&&error.reason==='uncertain write requires reconciliation');
 assert.equal(writes,1);assert.equal(standardWrites,0);assert.equal(f.counts.enrollment,1);
});
test('a committed write that returned an error still reconciles as verified',async()=>{
 const f=fixture({lostScalarResponse:true});const result=await f.workflow().createEnrollment(entryInput());
 assert.equal(result.outcome,'verified');assert.equal(f.counts.scalars,1);
});
test('thirty silently discarded yes/no answers never mark an enrollment complete or resend its scalar batch',async()=>{
 const f=fixture(),input=entryInput(),submit=f.api.assessmentsMobile.addAnswer;
 for(let i=0;i<30;i++){const field=`SYNTHETIC_YES_NO_${i}`;f.metadata.push(question(10+i,field,'yes_no'));input.assessment.answers[field]={value:i%2===0};}
 let calls=0;
 f.api.assessmentsMobile.addAnswer=async args=>{calls++;assert.equal(args.body.filter(q=>q.question_type==='yes_no').length,30);return submit({...args,body:args.body.filter(q=>q.question_type!=='yes_no')});};
 await assert.rejects(f.workflow().createEnrollment(input),error=>error.step==='scalars'&&error.reason==='uncertain write requires reconciliation');
 const status=await f.workflow().getStatus({clientId:1,key:input.key});assert.equal(status.stage,'pending');
 assert.equal(status.steps.find(s=>s.name==='scalars').state,'attempted');
 await assert.rejects(f.workflow().createEnrollment(input),/uncertain write requires reconciliation/);
 assert.equal(calls,1);assert.equal(f.counts.enrollment,1);assert.equal(f.counts.rows,0);
});
test('a failed write and failed reconciliation preserve both causes without replay',async()=>{
 const f=fixture(),writeError=new Error('Synthetic write failure'),readError=new Error('Synthetic read failure');let attempted=false,writes=0;
 const get=f.api.assessments.get;
 f.api.assessments.get=async args=>{if(attempted)throw readError;return get(args);};
 f.api.assessmentsMobile.addAnswer=async()=>{attempted=true;writes++;throw writeError;};
 await assert.rejects(f.workflow().createEnrollment(entryInput()),error=>error.step==='scalars'&&error.cause instanceof AggregateError&&error.cause.errors[0]===writeError&&error.cause.errors[1]===readError);
 assert.equal(writes,1);
});
test('partial subassessment commit blocks batch replay and preserves confirmed earlier steps',async()=>{
  const f=fixture({partialRows:true});await assert.rejects(f.workflow().createEnrollment(entryInput()),/uncertain write/);
  assert.equal(f.rows.length,1);await assert.rejects(f.workflow().createEnrollment(entryInput()),/uncertain write/);
  assert.deepEqual(f.counts,{enrollment:1,scalars:1,rows:1,endDates:0,review:0});
});
test('retry resumes when delayed readback proves all previously attempted rows',async()=>{
  const f=fixture({partialRows:true});await assert.rejects(f.workflow().createEnrollment(entryInput()));
  const second=structuredClone(f.rows[0]);second.recordset_id=101;second.sub_assessment_list.find(q=>q.virt_field_name==='TYPE').answer_value='12';f.rows.push(second);
  const result=await f.workflow().createEnrollment(entryInput());assert.equal(result.outcome,'verified');assert.equal(result.recordsetIds.b,101);assert.equal(f.counts.rows,1);
});
test('all top-level coverage and duplicate row checks run before enrollment creation',async()=>{
  for(const edit of [
    input=>{delete input.assessment.notApplicable;},
    input=>{input.assessment.subassessments.push(row('a','A'));},
    input=>{input.assessment.subassessments.push(row('other-key','A'));},
    input=>{input.assessment.carryForward=['TOTAL'];},
    input=>{input.entryDate='2026-02-30T16:00:00Z';},
  ]){const f=fixture(),input=entryInput();edit(input);await assert.rejects(f.workflow().createEnrollment(input));assert.equal(f.counts.enrollment,0);assert.equal(f.journal.size,0);}
});
test('interim closes only the changed row and repeat entry remains reconcilable',async()=>{
  const f=fixture({lostEndResponse:true}),entry=await f.workflow().createEnrollment(entryInput());
  const input={key:'review-1',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:1000}},notApplicable:{OPTIONAL:'Still not applicable'},endDates:[{parentField:'ROWS',recordsetId:entry.recordsetIds.a,startDateField:'START',endDateField:'END',endDate:'2026-10-21T16:00:00Z'}],subassessments:[row('a-new','A',reviewDate,'YES')]}};
  const first=await f.workflow().createInterim(input);assert.equal(first.reviewId,60);assert.equal(f.rows.length,3);
  assert.equal(f.rows.find(r=>r.recordset_id===entry.recordsetIds.b).sub_assessment_list.find(q=>q.virt_field_name==='END').answer_value,null);
  const before=structuredClone(f.counts);assert.equal((await f.workflow().createInterim(input)).outcome,'already-present');assert.equal((await f.workflow().createEnrollment(entryInput())).outcome,'already-present');assert.deepEqual(f.counts,before);
  assert.equal(f.history.filter(h=>h.field==='TOTAL'&&Date.parse(h.date)===Date.parse(entryDate))[0].value,'0');
});
test('interim requires a verified entry and valid closure target before review creation',async()=>{
  const f=fixture(),input={key:'review',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:1000}},notApplicable:{OPTIONAL:'Not applicable'},carryForward:['ROWS']}};
  await assert.rejects(f.workflow().createInterim(input),/verified enrollment/);await f.workflow().createEnrollment(entryInput());
  await assert.rejects(f.workflow().createInterim({...input,reviewDate:'2026-10-18T16:00:00Z'}),/precedes entry/);
  await assert.rejects(f.workflow().createInterim({...input,assessment:{...input.assessment,carryForward:[],endDates:[{parentField:'ROWS',recordsetId:999,startDateField:'START',endDateField:'END',endDate:'2026-10-21T16:00:00Z'}]}}),/target missing/);
  assert.equal(f.counts.review,0);
});
test('changed intent, changed metadata and missing verified rows fail closed',async()=>{
  const f=fixture();await f.workflow().createEnrollment(entryInput());
  const changed=entryInput();changed.assessment.answers.TOTAL={value:100};await assert.rejects(f.workflow().createEnrollment(changed),/conflicts/);
  f.metadata[0].description='Changed definition';await assert.rejects(f.workflow().createEnrollment(entryInput()),/configuration changed/);f.metadata[0].description='TOTAL';
  f.rows.pop();await assert.rejects(f.workflow().createEnrollment(entryInput()),/verified step changed/);assert.equal(f.counts.rows,1);
});
test('duplicate matching enrollments and concurrent same-key calls cannot create duplicates',async()=>{
  const f=fixture();const results=await Promise.all([f.workflow().createEnrollment(entryInput()),f.workflow().createEnrollment(entryInput())]);assert.deepEqual(results.map(r=>r.outcome),['verified','already-present']);assert.equal(f.counts.enrollment,1);
  f.entries.push({...f.entries[0],enrollmentId:51});await assert.rejects(f.workflow().createEnrollment(entryInput()),/duplicate matching enrollments/);
});
test('invalid tenant and unresolved assessment default prevent writes',async()=>{
  const f=fixture();f.api.tenant='';assert.throws(()=>f.workflow(),/tenant/);f.api.tenant=testTenant;
  f.discovery.getProviderAssessments=async()=>({providerId:2,defaults:[]});await assert.rejects(f.workflow().createEnrollment(entryInput()),/default unresolved/);assert.equal(f.counts.enrollment,0);
});
test('status reports pending steps without credentials, answers or new requests',async()=>{
  const f=fixture({partialRows:true}),workflow=f.workflow();
  assert.equal(await workflow.getStatus({clientId:1,key:'entry-1'}),null);
  await assert.rejects(workflow.createEnrollment(entryInput()));const before=structuredClone(f.counts);
  const status=await workflow.getStatus({clientId:1,key:'entry-1'});
  assert.equal(status.kind,'entry');assert.equal(status.stage,'pending');assert.equal(status.enrollmentId,50);
  assert.deepEqual(status.steps,[{name:'enrollment',state:'verified'},{name:'scalars',state:'verified'},{name:'rows',state:'attempted'}]);
  assert.deepEqual(Object.keys(status).sort(),['assessmentCode','enrollmentId','key','kind','recordsetIds','stage','steps']);
  status.recordsetIds.injected=99;status.steps[0].state='attempted';
  assert.equal((await workflow.getStatus({clientId:1,key:'entry-1'})).steps[0].state,'verified');
  assert.deepEqual((await workflow.getStatus({clientId:1,key:'entry-1'})).recordsetIds,{});assert.deepEqual(f.counts,before);
});
test('invalid row dates and closure chronology fail before writes',async()=>{
  const f=fixture(),invalid=entryInput();invalid.assessment.subassessments[0].answers.START={value:'2026-02-30T16:00:00Z'};
  await assert.rejects(f.workflow().createEnrollment(invalid),/date/);assert.equal(f.counts.enrollment,0);
  const entry=await f.workflow().createEnrollment(entryInput());
  for(const endDate of ['2026-10-18T16:00:00Z',reviewDate,'2026-10-23T16:00:00Z']){
    await assert.rejects(f.workflow().createInterim({key:'review',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:1000}},notApplicable:{OPTIONAL:'Not applicable'},endDates:[{parentField:'ROWS',recordsetId:entry.recordsetIds.a,startDateField:'START',endDateField:'END',endDate}]}}));
  }
  assert.equal(f.counts.review,0);assert.equal(f.counts.endDates,0);
});
test('VA enrollment uses the separate VA assessment defaults',async()=>{
  const f=fixture(),getProviderAssessments=f.discovery.getProviderAssessments;
  f.discovery.getProviderAssessments=async input=>{const result=await getProviderAssessments(input);return {...result,defaults:result.defaults.map(d=>({...d,location:d.location.replace('showHud','showVa')}))};};
  const result=await f.workflow().createEnrollment({...entryInput(),type:'VA'});
  assert.equal(result.enrollmentId,50);assert.equal(f.entries[0].type,'VA');assert.equal(f.counts.enrollment,1);
});
for(const type of ['HUD','Basic','Standard','RHY','VA','Basic Center Program Entry/Exit','PATH','Quick Call','Transitional Living Program Entry/Exit']){
 test(`${type} uses explicit locations for discovery, entry, interim and same-key reconciliation`,async()=>{
  const f=fixture(),locations={entry:'syntheticEntry',interim:'syntheticInterim',exit:'syntheticExit'};
  const get=f.discovery.getProviderAssessments;
  f.discovery.getProviderAssessments=async input=>{
   const result=await get(input);
   return {...result,defaults:[...result.defaults,...['entry','interim','exit'].map((phase,i)=>({location:locations[phase],resolution:'resolved',assessment:{assessmentId:10+i,code:`SELECTED_${phase.toUpperCase()}`,name:phase,assignedToAssessmentTab:true}}))]};
  };
  const options={...f,assessmentLocations:{[type]:locations}},workflow=createEnrollmentWorkflow(options),input={...entryInput(),type};
  const discovered=await workflow.discoverExit({clientId:1,providerId:2,type,entryDate});
  assert.equal(discovered.entry.assessment.code,'SELECTED_ENTRY');assert.equal(discovered.interim.assessment.code,'SELECTED_INTERIM');assert.equal(discovered.exit.assessment.code,'SELECTED_EXIT');
  const entry=await workflow.createEnrollment(input);assert.equal(entry.assessmentCode,'SELECTED_ENTRY');assert.equal(f.entries[0].type,type);
  const interim={key:'review',enrollmentKey:input.key,clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:10}},notApplicable:{OPTIONAL:'Synthetic'},carryForward:['ROWS']}};
  assert.equal((await workflow.createInterim(interim)).assessmentCode,'SELECTED_INTERIM');
  const before=structuredClone(f.counts);
  assert.equal((await createEnrollmentWorkflow(options).createEnrollment(input)).outcome,'already-present');
  assert.equal((await createEnrollmentWorkflow(options).createInterim(interim)).outcome,'already-present');
  assert.deepEqual(f.counts,before);
 });
}
test('unsupported types and missing explicit mappings cannot fall back to HUD or VA',async()=>{
 for(const type of ['Unknown','Basic','Standard','RHY','Basic Center Program Entry/Exit','PATH','Quick Call','Transitional Living Program Entry/Exit']){
  const f=fixture();let reads=0;f.api.clients.get=async()=>{reads++;throw Error('Unexpected read');};
  await assert.rejects(f.workflow().createEnrollment({...entryInput(),type}),type==='Unknown'?/supported Entry\/Exit type/:/assessment locations required/);
  assert.equal(reads,0);assert.equal(f.counts.enrollment,0);assert.equal(f.journal.size,0);
 }
});
test('location mappings reject invalid configuration and unresolved phases before writes',async()=>{
 for(const assessmentLocations of [null,[],{Unknown:{entry:'e',interim:'i'}},{PATH:{entry:'e'}},{PATH:{entry:' ',interim:'i'}},{PATH:{entry:'e',interim:'i',exit:''}},{PATH:{entry:'e',interim:'i',other:'x'}}]){
  const f=fixture();assert.throws(()=>createEnrollmentWorkflow({...f,assessmentLocations}));assert.equal(f.journal.size,0);
 }
 for(const fault of ['missing','duplicate','unset','unresolved']){
  const f=fixture(),get=f.discovery.getProviderAssessments;
  f.discovery.getProviderAssessments=async input=>{const result=await get(input);if(fault==='missing')result.defaults.shift();else if(fault==='duplicate')result.defaults.push(structuredClone(result.defaults[0]));else result.defaults[0].resolution=fault;return result;};
  const workflow=createEnrollmentWorkflow({...f,assessmentLocations:{PATH:{entry:'showHudEntry',interim:'showHudInterim'}}});
  await assert.rejects(workflow.createEnrollment({...entryInput(),type:'PATH'}),/program assessment default unresolved/);
  assert.equal(f.counts.enrollment,0);assert.equal(f.journal.size,0);
 }
 const f=fixture(),workflow=createEnrollmentWorkflow({...f,assessmentLocations:{PATH:{entry:'showHudEntry',interim:'showHudInterim'}}});
 await assert.rejects(workflow.discoverExit({clientId:1,providerId:2,type:'PATH',entryDate}),/including exit/);
 assert.equal(f.journal.size,0);
});
test('incomplete enrollment pagination cannot be mistaken for no matching enrollment',async()=>{
  const f=fixture();f.api.enrollments.listForClient=async()=>({count:1,values:[]});
  await assert.rejects(f.workflow().createEnrollment(entryInput()),/incomplete enrollment list/);assert.equal(f.counts.enrollment,0);
});
test('semantic duplicate rows normalize field order, timezone offsets and money formatting',async()=>{
  const f=fixture(),input=entryInput(),original=row('first','A',entryDate,'YES');
  const equivalent={key:'second',parentField:'ROWS',answers:{AMOUNT:{value:'1000.00'},START:{value:'2026-10-19T12:00:00-04:00'},RECEIVING:{option:{code:'YES'}},TYPE:{option:{code:'A'}}}};
  input.assessment.subassessments=[original,equivalent];
  await assert.rejects(f.workflow().createEnrollment(input),/duplicate semantic/);assert.equal(f.counts.enrollment,0);assert.equal(f.journal.size,0);
});
test('distinct rows cannot reconcile to the same server recordset ID',async()=>{
  const f=fixture(),submit=f.api.assessmentsMobile.addAnswer;
  f.api.assessmentsMobile.addAnswer=async args=>{const result=await submit(args);if(f.rows.length===2)f.rows[1].recordset_id=f.rows[0].recordset_id;return result;};
  await assert.rejects(f.workflow().createEnrollment(entryInput()),/reused subassessment ID/);
  await assert.rejects(f.workflow().createEnrollment(entryInput()),/reused subassessment ID/);assert.equal(f.counts.rows,1);
});
test('crash after verified enrollment step still pins its original server ID',async()=>{
  const f=fixture(),persist=f.store.write;let interrupted=false;
  f.store.write=async(scope,records)=>{await persist(scope,records);const record=records[0];if(!interrupted&&record.steps.enrollment?.state==='verified'&&!record.enrollmentId){interrupted=true;throw Error('Process stopped after durable verified step');}};
  await assert.rejects(f.workflow().createEnrollment(entryInput()),/Process stopped/);assert.equal(f.counts.enrollment,1);
  f.entries[0].enrollmentId=51;
  await assert.rejects(f.workflow().createEnrollment(entryInput()),/saved enrollment missing or changed/);assert.equal(f.counts.enrollment,1);assert.equal(f.counts.scalars,0);
});
test('malformed enrollment identity fields fail before any create',async()=>{
  for(const change of [{enrollmentProvider:undefined},{type:undefined},{projectStartDate:'not-a-date'},{isActive:undefined}]){
    const f=fixture();f.entries.push({enrollmentId:50,clientId:1,enrollmentProvider:2,type:'HUD',projectStartDate:entryDate,isActive:true,...change});
    await assert.rejects(f.workflow().createEnrollment(entryInput()),/invalid enrollment list/);assert.equal(f.counts.enrollment,0);
  }
});
test('row closure rejects changes to any retained field and does not retry the write',async()=>{
  const f=fixture(),entry=await f.workflow().createEnrollment(entryInput()),close=f.api.subassessments.setEndDate;
  f.api.subassessments.setEndDate=async args=>{const result=await close(args);f.rows.find(r=>r.recordset_id===entry.recordsetIds.b).sub_assessment_list.find(q=>q.virt_field_name==='TYPE').answer_value='11';return result;};
  const input={key:'review-corruption',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:1000}},notApplicable:{OPTIONAL:'Not applicable'},endDates:[{parentField:'ROWS',recordsetId:entry.recordsetIds.a,startDateField:'START',endDateField:'END',endDate:'2026-10-21T16:00:00Z'}]}};
  await assert.rejects(f.workflow().createInterim(input));await assert.rejects(f.workflow().createInterim(input));assert.equal(f.counts.endDates,1);assert.equal(f.counts.scalars,1);
});
test('closure cannot end a row before its stored start',async()=>{
  const f=fixture(),input=entryInput();input.assessment.subassessments[0].answers.START={value:'2026-10-21T16:00:00Z'};
  const entry=await f.workflow().createEnrollment(input);
  await assert.rejects(f.workflow().createInterim({key:'review',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:1000}},notApplicable:{OPTIONAL:'Not applicable'},endDates:[{parentField:'ROWS',recordsetId:entry.recordsetIds.a,startDateField:'START',endDateField:'END',endDate:'2026-10-20T16:00:00Z'}]}}));
  assert.equal(f.counts.endDates,0);assert.equal(f.counts.review,0);
});

for(const committed of [true,false])test(`REST enrollment retry after UI reauthentication ${committed?'reuses the completed enrollment and assessments':'does not repeat an uncertain create'}`,async()=>{
 const {EventEmitter}=await import('node:events');const {attachAuthentication}=await import(new URL('./session-authentication.mjs',import.meta.resolve('@choiceapps/communityservices-sdk/browser')));const {withPageLock}=await import(new URL('./page-lock.mjs',import.meta.resolve('@choiceapps/communityservices-sdk/browser')));
 const f=fixture({noEnrollmentCommit:!committed}),page=new EventEmitter();page.url=()=>`https://wscs.wellsky.com/${testTenant}/com.bowmansystems.sp5.core.ServicePoint/index.html`;let expired=false,reconnections=0;page.locator=()=>({count:async()=>Number(expired)});attachAuthentication(page,async()=>{expired=false;reconnections++;});
 const discover=f.discovery.getProviderAssessments;f.discovery.getProviderAssessments=(...args)=>withPageLock(page,()=>discover(...args));
 if(committed)await f.workflow().createEnrollment(entryInput());else await assert.rejects(f.workflow().createEnrollment(entryInput()),/uncertain write/);
 const counts=structuredClone(f.counts);expired=true;
 if(committed)assert.equal((await f.workflow().createEnrollment(entryInput())).outcome,'already-present');else await assert.rejects(f.workflow().createEnrollment(entryInput()),/uncertain write/);
 assert.equal(reconnections,1);assert.deepEqual(f.counts,counts);assert.equal(f.counts.enrollment,1);
});

// Exercise the real DOB helper alongside the real workflow, not a mocked writer.
function birthFixture(faults={}){
 const f=fixture(faults);f.metadata.push(question(9,'SVPPROFDOB','date'));
 let writes=0;const current=()=>f.history.filter(h=>h.field==='SVPPROFDOB').at(-1);
 f.api.clients.get=async()=>({clientId:1,isActive:true,socSecNo:'999001234',svpprofdob:current()?.value.slice(0,10).replaceAll('-','/')??null});
 f.api.clients.update=async({body})=>{writes++;assert.equal(body.socSecNo,'999001234');assert.match(body.svpprofdob,/T07:00:00Z$/);f.history.push({field:'SVPPROFDOB',value:body.svpprofdob.slice(0,10)+' 00:00:00-07',date:body.dateEffective.replace('.000','')});if(faults.lostBirthResponse)throw Error('DOB acknowledgement lost');};
 f.api.assessmentsMobile.getAnswers=async()=>{const rows=await f.api.assessments.get({});if(faults.blankMobileDob)rows.find(q=>q.virt_field_name==='SVPPROFDOB').answer_value='';return rows;};
 const add=f.api.assessmentsMobile.addAnswer;f.api.assessmentsMobile.addAnswer=async args=>{assert.ok(!args.body.some(q=>q.virt_field_name==='SVPPROFDOB'),'DOB must not enter mobile answer batch');return add(args);};
 const ui={validateRestDate:async()=>{},read:async()=>current()?.value.slice(0,10)??null,correctAtEntry:async()=>{throw Error('Unexpected correction');}};
 const birthDates=createDateOfBirth({api:f.api,ui,store:f.store});
 return {...f,ui,birthDates,birthWrites:()=>writes,workflow:()=>createEnrollmentWorkflow({...f,birthDates})};
}
const birthEntry=()=>{const input=entryInput();input.assessment.answers.SVPPROFDOB={value:'1984-02-29'};return input;};
test('DOB is a calendar date written once after assessment rows, including lost acknowledgement recovery',async()=>{
 for(const lostBirthResponse of [false,true]){
  const f=birthFixture({lostBirthResponse}),result=await f.workflow().createEnrollment(birthEntry());
  assert.equal(result.birthDate.dateOfBirth,'1984-02-29');assert.equal(result.birthDate.effectiveDate,new Date(entryDate).toISOString());
  assert.equal((await f.workflow().createEnrollment(birthEntry())).outcome,'already-present');assert.equal(f.birthWrites(),1);assert.equal(f.counts.enrollment,1);assert.equal(f.counts.rows,1);
 }
});
test('DOB validation or missing adapter stops enrollment before mutation',async()=>{
 for(const value of ['1983-02-29','1984-02-29T07:00:00Z','2027-01-01']){const f=birthFixture(),input=birthEntry();input.assessment.answers.SVPPROFDOB={value};await assert.rejects(f.workflow().createEnrollment(input));assert.equal(f.counts.enrollment,0);assert.equal(f.birthWrites(),0);}
 const f=birthFixture();await assert.rejects(createEnrollmentWorkflow({...f,birthDates:undefined}).createEnrollment(birthEntry()),/DOB helper required/);assert.equal(f.counts.enrollment,0);
 const g=birthFixture();g.ui.read=async()=> '1990-01-01';await assert.rejects(g.workflow().createEnrollment(birthEntry()),/UI DOB disagree/);assert.equal(g.counts.enrollment,0);
});
test('DOB carries through blank mobile projections and completed entry retries after later assessment changes',async()=>{
 const f=birthFixture({blankMobileDob:true});await f.workflow().createEnrollment(birthEntry());
 const input={key:'review-dob',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:1000}},notApplicable:{OPTIONAL:'Not applicable'},carryForward:['ROWS','SVPPROFDOB']}};
 const review=await f.workflow().createInterim(input);assert.equal(review.birthDate.dateOfBirth,'1984-02-29');assert.equal(review.birthDate.effectiveDate,new Date(entryDate).toISOString());
 const before=structuredClone(f.counts);assert.equal((await f.workflow().createEnrollment(birthEntry())).outcome,'already-present');assert.equal((await f.workflow().createInterim(input)).outcome,'already-present');assert.deepEqual(f.counts,before);assert.equal(f.birthWrites(),1);
});
test('later explicit DOB effective date preserves earlier workflow reconciliation without restoring history',async()=>{
 const f=birthFixture();await f.workflow().createEnrollment(birthEntry());
 const input={key:'review-dob',enrollmentKey:'entry-1',clientId:1,reviewDate,assessment:{answers:{SVPPROFDOB:{value:'1984-02-29'}},notApplicable:{OPTIONAL:'Not applicable'},carryForward:['ROWS','TOTAL']}};
 await f.workflow().createInterim(input);assert.equal(f.birthWrites(),2);await f.workflow().createEnrollment(birthEntry());await f.workflow().createInterim(input);assert.equal(f.birthWrites(),2);
 f.history.push({field:'SVPPROFDOB',value:'1985-03-01 00:00:00-07',date:reviewDate});await assert.rejects(f.workflow().createEnrollment(birthEntry()),/saved birth date changed/);assert.equal(f.birthWrites(),2);
});

for(const qualityCode of ['DOBTYPE_DONTKNOW','DOBTYPE_REFUSED'])for(const lostScalarResponse of [false,true])test(`quality-only DOB ${qualityCode}, lost response ${lostScalarResponse}, survives entry and interim retries without a date`,async()=>{
 const f=fixture({lostScalarResponse});
 f.metadata.push(question(9,'SVPPROFDOB','date',{mandatory:true}),question(10,'SVPPROFDOBTYPE','lookup',{options:[option(91,'DOBTYPE_DONTKNOW'),option(92,'DOBTYPE_REFUSED')]}));
 f.api.enrollments.getComplete=async()=>assert.fail('Workflow must not depend on complete-enrollment projection');
 f.api.clients.update=async()=>assert.fail('No DOB or profile update is authorized');
 const i=entryInput();i.assessment.answers.SVPPROFDOBTYPE={option:{code:qualityCode}};i.assessment.notApplicable.SVPPROFDOB='Client did not supply a DOB; preserve it as missing';
 const first=await f.workflow().createEnrollment(i);assert.equal(first.birthDate,undefined);
 const review={key:'quality-review',enrollmentKey:i.key,clientId:1,reviewDate,assessment:{answers:{TOTAL:{value:100}},notApplicable:{OPTIONAL:'Not applicable',SVPPROFDOB:'No DOB was supplied'},carryForward:['ROWS','SVPPROFDOBTYPE']}};
 assert.equal((await f.workflow().createInterim(review)).birthDate,undefined);
 const before=structuredClone(f.counts);assert.equal((await f.workflow().createEnrollment(i)).outcome,'already-present');assert.equal((await f.workflow().createInterim(review)).outcome,'already-present');assert.deepEqual(f.counts,before);
 assert.equal(f.history.filter(h=>h.field==='SVPPROFDOB').length,0);assert.deepEqual(f.history.filter(h=>h.field==='SVPPROFDOBTYPE').map(h=>h.value),[qualityCode==='DOBTYPE_DONTKNOW'?'91':'92']);assert.equal(f.counts.enrollment,1);
 const changed=structuredClone(i);changed.assessment.answers.SVPPROFDOBTYPE={option:{code:qualityCode==='DOBTYPE_DONTKNOW'?'DOBTYPE_REFUSED':'DOBTYPE_DONTKNOW'}};await assert.rejects(f.workflow().createEnrollment(changed),/key.*different|intent/i);assert.deepEqual(f.counts,before);
});
const standardFixture=(faults)=>{
 const f=fixture(faults),input=entryInput();
 f.metadata.push(question(40,'RELATION','lookup',{mandatory:true,options:[option(31,'SELF'),option(32,'CHILD')]}),question(41,'SUBSIDY','lookup',{mandatory:true,options:[option(33,'GPD')]}));
 input.assessment.answers.RELATION={option:{code:'SELF'}};input.assessment.notApplicable.SUBSIDY='Not applicable to this synthetic scenario';
 for(let i=0;i<30;i++){const field=`SYNTHETIC_YES_NO_${i}`;f.metadata.push(question(50+i,field,'yes_no'));input.assessment.answers[field]={value:i%2===0};}
 const labels=[];const writeLabel=(q,o)=>{labels.push(q.fieldName);return o.name;};
 const mobileBodies=[],standardBodies=[],submit=f.api.assessmentsMobile.addAnswer,create=f.api.assessments.create;
 f.api.assessmentsMobile.addAnswer=args=>{mobileBodies.push(args.body);return submit(args);};
 f.api.assessments.create=args=>{standardBodies.push(args.body);return create(args);};
 return {...f,input,labels,mobileBodies,standardBodies,standard:()=>f.workflow({yesNoWrites:'standard',writeLabel})};
};
test('standard yes/no mode writes yes/no with mandatory answers after mobile scalars and verifies one second after the instant',async()=>{
 const f=standardFixture(),result=await f.standard().createEnrollment(f.input);
 assert.equal(result.outcome,'verified');
 assert.ok(f.mobileBodies.flat().every(q=>q.question_type!=='yes_no'));
 assert.equal(f.standardBodies.length,1);const body=f.standardBodies[0];
 assert.equal(body.filter(q=>q.question_type==='yes_no').length,30);
 assert.equal(body.find(q=>q.virt_field_name==='SYNTHETIC_YES_NO_0').answer_value,'Yes');assert.equal(body.find(q=>q.virt_field_name==='SYNTHETIC_YES_NO_1').answer_value,'No');
 assert.equal(body.find(q=>q.virt_field_name==='RELATION').answer_value,'SELF');assert.equal(body.find(q=>q.virt_field_name==='SUBSIDY').answer_value,'');
 assert.ok(body.every(q=>!('expected' in q)&&!('carry' in q)));
 const status=await f.standard().getStatus({clientId:1,key:f.input.key});assert.equal(status.steps.find(s=>s.name==='yesno').state,'verified');
 assert.equal((await f.standard().createEnrollment(f.input)).outcome,'already-present');assert.equal(f.standardBodies.length,1);assert.equal(f.counts.scalars,1);
});
test('standard yes/no lost acknowledgement reconciles; an unknown outcome stays pending without retry or mobile fallback',async()=>{
 const lost=standardFixture({lostStandardResponse:true});assert.equal((await lost.standard().createEnrollment(lost.input)).outcome,'verified');assert.equal(lost.standardBodies.length,1);
 const f=standardFixture({noStandardCommit:true});
 await assert.rejects(f.standard().createEnrollment(f.input),error=>error.step==='yesno'&&error.reason==='uncertain write requires reconciliation'&&/without acknowledgement/.test(error.cause.message));
 await assert.rejects(f.standard().createEnrollment(f.input),error=>error.step==='yesno');
 assert.equal(f.standardBodies.length,1);assert.ok(f.mobileBodies.flat().every(q=>q.question_type!=='yes_no'));
 await assert.rejects(f.workflow().createEnrollment(f.input),/yes\/no write mode changed/);assert.equal(f.mobileBodies.length,1);
});
test('standard yes/no mode cannot reconcile a journal started in mobile mode',async()=>{
 const f=standardFixture(),submit=f.api.assessmentsMobile.addAnswer;
 f.api.assessmentsMobile.addAnswer=args=>submit({...args,body:args.body.filter(q=>q.question_type!=='yes_no')});
 await assert.rejects(f.workflow().createEnrollment(f.input),error=>error.step==='scalars');
 await assert.rejects(f.standard().createEnrollment(f.input),/yes\/no write mode changed/);
 assert.equal(f.standardBodies.length,0);assert.equal(f.counts.enrollment,1);
});
test('standard yes/no mode resolves every mandatory label before any write',async()=>{
 const f=standardFixture();
 assert.throws(()=>f.workflow({yesNoWrites:'standard'}),/writeLabel/);assert.throws(()=>f.workflow({yesNoWrites:'Standard',writeLabel:()=>'x'}),/yesNoWrites/);
 await assert.rejects(f.workflow({yesNoWrites:'standard',writeLabel:()=>undefined}).createEnrollment(f.input),/write label/);
 assert.equal(f.counts.enrollment,0);assert.equal(f.mobileBodies.length+f.standardBodies.length,0);
 f.history.push({field:'SUBSIDY',value:'33',date:'2026-10-01T16:00:00Z'});
 await assert.rejects(f.standard().createEnrollment(f.input),/SUBSIDY has a recorded value/);
 assert.equal(f.counts.enrollment,0);assert.equal(f.mobileBodies.length+f.standardBodies.length,0);
});
test('standard yes/no mode resends a carried mandatory lookup by its verified label',async()=>{
 const f=standardFixture();delete f.input.assessment.answers.RELATION;f.input.assessment.carryForward=['RELATION'];
 f.history.push({field:'RELATION',value:'31',date:'2026-10-01T16:00:00Z'});
 await f.standard().createEnrollment(f.input);
 assert.equal(f.standardBodies[0].find(q=>q.virt_field_name==='RELATION').answer_value,'SELF');assert.ok(f.labels.includes('RELATION'));
});
test('standard yes/no mode rejects non-lookup mandatory questions, including DOB, and missing carried labels before any write',async()=>{
 const f=standardFixture();f.metadata.push(question(42,'SVPPROFDOB','date',{mandatory:true}));f.input.assessment.notApplicable.SVPPROFDOB='Unknown in this synthetic scenario';
 await assert.rejects(f.standard().createEnrollment(f.input),/mandatory lookups only; SVPPROFDOB is date/);
 const g=standardFixture();delete g.input.assessment.answers.RELATION;g.input.assessment.carryForward=['RELATION'];g.history.push({field:'RELATION',value:'31',date:'2026-10-01T16:00:00Z'});
 await assert.rejects(g.workflow({yesNoWrites:'standard',writeLabel:q=>q.fieldName==='RELATION'?undefined:'x'}).createEnrollment(g.input),/carried mandatory answer RELATION has no verified write label/);
 for(const x of [f,g]){assert.equal(x.counts.enrollment,0);assert.equal(x.mobileBodies.length+x.standardBodies.length,0);}
});
test('a verified mobile-mode workflow without yes/no answers stays idempotent in standard mode',async()=>{
 const f=fixture();assert.equal((await f.workflow().createEnrollment(entryInput())).outcome,'verified');
 assert.equal((await f.workflow({yesNoWrites:'standard',writeLabel:(_q,o)=>o.name}).createEnrollment(entryInput())).outcome,'already-present');
 assert.equal(f.counts.scalars,1);assert.equal(f.counts.standard,undefined);
});
test('rows dated after the server clock verify through a read at the assessment date',async()=>{
 const f=fixture(),get=f.api.assessments.get,input=entryInput();input.entryDate='2099-01-01T16:00:00Z';input.assessment.subassessments=[row('a','A','2099-01-01T16:00:00Z')];
 // Live undated reads omit rows dated after the server's current time.
 f.api.assessments.get=async args=>{const result=await get(args);if(!args.query)for(const q of result)if(q.sub_assessment_answer_list)q.sub_assessment_answer_list=q.sub_assessment_answer_list.filter(r=>Date.parse(r.sub_assessment_list[0].date_effective+'Z')<=Date.now());return result;};
 const result=await f.workflow().createEnrollment(input);
 assert.equal(result.outcome,'verified');assert.equal(f.counts.rows,1);
});

function installCatalog(f){
 const catalogReads=[];const walk=qs=>qs.flatMap(q=>[q,...walk(q.children)]);
 const get=f.api.assessments.getDefinition;
 f.api.assessments.getDefinition=async input=>{const d=await get(input);for(const q of walk(d.questions))for(const o of q.options)o.name=o.name.replace(' (HUD)',' ');return d;};
 const readPicklistOptions=async input=>{catalogReads.push(input);const values=[...new Map(walk(f.metadata).flatMap(q=>q.options).map(o=>[o.id,{optionId:o.id,picklistId:o.picklistId,code:o.code,name:o.name}])).values()].filter(o=>input.optionIds.includes(o.optionId));return {source:'gwt-rpc',tenant:f.api.tenant,clientId:input.clientId,count:values.length,values};};
 return {catalogReads,readPicklistOptions};
}
test('automatic catalog labels support fresh standard entry, mandatory carry and no-write retries',async()=>{
 for(const carry of [false,true]){
  const f=standardFixture();f.metadata.find(q=>q.fieldName==='RELATION').options[0].name='SELF (HUD)';
  if(carry){delete f.input.assessment.answers.RELATION;f.input.assessment.carryForward=['RELATION'];f.history.push({field:'RELATION',value:'31',date:'2026-10-01T16:00:00Z'});}
  const c=installCatalog(f),workflow=f.workflow({yesNoWrites:'standard',enrollmentSession:{readPicklistOptions:c.readPicklistOptions}});
  await workflow.createEnrollment(f.input);assert.equal(f.standardBodies[0].find(q=>q.virt_field_name==='RELATION').answer_value,'SELF (HUD)');assert.equal(c.catalogReads.length,1);
  const before=structuredClone(f.counts);assert.equal((await workflow.createEnrollment(f.input)).outcome,'already-present');assert.deepEqual(f.counts,before);
 }
});
test('corrections resolve mandatory and changed lookups from catalog without a supplied callback',async()=>{
 const f=exitFixture(),input=entryInput();f.metadata.push(question(90,'HUD_QUESTION','lookup',{mandatory:true,options:[{...option(91,'YES'),name:'Yes (HUD)'},{...option(92,'NO'),name:'No (HUD)'}]}));input.assessment.answers.HUD_QUESTION={option:{code:'YES'}};
 const c=installCatalog(f);f.enrollmentSession.readPicklistOptions=c.readPicklistOptions;await f.workflow().createEnrollment(input);
 const bodies=[],create=f.api.assessments.create;f.api.assessments.create=args=>{bodies.push(args.body);return create(args);};
 await f.workflow().correctEntry({key:'carry-correction',enrollmentKey:input.key,clientId:1,answers:{TOTAL:{value:12}}});assert.equal(bodies[0].find(q=>q.virt_field_name==='HUD_QUESTION').answer_value,'Yes (HUD)');
 const correction={key:'change-correction',enrollmentKey:input.key,clientId:1,answers:{HUD_QUESTION:{option:{code:'NO'}}}};await f.workflow().correctEntry(correction);assert.equal(bodies[1].find(q=>q.virt_field_name==='HUD_QUESTION').answer_value,'No (HUD)');assert.equal((await f.workflow().correctEntry(correction)).outcome,'already-present');assert.equal(bodies.length,2);
});
test('explicit write-label override avoids catalog access; incomplete automatic catalog blocks all writes',async()=>{
 const f=standardFixture(),enrollmentSession={readPicklistOptions:async()=>{throw Error('Catalog unavailable');}};
 await f.workflow({yesNoWrites:'standard',enrollmentSession,writeLabel:(_q,o)=>o.name}).createEnrollment(f.input);
 for(const mode of ['unavailable','missing','wrong-client','wrong-tenant']){
  const g=standardFixture(),c=installCatalog(g),read=async input=>{if(mode==='unavailable')throw Error('Catalog unavailable');const v=await c.readPicklistOptions(input);if(mode==='missing'){v.values.pop();v.count--;}if(mode==='wrong-client')v.clientId=2;if(mode==='wrong-tenant')v.tenant='other';return v;};
  await assert.rejects(g.workflow({yesNoWrites:'standard',enrollmentSession:{readPicklistOptions:read}}).createEnrollment(g.input),e=>e.committed===false);assert.equal(g.counts.enrollment,0);assert.equal(g.mobileBodies.length+g.standardBodies.length,0);
 }
});
