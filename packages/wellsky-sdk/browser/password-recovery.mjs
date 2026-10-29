// Internal UI steps. The login orchestrator owns the account lock and write journal.
export async function waitForLogin(page,timeoutMs){
 await page.waitForFunction(()=>{
  const visible=e=>e&&e.getBoundingClientRect().width>0;
  const expired=document.body.innerText.includes('Password has expired!')&&visible(document.getElementById('formfield-password2'))&&visible(document.getElementById('formfield-password'));
  const dashboard=location.hash==='#mainPage'&&!visible(document.getElementById('formfield-password'))&&document.body.innerText.includes('Home Page Dashboard')&&!document.body.innerText.includes('Processing...')&&!document.body.innerText.includes('Loading Modules');
  return expired||dashboard;
 },null,{timeout:timeoutMs});
 return await page.locator('[id="formfield-password2"]').isVisible()?'expired':'dashboard';
}
export async function submitExpiredPassword(page,password,beforeSubmit,timeoutMs){
 if(await waitForLogin(page,timeoutMs)!=='expired')throw Error('Expected expired-password form');
 await page.locator('[id="formfield-password2"]').fill(password);
 await page.locator('[id="formfield-password"]').fill(password);
 await beforeSubmit();
 await page.locator('[id="LoginView.fbtn_submit"]').click();
 // Waiting for a dashboard prevents interpreting the unchanged reset form as success.
 await page.waitForFunction(()=>location.hash==='#mainPage'&&!document.body.innerText.includes('Password has expired!'),null,{timeout:timeoutMs});
 if(await waitForLogin(page,timeoutMs)!=='dashboard')throw Error('Temporary password was not confirmed');
}
export async function restoreOriginalPassword(page,temporaryPassword,originalPassword,beforeSubmit,timeoutMs){
 await page.locator('[title^="Edit User Profile for "]').click();
 await page.locator('[id="UserProfilePopup.changePassword-button"]').click();
 const save=page.locator('[id="UserProfileChangePasswordPopup.save-button"]');
 await save.waitFor({state:'visible',timeout:timeoutMs});
 const dialog=save.locator('xpath=ancestor::*[@role="dialog"][1]');
 for(const [name,value]of [['Current Password',temporaryPassword],['New Password',originalPassword],['Re-enter New Password',originalPassword]]){
  const field=dialog.getByLabel(name,{exact:true});
  if(await field.count()!==1||await field.getAttribute('maxlength')!=='50')throw Error('Password settings form changed');
  await field.fill(value);
 }
 await beforeSubmit();
 await save.click();
 await save.waitFor({state:'hidden',timeout:timeoutMs});
 // The login orchestrator verifies the original password in a fresh context.
}

/** A separate read-only page distinguishes stale-session HTTP 500s from real server errors. */
export async function probeAuthentication(context,moduleUrl,timeoutMs){
 const page=await context.newPage();
 try{
  await page.goto(moduleUrl+'index.html',{waitUntil:'domcontentloaded',timeout:timeoutMs});
  await page.waitForFunction(()=>{
   const password=document.getElementById('formfield-password');
   return password&&password.getBoundingClientRect().width>0||location.hash==='#mainPage'&&document.body.innerText.includes('Home Page Dashboard');
  },null,{timeout:timeoutMs});
  return await page.locator('[id="formfield-password"]').isVisible();
 }finally{await page.close();}
}
