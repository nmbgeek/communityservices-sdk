import {createHash} from 'node:crypto';
import {apiScope} from './connection.mjs';
import {encodeAnswers,parseRestInstant,toItems,createCatalogWriteLabelResolver,flattenQuestions} from '../dist/esm/index.js';
const field='HUD_RACEETHNICITY';
const positive=n=>Number.isSafeInteger(n)&&n>0;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class RaceEthnicityError extends Error {
  constructor(reason,options){super(`Race and Ethnicity: ${reason}`,options);this.name='RaceEthnicityError';this.code='RACE_ETHNICITY_CONFLICT';this.reason=reason;}
}
const fail=reason=>{throw new RaceEthnicityError(reason);};
export function raceCategoryText(option){
  const code=option?.code;if(typeof code!=='string'||!/^RACE_ETH_COMBO_(?:(?:AIAN|ASN|AFR|HSP|MES|PI|WHI)(?:_(?:AIAN|ASN|AFR|HSP|MES|PI|WHI))*|DK|R|DNC)$/.test(code))fail('unsupported-combination');
  return code.slice(15).replaceAll('_',',');
}
export async function readRaceAnswer(reader,tenant,{clientId,questionId},effectiveDate){
  if(typeof reader?.readRaceEthnicity!=='function')fail('authoritative-reader-required');
  const s=await reader.readRaceEthnicity({clientId,questionId});
  if(s?.source!=='gwt-rpc'||s.tenant!==tenant||s.clientId!==clientId||s.questionId!==questionId||!Array.isArray(s.answers)||s.answers.length>1||s.answers.some(r=>!positive(r.answerId)||r.clientId!==clientId||r.questionId!==questionId||typeof r.effectiveDate!=='string'||!Number.isFinite(parseRestInstant(r.effectiveDate))||r.optionId!==null&&!positive(r.optionId)||typeof r.categoryText!=='string')||new Set(s.answers.map(r=>r.answerId)).size!==s.answers.length)fail('invalid-answer-history');
  const row=s.answers[0]??null;
  if(row&&Math.floor(parseRestInstant(row.effectiveDate)/1000)>Math.floor(parseRestInstant(effectiveDate)/1000))fail('newer-race-answer-exists');
  return row;
}
export function raceAnswerMatches(row,expected,at){return !!row&&row.optionId===expected.optionId&&row.categoryText===expected.categoryText&&Math.floor(parseRestInstant(row.effectiveDate)/1000)===Math.floor(parseRestInstant(at)/1000);}

/** Standard REST writes with a durable journal and authoritative UI-text verification. */
export function createRaceEthnicity({api,enrollmentSession,store,writeLabel}){
  const tenantScope=apiScope(api,enrollmentSession,writeLabel);
  if(typeof enrollmentSession?.readRaceEthnicity!=='function'||!['read','write','withLock'].every(k=>typeof store?.[k]==='function'))fail('reader-and-durable-store-required');
  const run=async(mode,raw)=>{
    const allowed=['key','clientId','assessmentCode','effectiveDate',...(mode==='update'?['answer']:[])];
    if(!raw||Object.keys(raw).some(k=>!allowed.includes(k))||typeof raw.key!=='string'||!raw.key.trim()||raw.key.length>200||!positive(raw.clientId)||typeof raw.assessmentCode!=='string'||!/^[A-Za-z0-9_]+$/.test(raw.assessmentCode)||typeof raw.effectiveDate!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(raw.effectiveDate)||!Number.isFinite(Date.parse(raw.effectiveDate))||new Date(raw.effectiveDate.slice(0,19)+'Z').toISOString().slice(0,19)!==raw.effectiveDate.slice(0,19))fail('invalid-input');
    const input=structuredClone(raw),at=new Date(input.effectiveDate).toISOString();if(Date.parse(at)>Date.now())fail('future-race-write-unsupported');const path={clientId:input.clientId,assessmentCode:input.assessmentCode};
    return store.withLock(JSON.stringify([tenantScope,'enrollment-workflow',input.clientId]),()=>store.withLock(JSON.stringify([tenantScope,'race-ethnicity',input.clientId]),async()=>{
      const scope=JSON.stringify([tenantScope,'race-ethnicity',input.clientId]),records=await store.read(scope),keyHash=hash(input.key);
      if(!Array.isArray(records)||records.some(r=>!r||r.version!==1||!['attempted','verified'].includes(r.stage))||new Set(records.map(r=>r.keyHash)).size!==records.length)fail('invalid-journal');
      let record=records.find(r=>r.keyHash===keyHash);
      if(records.some(r=>r.keyHash!==keyHash&&r.stage==='attempted'))fail('another-write-unresolved');
      const definition=await api.assessments.getDefinition({...path,effectiveDate:at,refresh:true});
      const questions=definition.questions.filter(q=>q.fieldName===field);if(questions.length!==1||questions[0].questionType!=='lookup')fail('race-question-unavailable');
      const question=questions[0],target={clientId:input.clientId,questionId:question.questionId};
      const read=async()=>{
        const rows=toItems(await api.assessments.get({path,query:{dateEffective:new Date(Date.parse(at)+1000).toISOString()}}));
        if(rows.some(q=>typeof q.virt_field_name!=='string')||new Set(rows.map(q=>q.virt_field_name)).size!==rows.length)fail('ambiguous-assessment');
        const race=rows.find(q=>q.virt_field_name===field);if(!race||race.question_id!==question.questionId||race.question_type!=='lookup')fail('race-question-mismatch');
        return {rows,race,ui:await readRaceAnswer(enrollmentSession,api.tenant,target,at)};
      };
      let current=await read();
      const savedOption=question.options.find(o=>String(o.id)===String(current.race.answer_value));
      if(mode==='repair'&&(!savedOption||parseRestInstant(current.race.date_effective)!==Date.parse(at)))fail('repair-requires-existing-answer-at-date');
      const answer=mode==='repair'?{option:{code:savedOption.code}}:input.answer;
      const [numeric]=encodeAnswers(definition.questions,{[field]:answer},{endpoint:'mobile'});
      const option=question.options.find(o=>String(o.id)===numeric?.answer_value);if(!option)fail('combination-unavailable');
      const expected={optionId:option.id,categoryText:raceCategoryText(option)};
      const intentHash=hash([mode,input.clientId,input.assessmentCode,at,expected]);
      if(record&&record.intentHash!==intentHash)fail('intent-changed');
      const protectedHash=rows=>hash(rows.filter(q=>q.virt_field_name!==field).map(q=>({field:q.virt_field_name,value:q.answer_value??null,rows:q.sub_assessment_answer_list??null})).sort((a,b)=>a.field.localeCompare(b.field)));
      const matches=()=>raceAnswerMatches(current.ui,expected,at)&&String(current.race.answer_value)===String(expected.optionId)&&parseRestInstant(current.race.date_effective)===Date.parse(at);
      if(record&&protectedHash(current.rows)!==record.protectedHash)fail('other-answers-changed');
      const result=outcome=>({clientId:input.clientId,requestedEffectiveDate:at,effectiveDate:current.ui.effectiveDate,...expected,answerId:current.ui.answerId,outcome});
      const persist=async stage=>{record={...record,version:1,keyHash,intentHash,stage,protectedHash:record?.protectedHash??protectedHash(current.rows)};const i=records.findIndex(r=>r.keyHash===keyHash);if(i<0)records.push(record);else records[i]=record;await store.write(scope,structuredClone(records));};
      if(matches()){const outcome=record?.stage==='attempted'?'reconciled':'already-present';if(record?.answerId&&current.ui.answerId!==record.answerId)fail('answer-identity-changed');record={...record,answerId:current.ui.answerId};await persist('verified');return result(outcome);}
      if(record)fail('write-unresolved-or-value-changed');
      let resolver=writeLabel;
      if(!resolver){
        if(typeof enrollmentSession.readPicklistOptions!=='function')fail('write-label-reader-required');
        const ids=[...new Set(flattenQuestions(definition.questions).flatMap(({question:q})=>q.questionType==='lookup'?q.options.map(o=>o.id):[]))];
        resolver=createCatalogWriteLabelResolver(definition,await enrollmentSession.readPicklistOptions({clientId:input.clientId,optionIds:ids}));
      }
      const body=encodeAnswers(definition.questions,{[field]:answer},{endpoint:'standalone',writeLabel:resolver});
      for(const q of definition.questions.filter(q=>q.mandatory&&q.fieldName!==field&&!['blank','label','sub_assessment'].includes(q.questionType))){
        if(q.questionType!=='lookup')fail('unsupported-mandatory-field');
        const previous=current.rows.find(r=>r.virt_field_name===q.fieldName);if(!previous)fail('mandatory-read-unavailable');
        let label='';if(previous.answer_value!==null&&previous.answer_value!==undefined&&previous.answer_value!==''){
          const o=q.options.find(o=>String(o.id)===String(previous.answer_value));label=o?resolver(q,o):undefined;if(!label)fail('mandatory-label-unavailable');
        }
        body.push({question_id:q.questionId,question_type:q.questionType,virt_field_name:q.fieldName,answer_value:label});
      }
      const beforeId=current.ui&&parseRestInstant(current.ui.effectiveDate)===Date.parse(at)?current.ui.answerId:null;
      record={answerId:beforeId};await persist('attempted');let failure;
      try{await api.assessments.create({path,query:{dateEffective:at},body});}catch(error){failure=error;}
      current=await read();
      if(!matches()||protectedHash(current.rows)!==record.protectedHash)throw new RaceEthnicityError('write-unresolved',{cause:failure});
      record.answerId=current.ui.answerId;await persist('verified');return result(failure?'reconciled':'verified');
    }));
  };
  return {update:input=>run('update',input),repair:input=>run('repair',input)};
}
