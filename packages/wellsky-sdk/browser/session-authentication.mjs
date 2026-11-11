import {pageConnection} from './connection.mjs';
import {randomUUID} from 'node:crypto';
import {AttachmentConflictError} from './attachment-conflict.mjs';
const sessions=new WeakMap();
export class SessionInterruptedError extends Error {
 constructor(reauthenticated,options={}){
  super(reauthenticated?'Session reauthenticated after an interrupted operation. Retry with the same durable journal and operation key to reconcile; the operation was not replayed.':'Session reauthentication failed after an interrupted operation. Resolve authentication, then reconcile with the same durable journal and operation key.',options);
  this.name='SessionInterruptedError';this.code='SESSION_INTERRUPTED';this.reauthenticated=reauthenticated;
  const status=options.cause?.status??options.authenticationStatus;if(Number.isInteger(status)&&status>=100&&status<=599)this.status=status;
  if(options.authenticationStatus!==undefined)this.authenticationStatus=options.authenticationStatus;
  if(typeof options.cause?.step==='string')this.step=options.cause.step;
  if(options.reauthenticationCause!==undefined)Object.defineProperty(this,'reauthenticationCause',{value:options.reauthenticationCause,enumerable:false});
 }
}
export const sessionAuthentication=page=>sessions.get(page);
export const sessionGeneration=page=>sessions.get(page)?.generation??'unmanaged';
/** Internal hooks run only while the page lock is held. Never rerun a work callback. */
export function attachAuthentication(page,reconnect,probe,connection=pageConnection(page)){
 const target=new URL(connection.moduleBaseUrl);
 let expired=false,authenticationStatus,blocked,closed=false,generation=randomUUID();
 const response=r=>{const u=new URL(r.url());if(u.origin===target.origin&&u.pathname.startsWith('/'+connection.tenant+'/')&&r.status()===401){expired=true;authenticationStatus=401;}};
 page.on('response',response);
 const state={
  get generation(){return generation;},
  async isExpired(){return expired||await page.locator('[id="formfield-password"]:visible').count()>0;},
  async reauthenticate(){
   if(closed)throw Error('Session closed');
   // Invalidate all prepared payloads even if authentication subsequently fails.
   generation=randomUUID();expired=true;
   try{await reconnect();expired=false;authenticationStatus=undefined;blocked=undefined;}catch(error){blocked=error;throw error;}
  },
  async before(){if(closed)throw Error('Session closed');if(blocked)throw blocked;if(await state.isExpired())await state.reauthenticate();},
  async afterFailure(error){
   // Preserve confirmed conflicts even if the session expired independently.
   // The next operation still performs normal authentication preflight.
   if(error instanceof AttachmentConflictError)throw error;
   if(!await state.isExpired()&&!await Promise.resolve().then(()=>probe?.()).catch(()=>false))throw error;
   const status=authenticationStatus;
   try{await state.reauthenticate();}catch(reauthenticationCause){throw new SessionInterruptedError(false,{cause:error,authenticationStatus:status,reauthenticationCause});}
   throw new SessionInterruptedError(true,{cause:error,authenticationStatus:status});
  },
  close(){closed=true;page.off('response',response);},
 };
 sessions.set(page,state);return state;
}
