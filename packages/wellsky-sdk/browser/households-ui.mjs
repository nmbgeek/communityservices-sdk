import {pageConnection} from './connection.mjs';
import {withPageLock} from './page-lock.mjs';

/** Read-only household absence check. Never clicks Continue, which creates a household. */
export function createHouseholdUi({page}) {
 const connection=pageConnection(page),base=connection.moduleBaseUrl;
 const confirmNoHouseholds=clientId=>withPageLock(page,async()=>{
  if(!Number.isSafeInteger(clientId)||clientId<1||new URL(page.url()).origin+new URL(page.url()).pathname!==base+'index.html')throw Error('Client and configured application page required');
  if(await page.locator('[role=dialog]:visible').count())throw Error('Close dialogs before household workflow');
  const ready=()=>page.waitForFunction(()=>!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),null,{timeout:30000});
  if(/Client - \(\d+\)/.test(await page.locator('body').innerText())){
   await page.getByRole('tab',{name:'Client Information',exact:true}).click();await page.getByRole('tab',{name:'Summary',exact:true}).click();await ready();await page.getByRole('button',{name:'Exit',exact:true}).click();await page.waitForURL(u=>u.hash==='#clientPointClientMain');await ready();
  }
  await page.goto(base+'index.html#loadClient;clientId='+clientId);
  await page.waitForFunction(id=>document.body.innerText.includes(`Client - (${id})`)&&!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading...'),clientId,{timeout:30000});
  await page.getByRole('tab',{name:'Households',exact:true}).click();await ready();
  return await page.getByText('This Client is not currently a member of any Households.',{exact:true}).isVisible();
 });
 return {connection,confirmNoHouseholds};
}
