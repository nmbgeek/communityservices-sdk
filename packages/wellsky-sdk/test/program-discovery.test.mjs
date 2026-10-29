const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readProgramCatalog} from '../dist/esm/program-discovery.js';
import {createProgramDiscovery} from '../browser/program-discovery.mjs';

const provider=(id,extra={})=>({providerId:id,providerName:`Program ${id}`,active:true,operational:true,hudCompliant:true,parentProviderID:5,providerGrantType:null,dateAdded:'2026-01-01',dateUpdated:'2026-01-02',...extra});
test('provider catalog uses counted pages, filters unavailable/system/unrelated providers and forwards options',async()=>{
 const rows=[provider(0),provider(1),provider(2,{active:false}),provider(3,{parentProviderID:6})];
 const calls=[];const api={providers:{async list(args){calls.push(args);return {count:4,values:rows.slice((args.query.startPage-1)*2,args.query.startPage*2)};}}};
 const result=await readProgramCatalog(api,{parentProviderId:5,correlationId:'catalog'});
 assert.deepEqual(result.providers,[rows[1]]);assert.deepEqual(result.excludedSystemProviderIds,[0]);assert.equal(result.assessmentAssignments,'requires-browser-discovery');
 assert.equal(calls.length,2);assert.equal(calls[0].query.total_count,true);assert.equal(calls[0].correlationId,'catalog');
 assert.equal(calls[0].query.query,'active eq true and operational eq true');assert.equal(calls[1].query.startPage,2);
 result.providers[0].active=false;assert.equal(rows[1].active,true);
 assert.equal((await readProgramCatalog(api,{availableOnly:false})).providers.length,3);
});
test('provider catalog rejects partial, drifting, malformed and duplicate counted pages',async()=>{
 for(const pages of [
  [{count:2,values:[provider(1),provider(1)]}],
  [{count:1,values:[provider(-2)]}],
  [{count:1,values:[{providerId:1}]}],
  [{count:2,values:[provider(1)]},{count:3,values:[provider(2)]}],
  [{count:2,values:[provider(1)]},{count:2,values:[]}],
  [{count:0,values:[provider(1)]}],
  [{value:[]}],
 ])await assert.rejects(readProgramCatalog({providers:{list:async()=>pages.shift()}}),e=>e.kind==='protocol');
 await assert.rejects(readProgramCatalog({providers:{list:async()=>({count:2,values:[provider(1)]})}},{maxPages:1}),e=>e.kind==='pagination');
 await assert.rejects(readProgramCatalog({providers:{list:async()=>{throw Error('page failed');}}}),/page failed/);
 const forbidden={providers:{list(){throw Error('unexpected request');}}};
 for(const options of [{parentProviderId:0},{maxPages:0},{availableOnly:'yes'}])await assert.rejects(readProgramCatalog(forbidden,options),e=>e.name==='ValidationError');
 await assert.rejects(readProgramCatalog(forbidden,{signal:AbortSignal.abort()}),e=>e.name==='AbortError');
});

const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
function wire(rows,total){
 const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','unused','java.lang.Integer/3438268394','java.lang.Boolean/476441737'];
 const text=v=>{strings.push(v);return strings.length;},stream=[1,2,rows.length];
 for(const row of rows){stream.push(3,Object.keys(row).length);for(const [k,v]of Object.entries(row)){stream.push(4,text(k));if(typeof v==='number')stream.push(6,v);else if(typeof v==='boolean')stream.push(7,Number(v));else stream.push(4,text(v));}}
 stream.push(0,0,6,total);return '//OK'+JSON.stringify(stream.reverse().concat([strings,0,7]));
}
function mockPage(pages,defaults=[]){
 let listener,current=base+'index.html#mainPage';const requests=[],clicks=[];
 return {requests,clicks,url:()=>current,on:(_,fn)=>{listener=fn;},off:()=>{listener=undefined;},goto:async url=>{current=url;},waitForFunction:async()=>{},
  locator:selector=>({count:async()=>0,innerText:async()=>'(13705) Synthetic Program',evaluateAll:async()=>defaults}),
  getByRole:(_,options)=>({click:async()=>{clicks.push(options.name);if(options.name==='Search')listener({url:()=>base+'service/MetaQueryService',postData:()=>`7|0|9|${base}|POLICY|getMappedResults|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'PERMUTATION'})});}}),
  evaluate:async(_,args)=>{requests.push(args);return {status:200,body:pages.shift()};},
 };
}
const row=id=>({assessmentId:id,name:`Instrument ${id}`,code:`CODE_${id}`});
test('browser catalog traverses pages with stable order and fresh GWT context',async()=>{
 const page=mockPage([wire(Array.from({length:100},(_,i)=>row(i+1)),101),wire([row(101)],101)]);
 const result=await createProgramDiscovery({page}).listAssessments();assert.equal(result.assessments.length,101);
 assert.match(page.requests[0].body,/ORDER BY a.name ASC, a.assessmentId ASC LIMIT 100,0/);assert.match(page.requests[1].body,/LIMIT 100,100/);
 assert.equal(page.requests[0].headers['x-gwt-permutation'],'PERMUTATION');assert.ok(!page.clicks.includes('Save'));
});
test('browser catalog rejects incomplete, changing, oversized and duplicate pages',async()=>{
 for(const pages of [
  [wire([row(1)],2)],
  [wire([row(1),row(1)],2)],
  [wire([],10001)],
  [wire(Array.from({length:100},(_,i)=>row(i+1)),101),wire([row(101),row(102)],102)],
 ])await assert.rejects(createProgramDiscovery({page:mockPage(pages)}).listAssessments());
});
test('provider defaults distinguish unset, unique and ambiguous names without guessing codes',async()=>{
 const defaults=Array.from({length:38},(_,i)=>({location:`place${i}`,label:`Location ${i}`,name:i===0?'Unique':i===1?'Ambiguous':'',allowMultiple:i>9?false:null}));
 const page=mockPage([wire([{...row(1),name:'Unique',visible:false},{...row(2),name:'Ambiguous',visible:true},{...row(3),name:'Ambiguous',visible:false}],3)],defaults);
 const result=await createProgramDiscovery({page}).getProviderAssessments({providerId:13705});
 assert.equal(result.defaults[0].resolution,'resolved');assert.equal(result.defaults[0].assessment.code,'CODE_1');
 assert.equal(result.defaults[1].resolution,'unresolved');assert.equal(result.defaults[1].assessment,null);
 assert.equal(result.defaults[2].resolution,'unset');assert.equal(result.assessments[0].assignedToAssessmentTab,false);
 assert.ok(!page.clicks.includes('Save'));
});
test('browser discovery rejects a changed tenant and bad provider ids before network access',async()=>{
 let url=base+'index.html';const page={url:()=>url};
 const discovery=createProgramDiscovery({page});
 url='https://wscs.wellsky.com/different-tenant/com.bowmansystems.sp5.core.ServicePoint/index.html';
 await assert.rejects(discovery.listAssessments(),/Configured application page required/);
 await assert.rejects(discovery.getProviderAssessments({providerId:'1 OR 1=1'}),/Positive provider ID/);
});
