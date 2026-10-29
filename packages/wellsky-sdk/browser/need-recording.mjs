import {validateTenant} from './connection.mjs';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const id=value=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Positive integer ID required');return value;};
const text=(value,name,limit)=>{if(typeof value!=='string'||!value.trim()||value.length>limit||/[\0\r]/.test(value))throw Error(`Invalid ${name}`);return value;};
export class NeedConflictError extends Error {
 constructor(reason){super(`Independent need conflict: ${reason}`);this.name='NeedConflictError';this.code='NEED_CONFLICT';this.reason=reason;}
}
/** Validate before opening a form or touching the durable journal. */
export function normalizeNeedInput(input){
 if(!input||Object.keys(input).some(k=>!['key','clientId','providerId','serviceCodeId','needDate','status','outcome','reasonUnmet','note','amount'].includes(k)))throw Error('Unsupported independent need input');
 const key=text(input.key,'source key',200),clientId=id(input.clientId),providerId=id(input.providerId),serviceCodeId=id(input.serviceCodeId);
 const date=input.needDate;
 if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date.slice(0,19)+'Z').toISOString().slice(0,19)!==date.slice(0,19))throw Error('Need date must be a valid timezone-qualified instant with whole seconds');
 const status=text(input.status,'need status',100),outcome=text(input.outcome,'need outcome',100);
 const reasonUnmet=input.reasonUnmet==null?null:text(input.reasonUnmet,'unmet reason',100);
 if(reasonUnmet&&outcome!=='Not Met')throw Error('Unmet reason requires Not Met outcome');
 const note=input.note??'';if(typeof note!=='string'||note.length>8000||/[\0\r]/.test(note)||note.includes('[sdk-need:'))throw Error('Invalid need note');
 const amount=input.amount??null;if(amount!==null&&(!Number.isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>0.000001))throw Error('Need amount must be nonnegative with at most two decimal places');
 const keyHash=hash(key),marker=`[sdk-need:${keyHash}]`;
 const values={clientId,providerId,serviceCodeId,needDate:new Date(date).toISOString(),status,outcome,reasonUnmet,note:note?`${note}\n${marker}`:marker,amount};
 return {key,keyHash,marker,values,intentHash:hash(values)};
}
const validateRows=(rows,clientId)=>{
 if(!Array.isArray(rows)||new Set(rows.map(n=>n.needId)).size!==rows.length)throw Error('Incomplete or duplicate need read');
 for(const n of rows){id(n.needId);if(n.clientId!==clientId||typeof n.note!=='string'||!Number.isSafeInteger(n.serviceCount)||n.serviceCount<0)throw Error('Invalid need read');}
 return rows;
};
const verify=(row,values)=>{
 if(Object.entries(values).some(([key,value])=>row[key]!==value))throw new NeedConflictError('stored-fields-changed');
 if(row.serviceCount!==0)throw new NeedConflictError('service-attached');
 return row;
};
/** A fresh Add Need form, one save, and counted readback. Never creates a service. */
export function createNeedRecorder({ui,store,tenant=ui?.connection?.tenant}){
 const tenantScope=ui?.connection?.scope??validateTenant(tenant);
 if(ui?.connection&&ui.connection.tenant!==validateTenant(tenant))throw Error('Need UI tenant mismatch');
 if(!ui?.list||!ui?.create||!store?.withLock||!store?.read||!store?.write)throw Error('Need UI and durable store required');
 return {async record(input){
  const n=normalizeNeedInput(input),scope=JSON.stringify([tenantScope,'independent-need',n.keyHash]);
  return store.withLock(scope,async()=>{
   const entries=await store.read(scope);
   if(!Array.isArray(entries)||entries.length>1||entries.some(e=>e.version!==1||!['attempted','verified'].includes(e.stage)||typeof e.intentHash!=='string'||e.stage==='verified'&&(!Number.isSafeInteger(e.needId)||e.needId<1)))throw Error('Invalid independent need journal');
   let entry=entries[0];
   if(entry&&entry.intentHash!==n.intentHash)throw new NeedConflictError('intent-changed');
   const locate=async()=>{
    const rows=validateRows(await ui.list({clientId:n.values.clientId}),n.values.clientId),matches=rows.filter(r=>r.note.includes(n.marker));
    if(matches.length>1)throw new NeedConflictError('duplicate-marker');
    if(entry?.needId&&(!matches[0]||matches[0].needId!==entry.needId))throw new NeedConflictError('identity-changed');
    return matches[0]?verify(matches[0],n.values):null;
   };
   let row=await locate();
   if(row){await store.write(scope,[{version:1,intentHash:n.intentHash,stage:'verified',needId:row.needId}]);return {key:n.key,need:row,outcome:entry?.stage==='attempted'?'reconciled':'already-present'};}
   if(entry)throw new NeedConflictError('unresolved-save');
   let failure,attempted=false;
   try{await ui.create(n.values,async()=>{
    if(attempted)throw new NeedConflictError('second-save');
    entry={version:1,intentHash:n.intentHash,stage:'attempted'};
    await store.write(scope,[entry]);attempted=true;
   });}catch(error){failure=error;}
   if(!attempted)throw failure??Error('Need adapter did not journal its save');
   row=await locate();
   if(!row)throw failure??new NeedConflictError('unresolved-save');
   await store.write(scope,[{version:1,intentHash:n.intentHash,stage:'verified',needId:row.needId}]);
   return {key:n.key,need:row,outcome:failure?'reconciled':'verified'};
  });
 }};
}
