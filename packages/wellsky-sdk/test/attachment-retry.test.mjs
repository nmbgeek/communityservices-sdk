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
 // Stores such as Postgres jsonb return keys in their own order; an identical retry must still match.
 const reversed=v=>Array.isArray(v)?v.map(reversed):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reversed(x)])):v;
 for(const [scope,value]of journal)journal.set(scope,reversed(value));
 assert.equal((await workflows().uploadAttachment(input)).outcome,'reconciled');
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

function uploadFixture(mode){
 const base='https://wscs.wellsky.com/'+testTenant+'/com.bowmansystems.sp5.core.ServicePoint/';
 const page=new EventEmitter(),journal=new Map(),rows=[];
 let visits=0,uploads=0,reconnections=0,reads=0,probe=false,login=false,offline=false;
 const expire=()=>page.emit('response',{url:()=>base+'service/MetaQueryService',status:()=>401});
 const capture=()=>page.emit('request',{url:()=>base+'service/MetaQueryService',postData:()=> '7|0|0|base|policy|getMappedResults|',allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'test'})});
 page.url=()=>base+'index.html#loadClient;clientId=12345';
 page.waitForFunction=async()=>{};
 page.locator=selector=>({count:async()=>selector.includes('formfield')&&login?1:0,innerText:async()=>{
  reads++;if(mode==='delayed'&&reads===1)return '';
  return 'Client - ('+(mode==='wrong-client'||mode==='wrong-after-login'&&reconnections?'67890':'12345')+') Private heading';
 }});
 page.getByRole=(_,{name})=>({click:async()=>{
  if(name!=='Client Profile')return;
  visits++;
  if(visits===1||mode==='twice'){
   if(['tenant-401','twice','wrong-after-login'].includes(mode)){expire();return;}
   if(mode==='login-prompt'){login=true;return;}
   if(mode==='session-probe'){probe=true;throw Error('Private timeout');}
  }
  if(mode!=='missing')capture();
 }});
 page.evaluate=async(_,args)=>{
  if(args.url.endsWith('service/MetaQueryService')){if(offline)throw Error('Unavailable');return {status:200,body:mappedRows(rows)};}
  if(args.url.includes('downloadAttachment'))return Buffer.from('Synthetic').toString('base64');
  uploads++;
  rows.push({attachmentId:42,entityId:null,entityType:'SpClient',name:'private-file.txt',description:''});
  if(mode==='lost'){expire();offline=true;throw Error('Response lost');}
  return {status:200,body:'42:SUCCESS'};
 };
 attachAuthentication(page,async()=>{reconnections++;probe=false;login=false;offline=false;},async()=>probe||mode==='wrong-client');
 const store={withLock:async(_,fn)=>fn(),read:async key=>structuredClone(journal.get(key)??[]),write:async(key,value)=>journal.set(key,structuredClone(value))};
 const input={clientId:12345,location:{kind:'profile'},file:{name:'private-file.txt',buffer:Buffer.from('Synthetic')}};
 return {upload:()=>createClientWorkflows({page,store}).uploadAttachment(input),journal,counts:()=>({visits,uploads,reconnections})};
}
test('attachment waits for a delayed client heading and bounded missing-capture failure is value-free',async()=>{
 const delayed=uploadFixture('delayed');assert.equal((await delayed.upload()).outcome,'written');assert.equal(delayed.counts().uploads,1);
 const f=uploadFixture('missing');await assert.rejects(f.upload(),e=>e.code==='CLIENT_PAGE_NOT_READY'&&e.reason==='missing-mapped-request'&&!/12345|Private|private-file|https:/.test(e.message));
 assert.deepEqual(f.counts(),{visits:1,uploads:0,reconnections:0});assert.equal(f.journal.size,0);
});
for(const signal of ['tenant-401','login-prompt','session-probe'])test('confirmed '+signal+' allows one fresh preparation before uploading',async()=>{
 const f=uploadFixture(signal),result=await f.upload();
 assert.deepEqual(result.preparationRecovery,{authenticationSignal:signal,readinessReason:signal==='tenant-401'?'session-expired':signal==='login-prompt'?'login-prompt':'missing-mapped-request'});
 assert.equal(result.outcome,'written');assert.deepEqual(f.counts(),{visits:2,uploads:1,reconnections:1});
});
test('wrong-client is terminal both on first open and after reauthentication',async()=>{
 for(const mode of ['wrong-client','wrong-after-login']){
  const f=uploadFixture(mode);await assert.rejects(f.upload(),e=>e.code==='CLIENT_PAGE_NOT_READY'&&e.reason==='wrong-client');
  assert.equal(f.counts().uploads,0);assert.equal(f.counts().reconnections,Number(mode==='wrong-after-login'));assert.equal(f.journal.size,0);
 }
});
test('repeated expiry stops after one preparation retry',async()=>{
 const f=uploadFixture('twice');await assert.rejects(f.upload(),e=>e.code==='SESSION_INTERRUPTED'&&e.authenticationSignal==='tenant-401');
 assert.equal(f.counts().visits,2);assert.equal(f.counts().uploads,0);
});
test('lost upload response reconciles only with the original attempted journal and never uploads twice',async()=>{
 const f=uploadFixture('lost');await assert.rejects(f.upload(),e=>e.code==='SESSION_INTERRUPTED'&&e.authenticationSignal==='tenant-401');
 assert.deepEqual(f.counts(),{visits:1,uploads:1,reconnections:1});assert.equal([...f.journal.values()][0][0].state,'attempted');
 assert.equal((await f.upload()).outcome,'reconciled');assert.deepEqual(f.counts(),{visits:2,uploads:1,reconnections:1});
});

test('Chromium waits for both the rendered heading and the fresh mapped request',{skip:!process.env.WELLSKY_TEST_CHROME},async()=>{
 const {chromium}=await import('playwright-core');
 const browser=await chromium.launch({executablePath:process.env.WELLSKY_TEST_CHROME});
 try{
  const page=await browser.newPage(),base='https://wscs.wellsky.com/'+testTenant+'/com.bowmansystems.sp5.core.ServicePoint/';
  let listReads=0;
  await page.route('**/*',route=>{
   if(route.request().url()===base+'service/MetaQueryService'){
    if(route.request().postData().includes('SELECT '))listReads++;
    return route.fulfill({body:mappedRows([])});
   }
   return route.fulfill({contentType:'text/html',body:'<main></main><button role="tab">Summary</button><button role="tab" id="profile">Client Profile</button>'});
  });
  await page.goto(base+'index.html#loadClient;clientId=12345');
  await page.evaluate(base=>{
   document.querySelector('#profile').onclick=()=>{
    setTimeout(()=>{document.querySelector('main').textContent='Client - (12345)';},60);
    setTimeout(()=>fetch(base+'service/MetaQueryService',{method:'POST',headers:{'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'synthetic'},body:'7|0|0|base|policy|getMappedResults|'}),150);
   };
  },base);
  assert.deepEqual(await createClientWorkflows({page,store:{}}).listAttachments(12345),[]);
  assert.equal(listReads,1);
 }finally{await browser.close();}
});
