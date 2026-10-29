import {pageConnection} from './connection.mjs';
import {decodeMappedResponse} from './gwt-mapped.mjs';
import {withPageLock} from './page-lock.mjs';
const id=n=>{if(!Number.isSafeInteger(n)||n<1)throw Error('Positive integer ID required');return n;};

/** Counted, ordered pages. Never interpret a failed, truncated, or changing read as absence. */
export async function collectNeedPages(read,key,limit=50000){
 const rows=[],seen=new Set();let total;
 for(let offset=0;offset<=limit;offset+=500){
  const result=await read(offset,500);
  if(!Number.isSafeInteger(result?.total)||result.total<0||result.total>limit||!Array.isArray(result.rows)||result.rows.length>500||total!==undefined&&result.total!==total)throw Error('Catalog/need count unavailable or changed');
  total=result.total;
  for(const row of result.rows){id(row[key]);if(seen.has(row[key]))throw Error('Duplicate catalog/need row');seen.add(row[key]);rows.push(row);}
  if(rows.length===total)return rows;
  if(result.rows.length!==500||rows.length>total)throw Error('Incomplete catalog/need read');
 }
 throw Error('Catalog/need safety limit exceeded');
}

/** UI adapter. Catalog reads are shared by services and independent needs. */
export function createNeedUi({page}){
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
 let wire;
 const guard=()=>{if(new URL(page.url()).origin+new URL(page.url()).pathname!==base+'index.html')throw Error('Configured application page required');};
 const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
 const byId=value=>page.locator(`[id="${value}"]`);
 const open=async clientId=>{
  id(clientId);guard();
  if(await page.locator('[role=dialog]:visible').count()||await page.locator('[id$=".saveAndExit"]:visible,[id="EditNeedView.save"]:visible').count())throw Error('Close unfinished forms before need/catalog workflow');
  wire=undefined;let pending;
  const listener=request=>{if(request.url()===base+'service/MetaQueryService'&&request.postData()?.startsWith('7|0|')){
   const policy=request.postData().split('|')[4];pending=request.allHeaders().then(h=>{wire={policy,headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,h[k]]))};});
  }};
  page.on('request',listener);
  try{
   const visibleClient=(await page.locator('body').innerText()).match(/Client - \((\d+)\)/)?.[1];
   if(visibleClient&&Number(visibleClient)!==clientId){
    await page.getByRole('tab',{name:'Client Information',exact:true}).click({timeout:30000});await page.getByRole('tab',{name:'Summary',exact:true}).click({timeout:30000});await ready();
    await page.getByRole('button',{name:'Exit',exact:true}).click({timeout:30000});await page.waitForURL(url=>url.hash==='#clientPointClientMain');await ready();
   }
   if(new URL(page.url()).hash!==`#loadClient;clientId=${clientId}`)await page.goto(base+`index.html#loadClient;clientId=${clientId}`);
   await page.waitForFunction(c=>document.body.innerText.includes(`Client - (${c})`)&&!document.body.innerText.includes('Processing...'),clientId,{timeout:30000});
   await page.getByRole('tab',{name:'Client Information',exact:true}).click({timeout:30000});await page.getByRole('tab',{name:'Summary',exact:true}).click({timeout:30000});await ready();
   await page.getByRole('tab',{name:'Service Transactions',exact:true}).click({timeout:30000});await ready();await pending;
   guard();if(!wire||await byId('formfield-password').isVisible())throw Error('Authenticated need read context unavailable');
  }finally{page.off('request',listener);}
 };
 const mapped=async(query,offset=0,size=500)=>{
  guard();if(!wire||!query.startsWith('SELECT ')||/[|\\\r\n]/.test(query))throw Error('Invalid need/catalog read');
  const strings=[base,wire.policy,'com.bowmansystems.sp5.core.client.services.GenericService','getMappedResults','java.lang.String/2004016611','java.util.HashMap/1797211028','I','Z',`${query} LIMIT ${size},${offset}`];
  const result=await page.evaluate(async w=>{const r=await fetch(w.url,{method:'POST',headers:w.headers,body:w.body,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};},{url:base+'service/MetaQueryService',headers:wire.headers,body:['7','0',9,...strings,1,2,3,4,5,5,6,7,7,8,9,0,offset,size,1,''].join('|')});
  if(result.status!==200)throw Error('Need/catalog read failed');return decodeMappedResponse(result.body,offset);
 };
 const all=(query,key)=>collectNeedPages((offset,size)=>mapped(query,offset,size),key);
 const readNeeds=async clientId=>{
  const rows=await all(`SELECT n.needId AS needId, n.clientId AS clientId, n.providerId AS providerId, n.codeId AS serviceCodeId, n.dateSet AS needDate, n.note AS note, n.amount AS amount, n.status.name AS status, n.outcome.name AS outcome, n.reasonUnmet.name AS reasonUnmet FROM SpNeed AS n WHERE n.active = true AND n.clientId = ${id(clientId)} ORDER BY n.needId`,'needId');
  const services=await all(`SELECT s.needServiceId AS serviceId, s.needId AS needId FROM SpNeedService AS s WHERE s.active = true AND s.clientId = ${id(clientId)} ORDER BY s.needServiceId`,'serviceId');
  return rows.map(n=>({...n,note:n.note??'',serviceCount:services.filter(s=>s.needId===n.needId).length}));
 };
 const providerRow=()=>page.getByText('Provider',{exact:true}).locator('xpath=ancestor::tr[.//*[@role="button"]][1]');
 const addForm=async({clientId,providerId})=>{
  if(providerId!==undefined)id(providerId);await open(clientId);await page.getByRole('button',{name:'Add Need',exact:true}).click({timeout:30000});await byId('ClientAddNeedView.saveAndExit').waitFor({timeout:30000});await ready();
  if(providerId!==undefined&&!(await providerRow().innerText()).includes(`(${providerId})`)){
   await providerRow().getByRole('button',{name:'Search',exact:true}).click({timeout:30000});
   const dialog=page.getByRole('dialog');await dialog.getByText(/Showing \d+-\d+ of \d+/).waitFor({timeout:30000});await ready();
   await dialog.getByLabel('Provider ID #',{exact:true}).fill(String(providerId),{timeout:30000});await dialog.getByLabel('Provider ID #',{exact:true}).press('Tab',{timeout:30000});
   await dialog.getByRole('button',{name:'Submit',exact:true}).click({timeout:30000});await ready();
   await byId(`SpProviderSearchPopup.setProvider-imageLink_${providerId}`).click({timeout:30000});await dialog.waitFor({state:'hidden',timeout:30000});await ready();
  }
  if(providerId!==undefined&&!(await providerRow().innerText()).includes(`(${providerId})`))throw Error('Need provider mismatch');
 };
 const needSelect=()=>page.locator('select:visible').filter({has:page.locator('option[value="-Select-"]')}).filter({hasNot:page.locator('option[value="Closed"],option[value="Fully Met"],option[value="All Services Full"]')});
 const options=async label=>page.locator(`select[aria-label="${label}"]`).locator('option').evaluateAll(es=>es.filter(e=>e.value!=='-Select-').map(e=>({value:e.value,label:e.textContent})));
 const lookup=async()=>{await byId('ClientAddNeedView.lookUp').click({timeout:30000});await byId('SpServiceCodeSearch.codeSets-listbox').waitFor({timeout:30000});await ready();};
 const cancelLookup=async()=>{await byId('SpServiceCodeSearch.btnExit-button').click({timeout:30000});await byId('SpServiceCodeSearch.btnExit-button').waitFor({state:'hidden',timeout:30000});await ready();};
 const cancel=async()=>{await byId('ClientAddNeedView.cancel').click({timeout:30000});await byId('ClientAddNeedView.cancel').waitFor({state:'hidden',timeout:30000});await ready();};
 const readTypes=async filter=>{
  const types=await all(`SELECT c.serviceCodeId AS serviceCodeId, c.code AS code, c.description AS description, c.serviceCodeTypeId AS codeSetId, c.parentServiceCodeId AS parentServiceCodeId FROM SpServiceCode AS c WHERE c.active = true AND c.assignable = true AND ${filter} AND NOT c.code LIKE 'Y%' AND (c.facet <> 'Modality/Delivery Format' OR c.facet IS NULL) ORDER BY c.serviceCodeId`,'serviceCodeId');
  for(const t of types){id(t.codeSetId);if(typeof t.code!=='string'||!t.code||typeof t.description!=='string')throw Error('Invalid service code catalog');}
  return types;
 };
 const catalog=async({clientId})=>{
  await addForm({clientId});await lookup();
  const codeSets=await byId('SpServiceCodeSearch.codeSets-listbox').locator('option').evaluateAll(es=>es.map(e=>({id:Number(e.value),name:e.textContent})));
  if(!codeSets.length)throw Error('No accessible service code sets');codeSets.forEach(s=>{id(s.id);if(typeof s.name!=='string'||!s.name)throw Error('Invalid code set');});
  const types=await readTypes(`c.serviceCodeTypeId IN (${codeSets.map(s=>s.id).join(',')})`);
  if(types.some(t=>!codeSets.some(s=>s.id===t.codeSetId)))throw Error('Unexpected code set in catalog');
  await cancelLookup();await cancel();return {codeSets,types};
 };
 const quicklist=async context=>{
  id(context.providerId);await addForm(context);
  const quickIds=await needSelect().locator('option').evaluateAll(es=>es.filter(e=>e.value!=='-Select-').map(e=>Number(e.value)));quickIds.forEach(id);
  if(new Set(quickIds).size!==quickIds.length)throw Error('Duplicate provider quicklist entries');
  const needOptions={statuses:await options('Need Status'),outcomes:await options('Outcome of Need'),unmetReasons:await options('If Need is Not Met, Reason')};
  const types=quickIds.length?await readTypes(`c.serviceCodeId IN (${quickIds.join(',')})`):[];
  if(types.length!==quickIds.length||quickIds.some(i=>!types.some(t=>t.serviceCodeId===i)))throw Error('Provider quicklist differs from active assignable types');
  await cancel();return {providerId:context.providerId,types:quickIds.map(i=>types.find(t=>t.serviceCodeId===i)),needOptions};
 };
 const chooseCode=async serviceCodeId=>{
  id(serviceCodeId);
  // Cached choices must still be active/assignable at the time of the write.
  const found=await mapped(`SELECT c.serviceCodeId AS serviceCodeId, c.code AS code, c.serviceCodeTypeId AS codeSetId FROM SpServiceCode AS c WHERE c.active = true AND c.assignable = true AND c.serviceCodeId = ${serviceCodeId}`);
  if(found.total!==1||found.rows.length!==1||found.rows[0].serviceCodeId!==serviceCodeId)throw Error('Selected service type is no longer active/assignable');
  if(await needSelect().locator(`option[value="${serviceCodeId}"]`).count()){await needSelect().selectOption(String(serviceCodeId),{timeout:30000});return;}
  await lookup();
  const sets=await byId('SpServiceCodeSearch.codeSets-listbox').locator('option').evaluateAll(es=>es.map(e=>Number(e.value)));
  if(!sets.includes(found.rows[0].codeSetId))throw Error('Selected service type is not accessible');
  const code=found.rows[0];await byId('SpServiceCodeSearch.codeSets-listbox').selectOption(String(code.codeSetId),{timeout:30000});
  await byId('SpServiceCodeSearch.searchTerm-listbox').selectOption('Code',{timeout:30000});await byId('SpServiceCodeSearch.searchText-textbox').fill(code.code,{timeout:30000});
  await byId('SpServiceCodeSearch.searchBtn-button').click({timeout:30000});await ready();
  await byId(`SpServiceCodeSearch.selectLink-code-${serviceCodeId}`).click({timeout:30000});await byId('SpServiceCodeSearch.btnSubmit-button').click({timeout:30000});await byId('SpServiceCodeSearch.btnSubmit-button').waitFor({state:'hidden',timeout:30000});await ready();
  if(await needSelect().inputValue()!==String(serviceCodeId))throw Error('Need code selection mismatch');
 };
 const fillDate=async instant=>{
  const parts=await page.evaluate(value=>{const d=new Date(value),copy=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds());if(copy.getTime()!==d.getTime())throw Error('Ambiguous local need time');return {Month:String(d.getMonth()+1),Day:String(d.getDate()),Year:String(d.getFullYear()),Hour:String(d.getHours()%12||12),Minute:String(d.getMinutes()).padStart(2,'0'),Second:String(d.getSeconds()).padStart(2,'0'),'AM/PM':d.getHours()<12?'AM':'PM'};},instant);
  for(const [part,value]of Object.entries(parts)){const field=page.getByLabel('Date of Need '+part,{exact:true});if(['Month','Day','Year'].includes(part)){await field.fill(value,{timeout:30000});await field.press('Tab',{timeout:30000});}else await field.selectOption(value,{timeout:30000});}
 };
 return {connection,
  list:({clientId})=>withPageLock(page,async()=>{await open(clientId);return readNeeds(clientId);}),
  listServiceTypes:context=>withPageLock(page,()=>catalog(context)),
  listServiceQuicklist:context=>withPageLock(page,()=>quicklist(context)),
  create:(values,beforeSave)=>withPageLock(page,async()=>{
   if(typeof beforeSave!=='function')throw Error('Durable beforeSave hook required');
   await addForm(values);await chooseCode(values.serviceCodeId);
   // A single independent need, never implicitly include household checkboxes.
   const checked=page.locator('input[type=checkbox]:visible:checked');
   if(await checked.count())throw Error('Unexpected checked household members; refusing a group need');
   await fillDate(values.needDate);await page.locator('select[aria-label="Need Status"]').selectOption({label:values.status},{timeout:30000});
   await page.locator('select[aria-label="Outcome of Need"]').selectOption({label:values.outcome},{timeout:30000});
   if(values.reasonUnmet)await page.locator('select[aria-label="If Need is Not Met, Reason"]').selectOption({label:values.reasonUnmet},{timeout:30000});
   await page.locator('input[aria-label="Amount if Financial"]').fill(values.amount===null?'':String(values.amount),{timeout:30000});
   await page.locator('textarea[aria-label="Notes"]').fill(values.note,{timeout:30000});
   if(!(await providerRow().innerText()).includes(`(${values.providerId})`)||await needSelect().inputValue()!==String(values.serviceCodeId))throw Error('Need context changed before save');
   await beforeSave();await byId('ClientAddNeedView.saveAndExit').click({timeout:30000});
   await byId('ClientAddNeedView.saveAndExit').waitFor({state:'hidden',timeout:30000});await ready();
  }),
 };
}
