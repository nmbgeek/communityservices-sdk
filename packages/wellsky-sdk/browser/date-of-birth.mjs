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

/** Calendar-date writer. New effective timestamps use REST;
 * collisions use the existing entry assessment UI without moving the timestamp. */
export function createDateOfBirth({api,ui,store}){
 const tenantScope=apiScope(api, ui);
 if(!ui?.read||!ui?.correctAtEntry||!ui?.validateRestDate||!store?.withLock||!store?.read||!store?.write)fail('REST API, DOB UI and durable store required');
 const read=async input=>{
  const rows=toItems(await api.clients.get({path:{clientId:input.clientId}}));
  if(rows.length!==1||rows[0].clientId!==input.clientId||rows[0].isActive===false)fail('active client readback unavailable');
  const client=rows[0],answers=toItems(await api.assessmentsMobile.getAnswers({path:{clientId:input.clientId,assessmentCode:input.assessmentCode}}));
  const dob=answers.filter(q=>q.virt_field_name==='SVPPROFDOB');
  if(dob.length!==1||dob[0].question_type!=='date')fail('assessment must expose one DOB date question');
  const row=dob[0],dateOfBirth=storedDate(client.svpprofdob),hasValue=row.answer_value!==null&&row.answer_value!==undefined&&row.answer_value!=='',hasAnswer=row.date_effective!==null&&row.date_effective!==undefined&&row.date_effective!=='';
  // WellSky's mobile projection omits the value for UI-created date answers.
  // Require matching current client + fresh UI values; use the answer only for its effective date.
  if(hasValue&&(!hasAnswer||answerDate(row.answer_value)!==dateOfBirth)||!hasAnswer&&dateOfBirth!==null)fail('client and assessment DOB disagree');
  const uiDate=await ui.read(input.clientId);
  if(uiDate!==dateOfBirth)fail('client and UI DOB disagree');
  // Values and effective dates of every other exposed answer must survive the write.
  const protectedAnswers=answers.filter(q=>q.virt_field_name!=='SVPPROFDOB').map(q=>({field:q.virt_field_name,value:q.answer_value??null,text:q.answer_value_text??null,effective:q.date_effective??null,rows:q.sub_assessment_answer_list??null})).sort((a,b)=>String(a.field).localeCompare(String(b.field)));
  return {client,dateOfBirth,effectiveDate:hasAnswer?effective(row.date_effective):null,protectedHash:hash({client:pick(client,protectedKeys),answers:protectedAnswers})};
 };
 const update=async raw=>{
  if(!raw||Object.keys(raw).some(k=>!['clientId','key','assessmentCode','dateOfBirth','effectiveDate','entry'].includes(k)))fail('unknown update field');
  if(!Number.isSafeInteger(raw.clientId)||raw.clientId<1||typeof raw.key!=='string'||!raw.key.trim()||raw.key.length>200||typeof raw.assessmentCode!=='string'||!/^[A-Za-z0-9_]+$/.test(raw.assessmentCode))fail('client, stable key and assessment code required');
  const input={...structuredClone(raw),dateOfBirth:validateBirthDate(raw.dateOfBirth),effectiveDate:instant(raw.effectiveDate)};
  if(input.dateOfBirth>input.effectiveDate.slice(0,10))fail('birth date follows effective date');
  if(input.entry&&(!Number.isSafeInteger(input.entry.enrollmentId)||input.entry.enrollmentId<1||typeof input.entry.assessmentName!=='string'||!input.entry.assessmentName.trim()||Object.keys(input.entry).some(k=>!['enrollmentId','assessmentName'].includes(k))))fail('entry enrollment and assessment name required');
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
   if(!record){
    if(current.effectiveDate&&Date.parse(input.effectiveDate)<Date.parse(current.effectiveDate))fail('historical correction before latest DOB requires a separate history workflow');
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
 const inspect=async input=>{
  if(!input||Object.keys(input).some(k=>!['clientId','assessmentCode'].includes(k))||!Number.isSafeInteger(input.clientId)||input.clientId<1||typeof input.assessmentCode!=='string'||!/^[A-Za-z0-9_]+$/.test(input.assessmentCode))fail('client and assessment code required');
  const current=await read(input);return {clientId:input.clientId,dateOfBirth:current.dateOfBirth,effectiveDate:current.effectiveDate};
 };
 const validate=async input=>{
  if(!input||Object.keys(input).some(k=>!['clientId','assessmentCode','dateOfBirth','effectiveDate','allowEntryCorrection'].includes(k))||input.allowEntryCorrection!==undefined&&typeof input.allowEntryCorrection!=='boolean')fail('invalid DOB validation input');
  const wanted=validateBirthDate(input.dateOfBirth),at=instant(input.effectiveDate);
  if(wanted>at.slice(0,10))fail('birth date follows effective date');
  const current=await inspect({clientId:input.clientId,assessmentCode:input.assessmentCode});
  if(current.effectiveDate&&Date.parse(current.effectiveDate)>Date.parse(at))fail('historical correction before latest DOB requires a separate history workflow');
  if(current.effectiveDate===at){if(current.dateOfBirth!==wanted&&!input.allowEntryCorrection)fail('existing effective timestamp requires matching entry context');}
  else await ui.validateRestDate(wanted);
  return current;
 };
 const verify=async input=>{
  if(!input||Object.keys(input).some(k=>!['clientId','assessmentCode','dateOfBirth','effectiveDate','allowLater'].includes(k))||input.allowLater!==undefined&&typeof input.allowLater!=='boolean')fail('invalid DOB verification input');
  const wanted=validateBirthDate(input.dateOfBirth),at=instant(input.effectiveDate),current=await inspect({clientId:input.clientId,assessmentCode:input.assessmentCode});
  if(current.dateOfBirth!==wanted||current.effectiveDate===null||(input.allowLater?Date.parse(current.effectiveDate)<Date.parse(at):current.effectiveDate!==at))fail('saved birth date changed or effective timestamp does not match');
  return current;
 };
 return {update,read:inspect,validate,verify};
}
