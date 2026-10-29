import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {toItems} from '../dist/esm/index.js';
const digest=v=>createHash('sha256').update(JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)).digest('hex');
const id=n=>{if(!Number.isSafeInteger(n)||n<1)throw Error('Positive record ID required');return n;};
const configs={
 note:{id:'client_note_id',client:'client_id',active:'active',fields:['note_date','note'],required:['note_date','note'],dates:['note_date']},
 goal:{id:'goalId',client:'clientId',active:'isActive',fields:['providerId','dateGoalsSet','classification','type','targetDate','overallStatus','outcome','outcomeDate','projectFollowupDate','followupMade','followupUser','percentComplete','caseManager','goalDescription'],required:['providerId','dateGoalsSet','classification','type','overallStatus','goalDescription'],dates:['dateGoalsSet','targetDate','outcomeDate','projectFollowupDate']},
 action:{id:'goalActionStepId',client:'clientId',active:'isActive',fields:['providerId','dateSet','actionStep','targetDate','status','outcome','outcomeDate','followupOutcome'],required:['providerId','dateSet','actionStep','status'],dates:['dateSet','targetDate','outcomeDate']},
};
const instant=s=>{if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s.slice(0,19)+'Z').toISOString().slice(0,19)!==s.slice(0,19))throw Error('Valid timezone-qualified record date required');return new Date(s).toISOString();};
const serverDate=s=>instant(/(?:Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'Z');
const normalize=(kind,row)=>{
 const c=configs[kind],values={};
 for(const k of c.fields){const value=row[kind==='action'&&k==='actionStep'?'actionstep':k];values[k]=c.dates.includes(k)?value?serverDate(value):null:k==='followupMade'?value??false:k==='providerId'?value:value??'';}
 return values;
};
const matches=(values,expected)=>Object.entries(expected).every(([k,v])=>values[k]===v);
/** Journaled single-client notes, goals and action steps. Each write is read back field by field.
 * Goal response household arrays are intentionally ignored. This is not a household mutation. */
export function createCasePlans({api,store,ui}){
 const tenantScope=apiScope(api, ui);
 if(!store?.withLock||!ui?.confirmEmpty)throw Error('REST API, durable store and case-plan UI reader required');
 const goal=async(clientId,goalId)=>{const rows=toItems(await api.goals.get({path:{goalId}}));if(rows.length!==1||rows[0].goalId!==goalId||rows[0].clientId!==clientId||rows[0].isActive!==true)throw Error('Goal ownership or active state mismatch');return rows[0];};
 const list=async(kind,clientId,goalId,initial)=>{
  if(kind==='action'){const g=await goal(clientId,goalId);if(!Array.isArray(g.actionSteps))throw Error('Action steps unavailable');return g.actionSteps;}
  const rows=[];let count;
  for(let startPage=1;startPage<=100;startPage++){
   let r;const query={perPage:100,startPage,total_count:true};
   try{r=kind==='note'?await api.clientNotes.list({query:{...query,query:`client_id eq ${clientId}`}}):await api.goals.listForClient({path:{clientId},query});}
   catch(e){if(initial&&startPage===1&&e.status===404&&await ui.confirmEmpty({kind,clientId}))return [];throw e;}
   if(!Number.isSafeInteger(r?.count)||r.count<0||!Array.isArray(r.values)||count!==undefined&&count!==r.count)throw Error('Record list count unavailable or changed');count=r.count;rows.push(...r.values);
   if(rows.length===count)return rows;if(!r.values.length||rows.length>count)throw Error('Incomplete record list');
  }throw Error('Record list exceeds safety limit');
 };
 const run=async(kind,mode,input)=>{
  const c=configs[kind];if(!input||Object.keys(input).some(k=>!['key','clientId','goalId','recordId','values'].includes(k))||typeof input.key!=='string'||!input.key.trim()||input.key.length>500)throw Error('Stable case-plan source key and supported fields required');
  const clientId=id(input.clientId);if(kind==='action')id(input.goalId);else if(input.goalId!==undefined)throw Error('goalId only belongs to action steps');
  if(mode==='update')id(input.recordId);else if(input.recordId!==undefined)throw Error('Create cannot specify recordId');
  const values=structuredClone(input.values);if(!values||Array.isArray(values)||!Object.keys(values).length||Object.keys(values).some(k=>!c.fields.includes(k)))throw Error('Unsupported case-plan values');
  if(c.required.some(k=>(mode==='create'||k in values)&&(values[k]===undefined||values[k]===null||values[k]==='')))throw Error('Required case-plan values missing');
  for(const [k,v]of Object.entries(values)){
   if(c.dates.includes(k))values[k]=v===null?null:instant(v);
   else if(k==='providerId')id(v);else if(k==='followupMade'){if(typeof v!=='boolean')throw Error('followupMade must be boolean');}
   else if(typeof v!=='string'||v.length>100000||v.includes('\0'))throw Error('Invalid case-plan text');
  }
  if(kind==='goal'&&'percentComplete' in values&&values.percentComplete!==''&&!/^[1-9]0%$/.test(values.percentComplete))throw Error('Percent complete must be a UI label from 10% through 90%, or empty');
  const intent={kind,mode,clientId,goalId:input.goalId,recordId:input.recordId,values};const keyHash=digest(input.key),intentHash=digest(intent),scope=JSON.stringify([tenantScope,'case-plans',clientId]);
  return store.withLock(scope,async()=>{
   const entries=await store.read(scope);if(!Array.isArray(entries)||entries.some(e=>e.version!==1||!['planned','attempted','verified'].includes(e.stage)))throw Error('Invalid case-plan journal');
   let e=entries.find(v=>v.keyHash===keyHash);if(entries.filter(v=>v.keyHash===keyHash).length>1||e&&e.intentHash!==intentHash)throw Error('Case-plan key conflicts with earlier intent');
   if(entries.some(v=>v.keyHash!==keyHash&&v.stage!=='verified'))throw Error('Another case-plan write is unresolved');
   const persist=async stage=>{e={...e,version:1,keyHash,intentHash,kind,goalId:input.goalId,stage};const i=entries.findIndex(v=>v.keyHash===keyHash);if(i<0)entries.push(e);else entries[i]=e;await store.write(scope,structuredClone(entries));};
   const readAll=async initial=>{
    const rows=await list(kind,clientId,input.goalId,initial),ids=new Set();
    for(const r of rows){id(r[c.id]);if(ids.has(r[c.id])||r[c.client]!==clientId||kind==='action'&&r.goalId!==input.goalId)throw Error('Record list ownership or duplicate ID mismatch');ids.add(r[c.id]);}
    return rows.filter(r=>r[c.active]===true);
   };
   let rows=await readAll(!e),current;
   if(e?.recordId||mode==='update')current=rows.find(r=>r[c.id]===(e?.recordId??input.recordId));
   else {const found=rows.filter(r=>matches(normalize(kind,r),values));if(found.length>1)throw Error('Duplicate matching records require review');current=found[0];}
   if(e?.stage==='verified'){
    const latest=entries.filter(v=>v.kind===kind&&v.recordId===e.recordId&&v.stage==='verified').at(-1);
    if(!current||!matches(normalize(kind,current),latest.target))throw Error('Record changed since verification; refusing replay');return {key:input.key,recordId:e.recordId,kind,outcome:'already-present',values:normalize(kind,current)};
   }
   if(!e){
    if(mode==='update'&&!current)throw Error('Active record required for update');
    const baseline=current?normalize(kind,current):null;e={baseline,recordId:current?.[c.id],target:mode==='update'?{...baseline,...values}:values};await persist('planned');
   }
   if(!current||!matches(normalize(kind,current),e.target)){
    if(e.stage!=='planned')throw Error('Record write unresolved; refusing another mutation');
    if(mode==='update'&&(!current||!matches(normalize(kind,current),e.baseline)))throw Error('Record changed before update');
    const body=mode==='update'?e.target:values;
    const clients=toItems(await api.clients.get({path:{clientId}}));if(clients.length!==1||clients[0].clientId!==clientId||clients[0].isActive!==true)throw Error('Active client required');
    await persist('attempted');let failure;
    try{
     if(kind==='note'){if(mode==='create')await api.clientNotes.create({body:{client_id:clientId,...body}});else await api.clientNotes.update({query:{clientNoteId:input.recordId},body});}
     if(kind==='goal'){if(mode==='create')await api.goals.create({body:{clientId,...body}});else await api.goals.update({path:{goalId:input.recordId},body:{clientId,...body}});}
     if(kind==='action'){if(mode==='create')await api.goals.createAction({path:{goalId:input.goalId},body:{clientId,...body}});else await api.goals.updateAction({path:{goalActionStepId:input.recordId},body});}
    }catch(error){failure=error;}
    rows=await readAll(false);
    const found=rows.filter(r=>(mode==='create'||r[c.id]===input.recordId)&&matches(normalize(kind,r),e.target));
    if(found.length!==1)throw failure??Error('Record not uniquely verified; journal blocks replay');current=found[0];
   }
   e.recordId=current[c.id];e.target=normalize(kind,current);await persist('verified');return {key:input.key,recordId:e.recordId,kind,outcome:'verified',values:e.target};
  });
 };
 return {createClientNote:i=>run('note','create',i),updateClientNote:i=>run('note','update',i),createGoal:i=>run('goal','create',i),updateGoal:i=>run('goal','update',i),createActionStep:i=>run('action','create',i),updateActionStep:i=>run('action','update',i)};
}
