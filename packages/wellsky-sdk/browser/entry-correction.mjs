import {createHash} from 'node:crypto';
import {encodeAnswers,parseRestInstant,toItems} from '../dist/esm/index.js';

const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const canonical=v=>JSON.stringify(v,(_,x)=>object(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const positive=v=>Number.isSafeInteger(v)&&v>0;
const scalarTypes=new Set(['lookup','yes_no','date','int','money','textbox','textarea']);

/** Internal correction writer. The workflow supplies its existing client locks and journal scopes. */
export function createEntryCorrector({api,store,enrollmentSession,writeLabel,discover,scope,reservationScope,makeError}){
 const fail=reason=>{throw makeError(reason);};
 const fields=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('unknown or invalid correction fields');};
 const key=v=>{if(typeof v!=='string'||!v.trim()||v.length>200)fail('stable correction key required');};
 const value=(type,v)=>{
  if(v===null||v===undefined||v==='')return null;
  if(type==='date'){const n=parseRestInstant(v);if(!Number.isFinite(n))fail('invalid stored correction date');return n;}
  if(type==='int'||type==='money'){const n=Number(v);if(!Number.isFinite(n))fail('invalid stored correction number');return n;}
  return String(v);
 };
 const encode=(questions,answers,clear,endpoint)=>{
  if(!object(answers)||!Array.isArray(clear)||new Set(clear).size!==clear.length||clear.some(f=>typeof f!=='string'||Object.hasOwn(answers,f)))fail('invalid or conflicting correction answers and clears');
  const index=new Map(questions.map(q=>[q.fieldName,q]));
  for(const field of [...Object.keys(answers),...clear]){
   const q=index.get(field);
   if(!q||!scalarTypes.has(q.questionType)||endpoint==='mobile'&&q.questionType==='yes_no')fail('unsupported correction field type');
   if(['SVPPROFDOB','HUD_RELATIONTOHOH'].includes(field))fail('DOB and household head corrections require their dedicated workflows');
  }
  const body=encodeAnswers(questions,answers,{endpoint,writeLabel});
  if(body.length!==Object.keys(answers).length)fail('correction answer could not be encoded');
  for(const q of body)if(q.question_type==='date'&&q.answer_value){const day=q.answer_value.slice(0,10);if(!Number.isFinite(parseRestInstant(q.answer_value))||!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)fail('invalid correction date');}
  for(const field of clear){const q=index.get(field);body.push({question_id:q.questionId,question_type:q.questionType,virt_field_name:field,answer_value:''});}
  return body;
 };
 const expected=(questions,body,answers)=>body.map(q=>{
  if(q.question_type!=='lookup'||q.answer_value==='')return q;
  const encoded=encodeAnswers(questions,{[q.virt_field_name]:answers[q.virt_field_name]},{endpoint:'mobile'});
  if(encoded.length!==1)fail('correction lookup could not be resolved');return encoded[0];
 });
 const readQuestions=async(clientId,assessmentCode,at)=>{
  const rows=toItems(await api.assessments.get({path:{clientId,assessmentCode},query:{dateEffective:at}}));
  if(rows.some(q=>!object(q)||typeof q.virt_field_name!=='string')||new Set(rows.map(q=>q.virt_field_name)).size!==rows.length)fail('ambiguous correction assessment read');
  return rows;
 };
 return async raw=>{
  fields(raw,['key','enrollmentKey','clientId','answers','clear','subassessments']);
  const input=structuredClone(raw);key(input.key);key(input.enrollmentKey);
  if(!positive(input.clientId)||!Array.isArray(input.subassessments??[]))fail('invalid correction client or rows');
  if(typeof api.assessments?.create!=='function'||typeof enrollmentSession?.readEnrollment!=='function')fail('standard assessment writes and authoritative enrollment reader required for corrections');
  return store.withLock(scope(input.clientId),async()=>{
   const reservations=await store.withLock(reservationScope(input.clientId),()=>store.read(reservationScope(input.clientId)));
   if(!Array.isArray(reservations)||reservations.some(r=>r.stage!=='verified'))fail('unfinished household workflow must be reconciled first');
   const records=await store.read(scope(input.clientId));
   if(!Array.isArray(records)||records.some(r=>!object(r)||r.version!==1||!object(r.steps)))fail('invalid workflow journal');
   if(records.some(r=>r.stage!=='verified'&&r.key!==input.key))fail('another unfinished workflow must be reconciled first');
   const entries=records.filter(r=>r.kind==='entry'&&r.key===input.enrollmentKey&&r.stage==='verified');
   if(entries.length!==1)fail('verified enrollment workflow required');const entry=entries[0];
   const matches=records.filter(r=>r.key===input.key);if(matches.length>1)fail('duplicate correction journal keys');let record=matches[0];
   const intentHash=hash(input);if(record&&(record.kind!=='correction'||record.intentHash!==intentHash))fail('correction key conflicts with previous intent');
   if(!record&&records.some(r=>r.enrollmentId===entry.enrollmentId&&!['entry','correction'].includes(r.kind)))fail('entry correction must precede interim or exit workflows');
   const {providerId,type,entryDate}=entry.context,at=new Date(parseRestInstant(entryDate)).toISOString(),readAt=new Date(parseRestInstant(at)+1000).toISOString();
   const target={clientId:input.clientId,enrollmentId:entry.enrollmentId};
   const verifyEnrollment=async()=>{
    const s=await enrollmentSession.readEnrollment(target);
    if(s?.source!=='gwt-rpc'||s.tenant!==api.tenant||s.clientId!==target.clientId||s.enrollmentId!==target.enrollmentId||s.providerId!==providerId||s.enrollmentType!==type||parseRestInstant(s.projectStartDate)!==parseRestInstant(at)||!Array.isArray(s.members)||s.members.filter(m=>m.clientId===target.clientId&&m.enrollmentId===target.enrollmentId).length!==1)fail('entry correction enrollment context mismatch');
    const exits=s.exits?.filter(e=>e.clientId===target.clientId&&e.enrollmentId===target.enrollmentId);
    if(exits?.length!==1||exits[0].projectExitDate!==null||!Array.isArray(s.reviews)||s.reviews.length)fail('entry correction requires an open enrollment without reviews');
   };
   await verifyEnrollment();
   const discovered=await discover({clientId:input.clientId,providerId,type,entryDate:at});
   const schemaHash=hash({providerId:discovered.provider.providerId,entry:{assessment:discovered.entry.assessment,questions:discovered.entry.definition.questions},interim:{assessment:discovered.interim.assessment,questions:discovered.interim.definition.questions}});
   if(schemaHash!==entry.schemaHash||record&&schemaHash!==record.schemaHash)fail('program assessment configuration changed');
   const definition=discovered.entry.definition,code=definition.assessmentCode;
   const snapshot=async()=>{
    const raw=await readQuestions(input.clientId,code,readAt),current=await readQuestions(input.clientId,code,new Date(Math.max(Date.now(),parseRestInstant(readAt))).toISOString());
    const scalars={},rows={};
    for(const q of definition.questions){
     if(['blank','label'].includes(q.questionType))continue;
     if(q.questionType!=='sub_assessment'){
      const actual=raw.find(r=>r.virt_field_name===q.fieldName);if(!actual)fail('correction scalar read missing');
      const date=actual.date_effective?parseRestInstant(actual.date_effective):null;if(date!==null&&!Number.isFinite(date))fail('invalid correction effective date');
      scalars[q.fieldName]={type:q.questionType,value:value(q.questionType,actual.answer_value),date};
      continue;
     }
     const parent=current.find(r=>r.virt_field_name===q.fieldName);if(!parent||!Array.isArray(parent.sub_assessment_answer_list??[]))fail('correction subassessment read missing');
     rows[q.fieldName]={};
     for(const row of parent.sub_assessment_answer_list??[]){
      if(!positive(row.recordset_id)||Object.hasOwn(rows[q.fieldName],row.recordset_id)||!Array.isArray(row.sub_assessment_list))fail('ambiguous correction row');
      const cells={};
      for(const child of q.children){
       if(['label','blank'].includes(child.questionType))continue;
       const found=row.sub_assessment_list.filter(c=>c.virt_field_name===child.fieldName);if(found.length>1||found[0]&&found[0].question_type!==child.questionType)fail('ambiguous correction row cell');
       cells[child.fieldName]={type:child.questionType,value:value(child.questionType,found[0]?.answer_value)};
      }
      if(row.sub_assessment_list.some(c=>!q.children.some(child=>child.fieldName===c.virt_field_name)))fail('correction row metadata incomplete');
      rows[q.fieldName][row.recordset_id]=cells;
     }
    }
    return {raw,scalars,rows};
   };
   const observed=await snapshot();
   const readOverrides=state=>{
    for(const q of Object.values(entry.correctedScalars??{})){
     const actual=state.scalars[q.virt_field_name];if(!actual||actual.value!==value(q.question_type,q.answer_value)||actual.value!==null&&actual.date!==parseRestInstant(at))fail('verified entry correction changed');
    }
    for(const [parent,group]of Object.entries(entry.correctedRows??{}))for(const [id,cells]of Object.entries(group))for(const q of Object.values(cells))if(state.rows[parent]?.[id]?.[q.virt_field_name]?.value!==value(q.question_type,q.answer_value))fail('verified row correction changed');
   };
   const result=outcome=>({key:input.key,enrollmentKey:input.enrollmentKey,outcome,clientId:input.clientId,enrollmentId:entry.enrollmentId,assessmentCode:code,effectiveDate:at,recordsetIds:structuredClone(entry.rows)});
   if(record?.stage==='verified'){readOverrides(observed);return result('already-present');}
   if(!record){
    readOverrides(observed);
    const answers=input.answers??{},clear=input.clear??[];
    const scalarBody=encode(definition.questions,answers,clear,'standalone'),scalarExpected=expected(definition.questions,scalarBody,answers);
    // The standard endpoint requires every mandatory scalar, even if this patch leaves it unchanged.
    if(scalarBody.length)for(const q of definition.questions.filter(q=>q.mandatory&&!['label','blank','sub_assessment'].includes(q.questionType)&&!scalarBody.some(c=>c.virt_field_name===q.fieldName))){
     if(q.fieldName==='SVPPROFDOB'||!scalarTypes.has(q.questionType))fail('unsupported mandatory correction field');
     const prior=observed.raw.find(r=>r.virt_field_name===q.fieldName);
     if(prior?.answer_value===null||prior?.answer_value===undefined||prior?.answer_value==='')fail('mandatory correction field requires an explicit answer or clear');
     let body;
     if(q.questionType==='lookup'){
      const options=q.options.filter(o=>String(o.id)===String(prior.answer_value)),label=options.length===1?writeLabel?.(q,options[0]):undefined;
      if(!label)fail('mandatory correction lookup label unavailable');
      body=[{question_id:q.questionId,question_type:q.questionType,virt_field_name:q.fieldName,answer_value:label}];
     }else body=encodeAnswers([q],{[q.fieldName]:{value:prior.answer_value}},{endpoint:'standalone',writeLabel});
     if(body.length!==1)fail('mandatory correction field could not be encoded');scalarBody.push(body[0]);
     scalarExpected.push({...body[0],answer_value:prior.answer_value});
    }
    const rowPlans=[],ids=new Set();
    for(const patch of input.subassessments??[]){
     fields(patch,['key','parentField','answers','clear']);key(patch.key);
     const id=entry.rows[patch.key],parent=definition.questions.find(q=>q.fieldName===patch.parentField&&q.questionType==='sub_assessment');
     if(!positive(id)||ids.has(id)||!parent||!observed.rows[parent.fieldName]?.[id])fail('correction requires an existing entry row key and matching parent');ids.add(id);
     const cells=encode(parent.children,patch.answers??{},patch.clear??[],'mobile');if(!cells.length)fail('empty row correction');
     rowPlans.push({id,parentField:parent.fieldName,questionId:parent.questionId,cells});
    }
    if(!scalarBody.length&&!rowPlans.length)fail('empty entry correction');
    record={version:1,key:input.key,kind:'correction',enrollmentKey:input.enrollmentKey,intentHash,schemaHash,context:structuredClone(entry.context),enrollmentId:entry.enrollmentId,assessmentCode:code,stage:'pending',steps:{},rows:structuredClone(entry.rows),before:{scalars:observed.scalars,rows:observed.rows},scalarBody,scalarExpected,rowPlans};records.push(record);
   }
   const persist=()=>store.write(scope(input.clientId),structuredClone(records));await persist();
   const inspect=async(candidate,complete=false)=>{
    const state=await snapshot(),want=structuredClone(record.before);
    if(complete||candidate==='scalars'||record.steps.scalars?.state==='verified')for(const q of record.scalarExpected)want.scalars[q.virt_field_name]={type:q.question_type,value:value(q.question_type,q.answer_value),date:parseRestInstant(at)};
    for(const plan of record.rowPlans)if(complete||candidate==='row:'+plan.id||record.steps['row:'+plan.id]?.state==='verified')for(const q of plan.cells)want.rows[plan.parentField][plan.id][q.virt_field_name]={type:q.question_type,value:value(q.question_type,q.answer_value)};
    const scalarsMatch=Object.keys(state.scalars).length===Object.keys(want.scalars).length&&Object.entries(want.scalars).every(([field,e])=>{const a=state.scalars[field];return a&&a.type===e.type&&a.value===e.value&&(e.value===null||a.date===e.date);});
    return scalarsMatch&&canonical(state.rows)===canonical(want.rows);
   };
   const step=async(name,submit)=>{
    if(await inspect(name)){record.steps[name]={state:'verified'};await persist();return;}
    if(record.steps[name])throw makeError('uncertain entry correction requires reconciliation',{step:name});
    if(!await inspect(null))fail('entry changed since correction preflight');
    await verifyEnrollment();record.steps[name]={state:'attempted'};await persist();let cause;
    try{await submit();}catch(e){cause=e;}
    if(!await inspect(name))throw makeError('uncertain entry correction requires reconciliation',{step:name,cause});
    record.steps[name]={state:'verified'};await persist();
   };
   if(record.scalarBody.length)await step('scalars',()=>api.assessments.create({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:at},body:record.scalarBody}));
   for(const plan of record.rowPlans)await step('row:'+plan.id,()=>api.assessmentsMobile.addAnswer({path:{clientId:input.clientId,assessmentCode:code},query:{dateEffective:at},body:[{question_id:plan.questionId,question_type:'sub_assessment',virt_field_name:plan.parentField,answer_value:'',subAssessmentQuestionAnswers:[{recordset_id:plan.id,isDeleted:false,subAssessments:plan.cells}]}]}));
   if(!await inspect(null,true))fail('entry correction did not verify');await verifyEnrollment();
   entry.correctedScalars??={};for(const q of record.scalarExpected)entry.correctedScalars[q.virt_field_name]=q;
   entry.correctedRows??={};for(const plan of record.rowPlans){entry.correctedRows[plan.parentField]??={};entry.correctedRows[plan.parentField][plan.id]??={};for(const q of plan.cells)entry.correctedRows[plan.parentField][plan.id][q.virt_field_name]=q;}
   record.stage='verified';await persist();return result('verified');
  });
 };
}
