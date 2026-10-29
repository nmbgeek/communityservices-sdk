const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {AttachmentConflictError,SessionInterruptedError} from '@choiceapps/communityservices-sdk/browser';
// Internal hooks are resolved from the package under test, also in tarball consumers.
const browserModule=import.meta.resolve('@choiceapps/communityservices-sdk/browser');
const {attachAuthentication,sessionGeneration}=await import(new URL('./session-authentication.mjs',browserModule));
const {withPageLock}=await import(new URL('./page-lock.mjs',browserModule));
function fixture(){
 const page=new EventEmitter();page.url=()=> ('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html').replaceAll('tenant-b', testTenant);let expired=false,reconnections=0,fail=false;
 page.locator=()=>({count:async()=>expired?1:0});
 const auth=attachAuthentication(page,async()=>{reconnections++;if(fail)throw Error('Authentication unavailable');expired=false;});
 return {page,auth,expire:()=>{expired=true;},fail:()=>{fail=true;},count:()=>reconnections};
}
test('concurrent operations reconnect once before callbacks and remain serialized',async()=>{
 const f=fixture();f.expire();let running=false,calls=0;const run=()=>withPageLock(f.page,async()=>{assert.equal(running,false);running=true;await Promise.resolve();calls++;running=false;});await Promise.all([run(),run(),run()]);assert.equal(f.count(),1);assert.equal(calls,3);
});
test('mid-operation expiration reconnects but never invokes the callback twice',async()=>{
 const f=fixture(),generation=sessionGeneration(f.page);let writes=0;
 await assert.rejects(withPageLock(f.page,async()=>{writes++;f.expire();throw Error('Lost save acknowledgement');}),e=>e instanceof SessionInterruptedError&&e.reauthenticated);
 assert.equal(writes,1);assert.equal(f.count(),1);assert.notEqual(sessionGeneration(f.page),generation);
});
test('ordinary operation failures do not trigger reauthentication',async()=>{const f=fixture(),error=Error('Validation failure');await assert.rejects(withPageLock(f.page,async()=>{throw error;}),e=>e===error);assert.equal(f.count(),0);});
test('failed automatic reauthentication blocks later operations without another login attempt',async()=>{const f=fixture();f.fail();await assert.rejects(withPageLock(f.page,async()=>{f.expire();throw Error('Interrupted');}),e=>e instanceof SessionInterruptedError&&!e.reauthenticated);await assert.rejects(withPageLock(f.page,async()=>assert.fail('must not run')),/Authentication unavailable/);assert.equal(f.count(),1);});
test('only a configured-tenant 401 marks expiration, not forbidden or third-party responses',async()=>{const f=fixture();const response=(url,status)=>f.page.emit('response',{url:()=>url,status:()=>status});response(('https://other.invalid/tenant-b/a').replaceAll('tenant-b', testTenant),401);response('https://wscs.wellsky.com/different-tenant/a',401);response(('https://wscs.wellsky.com/tenant-b/a').replaceAll('tenant-b', testTenant),403);await withPageLock(f.page,async()=>{});assert.equal(f.count(),0);response(('https://wscs.wellsky.com/tenant-b/a').replaceAll('tenant-b', testTenant),401);await withPageLock(f.page,async()=>{});assert.equal(f.count(),1);});
test('closed managed sessions reject work and unregister response listener',async()=>{const f=fixture();f.auth.close();assert.equal(f.page.listenerCount('response'),0);await assert.rejects(withPageLock(f.page,async()=>assert.fail('closed')),/closed/);});
test('a failed operation with no visible login reconnects only when a separate probe confirms expiry',async()=>{
 for(const probeResult of [true,false]){
  const page=new EventEmitter();page.url=()=> ('https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html').replaceAll('tenant-b', testTenant);page.locator=()=>({count:async()=>0});let reconnected=0,probes=0,calls=0;
  attachAuthentication(page,async()=>{reconnected++;},async()=>{probes++;return probeResult;});
  const error=Error('HTTP 500');await assert.rejects(withPageLock(page,async()=>{calls++;throw error;}),e=>probeResult?e instanceof SessionInterruptedError:e===error);
  assert.equal(probes,1);assert.equal(calls,1);assert.equal(reconnected,Number(probeResult));
 }
});
test('an inconclusive authentication probe preserves the operation error and does not reconnect',async()=>{const page=new EventEmitter();page.url=()=>'https://wscs.wellsky.com/synthetic/com.bowmansystems.sp5.core.ServicePoint/index.html';page.locator=()=>({count:async()=>0});attachAuthentication(page,async()=>assert.fail('must not reconnect'),async()=>{throw Error('Probe failed');});const error=Error('Server failure');await assert.rejects(withPageLock(page,async()=>{throw error;}),e=>e===error);});
test('attachment conflict survives concurrent expiry; the next operation reauthenticates once',async()=>{
 const f=fixture(),error=new AttachmentConflictError('identity-changed','Saved identity changed');let callbacks=0;
 await assert.rejects(withPageLock(f.page,async()=>{callbacks++;f.expire();throw error;}),e=>e===error);
 assert.equal(f.count(),0);assert.equal(callbacks,1);
 await withPageLock(f.page,async()=>{callbacks++;});assert.equal(f.count(),1);assert.equal(callbacks,2);
});
test('attachment conflict is preserved even when the next login will fail',async()=>{
 const f=fixture(),error=new AttachmentConflictError('content-changed','Saved content changed');f.fail();
 await assert.rejects(withPageLock(f.page,async()=>{f.expire();throw error;}),e=>e===error);
 assert.equal(f.count(),0);
 await assert.rejects(withPageLock(f.page,async()=>assert.fail('must not run')),/Authentication unavailable/);
 assert.equal(f.count(),1);
});
test('unclassified coded failures still reconcile authentication without replay',async()=>{
 const f=fixture();let calls=0;
 await assert.rejects(withPageLock(f.page,async()=>{calls++;f.expire();throw Object.assign(Error('HTTP error'),{code:'ECONNRESET'});}),e=>e instanceof SessionInterruptedError&&e.reauthenticated);
 assert.equal(f.count(),1);assert.equal(calls,1);
});
