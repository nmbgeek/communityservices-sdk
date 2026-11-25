import {classifyProfilePut,createProfileDiagnostics} from './client-profile-diagnostics.mjs';
import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {toItems} from '../dist/esm/index.js';

const restKeys=['firstName','middleName','lastName','suffix','search_alias','socSecNo','nameDataQuality','ssnDataQuality','veteranStatus'];
const limits={firstName:30,middleName:30,lastName:30,suffix:10,search_alias:255};
const protectedKeys=['svpprofdob','svpprofdobtype','svpprofgender','hud_raceethnicity','hud_raceethnicitydetail','phone','email'];
const digest=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
const pick=(value,keys)=>Object.fromEntries(keys.map(k=>[k,value[k]??'']));
const same=(a,b)=>Object.entries(b).every(([k,v])=>a[k]===v);
const id=n=>{if(!Number.isSafeInteger(n)||n<=0)throw Error('Positive client ID required');};
const instant=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s.slice(0,19)+'Z').toISOString().slice(0,19)===s.slice(0,19);

/** Client Record section only. REST preserves the complete record; Sex uses the UI.
 * Durable hashes prevent replay of uncertain writes without retaining SSNs in the journal. */
export function createClientProfile({api,ui,store,onDiagnostic}) {
 const tenantScope=apiScope(api, ui);
 if(!ui?.inspect||!ui?.updateSex||!store)throw Error('REST client, profile UI and durable store required');
 const readRest=async clientId=>{
  const rows=toItems(await api.clients.get({path:{clientId}}));
  if(rows.length!==1||rows[0].clientId!==clientId||rows[0].isActive===false)throw Error('Active client readback unavailable');return rows[0];
 };
 const read=async clientId=>{
  id(clientId);const snapshot=await ui.inspect(clientId),rest=await readRest(clientId);
  if(!same(snapshot.values,pick(rest,restKeys)))throw Error('Client Record REST and UI disagree');
  return {clientId,...snapshot};
 };
 const update=async input=>{
  if(!input||Object.keys(input).some(k=>!['key','clientId','changes','dateEffective'].includes(k)))throw Error('Unknown profile update field');
  const {key,clientId,dateEffective}=input;id(clientId);
  if(typeof key!=='string'||!key.trim()||key.length>200)throw Error('Stable profile update key required');
  const changes=structuredClone(input.changes);
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length)throw Error('Profile changes required');
  for(const [field,value] of Object.entries(changes)){
   if(![...restKeys,'sex'].includes(field))throw Error(`Unsupported Client Record field: ${field}`);
   if(typeof value!=='string'||/[\r\n\0]/.test(value))throw Error(`Invalid Client Record field: ${field}`);
   if(limits[field]!==undefined&&value.length>limits[field])throw Error(`${field} exceeds ${limits[field]} characters`);
   if(field==='socSecNo'&&value!==''&&!/^\d{9}$/.test(value))throw Error('SSN must be nine digits or an empty string');
  }
  const restChanges=Object.fromEntries(Object.entries(changes).filter(([k])=>k!=='sex'));
  if(Object.keys(restChanges).length&&!instant(dateEffective))throw Error('Timezone-qualified dateEffective required for REST profile changes');
  if(dateEffective!==undefined&&!instant(dateEffective))throw Error('Invalid dateEffective');
  const keyHash=digest(key),intentHash=digest({clientId,changes,dateEffective});
  const scope=JSON.stringify([tenantScope,'client-profile',clientId]);
  const trace=createProfileDiagnostics(onDiagnostic,key,scope,changes);
  try{return await store.withLock(scope,async()=>{
   const entries=await store.read(scope);
   if(!Array.isArray(entries))throw Error('Invalid profile journal');
   let entry=entries.find(e=>e.keyHash===keyHash);
   if(entries.filter(e=>e.keyHash===keyHash).length>1||entry&&entry.intentHash!==intentHash)throw Error('Profile key conflicts with an earlier intent');
   if(entries.some(e=>e.keyHash!==keyHash&&e.stage!=='verified'))throw Error('Another profile update is unresolved');
   if(entry&&(!['planned','rest-attempted','rest-verified','ui-attempted','verified'].includes(entry.stage)||entry.version!==1))throw Error('Invalid profile journal stage');
   const wasVerified=entry?.stage==='verified';
   let phase=entry?'reconciliation':'preflight';
   const persist=async stage=>{
    const next={...entry,version:1,keyHash,intentHash,stage};
    const i=entries.findIndex(e=>e.keyHash===keyHash);
    const records=entries.slice();records[i<0?records.length:i]=next;
    await store.write(scope,structuredClone(records));
    entries[i<0?entries.length:i]=next;entry=next;
   };
   const failure=async(transport,reason,nextAction,comparison,error)=>{
    if(!trace)return;
    if(comparison?.protectedFieldsMatch===false&&(reason==='REST_TARGET_MISMATCH'||reason==='UI_TARGET_MISMATCH')){
     reason='PROTECTED_FIELDS_CHANGED';
    }
    const first=trace.record(entry,transport,phase,reason,nextAction,comparison,error);
    if(entry&&!entry.firstFailure&&entries.includes(entry)){
     entry.firstFailure=first;
     // The attempt marker is already durable. Failure to save optional evidence must
     // preserve the original error and the normal readback/reconciliation path.
     try{await store.write(scope,structuredClone(entries));}catch{}
    }
   };
   const observe=async transport=>{
    try{return transport==='ui'?await ui.inspect(clientId):await readRest(clientId);}
    catch(error){
     await failure(transport,transport==='ui'?'UI_READ_FAILED':'REST_READ_FAILED','verify-same-key',undefined,error);
     throw error;
    }
   };
   let snapshot=await observe('ui'),rest=await observe('rest');
   for(const [field,options] of Object.entries(snapshot.choices)){
    if(Object.hasOwn(changes,field)&&!options.includes(changes[field])){
     await failure('ui','CHOICE_UNAVAILABLE','staff-review');
     throw Error(`Unavailable Client Record choice: ${field}`);
    }
   }
   const core=pick(rest,restKeys);
   const checkSources=async(values,message)=>{
    if(!same(snapshot.values,values)){
     await failure('ui','REST_UI_DISAGREE','staff-review',trace?.sourceComparison(values,snapshot.values));
     throw Error(message);
    }
   };
   await checkSources(core,'Client Record REST and UI disagree');
   if(!entry){
    const target={...core,...restChanges},uiTarget={...target,sex:changes.sex??snapshot.values.sex},protectedValues=pick(rest,protectedKeys);
    entry={restExpectedHash:digest(target),protectedHash:digest(protectedValues),uiExpectedHash:digest(uiTarget)};
    if(trace)entry.protectedFieldTags=trace.protectedTags({...uiTarget,...protectedValues});
    await persist('planned');
   }
   const protectedMatch=()=>digest(pick(rest,protectedKeys))===entry.protectedHash;
   const restComparison=()=>{
    if(!trace)return;
    const values=pick(rest,restKeys),unchanged=digest({...values,...restChanges})===entry.restExpectedHash&&protectedMatch();
    return trace.targetComparison('rest-target',{...values,...pick(rest,protectedKeys)},entry,unchanged);
   };
   const uiComparison=()=>{
    if(!trace)return;
    const values=pick(snapshot.values,[...restKeys,'sex']);
    return trace.targetComparison('ui-target',values,entry,digest({...values,...changes})===entry.uiExpectedHash);
   };
   if(!protectedMatch()){
    await failure('rest','PROTECTED_FIELDS_CHANGED','staff-review',restComparison());
    throw Error('Unrequested profile fields changed; reconcile before continuing');
   }
   let restMatches=digest(pick(rest,restKeys))===entry.restExpectedHash;
   if(!restMatches){
    if(entry.stage!=='planned'){
     await failure('rest','REST_TARGET_MISMATCH','staff-review',restComparison());
     throw Error('REST profile update unresolved or changed; refusing another write');
    }
    // WellSky clears SSN when omitted, even during a middle-name-only update.
    const body={...pick(rest,restKeys),...restChanges,dateEffective};
    if(digest(pick(body,restKeys))!==entry.restExpectedHash){
     await failure('rest','PROTECTED_FIELDS_CHANGED','staff-review',restComparison());
     throw Error('Client Record changed before REST update');
    }
    await persist('rest-attempted');
    phase='write';
    let error;
    try{
     await api.clients.update({path:{client_id:clientId},body});
     if(trace)trace.writes.rest='dispatched';
    }catch(e){
     error=e;
     if(trace){
      const {dispatch,reason}=classifyProfilePut(e);
      trace.writes.rest=dispatch;
      await failure('rest',reason,reason==='REST_WRITE_UNCONFIRMED'?'verify-same-key':'staff-review',undefined,e);
     }
    }
    phase='readback';
    rest=await observe('rest');
    restMatches=digest(pick(rest,restKeys))===entry.restExpectedHash;
    if(!restMatches||!protectedMatch()){
     const reason=protectedMatch()?'REST_TARGET_MISMATCH':'PROTECTED_FIELDS_CHANGED';
     await failure('rest',reason,'staff-review',restComparison());
     throw error??Error('REST profile readback mismatch; journal blocks another write');
    }
    snapshot=await observe('ui');
    await checkSources(pick(rest,restKeys),'Client Record UI did not reflect the REST update');
   }
   if(entry.stage==='planned'||entry.stage==='rest-attempted')await persist('rest-verified');
   trace?.record(entry,'rest',phase,'REST_VERIFIED','none',restComparison());
   if(digest(snapshot.values)!==entry.uiExpectedHash){
    if(entry.stage==='ui-attempted'||wasVerified){
     await failure('ui','UI_TARGET_MISMATCH','staff-review',uiComparison());
     throw Error('Client Record UI save unresolved or changed; refusing another save');
    }
    if(changes.sex===undefined){
     await failure('ui','PROTECTED_FIELDS_CHANGED','staff-review',uiComparison());
     throw Error('Unrequested Sex value changed');
    }
    phase='write';
    try{
     snapshot=await ui.updateSex({clientId,sex:changes.sex,expected:snapshot.values,beforeSave:async()=>{
      await persist('ui-attempted');if(trace)trace.writes.ui='unknown';
     },...(trace?{afterSaveClick:()=>{trace.writes.ui='dispatched';}}:{})});
     if(trace&&trace.writes.ui==='unknown')trace.writes.ui='dispatched';
    }catch(error){
     const attempted=entry.stage==='ui-attempted';
     await failure('ui',attempted?'UI_SAVE_UNCONFIRMED':'UI_PREPARATION_FAILED','verify-same-key',undefined,error);
     throw error;
    }
   }
   phase='final';
   rest=await observe('rest');
   const uiMatches=digest(snapshot.values)===entry.uiExpectedHash;
   if(!uiMatches||digest(pick(rest,restKeys))!==entry.restExpectedHash||!protectedMatch()){
    if(!protectedMatch())await failure('rest','PROTECTED_FIELDS_CHANGED','staff-review',restComparison());
    else if(!uiMatches)await failure('ui','UI_TARGET_MISMATCH','staff-review',uiComparison());
    else await failure('rest','REST_TARGET_MISMATCH','staff-review',restComparison());
    throw Error('Profile verification mismatch; journal blocks replay');
   }
   await persist('verified');
   trace?.record(entry,'ui',phase,'PROFILE_VERIFIED','none',uiComparison());
   return {clientId,key,outcome:wasVerified?'already-present':'verified',values:snapshot.values};
  });}finally{trace?.flush();}
 };
 return {read,update};
}
