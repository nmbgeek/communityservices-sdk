import {apiScope} from './connection.mjs';
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const positive=value=>Number.isSafeInteger(value)&&value>0;
const fail=message=>{throw Error(`Member entry date: ${message}`);};
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function instant(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,19)+'Z').toISOString().slice(0,19)!==value.slice(0,19))fail('timezone-qualified whole-second date required');
 return new Date(value).toISOString();
}
function ids(values){
 if(!Array.isArray(values)||!values.length||values.some(value=>!positive(value))||new Set(values).size!==values.length)fail('unique positive IDs required');
 return [...values].sort((a,b)=>a-b);
}
function identity(value){
 if(!object(value)||!positive(value.clientId)||!positive(value.enrollmentId))fail('member identity required');
 return {clientId:value.clientId,enrollmentId:value.enrollmentId};
}
function exit(value){
 const target=identity(value),clientIds=ids(value.clientIds),enrollmentIds=ids(value.enrollmentIds);
 if(!clientIds.includes(target.clientId)||!enrollmentIds.includes(target.enrollmentId))fail('exit subgroup omits member');
 const result={...target,projectExitDate:value.projectExitDate===null?null:instant(value.projectExitDate)};
 for(const field of ['destination','destinationCode','reasonForLeaving','reasonForLeavingCode','exitSubgroupId']){
  if(value[field]!==null&&(typeof value[field]!=='string'||!value[field]))fail('complete exit metadata required');
  result[field]=value[field];
 }
 return {...result,clientIds,enrollmentIds};
}
function normalize(input){
 const target=identity(input);
 if(!positive(input.providerId)||!['HUD','VA'].includes(input.type)||!Array.isArray(input.cohort)||input.cohort.length<2)fail('program and complete household cohort required');
 const entryDate=instant(input.entryDate),cohort=input.cohort.map(member=>({ ...identity(member),entryDate:instant(member.entryDate),exit:exit(member.exit)})).sort((a,b)=>a.clientId-b.clientId);
 ids(cohort.map(m=>m.clientId));ids(cohort.map(m=>m.enrollmentId));
 for(const member of cohort)if(member.exit.clientId!==member.clientId||member.exit.enrollmentId!==member.enrollmentId)fail('exit identity mismatch');
 const member=cohort.find(m=>m.clientId===target.clientId&&m.enrollmentId===target.enrollmentId);
 if(!member||member.exit.projectExitDate!==null||Date.parse(entryDate)<Date.parse(member.entryDate))fail('open target and non-decreasing entry date required');
 return {...target,providerId:input.providerId,type:input.type,entryDate,cohort};
}

/** Date-only REST port, verified through fresh GWT reads. The caller must
 * durably journal before save and reconcile uncertain responses. Never retries. */
export function createMemberEntryDatePort({api,enrollmentSession}){
 apiScope(api, enrollmentSession);
 if(typeof api.enrollments?.updateEntryAssessment!=='function'||typeof enrollmentSession?.readEnrollment!=='function')fail('REST API and authoritative enrollment reader required');
 const inspect=async(input,after=false)=>{
  const wantedMembers=input.cohort.map(identity),wantedExits=input.cohort.map(m=>m.exit);let alreadyPresent=false;
  for(const member of input.cohort){
   const snapshot=await enrollmentSession.readEnrollment(identity(member));
   if(snapshot?.source!=='gwt-rpc'||snapshot.tenant!==api.tenant||snapshot.clientId!==member.clientId||snapshot.enrollmentId!==member.enrollmentId||snapshot.providerId!==input.providerId||snapshot.enrollmentType!==input.type)fail('authoritative enrollment context mismatch');
   if(!Array.isArray(snapshot.members)||!Array.isArray(snapshot.exits))fail('complete enrollment membership and exits required');
   const members=snapshot.members.map(identity).sort((a,b)=>a.clientId-b.clientId),exits=snapshot.exits.map(exit).sort((a,b)=>a.clientId-b.clientId);
   if(!equal(members,wantedMembers)||!equal(exits,wantedExits))fail('cohort membership or exit metadata changed');
   const actual=instant(snapshot.projectStartDate),isTarget=member.clientId===input.clientId;
   if(isTarget){
    alreadyPresent=actual===input.entryDate;
    if(!alreadyPresent&&(after||actual!==member.entryDate))fail('target entry date changed unexpectedly');
    if(!Array.isArray(snapshot.reviews)||snapshot.reviews.some(r=>!positive(r.reviewId)||typeof r.type!=='string'||!r.type||Date.parse(instant(r.reviewDate))<Date.parse(input.entryDate)))fail('target review precedes requested entry or is incomplete');
   }else if(actual!==member.entryDate)fail('existing member entry date changed');
  }
  return alreadyPresent;
 };
 return {
  async validateMemberEntryDate(raw){await inspect(normalize(raw));},
  async saveMemberEntryDate(raw){
   const input=normalize(raw);if(await inspect(input))return;
   // Swagger makes all other fields optional. Omitting them avoids provider,
   // type, assessment answer and assessment effective-date updates.
   await api.enrollments.updateEntryAssessment({query:{enrollment_id:input.enrollmentId},body:{projectStartDate:input.entryDate}});
   await inspect(input,true);
  },
 };
}
