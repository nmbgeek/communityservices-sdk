import {apiScope} from './connection.mjs';
import {validateBirthDate} from './date-of-birth.mjs';
import {expectedExitDetails} from './exit-details.mjs';
import {createEntryCorrector,correctionFailureDetails} from './entry-correction.mjs';
import {createEntryRowRegistrar} from './entry-row-registration.mjs';
import {createHouseholdEnrollmentDiscovery} from './household-enrollment-discovery.mjs';
import {workflowErrorCode} from './workflow-error-codes.mjs';
import {createHash} from 'node:crypto';
import {readProgramCatalog,flattenQuestions,createCatalogWriteLabelResolver,encodeAnswers,encodeNewSubassessmentRow,toItems,parseRestInstant} from '../dist/esm/index.js';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const entryExitTypes=['HUD','Basic','Standard','RHY','VA','Basic Center Program Entry/Exit','PATH','Quick Call','Transitional Living Program Entry/Exit'];
const canonical=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const fail=(message,options)=>{throw new EnrollmentWorkflowError(message,{committed:false,...options});};
export class EnrollmentWorkflowError extends Error {
 constructor(reason,options){
  super(`Enrollment workflow: ${reason}`,options);this.name='EnrollmentWorkflowError';this.reason=reason;
  if(options?.step!==undefined)this.step=options.step;
  this.code=options?.code??workflowErrorCode(reason);
  this.committed=options?.committed??'unknown';
  if(options?.fields!==undefined)this.fields=[...options.fields];
  const status=options?.status??options?.cause?.status;
  if(Number.isInteger(status)&&status>=100&&status<=599)this.status=status;
 }
}
export class EnrollmentReadError extends EnrollmentWorkflowError {
 constructor({clientId,source,writeAttempted,cause}){
  super(cause instanceof EnrollmentWorkflowError?cause.reason:'enrollment list unavailable',{step:'enrollment-read',cause});this.name='EnrollmentReadError';this.code='ENROLLMENT_READ_FAILED';this.clientId=clientId;this.source=source;this.phase=writeAttempted?'reconciliation':'preflight';this.committed=writeAttempted?'unknown':false;
 }
}
function date(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,19)+'Z').toISOString().slice(0,19)!==value.slice(0,19))fail('timezone-qualified whole-second date required');
 return new Date(value).toISOString();
}
// REST scalar/enrollment timestamps are emitted as UTC without a suffix.
const restDate=parseRestInstant;
function key(value){if(typeof value!=='string'||!value.trim()||value.length>200)fail('stable key required');return value;}
function fields(value,allowed){if(!object(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('unknown or invalid input fields');}
function sameAnswer(expected,actual){
 if(expected.answer_value==='')return actual===null||actual===undefined||actual==='';
 if(expected.question_type==='date')return restDate(actual)===restDate(expected.answer_value);
 if(['money','int','provider'].includes(expected.question_type))return actual!==null&&actual!==''&&Number(actual)===Number(expected.answer_value);
 return String(actual)===expected.answer_value;
}
function questions(response){const rows=toItems(response);if(!Array.isArray(rows)||rows.some(q=>!object(q)||typeof q.virt_field_name!=='string')||new Set(rows.map(q=>q.virt_field_name)).size!==rows.length)fail('ambiguous assessment read');return rows;}
function compile(definition,input,{yesNoWrites,writeLabel}={}){
 fields(input,['answers','subassessments','endDates','notApplicable','carryForward']);
 const answers=input.answers??{},excluded=input.notApplicable??{},carry=input.carryForward??[],rows=input.subassessments??[],ends=input.endDates??[];
 if(!object(answers)||!object(excluded)||!Array.isArray(carry)||!Array.isArray(rows)||!Array.isArray(ends)||new Set(carry).size!==carry.length)fail('invalid assessment plan');
 const encoded=encodeAnswers(definition.questions,answers,{endpoint:'mobile'}),index=new Map(definition.questions.map(q=>[q.fieldName,q]));
 // Mobile writes store empty yes/no values, so the standard endpoint can own them instead.
 const yesNo=yesNoWrites==='standard'?encoded.filter(q=>q.question_type==='yes_no'):[],scalar=encoded.filter(q=>!yesNo.includes(q));
 for(const [field,reason]of Object.entries(excluded))if(!index.has(field)||typeof reason!=='string'||!reason.trim())fail('not-applicable explanation required');
 for(const field of carry)if(typeof field!=='string'||!index.has(field))fail('unknown carry-forward field');
 const keys=new Set(),semantics=new Set();
 const compiledRows=rows.map(row=>{
  fields(row,['key','parentField','answers']);key(row.key);if(keys.has(row.key))fail('duplicate subassessment key');keys.add(row.key);
  const parent=index.get(row.parentField);if(parent?.questionType!=='sub_assessment'||!object(row.answers)||Object.keys(row.answers).length===0)fail('invalid subassessment plan');
  const encoded=encodeNewSubassessmentRow(parent,row.answers,{endpoint:'mobile'}).subAssessments;
  for(const q of encoded)if(q.question_type==='date'&&q.answer_value)date(q.answer_value);
  const normalized=encoded.map(q=>({field:q.virt_field_name,type:q.question_type,value:q.answer_value===''?'':q.question_type==='date'?restDate(q.answer_value):['money','int'].includes(q.question_type)?Number(q.answer_value):q.answer_value})).sort((a,b)=>a.field.localeCompare(b.field));
  const signature=hash({parent:row.parentField,encoded:normalized});if(semantics.has(signature))fail('duplicate semantic subassessment rows');semantics.add(signature);
  return {key:row.key,parentField:row.parentField,questionId:parent.questionId,encoded};
 });
 const endKeys=new Set();const compiledEnds=ends.map(end=>{
  fields(end,['parentField','recordsetId','startDateField','endDateField','endDate']);const parent=index.get(end.parentField);
  if(parent?.questionType!=='sub_assessment'||!positive(end.recordsetId)||end.startDateField===end.endDateField||!parent.children.some(q=>q.fieldName===end.startDateField&&q.questionType==='date')||!parent.children.some(q=>q.fieldName===end.endDateField&&q.questionType==='date')||endKeys.has(end.recordsetId))fail('invalid or duplicate end-date target');endKeys.add(end.recordsetId);
  return {...end,endDate:date(end.endDate)};
 });
 const covered=new Set([...Object.keys(answers),...Object.keys(excluded),...carry,...compiledRows.map(r=>r.parentField),...compiledEnds.map(r=>r.parentField)]);
 for(const q of definition.questions){
  if(['blank','label'].includes(q.questionType))continue;
  if(!covered.has(q.fieldName))fail(`uncovered assessment field ${q.fieldName}`,{code:'ASSESSMENT_FIELD_UNCOVERED',fields:[q.fieldName??String(q.questionId)]});
  if((q.fieldName in excluded||carry.includes(q.fieldName))&&(q.fieldName in answers||compiledRows.some(r=>r.parentField===q.fieldName)||compiledEnds.some(r=>r.parentField===q.fieldName)))fail('conflicting field coverage');
  if(q.fieldName in excluded&&carry.includes(q.fieldName))fail('conflicting field coverage');
 }
 const birthDate=scalar.find(q=>q.virt_field_name==='SVPPROFDOB');
 if(birthDate){if(birthDate.question_type!=='date')fail('DOB question type changed');validateBirthDate(birthDate.answer_value);}
 for(const q of scalar)if(q.virt_field_name!=='SVPPROFDOB'&&q.question_type==='date'&&q.answer_value)date(q.answer_value);
 // The standard endpoint rejects a request that omits any mandatory answer, even one already
 // recorded at that date. Resolve every label now so no write precedes a missing label.
 const mandatory=[];
 if(yesNo.length)for(const q of definition.questions){
  if(!q.mandatory||['blank','label','sub_assessment'].includes(q.questionType)||yesNo.some(y=>y.virt_field_name===q.fieldName))continue;
  // Only mandatory lookups were verified live; this also keeps DOB inside its own helper.
  if(q.questionType!=='lookup')fail(`standard yes/no writes support mandatory lookups only; ${q.fieldName} is ${q.questionType}`,{code:'UNSUPPORTED_MANDATORY_FIELD_TYPE',fields:[q.fieldName??String(q.questionId)]});
  const base={question_id:q.questionId,question_type:q.questionType,virt_field_name:q.fieldName};
  if(q.fieldName in answers){
   const [label]=encodeAnswers(definition.questions,{[q.fieldName]:answers[q.fieldName]},{endpoint:'standalone',writeLabel});
   const [stored]=encodeAnswers(definition.questions,{[q.fieldName]:answers[q.fieldName]},{endpoint:'mobile'});
   if(!label||!stored)fail(`mandatory answer ${q.fieldName} has no standard encoding`,{code:'ANSWER_ENCODING_UNAVAILABLE',fields:[q.fieldName??String(q.questionId)]});
   mandatory.push({...base,answer_value:label.answer_value,expected:stored.answer_value});
  }else if(q.fieldName in excluded)mandatory.push({...base,answer_value:'',expected:''});
  else if(carry.includes(q.fieldName))mandatory.push({...base,carry:true});
 }
 return {scalar:scalar.filter(q=>q.virt_field_name!=='SVPPROFDOB'),yesNo,mandatory,dateOfBirth:birthDate?.answer_value,rows:compiledRows,ends:compiledEnds,carry,excluded};
}
async function enrollments(api,clientId,{enrollmentSession,writeAttempted=false}={}){
 const gwt=typeof enrollmentSession?.listEnrollments==='function';
 try{
 const all=[],ids=new Set();let count;
 for(let page=1;page<=100;page++){
  let result;
  if(gwt){result=await enrollmentSession.listEnrollments({clientId});if(result?.source!=='gwt-rpc'||result.tenant!==api.tenant||result.clientId!==clientId)fail('enrollment list context mismatch');}
  else try{result=await api.enrollments.listForClient({path:{clientId},query:{perPage:100,startPage:page,total_count:true}});}catch(e){if(page===1&&e.status===404)return [];throw e;}
  if(!Number.isSafeInteger(result?.count)||result.count<0||!Array.isArray(result.values)||count!==undefined&&count!==result.count)fail('enrollment count unavailable or changed');count=result.count;
  for(const row of result.values){if(!object(row)||!positive(row.enrollmentId)||row.clientId!==clientId||!positive(row.enrollmentProvider)||typeof row.type!=='string'||!row.type||!Number.isFinite(restDate(row.projectStartDate))||typeof row.isActive!=='boolean'||ids.has(row.enrollmentId)||(gwt||row.projectExitDate!==undefined)&&row.projectExitDate!==null&&!Number.isFinite(restDate(row.projectExitDate)))fail('invalid enrollment list');ids.add(row.enrollmentId);all.push(row);}
  if(all.length===count)return all;if(gwt||all.length>count||!result.values.length)fail('incomplete enrollment list');
 }fail('enrollment list exceeds limit');
 }catch(cause){throw new EnrollmentReadError({clientId,source:gwt?'gwt-rpc':'rest',writeAttempted,cause});}
}

/** Explicit orchestration for an existing client. All writers must share the durable store.
 * No automatic retries of uncertain REST writes. This is not a cross-system transaction. */
export function createEnrollmentWorkflow({api,discovery,helpers,store,enrollmentSession,exitUi,memberEntryDatePort,birthDates,assessmentLocations={},yesNoWrites='mobile',writeLabel}){
 let tenantScope;try{tenantScope=apiScope(api, discovery, helpers, enrollmentSession, exitUi, writeLabel);}catch(cause){throw new EnrollmentWorkflowError(cause instanceof Error?cause.message:'invalid workflow configuration',{code:'WORKFLOW_CONFIGURATION_INVALID',committed:false,cause});}
 const execute=async(operation,action)=>{
  const state={attempted:false};
  try{return await action(state);}catch(cause){
   const error=cause instanceof EnrollmentWorkflowError?cause:new EnrollmentWorkflowError(cause instanceof Error?cause.message:'upstream workflow operation failed',{code:cause?.code==='SESSION_INTERRUPTED'?'SESSION_INTERRUPTED':cause?.kind==='validation'?'WORKFLOW_VALIDATION_FAILED':'WORKFLOW_UPSTREAM_FAILURE',...(Array.isArray(cause?.fields)&&cause.fields.every(f=>typeof f==='string')?{fields:cause.fields}:{}),cause});
   if(cause?.code==='SESSION_INTERRUPTED')error.reauthenticated=cause.reauthenticated;
   error.operation=operation;
   error.committed=state.attempted||cause instanceof EnrollmentReadError&&cause.committed==='unknown'||cause?.code==='ENTRY_CORRECTION_UNCERTAIN'?'unknown':false;
   if(operation==='resolveEntryCorrection')error.originalCommitted='unknown';
   throw error;
  }
 };
 if(typeof discovery?.getProviderAssessments!=='function'||typeof helpers?.createInterimUpdate!=='function'||!store)fail('REST API, discovery, enrollment helpers and durable store required');
 if(!['mobile','standard'].includes(yesNoWrites)||yesNoWrites==='standard'&&(typeof writeLabel!=='function'&&typeof enrollmentSession?.readPicklistOptions!=='function'||typeof api.assessments?.create!=='function'))fail('yesNoWrites must be mobile, or standard with writeLabel and assessments.create');
 if(!object(assessmentLocations))fail('assessment locations must be a map by Entry/Exit type');
 for(const [type,locations]of Object.entries(assessmentLocations)){
  if(!entryExitTypes.includes(type))fail('unsupported Entry/Exit type in assessment locations');
  fields(locations,['entry','interim','exit']);
  if(['entry','interim'].some(phase=>typeof locations[phase]!=='string'||!locations[phase].trim())||Object.values(locations).some(location=>typeof location!=='string'||!location.trim()))fail('entry and interim assessment locations required; exit location must be nonempty when supplied');
 }
 const locationsByType={HUD:{entry:'showHudEntry',interim:'showHudInterim',exit:'showHudExit'},VA:{entry:'showVaEntry',interim:'showVaInterim',exit:'showVaExit'},...structuredClone(assessmentLocations)};
 const discover=async(input,includeExit=false)=>{
  fields(input,['clientId','providerId','type','entryDate']);if(!positive(input.clientId)||!positive(input.providerId)||!entryExitTypes.includes(input.type))fail('client, provider and supported Entry/Exit type required');const at=date(input.entryDate);
  const locations=locationsByType[input.type];if(!locations||includeExit&&!locations.exit)fail(`assessment locations required for ${input.type}${includeExit?' including exit':''}`,{code:'ASSESSMENT_LOCATIONS_REQUIRED'});
  const client=toItems(await api.clients.get({path:{clientId:input.clientId}}));if(client.length!==1||client[0].clientId!==input.clientId||client[0].isActive===false)fail('active client required');
  const catalog=await readProgramCatalog(api);const providers=catalog.providers.filter(p=>p.providerId===input.providerId);if(providers.length!==1)fail('active operational program required');
  const configuration=await discovery.getProviderAssessments({providerId:input.providerId});if(configuration.providerId!==input.providerId)fail('provider discovery mismatch');
  const resolved={};
  for(const phase of ['entry','interim',...(includeExit?['exit']:[])]){
   const matches=configuration.defaults.filter(d=>d.location===locations[phase]);if(matches.length!==1||matches[0].resolution!=='resolved'||!matches[0].assessment?.code)fail('program assessment default unresolved');
   const assessment=matches[0].assessment;const definition=await api.assessments.getDefinition({clientId:input.clientId,assessmentCode:assessment.code,effectiveDate:at,refresh:true});
   if(definition.tenant!==api.tenant||definition.assessmentCode!==assessment.code||definition.unresolvedPicklists.length)fail('assessment metadata incomplete');
   resolved[phase]={assessment,definition};
  }
  let picklistOptions;
  if(writeLabel===undefined&&typeof enrollmentSession?.readPicklistOptions==='function'){
   const optionIds=[...new Set(Object.values(resolved).flatMap(({definition})=>flattenQuestions(definition.questions).filter(({question})=>question.questionType==='lookup').flatMap(({question})=>question.options.map(o=>o.id))))];
   picklistOptions=await enrollmentSession.readPicklistOptions({clientId:input.clientId,optionIds});
   if(picklistOptions?.clientId!==input.clientId)fail('picklist catalog client mismatch',{code:'PICKLIST_CATALOG_CONTEXT_MISMATCH'});
   for(const {definition}of Object.values(resolved))createCatalogWriteLabelResolver(definition,picklistOptions);
  }
  return {provider:providers[0],...resolved,...(picklistOptions?{picklistOptions}:{})};
 };
 const scope=clientId=>JSON.stringify([tenantScope,'enrollment-workflow',clientId]);
 const reservationScope=clientId=>JSON.stringify([tenantScope,'household-workflow-reservation',clientId]);
 const {correctEntry,resolveEntryCorrection}=createEntryCorrector({api,store,enrollmentSession,writeLabel,discover,scope,reservationScope,makeError:(reason,options)=>new EnrollmentWorkflowError(reason,options)});
 const registerEntryRows=createEntryRowRegistrar({api,store,enrollmentSession,discover,scope,reservationScope,makeError:(reason,options)=>new EnrollmentWorkflowError(reason,options)});
 const discoverHouseholdEnrollment=createHouseholdEnrollmentDiscovery({api,enrollmentSession,makeError:(reason,options)=>new EnrollmentWorkflowError(reason,options)});
 const run=async(kind,raw,internal={})=>{
  const operation=internal.operation??{attempted:false};
  const standaloneExit=kind==='exit'&&internal.standaloneExit===true;
  fields(raw,kind==='entry'?['key','clientId','providerId','type','entryDate','assessment']:['key','enrollmentKey','clientId',kind==='exit'?'exitDate':'reviewDate','assessment',...(standaloneExit?['destination','reasonForLeaving','destinationDetails','reasonForLeavingOther']:[])]);
  const input=structuredClone(raw);key(input.key);if(!positive(input.clientId))fail('client ID required');
  if(kind==='entry'){if(!positive(input.providerId)||!entryExitTypes.includes(input.type))fail('program and supported Entry/Exit type required');input.entryDate=date(input.entryDate);}else{key(input.enrollmentKey);if(kind==='addition')input.entryDate=date(input.entryDate);else if(kind==='exit')input.exitDate=date(input.exitDate);else input.reviewDate=date(input.reviewDate);}
  if(!object(input.assessment))fail('assessment plan required');
  if(standaloneExit&&(typeof enrollmentSession?.readEnrollment!=='function'||typeof exitUi?.validateExit!=='function'||typeof exitUi?.saveExit!=='function'))fail('exit UI and authoritative enrollment session required');
  if(standaloneExit&&['destination','reasonForLeaving'].some(field=>typeof input[field]!=='string'||!input[field].trim()))fail('destination and reason for leaving required');
  const exitDetails=standaloneExit?expectedExitDetails(input):null;
  if(standaloneExit&&(exitDetails.destinationDetails||exitDetails.reasonForLeavingOther)&&typeof exitUi.readExitDetails!=='function')fail('authoritative exit details reader required');
  const locked=internal.locked?async(_scope,work)=>work():store.withLock.bind(store);
  return locked(scope(input.clientId),async()=>{
   const reservations=await store.withLock(reservationScope(input.clientId),()=>store.read(reservationScope(input.clientId)));
   if(!Array.isArray(reservations)||reservations.some(r=>r.stage!=='verified'&&r.owner!==internal.owner))fail('unfinished household workflow must be reconciled first');
   const inheritedAttempt=operation.attempted;operation.attempted=true;
   const records=await store.read(scope(input.clientId));if(!Array.isArray(records)||records.some(r=>!object(r)||r.version!==1||!object(r.steps)))fail('invalid workflow journal');
   operation.attempted=inheritedAttempt||records.some(r=>r.key===input.key&&Object.keys(r.steps).length>0);
   if(records.some(r=>r.stage!=='verified'&&!(r.kind==='correction'&&r.stage==='rejected')&&r.key!==input.key))fail('another unfinished workflow must be reconciled first');
   const matches=records.filter(r=>r.key===input.key);if(matches.length>1)fail('duplicate journal keys');let record=matches[0];
   const intentHash=hash({kind,input,...(internal.owner?{household:internal.owner}:{})});if(record&&record.intentHash!==intentHash)fail('key conflicts with previous intent');
   // Changing the yes/no endpoint after an attempt would be an endpoint switch, not reconciliation.
   if(record&&record.stage!=='verified'&&(record.yesNoWrites??'mobile')!==yesNoWrites)fail('yes/no write mode changed since this workflow started');
   const entry=kind!=='entry'?records.find(r=>r.key===input.enrollmentKey&&r.kind==='entry'&&r.stage==='verified'):null;
   if(kind!=='entry'&&!entry)fail('verified enrollment workflow required');
   const context=kind==='entry'?input:kind==='addition'?{...entry.context,entryDate:input.entryDate}:entry.context;
   if(kind!=='entry'&&Date.parse(input.exitDate??input.reviewDate)<Date.parse(context.entryDate))fail('review precedes entry');
   const exitTarget=standaloneExit?{clientId:input.clientId,enrollmentId:entry.enrollmentId}:null;
   const inspectStandaloneExit=async()=>{
    const snapshot=await enrollmentSession.readEnrollment(exitTarget);
    if(snapshot?.source!=='gwt-rpc'||snapshot.tenant!==api.tenant||snapshot.clientId!==input.clientId||snapshot.enrollmentId!==entry.enrollmentId||snapshot.providerId!==context.providerId||snapshot.enrollmentType!==context.type||restDate(snapshot.projectStartDate)!==restDate(context.entryDate))fail('individual enrollment context mismatch');
    if(!Array.isArray(snapshot.members)||snapshot.members.length!==1||snapshot.members[0].clientId!==input.clientId||snapshot.members[0].enrollmentId!==entry.enrollmentId)fail('linked household enrollment requires exitHousehold');
    if(!Array.isArray(snapshot.reviews)||snapshot.reviews.some(r=>!Number.isFinite(restDate(r.reviewDate))||restDate(r.reviewDate)>restDate(input.exitDate)))fail('exit precedes an existing review');
    if(!Array.isArray(snapshot.exits)||snapshot.exits.length!==1)fail('authoritative individual exit read required');
    const exit=snapshot.exits[0];
    if(exit.clientId!==input.clientId||exit.enrollmentId!==entry.enrollmentId||canonical(exit.clientIds)!==canonical([input.clientId])||canonical(exit.enrollmentIds)!==canonical([entry.enrollmentId]))fail('individual exit membership mismatch');
    if(exit.projectExitDate===null){
     if([exit.destination,exit.reasonForLeaving,exit.exitSubgroupId].some(v=>v!==null))fail('incomplete existing exit metadata');
     return {found:false};
    }
    const label=value=>typeof value==='string'?value.replace(/\s*\(HUD\)\s*$/,'').trim():value;
    if(restDate(exit.projectExitDate)!==restDate(input.exitDate)||label(exit.destination)!==label(input.destination)||label(exit.reasonForLeaving)!==label(input.reasonForLeaving)||exit.exitSubgroupId!==null&&(typeof exit.exitSubgroupId!=='string'||!exit.exitSubgroupId))fail('existing exit conflicts with requested exit');
    if(record&&Object.hasOwn(record,'exitSubgroupId')&&record.exitSubgroupId!==exit.exitSubgroupId)fail('exit identity changed');
    if(record?.steps.exit?.state==='verified'&&record.steps.exit.value.exitSubgroupId!==exit.exitSubgroupId)fail('exit identity changed');
    if(typeof exitUi.readExitDetails==='function'&&canonical(await exitUi.readExitDetails(exitTarget))!==canonical(exitDetails))fail('stored exit details conflict with requested exit');
    return {found:true,value:exit};
   };
   const exitInput=standaloneExit?{...exitTarget,clientIds:[input.clientId],exitDate:input.exitDate,destination:input.destination,reasonForLeaving:input.reasonForLeaving,...(input.destinationDetails?{destinationDetails:input.destinationDetails}:{}),...(input.reasonForLeavingOther?{reasonForLeavingOther:input.reasonForLeavingOther}:{})}:null;
   const discovered=await discover({clientId:input.clientId,providerId:context.providerId,type:context.type,entryDate:kind==='entry'?input.entryDate:(input.exitDate??input.reviewDate)},kind==='exit');
   const schemaHash=hash({providerId:discovered.provider.providerId,entry:{assessment:discovered.entry.assessment,questions:discovered.entry.definition.questions},interim:{assessment:discovered.interim.assessment,questions:discovered.interim.definition.questions}});
   if((record&&record.schemaHash!==schemaHash)||(entry&&entry.schemaHash!==schemaHash))fail('program assessment configuration changed');
   const definition=discovered[kind].definition,code=definition.assessmentCode,at=kind==='entry'?input.entryDate:(input.exitDate??input.reviewDate);
   const exitSchemaHash=kind==='exit'?hash({assessment:discovered.exit.assessment,questions:definition.questions}):undefined;
   if(record&&kind==='exit'&&record.exitSchemaHash!==exitSchemaHash)fail('exit assessment configuration changed');
   const operationWriteLabel=writeLabel??(discovered.picklistOptions?createCatalogWriteLabelResolver(definition,discovered.picklistOptions):undefined);
   const plan=compile(definition,input.assessment,{yesNoWrites,writeLabel:operationWriteLabel});
   const carriesBirthDate=plan.carry.includes('SVPPROFDOB'),hasBirthDate=plan.dateOfBirth!==undefined||carriesBirthDate;
   let carriedBirthDate;
   if(hasBirthDate){
    if(!birthDates||['update','read','validate','verify'].some(method=>typeof birthDates[method]!=='function'))fail('DOB helper required for birth-date answers and carry-forward');
    const known=record?.steps.birthDate?.state==='verified'?record.steps.birthDate.value:undefined;
    const dobContext={clientId:input.clientId,assessmentCode:code};
    if(known)carriedBirthDate=await birthDates.verify({...dobContext,dateOfBirth:known.dateOfBirth,effectiveDate:known.effectiveDate,allowLater:true});
    else if(plan.dateOfBirth!==undefined)await birthDates.validate({...dobContext,dateOfBirth:plan.dateOfBirth,effectiveDate:at,allowEntryCorrection:kind==='entry'});
    else{
     carriedBirthDate=await birthDates.read(dobContext);
     if(!carriedBirthDate.dateOfBirth||!carriedBirthDate.effectiveDate||restDate(carriedBirthDate.effectiveDate)>restDate(at))fail('carry-forward birth date is empty or follows assessment date');
     const expected=entry?.steps.birthDate?.value;
     if(expected&&expected.dateOfBirth!==carriedBirthDate.dateOfBirth)fail('carry-forward birth date changed since enrollment');
    }
   }
   // Enrollment head identity is fixed. A different UI/RPC target is not a new head.
   const headQuestion=definition.questions.find(q=>q.fieldName==='HUD_RELATIONTOHOH'),expectedHead=internal.headClientId??input.clientId;
   const checkHeadAnswer=value=>{
    if(!headQuestion)return;
    const self=headQuestion.options.filter(o=>o.code==='RELATIONHOH_SELF');
    if(self.length!==1)fail('head of household assessment option unresolved');
    if(value===null||value===undefined||value==='')fail('invalid enrollment data: head of household relationship is missing or cleared');
    if((String(value)===String(self[0].id))!==(input.clientId===expectedHead))fail('head of household change is a red flag; use a separate retroactive correction for a member with the same first entry date, or exit all enrollments and create a fresh enrollment');
   };
   const proposedHead=plan.scalar.find(q=>q.virt_field_name==='HUD_RELATIONTOHOH');
   if(proposedHead)checkHeadAnswer(proposedHead.answer_value);
   if(plan.ends.length&&(kind==='entry'||plan.ends.some(e=>Date.parse(e.endDate)>=Date.parse(at)||Date.parse(e.endDate)<Date.parse(context.entryDate))))fail('row closure must fall between entry and assessment');
   const read=async()=>questions(await api.assessments.get({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:at}}));
   // An undated read omits rows dated after the server's current time, which can include this
   // assessment's own rows. Read at the later of now and the assessment instant.
   const readCurrent=async()=>questions(await api.assessments.get({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:new Date(Math.max(Date.now(),Date.parse(at))).toISOString().slice(0,19)+'Z'}}));
   // A generic read at exactly the effective instant returns null for yes/no answers saved at
   // that instant; one second later returns them. Only the yes/no step needs this.
   const readSaved=async()=>questions(await api.assessments.get({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:new Date(Date.parse(at)+1000).toISOString()}}));
   const initial=await read();
   if(!record&&plan.scalar.length){
    const saved=await readSaved();
    const existing=plan.scalar.map(q=>({q,row:saved.find(r=>r.virt_field_name===q.virt_field_name)}));
    const complete=existing.every(({q,row})=>row&&sameAnswer(q,row.answer_value)&&restDate(row.date_effective)===restDate(at));
    if(!complete){
     const unavailable=existing.filter(({q,row})=>!row||row.question_type!==q.question_type||row.date_effective!=null&&(!Number.isFinite(restDate(row.date_effective))||restDate(row.date_effective)>restDate(at))||row.date_effective==null&&row.answer_value!=null&&row.answer_value!=='').map(({q})=>q.virt_field_name);
     if(unavailable.length)fail('mobile scalar preflight unavailable',{code:'MOBILE_PREFLIGHT_UNAVAILABLE',fields:unavailable});
     const collisions=existing.filter(({row})=>restDate(row.date_effective)===restDate(at)).map(({q})=>q.virt_field_name);
     if(collisions.length)fail('mobile scalar answer already exists at the effective date',{code:'MOBILE_ANSWER_EXISTS',fields:collisions});
    }
   }
   if(expectedHead===input.clientId&&headQuestion)checkHeadAnswer(proposedHead?.answer_value??initial.find(q=>q.virt_field_name==='HUD_RELATIONTOHOH')?.answer_value);
   for(const field of plan.carry.filter(field=>field!=='SVPPROFDOB')){if(kind==='entry'&&record?.correctedScalars?.[field])continue;const q=initial.find(q=>q.virt_field_name===field);if(!q||(q.question_type==='sub_assessment'?!q.sub_assessment_answer_list?.length:!q.answer_value))fail('carry-forward field is empty');}
   // Resend mandatory answers with the standard yes/no write. A blank write must not hide a recorded value.
   const mandatory=plan.mandatory.map(m=>{
    const corrected=kind==='entry'?record?.correctedScalars?.[m.virt_field_name]:undefined;
    if(corrected)return {...m,expected:corrected.answer_value};
    const recorded=initial.find(q=>q.virt_field_name===m.virt_field_name)?.answer_value;
    if(m.carry){
     const question=definition.questions.find(q=>q.fieldName===m.virt_field_name),options=question.options.filter(o=>String(o.id)===String(recorded));
     const label=options.length===1?operationWriteLabel?.(question,options[0]):undefined;
     if(!label)fail(`carried mandatory answer ${m.virt_field_name} has no verified write label`,{code:'LOOKUP_WRITE_LABEL_UNAVAILABLE',fields:[m.virt_field_name]});
     if(m.virt_field_name==='HUD_RELATIONTOHOH')checkHeadAnswer(recorded);
     return {question_id:m.question_id,question_type:m.question_type,virt_field_name:m.virt_field_name,answer_value:label,expected:String(recorded)};
    }
    if(m.expected===''&&recorded!==null&&recorded!==undefined&&recorded!=='')fail(`not-applicable mandatory field ${m.virt_field_name} has a recorded value; answer it explicitly`,{code:'MANDATORY_CLEAR_CONFLICT',fields:[m.virt_field_name]});
    return m;
   });
   // Validate closure targets before creating enrollment/review or submitting any answers.
   const current=await readCurrent();
   if(kind==='entry'&&record?.correctedScalars){
    const saved=await readSaved();
    for(const q of Object.values(record.correctedScalars)){const actual=saved.find(r=>r.virt_field_name===q.virt_field_name);if(!actual||!sameAnswer(q,actual.answer_value)||q.answer_value!==''&&restDate(actual.date_effective)!==restDate(at))fail('verified entry correction changed');}
   }
   const currentHead=current.find(q=>q.virt_field_name==='HUD_RELATIONTOHOH');
   // A fresh entry may establish a different relationship from a prior enrollment.
   if(kind!=='entry'&&currentHead?.answer_value!==null&&currentHead?.answer_value!==undefined&&currentHead.answer_value!=='')checkHeadAnswer(currentHead.answer_value);
   for(const end of plan.ends){
    const group=current.find(q=>q.virt_field_name===end.parentField),targets=group?.sub_assessment_answer_list?.filter(r=>r.recordset_id===end.recordsetId)??[];
    if(targets.length!==1)fail('end-date target missing');
    const children=targets[0].sub_assessment_list??[],start=children.filter(q=>q.virt_field_name===end.startDateField&&q.question_type==='date'),through=children.filter(q=>q.virt_field_name===end.endDateField&&q.question_type==='date');
    if(start.length!==1||through.length!==1||!Number.isFinite(restDate(start[0].answer_value)))fail('end-date target interval missing');
    if(restDate(end.endDate)<restDate(start[0].answer_value))fail('end date precedes record start');
    if(through[0].answer_value&&restDate(through[0].answer_value)!==restDate(end.endDate))fail('record already has a different end date');
   }
   if(standaloneExit){
    const observed=await inspectStandaloneExit();
    if(!observed.found&&!record?.steps.exit)await exitUi.validateExit(exitInput);
   }
   if(internal.preflight)return {assessmentCode:code,...(internal.pinSchema?{schemaHash}:{}),...(exitSchemaHash?{exitSchemaHash}:{})};
   const wasVerified=record?.stage==='verified';
   if(!record){record={version:1,key:input.key,kind,intentHash,schemaHash,...(exitSchemaHash?{exitSchemaHash}:{}),context:{clientId:input.clientId,providerId:context.providerId,type:context.type,entryDate:context.entryDate},assessmentCode:code,...(yesNoWrites==='standard'?{yesNoWrites}:{}),stage:'pending',steps:{},rows:{},ends:plan.ends};records.push(record);}
   const persist=()=>store.write(scope(input.clientId),structuredClone(records));await persist();
   const step=async(name,inspect,submit)=>{
    let result=await inspect();const previous=record.steps[name];
    if(result.found){record.steps[name]={state:'verified',value:result.value};await persist();return result.value;}
    if(previous)throw new EnrollmentWorkflowError(previous.state==='verified'?'verified step changed':'uncertain write requires reconciliation',{step:name});
    record.steps[name]={state:'attempted'};await persist();
    let writeError;
    operation.attempted=true;
    try{await submit(result);}catch(error){writeError=error;}
    // A write response alone never establishes success or absence. Preserve its
    // diagnostic cause in memory while reconciliation remains authoritative.
    try{result=await inspect();}catch(readError){
     if(writeError===undefined)throw readError;
     throw new EnrollmentWorkflowError(readError instanceof EnrollmentWorkflowError?readError.reason:'uncertain write requires reconciliation',{step:name,cause:new AggregateError([writeError,readError],'Write and reconciliation failed')});
    }
    if(!result.found)throw new EnrollmentWorkflowError('uncertain write requires reconciliation',{step:name,...(writeError===undefined?{}:{cause:writeError})});
    record.steps[name]={state:'verified',value:result.value};await persist();return result.value;
   };
   const findEnrollment=async()=>{
    const knownId=record.enrollmentId??record.steps.enrollment?.value??entry?.enrollmentId;
    if(internal.findEnrollment)return internal.findEnrollment({knownId,context,writeAttempted:Object.keys(record.steps).length>0});
    if(standaloneExit){await inspectStandaloneExit();return {found:true,value:entry.enrollmentId};}
    const list=await enrollments(api,input.clientId,{enrollmentSession,writeAttempted:Object.keys(record.steps).length>0}),matching=list.filter(e=>e.enrollmentProvider===context.providerId&&e.type===context.type&&restDate(e.projectStartDate)===restDate(context.entryDate)&&e.isActive!==false);
    const open=matching.filter(e=>e.projectExitDate==null);if(open.length>1)fail('duplicate matching enrollments');
    const found=knownId?matching.filter(e=>e.enrollmentId===knownId):open;
    if(found.length>1)fail('duplicate matching enrollments');
    const id=record.enrollmentId??record.steps.enrollment?.value??entry?.enrollmentId;if(id&&(!found[0]||found[0].enrollmentId!==id))fail('saved enrollment missing or changed');
    return {found:found.length===1,value:found[0]?.enrollmentId};
   };
   if(kind==='entry')record.enrollmentId=await step('enrollment',findEnrollment,()=>api.enrollments.createEntryAssessment({body:{clientId:input.clientId,providerId:input.providerId,type:input.type,projectStartDate:input.entryDate}}));
   else {const found=await findEnrollment();if(!found.found)fail('saved enrollment missing');record.enrollmentId=entry.enrollmentId;}
   await persist();
   if(kind==='interim'){
    if(!internal.readReview)operation.attempted=true;
    // The GWT helper has its own journal and authoritative reads; it owns uncertain-write reconciliation.
    const review=internal.readReview?await internal.readReview({clientId:input.clientId,enrollmentId:record.enrollmentId}):await helpers.createInterimUpdate({clientId:input.clientId,enrollmentId:record.enrollmentId,clientIds:[input.clientId],reviewDate:at});
    const matches=review.snapshot.reviews.filter(r=>r.type==='Update'&&restDate(r.reviewDate)===restDate(at)&&r.clientIds.includes(input.clientId));if(matches.length!==1||record.reviewId&&record.reviewId!==matches[0].reviewId)fail('interim did not verify');record.reviewId=matches[0].reviewId;await persist();
   }
   if(kind==='exit'){
    const exit=standaloneExit?await step('exit',inspectStandaloneExit,()=>exitUi.saveExit(exitInput)):await internal.readExit({clientId:input.clientId,enrollmentId:record.enrollmentId});
    if(Object.hasOwn(record,'exitSubgroupId')&&record.exitSubgroupId!==exit.exitSubgroupId)fail('exit identity changed');
    record.projectExitDate=exit.projectExitDate;record.exitSubgroupId=exit.exitSubgroupId;await persist();
   }
   for(const end of plan.ends){
    record.endSnapshots??={};
    if(!record.endSnapshots[end.recordsetId]){
     const source=await readCurrent(),rows=source.find(q=>q.virt_field_name===end.parentField)?.sub_assessment_answer_list;
     if(!Array.isArray(rows)||new Set(rows.map(r=>r.recordset_id)).size!==rows.length)fail('ambiguous closure snapshot');
     record.endSnapshots[end.recordsetId]=rows.map(r=>({recordsetId:r.recordset_id,fields:r.sub_assessment_list.filter(q=>!['label','blank'].includes(q.question_type)).map(q=>({virt_field_name:q.virt_field_name,question_type:q.question_type,answer_value:q.answer_value??''}))}));await persist();
    }
    await step('end:'+end.recordsetId,async()=>{
     const source=await readCurrent(),rows=source.find(q=>q.virt_field_name===end.parentField)?.sub_assessment_answer_list??[];
     const found=record.endSnapshots[end.recordsetId].every(before=>{
      const matches=rows.filter(r=>r.recordset_id===before.recordsetId);if(matches.length!==1)return false;
      return before.fields.every(q=>{
       const later=records.flatMap(r=>(r.ends??[]).filter(e=>e.recordsetId===before.recordsetId&&e.endDateField===q.virt_field_name&&r.steps['end:'+e.recordsetId]?.state==='verified'));
       const expected=before.recordsetId===end.recordsetId&&q.virt_field_name===end.endDateField?{...q,answer_value:end.endDate}:later.length?{...q,answer_value:later[0].endDate}:q;
       const fields=matches[0].sub_assessment_list?.filter(c=>c.virt_field_name===q.virt_field_name)??[];
       return fields.length===1&&fields[0].question_type===q.question_type&&sameAnswer(expected,fields[0].answer_value);
      });
     });return {found,value:end.recordsetId};
    },()=>api.subassessments.setEndDate({clientId:input.clientId,assessmentCode:code,effectiveDate:at,parentField:end.parentField,recordsetId:end.recordsetId,endDateField:end.endDateField,endDate:end.endDate}));
   }
   if(plan.scalar.length)await step('scalars',async()=>{
    const source=kind==='entry'&&record.correctedScalars?await readSaved():await read();return {found:plan.scalar.every(original=>{const q=kind==='entry'?record.correctedScalars?.[original.virt_field_name]??original:original,r=source.find(r=>r.virt_field_name===q.virt_field_name);return r&&sameAnswer(q,r.answer_value)&&(q.answer_value===''||restDate(r.date_effective)===restDate(at));}),value:plan.scalar.map(q=>q.virt_field_name)};
   },()=>api.assessmentsMobile.addAnswer({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:at},body:plan.scalar}));
   // Standard writes update existing dated rows and change only the answers sent.
   if(plan.yesNo.length){const body=[...plan.yesNo,...mandatory.map(({expected,...q})=>q)],expected=[...plan.yesNo,...mandatory.map(({expected,...q})=>({...q,answer_value:expected}))];
    await step('yesno',async()=>{
     const source=await readSaved();return {found:expected.every(original=>{const q=kind==='entry'?record.correctedScalars?.[original.virt_field_name]??original:original,r=source.find(r=>r.virt_field_name===q.virt_field_name);return r&&sameAnswer(q,r.answer_value)&&(q.answer_value===''||restDate(r.date_effective)===restDate(at));}),value:plan.yesNo.map(q=>q.virt_field_name)};
    },()=>api.assessments.create({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:at},body}));
   }
   // Group rows into one creation request. Partial success blocks resubmission until all rows reconcile.
   if(plan.rows.length){const rowIds=await step('rows',async()=>{
    const source=await readCurrent(),matched=Object.create(null),missing=[],matchedIds=new Set();
    for(const row of plan.rows){
     const parent=source.find(q=>q.virt_field_name===row.parentField);if(!Array.isArray(parent?.sub_assessment_answer_list))fail('subassessment read missing');
     const known=record.steps.rows?.value?.[row.key];
     const expected=row.encoded.map(original=>{const q=kind==='entry'?record.correctedRows?.[row.parentField]?.[known]?.[original.virt_field_name]??original:original;const overrides=records.flatMap(r=>(r.ends??[]).filter(e=>e.recordsetId===known&&r.steps['end:'+e.recordsetId]?.state==='verified'&&e.endDateField===q.virt_field_name));if(overrides.length>1)fail('multiple end-date overrides');return overrides.length?{...q,answer_value:overrides[0].endDate}:q;});
     const candidates=parent.sub_assessment_answer_list.filter(r=>(!known||r.recordset_id===known)&&expected.every(q=>{const fields=r.sub_assessment_list?.filter(c=>c.virt_field_name===q.virt_field_name)??[];return fields.length===0&&q.answer_value===''&&record.correctedRows?.[row.parentField]?.[known]?.[q.virt_field_name]||fields.length===1&&fields[0].question_type===q.question_type&&sameAnswer(q,fields[0].answer_value);}));
     if(candidates.length>1)fail('duplicate matching subassessment rows');if(candidates.length){if(!positive(candidates[0].recordset_id)||matchedIds.has(candidates[0].recordset_id))fail('invalid or reused subassessment ID');matchedIds.add(candidates[0].recordset_id);matched[row.key]=candidates[0].recordset_id;}else missing.push(row);
    }
    return {found:missing.length===0,value:matched,missing};
   },({missing})=>{
    const grouped=new Map();for(const row of missing){let parent=grouped.get(row.parentField);if(!parent){parent={question_id:row.questionId,question_type:'sub_assessment',virt_field_name:row.parentField,answer_value:'',subAssessmentQuestionAnswers:[]};grouped.set(row.parentField,parent);}parent.subAssessmentQuestionAnswers.push({recordset_id:0,isDeleted:false,subAssessments:row.encoded});}
    return api.assessmentsMobile.addAnswer({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:at},body:[...grouped.values()]});
   });record.rows=rowIds;}
   // DOB owns its own durable attempt journal. Run last so later assessment writes
   // do not invalidate its preservation check during recovery of an unfinished step.
   if(hasBirthDate){
    const dobContext={clientId:input.clientId,assessmentCode:code};
    let result;
    if(record.steps.birthDate?.state==='verified'){
     const known=record.steps.birthDate.value;
     result=await birthDates.verify({...dobContext,dateOfBirth:known.dateOfBirth,effectiveDate:known.effectiveDate,allowLater:true});
    }else if(plan.dateOfBirth!==undefined){
     operation.attempted=true;result=await birthDates.update({...dobContext,key:'enrollment-dob:'+hash({key:input.key,kind,clientId:input.clientId}),dateOfBirth:plan.dateOfBirth,effectiveDate:at,...(kind==='entry'?{entry:{enrollmentId:record.enrollmentId,assessmentName:discovered.entry.assessment.name}}:{})});
    }else result=await birthDates.verify({...dobContext,dateOfBirth:carriedBirthDate.dateOfBirth,effectiveDate:carriedBirthDate.effectiveDate,allowLater:true});
    record.steps.birthDate={state:'verified',value:{clientId:input.clientId,dateOfBirth:result.dateOfBirth,effectiveDate:result.effectiveDate}};await persist();
   }
   record.stage='verified';await persist();
   return {key:input.key,outcome:wasVerified?'already-present':'verified',clientId:input.clientId,enrollmentId:record.enrollmentId,...(record.reviewId?{reviewId:record.reviewId}:{}),...(record.projectExitDate?{projectExitDate:record.projectExitDate,exitSubgroupId:record.exitSubgroupId}:{}),assessmentCode:code,recordsetIds:structuredClone(record.rows),effectiveDate:at,...(record.steps.birthDate?{birthDate:structuredClone(record.steps.birthDate.value)}:{})};
  });
 };
 const householdScope=headClientId=>JSON.stringify([tenantScope,'household-enrollment-workflow',headClientId]);
 const memberKey=(key,clientId)=>'household:'+hash({key,clientId});
 const withClients=(ids,work,index=0)=>index===ids.length?work():store.withLock(scope(ids[index]),()=>withClients(ids,work,index+1));
 const adopt=async(household,raw)=>{
  if(household&&raw&&Object.hasOwn(raw,'headEnrollmentId')){
   fields(raw,['key','headClientId','headEnrollmentId']);key(raw.key);
   const found=await discoverHouseholdEnrollment({headClientId:raw.headClientId,headEnrollmentId:raw.headEnrollmentId});
   raw={key:raw.key,headClientId:found.headClientId,householdId:found.householdId,members:found.members};
  }
  fields(raw,household?['key','householdId','headClientId','members']:['key','clientId','enrollmentId']);
  const input=structuredClone(raw);key(input.key);
  if(typeof enrollmentSession?.readEnrollment!=='function')fail('authoritative enrollment session required for adoption');
  const targets=household?input.members:[{clientId:input.clientId,enrollmentId:input.enrollmentId}];
  if(!Array.isArray(targets)||!targets.length)fail('explicit enrollment targets required');
  for(const target of targets){fields(target,['clientId','enrollmentId']);if(!positive(target.clientId)||!positive(target.enrollmentId))fail('explicit enrollment targets required');}
  targets.sort((a,b)=>a.clientId-b.clientId);const ids=targets.map(t=>t.clientId);
  if(new Set(ids).size!==ids.length||new Set(targets.map(t=>t.enrollmentId)).size!==targets.length)fail('duplicate adoption targets');
  if(household&&(!positive(input.householdId)||!positive(input.headClientId)||!ids.includes(input.headClientId)||typeof api.households?.get!=='function'))fail('household, original head and complete enrollment cohort required');
  const owner=hash({adoption:true,input}),intentHash=hash(input);
  return withClients(ids,async()=>{
   const locked=household?work=>store.withLock(householdScope(input.headClientId),work):work=>work();
   return locked(async()=>{
    const groups=household?await store.read(householdScope(input.headClientId)):[];
    if(!Array.isArray(groups)||groups.some(r=>r.stage!=='verified'&&r.key!==input.key))fail('another unfinished household workflow must be reconciled first');
    const groupMatches=groups.filter(r=>r.key===input.key);if(groupMatches.length>1)fail('duplicate household journal keys');let group=groupMatches[0];
    if(group&&(!group.adopted||group.intentHash!==intentHash))fail('adoption key conflicts with previous intent');
    const journals=new Map(),prior=new Map();
    for(const target of targets){
     const reservations=await store.withLock(reservationScope(target.clientId),()=>store.read(reservationScope(target.clientId)));
     if(!Array.isArray(reservations)||reservations.some(r=>r.stage!=='verified'&&r.owner!==owner))fail('unfinished household workflow must be reconciled first');
     const records=await store.read(scope(target.clientId)),member=household?memberKey(input.key,target.clientId):input.key;
     if(!Array.isArray(records)||records.some(r=>r.version!==1||!object(r.steps)))fail('invalid workflow journal');
     if(records.some(r=>r.stage!=='verified'&&!(r.kind==='correction'&&r.stage==='rejected')&&r.key!==member))fail('another unfinished workflow must be reconciled first');
     if(records.some(r=>r.kind==='entry'&&r.enrollmentId===target.enrollmentId&&r.key!==member))fail('enrollment already journaled; use its existing entry key');
     const matches=records.filter(r=>r.key===member);if(matches.length>1)fail('duplicate journal keys');
     if(matches[0]&&(!matches[0].adopted||matches[0].intentHash!==intentHash))fail('adoption key conflicts with previous intent');
     journals.set(target.clientId,records);prior.set(target.clientId,matches[0]);
    }
    const snapshots=[];
    for(const target of targets){
     const s=await enrollmentSession.readEnrollment(target);
     if(s?.source!=='gwt-rpc'||s.tenant!==api.tenant||s.clientId!==target.clientId||s.enrollmentId!==target.enrollmentId||!positive(s.providerId)||!entryExitTypes.includes(s.enrollmentType)||!Number.isFinite(restDate(s.projectStartDate)))fail('adoption enrollment context mismatch');
     if(!Array.isArray(s.members)||canonical([...s.members].sort((a,b)=>a.clientId-b.clientId))!==canonical(targets))fail(household?'adoption requires the complete linked enrollment cohort':'linked household enrollment requires adoptHouseholdEnrollment');
     const exits=s.exits?.filter(e=>e.clientId===target.clientId&&e.enrollmentId===target.enrollmentId);
     if(exits?.length!==1||exits[0].projectExitDate!==null&&!Number.isFinite(restDate(exits[0].projectExitDate)))fail('authoritative adoption exit date required');
     const start=restDate(s.projectStartDate),end=exits[0].projectExitDate===null?Infinity:restDate(exits[0].projectExitDate);if(end<start)fail('adoption exit precedes entry');
     snapshots.push({target,s,start,end});
    }
    const head=snapshots.find(r=>r.target.clientId===(household?input.headClientId:input.clientId));
    if(snapshots.some(r=>r.s.providerId!==head.s.providerId||r.s.enrollmentType!==head.s.enrollmentType||r.start<head.start||r.end>head.end))fail('invalid enrollment data: adopted members require matching program and head coverage');
    if(household){
     const found=toItems(await api.households.get({path:{householdId:input.householdId}}));
     if(found.length!==1||found[0].householdId!==input.householdId||found[0].isActive===false||!Array.isArray(found[0].clients))fail('active household required for adoption');
     const members=found[0].clients,heads=members.filter(m=>m.headofhouseholdStatus&&m.isActive!==false&&!m.dateLeft);
     if(heads.length!==1||heads[0].clientId!==input.headClientId)fail('adoption household head mismatch');
     for(const r of snapshots){const membersForClient=members.filter(m=>m.clientId===r.target.clientId);if(membersForClient.length!==1||membersForClient[0].isActive===false||membersForClient[0].dateLeft||!Number.isFinite(restDate(membersForClient[0].dateJoined))||restDate(membersForClient[0].dateJoined)>r.start||!Array.isArray(r.s.householdClientIds)||ids.some(id=>!r.s.householdClientIds.includes(id)))fail('adoption household membership mismatch');}
    }
    const prepared=[];
    for(const r of snapshots){
     const context={clientId:r.target.clientId,providerId:r.s.providerId,type:r.s.enrollmentType,entryDate:new Date(r.start).toISOString()};
     const discovered=await discover(context),schemaHash=hash({providerId:discovered.provider.providerId,entry:{assessment:discovered.entry.assessment,questions:discovered.entry.definition.questions},interim:{assessment:discovered.interim.assessment,questions:discovered.interim.definition.questions}});
     const headQuestion=discovered.entry.definition.questions.find(q=>q.fieldName==='HUD_RELATIONTOHOH');
     if(headQuestion){
      const self=headQuestion.options.filter(o=>o.code==='RELATIONHOH_SELF'),answers=questions(await api.assessments.get({path:{clientId:r.target.clientId,assessmentCode:discovered.entry.assessment.code},query:{dateEffective:context.entryDate}}));
      const answer=answers.find(q=>q.virt_field_name==='HUD_RELATIONTOHOH')?.answer_value;
      if(self.length!==1||answer===null||answer===undefined||answer===''||(String(answer)===String(self[0].id))!==(r.target.clientId===head.target.clientId))fail('adoption requires the original enrollment head relationship');
     }
     const existing=prior.get(r.target.clientId);
     if(existing&&(existing.enrollmentId!==r.target.enrollmentId||canonical(existing.context)!==canonical(context)||existing.schemaHash!==schemaHash))fail('adopted enrollment identity or configuration changed');
     prepared.push(existing??{version:1,key:household?memberKey(input.key,r.target.clientId):input.key,kind:'entry',adopted:true,intentHash,schemaHash,context,enrollmentId:r.target.enrollmentId,assessmentCode:discovered.entry.assessment.code,stage:'verified',steps:{enrollment:{state:'verified',value:r.target.enrollmentId}},rows:{},ends:[]});
    }
    const wasVerified=household?group?.stage==='verified':prior.get(input.clientId)?.stage==='verified';
    const results=prepared.map(r=>({key:r.key,outcome:wasVerified?'already-present':'verified',clientId:r.context.clientId,enrollmentId:r.enrollmentId,assessmentCode:r.assessmentCode,effectiveDate:r.context.entryDate,recordsetIds:structuredClone(r.rows)}));
    if(household){
     if(!group){group={version:1,key:input.key,kind:'entry',adopted:true,intentHash,context:{householdId:input.householdId,headClientId:input.headClientId,providerId:head.s.providerId,type:head.s.enrollmentType,entryDate:new Date(head.start).toISOString()},clientIds:ids,stage:'pending',members:{},attached:true};groups.push(group);}
     await store.write(householdScope(input.headClientId),structuredClone(groups));
     for(const clientId of ids)await store.withLock(reservationScope(clientId),()=>store.write(reservationScope(clientId),[{owner,stage:'pending'}]));
    }
    for(const r of prepared){if(!prior.get(r.context.clientId))journals.get(r.context.clientId).push(r);await store.write(scope(r.context.clientId),structuredClone(journals.get(r.context.clientId)));}
    if(household){group.members=Object.fromEntries(results.map(r=>[r.clientId,r]));group.stage='verified';await store.write(householdScope(input.headClientId),structuredClone(groups));for(const clientId of ids)await store.withLock(reservationScope(clientId),()=>store.write(reservationScope(clientId),[{owner,stage:'verified'}]));return {key:input.key,outcome:wasVerified?'already-present':'verified',householdId:input.householdId,headClientId:input.headClientId,members:results};}
    return results[0];
   });
  });
 };
 const householdRun=async(kind,raw,operation={attempted:false})=>{
  if(typeof enrollmentSession?.readEnrollment!=='function'||typeof helpers.addHouseholdMembers!=='function'||typeof api.households?.get!=='function')fail('household API and authoritative enrollment session required');
  fields(raw,kind==='addition'?['key','enrollmentKey','headClientId','entryDate','members']:kind==='entry'?['key','householdId','headClientId','providerId','type','entryDate','members']:['key','enrollmentKey','headClientId',kind==='exit'?'exitDate':'reviewDate','members',...(kind==='exit'?['destination','reasonForLeaving','destinationDetails','reasonForLeavingOther']:[])]);
  const input=structuredClone(raw);key(input.key);
  if(kind==='exit'&&(typeof exitUi?.saveExit!=='function'||typeof exitUi?.validateExit!=='function'||typeof input.destination!=='string'||!input.destination.trim()||typeof input.reasonForLeaving!=='string'||!input.reasonForLeaving.trim()))fail('exit UI, destination and reason for leaving required');
  const details=kind==='exit'?expectedExitDetails(input):null;
  if(kind==='exit'&&(details.destinationDetails||details.reasonForLeavingOther)&&typeof exitUi.readExitDetails!=='function')fail('authoritative exit details reader required');
  if(!positive(input.headClientId)||!Array.isArray(input.members)||input.members.length<(kind==='entry'?2:1))fail('head and household members required');
  for(const member of input.members){fields(member,['clientId','assessment']);if(!positive(member.clientId)||!object(member.assessment))fail('member client and assessment required');}
  input.members.sort((a,b)=>a.clientId-b.clientId);const ids=input.members.map(m=>m.clientId);
  if(new Set(ids).size!==ids.length||kind==='entry'&&!ids.includes(input.headClientId))fail('unique members including head required');
  if(kind==='entry'){if(!positive(input.householdId)||!positive(input.providerId)||!entryExitTypes.includes(input.type))fail('household, program and supported Entry/Exit type required');input.entryDate=date(input.entryDate);}
  else{key(input.enrollmentKey);if(kind==='addition')input.entryDate=date(input.entryDate);else if(kind==='exit')input.exitDate=date(input.exitDate);else input.reviewDate=date(input.reviewDate);}
  // Read the cohort under its journal lock, then acquire all client locks in order.
  // Recheck under both locks so concurrent membership growth cannot escape protection.
  operation.attempted=true;
  const prior=await store.withLock(householdScope(input.headClientId),()=>store.read(householdScope(input.headClientId)));
  if(!Array.isArray(prior))fail('invalid household journal');
  operation.attempted=prior.some(r=>r.key===input.key);
  const lockedIds=[...new Set([input.headClientId,...ids,...prior.flatMap(r=>r.clientIds??[])])].sort((a,b)=>a-b);
  return withClients(lockedIds,()=>store.withLock(householdScope(input.headClientId),async()=>{
   const records=await store.read(householdScope(input.headClientId));
   if(!Array.isArray(records)||records.some(r=>r.version!==1||!['entry','addition','interim','exit'].includes(r.kind)))fail('invalid household journal');
   if(records.some(r=>r.clientIds.some(id=>!lockedIds.includes(id))))fail('household membership changed while acquiring locks; retry');
   if(records.some(r=>r.stage!=='verified'&&r.key!==input.key))fail('another unfinished household workflow must be reconciled first');
   const matches=records.filter(r=>r.key===input.key);if(matches.length>1)fail('duplicate household journal keys');let record=matches[0];
   const intentHash=hash({kind,input}),owner=hash({headClientId:input.headClientId,key:input.key});
   if(record&&record.intentHash!==intentHash)fail('household key conflicts with previous intent');
   const entry=kind!=='entry'?records.find(r=>r.kind==='entry'&&r.key===input.enrollmentKey&&r.stage==='verified'):null;
   if(kind!=='entry'&&!entry)fail('verified household entry required');
   const base=entry??record;
   const catalog={};
   for(const group of [base,...records.filter(r=>r.kind==='addition'&&r.stage==='verified'&&r.enrollmentKey===(entry?.key??input.key))].filter(Boolean)){
    for(const clientId of group.clientIds){if(catalog[clientId])fail('duplicate household member enrollment');catalog[clientId]={...group.members[clientId],entryDate:group.members[clientId]?.effectiveDate??group.context.entryDate,entryKey:group.key};}
   }
   if(kind==='addition'){
    if(typeof memberEntryDatePort?.validateMemberEntryDate!=='function'||typeof memberEntryDatePort?.saveMemberEntryDate!=='function')fail('member entry date port required');
    if(ids.some(id=>catalog[id]&&catalog[id].entryKey!==input.key)||ids.includes(input.headClientId))fail('addition requires new household members');
    if(restDate(input.entryDate)<=restDate(entry.context.entryDate))fail('additional member entry must follow original entry');
   }else if(kind!=='entry'&&ids.some(id=>!catalog[id]))fail('verified household entry with identical members required; unknown selected member');
   const cohortIds=[...new Set([...Object.keys(catalog).map(Number),...ids])].sort((a,b)=>a-b);
   const context=kind==='entry'?{householdId:input.householdId,headClientId:input.headClientId,providerId:input.providerId,type:input.type,entryDate:input.entryDate}:kind==='addition'?{...entry.context,entryDate:input.entryDate}:entry.context;
   if(!['entry','addition'].includes(kind)&&ids.some(id=>restDate(input.exitDate??input.reviewDate)<restDate(catalog[id].entryDate)))fail('review precedes entry');
   const household=toItems(await api.households.get({path:{householdId:context.householdId}}));
   if(household.length!==1||household[0].householdId!==context.householdId||household[0].isActive===false||!Array.isArray(household[0].clients))fail('active household required');
   const people=household[0].clients;
   if(new Set(people.map(p=>p.clientId)).size!==people.length)fail('ambiguous household membership');
   const heads=people.filter(p=>p.headofhouseholdStatus&&p.isActive!==false&&!p.dateLeft);
   if(heads.length===0)fail('invalid enrollment data: household has no active head of household');
   if(heads.length!==1||heads[0].clientId!==input.headClientId)fail('household head mismatch; head changes are a red flag and require separate retroactive correction or a fresh enrollment');
   for(const clientId of ids){const p=people.find(p=>p.clientId===clientId);if(!p||p.isActive===false||p.dateLeft||!Number.isFinite(restDate(p.dateJoined))||restDate(p.dateJoined)>restDate(catalog[clientId]?.entryDate??context.entryDate))fail('member is not active in household at entry');}
   for(const clientId of cohortIds){const reservations=await store.withLock(reservationScope(clientId),()=>store.read(reservationScope(clientId)));if(!Array.isArray(reservations)||reservations.some(r=>r.stage!=='verified'&&r.owner!==owner))fail('unfinished household workflow must be reconciled first');}
   const validateSnapshot=(snapshot,target,{partial=false}={})=>{
    if(snapshot?.source!=='gwt-rpc'||snapshot.tenant!==api.tenant||snapshot.clientId!==target.clientId||snapshot.enrollmentId!==target.enrollmentId||snapshot.providerId!==context.providerId||snapshot.enrollmentType!==context.type||restDate(snapshot.projectStartDate)!==restDate(catalog[target.clientId]?.entryDate??context.entryDate))fail('household enrollment context mismatch');
    const members=snapshot.members;
    if(Array.isArray(members)&&!members.some(m=>m.clientId===input.headClientId))fail('invalid enrollment data: enrollment has no head of household');
    if(!Array.isArray(members)||members.some(m=>!positive(m.clientId)||!positive(m.enrollmentId))||new Set(members.map(m=>m.clientId)).size!==members.length||new Set(members.map(m=>m.enrollmentId)).size!==members.length||!members.some(m=>m.clientId===target.clientId&&m.enrollmentId===target.enrollmentId))fail('invalid household enrollment members');
    const actual=members.map(m=>m.clientId).sort((a,b)=>a-b);
    if(partial?actual.some(id=>!cohortIds.includes(id)):canonical(actual)!==canonical(cohortIds))fail('household enrollment members changed');
    if(!Array.isArray(snapshot.householdClientIds)||cohortIds.some(id=>!snapshot.householdClientIds.includes(id)))fail('household members unavailable');
    for(const m of members){const known=record?.members[m.clientId]?.enrollmentId??catalog[m.clientId]?.enrollmentId;if(known&&known!==m.enrollmentId)fail('household enrollment identity changed');}
    return snapshot;
   };
   const readTarget=async(target,options)=>validateSnapshot(await enrollmentSession.readEnrollment(target),target,options);
   // The original head must cover every member's enrollment interval. A household
   // designation alone is insufficient once that person's program enrollment ends.
   const validateHeadCoverage=async(projected=false)=>{
    const enrollmentId=catalog[input.headClientId]?.enrollmentId??record?.members[input.headClientId]?.enrollmentId;
    if(!enrollmentId){if(kind==='entry')return;fail('invalid enrollment data: enrollment has no head of household');}
    const snapshot=await readTarget({clientId:input.headClientId,enrollmentId},{partial:!record?.attached&&(kind==='entry'||kind==='addition')});
    if(kind!=='entry'&&Object.keys(catalog).some(id=>!snapshot.members.some(m=>m.clientId===Number(id))))fail('household enrollment members changed');
    const intervals=snapshot.members.map(member=>{
     const exits=snapshot.exits?.filter(e=>e.clientId===member.clientId&&e.enrollmentId===member.enrollmentId);
     if(exits?.length!==1||exits[0].projectExitDate!==null&&!Number.isFinite(restDate(exits[0].projectExitDate)))fail('authoritative head of household exit dates required');
     return {clientId:member.clientId,start:restDate(catalog[member.clientId]?.entryDate??context.entryDate),end:exits[0].projectExitDate===null?Infinity:restDate(exits[0].projectExitDate)};
    });
    if(projected&&kind==='exit')for(const member of intervals)if(ids.includes(member.clientId))member.end=restDate(input.exitDate);
    if(projected&&kind==='addition')for(const clientId of ids)if(!intervals.some(m=>m.clientId===clientId))intervals.push({clientId,start:restDate(input.entryDate),end:Infinity});
    const head=intervals.find(m=>m.clientId===input.headClientId);
    if(intervals.some(m=>m.start<head.start||m.end>head.end))fail('invalid enrollment data: member enrollment would exist without an enrolled head of household; the original head must remain enrolled through every member exit; reconcile the data or exit all members and create a fresh enrollment');
   };
   await validateHeadCoverage();
   await validateHeadCoverage(true);
   const toMember=m=>['entry','addition'].includes(kind)?{key:memberKey(input.key,m.clientId),clientId:m.clientId,providerId:context.providerId,type:context.type,entryDate:context.entryDate,assessment:m.assessment}:{key:memberKey(input.key,m.clientId),enrollmentKey:memberKey(catalog[m.clientId].entryKey,m.clientId),clientId:m.clientId,...(kind==='exit'?{exitDate:input.exitDate}:{reviewDate:input.reviewDate}),assessment:m.assessment};
   // Validate every member before any record mutation. The same client locks cover
   // preflight and execution, including overlaps with the single-client workflow.
   const preflight=[];for(const member of input.members)preflight.push(await run(kind==='addition'?'entry':kind,toMember(member),{locked:true,owner,operation,headClientId:input.headClientId,preflight:true,...(kind==='addition'?{pinSchema:true}:{})}));
   if(kind==='addition'&&record?.entrySchemas&&canonical(record.entrySchemas)!==canonical(preflight))fail('additional member assessment configuration changed');
   if(kind==='exit'&&record?.exitSchemas&&canonical(record.exitSchemas)!==canonical(preflight))fail('exit assessment configuration changed');
   const wasVerified=record?.stage==='verified';
   if(!record){record={version:1,key:input.key,kind,intentHash,context,...(input.enrollmentKey?{enrollmentKey:input.enrollmentKey}:{}),clientIds:ids,stage:'pending',members:{},...(kind==='exit'?{exitSchemas:preflight}:kind==='addition'?{entrySchemas:preflight}:{})};records.push(record);}
   const persist=()=>store.write(householdScope(input.headClientId),structuredClone(records));await persist();
   for(const clientId of cohortIds)await store.withLock(reservationScope(clientId),()=>store.write(reservationScope(clientId),[{owner,stage:'pending'}]));
   const writeAttempted=async()=>{
    if(Object.keys(record.members).length>0||record.attachmentAttempted===true)return true;
    // The head's creation can commit before its result reaches the household journal.
    // Its per-client attempt marker remains authoritative on the next household retry.
    for(const clientId of ids){
     const entries=await store.read(scope(clientId));if(!Array.isArray(entries))fail('invalid workflow journal');
     if(entries.some(r=>r.key===memberKey(input.key,clientId)&&r.steps&&Object.keys(r.steps).length>0))return true;
    }
    return false;
   };
   const findMember=clientId=>async({knownId,writeAttempted:memberWriteAttempted=false})=>{
    const expected=record.members[clientId]?.enrollmentId??catalog[clientId]?.enrollmentId??knownId;
    if(expected){if(knownId&&knownId!==expected)fail('household enrollment identity changed');await readTarget({clientId,enrollmentId:expected},{partial:kind==='entry'&&clientId===input.headClientId&&!record.attached});return {found:true,value:expected};}
    if(clientId!==input.headClientId)fail('member enrollment has not been attached');
    const found=(await enrollments(api,clientId,{enrollmentSession,writeAttempted:memberWriteAttempted||await writeAttempted()})).filter(e=>e.enrollmentProvider===context.providerId&&e.type===context.type&&e.isActive&&e.projectExitDate==null&&restDate(e.projectStartDate)===restDate(context.entryDate));
    if(found.length>1)fail('duplicate matching enrollments');
    if(found[0])await readTarget({clientId,enrollmentId:found[0].enrollmentId},{partial:!record.attached});
    return {found:found.length===1,value:found[0]?.enrollmentId};
   };
   const readPreserved=async()=>{
    const result=[];
    for(const clientId of cohortIds.filter(id=>!ids.includes(id))){
     const enrollmentId=catalog[clientId].enrollmentId,snapshot=await readTarget({clientId,enrollmentId},{partial:kind==='addition'&&!record.attached});
     const exits=snapshot.exits?.filter(e=>e.clientId===clientId&&e.enrollmentId===enrollmentId);if(exits?.length!==1)fail('unselected member exit identity missing');
     const exit=exits[0],details=exit.projectExitDate&&typeof exitUi?.readExitDetails==='function'?await exitUi.readExitDetails({clientId,enrollmentId}):null;
     result.push({clientId,enrollmentId,entryDate:snapshot.projectStartDate,exit,details,reviews:snapshot.reviews});
    }return result;
   };
   const preserve=async()=>{
    if(wasVerified)return;
    const observed=await readPreserved();if(record.preserved&&canonical(record.preserved)!==canonical(observed))fail('unselected household member changed');
    if(!record.preserved){record.preserved=observed;await persist();}
   };
   if(kind==='exit'||kind==='addition')await preserve();
   if(kind==='entry'){
    // Before attachment, an independently matching member enrollment is ambiguous.
    // Once any attachment was attempted, only the GWT journal can reconcile it.
    if(!record.attachmentAttempted)for(const clientId of ids.filter(id=>id!==input.headClientId)){
     const existing=await enrollments(api,clientId,{enrollmentSession,writeAttempted:await writeAttempted()});if(existing.some(e=>e.enrollmentProvider===context.providerId&&e.type===context.type&&e.isActive&&e.projectExitDate==null&&restDate(e.projectStartDate)===restDate(context.entryDate)))fail('member already has an independent matching enrollment');
    }
    const head=input.members.find(m=>m.clientId===input.headClientId);
    const result=await run('entry',toMember(head),{locked:true,owner,operation,headClientId:input.headClientId,findEnrollment:findMember(head.clientId)});record.members[head.clientId]=result;await persist();
    // Reject unexpected members before the attachment helper is allowed to write.
    await readTarget({clientId:head.clientId,enrollmentId:result.enrollmentId},{partial:!record.attached});
    record.attachmentAttempted=true;await persist();
    operation.attempted=true;const attached=await helpers.addHouseholdMembers({clientId:head.clientId,enrollmentId:result.enrollmentId,memberClientIds:ids.filter(id=>id!==head.clientId)});
    const snapshot=validateSnapshot(attached.snapshot,{clientId:head.clientId,enrollmentId:result.enrollmentId});
    for(const m of snapshot.members)record.members[m.clientId]??={clientId:m.clientId,enrollmentId:m.enrollmentId};record.attached=true;await persist();
    for(const member of input.members.filter(m=>m.clientId!==head.clientId)){record.members[member.clientId]=await run('entry',toMember(member),{locked:true,owner,operation,headClientId:input.headClientId,findEnrollment:findMember(member.clientId)});await persist();}
   }else if(kind==='addition'){
    if(!record.anchor){
     for(const clientId of Object.keys(catalog).map(Number).sort((a,b)=>a-b)){
      const enrollmentId=catalog[clientId].enrollmentId,snapshot=await readTarget({clientId,enrollmentId},{partial:true});
      const exit=snapshot.exits?.find(e=>e.clientId===clientId&&e.enrollmentId===enrollmentId);
      if(exit?.projectExitDate===null&&restDate(snapshot.projectStartDate)<=restDate(input.entryDate)){record.anchor={clientId,enrollmentId};break;}
     }
     if(!record.anchor)fail('open household enrollment required to add a member');await persist();
    }
    if(!record.attachmentAttempted)for(const clientId of ids){
     const existing=await enrollments(api,clientId,{enrollmentSession,writeAttempted:await writeAttempted()});if(existing.some(e=>e.enrollmentProvider===context.providerId&&e.type===context.type&&e.isActive&&e.projectExitDate==null))fail('additional member already has an independent enrollment');
    }
    record.attachmentAttempted=true;await persist();
    operation.attempted=true;const attached=await helpers.addHouseholdMembers({...record.anchor,memberClientIds:ids});
    validateSnapshot(attached.snapshot,record.anchor);
    for(const clientId of ids){const found=attached.snapshot.members.find(m=>m.clientId===clientId);if(record.members[clientId]?.enrollmentId&&record.members[clientId].enrollmentId!==found.enrollmentId)fail('added enrollment identity changed');record.members[clientId]??={clientId,enrollmentId:found.enrollmentId};}
    record.attached=true;await persist();await preserve();
    record.entryDates??={};record.entryDateInputs??={};
    for(const clientId of ids){
     const target={clientId,enrollmentId:record.members[clientId].enrollmentId},snapshot=await enrollmentSession.readEnrollment(target);
     if(restDate(snapshot.projectStartDate)!==restDate(input.entryDate)){
      if(record.entryDates[clientId])fail('uncertain member entry date requires reconciliation');
      const cohort=[];
      for(const id of cohortIds){
       const enrollmentId=catalog[id]?.enrollmentId??record.members[id].enrollmentId,current=await enrollmentSession.readEnrollment({clientId:id,enrollmentId});
       const matching=current.exits?.filter(e=>e.clientId===id&&e.enrollmentId===enrollmentId);if(matching?.length!==1)fail('member exit identity missing');
       cohort.push({clientId:id,enrollmentId,entryDate:current.projectStartDate,exit:matching[0]});
      }
      const change={...target,providerId:context.providerId,type:context.type,entryDate:input.entryDate,cohort};
      await memberEntryDatePort.validateMemberEntryDate(change);
      record.entryDates[clientId]='attempted';record.entryDateInputs[clientId]=change;await persist();
      operation.attempted=true;try{await memberEntryDatePort.saveMemberEntryDate(change);}catch{/* Resolve only through readback; never replay the date update. */}
     }
     if(record.entryDates[clientId]==='attempted'&&record.entryDateInputs[clientId])await memberEntryDatePort.validateMemberEntryDate(record.entryDateInputs[clientId]);
     const fresh=await readTarget(target);if(!wasVerified&&fresh.exits?.filter(e=>e.clientId===clientId&&e.enrollmentId===target.enrollmentId&&e.projectExitDate===null).length!==1)fail('new member must remain enrolled');
     await preserve();record.entryDates[clientId]='verified';await persist();
    }
    for(const member of input.members){record.members[member.clientId]=await run('entry',toMember(member),{locked:true,owner,operation,headClientId:input.headClientId,findEnrollment:findMember(member.clientId)});await persist();}
   }else if(kind==='interim'){
    // Verify all linked enrollments before making the single household review call.
    const existingReviews=[];
    for(const clientId of ids){
     const snapshot=await readTarget({clientId,enrollmentId:catalog[clientId].enrollmentId});
     if(!Array.isArray(snapshot.reviews))fail('household reviews unavailable');
     if(snapshot.exits?.some(e=>e.clientId===clientId&&e.projectExitDate&&restDate(e.projectExitDate)<restDate(input.reviewDate)))fail('review follows project exit');
     const matching=snapshot.reviews.filter(r=>r.type==='Update'&&restDate(r.reviewDate)===restDate(input.reviewDate));
     if(matching.length>1||matching.some(r=>!positive(r.reviewId)||!Array.isArray(r.clientIds)||canonical([...r.clientIds].sort((a,b)=>a-b))!==canonical(ids)))fail('existing household review conflict');
     existingReviews.push(matching[0]);
    }
    if(existingReviews.some(Boolean)&&existingReviews.some(r=>!r))fail('partial household review requires reconciliation');
    if(existingReviews[0]&&new Set(existingReviews.map(r=>r.reviewId)).size!==ids.length)fail('duplicate household review IDs');
    const target={clientId:ids[0],enrollmentId:catalog[ids[0]].enrollmentId};
    operation.attempted=true;const review=await helpers.createInterimUpdate({...target,clientIds:ids,reviewDate:input.reviewDate});validateSnapshot(review.snapshot,target);
    const readReview=async target=>{
     const snapshot=await readTarget(target),reviews=snapshot.reviews.filter(r=>r.type==='Update'&&restDate(r.reviewDate)===restDate(input.reviewDate));
     if(reviews.length!==1||!positive(reviews[0].reviewId)||canonical([...reviews[0].clientIds].sort((a,b)=>a-b))!==canonical(ids))fail('household review membership mismatch');
     const known=record.members[target.clientId]?.reviewId;if(known&&known!==reviews[0].reviewId)fail('household review identity changed');
     return {snapshot};
    };
    // Pin every member's distinct review ID before writing any member's answers.
    for(const clientId of ids){const enrollmentId=catalog[clientId].enrollmentId,{snapshot}=await readReview({clientId,enrollmentId});record.members[clientId]??={clientId,enrollmentId};record.members[clientId].reviewId=snapshot.reviews.find(r=>r.type==='Update'&&restDate(r.reviewDate)===restDate(input.reviewDate)).reviewId;await persist();}
    if(new Set(ids.map(id=>record.members[id].reviewId)).size!==ids.length)fail('duplicate household review IDs');
    for(const member of input.members){record.members[member.clientId]=await run('interim',toMember(member),{locked:true,owner,operation,headClientId:input.headClientId,findEnrollment:findMember(member.clientId),readReview});await persist();}
   }else if(kind==='exit'){
    const target={clientId:ids[0],enrollmentId:catalog[ids[0]].enrollmentId};
    const normalizeLabel=value=>typeof value==='string'?value.replace(/\s*\(HUD\)\s*$/,'').trim():value;
    const inspect=async()=>{
     const exits=[];
     for(const clientId of ids){
      const enrollmentId=catalog[clientId].enrollmentId,snapshot=await readTarget({clientId,enrollmentId});
      if(!Array.isArray(snapshot.reviews)||snapshot.reviews.some(r=>!Number.isFinite(restDate(r.reviewDate))||restDate(r.reviewDate)>restDate(input.exitDate)))fail('exit precedes an existing review');
      if(!Array.isArray(snapshot.exits))fail('authoritative exit read required');
      const matches=snapshot.exits.filter(e=>e.clientId===clientId&&e.enrollmentId===enrollmentId);if(matches.length!==1)fail('exit identity missing');
      const exit=matches[0];
      if(exit.projectExitDate!==null){
       if(restDate(exit.projectExitDate)!==restDate(input.exitDate)||normalizeLabel(exit.destination)!==normalizeLabel(input.destination)||normalizeLabel(exit.reasonForLeaving)!==normalizeLabel(input.reasonForLeaving)||exit.exitSubgroupId===null||exit.exitSubgroupId===undefined)fail('existing exit conflicts with requested exit');
       if(typeof exitUi.readExitDetails==='function'&&canonical(await exitUi.readExitDetails({clientId,enrollmentId}))!==canonical(details))fail('stored exit details conflict with requested exit');
       if(!Array.isArray(exit.clientIds)||!Array.isArray(exit.enrollmentIds)||canonical([...exit.clientIds].sort((a,b)=>a-b))!==canonical(ids)||canonical([...exit.enrollmentIds].sort((a,b)=>a-b))!==canonical(ids.map(id=>catalog[id].enrollmentId).sort((a,b)=>a-b)))fail('exit subgroup membership mismatch');
       if(record.exitSubgroupId!==undefined&&record.exitSubgroupId!==exit.exitSubgroupId)fail('exit subgroup identity changed');
      }else if([exit.destination,exit.reasonForLeaving,exit.exitSubgroupId].some(v=>v!==null))fail('incomplete existing exit metadata');
      exits.push(exit);
     }
     const saved=exits.filter(e=>e.projectExitDate!==null);
     if(saved.length&&new Set(saved.map(e=>e.exitSubgroupId)).size!==1)fail('household exits are not linked');
     return {found:saved.length===ids.length,partial:saved.length>0,exits};
    };
    let observed=await inspect();
    if(!observed.found){
     if(record.exitStep)fail(record.exitStep==='verified'?'verified exit missing':'uncertain household exit requires reconciliation');
     if(observed.partial)fail('partial existing household exit requires reconciliation');
     const exitInput={...target,clientIds:ids,exitDate:input.exitDate,destination:input.destination,reasonForLeaving:input.reasonForLeaving,...(input.destinationDetails?{destinationDetails:input.destinationDetails}:{}),...(input.reasonForLeavingOther?{reasonForLeavingOther:input.reasonForLeavingOther}:{})};
     await exitUi.validateExit(exitInput);
     record.exitStep='attempted';await persist();
     operation.attempted=true;try{await exitUi.saveExit(exitInput);}catch{/* Only authoritative readback establishes success. Never replay an uncertain save. */}
     observed=await inspect();if(!observed.found)fail('uncertain household exit requires reconciliation');
    }
    await validateHeadCoverage();await preserve();
    record.exitStep='verified';record.exitSubgroupId=observed.exits[0].exitSubgroupId;await persist();
    const readExit=async target=>{
     const result=await inspect();if(!result.found)fail('verified exit missing');return result.exits.find(e=>e.clientId===target.clientId&&e.enrollmentId===target.enrollmentId);
    };
    for(const member of input.members){record.members[member.clientId]=await run('exit',toMember(member),{locked:true,owner,operation,headClientId:input.headClientId,findEnrollment:findMember(member.clientId),readExit});await persist();}
   }
   if(kind==='exit'||kind==='addition')await preserve();
   await validateHeadCoverage();
   record.stage='verified';await persist();for(const clientId of cohortIds)await store.withLock(reservationScope(clientId),()=>store.write(reservationScope(clientId),[{owner,stage:'verified'}]));
   return {key:input.key,outcome:wasVerified?'already-present':'verified',householdId:context.householdId,headClientId:input.headClientId,members:ids.map(id=>structuredClone(record.members[id]))};
  }));
 };
 return {
  correctEntry:input=>execute('correctEntry',operation=>correctEntry(input,operation)),
  registerEntryRows:input=>execute('registerEntryRows',()=>registerEntryRows(input)),
  discoverHouseholdEnrollment:input=>execute('discoverHouseholdEnrollment',()=>discoverHouseholdEnrollment(input)),
  resolveEntryCorrection:input=>execute('resolveEntryCorrection',()=>resolveEntryCorrection(input)),
  adoptEnrollment:input=>execute('adoptEnrollment',()=>adopt(false,input)),adoptHouseholdEnrollment:input=>execute('adoptHouseholdEnrollment',()=>adopt(true,input)),
  addHouseholdMembers:input=>execute('addHouseholdMembers',operation=>householdRun('addition',input,operation)),
  createHouseholdEnrollment:input=>execute('createHouseholdEnrollment',operation=>householdRun('entry',input,operation)),createHouseholdInterim:input=>execute('createHouseholdInterim',operation=>householdRun('interim',input,operation)),exitHousehold:input=>execute('exitHousehold',operation=>householdRun('exit',input,operation)),
  discoverExit:input=>execute('discoverExit',()=>discover(input,true)),
  async getHouseholdStatus(input){
   return execute('getHouseholdStatus',async()=>{
   fields(input,['headClientId','key']);if(!positive(input.headClientId))fail('head client ID required');key(input.key);
   return store.withLock(householdScope(input.headClientId),async()=>{
    const records=await store.read(householdScope(input.headClientId));if(!Array.isArray(records))fail('invalid household journal');
    const matches=records.filter(r=>r.key===input.key);if(matches.length>1)fail('duplicate household journal keys');const record=matches[0];if(!record)return null;
    if(record.version!==1||!object(record.members))fail('invalid household journal');
    return {key:record.key,kind:record.kind,stage:record.stage,householdId:record.context.householdId,headClientId:input.headClientId,members:record.clientIds.map(clientId=>({clientId,key:memberKey(input.key,clientId),...structuredClone(record.members[clientId]??{})}))};
   });
   });
  },
  discover:input=>execute('discover',()=>discover(input)),createEnrollment:input=>execute('createEnrollment',operation=>run('entry',input,{operation})),createInterim:input=>execute('createInterim',operation=>run('interim',input,{operation})),exitEnrollment:input=>execute('exitEnrollment',operation=>run('exit',input,{standaloneExit:true,operation})),
  async getStatus(input){
   return execute('getStatus',async()=>{
   fields(input,['clientId','key']);if(!positive(input.clientId))fail('client ID required');key(input.key);
   return store.withLock(scope(input.clientId),async()=>{
    const records=await store.read(scope(input.clientId));if(!Array.isArray(records))fail('invalid workflow journal');
    const matches=records.filter(r=>r.key===input.key);if(matches.length>1)fail('duplicate journal keys');const r=matches[0];if(!r)return null;
    if(r.version!==1||!object(r.steps))fail('invalid workflow journal');
    return {key:r.key,kind:r.kind,stage:r.stage,assessmentCode:r.assessmentCode,...(r.enrollmentId?{enrollmentId:r.enrollmentId}:{}),...(r.reviewId?{reviewId:r.reviewId}:{}),...(r.projectExitDate?{projectExitDate:r.projectExitDate,exitSubgroupId:r.exitSubgroupId}:{}),...(r.resolution?{resolution:structuredClone(r.resolution)}:{}),recordsetIds:structuredClone(r.rows),steps:Object.entries(r.steps).map(([name,step])=>({name,state:step.state,...(step.failure?{failure:correctionFailureDetails(step.failure)}:{})}))};
   });
   });
  },
 };
}
