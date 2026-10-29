import {resolveUiConnection} from './connection.mjs';
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createFileGwtMutationStore} from './file-store.mjs';
import {attachAuthentication} from './session-authentication.mjs';
import {withPageLock} from './page-lock.mjs';
import {waitForLogin,submitExpiredPassword,restoreOriginalPassword,probeAuthentication} from './password-recovery.mjs';

export class LoginError extends Error {
 constructor(code,stage,recoveryStage){
  const detail=code==='PASSWORD_EXPIRED'?'Password expired; passwordRecovery is disabled':code==='RECOVERY_UNCERTAIN'?'Password recovery requires reconciliation; no uncertain password change was replayed':code==='RECOVERY_CONFIGURATION'?'Invalid password recovery configuration or journal':'Headless authentication failed; no automatic credential retry was performed';
  super(`Login: ${detail} (stage: ${stage}${recoveryStage?', recovery: '+recoveryStage:''})`);
  this.name='LoginError';this.code=code;this.stage=stage;this.recoveryStage=recoveryStage;
 }
}
const stages=new Set(['temporary-attempted','temporary-active','temporary-verification-attempted','restore-attempted','restored','original-verification-attempted','original-verified']);

/** Fresh headless application context. Recovery defaults on and never retries an uncertain password write.
 * Credentials stay in memory; the original .env is unchanged. Share the recovery store across callers. */
export async function openUiSession(options) {
 const connection=resolveUiConnection(options);
 options={...options,...connection};
 const session=await loginUiSession(options);
 const auth=attachAuthentication(session.page,async()=>{
  const refreshed=await loginUiSession(options,session);
  session.passwordRecovery=refreshed.passwordRecovery;
 },()=>probeAuthentication(session.context,connection.moduleBaseUrl,Math.min(options.timeoutMs??90000,15000)),connection);
 const close=session.close;
 session.ensureAuthenticated=()=>withPageLock(session.page,async()=>{});
 session.reauthenticate=()=>withPageLock(session.page,()=>auth.reauthenticate(),{authentication:false});
 session.close=()=>withPageLock(session.page,async()=>{auth.close();await close();},{authentication:false});
 return session;
}
async function loginUiSession({chromium,tenant,moduleBaseUrl,envFile='.env',executablePath,timeoutMs=90000,passwordRecovery},existing) {
 const connection=resolveUiConnection({tenant,moduleBaseUrl}),target=new URL(connection.moduleBaseUrl);
 let browser=existing?.browser,stage='credentials',record,usedExisting=false;
 const extraContexts=[];
 const failure=code=>new LoginError(code,stage,record?.stage);
 try {
  const env=parseEnv(await readFile(envFile,'utf8'));
  if(!env.HMIS_UI_USER||!env.HMIS_UI_PASSWORD)throw failure('LOGIN_FAILED');
  const recovery=passwordRecovery!==false,appendCharacter=passwordRecovery?.appendCharacter??'!';
  if(passwordRecovery!==undefined&&passwordRecovery!==false&&(!passwordRecovery||typeof passwordRecovery!=='object'||Array.isArray(passwordRecovery)))throw failure('RECOVERY_CONFIGURATION');
  const store=passwordRecovery?.store??createFileGwtMutationStore(env.HMIS_UI_PASSWORD_RECOVERY_DIR||join(homedir(),'.wellsky-sdk','password-recovery'));
  if(recovery&&(!store||!['withLock','read','write'].every(k=>typeof store[k]==='function')||typeof appendCharacter!=='string'||!/^[!-~]$/.test(appendCharacter)))throw failure('RECOVERY_CONFIGURATION');
  const accountHash=createHash('sha256').update(env.HMIS_UI_USER.trim().toLowerCase()).digest('hex');
  const scope=JSON.stringify([connection.scope,'password-recovery',accountHash]);
  const run=async()=>{
   let records=[];
   if(recovery){
    records=await store.read(scope);
    if(!Array.isArray(records)||records.some((r,i)=>!r||r.version!==1||!stages.has(r.stage)||typeof r.appendCharacter!=='string'||!/^[!-~]$/.test(r.appendCharacter)||i<records.length-1&&r.stage!=='original-verified'))throw failure('RECOVERY_CONFIGURATION');
    record=records.at(-1);
    if(record?.stage==='original-verified')record=undefined;
    if(record&&(env.HMIS_UI_PASSWORD.length<8||env.HMIS_UI_PASSWORD.length>=50))throw failure('RECOVERY_CONFIGURATION');
    if(record&&record.appendCharacter!==appendCharacter)throw failure('RECOVERY_CONFIGURATION');
    if(record&&['temporary-verification-attempted','original-verification-attempted'].includes(record.stage))throw failure('RECOVERY_UNCERTAIN');
   }
   const persist=async value=>{record.stage=value;await store.write(scope,structuredClone(records));};
   stage='launch';browser??=await chromium.launch({headless:true,chromiumSandbox:true,...(executablePath?{executablePath}:{})});
   const login=async(password,fresh=false)=>{
    const reuse=existing&&!usedExisting&&!fresh;
    if(reuse){usedExisting=true;await existing.context.clearCookies();}
    const context=reuse?existing.context:await browser.newContext({viewport:{width:1280,height:900}});
    if(existing&&!reuse)extraContexts.push(context);
    if(!reuse)await context.route('**/*',async route=>{
     const request=route.request(),url=new URL(request.url());
     if((request.isNavigationRequest()||!['GET','HEAD','OPTIONS'].includes(request.method()))&&(url.origin!==target.origin||!url.pathname.startsWith('/'+tenant+'/')))return route.abort();
     return route.continue();
    });
    const page=reuse?existing.page:await context.newPage();page.setDefaultTimeout(timeoutMs);
    stage='open-application';await page.goto(connection.moduleBaseUrl+'index.html',{waitUntil:'domcontentloaded',timeout:timeoutMs});
    await page.locator('[id="formfield-login"]').fill(env.HMIS_UI_USER);
    await page.locator('[id="formfield-password"]').fill(password);
    stage='login';await page.locator('[id="LoginView.fbtn_submit"]').click();
    const outcome=await waitForLogin(page,timeoutMs);
    return {context,page,outcome};
   };
   const finish=async(session,recovered)=>{
    if(existing&&session.page!==existing.page){
     // Transfer only this configured origin's verified cookies in memory. Keep the Page identity
     // used by existing adapters, including servers that replace the earlier login session.
     const cookies=await session.context.cookies(connection.moduleBaseUrl);
     await existing.context.clearCookies();await existing.context.addCookies(cookies);
     await session.context.close();
     await existing.page.goto(connection.moduleBaseUrl+'index.html',{waitUntil:'domcontentloaded',timeout:timeoutMs});
     if(await waitForLogin(existing.page,timeoutMs)!=='dashboard')throw failure('RECOVERY_UNCERTAIN');
     session=existing;
    }
    return {connection,browser,context:session.context,page:session.page,passwordRecovery:recovered?'restored-original':'not-needed',close:()=>browser.close()};
   };
   const temporary=env.HMIS_UI_PASSWORD+appendCharacter;
   // A lost save acknowledgement permits one authentication probe, never another save.
   if(record&&['restore-attempted','restored'].includes(record.stage)){
    await persist('original-verification-attempted');
    const session=await login(env.HMIS_UI_PASSWORD);
    if(session.outcome!=='dashboard')throw failure('RECOVERY_UNCERTAIN');
    await persist('original-verified');return finish(session,true);
   }
   const resuming=!!record;
   if(resuming)await persist('temporary-verification-attempted');
   let session=await login(resuming?temporary:env.HMIS_UI_PASSWORD);
   if(resuming){
    if(session.outcome!=='dashboard')throw failure('RECOVERY_UNCERTAIN');
    await persist('temporary-active');
   }else if(session.outcome==='dashboard')return finish(session,false);
   else{
    if(!recovery)throw failure('PASSWORD_EXPIRED');
    if(env.HMIS_UI_PASSWORD.length<8||env.HMIS_UI_PASSWORD.length>=50)throw failure('RECOVERY_CONFIGURATION');
    record={version:1,appendCharacter,stage:'temporary-attempted'};records.push(record);
    stage='temporary-password';
    await submitExpiredPassword(session.page,temporary,()=>persist('temporary-attempted'),timeoutMs);
    await persist('temporary-active');
   }
   stage='restore-original';
   await restoreOriginalPassword(session.page,temporary,env.HMIS_UI_PASSWORD,()=>persist('restore-attempted'),timeoutMs);
   await persist('restored');
   if(!existing)await session.context.close();
   await persist('original-verification-attempted');
   session=await login(env.HMIS_UI_PASSWORD,true);
   if(session.outcome!=='dashboard')throw failure('RECOVERY_UNCERTAIN');
   await persist('original-verified');return finish(session,true);
  };
  return recovery?await store.withLock(scope,run):await run();
 }catch(error){
  if(!existing)await browser?.close().catch(()=>{});
  else await Promise.allSettled(extraContexts.map(context=>context.close()));
  if(error instanceof LoginError)throw error;
  // Playwright errors can include fill arguments. Never propagate their message or cause.
  throw failure(record&&record.stage!=='original-verified'?'RECOVERY_UNCERTAIN':'LOGIN_FAILED');
 }
}
