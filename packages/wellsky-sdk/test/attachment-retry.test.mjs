const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createClientWorkflows} from '@choiceapps/communityservices-sdk/browser';
// Exercise internal authentication on the resolved package, including installed-tarball runs.
const {attachAuthentication}=await import(new URL('./session-authentication.mjs',import.meta.resolve('@choiceapps/communityservices-sdk/browser')));

// Encode the observed flat mapped-read types so the real decoder participates.
function mappedRows(rows){
 const table=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','java.lang.Integer/3438268394'];
 const string=value=>{table.push(value);return [4,table.length];};
 const stream=[1,2,rows.length];
 for(const row of rows){stream.push(3,Object.keys(row).length);for(const [key,value]of Object.entries(row))stream.push(...string(key),...(value===null?[0]:typeof value==='number'?[5,value]:string(value)));}
 stream.push(0,0,5,rows.length);
 return '//OK'+JSON.stringify(stream.reverse().concat([table,0,7]));
}

for(const managed of [false,true])test(`attachment conflicts retain their identity with ${managed?'managed':'unmanaged'} authentication`,async()=>{
 const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
 let rows=[{attachmentId:42,entityId:null,entityType:'SpClient',name:'synthetic.txt',description:''}],uploads=0;
 const page=new EventEmitter(),journal=new Map();
 page.url=()=>base+'index.html#loadClient;clientId=1';
 page.waitForFunction=async()=>{};
 page.locator=selector=>({count:async()=>0,innerText:async()=>{assert.equal(selector,'body');return 'Client - (1)';}});
 page.getByRole=(role)=>{assert.equal(role,'tab');return {click:async()=>page.emit('request',{
  url:()=>base+'service/MetaQueryService',postData:()=> '7|0|0|base|policy|getMappedResults|',
  allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'test'}),
 })};};
 page.evaluate=async(_fn,args)=>{
  if(args.url.includes('downloadAttachment'))return Buffer.from('Synthetic').toString('base64');
  if(args.url.endsWith('service/MetaQueryService'))return {status:200,body:mappedRows(rows)};
  uploads++;throw Error('Unexpected upload');
 };
 const store={withLock:async(_scope,work)=>work(),read:async scope=>structuredClone(journal.get(scope)??[]),write:async(scope,value)=>journal.set(scope,structuredClone(value))};
 const input={clientId:1,location:{kind:'profile'},file:{name:'synthetic.txt',buffer:Buffer.from('Synthetic')}};
 const workflows=()=>createClientWorkflows({page,store});
 let probes=0,reconnections=0;
 if(managed)attachAuthentication(page,async()=>{reconnections++;},async()=>{probes++;return true;});
 assert.equal((await workflows().uploadAttachment(input)).attachment.attachmentId,42);
 assert.equal((await workflows().uploadAttachment(input)).attachment.attachmentId,42);
 const savedJournal=structuredClone([...journal]);
 const conflict=reason=>e=>e.code==='ATTACHMENT_CONFLICT'&&e.reason===reason;
 await assert.rejects(workflows().uploadAttachment({...input,description:'Changed intent'}),conflict('intent-changed'));
 rows=[rows[0],{...rows[0],attachmentId:43}];
 await assert.rejects(workflows().uploadAttachment(input),conflict('duplicate-name'));
 rows=[{...rows[0],description:'Changed stored description'}];
 await assert.rejects(workflows().uploadAttachment(input),conflict('content-changed'));
 rows=[{...rows[0],description:''}];
 rows=[{...rows[0],attachmentId:43}];
 await assert.rejects(workflows().uploadAttachment(input),conflict('identity-changed'));
 assert.equal([...journal.values()][0][0].attachmentId,42);
 rows=[];
 await assert.rejects(workflows().uploadAttachment(input),conflict('identity-changed'));
 assert.deepEqual([...journal],savedJournal);
 const scope=[...journal.keys()][0];journal.set(scope,[{intent:savedJournal[0][1][0].intent,state:'attempted'}]);
 await assert.rejects(workflows().uploadAttachment(input),conflict('unresolved'));
 assert.equal([...journal.values()][0][0].state,'attempted');
 assert.equal(uploads,0);
 assert.equal(probes,0);assert.equal(reconnections,0);
});
