const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaywrightGwtSession} from '../browser/playwright-session.mjs';

const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
function wire(rows){
 const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','java.lang.Integer/3438268394'];
 const text=value=>{strings.push(value);return strings.length;},stream=[1,2,rows.length];
 for(const row of rows){stream.push(3,Object.keys(row).length);for(const [name,value]of Object.entries(row)){stream.push(4,text(name));if(value===null)stream.push(0);else if(typeof value==='number')stream.push(5,value);else stream.push(4,text(value));}}
 stream.push(0,0,5,rows.length);return '//OK'+JSON.stringify(stream.reverse().concat([strings,0,7]));
}
function fixture(extra={},navigation={}){
 const calls=[],events=[],entry={enrollmentId:695,clientId:597,projectStartDate:'2026-10-19T16:00:00.000Z',groupId:null,providerId:16951,enrollmentType:'HUD',...extra};
 const dialogs=new Set(navigation.visibleInterim?['EntryExitAssessment.btnExit-button','EntryExitReviewListPopup.btnExit']:[]);
 let headingVisible=!navigation.staleHeading,navigationStarted=false;
 const locator=selector=>({
  count:async()=>selector==='select:visible'?Number(!!navigation.switcher):Number(dialogs.has(selector.match(/id="([^"]+)"/)?.[1])),
  isVisible:async()=>selector.includes('householdSubmitButton')&&!!navigation.switcher,
  filter(){return this;},last(){return this;},
  selectOption:async value=>{assert.equal(value,'597');events.push('select-client');},
  click:async()=>{const dialog=selector.match(/id="([^"]+)"/)?.[1];if(dialogs.has(dialog)){if(dialog==='EntryExitReviewListPopup.btnExit')assert.ok(!dialogs.has('EntryExitAssessment.btnExit-button'),'assessment blocks underlying review list');dialogs.delete(dialog);events.push('close:'+dialog);}if(selector.includes('householdSubmitButton')){events.push('submit-client');navigationStarted=true;}},
  waitFor:async()=>{},innerText:async()=>'Edit Project Start Data - (597)',evaluateAll:async()=>[],
 });
 const page={
  setDefaultTimeout(){},url:()=>base+`index.html#loadClient;clientId=${navigation.hashClientId??597}`,waitForFunction:async()=>{},locator,
  goto:async()=>{events.push('goto');navigationStarted=true;},
  getByRole:(_,options)=>({click:async()=>{assert.ok(headingVisible,'displayed client must be confirmed before tabs');events.push(options.name);}}),
  getByText:text=>text instanceof RegExp?{isVisible:async()=>headingVisible,waitFor:async()=>{assert.ok(navigationStarted);events.push('wait-client-heading');if(navigation.headingFails)throw Error('Client heading did not load');headingVisible=true;}}:{isVisible:async()=>false},
  waitForResponse:async()=>({status:()=>200,text:async()=>'//OK[]',request:()=>({postData:()=>`7|0|9|${base}|POLICY|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'PERMUTATION'})})}),
  evaluate:async(_,request)=>{
   calls.push(request);let rows=[];
   if(calls.length===1)rows=[entry];
   else if(request.body.includes('e.exitDate AS projectExitDate'))rows=navigation.exits??[{enrollmentId:695,clientId:597,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null}];
   else if(request.body.includes('e.exitSubgroupId ='))rows=navigation.exitMembers??[];
   else if(request.body.includes('e.groupId ='))rows=navigation.members??[];
   return {status:200,body:wire(rows)};
  },
 };
 return {calls,events,read:()=>createPlaywrightGwtSession({page,tenant:testTenant,moduleBaseUrl:base}).readEnrollment({clientId:597,enrollmentId:695})};
}
test('enrollment reader returns authoritative provider and type from mapped target',async()=>{
 const f=fixture(),result=await f.read();assert.equal(result.providerId,16951);assert.equal(result.enrollmentType,'HUD');
 assert.match(f.calls[0].body,/e.providerId AS providerId, e.typeEntryExit.name AS enrollmentType/);
 assert.deepEqual(result.members,[{clientId:597,enrollmentId:695}]);assert.deepEqual(result.reviews,[]);
 assert.ok(f.calls.every(call=>call.body.includes('|getMappedResults|')));
});
test('enrollment reader rejects missing or mismatched authoritative target context',async()=>{
 for(const extra of [{providerId:null},{providerId:0},{providerId:'16951'},{enrollmentType:''},{enrollmentType:null},{clientId:598},{enrollmentId:696}]){
  const f=fixture(extra);await assert.rejects(f.read(),/Enrollment context incomplete/);assert.equal(f.calls.length,1);
 }
});
test('stale target hash switches household client and waits for its displayed heading',async()=>{
 const f=fixture({},{staleHeading:true,switcher:true});await f.read();
 assert.deepEqual(f.events.slice(0,5),['select-client','submit-client','wait-client-heading','Summary','Entry / Exit']);assert.equal(f.calls.length,3);
});
test('stale target hash without household switcher fails closed before reading enrollment',async()=>{
 const f=fixture({},{staleHeading:true});await assert.rejects(f.read(),/Client navigation did not load/);assert.deepEqual(f.events,[]);assert.deepEqual(f.calls,[]);
});
test('hash navigation from another client waits for the requested displayed heading',async()=>{
 const f=fixture({},{staleHeading:true,hashClientId:596});await f.read();assert.deepEqual(f.events.slice(0,4),['goto','wait-client-heading','Summary','Entry / Exit']);
 const failed=fixture({},{staleHeading:true,hashClientId:596,headingFails:true});await assert.rejects(failed.read(),/heading did not load/);assert.deepEqual(failed.events,['goto','wait-client-heading']);assert.deepEqual(failed.calls,[]);
});
test('read from an open interim closes its assessment before the underlying review list',async()=>{
 const f=fixture({},{visibleInterim:true});const snapshot=await f.read();
 assert.equal(snapshot.enrollmentId,695);
 assert.deepEqual(f.events.slice(0,4),['close:EntryExitAssessment.btnExit-button','close:EntryExitReviewListPopup.btnExit','Summary','Entry / Exit']);
 assert.equal(f.calls.length,3);
});

test('enrollment reader returns complete null exit metadata for an open enrollment',async()=>{
 const result=await fixture().read();assert.deepEqual(result.exits,[{enrollmentId:695,clientId:597,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null,clientIds:[597],enrollmentIds:[695]}]);
});
test('enrollment reader preserves exit codes and exact subgroup members independently of entry group',async()=>{
 const exit={enrollmentId:695,clientId:597,projectExitDate:'2026-10-23T16:00:00Z',destination:'Rental by client',destinationCode:'RENTAL',reasonForLeaving:'Completed program',reasonForLeavingCode:'COMPLETE',exitSubgroupId:'exit-695'};
 const f=fixture({}, {exits:[exit],exitMembers:[{clientId:598,enrollmentId:696},{clientId:597,enrollmentId:695}]});
 const result=await f.read();assert.deepEqual(result.exits,[{...exit,clientIds:[597,598],enrollmentIds:[695,696]}]);
 assert.match(f.calls[2].body,/e.exitSubgroupId = 'exit-695'/);
});
test('enrollment reader rejects incomplete or malformed exit metadata',async()=>{
 const normal={enrollmentId:695,clientId:597,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null};
 for(const exits of [[],[{...normal,clientId:598}],[normal,normal],[{...normal,projectExitDate:'invalid'}],[{...normal,destinationCode:2}],[{...normal,exitSubgroupId:3}]])await assert.rejects(fixture({}, {exits}).read(),/Enrollment exit/);
 await assert.rejects(fixture({}, {exits:[{...normal,exitSubgroupId:'missing'}]}).read(),/subgroup incomplete/);
});
