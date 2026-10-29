import {pageConnection} from './connection.mjs';
import {createHash} from 'node:crypto';
import {decodeMappedResponse} from './gwt-mapped.mjs';
import {withPageLock} from './page-lock.mjs';
import {AttachmentConflictError} from './attachment-conflict.mjs';
const id=n=>{if(!Number.isSafeInteger(n)||n<=0)throw Error('Positive integer ID required');return n;};
const hash=b=>createHash('sha256').update(b).digest('hex');
const maxBytes=10_000_000;

/** Browser-authenticated attachment access where the REST account cannot upload/read files.
 * Own this page exclusively. The store must persist before resolving and survive restarts. */
export function createClientWorkflows({page,store}) {
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
    const guard=()=>{const u=new URL(page.url());if(u.origin+u.pathname!==base+'index.html')throw Error('Configured application page required');};
  const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
  let wire;
  const openClient=async clientId=>{
    id(clientId);guard();
    if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before client workflow');
    wire=undefined;
    let pendingHeaders;
    const listener=request=>{
      if(request.url()===base+'service/MetaQueryService'&&request.postData()?.includes('|getMappedResults|')){
        const policy=request.postData().split('|')[4];pendingHeaders=request.allHeaders().then(h=>{wire={policy,headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,h[k]]))};});
      }
    };
    page.on('request',listener);
    try{
      if(new URL(page.url()).hash!==`#loadClient;clientId=${clientId}`)await page.goto(base+`index.html#loadClient;clientId=${clientId}`);
      await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();await page.getByRole('tab',{name:'Client Profile',exact:true}).click();await ready();await pendingHeaders;
      if(!wire||!new RegExp(`Client - \\(${clientId}\\)`).test(await page.locator('body').innerText())||await page.locator('[id="formfield-password"]:visible').count())throw Error('Client identity unavailable');
    }finally{page.off('request',listener);}
  };
  const mapped=async query=>{
    guard();if(!wire||!/^SELECT /.test(query)||/[|\\\r\n]/.test(query))throw Error('Invalid mapped read');
    const strings=[base,wire.policy,'com.bowmansystems.sp5.core.client.services.GenericService','getMappedResults','java.lang.String/2004016611','java.util.HashMap/1797211028','I','Z',query+' LIMIT 1001,0'];
    const body=['7','0',strings.length,...strings,1,2,3,4,5,5,6,7,7,8,9,0,0,1001,1,''].join('|');
    const r=await page.evaluate(async({url,headers,body})=>{const r=await fetch(url,{method:'POST',headers,body,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};},{url:base+'service/MetaQueryService',headers:wire.headers,body});
    if(r.status!==200)throw Error('GWT read failed');const result=decodeMappedResponse(r.body);if(result.total!==result.rows.length||result.total>1000)throw Error('Incomplete client list');return result.rows;
  };
  const list=clientId=>mapped(`SELECT l.fileAttachmentId AS attachmentId, l.entityKeyId AS entityId, l.entityType.entityType AS entityType, l.entityType.entityName AS entityName, l.fileAttachment.fileName AS name, l.fileAttachment.extension AS extension, l.fileAttachment.description AS description FROM SpFileAttachmentLink AS l WHERE l.active = TRUE AND l.fileAttachment.active = TRUE AND l.clientId = ${id(clientId)}`);
  const download=async attachmentId=>{
    guard();const result=await page.evaluate(async({url,limit})=>{
      const r=await fetch(url,{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});
      if(!r.ok||!r.body||Number(r.headers.get('content-length'))>limit)throw Error('Attachment download failed');
      const reader=r.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Attachment too large');chunks.push(value);}}finally{await reader.cancel();}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);
    },{url:base+`downloadAttachment?attachmentId=${id(attachmentId)}`,limit:maxBytes});
    return Buffer.from(result,'base64');
  };
  const listAttachments=clientId=>withPageLock(page,async()=>{await openClient(clientId);return list(clientId);});
  const downloadAttachment=({clientId,attachmentId})=>withPageLock(page,async()=>{
    await openClient(clientId);if(!(await list(clientId)).some(a=>a.attachmentId===id(attachmentId)))throw Error('Attachment not linked to this client');return download(attachmentId);
  });
  const uploadAttachment=({clientId,location,file,description=''})=>withPageLock(page,async()=>{
    id(clientId);if(!file||typeof file.name!=='string'||!file.name||/[\\/\r\n\0]/.test(file.name)||!(file.buffer instanceof Uint8Array)||!file.buffer.length||file.buffer.length>maxBytes||typeof description!=='string')throw Error('Invalid attachment or size exceeds 10,000,000 bytes');
    const bytes=Buffer.from(file.buffer),checksum=hash(bytes),entityType={profile:'SpClient','case-plans':'CasePlans',goal:'SpGoal'}[location?.kind];
    if(!entityType)throw Error('Unsupported attachment location');const entityId=location.kind==='goal'?id(location.goalId):null;
    const intent={clientId,entityType,entityId,name:file.name,description,checksum};
    const scope=JSON.stringify([base,'attachment',clientId,entityType,entityId,file.name]);
    return store.withLock(scope,async()=>{
      await openClient(clientId);
      if(entityId&&!(await mapped(`SELECT g.goalId AS goalId FROM SpGoal AS g WHERE g.active = TRUE AND g.goalId = ${entityId} AND g.clientId = ${clientId}`)).length)throw Error('Goal does not belong to client');
      const records=await store.read(scope);if(!Array.isArray(records)||records.length>1)throw Error('Invalid upload journal');const previous=records[0];
      if(previous&&JSON.stringify(previous.intent)!==JSON.stringify(intent))throw new AttachmentConflictError('intent-changed','Attachment intent conflicts with prior attempt');
      const matching=async()=>{
        const matches=(await list(clientId)).filter(a=>a.entityType===entityType&&(a.entityId??null)===entityId&&a.name===file.name);
        if(matches.length>1)throw new AttachmentConflictError('duplicate-name','Duplicate attachment names');
        if(previous?.attachmentId&&matches[0]?.attachmentId!==previous.attachmentId)throw new AttachmentConflictError('identity-changed','Saved attachment identity changed or missing prior attachment; reconcile before retrying');
        if(matches.length&&(matches[0].description!==description||hash(await download(matches[0].attachmentId))!==checksum))throw new AttachmentConflictError('content-changed','Existing attachment differs');return matches[0];
      };
      let found=await matching();if(found){await store.write(scope,[{intent,state:'verified',attachmentId:found.attachmentId}]);return {outcome:previous?'reconciled':'already-present',attachment:found,checksum};}
      if(previous)throw new AttachmentConflictError('unresolved','Unresolved or missing prior attachment; refusing another upload');
      await store.write(scope,[{intent,state:'attempted'}]);
      let response;
      try{response=await page.evaluate(async({url,clientId,entityType,entityId,name,mimeType,description,data})=>{
        const form=new FormData();const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));form.set('uploadFormElement',new Blob([bytes],{type:mimeType}),name);form.set('descriptionFormElement',description);form.set('clientId',String(clientId));form.set('entityType',entityType);if(entityId!==null)form.set('entityKey',String(entityId));
        const r=await fetch(url,{method:'POST',body:form,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};
      },{url:base+'/uploadAttachment',clientId,entityType,entityId,name:file.name,mimeType:file.mimeType??'application/octet-stream',description,data:bytes.toString('base64')});}catch{/* Never replay an uncertain upload. */}
      found=await matching();if(!found)throw Error('Attachment outcome uncertain; journal blocks repeat upload');
      await store.write(scope,[{intent,state:'verified',attachmentId:found.attachmentId}]);
      return {outcome:response?.status===200&&response.body===`${found.attachmentId}:SUCCESS`?'written':'reconciled',attachment:found,checksum};
    });
  });
  const notes=(clientId,goalId)=>mapped(`SELECT n.goalCasenoteId AS noteId, n.goalId AS goalId, n.clientId AS clientId, n.noteDate AS noteDate, n.note AS note, n.providerId AS providerId FROM SpGoalCasenote AS n WHERE n.active = TRUE AND n.clientId = ${id(clientId)} AND n.goalId = ${id(goalId)}`);
  const listCaseNotes=({clientId,goalId})=>withPageLock(page,async()=>{await openClient(clientId);return notes(clientId,goalId);});
  const createCaseNote=async({key,clientId,goalId,providerId,noteDate,note})=>{
    id(clientId);id(goalId);id(providerId);
    if(typeof note!=='string'||!note.trim()||note.length>100000||typeof noteDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(noteDate)||new Date(noteDate+'T12:00:00Z').toISOString().slice(0,10)!==noteDate)throw Error('Note and valid calendar date required');
    if(key!==undefined&&(typeof key!=='string'||!key.trim()||key.length>500))throw Error('Stable case note source key required');
    const intent={clientId,goalId,providerId,noteDate,checksum:hash(note)};
    const scope=JSON.stringify(key===undefined?[base,'case-note',clientId,goalId,providerId,noteDate,hash(note)]:[base,'case-note-source',hash(key)]);
    return store.withLock(scope,async()=>{
      const records=await store.read(scope);if(!Array.isArray(records)||records.length>1)throw Error('Invalid case note journal');const previous=records[0];
      if(previous&&JSON.stringify(previous.intent)!==JSON.stringify(intent))throw Object.assign(Error('Case note source key conflicts with earlier intent'),{code:'CASE_NOTE_SOURCE_CONFLICT'});
      return withPageLock(page,async()=>{
      await openClient(clientId);
      if(!(await mapped(`SELECT g.goalId AS goalId FROM SpGoal AS g WHERE g.active = TRUE AND g.goalId = ${goalId} AND g.clientId = ${clientId}`)).length)throw Error('Goal does not belong to client');
      const match=async()=>{
        const current=await notes(clientId,goalId);
        // Date-only UI controls use the browser's local calendar. Do not apply the REST mobile offset.
        const dates=await page.evaluate(values=>values.map(value=>{const d=new Date(value);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');}),current.map(n=>n.noteDate));
        const matches=current.filter((n,i)=>n.note===note&&dates[i]===noteDate&&n.providerId===providerId);
        if(matches.length>1)throw Error('Duplicate case notes require review');
        if(previous?.noteId&&matches[0]?.noteId!==previous.noteId)throw Error('Saved case note identity changed; reconcile before retrying');return matches[0];
      };
      let found=await match();if(found){await store.write(scope,[{intent,state:'verified',noteId:found.noteId}]);return {outcome:previous?'reconciled':'already-present',note:found};}
      if(previous)throw Error('Unresolved or missing prior case note; refusing another write');
      await page.getByRole('tab',{name:'Case Plans',exact:true}).click();await ready();
      await page.locator(`[id="ClientCasePlansTab.editGoal-imageLink_${goalId}"]`).click();
      const goal=page.getByRole('dialog',{name:'Goal',exact:true});await goal.waitFor();await ready();
      if(!(await goal.innerText()).includes(`Goal - (${clientId})`))throw Error('Goal client mismatch');
      await goal.getByRole('button',{name:'Add Case Note',exact:true}).click();
      const dialog=page.getByRole('dialog',{name:'Case Note',exact:true});await dialog.waitFor();await ready();
      const providerRow=await dialog.getByText('Provider',{exact:true}).locator('xpath=ancestor::tr[.//*[@role="button"]][1]').innerText();
      if(!(await dialog.innerText()).includes(`Case Note - (${clientId})`)||!providerRow.includes(`(${providerId})`))throw Error('Case note provider/client mismatch');
      const checkboxes=dialog.locator('[id^="HouseholdsCheckboxTree.householdCheckbox."] input');
      for(let i=0;i<await checkboxes.count();i++){const box=checkboxes.nth(i);const member=await box.evaluate(e=>Number(e.parentElement.id.match(/\.client-(\d+)$/)?.[1]));if(await box.isEnabled())await box.setChecked(member===clientId);if(await box.isChecked()&&member!==clientId)throw Error('Unexpected case note recipient');}
      const fields=dialog.locator('input.gwt-TextBox');if(await fields.count()!==3)throw Error('Unexpected case note date controls');
      const [year,month,day]=noteDate.split('-');for(const [i,value]of [month,day,year].entries())await fields.nth(i).fill(value);
      await dialog.locator('textarea').fill(note);
      await store.write(scope,[{intent,state:'attempted'}]);
      let acknowledged=false;
      try{await page.locator('[id="CaseNotePopup.saveCasenote"]').click();await dialog.waitFor({state:'hidden'});await ready();acknowledged=true;}catch{/* Reconcile, never press Save again. */}
      found=await match();if(!found)throw Error('Case note outcome uncertain; journal blocks repeat');
      await store.write(scope,[{intent,state:'verified',noteId:found.noteId}]);
      if(await dialog.isVisible())await page.locator('[id="CaseNotePopup.cancel"]').click();
      await goal.getByRole('button',{name:'Exit',exact:true}).click();await ready();return {outcome:acknowledged?'written':'reconciled',note:found};
      });
    });
  };
  return {connection,listAttachments,downloadAttachment,uploadAttachment,listCaseNotes,createCaseNote};
}
