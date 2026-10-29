import {apiScope} from './connection.mjs';
import {createHash} from 'node:crypto';
import {recoveryDiagnostics} from './recovery-diagnostics.mjs';
import {toItems} from '../dist/esm/index.js';
import {validateSsvfInformation} from './ssvf-rules.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const positive=n=>Number.isSafeInteger(n)&&n>0&&n<=2147483647;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const instant=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s.slice(0,19)+'Z').toISOString().slice(0,19)===s.slice(0,19);
const timestamp=s=>Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'Z');
const one=response=>{const items=toItems(response);if(items.length!==1)throw Error('Expected exactly one record');return items[0];};
const money=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e9&&Math.abs(n*100-Math.round(n*100))<1e-6;

function prepare(input) {
  if(!input||typeof input.key!=='string'||!input.key.trim()||input.key.length>200)throw Error('Stable service row key required');
  if(Object.keys(input).some(k=>!['key','body','financialAssistancePeriod','fundingSources'].includes(k)))throw Error('Unknown service row field');
  const body=structuredClone(input.body);
  if(!object(body)||!positive(body.clientId)||!positive(body.serviceProvider)||typeof body.serviceCode!=='string'||!body.serviceCode.trim()||!instant(body.serviceStartDate)||!instant(body.serviceEndDate)||timestamp(body.serviceEndDate)<timestamp(body.serviceStartDate))throw Error('Client, provider, code and ordered timezone-qualified service dates required');
  for(const field of ['serviceCosts','ssvfInformation'])if(body[field]!==undefined&&!object(body[field]))throw Error('Service details must be objects');
  if(body.needStatus!==undefined&&body.needStatus!=='Closed')throw Error('Service recorder requires Closed needs');
  if(Object.keys(body).some(k=>!['clientId','serviceProvider','serviceCode','serviceStartDate','serviceEndDate','serviceNote','needStatus','ssvfInformation','serviceCosts'].includes(k)))throw Error('Unsupported service recorder field');
  if(body.serviceNote!==undefined&&(typeof body.serviceNote!=='string'||body.serviceNote.length>10000||body.serviceNote.includes('[sdk-service:')))throw Error('Invalid service note');
  if(body.serviceCosts&&Object.entries(body.serviceCosts).some(([k,v])=>!['number_of_units','unit_type','total_cost_of_units'].includes(k)||(k==='unit_type'?typeof v!=='string':!money(v))))throw Error('Invalid service costs');
  const period=structuredClone(input.financialAssistancePeriod??null);
  if(period!==null&&!object(period))throw Error('Assistance period must be an object');
  if(period&&(!body.ssvfInformation||!instant(period.start)||!instant(period.end)||timestamp(period.end)<timestamp(period.start)||Object.keys(period).some(k=>!['start','end'].includes(k))))throw Error('Invalid SSVF assistance period');
  validateSsvfInformation(body.ssvfInformation,period);
  const fundingSources=structuredClone(input.fundingSources??[]);
  if(!Array.isArray(fundingSources)||fundingSources.length>20||fundingSources.some(f=>!f||!positive(f.fundId)||!positive(f.fundCycleId)||typeof f.name!=='string'||!f.name.trim()||!money(f.amount)||f.amount===0||Object.keys(f).some(k=>!['fundId','fundCycleId','name','amount'].includes(k)))||new Set(fundingSources.map(f=>f.fundCycleId)).size!==fundingSources.length||new Set(fundingSources.map(f=>f.name)).size!==fundingSources.length)throw Error('Invalid or duplicate funding sources');
  body.needStatus='Closed';
  const intentHash=digest(canonical({body,period,fundingSources}));
  const keyHash=digest(input.key),marker=`[sdk-service:${keyHash}]`;
  body.serviceNote=[body.serviceNote,marker].filter(Boolean).join('\n');
  return {key:input.key,keyHash,intentHash,body,period,fundingSources,marker};
}

function verifyService(service,body) {
  for(const field of ['clientId','serviceProvider','serviceCode','serviceNote'])if(service[field]!==body[field])throw Error('Stored service differs from requested row');
  for(const field of ['serviceStartDate','serviceEndDate'])if(timestamp(service[field])!==timestamp(body[field]))throw Error('Stored service date differs');
  for(const field of ['ssvfInformation','serviceCosts'])for(const [key,value]of Object.entries(body[field]??{}))if(service[field]?.[key]!==value)throw Error('Stored service details differ');
  if(!positive(service.needId)||!positive(service.serviceId)||service.isActive===false)throw Error('Service has no active associated need');
}

async function serviceList(api,clientId,allowInitial404) {
  const rows=[],ids=new Set();let count;
  for(let page=1;page<=100;page++){
    let result;try{result=await api.services.listForClient({path:{clientId},query:{perPage:100,startPage:page,total_count:true}});}catch(error){if(page===1&&allowInitial404&&error.status===404)return [];throw error;}
    if(!Number.isSafeInteger(result?.count)||result.count<0||!Array.isArray(result.values)||count!==undefined&&count!==result.count)throw Error('Service list count unavailable or changed');
    count=result.count;
    for(const row of result.values){if(!positive(row.serviceId)||row.clientId!==clientId||ids.has(row.serviceId))throw Error('Invalid or duplicate service list record');ids.add(row.serviceId);rows.push(row);}
    if(rows.length===count)return rows;
    if(rows.length>count||!result.values.length)throw Error('Incomplete service list');
  }
  throw Error('Service list exceeds 100 pages');
}

/** Tenant-configured orchestration. REST creates once, UI fills contract gaps, both read back.
 * Keep the same durable store and stable row keys across restarts and reordered batches.
 * An uncertain write is reconciled, never automatically repeated. */
export function createServiceRecorder({api,ui,store}) {
 const tenantScope=apiScope(api, ui);
  if(!ui||!store)throw Error('REST client, service UI adapter and durable store required');
  const recordPrepared=async input=>{
    const {body,keyHash,intentHash,marker,period,fundingSources}=input;
    const scope=JSON.stringify([tenantScope,'service-recording',body.clientId]);
    let failedStage='journal-lock';
    try{return await store.withLock(scope,async()=>{
      failedStage='journal-read';const entries=await store.read(scope);
      if(!Array.isArray(entries))throw Error('Invalid service journal');
      let entry=entries.find(e=>e.keyHash===keyHash);
      if(entries.filter(e=>e.keyHash===keyHash).length>1||entry&&entry.intentHash!==intentHash)throw Error('Service key conflicts with earlier intent');
      const persist=async stage=>{entry={...entry,keyHash,intentHash,stage};const i=entries.findIndex(e=>e.keyHash===keyHash);if(i<0)entries.push(entry);else entries[i]=entry;await store.write(scope,entries);};
      let service;
      failedStage='session-preflight';await ui.assertReady();failedStage='rest-read';
      if(entry?.serviceId){service=one(await api.services.getComplete({path:{serviceId:entry.serviceId}}));}
      else {
        const matches=[];
        // Paginate fully before deciding that an earlier create is absent.
        for(const item of await serviceList(api,body.clientId,!entry)){
          if(item.serviceProvider!==body.serviceProvider||item.serviceCode!==body.serviceCode)continue;
          const detail=one(await api.services.getComplete({path:{serviceId:item.serviceId}}));
          if(detail.serviceId!==item.serviceId)throw Error('Service readback identity mismatch');
          if(detail.serviceNote?.split('\n').includes(marker))matches.push(detail);
        }
        if(matches.length>1)throw Error('Duplicate service markers require review');
        service=matches[0];
        if(!service){
          if(entry)throw Error('Unresolved REST create; refusing another create');
          await persist('rest-attempted');
          failedStage='rest-create';let createError;
          try{service=one(await api.services.create({body}));}catch(error){createError=error;}
          failedStage='rest-reconcile';
          if(!service){
            try{for(const item of await serviceList(api,body.clientId,false)){
              if(item.serviceProvider!==body.serviceProvider||item.serviceCode!==body.serviceCode)continue;
              const detail=one(await api.services.getComplete({path:{serviceId:item.serviceId}}));
              if(detail.serviceId!==item.serviceId)throw Error('Service readback identity mismatch');
              if(detail.serviceNote?.split('\n').includes(marker))matches.push(detail);
            }
            if(matches.length!==1)throw Error('REST create outcome uncertain; journal blocks repetition');
            }catch(error){if(createError&&error!==createError&&!error.cause)error.cause=createError;throw error;}
            service=matches[0];
          }
        }
        verifyService(service,body);entry={...entry,serviceId:service.serviceId,needId:service.needId};await persist('rest-verified');
      }
      verifyService(service,body);
      if(service.serviceId!==entry.serviceId||entry.needId!==undefined&&service.needId!==entry.needId)throw Error('Saved service or need identity changed');
      // Older journals did not retain need IDs. Pin the first verified read
      // before UI work, then require that association on every later retry.
      if(entry.needId===undefined){entry.needId=service.needId;await persist(entry.stage);}
      const context={clientId:body.clientId,serviceId:service.serviceId,providerId:body.serviceProvider,serviceNote:body.serviceNote};
      const expected={financialAssistancePeriod:period,fundingSources,ssvfInformation:body.ssvfInformation};
      failedStage='ui-inspect';let snapshot=await ui.inspect(context);
      const wasVerified=entry.stage==='verified';
      if(!ui.matches(snapshot,expected)){
        if(entry.stage==='ui-attempted'||wasVerified)throw Error('UI save unresolved or stored row changed; refusing automatic replay');
        failedStage='ui-complete';snapshot=await ui.complete(context,expected,()=>persist('ui-attempted'));
      }
      failedStage='verification';if(!ui.matches(snapshot,expected))throw Error('UI details did not verify; journal blocks repetition');
      service=one(await api.services.getComplete({path:{serviceId:service.serviceId}}));verifyService(service,body);
      if(service.serviceId!==entry.serviceId||service.needId!==entry.needId)throw Error('Saved service or need identity changed');
      const need=one(await api.needs.getComplete({path:{needId:service.needId}}));
      if(need.needId!==entry.needId||need.isActive===false||need.clientId!==body.clientId||need.needProvider!==body.serviceProvider||need.statusInformation?.needStatus!=='Closed'||need.statusInformation?.needOutcome!=='Fully Met')throw Error('Associated need did not verify identity, active state and Closed / Fully Met');
      failedStage='journal-verify';await persist('verified');
      return {key:input.key,outcome:wasVerified?'already-present':'verified',serviceId:service.serviceId,needId:service.needId,ui:snapshot};
    });}catch(error){if(error&&typeof error==='object'&&!error.stage)error.stage=failedStage;throw error;}
  };
  return {
    record:async input=>recordPrepared(prepare(input)),
    async recordBulk(inputs,{signal,onResult}={}) {
      if(!Array.isArray(inputs)||inputs.length>10000)throw Error('At most 10,000 rows per batch');
      // Validate every row before any write. A shared browser executes sequentially.
      const keys=new Set(),prepared=inputs.map(input=>{const row=prepare(input),key=`${row.body.clientId}:${row.keyHash}`;if(keys.has(key))throw Error('Duplicate row keys in batch');keys.add(key);return row;});
      const results=[];let stopped=false,callbackFailed=false;
      for(const [index,row]of prepared.entries()){
        let result;
        if(signal?.aborted||stopped)result={index,key:row.key,outcome:'skipped'};
        else try{result={index,key:row.key,outcome:'fulfilled',value:await recordPrepared(row)};}catch(error){result={index,key:row.key,outcome:'rejected',message:error.message,error:recoveryDiagnostics(error)};stopped=true;}
        results.push(result);
        if(onResult&&!callbackFailed)try{await onResult(result);}catch{stopped=true;callbackFailed=true;}
      }
      return {results,callbackFailed};
    },
  };
}
