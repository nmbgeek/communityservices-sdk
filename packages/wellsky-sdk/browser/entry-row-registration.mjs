import {createHash} from 'node:crypto';
import {parseRestInstant,toItems} from '../dist/esm/index.js';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const positive=v=>Number.isSafeInteger(v)&&v>0;

/** Registers caller-selected existing identities locally; never writes an assessment. */
export function createEntryRowRegistrar({api,store,enrollmentSession,discover,scope,reservationScope,makeError}){
 const fail=(code,reason)=>{throw makeError(reason,{code,committed:false});};
 const key=v=>typeof v==='string'&&!!v.trim()&&v.length<=200;
 return async raw=>{
  if(!object(raw)||Object.keys(raw).some(k=>!['key','enrollmentKey','clientId','rows'].includes(k))||!key(raw.key)||!key(raw.enrollmentKey)||!positive(raw.clientId)||!Array.isArray(raw.rows)||!raw.rows.length)fail('ROW_REGISTRATION_INPUT_INVALID','valid registration key, entry key, client and explicit rows required');
  if(typeof enrollmentSession?.readEnrollment!=='function')fail('ROW_REGISTRATION_READER_REQUIRED','authoritative enrollment reader required');
  const input=structuredClone(raw);input.rows.sort((a,b)=>String(a?.key).localeCompare(String(b?.key)));
  const keys=new Set(),ids=new Set();
  for(const row of input.rows){
   if(!object(row)||Object.keys(row).some(k=>!['key','parentField','recordsetId'].includes(k))||!key(row.key)||!key(row.parentField)||!positive(row.recordsetId)||keys.has(row.key)||ids.has(row.recordsetId))fail('ROW_REGISTRATION_INPUT_INVALID','unique row keys, parents and positive recordset IDs required');
   keys.add(row.key);ids.add(row.recordsetId);
  }
  return store.withLock(scope(input.clientId),async()=>{
   const reservations=await store.withLock(reservationScope(input.clientId),()=>store.read(reservationScope(input.clientId)));
   if(!Array.isArray(reservations)||reservations.some(r=>r.stage!=='verified'))fail('WORKFLOW_PENDING','unfinished household workflow must be reconciled first');
   const records=await store.read(scope(input.clientId));
   if(!Array.isArray(records)||records.some(r=>r.version!==1||!object(r.steps)))fail('WORKFLOW_JOURNAL_INVALID','invalid workflow journal');
   if(records.some(r=>r.stage!=='verified'&&!(r.kind==='correction'&&r.stage==='rejected')))fail('WORKFLOW_PENDING','unfinished workflow must be reconciled first');
   const entries=records.filter(r=>r.key===input.enrollmentKey&&r.kind==='entry'&&r.stage==='verified');
   if(entries.length!==1)fail('ROW_REGISTRATION_ENTRY_REQUIRED','verified enrollment workflow required');const entry=entries[0];
   const prior=Object.hasOwn(entry.rowRegistrations??{},input.key)?entry.rowRegistrations[input.key]:undefined,intentHash=hash(input);
   if(prior&&prior.intentHash!==intentHash)fail('ROW_REGISTRATION_INTENT_CONFLICT','registration key conflicts with previous intent');
   const target={clientId:input.clientId,enrollmentId:entry.enrollmentId},at=entry.context.entryDate;
   const verifyEnrollment=async()=>{
    const s=await enrollmentSession.readEnrollment(target);
    if(s?.source!=='gwt-rpc'||s.tenant!==api.tenant||s.clientId!==target.clientId||s.enrollmentId!==target.enrollmentId||s.providerId!==entry.context.providerId||s.enrollmentType!==entry.context.type||parseRestInstant(s.projectStartDate)!==parseRestInstant(at))fail('ROW_REGISTRATION_CONTEXT_MISMATCH','enrollment identity changed during row registration');
   };
   await verifyEnrollment();
   const discovered=await discover({...entry.context}),definition=discovered.entry.definition;
   const schemaHash=hash({providerId:discovered.provider.providerId,entry:{assessment:discovered.entry.assessment,questions:definition.questions},interim:{assessment:discovered.interim.assessment,questions:discovered.interim.definition.questions}});
   if(schemaHash!==entry.schemaHash)fail('WORKFLOW_SCHEMA_CHANGED','program assessment configuration changed');
   const rowMap=entry.rows??{},parents=entry.rowParents??{};
   for(const row of input.rows){
    if(!definition.questions.some(q=>q.fieldName===row.parentField&&q.questionType==='sub_assessment'))fail('ROW_REGISTRATION_PARENT_INVALID','subassessment parent not in entry definition');
    if(Object.hasOwn(rowMap,row.key)&&(rowMap[row.key]!==row.recordsetId||!Object.hasOwn(parents,row.key))||Object.entries(rowMap).some(([key,id])=>key!==row.key&&id===row.recordsetId)||Object.hasOwn(parents,row.key)&&parents[row.key]!==row.parentField)fail('ROW_REGISTRATION_BINDING_CONFLICT','row key or recordset is already bound differently');
   }
   const verifyRows=async effectiveDate=>{
    const response=toItems(await api.assessments.get({path:{clientId:input.clientId,assessmentCode:entry.assessmentCode},query:{dateEffective:effectiveDate}}));
    for(const row of input.rows){
     const parent=response.filter(p=>p?.virt_field_name===row.parentField&&p.question_type==='sub_assessment');
     if(parent.length!==1||!Array.isArray(parent[0].sub_assessment_answer_list))fail('ROW_REGISTRATION_READ_UNAVAILABLE','complete row registration read required');
     const matches=parent[0].sub_assessment_answer_list.filter(r=>r?.recordset_id===row.recordsetId);
     if(matches.length!==1||!Array.isArray(matches[0].sub_assessment_list))fail('ROW_REGISTRATION_ROW_MISSING','selected row is missing or ambiguous at the entry date or current read');
    }
   };
   await verifyRows(at);await verifyRows(new Date(Math.max(Date.now(),parseRestInstant(at)+1000)).toISOString());await verifyEnrollment();
   entry.rows=Object.fromEntries([...Object.entries(rowMap),...input.rows.map(r=>[r.key,r.recordsetId])]);
   entry.rowParents=Object.fromEntries([...Object.entries(parents),...input.rows.map(r=>[r.key,r.parentField])]);
   entry.rowRegistrations=Object.fromEntries([...Object.entries(entry.rowRegistrations??{}),[input.key,{intentHash,rows:input.rows}]]);
   await store.write(scope(input.clientId),structuredClone(records));
   return {key:input.key,enrollmentKey:input.enrollmentKey,clientId:input.clientId,enrollmentId:entry.enrollmentId,outcome:prior?'already-present':'verified',recordsetIds:structuredClone(entry.rows)};
  });
 };
}
