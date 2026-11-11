import type {AssessmentDefinition,PicklistOption,QuestionDefinition} from './metadata.js';
import {flattenQuestions} from './metadata.js';
import type {EncodingOptions} from './encoding.js';
import {ValidationError} from './errors.js';
import {isRecord} from './validation.js';

export interface WriteLabelObservation {tenant:string;response:unknown;}
export type ReadBackWriteLabelResolver = NonNullable<EncodingOptions['writeLabel']> & {readonly tenant:string};

/** Builds labels only from exact readback evidence. It never infers HUD suffixes.
 * Unobserved or changed options return undefined, so the standard encoder refuses them. */
export function createReadBackWriteLabelResolver(
 definition:AssessmentDefinition,
 observations:readonly WriteLabelObservation[],
):ReadBackWriteLabelResolver{
 const questions=new Map<number,QuestionDefinition>();
 for(const {question} of flattenQuestions(definition.questions)){
  if(question.questionType!=='lookup')continue;
  const prior=questions.get(question.questionId);
  if(prior&&JSON.stringify(prior)!==JSON.stringify(question))throw new ValidationError('ambiguous write-label question');
  questions.set(question.questionId,structuredClone(question));
 }
 const labels=new Map<string,string>();
 const identity=(questionId:number,optionId:number)=>JSON.stringify([questionId,optionId]);
 const visit=(value:unknown,depth=0):void=>{
  if(depth>40)throw new ValidationError('write-label observation exceeds nesting limit');
  if(Array.isArray(value)){for(const child of value)visit(child,depth+1);return;}
  if(!isRecord(value))return;
  if(value.question_type==='lookup'&&typeof value.question_id==='number'){
   const question=questions.get(value.question_id);
   if(question){
    if(value.virt_field_name!==question.fieldName)throw new ValidationError('write-label question identity mismatch');
    const raw=value.answer_value;
    const id=typeof raw==='number'?raw:typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):null;
    if(id!==null&&Number.isSafeInteger(id)&&typeof value.answer_value_text==='string'&&value.answer_value_text.trim()){
     const options=question.options.filter(option=>option.id===id);
     if(options.length!==1)throw new ValidationError('write-label option identity mismatch',[question.fieldName??String(question.questionId)]);
     const key=identity(question.questionId,id),prior=labels.get(key);
     if(prior!==undefined&&prior!==value.answer_value_text)throw new ValidationError('conflicting write-label observations',[question.fieldName??String(question.questionId)]);
     labels.set(key,value.answer_value_text);
    }
   }
  }
  // Traverse known response/assessment containers only. Do not interpret arbitrary strings as data.
  for(const key of ['value','values','sub_assessment_question_list','sub_assessment_answer_list','sub_assessment_list'])if(value[key]!==undefined)visit(value[key],depth+1);
 };
 for(const observation of observations){
  if(observation.tenant!==definition.tenant)throw new ValidationError('write-label observation tenant mismatch');
  visit(observation.response);
 }
 const sameOption=(a:PicklistOption,b:PicklistOption)=>a.id===b.id&&a.picklistId===b.picklistId&&a.code===b.code&&a.picklistCode===b.picklistCode&&a.name===b.name&&a.hudVisibility===b.hudVisibility;
 const resolver=(question:QuestionDefinition,option:PicklistOption)=>{
  const known=questions.get(question.questionId);
  if(!known||known.fieldName!==question.fieldName||question.questionType!=='lookup'||!known.options.some(o=>sameOption(o,option)))return undefined;
  return labels.get(identity(question.questionId,option.id));
 };
 return Object.freeze(Object.assign(resolver,{tenant:definition.tenant}));
}
