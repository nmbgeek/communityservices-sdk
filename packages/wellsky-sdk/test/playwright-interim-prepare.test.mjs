import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaywrightGwtSession,entryExitTypes} from '@choiceapps/communityservices-sdk/browser';
const tenant='synthetic',base=`https://wscs.wellsky.com/${tenant}/com.bowmansystems.sp5.core.ServicePoint/`;
function wire(rows){
 const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','java.lang.Integer/3438268394'];
 const text=s=>{strings.push(s);return strings.length;},tokens=[1,2,rows.length];
 for(const row of rows){tokens.push(3,Object.keys(row).length);for(const [k,v]of Object.entries(row)){tokens.push(4,text(k));tokens.push(...(v===null?[0]:typeof v==='number'?[5,v]:[4,text(v)]));}}
 tokens.push(0,0,5,rows.length);return '//OK'+JSON.stringify(tokens.reverse().concat([strings,0,7]));
}
function fixture({type='Standard',target=1,implicit=false,forceMethod}={}){
 const enrollmentId=target===1?10:11,dialogs=new Set(),boxes=[1,2].map(clientId=>({clientId,checked:true})),date={},calls=[];let handler,aborts=0,networkWrites=0;
 const request=method=>({url:()=>base+'service/ClientService',postData:()=>`7|0|9|${base}|POLICY|GenericService|${method}|${enrollmentId}|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'PERM'})});
 const boxLocator=selector=>({count:async()=>implicit?0:boxes.length,nth:i=>({isEnabled:async()=>true,isChecked:async()=>boxes[i].checked,setChecked:async value=>{boxes[i].checked=value;},evaluate:async fn=>fn({parentElement:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${boxes[i].clientId}`}})}),evaluateAll:async fn=>fn(implicit?[]:boxes.filter(b=>!selector.includes(':checked')||b.checked).map(b=>({id:`HouseholdsCheckboxTree.householdCheckbox.client-${b.clientId}`,parentElement:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${b.clientId}`}})))});
 const locator=selector=>{
  if(selector.includes('HouseholdsCheckboxTree'))return boxLocator(selector);
  const id=selector.match(/id="([^"]+)"/)?.[1];
  return {count:async()=>Number(dialogs.has(id)),last(){return this;},waitFor:async()=>{},innerText:async()=>`Edit Project Start Data - (${target}) Add Interim Review - (${target})`,locator:child=>child==='xpath=ancestor::tr'?{locator:()=>({click:async()=>dialogs.add('EntryExitReviewListPopup.btnExit')})}:{count:async()=>1,locator},click:async()=>{
   if(id===`ClientEntryExitTab.editEntry-imageLink_${enrollmentId}`)dialogs.add('EntryDataPopup.cancel-button');
   else if(id==='EntryExitReviewListPopup.addReviewButton')dialogs.add('ModifyReviewPopup.cancel-button');
   else if(id==='ModifyReviewPopup.saveAndContinue-button'){
    const selected=implicit?[target]:boxes.filter(b=>b.checked).map(b=>b.clientId);const method=forceMethod??(selected.length===1?'createEntryExitReview':'createEntryExitReviewWithHouseholdMembers');calls.push({method,selected});
    if(handler)await handler({request:()=>request(method),abort:async()=>{aborts++;},continue:async()=>{networkWrites++;}});else networkWrites++;
   }else dialogs.delete(id);
  }};
 };
 const page={setDefaultTimeout(){},url:()=>base+'index.html',locator,waitForFunction:async()=>{},getByText:q=>q instanceof RegExp?{isVisible:async()=>true}:{isVisible:async()=>false},getByRole:()=>({click:async()=>{}}),waitForResponse:async()=>({status:()=>200,text:async()=>'//OK[]',request:()=>request('getEntryExit')}),getByLabel:label=>({inputValue:async()=>date[label]??'',fill:async v=>{date[label]=v;},selectOption:async o=>{date[label]=o.label;if(label==='Interim Review Type')for(const box of boxes)box.checked=true;}}),evaluate:async(fn,arg)=>{
  if(typeof arg==='string')return fn(arg);
  const q=arg.body;let rows=[];
  if(q.includes('e.typeEntryExit.name AS enrollmentType'))rows=[{clientId:target,enrollmentId,providerId:99,enrollmentType:type,projectStartDate:'2026-11-01T16:00:00Z',householdId:30,groupId:10}];
  else if(q.includes('e.exitDate AS projectExitDate'))rows=[1,2].map(clientId=>({clientId,enrollmentId:clientId===1?10:11,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null}));
  else if(q.includes('e.groupId ='))rows=[{clientId:1,enrollmentId:10},{clientId:2,enrollmentId:11}];
  return {status:200,body:wire(rows)};
 },route:async(_,fn)=>{handler=fn;},unroute:async(_,fn)=>{assert.equal(handler,fn);handler=undefined;}};
 return {reader:createPlaywrightGwtSession({page,tenant,moduleBaseUrl:base}),target:{clientId:target,enrollmentId},calls,get aborts(){return aborts;},get networkWrites(){return networkWrites;}};
}
for(const type of entryExitTypes)for(const target of [1,2])test(`${type}: one selected ${target===1?'head':'member'} captures single-review RPC with zero network writes`,async()=>{
 const f=fixture({type,target}),snapshot=await f.reader.readEnrollment(f.target),intent={kind:'create-interim-update',...f.target,clientIds:[target],reviewDate:'2026-11-11T16:00:00Z'};
 const prepared=await f.reader.prepare(intent,snapshot);assert.match(prepared.body,/\|createEntryExitReview\|/);assert.deepEqual(f.calls[0].selected,[target]);assert.equal(f.aborts,1);assert.equal(f.networkWrites,0);
});
test('an implicit sole selected member works even when the enrollment retains exited cohort members',async()=>{
 const f=fixture({implicit:true}),s=await f.reader.readEnrollment(f.target);await f.reader.prepare({kind:'create-interim-update',...f.target,clientIds:[1],reviewDate:'2026-11-11T16:00:00Z'},s);assert.equal(f.aborts,1);assert.equal(f.networkWrites,0);
});
test('group RPC remains valid for a single selection; single RPC is refused for multiple selections',async()=>{
 const f=fixture({forceMethod:'createEntryExitReviewWithHouseholdMembers'}),s=await f.reader.readEnrollment(f.target);await f.reader.prepare({kind:'create-interim-update',...f.target,clientIds:[1],reviewDate:'2026-11-11T16:00:00Z'},s);assert.equal(f.networkWrites,0);
 const g=fixture({forceMethod:'createEntryExitReview'}),gs=await g.reader.readEnrollment(g.target);await assert.rejects(g.reader.prepare({kind:'create-interim-update',...g.target,clientIds:[1,2],reviewDate:'2026-11-11T16:00:00Z'},gs),/Expected mutation/);assert.equal(g.aborts,1);assert.equal(g.networkWrites,0);
});
