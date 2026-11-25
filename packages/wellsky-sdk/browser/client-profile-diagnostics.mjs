// Journal comparison tags are scoped to the caller's operation key. Neither tags nor values go to listeners.
import {createHmac} from 'node:crypto';

const failureReasons=new Set([
 'REST_READ_FAILED','UI_READ_FAILED','REST_UI_DISAGREE','CHOICE_UNAVAILABLE',
 'PROTECTED_FIELDS_CHANGED','REST_TARGET_MISMATCH','UI_TARGET_MISMATCH',
 'REST_WRITE_REJECTED','REST_WRITE_UNCONFIRMED','REST_WRITE_NOT_SENT','UI_PREPARATION_FAILED','UI_SAVE_UNCONFIRMED',
]);
const phases=new Set(['preflight','write','readback','reconciliation','final']);
const stages=new Set(['unplanned','planned','rest-attempted','rest-verified','ui-attempted','verified']);
const dispatches=new Set(['read-only','dispatched','unknown']);
const browserFailures=new Set(['timeout','session-interrupted','browser-error']);
const httpStatus=value=>Number.isInteger(value)&&value>=100&&value<=599?value:undefined;

// A custom store can return older or application-supplied records. Copy only recognized evidence.
function safeFailure(value){
 if(!value||!failureReasons.has(value.reason)||!phases.has(value.phase)||!['ui','rest'].includes(value.transport))return undefined;
 if(!stages.has(value.stage)||!dispatches.has(value.dispatch))return undefined;
 const result={transport:value.transport,phase:value.phase,stage:value.stage,dispatch:value.dispatch,reason:value.reason};
 if(httpStatus(value.httpStatus))result.httpStatus=value.httpStatus;
 if(browserFailures.has(value.browserFailure))result.browserFailure=value.browserFailure;
 return result;
}

function errorDetails(error,transport){
 const result={};
 if(httpStatus(error?.status))result.httpStatus=error.status;
 if(transport==='ui'){
  if(error?.name==='TimeoutError'||error?.cause?.name==='TimeoutError')result.browserFailure='timeout';
  else if(error?.code==='SESSION_INTERRUPTED')result.browserFailure='session-interrupted';
  else result.browserFailure='browser-error';
 }
 return result;
}

export function classifyProfilePut(error){
 const status=httpStatus(error?.status);
 if(error?.operation==='POST /authentication/SetAuthKey'||['cooldown','validation'].includes(error?.kind)){
  return {dispatch:'read-only',reason:'REST_WRITE_NOT_SENT'};
 }
 if(status>=400&&status<500&&status!==408)return {dispatch:'dispatched',reason:'REST_WRITE_REJECTED'};
 return {dispatch:status?'dispatched':'unknown',reason:'REST_WRITE_UNCONFIRMED'};
}

export function createProfileDiagnostics(listener,key,scope,changes){
 if(typeof listener!=='function')return undefined;
 const events=[],writes={rest:'read-only',ui:'read-only'};
 const tag=(field,value)=>createHmac('sha256',key).update(JSON.stringify([scope,field,value])).digest('hex');
 return {
  writes,
  protectedTags(expected){
   return Object.fromEntries(Object.entries(expected).filter(([field])=>!Object.hasOwn(changes,field))
    .map(([field,value])=>[field,tag(field,value)]));
  },
  targetComparison(kind,values,entry,protectedFieldsMatch){
   const intended=Object.keys(values).filter(field=>Object.hasOwn(changes,field));
   const differing=intended.filter(field=>values[field]!==changes[field]);
   const comparison={kind,intendedFieldsMatch:differing.length===0,protectedFieldsMatch,fieldDetail:'unavailable'};
   const protectedFields=Object.keys(values).filter(field=>!Object.hasOwn(changes,field));
   if(entry.protectedFieldTags&&protectedFields.every(field=>typeof entry.protectedFieldTags[field]==='string')){
    comparison.fieldDetail='available';
    comparison.differingFields=[...differing,...protectedFields.filter(field=>entry.protectedFieldTags[field]!==tag(field,values[field]))];
   }
   return comparison;
  },
  sourceComparison(core,uiValues){
   const differingFields=Object.keys(core).filter(field=>core[field]!==uiValues[field]);
   return {kind:'rest-ui',fieldDetail:'available',differingFields,
    intendedFieldsMatch:!differingFields.some(field=>Object.hasOwn(changes,field)),
    protectedFieldsMatch:differingFields.every(field=>Object.hasOwn(changes,field))};
  },
  record(entry,transport,phase,reason,nextAction,comparison,error){
   const details=error?errorDetails(error,transport):{};
   const stage=entry?.stage??'unplanned';
   const failure=safeFailure({transport,phase,stage,dispatch:writes[transport],reason,...details});
   const firstFailure=safeFailure(entry?.firstFailure)??failure;
   events.push({operation:'clientProfile.update',transport,phase,stage,reason,nextAction,
    writes:{...writes},...details,...(firstFailure?{firstFailure}:{}),...(comparison?{comparison}:{})});
   return failure;
  },
  flush(){
   // Dispatch after unlocking. Listener errors and pending promises cannot change the operation.
   for(const event of events){try{Promise.resolve(listener(event)).catch(()=>{});}catch{}}
  },
 };
}
