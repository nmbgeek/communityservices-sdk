const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createDateOfBirthUi} from '../browser/date-of-birth-ui.mjs';
// Synthetic pages only: use Playwright's default sandbox setting, matching the
// other browser fixtures and supporting the isolated root-run CI container.
const base=('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html').replaceAll('tenant-b', testTenant);
const html=`<!doctype html><body><main></main><script>
window.saved='1980-07-04';window.saves=0;
function render(){
 document.querySelector('main').innerHTML='<div>Client - (1) Synthetic</div><button role="tab">Client Information</button><button role="tab">Summary</button><button role="tab" onclick="entryList()">Entry / Exit</button><table><tr><td>Date of Birth</td><td>'+saved.slice(5,7)+'/'+saved.slice(8)+'/'+saved.slice(0,4)+' (Age 40)</td></tr></table><button id="leave">Exit</button>';
 document.querySelector('#leave').onclick=()=>{location.hash='clientPointClientMain';document.querySelector('main').innerHTML='Clients';};
}
function entryList(){document.querySelector('main').insertAdjacentHTML('beforeend','<button id="ClientEntryExitTab.editEntry-imageLink_2" onclick="entry()">Edit Entry</button>');}
function entry(){
 const vals={Month:'10',Day:'23',Year:'2026',Hour:'2',Minute:'00',Second:'00','AM/PM':'PM'};
 const inputs=Object.entries(vals).map(([k,v])=>'<input aria-label="Project Start Date '+k+'" value="'+v+'">').join('');
 document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-label="Entry"><p>Edit Project Start Data - (1)</p>'+inputs+'<button id="EntryDataPopup.cancel-button" onclick="this.parentElement.remove()">Cancel</button><button id="EntryDataPopup.saveAndContinue-button" onclick="this.parentElement.remove();assessment()">Continue</button></div>');
}
function assessment(){
 const parts={Year:saved.slice(0,4),Month:saved.slice(5,7),Day:saved.slice(8)};
 const inputs=Object.entries(parts).map(([k,v])=>'<input aria-label="Date of Birth '+k+'" value="'+v+'">').join('');
 document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-label="Entry/Exit Data"><button>Entry Assessment</button><p>check_circle (1) Synthetic</p>'+inputs+'<input aria-label="Unrelated" value="keep"><button onclick="save()">Save</button><button id="EntryExitAssessment.btnExit-button" onclick="this.parentElement.remove()">Exit</button></div>');
 for(const e of document.querySelectorAll('[aria-label^="Date of Birth"]'))e.addEventListener('change',()=>{
  const oldDay=document.querySelector('[aria-label="Date of Birth Day"]').value;
  const busy=document.createElement('div');busy.textContent='Processing...';document.body.append(busy);
  setTimeout(()=>{document.querySelector('[aria-label="Date of Birth Day"]').value=oldDay;busy.remove();},25);
 });
}
function save(){
 if(window.validation){document.body.insertAdjacentHTML('beforeend','<div role="dialog" aria-label="Validation Warning">Missing required answer</div>');return;}
 const value=k=>document.querySelector('[aria-label="Date of Birth '+k+'"]').value;
 saved=value('Year')+'-'+value('Month').padStart(2,'0')+'-'+value('Day').padStart(2,'0');saves++;
}
window.addEventListener('hashchange',()=>{if(location.hash.startsWith('#loadClient'))render();});render();
</script>`;
test('real browser DOB editor waits for component refreshes, preserves controls, and guards entry date', {skip:!process.env.WELLSKY_TEST_CHROME},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.WELLSKY_TEST_CHROME});
 try{
  const context=await browser.newContext({timezoneId:'America/New_York'}),page=await context.newPage();
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:html}));await page.goto(base+'#loadClient;clientId=1');
  const ui=createDateOfBirthUi({page});assert.equal(await ui.read(1),'1980-07-04');
  let journal=0;const input={clientId:1,entry:{enrollmentId:2,assessmentName:'Entry Assessment'},dateOfBirth:'1984-02-29',effectiveDate:'2026-10-23T18:00:00Z',expectedDateOfBirth:'1980-07-04',beforeSave:async()=>{journal++;assert.equal(await page.getByLabel('Unrelated').inputValue(),'keep');}};
  await ui.correctAtEntry(input);assert.equal(journal,1);assert.equal(await ui.read(1),'1984-02-29');assert.equal(await page.evaluate(()=>saves),1);
  await assert.rejects(ui.correctAtEntry({...input,effectiveDate:'2026-10-23T19:00:00Z'}),/exact existing entry/);assert.equal(journal,1);assert.equal(await page.evaluate(()=>saves),1);
  await page.evaluate(()=>{window.validation=true;});
  await assert.rejects(ui.correctAtEntry({...input,expectedDateOfBirth:'1984-02-29',dateOfBirth:'1988-02-29'}),/validation blocked/);assert.equal(await page.evaluate(()=>saves),1);
 }finally{await browser.close();}
});

test('real browser timezone preflight rejects a winter date that would display on the preceding day', {skip:!process.env.WELLSKY_TEST_CHROME},async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.WELLSKY_TEST_CHROME});
 try{
  const eastern=await browser.newContext({timezoneId:'America/New_York'}),pacific=await browser.newContext({timezoneId:'America/Los_Angeles'});
  const pages=await Promise.all([eastern.newPage(),pacific.newPage()]);
  for(const page of pages){await page.route('**/*',route=>route.fulfill({body:'Synthetic page'}));await page.goto(base);}
  const east=createDateOfBirthUi({page:pages[0]}),west=createDateOfBirthUi({page:pages[1]});
  await east.validateRestDate('1984-02-29');await assert.rejects(west.validateRestDate('1984-02-29'),/timezone/);
 }finally{await browser.close();}
});
