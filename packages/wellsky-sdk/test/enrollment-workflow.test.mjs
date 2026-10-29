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
    if(q.questionType==='sub_assessment')return {virt_field_name:q.fieldName,question_type:q.questionType,sub_assessment_answer_list:structuredClone(rows)};
    const found=history.filter(h=>h.field===q.fieldName&&(!at||Date.parse(h.date)<=Date.parse(at))).at(-1);
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
    },
    assessmentsMobile:{async addAnswer({body,query}){
      const isRows=body.some(q=>q.question_type==='sub_assessment');counts[isRows?'rows':'scalars']++;
      if(isRows&&faults.noRowsCommit)throw Error('Rows failed without acknowledgement');
      for(const q of body){
        if(q.question_type==='sub_assessment')for(const r of q.subAssessmentQuestionAnswers){rows.push({recordset_id:nextRow++,sub_assessment_list:r.subAssessments.map(c=>({...c,answer_value:c.answer_value||null,date_effective:query.dateEffective.replace(/Z$/,'')}))});if(faults.partialRows)throw Error('Only first row committed');}
        else history.push({field:q.virt_field_name,value:q.answer_value,date:query.dateEffective});
      }
      if(isRows&&faults.lostRowsResponse||!isRows&&faults.lostScalarResponse)throw Error('Response lost after commit');
      return {success:true};
    }},
    subassessments:{async setEndDate({recordsetId,endDateField,endDate}){counts.endDates++;const record=rows.find(r=>r.recordset_id===recordsetId),cell=record?.sub_assessment_list.find(q=>q.virt_field_name===endDateField);assert.ok(cell);cell.answer_value=endDate;if(faults.lostEndResponse)throw Error('End response lost');return {status:'verified'};}},
  };
  const discovery={async getProviderAssessments({providerId}){return {providerId,defaults:['entry','interim'].map((phase,index)=>({location:index?'showHudInterim':'showHudEntry',resolution:'resolved',assessment:{assessmentId:index+1,code:phase.toUpperCase(),name:phase,assignedToAssessmentTab:true}}))};}};
  const helpers={async createInterimUpdate(input){if(!reviews.some(r=>r.reviewDate===input.reviewDate)){counts.review++;reviews.push({reviewId:60,type:'Update',reviewDate:input.reviewDate,clientIds:[input.clientId]});}return {outcome:'reconciled',snapshot:{reviews:structuredClone(reviews)}};}};
  return {api,store,discovery,helpers,entries,reviews,rows,history,journal,counts,metadata,workflow:()=>createEnrollmentWorkflow({api,store,discovery,helpers})};
}

test('entry discovers configured instruments and reuses all writes across helper replacement',async()=>{
  const f=fixture(),first=await f.workflow().createEnrollment(entryInput());
  assert.equal(first.enrollmentId,50);assert.equal(first.assessmentCode,'ENTRY');assert.deepEqual(Object.keys(first.recordsetIds),['a','b']);
  const second=await f.workflow().createEnrollment(entryInput());assert.equal(second.outcome,'already-present');assert.deepEqual(second.recordsetIds,first.recordsetIds);
  assert.deepEqual(f.counts,{enrollment:1,scalars:1,rows:1,endDates:0,review:0});
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
