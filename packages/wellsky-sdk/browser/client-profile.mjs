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
export function createClientProfile({api,ui,store}) {
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
  return store.withLock(JSON.stringify([tenantScope,'client-profile',clientId]),async()=>{
   const scope=JSON.stringify([tenantScope,'client-profile',clientId]),entries=await store.read(scope);
   if(!Array.isArray(entries))throw Error('Invalid profile journal');
   let entry=entries.find(e=>e.keyHash===keyHash);
   if(entries.filter(e=>e.keyHash===keyHash).length>1||entry&&entry.intentHash!==intentHash)throw Error('Profile key conflicts with an earlier intent');
   if(entries.some(e=>e.keyHash!==keyHash&&e.stage!=='verified'))throw Error('Another profile update is unresolved');
   if(entry&&(!['planned','rest-attempted','rest-verified','ui-attempted','verified'].includes(entry.stage)||entry.version!==1))throw Error('Invalid profile journal stage');
   const wasVerified=entry?.stage==='verified';
   const persist=async stage=>{
    entry={...entry,version:1,keyHash,intentHash,stage};
    const i=entries.findIndex(e=>e.keyHash===keyHash);if(i<0)entries.push(entry);else entries[i]=entry;
    await store.write(scope,structuredClone(entries));
   };
   let snapshot=await ui.inspect(clientId),rest=await readRest(clientId);
   for(const [field,options] of Object.entries(snapshot.choices))if(field in changes&&!options.includes(changes[field]))throw Error(`Unavailable Client Record choice: ${field}`);
   const core=pick(rest,restKeys);
   if(!same(snapshot.values,core))throw Error('Client Record REST and UI disagree');
   if(!entry){
    const target={...core,...restChanges};
    entry={restExpectedHash:digest(target),protectedHash:digest(pick(rest,protectedKeys)),uiExpectedHash:digest({...target,sex:changes.sex??snapshot.values.sex})};
    await persist('planned');
   }
   const protectedMatch=()=>digest(pick(rest,protectedKeys))===entry.protectedHash;
   if(!protectedMatch())throw Error('Unrequested profile fields changed; reconcile before continuing');
   let restMatches=digest(pick(rest,restKeys))===entry.restExpectedHash;
   if(!restMatches){
    if(entry.stage!=='planned')throw Error('REST profile update unresolved or changed; refusing another write');
    // WellSky clears SSN when omitted, even during a middle-name-only update.
    const body={...pick(rest,restKeys),...restChanges,dateEffective};
    if(digest(pick(body,restKeys))!==entry.restExpectedHash)throw Error('Client Record changed before REST update');
    await persist('rest-attempted');
    let error;try{await api.clients.update({path:{client_id:clientId},body});}catch(e){error=e;}
    rest=await readRest(clientId);
    restMatches=digest(pick(rest,restKeys))===entry.restExpectedHash;
    if(!restMatches||!protectedMatch())throw error??Error('REST profile readback mismatch; journal blocks another write');
    snapshot=await ui.inspect(clientId);
    if(!same(snapshot.values,pick(rest,restKeys)))throw Error('Client Record UI did not reflect the REST update');
   }
   if(entry.stage==='planned'||entry.stage==='rest-attempted')await persist('rest-verified');
   if(digest(snapshot.values)!==entry.uiExpectedHash){
    if(entry.stage==='ui-attempted'||wasVerified)throw Error('Client Record UI save unresolved or changed; refusing another save');
    if(changes.sex===undefined)throw Error('Unrequested Sex value changed');
    snapshot=await ui.updateSex({clientId,sex:changes.sex,expected:snapshot.values,beforeSave:()=>persist('ui-attempted')});
   }
   rest=await readRest(clientId);
   if(digest(snapshot.values)!==entry.uiExpectedHash||digest(pick(rest,restKeys))!==entry.restExpectedHash||!protectedMatch())throw Error('Profile verification mismatch; journal blocks replay');
   await persist('verified');return {clientId,key,outcome:wasVerified?'already-present':'verified',values:snapshot.values};
  });
 };
 return {read,update};
}
