import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {toItems} from '../dist/esm/index.js';

const hash=value=>createHash('sha256').update(JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)).digest('hex');
const validId=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const id=n=>{if(!validId(n))throw Error('Positive household/client ID required');return n;};
const validKey=key=>typeof key==='string'&&Boolean(key.trim())&&key.length<=200;
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
const snapshot=(row,checkType=true)=>{
 id(row?.householdId);
 if(row.isActive!==true||checkType&&!types.includes(row.householdType)||!Array.isArray(row.clients))throw Error('Active household readback unavailable');
 const members=sorted(row.clients.map(m=>({clientId:id(m.clientId),head:m.headofhouseholdStatus,relationship:typeof m.headofhouseholdRelationship==='string'?m.headofhouseholdRelationship:null,dateJoined:serverDate(m.dateJoined),dateEnded:m.dateLeft?serverDate(m.dateLeft):null,isActive:m.isActive})));
 return {householdId:row.householdId,householdType:typeof row.householdType==='string'?row.householdType:null,members};
};
const model=row=>{const current=snapshot(row);guard(current.members);return current;};
const ambiguous=()=>{throw Object.assign(Error('Ambiguous household membership; staff review required'),{code:'HOUSEHOLD_MEMBERSHIP_AMBIGUOUS',nextAction:'staff-review'});};

// Used only for selecting an existing household. Keep all historical rows out of write payloads.
export function coveredHousehold(row,headClientId,requests,now=new Date().toISOString(),{excludeDifferentHead=false,matchRelationships=true}={}){
 let household;
 try{household=snapshot(row,matchRelationships);}catch{ambiguous();}
 const byClient=new Map();
 for(const m of household.members){
  const validRelationship=relationships.includes(m.relationship)&&m.head===(m.relationship==='Self');
  if(typeof m.isActive!=='boolean'||typeof m.head!=='boolean'||matchRelationships&&!validRelationship||
     (!m.isActive&&!m.dateEnded)||m.dateEnded&&m.dateEnded<=m.dateJoined)ambiguous();
  if(!byClient.has(m.clientId))byClient.set(m.clientId,[]);
  byClient.get(m.clientId).push(m);
 }
 for(const intervals of byClient.values()){
  intervals.sort((a,b)=>a.dateJoined.localeCompare(b.dateJoined));
  for(let i=1;i<intervals.length;i++)if(!intervals[i-1].dateEnded||intervals[i-1].dateEnded>=intervals[i].dateJoined)ambiguous();
 }
 const at=date=>{
  if(household.members.some(m=>m.dateEnded===date))ambiguous();
  const members=household.members.filter(m=>m.dateJoined<=date&&(!m.dateEnded||date<m.dateEnded));
  const heads=members.filter(m=>m.head);
  if(members.length&&heads.length!==1)ambiguous();
  return {members,head:heads[0]};
 };
 const selection=at(now),coverage=[];
 if(!selection.members.length)return;
 if(!selection.head.isActive)ambiguous();
 const differentHead=selection.head.clientId!==headClientId;
 const membership=({clientId,head,dateJoined,dateEnded,isActive})=>({clientId,head,dateJoined,dateEnded,isActive});
 if(differentHead&&!excludeDifferentHead)ambiguous();
 for(const request of requests){
  const current=selection.members.find(m=>m.clientId===request.clientId);
  const atEntry=at(instant(request.dateJoined));
  if(atEntry.head&&atEntry.head.clientId!==selection.head.clientId)ambiguous();
  const entry=atEntry.members.find(m=>m.clientId===request.clientId);
  if(!current||!entry){if(differentHead)ambiguous();return;}
  if(!current.isActive)ambiguous();
  if(matchRelationships){
   if(entry.relationship!==current.relationship||
      !differentHead&&request.relationship!==undefined&&entry.relationship!==request.relationship)ambiguous();
   coverage.push({entry,current});
  }else{
   coverage.push({entry:membership(entry),current:membership(current),entryHead:membership(atEntry.head)});
  }
 }
 if(!differentHead)return {household,coverage};
}
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
const member=(input,checkRelationship)=>{
 fields(input,['clientId','relationship','dateJoined']);
 if(checkRelationship&&!relationships.includes(input.relationship))throw Error('Unavailable household relationship');
 return {clientId:id(input.clientId),...(checkRelationship?{relationship:input.relationship}:{}),dateJoined:instant(input.dateJoined),dateEnded:null,isActive:true};
};
const body=s=>({householdType:s.householdType,householdClients:s.members.map(m=>({clientId:m.clientId,headOfHouseholdStatus:m.head,headOfHouseholdRelationship:m.relationship,dateJoined:m.dateJoined,...(s.householdId?{dateEnded:m.dateEnded,isActive:m.isActive}:{})}))});
const equal=(a,b)=>hash({householdType:a.householdType,members:a.members})===hash({householdType:b.householdType,members:b.members});
// Version-1 journals saved the intended head in the target membership snapshot.
const journalHead=entry=>entry.headClientId??entry.target?.members?.find(member=>member.head)?.clientId;
const unresolved=entry=>!entry.selected&&['planned','attempted'].includes(entry.stage);

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
 const scope=JSON.stringify([tenantScope,'household-management']);
 const loadJournal=async()=>{
  const entries=await store.read(scope);
  if(!Array.isArray(entries)||entries.some(entry=>!entry||entry.version!==1||
     !['planned','attempted','verified','not-applied'].includes(entry.stage)))throw Error('Invalid household journal');
  return entries;
 };
 const matchingNewHousehold=async(entry,headClientId)=>{
  if(!Array.isArray(entry.baselineIds)||entry.baselineIds.some(householdId=>!validId(householdId)))throw Error('Invalid household create baseline');
  if(entry.receiptId!==undefined){
   if(!validId(entry.receiptId)||entry.baselineIds.includes(entry.receiptId))throw Error('Create receipt does not identify a new household');
   const current=await read(entry.receiptId);
   if(!equal(current,entry.target))throw Error('Created household does not match requested membership');
   return current;
  }
  const rows=await list(headClientId,false);
  const matches=rows.filter(row=>!entry.baselineIds.includes(row.householdId)&&row.isActive===true&&
    row.householdType===entry.target.householdType&&row.clients.length===entry.target.members.length&&
    entry.target.members.every(member=>row.clients.some(client=>client.clientId===member.clientId)))
   .map(model).filter(current=>equal(current,entry.target));
  if(matches.length>1)throw Error('Created household not uniquely verified');
  if(!matches.length)return;
  const current=await read(matches[0].householdId);
  if(!equal(current,entry.target))throw Error('Created household detail changed during verification');
  return current;
 };
 const run=async(kind,input,options={})=>{
  fields(options,['reuseContainingHousehold','createSeparateHousehold']);
  const {reuseContainingHousehold,createSeparateHousehold=false}=options;
  if(reuseContainingHousehold!==undefined&&typeof reuseContainingHousehold!=='boolean'&&reuseContainingHousehold!=='membership-only')throw Error('Invalid containing-household reuse mode');
  if(typeof createSeparateHousehold!=='boolean'||createSeparateHousehold&&reuseContainingHousehold)throw Error('Separate creation and containing-household reuse cannot be combined');
  const membershipOnly=reuseContainingHousehold==='membership-only';
  const keys={create:['key','headClientId','householdType','members'],addMembers:['key','householdId','headClientId','householdType','members'],endMembers:['key','householdId','headClientId','clientIds','dateEnded'],updateRelationships:['key','householdId','headClientId','members']};
  fields(input,keys[kind]);id(input.headClientId);if(!validKey(input.key))throw Error('Stable household key required');
  const intent={kind,headClientId:input.headClientId};
  if(reuseContainingHousehold)intent.reuseContainingHousehold=reuseContainingHousehold;
  if(createSeparateHousehold)intent.createSeparateHousehold=true;
  if(kind!=='create')intent.householdId=id(input.householdId);
  if(!membershipOnly&&(kind==='create'||input.householdType!==undefined)){
   if(!types.includes(input.householdType))throw Error('Unavailable household type');
   intent.householdType=input.householdType;
  }
  if(kind==='create'||kind==='addMembers'){
   if(!Array.isArray(input.members)||!input.members.length)throw Error('Members required');intent.members=sorted(input.members.map(input=>member(input,!membershipOnly)));
   if(new Set(intent.members.map(m=>m.clientId)).size!==intent.members.length)throw Error('Duplicate client IDs');
   for(const m of intent.members){
    m.head=m.clientId===input.headClientId;
    if(!membershipOnly&&(m.head?m.relationship!=='Self':m.relationship==='Self'))throw Error('Head changes are not supported');
   }
   if(membershipOnly){
    const head=intent.members.find(member=>member.head);
    if(!head||intent.members.some(member=>member.dateJoined<head.dateJoined))throw Error('Head must cover every membership date');
   }else if(kind==='create')guard(intent.members);
   else if(intent.members.some(m=>m.head))throw Error('Head changes are not supported');
  }else if(kind==='endMembers'){
   if(!Array.isArray(input.clientIds)||!input.clientIds.length)throw Error('Client IDs required');intent.clientIds=input.clientIds.map(id).sort((a,b)=>a-b);intent.dateEnded=instant(input.dateEnded);
   if(new Set(intent.clientIds).size!==intent.clientIds.length)throw Error('Duplicate client IDs');
   if(intent.clientIds.includes(input.headClientId))throw Error('Head cannot leave an active household; household closure is a separate workflow');
  }else{
   if(!Array.isArray(input.members)||!input.members.length)throw Error('Members required');intent.members=sorted(input.members.map(m=>{fields(m,['clientId','relationship']);id(m.clientId);if(m.clientId===input.headClientId||m.relationship==='Self')throw Error('Head changes are not supported');if(!relationships.includes(m.relationship))throw Error('Unavailable household relationship');return {clientId:m.clientId,relationship:m.relationship};}));
   if(new Set(intent.members.map(m=>m.clientId)).size!==intent.members.length)throw Error('Duplicate client IDs');
  }
  const keyHash=hash(input.key),intentHash=hash(intent);
  return store.withLock(scope,async()=>{
   const entries=await loadJournal();
   let entry=entries.find(e=>e.keyHash===keyHash);if(entries.filter(e=>e.keyHash===keyHash).length>1||entry&&entry.intentHash!==intentHash)throw Error('Household key conflicts with earlier intent');
   if(entry?.stage==='not-applied')throw Error('Household create was resolved as not applied; use a new key for an authorized new create');
   for(const other of entries.filter(other=>other.keyHash!==keyHash&&unresolved(other))){
    const otherHead=journalHead(other);
    if(!validId(otherHead))throw Error('Unresolved household journal lacks its original head');
    const otherHouseholdId=other.householdId??other.receiptId;
    if(otherHead===input.headClientId||intent.householdId!==undefined&&intent.householdId===otherHouseholdId){
     throw Error('Another household write is unresolved for this household or head');
    }
   }
   const persist=async stage=>{entry={...entry,version:1,keyHash,intentHash,stage,headClientId:input.headClientId};const i=entries.findIndex(e=>e.keyHash===keyHash);if(i<0)entries.push(entry);else entries[i]=entry;await store.write(scope,structuredClone(entries));};
   let listed;
   if(reuseContainingHousehold&&(!entry||entry.selected||entry.stage==='planned')){
    listed=await list(input.headClientId,!entry);
    const candidates=listed.filter(h=>h.isActive!==false&&(membershipOnly||h.householdType===intent.householdType)&&
      intent.members.every(m=>h.clients.some(c=>c.clientId===m.clientId)));
    const now=new Date().toISOString();
    const covered=candidates.map(h=>coveredHousehold(h,intent.headClientId,intent.members,now,{excludeDifferentHead:true,matchRelationships:!membershipOnly})).filter(Boolean);
    if(covered.length>1||!membershipOnly&&!covered.length&&candidates.length)ambiguous();
    const selected=covered[0];
    if(entry?.selected&&selected?.household.householdId!==entry.householdId||entry&&!entry.selected&&selected)ambiguous();
    if(selected){
     const wasVerified=entry?.stage==='verified';
     const coverageHash=hash(selected.coverage);
     if(entry&&coverageHash!==entry.coverageHash)ambiguous();
     if(!entry){entry={householdId:selected.household.householdId,selected:true,coverageHash};await persist('planned');}
     const fresh=toItems(await api.households.get({path:{householdId:entry.householdId}}));
     if(fresh.length!==1||fresh[0]?.householdId!==entry.householdId||!membershipOnly&&fresh[0].householdType!==intent.householdType)ambiguous();
     const verified=coveredHousehold(fresh[0],intent.headClientId,intent.members,undefined,{matchRelationships:!membershipOnly});
     if(!verified||hash(verified.coverage)!==coverageHash)ambiguous();
     await persist('verified');return {key:input.key,outcome:wasVerified?'already-present':'verified',household:verified.household};
    }
   }
   if(membershipOnly)throw Object.assign(Error('No verified household covers the requested members and head'),{
    code:'HOUSEHOLD_REUSE_NOT_FOUND',nextAction:'staff-review',
   });
   if(entry?.stage==='verified'){
    const current=await read(entry.householdId),latest=entries.filter(e=>e.householdId===entry.householdId&&!e.selected&&e.stage==='verified').at(-1);
    if(guard(current.members)!==input.headClientId||!equal(current,latest.target))throw Error('Household changed since verification; reconcile before continuing');
    return {key:input.key,outcome:'already-present',household:current};
   }
   let current,createBaseline;
   if(kind==='create'){
    if(entry?.stage==='attempted'){
     current=await matchingNewHousehold(entry,input.headClientId);
     if(!current)throw Error('Household write unresolved; refusing another mutation');
    }else{
     const existing=listed??await list(input.headClientId,true);
     createBaseline=existing.map(h=>h.householdId);
     if(!entry){
      entry={target:{householdType:intent.householdType,members:intent.members},baselineIds:createBaseline};
      await persist('planned');
     }
     if(!createSeparateHousehold){
      const possible=existing.filter(h=>h.isActive===true&&(!reuseContainingHousehold||
        h.householdType===intent.householdType&&intent.members.every(m=>h.clients.some(c=>c.clientId===m.clientId))));
      const matches=possible.map(model).filter(h=>equal(h,entry.target));
      if(matches.length>1)throw Error('Multiple matching households');
      current=matches[0];
     }
    }
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
    if(kind==='create')entry.baselineIds=createBaseline;
    await persist('attempted');
    let error;
    if(kind==='create'){
     let response;
     try{response=await api.households.create({body:body(entry.target)});}catch(failure){error=failure;}
     const rows=toItems(response);
     if(rows.length===1&&validId(rows[0]?.householdId)){
      entry.receiptId=rows[0].householdId;
      await persist('attempted');
     }
     try{current=await matchingNewHousehold(entry,input.headClientId);}catch(failure){throw error??failure;}
     if(!current)throw error??Error('Created household not uniquely verified');
    }else{
     try{await api.households.update({path:{householdId:input.householdId},body:body(entry.target)});}catch(failure){error=failure;}
     current=await read(input.householdId);
    }
    if(!equal(current,entry.target))throw error??Error('Household readback mismatch; refusing replay');
   }
   entry.householdId=current.householdId;await persist('verified');return {key:input.key,outcome:'verified',household:current};
  });
 };
 const resolveCreateNotApplied=async input=>{
  fields(input,['key','headClientId','evidenceReference','confirmedNotApplied']);
  id(input.headClientId);
  if(!validKey(input.key)||!validKey(input.evidenceReference)||input.confirmedNotApplied!==true){
   throw Error('Original key, evidence reference and independent confirmation required');
  }
  const keyHash=hash(input.key),evidenceHash=hash(input.evidenceReference);
  return store.withLock(scope,async()=>{
   const entries=await loadJournal();
   const matches=entries.filter(entry=>entry.keyHash===keyHash);
   const entry=matches[0];
   if(matches.length!==1||journalHead(entry)!==input.headClientId||entry.selected||!Array.isArray(entry.baselineIds)||
      !['attempted','not-applied'].includes(entry.stage)||entry.receiptId!==undefined){
    throw Error('A matching unresolved create without a receipt is required');
   }
   if(entry.stage==='not-applied'){
    if(entry.evidenceHash!==evidenceHash)throw Error('Household create resolution evidence changed');
    return {key:input.key,outcome:'already-resolved'};
   }
   const existing=await list(input.headClientId,true);
   if(existing.some(household=>!entry.baselineIds.includes(household.householdId))){
    throw Error('A new household requires reconciliation before resolving this create');
   }
   entry.stage='not-applied';
   entry.evidenceHash=evidenceHash;
   await store.write(scope,structuredClone(entries));
   return {key:input.key,outcome:'not-applied'};
  });
 };
 return {read,resolveCreateNotApplied,create:(input,options)=>run('create',input,options),addMembers:input=>run('addMembers',input),endMembers:input=>run('endMembers',input),updateRelationships:input=>run('updateRelationships',input)};
}
