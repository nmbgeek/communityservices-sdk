import {pageConnection} from './connection.mjs';
import {decodeMappedResponse} from './gwt-mapped.mjs';
import {withPageLock} from './page-lock.mjs';

const positiveId=value=>{if(!Number.isSafeInteger(value)||value<1)throw Error('Positive provider ID required');return value;};

/** Read-only catalog adapter. Requires Provider Admin / Assessment Admin access.
 * Use a dedicated page: navigation leaves any currently displayed editor. No Save is clicked.
 * Available/assigned assessments and default enrollment instruments are different settings. */
export function createProgramDiscovery({page}) {
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
  let wire;
  const guard=()=>{const u=new URL(page.url());if(u.origin+u.pathname!==base+'index.html')throw Error('Configured application page required');};
  const ready=async()=>{
    await page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
    guard();if(await page.locator('[id="formfield-password"]:visible').count())throw Error('Session expired');
  };
  const initialize=async()=>{
    guard();if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before catalog discovery');
    let pending;
    const listener=request=>{
      if(request.url()===base+'service/MetaQueryService'&&request.postData()?.includes('|getMappedResults|')){
        const policy=request.postData().split('|')[4];
        pending=request.allHeaders().then(h=>{wire={policy,headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,h[k]]))};});
      }
    };
    wire=undefined;page.on('request',listener);
    try{
      await page.goto(base+'index.html#adminAssessments');await ready();
      await page.getByRole('button',{name:'Search',exact:true}).click();await ready();await pending;
      if(!wire?.policy||Object.values(wire.headers).some(v=>!v))throw Error('Assessment catalog permission or session unavailable');
    }finally{page.off('request',listener);}
  };
  const mapped=async query=>{
    guard();if(!wire)throw Error('Catalog session unavailable');
    const rows=[],ids=new Set();let total;
    for(let offset=0;offset<10000;offset+=100){
      const strings=[base,wire.policy,'com.bowmansystems.sp5.core.client.services.GenericService','getMappedResults','java.lang.String/2004016611','java.util.HashMap/1797211028','I','Z',query+` LIMIT 100,${offset}`];
      const body=['7','0',strings.length,...strings,1,2,3,4,5,5,6,7,7,8,9,0,0,100,1,''].join('|');
      const r=await page.evaluate(async({url,headers,body})=>{const r=await fetch(url,{method:'POST',headers,body,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};},{url:base+'service/MetaQueryService',headers:wire.headers,body});
      if(r.status!==200)throw Error('Assessment catalog read failed');
      const result=decodeMappedResponse(r.body);
      if(total!==undefined&&total!==result.total)throw Error('Assessment catalog changed during pagination');
      total=result.total;
      if(total>10000||result.rows.length>100||result.rows.length!==Math.min(100,total-offset))throw Error('Assessment catalog exceeds 10000 rows or is incomplete');
      for(const row of result.rows){
        if(!Number.isSafeInteger(row.assessmentId)||row.assessmentId<1||ids.has(row.assessmentId)||typeof row.name!=='string'||!row.name.trim()||typeof row.code!=='string'||!row.code.trim())throw Error('Invalid or duplicate assessment catalog row');
        ids.add(row.assessmentId);rows.push(row);
      }
      if(rows.length===total)return rows;
    }
    throw Error('Assessment catalog pagination incomplete');
  };
  const listAssessments=()=>withPageLock(page,async()=>{
    await initialize();
    const assessments=await mapped("SELECT a.assessmentId AS assessmentId, a.name AS name, a.code AS code FROM DaAssessment AS a WHERE a.active = true AND a.hidden = false AND a.published = true AND a.assessmentTypeId = 1 AND a.code <> 'CLIENTDEMOGRAPHICS' AND a.code <> 'CLIENTMERGECOMPARISON' ORDER BY a.name ASC, a.assessmentId ASC");
    return {source:'admin-catalog',retrievedAt:new Date().toISOString(),assessments};
  });
  const getProviderAssessments=({providerId})=>withPageLock(page,async()=>{
    positiveId(providerId);await initialize();
    const rows=await mapped(`SELECT a.assessment.assessmentId AS assessmentId, a.assessment.name AS name, a.assessment.code AS code, a.visible AS visible FROM DaAssessmentProvider AS a WHERE a.providerId = ${providerId} AND a.assessment.hidden = false AND a.assessment.active = true AND a.assessment.published = true ORDER BY a.assessment.name ASC, a.assessment.assessmentId ASC`);
    const assessments=rows.map(({visible,...row})=>{if(typeof visible!=='boolean')throw Error('Invalid assessment visibility');return {...row,assignedToAssessmentTab:visible};});
    await page.goto(base+`index.html#loadProvider;providerId=${providerId};subview=moduleSettings`);await ready();
    await page.getByRole('tab',{name:'Display Settings',exact:true}).click();await ready();
    await page.getByRole('tab',{name:'Assessment Display Settings',exact:true}).click();await ready();
    if(!(await page.locator('body').innerText()).includes(`(${providerId}) `))throw Error('Provider identity unavailable');
    const display=await page.locator('[id^="selectAssessment-"]').evaluateAll(elements=>elements.filter(e=>e.getBoundingClientRect().width>0).map(e=>{
      const row=e.closest('tr');if(!row||row.cells.length<4)throw Error('Unexpected assessment display controls');
      return {location:e.id.slice('selectAssessment-'.length),label:row.cells[0].innerText.trim(),name:row.cells[1].innerText.trim(),allowMultiple:row.querySelector('input[type=checkbox]')?.checked??null};
    }));
    if(display.length!==38||new Set(display.map(r=>r.location)).size!==38)throw Error('Assessment display settings incomplete or changed');
    const defaults=display.map(({name,...row})=>{
      const matches=name?assessments.filter(a=>a.name===name):[];
      // A duplicate name must not resolve to an arbitrary instrument code.
      return {...row,assessmentName:name||null,resolution:!name?'unset':matches.length===1?'resolved':'unresolved',assessment:matches.length===1?matches[0]:null};
    });
    return {source:'provider-display-settings',providerId,retrievedAt:new Date().toISOString(),assessments,defaults};
  });
  return {connection,listAssessments,getProviderAssessments};
}
