import {pageConnection} from './connection.mjs';
import {withPageLock} from './page-lock.mjs';

const nameLabels={firstName:'Client First Name',middleName:'Client Middle Name',lastName:'Client Last Name',suffix:'Client Suffix'};
const rowLabels={search_alias:'Alias',socSecNo:'Social Security',nameDataQuality:'Name Data Quality',ssnDataQuality:'SSN Data Quality',veteranStatus:'U.S. Military Veteran?',sex:'Sex'};
const id=n=>{if(!Number.isSafeInteger(n)||n<=0)throw Error('Positive client ID required');};

/** Fresh Client Record forms; Sex is saved by the UI's current GWT serializer. */
export function createClientProfileUi({page}) {
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
 const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
 const dialog=()=>page.getByRole('dialog',{name:'Client Record',exact:true});
 const row=label=>dialog().getByText(label,{exact:true}).locator('xpath=ancestor::tr[.//input or .//select][1]');
 const cancel=async()=>{if(await dialog().isVisible()){await dialog().getByRole('button',{name:'Cancel',exact:true}).click();await dialog().waitFor({state:'hidden'});}};
 const open=async clientId=>{
  id(clientId);if(new URL(page.url()).origin+new URL(page.url()).pathname!==base+'index.html')throw Error('Configured application page required');await ready();
  if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before profile workflow');
  // Leaving the client discards the cached model without reloading the authenticated app.
  if(/Client - \(\d+\)/.test(await page.locator('body').innerText())){
   await page.getByRole('tab',{name:'Client Information',exact:true}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();
   await page.getByRole('button',{name:'Exit',exact:true}).click();await page.waitForURL(u=>u.hash==='#clientPointClientMain');await ready();
  }
  await page.goto(base+'index.html#loadClient;clientId='+clientId);
  await page.waitForFunction(clientId=>document.body.innerText.includes(`Client - (${clientId})`)&&!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),clientId,{timeout:30000});
  await page.getByRole('tab',{name:'Client Profile',exact:true}).click();await ready();
  await page.getByTitle('Edit Client Record',{exact:true}).click();await dialog().waitFor();await ready();
  await page.waitForFunction(()=>[...document.querySelectorAll('[role="dialog"] select')].length===4&&[...document.querySelectorAll('[role="dialog"] select')].every(e=>e.options.length>1),null,{timeout:30000});
 };
 const read=async()=>{
  const values={},choices={};
  for(const [key,label] of Object.entries(nameLabels))values[key]=await dialog().getByLabel(label,{exact:true}).inputValue();
  for(const [key,label] of Object.entries(rowLabels)){
   const field=row(label).locator(key==='search_alias'||key==='socSecNo'?'input':'select');
   if(key==='socSecNo'){
    const parts=await field.evaluateAll(es=>es.map(e=>({value:e.value,maxLength:e.maxLength})));
    if(JSON.stringify(parts.map(p=>p.maxLength))!=='[3,2,4]')throw Error('SSN widget changed');values[key]=parts.map(p=>p.value).join('');
   }else{
    if(await field.count()!==1)throw Error('Profile field is ambiguous');const value=await field.inputValue();values[key]=value==='-Select-'?'':value;
    if(key!=='search_alias')choices[key]=(await field.locator('option').allTextContents()).filter(v=>v!=='-Select-');
   }
  }
  return {values,choices};
 };
 const inspect=clientId=>withPageLock(page,async()=>{await open(clientId);try{return await read();}finally{await cancel();}});
 const updateSex=({clientId,sex,expected,beforeSave})=>withPageLock(page,async()=>{
  await open(clientId);let attempted=false,verified=false;
  try{
   const current=await read();
   if(!current.choices.sex.includes(sex))throw Error('Sex option unavailable');
   for(const [key,value] of Object.entries(expected))if(key!=='sex'&&current.values[key]!==value)throw Error('Client Record changed before Sex save');
   if(current.values.sex===sex)return current;
   await row('Sex').locator('select').selectOption({label:sex});
   await beforeSave();attempted=true;
   await dialog().getByRole('button',{name:'Save',exact:true}).click();await dialog().waitFor({state:'hidden'});await ready();
   await open(clientId);const result=await read();if(result.values.sex!==sex)throw Error('Sex did not persist');verified=true;return result;
  }finally{if(!attempted||verified)await cancel();}
 });
 return {connection,inspect,updateSex};
}
