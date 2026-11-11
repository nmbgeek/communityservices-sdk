import type {WellSkyClient,Operations} from './generated/v3.js';
import {ValidationError} from './errors.js';
import {parseRestInstant} from './encoding.js';
import {toItems} from './runtime.js';
import {isRecord} from './validation.js';

type RawMobileWrite = Parameters<WellSkyClient['assessmentsMobile']['addAnswer']>[0];
export type CheckedMobileWriteOptions = Omit<RawMobileWrite,'query'> & {query:{dateEffective:string}};
export type MobilePreflightCode = 'MOBILE_PREFLIGHT_INPUT_INVALID'|'MOBILE_PREFLIGHT_READ_FAILED'|'MOBILE_PREFLIGHT_UNAVAILABLE'|'MOBILE_ANSWER_EXISTS'|'MOBILE_PREFLIGHT_CANCELLED';
export class MobileAnswerPreflightError extends ValidationError {
 readonly committed=false;
 constructor(readonly code:MobilePreflightCode,fields:readonly string[]=[],cause?:unknown){
  super('mobile assessment preflight',fields);this.name='MobileAnswerPreflightError';
  if(cause!==undefined)Object.defineProperty(this,'cause',{value:cause,enumerable:false});
 }
}

/** Read-before-write protection for scalar inserts, including questions shared by instruments.
 * Does not journal, retry writes, or make the read/write pair atomic. */
export async function writeMobileAnswersChecked(
 api:Pick<WellSkyClient,'assessments'|'assessmentsMobile'>,
 options:CheckedMobileWriteOptions,
):ReturnType<WellSkyClient['assessmentsMobile']['addAnswer']>{
 function fail(code:MobilePreflightCode,fields:readonly string[]=[],cause?:unknown):never{throw new MobileAnswerPreflightError(code,fields,cause);}
 const checkSignal=()=>{if(options.signal?.aborted)fail('MOBILE_PREFLIGHT_CANCELLED',[],options.signal.reason);};
 if(!options?.path||!Number.isSafeInteger(options.path.clientId)||options.path.clientId<=0||typeof options.path.assessmentCode!=='string'||!options.path.assessmentCode.trim()||!Array.isArray(options.body)||!options.body.length||typeof options.query?.dateEffective!=='string')fail('MOBILE_PREFLIGHT_INPUT_INVALID');
 const instant=options.query.dateEffective;
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(instant)||!Number.isFinite(parseRestInstant(instant))||new Date(instant.slice(0,19)+'Z').toISOString().slice(0,19)!==instant.slice(0,19))fail('MOBILE_PREFLIGHT_INPUT_INVALID',['dateEffective']);
 checkSignal();
 const captured={...options,path:{...options.path},query:{...options.query},body:structuredClone(options.body)};
 const scalars:Array<{id:number;field:string;type:string}>=[],seen=new Set<string>(),ids=new Set<number>();
 for(const q of captured.body){
  if(!isRecord(q)||typeof q.question_type!=='string'||typeof q.virt_field_name!=='string'||!q.virt_field_name||typeof q.question_id!=='number'||!Number.isSafeInteger(q.question_id)||q.question_id<=0||seen.has(q.virt_field_name)||ids.has(q.question_id))fail('MOBILE_PREFLIGHT_INPUT_INVALID');
  seen.add(q.virt_field_name);ids.add(q.question_id);
  if(q.question_type!=='sub_assessment')scalars.push({id:q.question_id,field:q.virt_field_name,type:q.question_type});
 }
 if(scalars.length){
  let response:Awaited<ReturnType<WellSkyClient['assessments']['get']>>;
  try{response=await api.assessments.get({path:captured.path,query:{dateEffective:new Date(parseRestInstant(instant)+1000).toISOString()},...(options.signal?{signal:options.signal}:{}),...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs}),...(options.correlationId===undefined?{}:{correlationId:options.correlationId})});}
  catch(cause){fail('MOBILE_PREFLIGHT_READ_FAILED',scalars.map(q=>q.field),cause);}
  const rows=toItems<Operations['GET /assessments/{clientId}/{assessmentCode}']['item']>(response),conflicts:string[]=[];
  for(const q of scalars){
   const found=rows.filter(r=>r.virt_field_name===q.field);
   if(found.length!==1||found[0]?.question_id!==q.id||found[0]?.question_type!==q.type)fail('MOBILE_PREFLIGHT_UNAVAILABLE',[q.field]);
   const row=found[0];
   if(!row)fail('MOBILE_PREFLIGHT_UNAVAILABLE',[q.field]);
   if(row.date_effective!==null&&row.date_effective!==undefined&&row.date_effective!==''){
    const recorded=parseRestInstant(row.date_effective);
    if(!Number.isFinite(recorded)||recorded>parseRestInstant(instant))fail('MOBILE_PREFLIGHT_UNAVAILABLE',[q.field]);
    if(recorded===parseRestInstant(instant))conflicts.push(q.field);
   }else if(row.answer_value!==null&&row.answer_value!==undefined&&row.answer_value!=='')fail('MOBILE_PREFLIGHT_UNAVAILABLE',[q.field]);
  }
  if(conflicts.length)fail('MOBILE_ANSWER_EXISTS',conflicts);
 }
 checkSignal();
 return api.assessmentsMobile.addAnswer(captured);
}
