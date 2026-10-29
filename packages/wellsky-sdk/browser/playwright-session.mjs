import {createHash,randomUUID} from 'node:crypto';
import {GwtEnrollmentHelpers} from '../dist/esm/index.js';
import {decodeMappedResponse} from './gwt-mapped.mjs';

import {withPageLock} from './page-lock.mjs';
import {sessionGeneration} from './session-authentication.mjs';
import {resolveUiConnection} from './connection.mjs';
const rpcInterface='com.bowmansystems.sp5.core.client.services.GenericService';
const id=n=>{if(!Number.isSafeInteger(n)||n<=0)throw Error('Positive integer ID required');return n;};
const literal=value=>{if(Number.isSafeInteger(value))return String(value);if(typeof value==='string'&&/^[a-zA-Z0-9_-]+$/.test(value))return `'${value}'`;throw Error('Unsupported group identifier');};
const digest=value=>createHash('sha256').update(value).digest('hex');
const control=(page,value)=>page.locator(`[id="${value}"]:visible`);

/** Own the supplied page exclusively. Keep the browser context alive; managed sessions reauthenticate only between operations.
 * UI selectors and wire signatures are experimental and fail closed when the application changes. */
export function createPlaywrightEnrollmentHelpers({page,store,tenant,moduleBaseUrl}) {
  const session=createPlaywrightGwtSession({page,tenant,moduleBaseUrl});
  // The durable store serializes enrollment writers across processes. This lock additionally
  // serializes the ENTIRE operation across all helper instances sharing one browser page.
  const lockedStore={read:scope=>store.read(scope),write:(scope,records)=>store.write(scope,records),withLock:(scope,work)=>withPageLock(page,()=>store.withLock(scope,work))};
  return new GwtEnrollmentHelpers({tenant,moduleBaseUrl,session,store:lockedStore,maxPayloadAgeMs:60000});
}

/** Low-level adapter. Prefer the factory above, which also locks the page. */
export function createPlaywrightGwtSession({page,tenant,moduleBaseUrl}) {
  const base=new URL(moduleBaseUrl);
  if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!/^\w[\w-]*$/.test(tenant)||base.pathname!==`/${tenant}/com.bowmansystems.sp5.core.ServicePoint/`)throw Error('Invalid GWT module URL');
  page.setDefaultTimeout(30000);
  const endpoint=moduleBaseUrl+'service/ClientService';
  let sessionId=randomUUID(),generation=sessionGeneration(page),wire,pending;
  const checkGeneration=()=>{
    const current=sessionGeneration(page);
    if(current!==generation){generation=current;sessionId=randomUUID();wire=undefined;pending=undefined;}
  };
  const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
  const guard=async()=>{
    checkGeneration();
    const u=new URL(page.url());if(u.origin!==base.origin||u.pathname!==base.pathname+'index.html'||await control(page,'formfield-password').count())throw Error('Authenticated page unavailable');
  };
  const closeDialogs=async()=>{
    for(let i=0;i<12;i++){
      let closed=false;
      for(const name of ['AddAdditionalHouseholdMembersPopup.cancelBtn','ModifyReviewPopup.cancel-button','EntryDataPopup.cancel-button','ExitDataPopup.cancel-button','EntryExitReviewClientCountPopup.btnExit','EntryExitClientCountPopup.btnExit','EntryExitAssessment.btnExit-button','EntryExitReviewListPopup.btnExit']){
        const c=control(page,name);if(await c.count()){await c.last().click();await ready();closed=true;break;}
      }
      if(!closed)return;
    }
    throw Error('Could not close enrollment dialogs');
  };
  const openTarget=async(target)=>{
    id(target.clientId);id(target.enrollmentId);await guard();await closeDialogs();
    const clientHeading=page.getByText(new RegExp(`^Client - \\(${target.clientId}\\)`));
    if(!await clientHeading.isVisible()){
      const switcher=page.locator('select:visible').filter({has:page.locator(`option[value="${target.clientId}"]`)});
      if(await switcher.count()===1&&await control(page,'ClientMainView.householdSubmitButton').isVisible()){
        await switcher.selectOption(String(target.clientId));await control(page,'ClientMainView.householdSubmitButton').click();
      }else{
        // A hash alone is not proof that GWT switched the displayed client.
        if(new URL(page.url()).hash===`#loadClient;clientId=${target.clientId}`)throw Error('Client navigation did not load the requested client');
        await page.goto(moduleBaseUrl+`index.html#loadClient;clientId=${target.clientId}`);
      }
      await clientHeading.waitFor();await ready();
    }
    await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();
    await page.getByRole('tab',{name:'Entry / Exit',exact:true}).click();await ready();
    const edit=control(page,`ClientEntryExitTab.editEntry-imageLink_${target.enrollmentId}`);
    await edit.waitFor();
    const response=page.waitForResponse(r=>r.url()===endpoint&&r.request().postData()?.includes('|getEntryExit|')&&r.request().postData()?.endsWith(`|${target.enrollmentId}|`));
    await edit.click();const r=await response,body=await r.text();
    if(r.status()!==200||!body.startsWith('//OK['))throw Error('Entry read failed');
    const request=r.request(),tokens=request.postData().split('|'),headers=await request.allHeaders();
    wire={policy:tokens[4],headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,headers[k]]))};
    await control(page,'EntryDataPopup.cancel-button').waitFor();await ready();
    if(!(await page.locator('body').innerText()).includes(`Edit Project Start Data - (${target.clientId})`))throw Error('Entry client mismatch');
    return body;
  };
  const post=async request=>{
    await guard();
    return page.evaluate(async({url,headers,body})=>{
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
      try{const r=await fetch(url,{method:'POST',headers,body,credentials:'same-origin',redirect:'error',signal:controller.signal});return {status:r.status,body:await r.text()};}finally{clearTimeout(timer);}
    },request);
  };
  const mapped=async query=>{
    if(!wire||!/^SELECT /.test(query)||/[|\\\r\n]/.test(query))throw Error('Invalid mapped read');
    const strings=[moduleBaseUrl,wire.policy,rpcInterface,'getMappedResults','java.lang.String/2004016611','java.util.HashMap/1797211028','I','Z',query+' LIMIT 1001,0'];
    const body=['7','0',strings.length,...strings,1,2,3,4,5,5,6,7,7,8,9,0,0,1001,1,''].join('|');
    const response=await post({url:moduleBaseUrl+'service/MetaQueryService',headers:wire.headers,body});if(response.status!==200)throw Error('Mapped read failed');
    const data=decodeMappedResponse(response.body);if(data.total!==data.rows.length||data.total>1000)throw Error('Incomplete enrollment list');return data.rows;
  };
  const householdIds=async target=>{
    const link=page.getByText('Include Additional Household Members',{exact:true});
    if(await link.isVisible()){
      await link.click();await control(page,'AddAdditionalHouseholdMembersPopup.saveBtn').waitFor();await ready();
    }
    const ids=await page.locator('[id^="HouseholdsCheckboxTree.householdCheckbox."]:visible').evaluateAll(es=>es.map(e=>Number(e.id.match(/\.client-(\d+)$/)?.[1])));
    if(ids.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('Invalid household tree');
    await closeDialogs();return [...new Set([target.clientId,...ids])].sort((a,b)=>a-b);
  };
  const readEnrollment=async target=>{
    const model=await openTarget(target),householdClientIds=await householdIds(target);
    const entries=await mapped(`SELECT e.entryExitId AS enrollmentId, e.clientId AS clientId, e.entryDate AS projectStartDate, e.groupId AS groupId, e.providerId AS providerId, e.typeEntryExit.name AS enrollmentType FROM SpEntryExit AS e WHERE e.active = TRUE AND e.entryExitId = ${id(target.enrollmentId)} AND e.clientId = ${id(target.clientId)}`);
    if(entries.length!==1)throw Error('Enrollment missing');const entry=entries[0];
    if(entry.enrollmentId!==target.enrollmentId||entry.clientId!==target.clientId||!Number.isSafeInteger(entry.providerId)||entry.providerId<=0||typeof entry.enrollmentType!=='string'||!entry.enrollmentType.trim())throw Error('Enrollment context incomplete');
    const members=entry.groupId===null?[{clientId:target.clientId,enrollmentId:target.enrollmentId}]:await mapped(`SELECT e.entryExitId AS enrollmentId, e.clientId AS clientId FROM SpEntryExit AS e WHERE e.active = TRUE AND e.client.active = TRUE AND e.groupId = ${literal(entry.groupId)}`);
    members.sort((a,b)=>a.clientId-b.clientId);
    const exitRows=await mapped(`SELECT e.entryExitId AS enrollmentId, e.clientId AS clientId, e.exitDate AS projectExitDate, e.destinationValue.name AS destination, e.destinationValue.code AS destinationCode, e.reasonLeavingValue.name AS reasonForLeaving, e.reasonLeavingValue.code AS reasonForLeavingCode, e.exitSubgroupId AS exitSubgroupId FROM SpEntryExit AS e WHERE e.active = TRUE AND e.client.active = TRUE AND ${entry.groupId===null?`e.entryExitId = ${id(target.enrollmentId)}`:`e.groupId = ${literal(entry.groupId)}`}`);
    if(exitRows.length!==members.length||new Set(exitRows.map(r=>r.enrollmentId)).size!==exitRows.length||exitRows.some(r=>!members.some(m=>m.clientId===r.clientId&&m.enrollmentId===r.enrollmentId)))throw Error('Enrollment exit list incomplete');
    const exitGroups=new Map(),exits=[];
    for(const row of exitRows){
      if(row.projectExitDate!==null&&(typeof row.projectExitDate!=='string'||!Number.isFinite(Date.parse(row.projectExitDate))))throw Error('Enrollment exit date invalid');
      for(const field of ['destination','destinationCode','reasonForLeaving','reasonForLeavingCode'])if(row[field]!==null&&(typeof row[field]!=='string'||!row[field]))throw Error('Enrollment exit value invalid');
      if(row.exitSubgroupId!==null&&(typeof row.exitSubgroupId!=='string'||!row.exitSubgroupId))throw Error('Enrollment exit subgroup invalid');
      let group=[{clientId:row.clientId,enrollmentId:row.enrollmentId}];
      if(row.exitSubgroupId!==null){
        if(!exitGroups.has(row.exitSubgroupId))exitGroups.set(row.exitSubgroupId,await mapped(`SELECT e.clientId AS clientId, e.entryExitId AS enrollmentId FROM SpEntryExit AS e WHERE e.active = TRUE AND e.client.active = TRUE AND e.exitSubgroupId = ${literal(row.exitSubgroupId)}`));
        group=exitGroups.get(row.exitSubgroupId);
        if(!group.some(m=>m.clientId===row.clientId&&m.enrollmentId===row.enrollmentId)||new Set(group.map(m=>m.clientId)).size!==group.length||new Set(group.map(m=>m.enrollmentId)).size!==group.length)throw Error('Enrollment exit subgroup incomplete');
      }
      exits.push({...row,clientIds:group.map(m=>id(m.clientId)).sort((a,b)=>a-b),enrollmentIds:group.map(m=>id(m.enrollmentId)).sort((a,b)=>a-b)});
    }
    exits.sort((a,b)=>a.clientId-b.clientId);
    const rows=await mapped(`SELECT r.entryExitReviewId AS reviewId, r.subgroupId AS subgroupId, r.reviewDate AS reviewDate, r.reviewType.name AS type FROM SpEntryExitReview AS r WHERE r.active = TRUE AND r.entryExitId = ${id(target.enrollmentId)} AND r.pointInTimeType.code = 'EEPOINTINTIME_INTERIM'`);
    const reviews=[];
    for(const row of rows){
      const clients=row.subgroupId===null?[{clientId:target.clientId}]:await mapped(`SELECT r.entryExit.clientId AS clientId FROM SpEntryExitReview AS r WHERE r.active = TRUE AND r.entryExit.active = TRUE AND r.entryExit.client.active = TRUE AND r.subgroupId = ${literal(row.subgroupId)}`);
      reviews.push({reviewId:row.reviewId,type:row.type,reviewDate:row.reviewDate,clientIds:clients.map(c=>c.clientId).sort((a,b)=>a-b)});
    }
    reviews.sort((a,b)=>a.reviewId-b.reviewId);
    const data={source:'gwt-rpc',tenant,sessionId,...target,projectStartDate:entry.projectStartDate,providerId:entry.providerId,enrollmentType:entry.enrollmentType,householdClientIds,members,exits,reviews};
    return {...data,revision:digest(model+JSON.stringify({...data,sessionId:undefined}))};
  };
  const chooseMembers=async(desired,implicitClientId,dialogButton)=>{
    const surface=control(page,dialogButton).locator('xpath=ancestor::*[@role="dialog"][1]');
    if(await surface.count()!==1)throw Error('Active household dialog unavailable');
    const boxes=surface.locator('[id^="HouseholdsCheckboxTree.householdCheckbox."]:visible input');
    // Clients without a household have no checkbox tree. Their review dialog
    // binds the sole client implicitly and emits the single-client RPC.
    if(await boxes.count()===0&&implicitClientId!==undefined){
      if(desired.length!==1||desired[0]!==implicitClientId||!(await page.locator('body').innerText()).includes(`Add Interim Review - (${implicitClientId})`))throw Error('Implicit review client mismatch');
      return true;
    }
    for(let i=0;i<await boxes.count();i++){
      const box=boxes.nth(i),clientId=await box.evaluate(e=>Number(e.parentElement.id.match(/\.client-(\d+)$/)?.[1]));
      if(await box.isEnabled())await box.setChecked(desired.includes(clientId));
      if((await box.isChecked())!==desired.includes(clientId))throw Error('Unexpected included household member');
    }
    const selected=await surface.locator('[id^="HouseholdsCheckboxTree.householdCheckbox."]:visible input:checked').evaluateAll(es=>es.map(e=>Number(e.parentElement.id.match(/\.client-(\d+)$/)?.[1])).sort((a,b)=>a-b));
    if(JSON.stringify(selected)!==JSON.stringify([...desired].sort((a,b)=>a-b)))throw Error('Household selection incomplete');
    return false;
  };
  const dateFields=async label=>{
    const fields={};for(const part of ['Month','Day','Year','Hour','Minute','Second','AM/PM'])fields[part]=await page.getByLabel(`${label} ${part}`,{exact:true}).inputValue();return fields;
  };
  const prepare=async(intent,snapshot)=>{
    checkGeneration();if(snapshot.sessionId!==sessionId)throw Error('Session mismatch');pending=undefined;
    await openTarget(intent);const entryFields=await dateFields('Project Start Date');
    let save,singleClientReview=false;
    if(intent.kind==='add-household-members'){
      await page.getByText('Include Additional Household Members',{exact:true}).click();await control(page,'AddAdditionalHouseholdMembersPopup.saveBtn').waitFor();await ready();
      await chooseMembers([...new Set([...snapshot.members.map(m=>m.clientId),...intent.memberClientIds])],undefined,'AddAdditionalHouseholdMembersPopup.saveBtn');
      await control(page,'AddAdditionalHouseholdMembersPopup.saveBtn').click();
      // Continue starts a second asynchronous household-tree render. A visible Save button is insufficient.
      await page.getByRole('checkbox',{name:new RegExp(`^\\(${intent.memberClientIds[0]}\\)`)}).waitFor();await ready();
      // Existing members remain linked when unchecked here; these boxes choose
      // whose entry data is updated. Never copy the anchor date to other members.
      await chooseMembers([...new Set([intent.clientId,...intent.memberClientIds])],undefined,'EntryDataPopup.saveAndContinue-button');
      if(JSON.stringify(entryFields)!==JSON.stringify(await dateFields('Project Start Date')))throw Error('Entry date changed');
      save=control(page,'EntryDataPopup.saveAndContinue-button');
    }else{
      await closeDialogs();const row=control(page,`ClientEntryExitTab.editEntry-imageLink_${intent.enrollmentId}`).locator('xpath=ancestor::tr');
      await row.locator('[title^="Interim Reviews:"]').click();await control(page,'EntryExitReviewListPopup.addReviewButton').waitFor();await ready();await control(page,'EntryExitReviewListPopup.addReviewButton').click();await control(page,'ModifyReviewPopup.saveAndContinue-button').waitFor();await ready();
      const soleClient=snapshot.members.length===1&&snapshot.members[0].clientId===intent.clientId&&snapshot.householdClientIds.length===1&&snapshot.householdClientIds[0]===intent.clientId;
      singleClientReview=await chooseMembers(intent.clientIds,soleClient?intent.clientId:undefined,'ModifyReviewPopup.saveAndContinue-button');await page.getByLabel('Interim Review Type',{exact:true}).selectOption({label:'Update'});
      const fields=await page.evaluate(value=>{const d=new Date(value);if(d.getMilliseconds())throw Error('UI supports whole seconds only');const local=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds());if(+local!==+d)throw Error('Ambiguous local review time');return {Month:String(d.getMonth()+1).padStart(2,'0'),Day:String(d.getDate()).padStart(2,'0'),Year:String(d.getFullYear()),Hour:String(d.getHours()%12||12),Minute:String(d.getMinutes()).padStart(2,'0'),Second:String(d.getSeconds()).padStart(2,'0'),'AM/PM':d.getHours()<12?'AM':'PM'};},intent.reviewDate);
      for(const [part,value]of Object.entries(fields)){const c=page.getByLabel(`Review Date ${part}`,{exact:true});if(['Month','Day','Year'].includes(part))await c.fill(value);else await c.selectOption({label:value});}
      if(JSON.stringify(fields)!==JSON.stringify(await dateFields('Review Date')))throw Error('Review date mismatch');
      save=control(page,'ModifyReviewPopup.saveAndContinue-button');
    }
    const expected=intent.kind==='add-household-members'?'updateEntryExitWithHouseholdMembers':singleClientReview?'createEntryExitReview':'createEntryExitReviewWithHouseholdMembers';
    let resolveCapture;const captured=new Promise(resolve=>{resolveCapture=resolve;});
    const handler=async route=>{
      const r=route.request(),body=r.postData()??'';
      // Block EVERY request while pressing Save. No unexpected RPC can leak through the capture step.
      await route.abort();const tokens=body.split('|');
      if(r.url()===endpoint&&tokens[6]===expected){const h=await r.allHeaders();resolveCapture({intent:structuredClone(intent),sessionId,revision:snapshot.revision,capturedAt:Date.now(),url:endpoint,body,headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,h[k]]))});}
      else resolveCapture(null);
    };
    await page.route('**/service/**',handler);let timer;
    try{await save.click();const result=await Promise.race([captured,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),15000);})]);if(!result)throw Error('Expected mutation was not captured');pending=digest(JSON.stringify({url:result.url,headers:result.headers,body:result.body}));return result;}
    finally{clearTimeout(timer);await page.unroute('**/service/**',handler);await ready();await closeDialogs();}
  };
  return {connection:resolveUiConnection({tenant,moduleBaseUrl}),readEnrollment,prepare,async send(request){
    checkGeneration();const fingerprint=digest(JSON.stringify(request));if(!pending||fingerprint!==pending)throw Error('Only the newly prepared request can be sent once');pending=undefined;return post(request);
  }};
}
