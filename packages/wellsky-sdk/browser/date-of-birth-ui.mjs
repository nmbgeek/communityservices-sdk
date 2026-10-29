import {pageConnection} from './connection.mjs';
import {withPageLock} from './page-lock.mjs';
import {validateBirthDate} from './date-of-birth.mjs';

/** UI verification plus correction of DOB at an existing enrollment's entry date. */
export function createDateOfBirthUi({page}){
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
 const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
 const control=id=>page.locator(`[id="${id}"]:visible`);
 const navigate=async clientId=>{
  if(!Number.isSafeInteger(clientId)||clientId<1||new URL(page.url()).origin+new URL(page.url()).pathname!==base+'index.html')throw Error('Client and configured application page required');
  await ready();if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before DOB operation');
  if(/Client - \(\d+\)/.test(await page.locator('body').innerText())){
   await page.getByRole('tab',{name:'Client Information',exact:true}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();
   await page.getByRole('button',{name:'Exit',exact:true}).click();await page.waitForURL(u=>u.hash==='#clientPointClientMain');await ready();
  }
  await page.goto(base+'index.html#loadClient;clientId='+clientId);
  await page.waitForFunction(clientId=>document.body.innerText.includes(`Client - (${clientId})`)&&!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),clientId,{timeout:30000});
  await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();
 };
 const validateRestDate=async dateOfBirth=>{
  validateBirthDate(dateOfBirth);
  const rendered=await page.evaluate(value=>{const d=new Date(value+'T07:00:00Z');return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');},dateOfBirth);
  if(rendered!==dateOfBirth)throw Error('Browser timezone cannot display the REST DOB encoding on the intended date');
 };
 const read=clientId=>withPageLock(page,async()=>{
  await navigate(clientId);
  const text=await page.getByText('Date of Birth',{exact:true}).evaluate(e=>e.closest('td').nextElementSibling.innerText.trim());
  if(!text)return null;
  const m=/^(\d{2})\/(\d{2})\/(\d{4})(?: \(Age \d+\))?$/.exec(text);
  if(!m)throw Error('Unexpected Summary DOB format');return validateBirthDate(`${m[3]}-${m[1]}-${m[2]}`);
 });
 const correctAtEntry=input=>withPageLock(page,async()=>{
  const {clientId,entry,dateOfBirth,effectiveDate,expectedDateOfBirth,beforeSave}=input;
  validateBirthDate(dateOfBirth);
  if(!entry||!Number.isSafeInteger(entry.enrollmentId)||entry.enrollmentId<1||typeof entry.assessmentName!=='string'||!entry.assessmentName.trim()||typeof beforeSave!=='function')throw Error('DOB entry context and journal callback required');
  await navigate(clientId);await page.getByRole('tab',{name:'Entry / Exit',exact:true}).click();await ready();
  await control(`ClientEntryExitTab.editEntry-imageLink_${entry.enrollmentId}`).click();
  await control('EntryDataPopup.cancel-button').waitFor();await ready();
  const heading=await page.locator('[role=dialog]:visible').innerText();
  if(!heading.includes(`Edit Project Start Data - (${clientId})`))throw Error('Entry client mismatch');
  const parts={};for(const part of ['Month','Day','Year','Hour','Minute','Second','AM/PM'])parts[part]=await page.getByLabel('Project Start Date '+part,{exact:true}).inputValue();
  const sameInstant=await page.evaluate(({parts,effectiveDate})=>{
   const date=new Date(effectiveDate),hour=date.getHours();
   return Number(parts.Year)===date.getFullYear()&&Number(parts.Month)===date.getMonth()+1&&Number(parts.Day)===date.getDate()&&Number(parts.Hour)===(hour%12||12)&&Number(parts.Minute)===date.getMinutes()&&Number(parts.Second)===date.getSeconds()&&parts['AM/PM']===(hour<12?'AM':'PM');
  },{parts,effectiveDate});
  if(!sameInstant){await control('EntryDataPopup.cancel-button').click();throw Error('DOB correction requires the exact existing entry effective date');}
  await control('EntryDataPopup.saveAndContinue-button').click();await control('EntryDataPopup.cancel-button').waitFor({state:'hidden'});await ready();
  const dialog=page.getByRole('dialog',{name:'Entry/Exit Data',exact:true});
  await dialog.getByRole('button',{name:entry.assessmentName,exact:true}).click();
  const month=page.getByLabel('Date of Birth Month',{exact:true}),day=page.getByLabel('Date of Birth Day',{exact:true}),year=page.getByLabel('Date of Birth Year',{exact:true});
  await month.waitFor();await ready();
  if(!new RegExp(`check_circle\\s*\\(${clientId}\\)`).test(await dialog.innerText()))throw Error('Selected assessment client mismatch');
  const current=validateBirthDate(`${await year.inputValue()}-${(await month.inputValue()).padStart(2,'0')}-${(await day.inputValue()).padStart(2,'0')}`);
  if(current!==expectedDateOfBirth)throw Error('DOB changed before UI correction');
  const controls=()=>dialog.locator('input,select,textarea').evaluateAll(es=>es.filter(e=>e.getClientRects().length&&!/^Date of Birth (Month|Day|Year)$/.test(e.getAttribute('aria-label')||'')).map(e=>({id:e.id,label:e.getAttribute('aria-label'),value:e.value,checked:e.checked,selected:e.tagName==='SELECT'?[...e.selectedOptions].map(o=>o.value):null})));
  const before=JSON.stringify(await controls());
  // Blur each component and wait for GWT's dependent refresh before editing the next.
  for(const [field,value] of [[day,'01'],[year,dateOfBirth.slice(0,4)],[month,dateOfBirth.slice(5,7)],[day,dateOfBirth.slice(8,10)]]){await field.fill(value);await field.press('Tab');await ready();}
  const edited=`${await year.inputValue()}-${(await month.inputValue()).padStart(2,'0')}-${(await day.inputValue()).padStart(2,'0')}`;
  if(edited!==dateOfBirth)throw Error('DOB widget did not retain the requested calendar date');
  if(JSON.stringify(await controls())!==before)throw Error('Other assessment controls changed');
  await beforeSave();await dialog.getByRole('button',{name:'Save',exact:true}).click();await ready();
  if(await page.getByRole('dialog',{name:'Validation Warning',exact:true}).isVisible())throw Error('Assessment validation blocked DOB save; complete required answers before reconciling');
  await control('EntryExitAssessment.btnExit-button').click();await dialog.waitFor({state:'hidden'});await ready();
 });
 return {connection,read,correctAtEntry,validateRestDate};
}
