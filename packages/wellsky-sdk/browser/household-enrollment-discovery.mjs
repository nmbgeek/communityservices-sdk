import {parseRestInstant,toItems} from '../dist/esm/index.js';

const positive=v=>Number.isSafeInteger(v)&&v>0;
const pairs=members=>JSON.stringify(members.map(({clientId,enrollmentId})=>({clientId,enrollmentId})).sort((a,b)=>a.clientId-b.clientId));

/** Resolves only a unique current household satisfying the adoption membership contract. */
export function createHouseholdEnrollmentDiscovery({api,enrollmentSession,makeError}){
 const fail=(code,reason)=>{throw makeError(reason,{code,committed:false});};
 return async input=>{
  if(!input||Object.keys(input).some(k=>!['headClientId','headEnrollmentId'].includes(k))||!positive(input.headClientId)||!positive(input.headEnrollmentId))fail('HOUSEHOLD_DISCOVERY_INPUT_INVALID','head client and enrollment IDs required');
  if(typeof enrollmentSession?.readEnrollment!=='function'||typeof api.households?.listForClient!=='function'||typeof api.households?.get!=='function')fail('HOUSEHOLD_DISCOVERY_READERS_REQUIRED','GWT detail and complete household readers required');
  const target={clientId:input.headClientId,enrollmentId:input.headEnrollmentId};
  const anchor=await enrollmentSession.readEnrollment(target);
  const valid=(s,t)=>s?.source==='gwt-rpc'&&s.tenant===api.tenant&&s.clientId===t.clientId&&s.enrollmentId===t.enrollmentId&&positive(s.providerId)&&typeof s.enrollmentType==='string'&&Number.isFinite(parseRestInstant(s.projectStartDate));
  if(!valid(anchor,target)||!Array.isArray(anchor.members)||!anchor.members.length||anchor.members.some(m=>!positive(m?.clientId)||!positive(m?.enrollmentId))||new Set(anchor.members.map(m=>m.clientId)).size!==anchor.members.length||new Set(anchor.members.map(m=>m.enrollmentId)).size!==anchor.members.length||!anchor.members.some(m=>m.clientId===target.clientId&&m.enrollmentId===target.enrollmentId))fail('HOUSEHOLD_DISCOVERY_DETAIL_INVALID','complete linked enrollment cohort required');
  if(anchor.members.length===1&&anchor.grouped!==true)fail('ENROLLMENT_NOT_GROUPED','standalone enrollment uses adoptEnrollment');
  if(anchor.grouped===false&&anchor.members.length>1)fail('HOUSEHOLD_DISCOVERY_DETAIL_INVALID','group flag conflicts with linked cohort');
  const members=anchor.members.map(({clientId,enrollmentId})=>({clientId,enrollmentId})).sort((a,b)=>a.clientId-b.clientId),starts=new Map();
  for(const member of members){
   const s=member.clientId===target.clientId?anchor:await enrollmentSession.readEnrollment(member);
   if(!valid(s,member)||s.providerId!==anchor.providerId||s.enrollmentType!==anchor.enrollmentType||!Array.isArray(s.members)||pairs(s.members)!==pairs(members))fail('HOUSEHOLD_DISCOVERY_COHORT_CHANGED','linked enrollment cohort changed during discovery');
   starts.set(member.clientId,parseRestInstant(s.projectStartDate));
  }
  const candidates=[],seen=new Set();let total;
  for(let startPage=1;startPage<=100;startPage++){
   const result=await api.households.listForClient({path:{clientId:input.headClientId},query:{perPage:100,startPage,total_count:true}});
   if(!Number.isSafeInteger(result?.count)||result.count<0||!Array.isArray(result.values)||total!==undefined&&total!==result.count)fail('HOUSEHOLD_DISCOVERY_LIST_INCOMPLETE','household list count unavailable or changed');total=result.count;
   for(const h of result.values){
    if(!positive(h?.householdId)||seen.has(h.householdId)||!Array.isArray(h.clients)||h.clients.some(m=>!positive(m?.clientId))||new Set(h.clients.map(m=>m.clientId)).size!==h.clients.length||!h.clients.some(m=>m.clientId===input.headClientId))fail('HOUSEHOLD_DISCOVERY_LIST_INCOMPLETE','invalid household list');
    seen.add(h.householdId);candidates.push(h);
   }
   if(seen.size===total)break;
   if(seen.size>total||!result.values.length||startPage===100)fail('HOUSEHOLD_DISCOVERY_LIST_INCOMPLETE','incomplete household list');
  }
  const matches=h=>{
   if(h.isActive!==true||!Array.isArray(h.clients))return false;
   const heads=h.clients.filter(m=>m.headofhouseholdStatus&&m.isActive!==false&&!m.dateLeft);
   return heads.length===1&&heads[0].clientId===input.headClientId&&members.every(m=>{
    const found=h.clients.filter(c=>c.clientId===m.clientId);
    return found.length===1&&found[0].isActive!==false&&!found[0].dateLeft&&Number.isFinite(parseRestInstant(found[0].dateJoined))&&parseRestInstant(found[0].dateJoined)<=starts.get(m.clientId);
   });
  };
  const found=candidates.filter(matches);
  if(found.length!==1)fail(found.length?'HOUSEHOLD_DISCOVERY_AMBIGUOUS':'HOUSEHOLD_DISCOVERY_NOT_FOUND','a unique current household matching the full cohort, head and dates is required');
  const fresh=toItems(await api.households.get({path:{householdId:found[0].householdId}}));
  if(fresh.length!==1||fresh[0].householdId!==found[0].householdId||!matches(fresh[0]))fail('HOUSEHOLD_DISCOVERY_COHORT_CHANGED','household membership changed during discovery');
  return {headClientId:input.headClientId,headEnrollmentId:input.headEnrollmentId,householdId:fresh[0].householdId,householdSource:'verified-membership',providerId:anchor.providerId,type:anchor.enrollmentType,members};
 };
}
