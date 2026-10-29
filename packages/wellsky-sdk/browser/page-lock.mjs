import {sessionAuthentication} from './session-authentication.mjs';
const locks=new WeakMap();
export async function withPageLock(page,work,{authentication=true}={}){
  const previous=locks.get(page)??Promise.resolve();let release;
  const current=new Promise(resolve=>{release=resolve;});locks.set(page,current);await previous;
  try{
    const auth=authentication?sessionAuthentication(page):undefined;
    await auth?.before();
    try{return await work();}catch(error){if(auth)return await auth.afterFailure(error);throw error;}
  }finally{release();if(locks.get(page)===current)locks.delete(page);}
}
