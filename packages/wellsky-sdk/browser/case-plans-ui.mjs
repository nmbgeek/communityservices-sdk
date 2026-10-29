import {pageConnection} from './connection.mjs';
import {withPageLock} from './page-lock.mjs';
import {decodeMappedResponse} from './gwt-mapped.mjs';
/** Fresh counted reads back the UI's initial empty notes/goals state. No writes or cached RPCs. */
export function createCasePlanUi({page}){
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
 const confirmEmpty=({kind,clientId})=>withPageLock(page,async()=>{
  if(!['note','goal'].includes(kind)||!Number.isSafeInteger(clientId)||clientId<1||new URL(page.url()).origin+new URL(page.url()).pathname!==base+'index.html')throw Error('Client and record kind required');
  if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before case-plan workflow');
  const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
  if(/Client - \(\d+\)/.test(await page.locator('body').innerText())){await page.getByRole('tab',{name:'Client Information',exact:true}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();await page.getByRole('button',{name:'Exit',exact:true}).click();await page.waitForURL(u=>u.hash==='#clientPointClientMain');}
  let wire,pending;const listener=r=>{const b=r.postData()??'';if(r.url()===base+'service/MetaQueryService'&&b.includes('|getMappedResults|'))pending=r.allHeaders().then(h=>{wire={policy:b.split('|')[4],headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,h[k]]))};});};page.on('request',listener);
  try{
   await page.goto(base+'index.html#loadClient;clientId='+clientId);await page.waitForFunction(id=>document.body.innerText.includes(`Client - (${id})`)&&!document.body.innerText.includes('Processing...'),clientId);
   await page.getByRole('tab',{name:kind==='note'?'Client Profile':'Case Plans',exact:true}).click();await ready();await pending;if(!wire)throw Error('Fresh UI read context unavailable');
  }finally{page.off('request',listener);}
  const query=kind==='note'?`SELECT n.clientNoteId AS id FROM SpClientNote AS n WHERE n.active = true AND n.clientId = ${clientId}`:`SELECT g.goalId AS id FROM SpGoal AS g WHERE g.active = true AND g.clientId = ${clientId}`;
  const strings=[base,wire.policy,'com.bowmansystems.sp5.core.client.services.GenericService','getMappedResults','java.lang.String/2004016611','java.util.HashMap/1797211028','I','Z',query+' LIMIT 1,0'];
  const body=['7','0',strings.length,...strings,1,2,3,4,5,5,6,7,7,8,9,0,0,1,1,''].join('|');
  const r=await page.evaluate(async({url,headers,body})=>{const r=await fetch(url,{method:'POST',headers,body,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};},{url:base+'service/MetaQueryService',headers:wire.headers,body});
  if(r.status!==200)throw Error('UI record read failed');const result=decodeMappedResponse(r.body);return result.total===0&&result.rows.length===0;
 });return {connection,confirmEmpty};
}
