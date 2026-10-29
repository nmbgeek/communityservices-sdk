import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {toItems} from '../dist/esm/index.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex');
const fields=['firstName','middleName','lastName','suffix','search_alias','nameDataQuality','socSecNo','ssnDataQuality','veteranStatus','dateEffective'];
const veteranStatuses=['Yes (HUD)','No (HUD)',"Client doesn't know (HUD)",'Client prefers not to answer (HUD)','Data not collected (HUD)'];
const id=n=>{if(!Number.isSafeInteger(n)||n<1)throw Error('Positive client ID required');return n;};
const error=(code,message,details={})=>Object.assign(Error(message),{code,...details});
function prepareClientCreation(input){
 if(!input||Object.keys(input).some(k=>!['sourceId','body','allowDistinctClient'].includes(k))||typeof input.sourceId!=='string'||!input.sourceId.trim()||input.sourceId.length>500)throw Error('Stable source ID required');
 const body=structuredClone(input.body);if(!body||Object.keys(body).some(k=>!fields.includes(k))||!body.firstName?.trim()||!body.lastName?.trim())throw Error('Supported identity fields and names required; use DOB/profile helpers for assessment fields');
 if('veteranStatus' in body&&!veteranStatuses.includes(body.veteranStatus))throw error('INVALID_VETERAN_STATUS',`Veteran status must be omitted or one of: ${veteranStatuses.join('; ')}`);
 for(const [k,v]of Object.entries(body))if(typeof v!=='string'||/[\r\n\0]/.test(v)||v.length>255)throw Error('Invalid client identity field');
 if(body.socSecNo!==undefined&&!/^\d{9}$/.test(body.socSecNo))throw Error('SSN must contain nine digits');
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.000)?(?:Z|[+-]\d\d:\d\d)$/.test(body.dateEffective??'')||!Number.isFinite(Date.parse(body.dateEffective))||new Date(body.dateEffective.slice(0,19)+'Z').toISOString().slice(0,19)!==body.dateEffective.slice(0,19))throw Error('Explicit valid creation effective date required');
 body.dateEffective=new Date(body.dateEffective).toISOString();if(input.allowDistinctClient!==undefined&&typeof input.allowDistinctClient!=='boolean')throw Error('allowDistinctClient must be boolean');
 return {body,sourceHash:digest(input.sourceId),intentHash:digest({body,allowDistinctClient:input.allowDistinctClient??false})};
}
/** Source IDs map to server-returned IDs. Names/SSNs only flag candidates and never select a client.
 * A missing creation receipt requires explicit resolveCreated after operator verification. */
export function createClientCreator({api,store}){
 const tenantScope=apiScope(api);
 if(!store?.withLock)throw Error('REST API and durable store required');
 const scope=JSON.stringify([tenantScope,'client-creation']);
 const read=async clientId=>{const rows=toItems(await api.clients.get({path:{clientId:id(clientId)}}));if(rows.length!==1||rows[0].clientId!==clientId||rows[0].isActive!==true)throw Error('Active client readback required');return rows[0];};
 const verify=(client,body)=>{for(const [k,v]of Object.entries(body))if(k!=='dateEffective'&&client[k]!==v)throw error('CLIENT_CREATION_DRIFT','Client field does not match creation intent',{field:k});};
 const candidates=async body=>{
  const quote=s=>"'"+s.replaceAll("'","''")+"'";const filter=`(first_name eq ${quote(body.firstName)} and last_name eq ${quote(body.lastName)})`+(body.socSecNo?` or soc_sec_no eq ${quote(body.socSecNo)}`:'');
  let result;try{result=await api.clients.list({query:{query:filter,total_count:true,perPage:100,startPage:1}});}catch(e){if(e.status===404)return [];throw e;}
  if(!Number.isSafeInteger(result?.count)||!Array.isArray(result.values)||result.count!==result.values.length||result.count>100)throw Error('Candidate list incomplete; review before creating');
  const ids=result.values.map(c=>id(c.clientId));if(new Set(ids).size!==ids.length)throw Error('Duplicate candidate IDs');return ids;
 };
 const run=async(input,resolution)=>{
  const p=prepareClientCreation(input);
  return store.withLock(scope,async()=>{
   const entries=await store.read(scope);if(!Array.isArray(entries)||entries.some(e=>e.version!==1||!['attempted','created','verified'].includes(e.stage)))throw Error('Invalid client mapping journal');
   let entry=entries.find(e=>e.sourceHash===p.sourceHash);if(entries.filter(e=>e.sourceHash===p.sourceHash).length>1||entry&&entry.intentHash!==p.intentHash)throw error('SOURCE_ID_CONFLICT','Source ID was already used with different client details');
   const persist=async stage=>{entry={...entry,version:1,sourceHash:p.sourceHash,intentHash:p.intentHash,stage};const i=entries.findIndex(e=>e.sourceHash===p.sourceHash);if(i<0)entries.push(entry);else entries[i]=entry;await store.write(scope,structuredClone(entries));};
   const previous=entry?.stage;
   if(resolution!==undefined){
    id(resolution);if(!entry||entry.stage!=='attempted'||entry.clientId)throw error('RESOLUTION_NOT_REQUIRED','Only a creation attempt without a receipt can be explicitly resolved');
    if(entries.some(e=>e.clientId===resolution))throw error('CLIENT_ALREADY_MAPPED','Client ID already belongs to another source');
    verify(await read(resolution),p.body);entry.clientId=resolution;await persist('created');
   }
   if(entry&&!entry.clientId)throw error('CLIENT_CREATE_UNCERTAIN','No client receipt was saved; verify the server result and explicitly resolveCreated. Do not resend creation',{stage:entry.stage});
   if(!entry){
    const found=await candidates(p.body);if(found.length&&!input.allowDistinctClient)throw error('POSSIBLE_DUPLICATE','Potential existing clients require review; no automatic matching or merging',{candidateClientIds:found});
    await persist('attempted');let response;
    try{response=await api.clients.create({body:p.body});}catch(cause){throw error('CLIENT_CREATE_UNCERTAIN','Creation receipt unavailable; explicit resolution required',{stage:'attempted',cause});}
    const rows=toItems(response);if(rows.length!==1||!Number.isSafeInteger(rows[0].clientId)||rows[0].clientId<1)throw error('CLIENT_CREATE_UNCERTAIN','Creation returned no unambiguous client ID',{stage:'attempted'});
    if(entries.some(e=>e.sourceHash!==p.sourceHash&&e.clientId===rows[0].clientId))throw error('CLIENT_ALREADY_MAPPED','Server returned an ID mapped to another source');
    entry.clientId=rows[0].clientId;await persist('created');
   }
   const client=await read(entry.clientId);verify(client,p.body);await persist('verified');return {clientId:entry.clientId,sourceId:input.sourceId,outcome:previous==='verified'?'already-present':'verified'};
  });
 };
 return {create:input=>run(input),resolveCreated:({clientId,...input})=>run(input,id(clientId)),lookup:async sourceId=>{
  if(typeof sourceId!=='string'||!sourceId.trim())throw Error('Source ID required');return store.withLock(scope,async()=>{const entries=await store.read(scope),matches=entries.filter(e=>e.sourceHash===digest(sourceId));if(matches.length>1)throw Error('Duplicate source mappings');const e=matches[0];return e?{clientId:e.clientId??null,stage:e.stage}:null;});
 }};
}
