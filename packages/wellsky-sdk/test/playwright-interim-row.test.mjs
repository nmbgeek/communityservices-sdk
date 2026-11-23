import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createPlaywrightGwtSession} from '../browser/playwright-session.mjs';

const tenant='synthetic',base=`https://wscs.wellsky.com/${tenant}/com.bowmansystems.sp5.core.ServicePoint/`;
function wire(rows){
 const strings=['com.bowmansystems.sp5.core.client.ui.MappedQueryResults/340212582','java.util.ArrayList/4159755760','java.util.HashMap/1797211028','java.lang.String/2004016611','java.lang.Integer/3438268394'];
 const text=value=>{strings.push(value);return strings.length;},stream=[1,2,rows.length];
 for(const row of rows){stream.push(3,Object.keys(row).length);for(const [name,value]of Object.entries(row)){stream.push(4,text(name));if(value===null)stream.push(0);else if(typeof value==='number')stream.push(5,value);else stream.push(4,text(value));}}
 stream.push(0,0,5,rows.length);return '//OK'+JSON.stringify(stream.reverse().concat([strings,0,7]));
}

for(const enrollmentId of [50,52])for(const reviewCount of [0,1,2])test(`nested enrollment rows: target ${enrollmentId}, ${reviewCount} review controls`,{skip:!process.env.WELLSKY_TEST_CHROME},async t=>{
 const browser=await chromium.launch({executablePath:process.env.WELLSKY_TEST_CHROME,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage();
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<div>Client - (1)</div><button role="tab">Summary</button><button role="tab">Entry / Exit</button>
 <table><tr><td><table>${[50,52].map(id=>`<tr><td><button id="ClientEntryExitTab.editEntry-imageLink_${id}" onclick="entry()">Edit</button></td><td>${Array.from({length:id===enrollmentId?reviewCount:1},()=>`<button title="Interim Reviews: ${id}" onclick="reviews(${id})">Reviews</button>`).join('')}</td></tr>`).join('')}</table></td></tr></table>
 <script>window.opened=[];function entry(){const d=document.createElement('div');d.innerHTML='Edit Project Start Data - (1)<button id="EntryDataPopup.cancel-button" onclick="this.parentElement.remove()">Cancel</button>';document.body.append(d);}function reviews(id){opened.push(id);const d=document.createElement('div');d.innerHTML='<button id="EntryExitReviewListPopup.addReviewButton" onclick="review()">Add</button><button id="EntryExitReviewListPopup.btnExit" onclick="this.parentElement.remove()">Close</button>';document.body.append(d);}function review(){const d=document.createElement('div');d.innerHTML='<button id="ModifyReviewPopup.saveAndContinue-button">Save</button>';document.body.append(d);}</script>`}));
 await page.goto(base+'index.html');
 // Keep real DOM locators; stub only the GWT read transport and form inputs.
 const evaluate=page.evaluate.bind(page);
 page.evaluate=async(fn,arg)=>{
  if(!arg?.body)return evaluate(fn,arg);
  let rows=[];
  if(arg.body.includes('e.typeEntryExit.name AS enrollmentType'))rows=[{enrollmentId,clientId:1,projectStartDate:'2026-11-01T16:00:00Z',groupId:null,householdId:null,providerId:99,enrollmentType:'HUD'}];
  else if(arg.body.includes('e.exitDate AS projectExitDate'))rows=[{enrollmentId,clientId:1,projectExitDate:null,destination:null,destinationCode:null,reasonForLeaving:null,reasonForLeavingCode:null,exitSubgroupId:null}];
  return {status:200,body:wire(rows)};
 };
 page.waitForResponse=async()=>({status:()=>200,text:async()=>'//OK[]',request:()=>({postData:()=>`7|0|9|${base}|POLICY|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'PERMUTATION'})})});
 page.getByLabel=label=>({inputValue:async()=>'',selectOption:async()=>{assert.equal(label,'Interim Review Type');throw Error('fixture stops before writing');}});
 const session=createPlaywrightGwtSession({page,tenant,moduleBaseUrl:base}),target={clientId:1,enrollmentId},snapshot=await session.readEnrollment(target);
 await assert.rejects(session.prepare({kind:'create-interim-update',...target,clientIds:[1],reviewDate:'2026-11-23T16:00:00Z'},snapshot),reviewCount===1?/fixture stops before writing/:/Interim review control.*missing or ambiguous/);
 assert.deepEqual(await evaluate(()=>window.opened),reviewCount===1?[enrollmentId]:[]);
});
