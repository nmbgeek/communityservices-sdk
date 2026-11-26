import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {toItems} from '../dist/esm/index.js';

const coreKeys=['firstName','middleName','lastName','suffix','search_alias','socSecNo','nameDataQuality','ssnDataQuality','veteranStatus'];
const protectedKeys=[...coreKeys,'svpprofdobtype','svpprofgender','hud_raceethnicity','hud_raceethnicitydetail','phone','email'];
const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
const pick=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]??'']));
const fail=message=>{throw Error(`Date of birth: ${message}`);};
export function validateBirthDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('valid YYYY-MM-DD calendar date required');
 return value;
}
const instant=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,19)+'Z').toISOString().slice(0,19)!==value.slice(0,19))fail('timezone-qualified whole-second effective date required');
 return new Date(value).toISOString();
};
const storedDate=value=>value==null||value===''?null:validateBirthDate(value.replaceAll('/','-'));
const answerDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}-07$/.test(value))fail('unexpected DOB answer format or timezone');
 return validateBirthDate(value.slice(0,10));
};
const effective=value=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value))fail('unexpected answer effective date');return instant(value+'Z');};

const historyError=(code,message,{cause,dobHistoryReason}={})=>Object.assign(new Error('Date of birth: '+message,{cause}),{
 code,nextAction:'staff-review',step:'birth-date',fields:['SVPPROFDOB'],
 ...(cause?.status?{status:cause.status}:{}),...(dobHistoryReason?{dobHistoryReason}:{}),
});
const conflict=message=>historyError('DOB_HISTORY_CONFLICT',message);
const unavailable=cause=>historyError('DOB_HISTORY_EVIDENCE_UNAVAILABLE','DOB evidence unavailable',{cause});
const blank=value=>value===null||value==='';

/** Calendar-date writer. New effective timestamps use REST;
 * collisions use the existing entry assessment UI without moving the timestamp. */
export function createDateOfBirth({api,ui,store}){
 const tenantScope=apiScope(api, ui);
 if(!ui?.read||!ui?.correctAtEntry||!ui?.validateRestDate||!store?.withLock||!store?.read||!store?.write)fail('REST API, DOB UI and durable store required');
 const readEvidence=async input=>{
  const rows=toItems(await api.clients.get({path:{clientId:input.clientId}}));
  if(rows.length!==1||rows[0].clientId!==input.clientId||rows[0].isActive===false)fail('active client readback unavailable');
  const client=rows[0],answers=toItems(await api.assessmentsMobile.getAnswers({path:{clientId:input.clientId,assessmentCode:input.assessmentCode}}));
  const dob=answers.filter(q=>q.virt_field_name==='SVPPROFDOB');
  if(dob.length!==1||dob[0].question_type!=='date')fail('assessment must expose one DOB date question');
  const row=dob[0];
  if(row.client_id!=null&&row.client_id!==input.clientId)throw unavailable();
  const dateOfBirth=storedDate(client.svpprofdob),hasValue=row.answer_value!==null&&row.answer_value!==undefined&&row.answer_value!=='',hasAnswer=row.date_effective!==null&&row.date_effective!==undefined&&row.date_effective!=='';
  // WellSky's mobile projection omits the value for UI-created date answers.
  // Require matching current client + fresh UI values; use the answer only for its effective date.
  if(!hasAnswer&&(hasValue||dateOfBirth!==null))throw unavailable();
  if(hasValue&&answerDate(row.answer_value)!==dateOfBirth)throw conflict('client and assessment DOB disagree');
  const uiDate=await ui.read(input.clientId);
  if(uiDate!==dateOfBirth)throw conflict('client and UI DOB disagree');
  // Values and effective dates of every other exposed answer must survive the write.
  const protectedAnswers=answers.filter(q=>q.virt_field_name!=='SVPPROFDOB').map(q=>({field:q.virt_field_name,value:q.answer_value??null,text:q.answer_value_text??null,effective:q.date_effective??null,rows:q.sub_assessment_answer_list??null})).sort((a,b)=>String(a.field).localeCompare(String(b.field)));
  return {client,dateOfBirth,mobileValue:hasValue,questionId:row.question_id,effectiveDate:hasAnswer?effective(row.date_effective):null,protectedHash:hash({client:pick(client,protectedKeys),answers:protectedAnswers})};
 };
 const read=async input=>{
  try{return await readEvidence(input);}catch(cause){
   if(cause?.nextAction==='staff-review'||cause?.code==='SESSION_INTERRUPTED')throw cause;
   throw unavailable(cause);
  }
 };
 // Only read history. Neither the profile PUT nor the entry form has proved it can insert
 // a backdated revision without replacing a later one.
 const checkHistory=async(input,current,{expectedLater,expectedHistorical,allowEarlier=false}={})=>{
  if(current.dateOfBirth!==input.dateOfBirth)throw conflict('historical correction conflicts with current DOB');
  if(!current.effectiveDate||current.effectiveDate<=input.effectiveDate)throw unavailable();
  if(expectedLater&&current.effectiveDate!==expectedLater)throw conflict('later DOB revision changed');
  let row,historicalDate,historicalAt;
  try{
   const result=await api.assessments.get({path:{clientId:input.clientId,assessmentCode:input.assessmentCode},query:{dateEffective:input.effectiveDate}});
   const items=toItems(result);
   if(result?.count!==undefined&&result.count!==items.length)throw unavailable();
   const rows=items.filter(q=>q.virt_field_name==='SVPPROFDOB');
   if(rows.length!==1||rows[0].question_type!=='date')throw unavailable();
   row=rows[0];
   if((row.client_id!=null&&row.client_id!==input.clientId)||
      (current.questionId!=null&&row.question_id!==current.questionId))throw unavailable();
   if(!blank(row.answer_value)){
    historicalDate=answerDate(row.answer_value);
    historicalAt=effective(row.date_effective);
    if(historicalAt>input.effectiveDate)throw unavailable();
   }
  }catch(cause){if(cause?.nextAction||cause?.code==='SESSION_INTERRUPTED')throw cause;throw unavailable(cause);}
  if(!historicalDate){
   if(!blank(row.date_effective)||
      [row.answer_value_text,row.answer_value_code].some(value=>value!==undefined&&!blank(value)))throw unavailable();
   throw historyError('DOB_HISTORICAL_BACKFILL_UNSUPPORTED','historical correction requires staff to backfill the unanswered DOB',{
    dobHistoryReason:'blank-at-effective-date',
   });
  }
  if(historicalDate!==input.dateOfBirth)throw conflict('dated and current DOB disagree');
  if(expectedHistorical&&historicalAt!==expectedHistorical)throw conflict('historical DOB revision changed');
  // The mobile projection can omit UI-created values. For this broader path require
  // both reads to agree on the question ID in addition to the profile and fresh UI DOB.
  if((!current.mobileValue||historicalAt!==input.effectiveDate)&&
     (!Number.isSafeInteger(current.questionId)||current.questionId<1||row.question_id!==current.questionId))throw unavailable();
  if(historicalAt!==input.effectiveDate&&!allowEarlier){
   throw historyError('DOB_HISTORICAL_BACKFILL_UNSUPPORTED','historical correction requires staff to verify the requested effective instant',{
    dobHistoryReason:'exact-instant-required',
   });
  }
  return historicalAt;
 };
 const update=async raw=>{
  if(!raw||Object.keys(raw).some(k=>!['clientId','key','assessmentCode','dateOfBirth','effectiveDate','entry','laterEffectiveDate','historicalEffectiveDate'].includes(k)))fail('unknown update field');
  if(!Number.isSafeInteger(raw.clientId)||raw.clientId<1||typeof raw.key!=='string'||!raw.key.trim()||raw.key.length>200||typeof raw.assessmentCode!=='string'||!/^[A-Za-z0-9_]+$/.test(raw.assessmentCode))fail('client, stable key and assessment code required');
  const input={...structuredClone(raw),dateOfBirth:validateBirthDate(raw.dateOfBirth),effectiveDate:instant(raw.effectiveDate)};
  if(input.dateOfBirth>input.effectiveDate.slice(0,10))fail('birth date follows effective date');
  if(input.entry&&(!Number.isSafeInteger(input.entry.enrollmentId)||input.entry.enrollmentId<1||typeof input.entry.assessmentName!=='string'||!input.entry.assessmentName.trim()||Object.keys(input.entry).some(k=>!['enrollmentId','assessmentName'].includes(k))))fail('entry enrollment and assessment name required');
  const expectedLater=input.laterEffectiveDate===undefined?undefined:instant(input.laterEffectiveDate);
  const expectedHistorical=input.historicalEffectiveDate===undefined?undefined:instant(input.historicalEffectiveDate);
  if(expectedHistorical&&(!expectedLater||expectedHistorical>input.effectiveDate))fail('invalid historical DOB evidence');
  // Evidence is separate from durable mutation intent, including keys already used by 0.15.1.
  delete input.laterEffectiveDate;
  delete input.historicalEffectiveDate;
  const scope=JSON.stringify([tenantScope,'client-profile',input.clientId]),keyHash=hash('dob:'+input.key),intentHash=hash(input);
  return store.withLock(scope,async()=>{
   const records=await store.read(scope);if(!Array.isArray(records))fail('invalid journal');
   let record=records.find(r=>r.keyHash===keyHash);
   if(records.filter(r=>r.keyHash===keyHash).length>1||record&&record.intentHash!==intentHash)fail('key conflicts with earlier intent');
   if(records.some(r=>r.keyHash!==keyHash&&r.stage!=='verified'))fail('another profile update is unresolved');
   if(record&&(record.version!==1||record.operation!=='dob'||!['planned','attempted','verified'].includes(record.stage)))fail('invalid journal stage');
   const wasVerified=record?.stage==='verified';
   const persist=async stage=>{record={...record,version:1,operation:'dob',keyHash,intentHash,stage};const index=records.findIndex(r=>r.keyHash===keyHash);if(index<0)records.push(record);else records[index]=record;await store.write(scope,structuredClone(records));};
   let current=await read(input);
   const matches=()=>current.dateOfBirth===input.dateOfBirth&&current.effectiveDate===input.effectiveDate;
   if(expectedLater&&record&&record.method!=='historical-read')throw conflict('existing DOB write requires reconciliation');
   if(record?.method==='historical-read'||expectedLater||!record&&current.effectiveDate>input.effectiveDate){
    if(expectedLater&&record&&expectedLater!==record.laterEffectiveDate)throw conflict('later DOB revision changed');
    if(record?.questionId!==undefined&&record.questionId!==current.questionId)throw unavailable();
    const recordedHistorical=record&&(record.historicalEffectiveDate??input.effectiveDate);
    if(expectedHistorical&&record&&expectedHistorical!==recordedHistorical)throw conflict('historical DOB revision changed');
    const historicalEffectiveDate=await checkHistory(input,current,{
     expectedLater:record?.laterEffectiveDate??expectedLater,
     expectedHistorical:recordedHistorical??expectedHistorical??(expectedLater?input.effectiveDate:undefined),
     allowEarlier:Boolean(input.entry)||Boolean(expectedHistorical),
    });
    record={method:'historical-read',laterEffectiveDate:current.effectiveDate,historicalEffectiveDate,questionId:current.questionId};await persist('verified');
    return {clientId:input.clientId,dateOfBirth:input.dateOfBirth,effectiveDate:input.effectiveDate,method:record.method,laterEffectiveDate:record.laterEffectiveDate,historicalEffectiveDate,outcome:wasVerified?'already-present':'verified'};
   }
   if(!record){
    const method=current.effectiveDate===input.effectiveDate?'ui':'rest';
    if(!matches()&&method==='rest')await ui.validateRestDate(input.dateOfBirth);
    if(!matches()&&method==='ui'&&!input.entry)fail('effective timestamp already exists; provide its entry assessment context for UI correction');
    record={method,protectedHash:current.protectedHash,beforeHash:hash({dob:current.dateOfBirth,effective:current.effectiveDate})};await persist('planned');
   }
   if(current.protectedHash!==record.protectedHash)fail('unrequested profile or assessment data changed');
   if(!matches()){
    if(record.stage!=='planned')fail('write unresolved or later value changed; refusing replay');
    if(hash({dob:current.dateOfBirth,effective:current.effectiveDate})!==record.beforeHash)fail('DOB changed before write');
    if(record.method==='rest'){
     await ui.validateRestDate(input.dateOfBirth);
     // The training server converts UTC to fixed -07 for DOB values, in winter and summer.
     // Keep this workaround scoped to this helper; never shift enrollment/effective dates.
     await persist('attempted');
     let error;try{await api.clients.update({path:{client_id:input.clientId},body:{...pick(current.client,coreKeys),svpprofdob:input.dateOfBirth+'T07:00:00Z',dateEffective:input.effectiveDate}});}catch(e){error=e;}
     current=await read(input);
     if(!matches()||current.protectedHash!==record.protectedHash)throw error??Error('Date of birth: REST verification failed; journal blocks replay');
    }else{
     await ui.correctAtEntry({...input,expectedDateOfBirth:current.dateOfBirth,beforeSave:()=>persist('attempted')});
     current=await read(input);
    }
   }
   if(!matches()||current.protectedHash!==record.protectedHash)fail('verification failed; journal blocks replay');
   await persist('verified');return {clientId:input.clientId,dateOfBirth:current.dateOfBirth,effectiveDate:current.effectiveDate,method:record.method,outcome:wasVerified?'already-present':'verified'};
  });
 };
 const inspectEvidence=async input=>{
  if(!input||Object.keys(input).some(k=>!['clientId','assessmentCode'].includes(k))||!Number.isSafeInteger(input.clientId)||input.clientId<1||typeof input.assessmentCode!=='string'||!/^[A-Za-z0-9_]+$/.test(input.assessmentCode))fail('client and assessment code required');
  return read(input);
 };
 const snapshot=(clientId,current)=>({clientId,dateOfBirth:current.dateOfBirth,effectiveDate:current.effectiveDate});
 const inspect=async input=>{
  return snapshot(input.clientId,await inspectEvidence(input));
 };
 const validate=async input=>{
  if(!input||Object.keys(input).some(k=>!['clientId','assessmentCode','dateOfBirth','effectiveDate','allowEntryCorrection'].includes(k))||input.allowEntryCorrection!==undefined&&typeof input.allowEntryCorrection!=='boolean')fail('invalid DOB validation input');
  const wanted=validateBirthDate(input.dateOfBirth),at=instant(input.effectiveDate);
  if(wanted>at.slice(0,10))fail('birth date follows effective date');
  const current=await inspectEvidence({clientId:input.clientId,assessmentCode:input.assessmentCode});
  if(current.effectiveDate>at){
   const historicalEffectiveDate=await checkHistory({...input,effectiveDate:at},current,{allowEarlier:input.allowEntryCorrection});
   return {...snapshot(input.clientId,current),historicalEffectiveDate};
  }
  if(current.effectiveDate===at){if(current.dateOfBirth!==wanted&&!input.allowEntryCorrection)fail('existing effective timestamp requires matching entry context');}
  else await ui.validateRestDate(wanted);
  return snapshot(input.clientId,current);
 };
 const verify=async input=>{
  if(!input||Object.keys(input).some(k=>!['clientId','assessmentCode','dateOfBirth','effectiveDate','allowLater','laterEffectiveDate','historicalEffectiveDate'].includes(k))||input.allowLater!==undefined&&typeof input.allowLater!=='boolean')fail('invalid DOB verification input');
  const wanted=validateBirthDate(input.dateOfBirth),at=instant(input.effectiveDate),current=await inspectEvidence({clientId:input.clientId,assessmentCode:input.assessmentCode});
  if(input.laterEffectiveDate!==undefined){
   await checkHistory({...input,effectiveDate:at},current,{
    expectedLater:instant(input.laterEffectiveDate),
    expectedHistorical:input.historicalEffectiveDate===undefined?at:instant(input.historicalEffectiveDate),
    allowEarlier:input.historicalEffectiveDate!==undefined,
   });
   return {clientId:input.clientId,dateOfBirth:wanted,effectiveDate:at};
  }
  if(input.historicalEffectiveDate!==undefined)fail('later revision required for historical verification');
  if(current.dateOfBirth!==wanted||current.effectiveDate===null||(input.allowLater?Date.parse(current.effectiveDate)<Date.parse(at):current.effectiveDate!==at))fail('saved birth date changed or effective timestamp does not match');
  return snapshot(input.clientId,current);
 };
 return {update,read:inspect,validate,verify};
}
