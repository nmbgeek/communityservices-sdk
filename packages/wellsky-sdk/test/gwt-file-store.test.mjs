import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFileGwtMutationStore} from '../examples/gwt-file-store.mjs';

test('durable journal survives new instances and excludes overlapping writers',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'wellsky-gwt-journal-'));
 try {
  const a=createFileGwtMutationStore(dir),b=createFileGwtMutationStore(dir),scope='synthetic enrollment',record=[{state:'attempted',intent:{kind:'add-household-members',clientId:1,enrollmentId:10,memberClientIds:[2]}}];
  await a.withLock(scope,async()=>{await a.write(scope,record);await assert.rejects(b.withLock(scope,async()=>assert.fail('concurrent lock acquired')),e=>e.code==='EEXIST');});
  await b.withLock(scope,async()=>assert.deepEqual(await b.read(scope),record));
  await assert.rejects(a.read(scope),/requires its enrollment lock/);
  await assert.rejects(a.withLock(scope,async()=>{throw Error('test failure');}),/test failure/);
  await b.withLock(scope,async()=>assert.deepEqual(await b.read(scope),record));
 }finally{await rm(dir,{recursive:true,force:true});}
});
