import {pageConnection} from './connection.mjs';
import {createPlaywrightGwtSession} from './playwright-session.mjs';
import {withPageLock} from './page-lock.mjs';
import {expectedExitDetails,rentalDestination} from './exit-details.mjs';

const label=value=>value.replace(/\s*\(HUD\)\s*$/,'').trim();
const id=value=>Number.isSafeInteger(value)&&value>0;
/** Low-level UI port. Use through exitHousehold, which journals before save.
 * This port makes at most one Save click and never retries an uncertain write. */
export function createHouseholdExitUi({page}){
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
 const reader=createPlaywrightGwtSession({page,tenant:connection.tenant,moduleBaseUrl:base});
 const control=name=>page.locator(`[id="${name}"]:visible`);
 const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'));
 const cancel=async()=>{const button=control('ExitDataPopup.cancel-button');if(await button.count()){await button.click();await ready();}};
 const validate=input=>{
  if(!input||!id(input.clientId)||!id(input.enrollmentId))throw Error('Valid exit target required');
  if(!Array.isArray(input.clientIds)||input.clientIds.length<1||input.clientIds.some(v=>!id(v))||new Set(input.clientIds).size!==input.clientIds.length||!input.clientIds.includes(input.clientId))throw Error('Exact household exit members required');
  if(typeof input.exitDate!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.exitDate)||!Number.isFinite(Date.parse(input.exitDate))||new Date(input.exitDate.slice(0,19)+'Z').toISOString().slice(0,19)!==input.exitDate.slice(0,19))throw Error('Timezone-qualified exit date required');
  for(const field of ['destination','reasonForLeaving'])if(typeof input[field]!=='string'||!input[field].trim())throw Error('Exit choice required');
  expectedExitDetails(input);
 };
 const options=async name=>(await page.getByLabel(name,{exact:true}).locator('option').evaluateAll(es=>es.filter(e=>!e.disabled&&e.value&&e.value!=='-Select-'&&!e.text.startsWith('-----')).map(e=>({value:e.value,name:e.text})))).map(o=>({...o,name:label(o.name)}));
 const open=async target=>{
  const url=new URL(page.url());if(url.origin!==new URL(base).origin||url.pathname!==new URL(base).pathname+'index.html')throw Error('Configured application page required');
  await cancel();const snapshot=await reader.readEnrollment(target);
  await control(`ClientEntryExitTab.editExit-imageLink_${target.enrollmentId}`).click();await control('ExitDataPopup.cancel-button').waitFor();await ready();
  if(!(await page.locator('body').innerText()).includes(`Edit Exit Data - (${target.clientId})`))throw Error('Exit client mismatch');
  return snapshot;
 };
 // Locate each explanation relative to its own labeled select, never by field order.
 const otherField=name=>page.getByLabel(name,{exact:true}).locator('xpath=ancestor::tr[following-sibling::tr[1]//input[@maxlength="100"]][1]/following-sibling::tr[1]').getByRole('textbox');
 const selected=async name=>page.getByLabel(name,{exact:true}).evaluate(e=>{
  const o=e.selectedOptions;if(o.length!==1||!o[0].value||o[0].value==='-Select-')throw Error('Exit selection missing');return o[0].text;
 });
 const readDetails=async()=>{
  const destination=label(await selected('Destination')),reasonForLeaving=label(await selected('Reason for Leaving'));
  const destinationOther=await otherField('Destination').inputValue(),reasonOther=await otherField('Reason for Leaving').inputValue();
  if(await page.getByLabel('Subsidy',{exact:true}).isVisible())throw Error('Unrecognized legacy subsidy form');
  const rentalVisible=await page.getByLabel('Rental Subsidy Type',{exact:true}).isVisible();
  if(rentalVisible!==(destination===rentalDestination))throw Error('Exit subsidy form mismatch');
  if(destination!=='Other'&&destinationOther||reasonForLeaving!=='Other'&&reasonOther)throw Error('Unexpected stored Other explanation');
  const destinationDetails=destination===rentalDestination?{kind:'rental-subsidy',rentalSubsidyType:label(await selected('Rental Subsidy Type'))}:destination==='Other'?{kind:'other',explanation:destinationOther}:undefined;
  return expectedExitDetails({destination,reasonForLeaving,...(destinationDetails?{destinationDetails}:{}),...(reasonForLeaving==='Other'?{reasonForLeavingOther:reasonOther}:{})});
 };
 const configure=async input=>{
  validate(input);const snapshot=await open({clientId:input.clientId,enrollmentId:input.enrollmentId});
  const desired=[...input.clientIds].sort((a,b)=>a-b);
  if(!Array.isArray(snapshot.members)||!Array.isArray(snapshot.exits))throw Error('Exit household read incomplete');
  for(const clientId of desired){
   const members=snapshot.members.filter(m=>m.clientId===clientId);
   if(members.length!==1)throw Error('Selected exit member missing or ambiguous');
   const exits=snapshot.exits.filter(e=>e.clientId===clientId);
   if(exits.length!==1||exits[0].enrollmentId!==members[0].enrollmentId)throw Error('Selected exit metadata missing or ambiguous');
   if(exits[0].projectExitDate!==null)throw Error('Selected household member already exited');
  }
  if(Date.parse(input.exitDate)<Date.parse(snapshot.projectStartDate)||snapshot.reviews.some(r=>Date.parse(r.reviewDate)>Date.parse(input.exitDate)))throw Error('Exit date precedes enrollment or review');
  const choices={destinations:await options('Destination'),reasons:await options('Reason for Leaving')};
  const chosen={};
  for(const [field,name,items]of [['destination','Destination',choices.destinations],['reasonForLeaving','Reason for Leaving',choices.reasons]]){
   const matching=items.filter(o=>o.name===label(input[field]));if(matching.length!==1)throw Error('Exit choice unavailable or ambiguous');chosen[field]=matching[0].value;await page.getByLabel(name,{exact:true}).selectOption(chosen[field]);
  }
  await ready();
  if(await page.getByLabel('Subsidy',{exact:true}).isVisible())throw Error('Unrecognized legacy subsidy form');
  if(input.destinationDetails?.kind==='rental-subsidy'){
   const field=page.getByLabel('Rental Subsidy Type',{exact:true});
   if(!await field.isVisible())throw Error('Rental subsidy field unavailable');
   const matches=(await options('Rental Subsidy Type')).filter(o=>o.name===input.destinationDetails.rentalSubsidyType);
   if(matches.length!==1)throw Error('Rental subsidy choice unavailable or ambiguous');
   await field.selectOption(matches[0].value);if(await field.inputValue()!==matches[0].value)throw Error('Rental subsidy selection did not match');
  }else if(await page.getByLabel('Rental Subsidy Type',{exact:true}).isVisible())throw Error('Unexpected rental subsidy field');
  for(const [name,value]of [['Destination',input.destinationDetails?.kind==='other'?input.destinationDetails.explanation:''],['Reason for Leaving',input.reasonForLeavingOther??'']]){
   const field=otherField(name);if(await field.count()!==1||!await field.isVisible()||await field.getAttribute('maxlength')!=='100')throw Error('Other explanation field unavailable');
   await field.fill(value);if(await field.inputValue()!==value)throw Error('Other explanation did not match');
  }
  const boxes=page.locator('[id^="HouseholdsCheckboxTree.householdCheckbox."]:visible input');
  for(let i=0;i<await boxes.count();i++){
   const box=boxes.nth(i),clientId=await box.evaluate(e=>Number(e.parentElement.id.match(/\.client-(\d+)$/)?.[1]));
   if(await box.isEnabled())await box.setChecked(desired.includes(clientId));
   if((await box.isChecked())!==desired.includes(clientId))throw Error('Exit household selection mismatch');
  }
  const selected=await page.locator('[id^="HouseholdsCheckboxTree.householdCheckbox."]:visible input:checked').evaluateAll(es=>es.map(e=>Number(e.parentElement.id.match(/\.client-(\d+)$/)?.[1])).sort((a,b)=>a-b));
  if(JSON.stringify(selected)!==JSON.stringify(desired))throw Error('Exit household selection incomplete');
  const parts=await page.evaluate(value=>{const d=new Date(value),local=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds());if(+d!==+local)throw Error('Ambiguous local exit time');return {Month:String(d.getMonth()+1).padStart(2,'0'),Day:String(d.getDate()).padStart(2,'0'),Year:String(d.getFullYear()),Hour:String(d.getHours()%12||12),Minute:String(d.getMinutes()).padStart(2,'0'),Second:String(d.getSeconds()).padStart(2,'0'),'AM/PM':d.getHours()<12?'AM':'PM'};},input.exitDate);
  for(const [part,value]of Object.entries(parts)){const field=page.getByLabel(`Exit Date ${part}`,{exact:true});if(['Month','Day','Year'].includes(part))await field.fill(value);else await field.selectOption({label:value});if(await field.inputValue()!==value)throw Error('Exit date did not match');}
  for(const [field,name]of [['destination','Destination'],['reasonForLeaving','Reason for Leaving']])if(await page.getByLabel(name,{exact:true}).inputValue()!==chosen[field])throw Error('Exit choice did not match');
 };
 return {connection,
  listOptions:target=>withPageLock(page,async()=>{if(!id(target?.clientId)||!id(target?.enrollmentId))throw Error('Valid exit target required');try{await open(target);const result={destinations:await options('Destination'),reasons:await options('Reason for Leaving'),rentalSubsidyTypes:[]};const rental=result.destinations.filter(o=>o.name===rentalDestination);if(rental.length>1)throw Error('Ambiguous rental destination');if(rental.length){await page.getByLabel('Destination',{exact:true}).selectOption(rental[0].value);await ready();if(!await page.getByLabel('Rental Subsidy Type',{exact:true}).isVisible())throw Error('Rental subsidy field unavailable');result.rentalSubsidyTypes=await options('Rental Subsidy Type');}return result;}finally{await cancel();}}),
  readExitDetails:target=>withPageLock(page,async()=>{if(!id(target?.clientId)||!id(target?.enrollmentId))throw Error('Valid exit target required');try{const snapshot=await open(target);if(!snapshot.exits.some(e=>e.clientId===target.clientId&&e.enrollmentId===target.enrollmentId&&e.projectExitDate))throw Error('Saved exit required');return await readDetails();}finally{await cancel();}}),
  validateExit:input=>withPageLock(page,async()=>{try{await configure(input);}finally{await cancel();}}),
  saveExit:input=>withPageLock(page,async()=>{
   try{
    await configure(input);
    await control('ExitDataPopup.saveAndContinue-button').click();
    await control('ExitDataPopup.cancel-button').waitFor({state:'hidden',timeout:30000});
    await ready();
    // A success screen is not proof of a committed household exit. The caller must read it back.
   }finally{await cancel();}
  }),
 };
}
