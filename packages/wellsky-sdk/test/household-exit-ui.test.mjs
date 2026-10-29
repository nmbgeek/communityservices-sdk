const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHouseholdExitUi} from '../browser/household-exit.mjs';

const rentalDestination='Rental by client, with ongoing housing subsidy';
const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/').replaceAll('tenant-b', testTenant);
const input=()=>({clientId:1,enrollmentId:50,clientIds:[1,2],exitDate:'2026-10-23T16:00:00Z',destination:'Rental by client (HUD)',reasonForLeaving:'Completed program'});
function wire(rows){
 const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','java.lang.Integer/3438268394'];
 const text=value=>{strings.push(value);return strings.length;},stream=[1,2,rows.length];
 for(const row of rows){stream.push(3,Object.keys(row).length);for(const [name,value]of Object.entries(row)){stream.push(4,text(name));if(value===null)stream.push(0);else if(typeof value==='number')stream.push(5,value);else stream.push(4,text(value));}}
 stream.push(0,0,5,rows.length);return '//OK'+JSON.stringify(stream.reverse().concat([strings,0,7]));
}
function fixture(faults={}){
 const targetClient=faults.targetClient??1,targetEnrollment=faults.targetEnrollment??50;
 const events=[],dialogs=new Set(),values=new Map(),boxes=(faults.boxIds??[1,2,3]).map(clientId=>({clientId,checked:(faults.checkedIds??[1]).includes(clientId),disabled:clientId===faults.disabledClient}));let saves=0,openCount=0,savePending=false;
 const choices={Destination:[{value:'',text:'-Select-'},{value:'divider',text:'----- Permanent -----'},{value:faults.codeValues?'RENTAL':'Rental by client',text:'Rental by client (HUD)'},{value:'Other',text:'Other (HUD)'},{value:'SUBSIDIZED',text:rentalDestination+' (HUD)'},{value:'disabled',text:'Unavailable',disabled:true}], 'Reason for Leaving':[{value:faults.codeValues?'COMPLETE':'Completed program',text:'Completed program'},{value:'Other',text:'Other'}], 'Rental Subsidy Type':[{value:'-Select-',text:'-Select-'},{value:'VASH',text:'VASH housing subsidy'},{value:'RRH',text:'RRH or equivalent subsidy'}]};
 values.set('Destination',faults.storedDestination??'Rental by client');values.set('Reason for Leaving',faults.storedReason??'Completed program');values.set('Rental Subsidy Type',faults.storedSubsidy??'-Select-');values.set('Destination Other',faults.storedDestinationOther??'');values.set('Reason for Leaving Other',faults.storedReasonOther??'');
 if(faults.duplicateSubsidy)choices['Rental Subsidy Type'].push({value:'VASH-DUPLICATE',text:'VASH housing subsidy'});
 if(faults.duplicateChoice)choices.Destination.push({value:'duplicate',text:'Rental by client'});
 const members=faults.members??[{clientId:1,enrollmentId:50},{clientId:2,enrollmentId:52}];
 const exits=faults.exitRows??members.map(m=>({...m,projectExitDate:faults.exited||faults.exitedIds?.includes(m.clientId)?'2026-10-22T16:00:00Z':null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null}));
 const locator=selector=>{
  const identifier=selector.match(/\[id="([^"]+)"\]/)?.[1];
  if(selector.includes('HouseholdsCheckboxTree')){
   const selected=selector.includes(':checked');return {count:async()=>boxes.length,evaluateAll:async fn=>fn(boxes.filter(b=>!selected||b.checked).map(b=>selector.includes(' input')?{parentElement:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${b.clientId}`}}:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${b.clientId}`})),nth:i=>({evaluate:async fn=>fn({parentElement:{id:`HouseholdsCheckboxTree.householdCheckbox.client-${boxes[i].clientId}`}}),isEnabled:async()=>!boxes[i].disabled,setChecked:async checked=>{boxes[i].checked=checked;},isChecked:async()=>boxes[i].checked})};
  }
  return {
   count:async()=>Number(dialogs.has(identifier)),isVisible:async()=>false,waitFor:async options=>{if(identifier==='ExitDataPopup.cancel-button'&&options?.state==='hidden'){events.push('await-save-completion');savePending=false;dialogs.delete(identifier);}},last(){return this;},filter(){return this;},
   innerText:async()=>dialogs.has('ExitDataPopup.cancel-button')?`Edit Exit Data - (${faults.wrongClient?3:targetClient})`:`Edit Project Start Data - (${targetClient})`,
   click:async()=>{events.push(identifier);if(identifier?.startsWith('ClientEntryExitTab.editEntry'))dialogs.add('EntryDataPopup.cancel-button');else if(identifier?.startsWith('ClientEntryExitTab.editExit')){dialogs.add('ExitDataPopup.cancel-button');openCount++;}else if(identifier==='ExitDataPopup.saveAndContinue-button'){saves++;if(faults.saveThrows)throw Error('Save response lost');if(faults.delayedSave)savePending=true;else dialogs.delete('ExitDataPopup.cancel-button');}else{if(identifier==='ExitDataPopup.cancel-button'&&savePending)throw Error('Canceled while save was pending');dialogs.delete(identifier);}},
  };
 };
 const page={
  setDefaultTimeout(){},url:()=>faults.production?'https://wscs.wellsky.com/different-tenant/com.bowmansystems.sp5.core.ServicePoint/index.html':base+`index.html#loadClient;clientId=${targetClient}`,locator,
  waitForFunction:async()=>{if(saves&&faults.readyThrows)throw Error('Uncertain post-save state');},
  getByText:text=>({isVisible:async()=>text instanceof RegExp,waitFor:async()=>{}}),getByRole:()=>({click:async()=>{}}),
  getByLabel:name=>({
   locator:selector=>{
    if(selector==='option')return {evaluateAll:async fn=>fn(choices[name]??[])};
    assert.equal(selector,'xpath=ancestor::tr[following-sibling::tr[1]//input[@maxlength="100"]][1]/following-sibling::tr[1]');return {getByRole:role=>{assert.equal(role,'textbox');return {count:async()=>faults.missingOther?0:1,isVisible:async()=>!faults.hiddenOther,getAttribute:async()=>faults.wrongMaxlength?'200':'100',fill:async value=>values.set(name+' Other',faults.truncateOther?value.slice(0,5):value),inputValue:async()=>values.get(name+' Other')};}};
   },
   evaluate:async fn=>fn({selectedOptions:(choices[name]??[]).filter(o=>o.value===values.get(name))}),
   isVisible:async()=>name==='Rental Subsidy Type'?(faults.subsidy||values.get('Destination')==='SUBSIDIZED')&&!faults.missingSubsidy:name==='Subsidy'&&!!faults.legacySubsidy,
   selectOption:async value=>{const chosen=typeof value==='object'?value.label:value;values.set(name,chosen);events.push('select:'+name);},fill:async value=>values.set(name,value),
   inputValue:async()=>faults.dateMismatch&&name==='Exit Date Day'?'24':values.get(name),
  }),
  waitForResponse:async()=>({status:()=>200,text:async()=>'//OK[]',request:()=>({postData:()=>`7|0|9|${base}|POLICY|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'PERMUTATION'})})}),
  evaluate:async(fn,request)=>{
   if(typeof request==='string')return fn(request);
   let rows=[];const body=request.body;
   if(body.includes('e.typeEntryExit.name AS enrollmentType'))rows=[{enrollmentId:targetEnrollment,clientId:targetClient,projectStartDate:'2026-10-19T16:00:00Z',groupId:50,providerId:2,enrollmentType:'HUD'}];
   else if(body.includes('e.exitDate AS projectExitDate'))rows=exits;
   else if(body.includes('FROM SpEntryExit AS e')&&body.includes('e.groupId ='))rows=members;
   else if(body.includes('FROM SpEntryExitReview AS r')&&faults.laterReview)rows=[{reviewId:61,subgroupId:null,reviewDate:'2026-10-24T16:00:00Z',type:'Update'}];
   return {status:200,body:wire(rows)};
  },
 };
 const changedTenant=faults.production;faults.production=false;const port=createHouseholdExitUi({page});faults.production=changedTenant;
 return {port,events,values,boxes,dialogs,get saves(){return saves;},get openCount(){return openCount;}};
}
test('exit options exclude disabled, placeholder and section choices and close the dialog',async()=>{
 const f=fixture(),result=await f.port.listOptions({clientId:1,enrollmentId:50});assert.deepEqual(result.destinations,[{value:'Rental by client',name:'Rental by client'},{value:'Other',name:'Other'},{value:'SUBSIDIZED',name:rentalDestination}]);assert.deepEqual(result.rentalSubsidyTypes,[{value:'VASH',name:'VASH housing subsidy'},{value:'RRH',name:'RRH or equivalent subsidy'}]);assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);
});
test('exit validation configures exact members and date without saving',async()=>{
 const f=fixture();await f.port.validateExit(input());assert.equal(f.saves,0);assert.deepEqual(f.boxes.map(b=>[b.clientId,b.checked]),[[1,true],[2,true],[3,false]]);assert.equal(f.values.get('Exit Date Day'),'23');assert.equal(f.dialogs.size,0);
});
test('exit save makes exactly one save click and validation is separately read-only',async()=>{
 const f=fixture();await f.port.validateExit(input());await f.port.saveExit(input());assert.equal(f.saves,1);assert.equal(f.openCount,2);assert.equal(f.dialogs.size,0);
});
test('exit selection validates actual option values independently from displayed labels',async()=>{
 const f=fixture({codeValues:true});await f.port.saveExit(input());assert.equal(f.saves,1);assert.equal(f.values.get('Destination'),'RENTAL');assert.equal(f.values.get('Reason for Leaving'),'COMPLETE');
});
test('invalid exit inputs fail before opening a dialog or saving',async()=>{
 for(const change of [i=>i.clientId=0,i=>i.clientIds=[1,1],i=>i.clientIds=[2,3],i=>i.exitDate='2026-02-30T16:00:00Z',i=>i.exitDate='2026-10-23T16:00:00',i=>i.exitDate='2026-10-23T16:00:00.100Z',i=>i.destination='Other (HUD)',i=>i.reasonForLeaving='Other']){
  const f=fixture(),value=input();change(value);await assert.rejects(f.port.saveExit(value));assert.equal(f.openCount,0);assert.equal(f.saves,0);
 }
});
test('changed tenant page, wrong client, changed household and existing exit fail before saving',async()=>{
 for(const faults of [{production:true},{wrongClient:true},{members:[{clientId:1,enrollmentId:50},{clientId:3,enrollmentId:53}]},{exited:true},{laterReview:true}]){const f=fixture(faults);await assert.rejects(f.port.saveExit(input()));assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
});
test('ambiguous or unavailable choices and unsupported details fail before saving',async()=>{
 for(const faults of [{duplicateChoice:true},{subsidy:true}]){const f=fixture(faults);await assert.rejects(f.port.saveExit(input()));assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
 const f=fixture(),value=input();value.destination='Unknown destination';await assert.rejects(f.port.saveExit(value),/choice unavailable/);assert.equal(f.saves,0);
});
test('disabled or missing household selection and date mismatch fail before saving',async()=>{
 for(const faults of [{disabledClient:2},{boxIds:[1,3]},{dateMismatch:true}]){const f=fixture(faults);await assert.rejects(f.port.saveExit(input()));assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
});
test('save-click or post-save failure never triggers an automatic second save',async()=>{
 for(const faults of [{saveThrows:true},{readyThrows:true}]){const f=fixture(faults);await assert.rejects(f.port.saveExit(input()));assert.equal(f.saves,1);}
});

test('successful delayed save completes before cleanup can cancel its dialog',async()=>{
 const f=fixture({delayedSave:true});await f.port.saveExit(input());assert.equal(f.saves,1);assert.ok(f.events.includes('await-save-completion'));assert.equal(f.dialogs.size,0);
});
function rentalInput(){return {...input(),destination:rentalDestination,destinationDetails:{kind:'rental-subsidy',rentalSubsidyType:'VASH housing subsidy'}};}
function otherInput(){return {...input(),destination:'Other (HUD)',destinationDetails:{kind:'other',explanation:'Synthetic destination Other'},reasonForLeaving:'Other',reasonForLeavingOther:'Synthetic separate reason Other'};}
test('subsidy exit selects an available exact type and preserves empty irrelevant Other fields',async()=>{
 const f=fixture();await f.port.saveExit(rentalInput());assert.equal(f.saves,1);assert.equal(f.values.get('Rental Subsidy Type'),'VASH');assert.equal(f.values.get('Destination Other'),'');assert.equal(f.values.get('Reason for Leaving Other'),'');
});
test('destination Other and reason Other populate their own scoped textboxes without swapping',async()=>{
 const f=fixture();await f.port.validateExit(otherInput());assert.equal(f.saves,0);await f.port.saveExit(otherInput());assert.equal(f.saves,1);assert.equal(f.values.get('Destination Other'),'Synthetic destination Other');assert.equal(f.values.get('Reason for Leaving Other'),'Synthetic separate reason Other');
});
test('extra exit detail input rejects mismatched discriminants, irrelevant values and invalid text before navigation',async()=>{
 const bad=[{...rentalInput(),destinationDetails:undefined},{...otherInput(),destinationDetails:undefined},{...otherInput(),reasonForLeavingOther:undefined},{...input(),destinationDetails:{kind:'other',explanation:'irrelevant'}},{...input(),reasonForLeavingOther:'irrelevant'},{...rentalInput(),destinationDetails:{kind:'other',explanation:'wrong kind'}}];
 for(const text of ['', ' ', ' leading', 'trailing ', 'a\nb', 'a\rb', 'a\tb','a\u0085b', 'a\u007fb','x'.repeat(101)]){bad.push({...otherInput(),destinationDetails:{kind:'other',explanation:text}});bad.push({...otherInput(),reasonForLeavingOther:text});}
 for(const value of bad){const f=fixture();await assert.rejects(f.port.saveExit(value));assert.equal(f.openCount,0);assert.equal(f.saves,0);}
});
test('Other explanations accept the exact 100-character bound with no normalization',async()=>{
 const f=fixture(),value=otherInput();value.destinationDetails.explanation='A'.repeat(100);value.reasonForLeavingOther='B'.repeat(100);await f.port.saveExit(value);assert.equal(f.values.get('Destination Other'),value.destinationDetails.explanation);assert.equal(f.values.get('Reason for Leaving Other'),value.reasonForLeavingOther);
});
test('missing or ambiguous subsidy choice and mismatched textbox contract fail without save',async()=>{
 for(const faults of [{missingSubsidy:true},{duplicateSubsidy:true},{legacySubsidy:true}]){const f=fixture(faults);await assert.rejects(f.port.saveExit(rentalInput()));assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
 const f=fixture(),value=rentalInput();value.destinationDetails.rentalSubsidyType='Not available';await assert.rejects(f.port.saveExit(value),/subsidy choice/);assert.equal(f.saves,0);
 for(const faults of [{missingOther:true},{hiddenOther:true},{wrongMaxlength:true},{truncateOther:true}]){const f=fixture(faults);await assert.rejects(f.port.saveExit(otherInput()));assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
});
test('readExitDetails reads exact stored subsidy and separate Other fields without saving',async()=>{
 for(const [faults,expected]of [
  [{exited:true,storedDestination:'SUBSIDIZED',storedSubsidy:'VASH'},{destinationDetails:{kind:'rental-subsidy',rentalSubsidyType:'VASH housing subsidy'},reasonForLeavingOther:null}],
  [{exited:true,storedDestination:'Other',storedReason:'Other',storedDestinationOther:'Stored destination',storedReasonOther:'Stored reason'},{destinationDetails:{kind:'other',explanation:'Stored destination'},reasonForLeavingOther:'Stored reason'}],
  [{exited:true},{destinationDetails:null,reasonForLeavingOther:null}],
 ]){const f=fixture(faults);assert.deepEqual(await f.port.readExitDetails({clientId:1,enrollmentId:50}),expected);assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
});
test('readExitDetails rejects an unexited target, unexpected hidden details and wrong conditional form',async()=>{
 for(const faults of [{},{exited:true,wrongClient:true},{exited:true,storedDestinationOther:'Unexpected'},{exited:true,storedReasonOther:'Unexpected'},{exited:true,storedDestination:'SUBSIDIZED',missingSubsidy:true},{exited:true,subsidy:true},{exited:true,legacySubsidy:true},{exited:true,storedDestination:'SUBSIDIZED',storedSubsidy:'-Select-'}]){const f=fixture(faults);await assert.rejects(f.port.readExitDetails({clientId:1,enrollmentId:50}));assert.equal(f.saves,0);assert.equal(f.dialogs.size,0);}
});

// Opt in to the real DOM contract without requiring Chrome for ordinary SDK consumers.
// WELLSKY_TEST_CHROME=/absolute/path/to/chrome node --test test/household-exit-ui.test.mjs
 test('nested destination table locates its own Other textbox in a real browser', {skip:!process.env.WELLSKY_TEST_CHROME}, async()=>{
 const {chromium}=await import('playwright-core'),{readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../browser/household-exit.mjs',import.meta.url),'utf8');
 const selector=source.match(/const otherField=name=>[^\n]*?\.locator\('([^']+)'\)/)?.[1];assert.ok(selector,'read the actual shipped Other-field selector');
 const browser=await chromium.launch({headless:true,executablePath:process.env.WELLSKY_TEST_CHROME});
 try{
  const page=await browser.newPage();await page.setContent(`<table>
   <tr><td><select aria-label="Reason for Leaving"><option>Other</option></select></td></tr>
   <tr><td><input aria-label="Reason explanation" maxlength="100" value="Stored reason"></td></tr>
   <tr><td><table><tr><td><select aria-label="Destination"><option>Other (HUD)</option></select></td><td>Nested picker control</td></tr></table></td></tr>
   <tr><td><input aria-label="Destination explanation" maxlength="100" value="Stored destination"></td></tr>
   <tr><td><textarea aria-label="Notes">Untouched notes</textarea></td></tr>
  </table>`);
  const other=name=>page.getByLabel(name,{exact:true}).locator(selector).getByRole('textbox');
  assert.equal(await other('Destination').count(),1);assert.equal(await other('Reason for Leaving').count(),1);
  assert.equal(await other('Destination').inputValue(),'Stored destination');assert.equal(await other('Reason for Leaving').inputValue(),'Stored reason');
  await other('Destination').fill('New destination');await other('Reason for Leaving').fill('New reason');
  assert.equal(await page.getByLabel('Destination explanation',{exact:true}).inputValue(),'New destination');assert.equal(await page.getByLabel('Reason explanation',{exact:true}).inputValue(),'New reason');assert.equal(await page.getByLabel('Notes',{exact:true}).inputValue(),'Untouched notes');
 }finally{await browser.close();}
 });

test('selected singleton exit permits an already exited household member outside the selection',async()=>{
 const f=fixture({targetClient:2,targetEnrollment:52,exitedIds:[1],checkedIds:[1,2]}),value={...input(),clientId:2,enrollmentId:52,clientIds:[2]};
 await f.port.saveExit(value);assert.equal(f.saves,1);assert.deepEqual(f.boxes.map(b=>[b.clientId,b.checked]),[[1,false],[2,true],[3,false]]);assert.ok(f.events.includes('ClientEntryExitTab.editExit-imageLink_52'));
});
test('selected household subset excludes all other members, including a previously checked member',async()=>{
 const members=[{clientId:1,enrollmentId:50},{clientId:2,enrollmentId:52},{clientId:3,enrollmentId:53}],f=fixture({members,checkedIds:[1,2,3]}),value={...input(),clientIds:[1,3]};
 await f.port.validateExit(value);assert.equal(f.saves,0);assert.deepEqual(f.boxes.map(b=>[b.clientId,b.checked]),[[1,true],[2,false],[3,true]]);await f.port.saveExit(value);assert.equal(f.saves,1);
});
test('selected subset rejects missing, duplicated or already exited selected members before saving',async()=>{
 const normal=[{clientId:1,enrollmentId:50,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null},{clientId:2,enrollmentId:52,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null}];
 for(const faults of [{members:[{clientId:1,enrollmentId:50}]},{members:[{clientId:1,enrollmentId:50},{clientId:2,enrollmentId:52},{clientId:2,enrollmentId:54}]},{exitedIds:[2]},{exitRows:normal.slice(0,1)},{exitRows:[normal[0],normal[1],normal[1]]},{exitRows:[normal[0],{...normal[1],enrollmentId:54}]}]){
  const f=fixture(faults);await assert.rejects(f.port.saveExit(input()));assert.equal(f.saves,0);
 }
});
test('singleton exit rejects empty selection, an excluded target and a locked checked excluded member',async()=>{
 for(const clientIds of [[],[2]]){const f=fixture();await assert.rejects(f.port.saveExit({...input(),clientIds}));assert.equal(f.saves,0);assert.equal(f.openCount,0);}
 const f=fixture({targetClient:2,targetEnrollment:52,disabledClient:1,checkedIds:[1,2],exitedIds:[1]});await assert.rejects(f.port.saveExit({...input(),clientId:2,enrollmentId:52,clientIds:[2]}),/selection mismatch/);assert.equal(f.saves,0);
});
test('singleton selected exit retains scoped Other and subsidy detail support',async()=>{
 for(const value of [otherInput(),rentalInput()]){const f=fixture({targetClient:2,targetEnrollment:52,exitedIds:[1]});await f.port.saveExit({...value,clientId:2,enrollmentId:52,clientIds:[2]});assert.equal(f.saves,1);assert.deepEqual(f.boxes.filter(b=>b.checked).map(b=>b.clientId),[2]);if(value.destinationDetails.kind==='other')assert.equal(f.values.get('Destination Other'),value.destinationDetails.explanation);else assert.equal(f.values.get('Rental Subsidy Type'),'VASH');}
});
