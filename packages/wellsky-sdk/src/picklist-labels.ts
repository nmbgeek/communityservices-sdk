import type {AssessmentDefinition,PicklistOption,QuestionDefinition} from './metadata.js';
import {flattenQuestions} from './metadata.js';
import type {EncodingOptions} from './encoding.js';
import {ValidationError} from './errors.js';

export interface PicklistCatalogOption {optionId:number;picklistId:number;code:string|null;name:string;}
export interface PicklistCatalogSnapshot {source:'gwt-rpc';tenant:string;clientId:number;count:number;values:PicklistCatalogOption[];}
export type CatalogWriteLabelResolver = NonNullable<EncodingOptions['writeLabel']> & {readonly tenant:string};

/** Exact catalog names joined by identity, without reading any stored answer.
 * Only choices present in the supplied assessment definition can resolve. */
export function createCatalogWriteLabelResolver(definition:AssessmentDefinition,catalog:PicklistCatalogSnapshot):CatalogWriteLabelResolver{
 const fail=()=>{throw new ValidationError('incomplete or mismatched picklist label catalog');};
 if(catalog?.source!=='gwt-rpc'||catalog.tenant!==definition.tenant||!Number.isSafeInteger(catalog.clientId)||catalog.clientId<=0||!Array.isArray(catalog.values)||catalog.count!==catalog.values.length)fail();
 const rows=new Map<number,PicklistCatalogOption>();
 for(const row of catalog.values){
  if(!row||!Number.isSafeInteger(row.optionId)||row.optionId<=0||!Number.isSafeInteger(row.picklistId)||row.picklistId<=0||row.code!==null&&typeof row.code!=='string'||typeof row.name!=='string'||!row.name.trim()||rows.has(row.optionId))fail();
  rows.set(row.optionId,{...row});
 }
 const signature=(q:QuestionDefinition,o:PicklistOption)=>JSON.stringify([q.questionId,q.fieldName,q.questionType,o.id,o.picklistId,o.code,o.picklistCode,o.name,o.hudVisibility]);
 const labels=new Map<string,string>();
 for(const {question}of flattenQuestions(definition.questions)){
  if(question.questionType!=='lookup')continue;
  for(const option of question.options){
   const row=rows.get(option.id);
   if(!row||row.picklistId!==option.picklistId||row.code!==option.code){fail();continue;}
   labels.set(signature(question,option),row.name);
  }
 }
 const resolver=(question:QuestionDefinition,option:PicklistOption)=>labels.get(signature(question,option));
 return Object.freeze(Object.assign(resolver,{tenant:definition.tenant}));
}
