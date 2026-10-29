// Local single-host durable journal. Keep its data directory private and outside Git.
// A crash leaves a lock intentionally. Inspect/reconcile it before manual removal; never expire locks automatically.
import {mkdir,open,readFile,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';

export function createFileGwtMutationStore(directory) {
  const root=resolve(directory),held=new Map();
  const name=scope=>createHash('sha256').update(scope).digest('hex');
  const owned=scope=>{const token=held.get(scope);if(!token)throw Error('Journal requires its enrollment lock');return token;};
  return {
    async withLock(scope,work) {
      await mkdir(root,{recursive:true,mode:0o700});
      const lockPath=join(root,`${name(scope)}.lock`),token=randomUUID();
      const lock=await open(lockPath,'wx',0o600); // EEXIST fails closed for concurrent writers or an unresolved crash.
      try {await lock.writeFile(token);await lock.sync();held.set(scope,token);return await work();}
      finally {held.delete(scope);await lock.close();if(await readFile(lockPath,'utf8')===token)await unlink(lockPath);}
    },
    async read(scope) {
      owned(scope);
      try {return JSON.parse(await readFile(join(root,`${name(scope)}.json`),'utf8'));}
      catch(error){if(error?.code==='ENOENT')return [];throw error;}
    },
    async write(scope,attempts) {
      const token=owned(scope),destination=join(root,`${name(scope)}.json`),temporary=destination+`.${token}.tmp`;
      const file=await open(temporary,'wx',0o600);
      try {await file.writeFile(JSON.stringify(attempts));await file.sync();} finally {await file.close();}
      await rename(temporary,destination);
      const dir=await open(root,'r');try {await dir.sync();}finally{await dir.close();}
    },
  };
}
