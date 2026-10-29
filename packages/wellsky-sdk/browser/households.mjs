import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {toItems} from '../dist/esm/index.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
const id=n=>{if(!Number.isSafeInteger(n)||n<1||n>2147483647)throw Error('Positive household/client ID required');return n;};
const fields=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))throw Error('Unknown household field');};
const instant=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value.slice(0,19)+'Z').toISOString().slice(0,19)!==value.slice(0,19))throw Error('Valid whole-second timezone-qualified membership date required');
 return new Date(value).toISOString();
};
const serverDate=value=>instant(/(?:Z|[+-]\d\d:\d\d)$/.test(value)?value:value+'Z');
const types=['Individual','Female Single Parent','Male Single Parent','Two Parent Family','Foster Parent(s)','Couple With No Children','Non-custodial Caregiver(s)','Grandparent(s) and Child','Children Only Household','Other'];
const relationships=['Daughter','Father','Granddaughter','Grandfather','Grandmother','Grandson','Husband','Husband and Father','Mother','Other non-relative','Other relative','Self','Significant other','Son','Step-daughter','Step-son','Unknown','Wife','Wife and Mother'];
/** Display labels observed in the training UI, October 24, 2026. Recheck for other tenants. */
export const getHouseholdOptions=()=>({householdTypes:[...types],relationships:[...relationships],verifiedOn:'2026-10-24'});
const sorted=members=>members.sort((a,b)=>a.clientId-b.clientId);
const model=row=>{
 id(row?.householdId);if(row.isActive!==true||!types.includes(row.householdType)||!Array.isArray(row.clients))throw Error('Active household readback unavailable');
 const members=sorted(row.clients.map(m=>({clientId:id(m.clientId),head:m.headofhouseholdStatus,relationship:m.headofhouseholdRelationship,dateJoined:serverDate(m.dateJoined),dateEnded:m.dateLeft?serverDate(m.dateLeft):null,isActive:m.isActive})));
 guard(members);return {householdId:row.householdId,householdType:row.householdType,members};
};
const guard=members=>{
 if(!members.length||new Set(members.map(m=>m.clientId)).size!==members.length)throw Error('Unique household members required');
 const heads=members.filter(m=>m.head);
 if(heads.length!==1||heads[0].isActive!==true||heads[0].dateEnded||heads[0].relationship!=='Self')throw Error('Household data error: exactly one active head with relationship Self is required');
 for(const m of members){
  if(typeof m.head!=='boolean'||typeof m.isActive!=='boolean'||!relationships.includes(m.relationship)||(!m.head&&m.relationship==='Self'))throw Error('Invalid household relationship or head status');
  if(m.dateJoined<heads[0].dateJoined||m.dateEnded&&m.dateEnded<m.dateJoined)throw Error('Head must cover every membership date');
 }
 return heads[0].clientId;
};
const member=m=>{fields(m,['clientId','relationship','dateJoined']);if(!relationships.includes(m.relationship))throw Error('Unavailable household relationship');return {clientId:id(m.clientId),relationship:m.relationship,dateJoined:instant(m.dateJoined),dateEnded:null,isActive:true};};
const body=s=>({householdType:s.householdType,householdClients:s.members.map(m=>({clientId:m.clientId,headOfHouseholdStatus:m.head,headOfHouseholdRelationship:m.relationship,dateJoined:m.dateJoined,...(s.householdId?{dateEnded:m.dateEnded,isActive:m.isActive}:{})}))});
const equal=(a,b)=>hash({householdType:a.householdType,members:a.members})===hash({householdType:b.householdType,members:b.members});

/** Durable household management. Does not attach members to enrollments or exit them.
 * Share one store across callers. Ambiguous writes never automatically repeat. */
export function createHouseholds({api,store,ui}) {
 const tenantScope=apiScope(api, ui);
 if(!store?.withLock||!ui?.confirmNoHouseholds)throw Error('REST API, durable store and household UI reader required');
 const read=async householdId=>{id(householdId);const rows=toItems(await api.households.get({path:{householdId}}));if(rows.length!==1||rows[0].householdId!==householdId)throw Error('Household readback ambiguous');return model(rows[0]);};
 const list=async(clientId,allowEmpty)=>{
  const rows=[],ids=new Set();let total;
  for(let startPage=1;startPage<=100;startPage++){
   let result;try{result=await api.households.listForClient({path:{clientId},query:{perPage:100,startPage,total_count:true}});}catch(e){if(e.status===404&&startPage===1&&allowEmpty&&await ui.confirmNoHouseholds(clientId))return [];throw e;}
   if(!Number.isSafeInteger(result?.count)||result.count<0||!Array.isArray(result.values)||total!==undefined&&total!==result.count)throw Error('Household list count unavailable or changed');total=result.count;
   for(const row of result.values){id(row.householdId);if(ids.has(row.householdId)||!row.clients?.some(c=>c.clientId===clientId))throw Error('Invalid household list');ids.add(row.householdId);rows.push(row);}
   if(rows.length===total)return rows;if(!result.values.length||rows.length>total)throw Error('Incomplete household list');
  }throw Error('Household list exceeds safety limit');
 };
 const run=async(kind,input)=>{
  const keys={create:['key','headClientId','householdType','members'],addMembers:['key','householdId','headClientId','householdType','members'],endMembers:['key','householdId','headClientId','clientIds','dateEnded'],updateRelationships:['key','householdId','headClientId','members']};
  fields(input,keys[kind]);id(input.headClientId);if(typeof input.key!=='string'||!input.key.trim()||input.key.length>200)throw Error('Stable household key required');
  const intent={kind,headClientId:input.headClientId};
  if(kind!=='create')intent.householdId=id(input.householdId);
  if(kind==='create'||input.householdType!==undefined){if(!types.includes(input.householdType))throw Error('Unavailable household type');intent.householdType=input.householdType;}
  if(kind==='create'||kind==='addMembers'){
   if(!Array.isArray(input.members)||!input.members.length)throw Error('Members required');intent.members=sorted(input.members.map(member));
   if(new Set(intent.members.map(m=>m.clientId)).size!==intent.members.length)throw Error('Duplicate client IDs');
   for(const m of intent.members){m.head=m.clientId===input.headClientId;if(m.head?m.relationship!=='Self':m.relationship==='Self')throw Error('Head changes are not supported');}
   if(kind==='create')guard(intent.members);else if(intent.members.some(m=>m.head))throw Error('Head changes are not supported');
  }else if(kind==='endMembers'){
   if(!Array.isArray(input.clientIds)||!input.clientIds.length)throw Error('Client IDs required');intent.clientIds=input.clientIds.map(id).sort((a,b)=>a-b);intent.dateEnded=instant(input.dateEnded);
   if(new Set(intent.clientIds).size!==intent.clientIds.length)throw Error('Duplicate client IDs');
   if(intent.clientIds.includes(input.headClientId))throw Error('Head cannot leave an active household; household closure is a separate workflow');
  }else{
   if(!Array.isArray(input.members)||!input.members.length)throw Error('Members required');intent.members=sorted(input.members.map(m=>{fields(m,['clientId','relationship']);id(m.clientId);if(m.clientId===input.headClientId||m.relationship==='Self')throw Error('Head changes are not supported');if(!relationships.includes(m.relationship))throw Error('Unavailable household relationship');return {clientId:m.clientId,relationship:m.relationship};}));
   if(new Set(intent.members.map(m=>m.clientId)).size!==intent.members.length)throw Error('Duplicate client IDs');
  }
  const scope=JSON.stringify([tenantScope,'household-management']),keyHash=hash(input.key),intentHash=hash(intent);
  return store.withLock(scope,async()=>{
   const entries=await store.read(scope);if(!Array.isArray(entries)||entries.some(e=>e.version!==1||!['planned','attempted','verified'].includes(e.stage)))throw Error('Invalid household journal');
   let entry=entries.find(e=>e.keyHash===keyHash);if(entries.filter(e=>e.keyHash===keyHash).length>1||entry&&entry.intentHash!==intentHash)throw Error('Household key conflicts with earlier intent');
   if(entries.some(e=>e.keyHash!==keyHash&&e.stage!=='verified'))throw Error('Another household write is unresolved');
   const persist=async stage=>{entry={...entry,version:1,keyHash,intentHash,stage};const i=entries.findIndex(e=>e.keyHash===keyHash);if(i<0)entries.push(entry);else entries[i]=entry;await store.write(scope,structuredClone(entries));};
   if(entry?.stage==='verified'){
    const current=await read(entry.householdId),latest=entries.filter(e=>e.householdId===entry.householdId&&e.stage==='verified').at(-1);
    if(guard(current.members)!==input.headClientId||!equal(current,latest.target))throw Error('Household changed since verification; reconcile before continuing');
    return {key:input.key,outcome:'already-present',household:current};
   }
   let current;
   if(kind==='create'){
    const existing=await list(input.headClientId,!entry);
    if(!entry){entry={target:{householdType:intent.householdType,members:intent.members},baselineIds:existing.map(h=>h.householdId)};await persist('planned');}
    const matches=existing.filter(h=>h.isActive===true).map(model).filter(h=>equal(h,entry.target));
    if(matches.length>1)throw Error('Multiple matching households');current=matches[0];
   }else{
    current=await read(input.householdId);if(guard(current.members)!==input.headClientId)throw Error('Head changes are not supported');
    if(!entry){
     const target=structuredClone(current);if(intent.householdType)target.householdType=intent.householdType;
     if(kind==='addMembers')for(const m of intent.members){if(target.members.some(v=>v.clientId===m.clientId))throw Error('Client already belongs to household; rejoining needs an explicit history workflow');target.members.push(m);}
     else for(const change of kind==='endMembers'?intent.clientIds.map(clientId=>({clientId})):intent.members){
      const m=target.members.find(v=>v.clientId===change.clientId);if(!m||!m.isActive||m.dateEnded)throw Error('Active household member required');if(kind==='endMembers')m.dateEnded=intent.dateEnded;else m.relationship=change.relationship;
     }
     sorted(target.members);guard(target.members);entry={householdId:current.householdId,baseline:current,target};await persist('planned');
    }
   }
   if(!current||!equal(current,entry.target)){
    if(entry.stage!=='planned')throw Error('Household write unresolved; refusing another mutation');
    if(current&&!equal(current,entry.baseline))throw Error('Household changed before write');
    for(const m of entry.target.members.filter(m=>!entry.baseline?.members.some(v=>v.clientId===m.clientId))){const rows=toItems(await api.clients.get({path:{clientId:m.clientId}}));if(rows.length!==1||rows[0].clientId!==m.clientId||rows[0].isActive!==true)throw Error('Active client required');}
    await persist('attempted');let error;
    try{if(kind==='create')await api.households.create({body:body(entry.target)});else await api.households.update({path:{householdId:input.householdId},body:body(entry.target)});}catch(e){error=e;}
    if(kind==='create'){
     const found=(await list(input.headClientId,false)).filter(h=>!entry.baselineIds.includes(h.householdId)&&h.isActive===true).map(model).filter(h=>equal(h,entry.target));
     if(found.length!==1)throw error??Error('Created household not uniquely verified');current=found[0];
    }else current=await read(input.householdId);
    if(!equal(current,entry.target))throw error??Error('Household readback mismatch; refusing replay');
   }
   entry.householdId=current.householdId;await persist('verified');return {key:input.key,outcome:'verified',household:current};
  });
 };
 return {read,create:input=>run('create',input),addMembers:input=>run('addMembers',input),endMembers:input=>run('endMembers',input),updateRelationships:input=>run('updateRelationships',input)};
}
