import {pageConnection} from './connection.mjs';
import {decodeMappedResponse} from './gwt-mapped.mjs';
import {withPageLock} from './page-lock.mjs';
import {readSsvfInformation} from './ssvf-rules.mjs';
const id=n=>{if(!Number.isSafeInteger(n)||n<=0)throw Error('Positive integer ID required');return n;};

/** Fresh UI forms generate their own GWT payloads. No captured write payload is replayed. */
export function createServiceUi({page}) {
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
  const guard=()=>{if(new URL(page.url()).origin+new URL(page.url()).pathname!==base+'index.html')throw Error('Configured application page required');};
  const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
  const assertReady=async()=>{guard();await ready();if(await page.locator('[role=dialog]:visible').count()||await page.locator('[id="formfield-password"]:visible').count())throw Error('Authenticated application page with no open dialogs required');};
  let readWire,groupId;
  const exit=async()=>{if(await page.locator('[id="ServiceView.exit"]').isVisible()){await page.locator('[id="ServiceView.exit"]').click();await page.locator('[id="ServiceView.exit"]').waitFor({state:'hidden'});await ready();}};
  const open=async context=>{
    id(context.clientId);id(context.serviceId);id(context.providerId);guard();
    if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before service workflow');
    readWire=undefined;groupId=undefined;
    await exit();
    const visibleClient=(await page.locator('body').innerText()).match(/Client - \((\d+)\)/)?.[1];
    if(visibleClient&&Number(visibleClient)!==context.clientId){
      await page.getByRole('tab',{name:'Client Information',exact:true}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();
      await page.getByRole('button',{name:'Exit',exact:true}).click();
      await page.waitForURL(url=>url.hash==='#clientPointClientMain');await ready();
    }
    if(new URL(page.url()).hash!==`#loadClient;clientId=${context.clientId}`)await page.goto(base+`index.html#loadClient;clientId=${context.clientId}`);
    await page.waitForFunction(clientId=>document.body.innerText.includes(`Client - (${clientId})`)&&!document.body.innerText.includes('Processing...'),context.clientId,{timeout:30000});
    await page.getByRole('tab',{name:'Client Information',exact:true}).click();
    await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();
    if(!(await page.locator('body').innerText()).includes(`Client - (${context.clientId})`))throw Error('Wrong client page');
    let target=page.locator(`[id="ClientSummaryTab.editService-imageLink_${context.serviceId}"]`);
    if(!await target.count()){
      await page.getByRole('tab',{name:'Service Transactions',exact:true}).click();await ready();
      const previous=page.getByRole('button',{name:'View Previous Service Transactions',exact:true});if(await previous.isVisible())await previous.click();
      await page.getByRole('tab',{name:'Services',exact:true}).click();await ready();
      const dates=page.locator('select').filter({has:page.locator('option',{hasText:/^All Dates$/})});
      await dates.selectOption({label:'All Dates'});await page.getByRole('button',{name:'Search',exact:true}).click();await ready();
      target=page.locator(`[id="ServicesPanel.editService-imageLink_${context.serviceId}"]`);
      for(let i=0;!await target.count()&&i<100;i++){
        const next=page.getByRole('button',{name:'Next',exact:true});if(!await next.isVisible()||await next.getAttribute('aria-disabled')==='true')break;
        const response=page.waitForResponse(r=>r.request().postData()?.includes('|getMappedResults|')&&r.request().postData()?.includes('SpNeedService'));
        void response.catch(()=>{});
        await next.click();await response;await ready();
      }
    }
    const funding=page.waitForResponse(r=>r.url()===base+'service/FundManagerService'&&r.request().postData()?.includes('|getFundingSources|'));
    const mapped=page.waitForResponse(r=>r.url()===base+'service/MetaQueryService'&&r.request().postData()?.includes('|getMappedResults|'));
    const loaded=page.waitForResponse(r=>r.url()===base+'service/ServiceTransactionService'&&r.request().postData()?.includes('|getService|')&&r.request().postData()?.endsWith(`|${context.serviceId}|`));
    // A failed click must not leave later timeout rejections unhandled.
    const pending=Promise.all([funding,mapped,loaded]);void pending.catch(()=>{});
    await target.click();const response=await loaded;if(response.status()!==200||!(await response.text()).startsWith('//OK'))throw Error('Service load failed');
    await page.locator('[id="ServiceView.saveAndExit"]').waitFor();await ready();
    await page.waitForFunction(({provider,note})=>document.body.innerText.includes(`(${provider})`)&&document.querySelector('[aria-label="Service Notes"]')&&(note===undefined||document.querySelector('[aria-label="Service Notes"]').value===note),{provider:context.providerId,note:context.serviceNote});
    const [fundResponse,mapResponse]=await pending;
    if(fundResponse.status()!==200||!(await fundResponse.text()).startsWith('//OK'))throw Error('Funding state unavailable');
    groupId=id(Number(fundResponse.request().postData().split('|').at(-2)));
    const request=mapResponse.request(),headers=await request.allHeaders();
    readWire={policy:request.postData().split('|')[4],headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,headers[k]]))};
  };
  const expandFunds=async()=>{const expand=page.getByTitle('Expand Apply Funds for Service Panel',{exact:true});if(await expand.isVisible())await expand.click();await page.locator('[id^="SpFundingSourcesPanel.addFundingSource-"]').waitFor();};
  const read=async()=>{
    await ready();
    const values=await page.evaluate(()=>{
      const field=label=>document.querySelector(`[aria-label="${label}"]`)?.value??null;
      const date=prefix=>{
        const year=field(prefix+' Year'),month=field(prefix+' Month'),day=field(prefix+' Day');if(!year&&!month&&!day)return null;
        let hour=Number(field(prefix+' Hour'));if(field(prefix+' AM/PM')==='PM'&&hour!==12)hour+=12;if(field(prefix+' AM/PM')==='AM'&&hour===12)hour=0;
        return new Date(Number(year),Number(month)-1,Number(day),hour,Number(field(prefix+' Minute')),Number(field(prefix+' Second'))).toISOString();
      };
      return {needStatus:field('Need Status'),needOutcome:field('Outcome of Need'),serviceStart:date('Start Date'),serviceEnd:date('End Date'),financialAssistancePeriod:{start:date('SSVF Financial Assistance Start Date'),end:date('SSVF Financial Assistance End Date')},timezone:Intl.DateTimeFormat().resolvedOptions().timeZone};
    });
    values.ssvfInformation=await readSsvfInformation(page);
    await expandFunds();
    values.fundingSources=await page.locator('[id^="SpFundingSourcesPanel.addFundingSource-"]').evaluate(button=>{
      let panel=button.parentElement;while(panel&&!panel.innerText.includes('Client Co-Pay'))panel=panel.parentElement;
      if(!panel)throw Error('Funding panel not found');const rows=[];
      for(const link of panel.querySelectorAll('a')){
        let row=link.closest('tr');while(row&&!row.querySelector('input.sp5-textbox'))row=row.parentElement.closest('tr');
        if(!row)throw Error('Funding amount not found');const inputs=[...row.querySelectorAll('input.sp5-textbox')];
        if(inputs.length!==1)throw Error('Ambiguous funding amount');rows.push({name:link.textContent,amount:Number(inputs[0].value.replace(/,/g,''))});
      }
      return rows;
    });
    const strings=[base,readWire.policy,'com.bowmansystems.sp5.core.client.services.GenericService','getMappedResults','java.lang.String/2004016611','java.util.HashMap/1797211028','I','Z',`SELECT f.needServiceGroupFundId AS allocationId, f.fundId AS fundId, f.fundCycleId AS fundCycleId, f.fund.name AS name, f.amount AS amount FROM SpNeedServiceGroupFund AS f WHERE f.needServiceGroupId = ${id(groupId)} AND f.active = true`];
    const result=await page.evaluate(async w=>{const r=await fetch(w.url,{method:'POST',headers:w.headers,body:w.body,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};},{url:base+'service/MetaQueryService',headers:readWire.headers,body:['7','0',9,...strings,1,2,3,4,5,5,6,7,7,8,9,0,0,1001,1,''].join('|')});
    if(result.status!==200)throw Error('Stored funding read failed');const stored=decodeMappedResponse(result.body);
    if(stored.total!==stored.rows.length||stored.total>1000||stored.rows.length!==values.fundingSources.length)throw Error('Funding UI and stored allocation counts differ');
    for(const f of stored.rows){id(f.allocationId);id(f.fundId);id(f.fundCycleId);if(values.fundingSources.filter(s=>s.name===f.name&&s.amount===f.amount).length!==1)throw Error('Stored funding differs from UI');}
    values.fundingSources=stored.rows;return values;
  };
  const matches=(snapshot,expected)=>snapshot.needStatus==='Closed'&&snapshot.needOutcome==='Fully Met'&&Object.entries(expected.ssvfInformation??{}).every(([key,value])=>snapshot.ssvfInformation?.[key]===value)&&(!expected.financialAssistancePeriod||['start','end'].every(k=>Date.parse(snapshot.financialAssistancePeriod[k])===Date.parse(expected.financialAssistancePeriod[k])))&&expected.fundingSources.length===snapshot.fundingSources.length&&expected.fundingSources.every(f=>snapshot.fundingSources.filter(s=>s.fundId===f.fundId&&s.fundCycleId===f.fundCycleId&&s.name===f.name&&s.amount===f.amount).length===1);
  const searchFunds=async()=>{
    await expandFunds();
    const responsePromise=page.waitForResponse(r=>r.url()===base+'service/MetaQueryService'&&r.request().postData()?.includes('SELECT SpFundCycleBalanceView.name AS name'));
    void responsePromise.catch(()=>{});
    await page.locator('[id^="SpFundingSourcesPanel.addFundingSource-"]').click();
    const response=await responsePromise;await ready();
    if(response.status()!==200)throw Error('Funding lookup failed');
    const request=response.request(),headers=await request.allHeaders();
    return {body:request.postData(),headers:Object.fromEntries(['content-type','x-gwt-module-base','x-gwt-permutation'].map(k=>[k,headers[k]]))};
  };
  const fundOptions=async(wire,overrides={})=>{
    const parts=wire.body.split('|');if(parts[0]!=='7'||parts[1]!=='0'||Number(parts[2])!==9||parts[6]!=='getMappedResults')throw Error('Funding lookup format changed');
    let query=parts[11];
    if(!query.startsWith('SELECT SpFundCycleBalanceView.name AS name')||!query.includes('SpFundCompatibleCode.compatibleCodeId')||!query.includes('SpFundEnforcement'))throw Error('Funding filter missing');
    if(overrides.providerId!==undefined)query=query.replace(/\bproviderId = \d+/g,`providerId = ${id(overrides.providerId)}`);
    if(overrides.serviceCodeId!==undefined)query=query.replace(/\bcompatibleCodeId = \d+/g,`compatibleCodeId = ${id(overrides.serviceCodeId)}`);
    parts[11]=query.replace(/LIMIT \d+,\d+$/,'LIMIT 1001,0');
    // v7 getMappedResults(String,HashMap,int,int,boolean), observed null map and zero offset.
    if(parts.slice(12).join('|')!=='1|2|3|4|5|5|6|7|7|8|9|0|0|10|1|')throw Error('Funding query arguments changed');
    parts[25]='1001';
    const result=await page.evaluate(async({url,headers,body})=>{const r=await fetch(url,{method:'POST',headers,body,credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.text()};},{url:base+'service/MetaQueryService',headers:wire.headers,body:parts.join('|')});
    if(result.status!==200)throw Error('Funding read failed');const decoded=decodeMappedResponse(result.body);
    if(decoded.total!==decoded.rows.length||decoded.total>1000)throw Error('Incomplete funding list');
    for(const row of decoded.rows){id(row.fundId);id(row.fundCycleId);if(typeof row.name!=='string'||!row.name)throw Error('Invalid funding source');}
    return decoded.rows;
  };
  const listFundingSources=input=>withPageLock(page,async()=>{
    await open(input.context);
    try{const wire=await searchFunds();try{return await fundOptions(wire,input);}finally{await page.locator('[id="FundServicesSearchPopup.cancel"]').click();}}finally{await exit();}
  });
  const inspect=context=>withPageLock(page,async()=>{await open(context);try{return await read();}finally{await exit();}});
  const fillDate=async(prefix,value)=>{
    const parts=await page.evaluate(value=>{const d=new Date(value);const rebuilt=new Date(d.getFullYear(),d.getMonth(),d.getDate(),d.getHours(),d.getMinutes(),d.getSeconds());if(rebuilt.getTime()!==d.getTime())throw Error('Ambiguous local time');return {Month:String(d.getMonth()+1).padStart(2,'0'),Day:String(d.getDate()).padStart(2,'0'),Year:String(d.getFullYear()),Hour:String(d.getHours()%12||12),Minute:String(d.getMinutes()).padStart(2,'0'),Second:String(d.getSeconds()).padStart(2,'0'),'AM/PM':d.getHours()<12?'AM':'PM'};},value);
    for(const [part,value]of Object.entries(parts)){const field=page.getByLabel(prefix+' '+part,{exact:true});if(['Month','Day','Year'].includes(part)){await field.fill(value);await field.press('Tab');}else await field.selectOption(value);}
  };
  const complete=(context,expected,beforeSave)=>withPageLock(page,async()=>{
    await open(context);let attempted=false;
    try{
      const current=await read();if(matches(current,expected))return current;
      if(current.fundingSources.length)throw Error('Existing funding differs; manual reconciliation required');
      await page.getByLabel('Need Status',{exact:true}).selectOption({label:'Closed'});
      await page.getByLabel('Outcome of Need',{exact:true}).selectOption({label:'Fully Met'});
      if(expected.financialAssistancePeriod){await fillDate('SSVF Financial Assistance Start Date',expected.financialAssistancePeriod.start);await fillDate('SSVF Financial Assistance End Date',expected.financialAssistancePeriod.end);}
      for(const fund of expected.fundingSources){
        const wire=await searchFunds(),options=await fundOptions(wire);
        const matches=options.filter(f=>f.fundId===fund.fundId&&f.fundCycleId===fund.fundCycleId&&f.name===fund.name);
        if(matches.length!==1||options.filter(f=>f.name===fund.name).length!==1)throw Error('Funding source unavailable or ambiguous');
        const dialog=page.getByRole('dialog',{name:'Add Funding Source',exact:true});
        const search=dialog.locator('input[name="txtSearchBox"]');await search.fill('');await search.pressSequentially(fund.name);
        const searched=page.waitForResponse(r=>r.url()===base+'service/MetaQueryService'&&r.request().postData()?.includes('SELECT SpFundCycleBalanceView.name AS name'));
        void searched.catch(()=>{});
        await page.locator('[id="FundServicesSearchView.searchButton"]').click();await searched;await ready();
        // Reject ambiguous names/cycles above. Select only the row displaying this verified name.
        const row=dialog.getByText(fund.name,{exact:true}).locator('xpath=ancestor::tr[@role="row"][1]');
        await row.getByTitle('Select Fund',{exact:true}).click();await dialog.waitFor({state:'hidden'});await ready();
        const amount=page.getByText(fund.name,{exact:true}).locator('xpath=ancestor::tr[.//input[contains(@class,"textbox")]][1]').locator('input.sp5-textbox');await amount.fill(fund.amount.toFixed(2));await amount.press('Tab');
      }
      await beforeSave();attempted=true;
      await page.locator('[id="ServiceView.saveAndExit"]').click();
      await page.locator('[id="ServiceView.saveAndExit"]').waitFor({state:'hidden'});await ready();
      await open(context);const saved=await read();if(!matches(saved,expected))throw Error('Service UI readback mismatch');return saved;
    }finally{
      // Never dismiss an uncertain save/validation dialog or click Save again.
      if(!await page.locator('[role=dialog]:visible').count())await exit();
      else if(!attempted&&await page.locator('[id="FundServicesSearchPopup.cancel"]').isVisible()){await page.locator('[id="FundServicesSearchPopup.cancel"]').click();await exit();}
    }
  });
  return {connection,assertReady:()=>withPageLock(page,assertReady),inspect,matches,complete,listFundingSources};
}
