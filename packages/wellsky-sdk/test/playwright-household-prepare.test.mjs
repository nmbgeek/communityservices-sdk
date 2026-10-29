const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaywrightGwtSession} from '../browser/playwright-session.mjs';

const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
function mappedWire(rows){
 const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','java.lang.Integer/3438268394'];
 const text=value=>{strings.push(value);return strings.length;},stream=[1,2,rows.length];
 for(const row of rows){stream.push(3,Object.keys(row).length);for(const [key,value]of Object.entries(row)){stream.push(4,text(key));if(value===null)stream.push(0);else if(typeof value==='number')stream.push(5,value);else stream.push(4,text(value));}}
 stream.push(0,0,5,rows.length);return '//OK'+JSON.stringify(stream.reverse().concat([strings,0,7]));
}
function fixture({dialogCount=1,unexpectedRpc=false,anchorClientId=1}={}){
 const anchorEnrollmentId=anchorClientId===1?50:52;
 const dialogs=new Set(),events=[],entryBoxes=[1,2,3].map(clientId=>({clientId,checked:clientId!==3})),additionalBoxes=[1,2,3].map(clientId=>({clientId,checked:clientId!==3}));let handler,mutationRequests=0,aborts=0,networkWrites=0;
 const request=(method,selectedClientIds)=>({url:()=>base+'service/ClientService',postData:()=>`7|0|9|${base}|POLICY|GenericService|${method}|${selectedClientIds?`selectedClients=${selectedClientIds.join(',')}|`:''}${anchorEnrollmentId}|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'PERM'})});
 const entryRequest=request('getEntryExit');
 const boxesFor=scope=>scope==='additional'?additionalBoxes:scope==='entry'?entryBoxes:[...(dialogs.has('EntryDataPopup.cancel-button')?entryBoxes:[]),...(dialogs.has('AddAdditionalHouseholdMembersPopup.cancelBtn')?additionalBoxes:[])];
 const checkboxLocator=(selector,scope)=>{
  const boxes=boxesFor(scope),selected=selector.includes(':checked');return {count:async()=>boxes.length,evaluateAll:async fn=>fn(boxes.filter(b=>!selected||b.checked).map(b=>selector.includes(' input')?{parentElement:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${b.clientId}`}}:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${b.clientId}`})),nth:i=>({evaluate:async fn=>fn({parentElement:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${boxes[i].clientId}`}}),isEnabled:async()=>scope!=='additional'||boxes[i].clientId===3,isChecked:async()=>boxes[i].checked,setChecked:async value=>{boxes[i].checked=value;events.push(['check',scope??'global',boxes[i].clientId,value]);}})};
 };
 const locator=(selector,scope)=>{
  if(selector.includes('HouseholdsCheckboxTree'))return checkboxLocator(selector,scope);
  const id=selector.match(/\[id="([^"]+)"\]/)?.[1];
  return {
   count:async()=>Number(dialogs.has(id)),last(){return this;},filter(){return this;},isVisible:async()=>false,waitFor:async()=>{},innerText:async()=>`Edit Project Start Data - (${anchorClientId})`,
   locator:child=>{assert.equal(child,'xpath=ancestor::*[@role="dialog"][1]');const owner=id==='AddAdditionalHouseholdMembersPopup.saveBtn'?'additional':'entry';return {count:async()=>dialogCount,locator:selector=>locator(selector,owner)};},
   click:async()=>{
    events.push(['click',id]);
    if(id===`ClientEntryExitTab.editEntry-imageLink_${anchorEnrollmentId}`)dialogs.add('EntryDataPopup.cancel-button');
    else if(id==='AddAdditionalHouseholdMembersPopup.saveBtn'){
     assert.equal(entryBoxes.find(b=>b.clientId===3).checked,false,'underlying entry checkbox must remain untouched while add popup is active');
     assert.deepEqual(additionalBoxes.filter(b=>b.checked).map(b=>b.clientId),[1,2,3]);dialogs.delete('AddAdditionalHouseholdMembersPopup.cancelBtn');
    }else if(id==='EntryDataPopup.saveAndContinue-button'){
     const selectedClientIds=entryBoxes.filter(b=>b.checked).map(b=>b.clientId);
     assert.deepEqual(selectedClientIds,[anchorClientId,3]);mutationRequests++;const r=request(unexpectedRpc?'unexpectedMutation':'updateEntryExitWithHouseholdMembers',selectedClientIds);
     if(handler)await handler({request:()=>r,abort:async()=>{aborts++;},continue:async()=>{networkWrites++;}});else networkWrites++;
    }else dialogs.delete(id);
   },
  };
 };
 const page={
  setDefaultTimeout(){},url:()=>base+`index.html#loadClient;clientId=${anchorClientId}`,locator,waitForFunction:async()=>{},
  getByText:text=>typeof text==='string'?{isVisible:async()=>text==='Include Additional Household Members'&&dialogs.has('EntryDataPopup.cancel-button'),click:async()=>dialogs.add('AddAdditionalHouseholdMembersPopup.cancelBtn')}:{isVisible:async()=>true},
  getByRole:()=>({click:async()=>{},waitFor:async()=>{}}),getByLabel:name=>({inputValue:async()=>name}),
  waitForResponse:async()=>({status:()=>200,text:async()=>'//OK[]',request:()=>entryRequest}),
  evaluate:async(_,r)=>{
   let rows=[];
   if(r.body.includes('e.typeEntryExit.name AS enrollmentType'))rows=[{clientId:anchorClientId,enrollmentId:anchorEnrollmentId,projectStartDate:anchorClientId===1?'2026-10-19T16:00:00Z':'2026-10-21T16:00:00Z',groupId:50,providerId:2,enrollmentType:'HUD'}];
   else if(r.body.includes('e.exitDate AS projectExitDate'))rows=[1,2].map(clientId=>({clientId,enrollmentId:clientId===1?50:52,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null}));
   else if(r.body.includes('FROM SpEntryExit AS e')&&r.body.includes('e.groupId ='))rows=[{clientId:1,enrollmentId:50},{clientId:2,enrollmentId:52}];
   return {status:200,body:mappedWire(rows)};
  },
  route:async(pattern,callback)=>{assert.equal(pattern,'**/service/**');handler=callback;},unroute:async(pattern,callback)=>{assert.equal(handler,callback);handler=undefined;},
 };
 return {page,session:createPlaywrightGwtSession({page,tenant:testTenant,moduleBaseUrl:base}),events,get mutationRequests(){return mutationRequests;},get aborts(){return aborts;},get networkWrites(){return networkWrites;},get dialogs(){return [...dialogs];}};
}
test('prepare scopes duplicate visible household checkbox IDs to each active dialog and aborts its RPC',async()=>{
 const f=fixture(),snapshot=await f.session.readEnrollment({clientId:1,enrollmentId:50}),intent={kind:'add-household-members',clientId:1,enrollmentId:50,memberClientIds:[3]};
 const prepared=await f.session.prepare(intent,snapshot);assert.deepEqual(prepared.intent,intent);assert.match(prepared.body,/\|updateEntryExitWithHouseholdMembers\|selectedClients=1,3\|/);assert.equal(f.mutationRequests,1);assert.equal(f.aborts,1);assert.equal(f.networkWrites,0);assert.deepEqual(f.dialogs,[]);
 assert.ok(f.events.some(e=>e[0]==='check'&&e[1]==='additional'&&e[2]===3&&e[3]));assert.ok(f.events.some(e=>e[0]==='check'&&e[1]==='entry'&&e[2]===3&&e[3]));assert.equal(f.events.some(e=>e[0]==='check'&&e[1]==='global'),false);
});
test('prepare rejects an absent or ambiguous dialog scope before a save request',async()=>{
 for(const dialogCount of [0,2]){const f=fixture({dialogCount}),snapshot=await f.session.readEnrollment({clientId:1,enrollmentId:50});await assert.rejects(f.session.prepare({kind:'add-household-members',clientId:1,enrollmentId:50,memberClientIds:[3]},snapshot));assert.equal(f.mutationRequests,0);assert.equal(f.networkWrites,0);}
});
test('prepare aborts an unexpected RPC and rejects capture without sending it',async()=>{
 const f=fixture({unexpectedRpc:true}),snapshot=await f.session.readEnrollment({clientId:1,enrollmentId:50});await assert.rejects(f.session.prepare({kind:'add-household-members',clientId:1,enrollmentId:50,memberClientIds:[3]},snapshot),/Expected mutation was not captured/);assert.equal(f.mutationRequests,1);assert.equal(f.aborts,1);assert.equal(f.networkWrites,0);assert.deepEqual(f.dialogs,[]);
});

test('prepare with a later-entry member anchor excludes existing non-anchor members from its captured update',async()=>{
 const f=fixture({anchorClientId:2}),target={clientId:2,enrollmentId:52},snapshot=await f.session.readEnrollment(target);
 assert.equal(snapshot.projectStartDate,'2026-10-21T16:00:00Z');
 assert.deepEqual(snapshot.members.map(m=>m.clientId),[1,2]);
 const prepared=await f.session.prepare({kind:'add-household-members',...target,memberClientIds:[3]},snapshot);
 assert.match(prepared.body,/\|updateEntryExitWithHouseholdMembers\|selectedClients=2,3\|52\|$/);
 assert.ok(f.events.some(e=>e[0]==='check'&&e[1]==='entry'&&e[2]===1&&e[3]===false),'existing non-anchor must be explicitly unchecked');
 assert.equal(f.events.some(e=>e[0]==='check'&&e[1]==='additional'&&e[2]!==3),false,'already linked members stay checked and disabled in the additional-members dialog');
 assert.equal(f.mutationRequests,1);assert.equal(f.aborts,1);assert.equal(f.networkWrites,0);assert.deepEqual(f.dialogs,[]);
});
test('reauthentication invalidates captured GWT payloads and old snapshots before another send',async()=>{
 const {attachAuthentication}=await import('../browser/session-authentication.mjs');
 const f=fixture();f.page.on=()=>{};f.page.off=()=>{};
 const auth=attachAuthentication(f.page,async()=>{}),target={clientId:1,enrollmentId:50};
 const snapshot=await f.session.readEnrollment(target),intent={kind:'add-household-members',...target,memberClientIds:[3]};
 const prepared=await f.session.prepare(intent,snapshot);
 await auth.reauthenticate();
 await assert.rejects(f.session.send({url:prepared.url,headers:prepared.headers,body:prepared.body}),/newly prepared/);
 await assert.rejects(f.session.prepare(intent,snapshot),/Session mismatch/);
 assert.equal(f.networkWrites,0);assert.equal(f.mutationRequests,1);
 const fresh=await f.session.readEnrollment(target);assert.notEqual(fresh.sessionId,snapshot.sessionId);
});
