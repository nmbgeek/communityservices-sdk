const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDateOfBirth,validateBirthDate} from '@choiceapps/communityservices-sdk/browser';
function fixture(){
 let dob='1980-07-04',at='2026-10-23T18:00:00',writes=0,uiWrites=0;
 const client={clientId:1,isActive:true,firstName:'Synthetic',lastName:'DOB',socSecNo:'999001234',svpprofdobtype:'Full DOB Reported'};
 const entries=new Map(),calls=[];
 const store={withLock:async(_,work)=>work(),read:async k=>structuredClone(entries.get(k)??[]),write:async(k,v)=>entries.set(k,structuredClone(v))};
 const api={tenant:testTenant,clients:{get:async()=>({...client,svpprofdob:dob?.replaceAll('-','/')}),update:async({body})=>{writes++;calls.push(body);assert.equal(body.socSecNo,client.socSecNo);dob=body.svpprofdob.slice(0,10);at=body.dateEffective.slice(0,19);}},assessmentsMobile:{getAnswers:async()=>[{virt_field_name:'SVPPROFDOB',question_type:'date',answer_value:dob?dob+' 00:00:00-07':null,date_effective:dob?at:null},{virt_field_name:'OTHER',answer_value:'1',date_effective:'2026-10-23T16:00:00'}]}};
 const ui={validateRestDate:async()=>{},read:async()=>dob,correctAtEntry:async i=>{await i.beforeSave();uiWrites++;dob=i.dateOfBirth;}};
 return {api,ui,store,client,calls,entries,helper:()=>createDateOfBirth({api,ui,store}),setDob:v=>{dob=v;},setAt:v=>{at=v;},counts:()=>({writes,uiWrites})};
}
const input=(extra={})=>({clientId:1,key:'dob',assessmentCode:'ENTRY',dateOfBirth:'1984-02-29',effectiveDate:'2026-10-23T19:00:00Z',...extra});
const entry={enrollmentId:2,assessmentName:'Entry'};
test('strict birth dates accept leap days and reject invalid dates/timestamps',()=>{
 for(const x of ['1984-02-29','2000-02-29','1999-12-31'])assert.equal(validateBirthDate(x),x);
 for(const x of ['1900-02-29','1983-02-29','2020-04-31','2020-1-01','2020-01-01T00:00:00Z','0000-01-01',null,{}])assert.throws(()=>validateBirthDate(x));
});
test('REST encodes midnight at fixed -07 without changing effective date and preserves SSN',async()=>{
 const f=fixture();assert.equal((await f.helper().update(input())).method,'rest');
 assert.equal(f.calls[0].svpprofdob,'1984-02-29T07:00:00Z');assert.equal(f.calls[0].dateEffective,'2026-10-23T19:00:00.000Z');
 assert.equal((await f.helper().update(input())).outcome,'already-present');assert.deepEqual(f.counts(),{writes:1,uiWrites:0});
 assert.ok(!JSON.stringify([...f.entries.values()]).includes('999001234'));
});
test('existing timestamp uses UI without a failed REST attempt, then reconciles',async()=>{
 const f=fixture(),i=input({entry,effectiveDate:'2026-10-23T18:00:00Z'});
 assert.equal((await f.helper().update(i)).method,'ui');assert.equal((await f.helper().update(i)).outcome,'already-present');assert.deepEqual(f.counts(),{writes:0,uiWrites:1});
});
test('existing timestamp without entry context and earlier history corrections stop before writing',async()=>{
 for(const effectiveDate of ['2026-10-23T18:00:00Z','2026-10-23T17:00:00Z']){const f=fixture();await assert.rejects(f.helper().update(input({effectiveDate})));assert.equal(f.entries.size,0);assert.deepEqual(f.counts(),{writes:0,uiWrites:0});}
});
for(const committed of [true,false])test(`uncertain REST ${committed?'reconciles':'blocks replay'}`,async()=>{
 const f=fixture(),original=f.api.clients.update;let attempts=0;f.api.clients.update=async args=>{attempts++;if(committed)await original(args);throw Error('lost');};
 if(committed){await f.helper().update(input());await f.helper().update(input());}else{await assert.rejects(f.helper().update(input()));await assert.rejects(f.helper().update(input()),/refusing replay/);}assert.equal(attempts,1);
});
for(const committed of [true,false])test(`uncertain UI ${committed?'reconciles':'blocks replay'}`,async()=>{
 const f=fixture(),original=f.ui.correctAtEntry,i=input({entry,effectiveDate:'2026-10-23T18:00:00Z'});let attempts=0;
 f.ui.correctAtEntry=async args=>{attempts++;if(committed)await original(args);else await args.beforeSave();throw Error('lost');};
 await assert.rejects(f.helper().update(i));if(committed)await f.helper().update(i);else await assert.rejects(f.helper().update(i),/refusing replay/);assert.equal(attempts,1);
});
test('conflicting key and later DOB drift never overwrite values',async()=>{
 const f=fixture();await f.helper().update(input());await assert.rejects(f.helper().update(input({dateOfBirth:'1985-02-28'})),/conflicts/);f.setDob('1985-03-01');await assert.rejects(f.helper().update(input()),/refusing replay/);assert.equal(f.counts().writes,1);
});
test('unexpected UI or protected profile change blocks mutation or completion',async()=>{
 const f=fixture();f.ui.read=async()=>null;await assert.rejects(f.helper().update(input()),/UI DOB disagree/);assert.equal(f.entries.size,0);
 const g=fixture(),original=g.api.clients.update;g.api.clients.update=async args=>{await original(args);g.client.socSecNo='';};await assert.rejects(g.helper().update(input()),/verification failed/);await assert.rejects(g.helper().update(input()),/unrequested/);
});
test('failed persistence and unresolved profile work block writes',async()=>{
 const f=fixture();f.store.write=async()=>{throw Error('disk');};await assert.rejects(f.helper().update(input()),/disk/);assert.deepEqual(f.counts(),{writes:0,uiWrites:0});
 const g=fixture();g.store.read=async()=>[{stage:'ui-attempted',keyHash:'other-profile-key'}];await assert.rejects(g.helper().update(input()),/another profile update/);
});
test('empty DOB can be initialized; invalid effective dates, future birth and a missing tenant fail closed',async()=>{
 const f=fixture();f.setDob(null);assert.equal((await f.helper().update(input())).method,'rest');
 for(const extra of [{effectiveDate:'2026-02-30T10:00:00Z'},{dateOfBirth:'2027-01-01'},{phone:'unknown'}]){const g=fixture();await assert.rejects(g.helper().update(input(extra)));assert.deepEqual(g.counts(),{writes:0,uiWrites:0});}
 const g=fixture();g.api.tenant='';assert.throws(g.helper,/tenant/);
});

test('UI-created DOB can have an empty mobile value; current client and UI must still agree',async()=>{
 const f=fixture(),get=f.api.assessmentsMobile.getAnswers;f.api.assessmentsMobile.getAnswers=async()=>{const rows=await get();rows[0].answer_value='';return rows;};
 assert.equal((await f.helper().update(input({entry,effectiveDate:'2026-10-23T18:00:00Z'}))).method,'ui');
 assert.equal((await f.helper().update(input({entry,effectiveDate:'2026-10-23T18:00:00Z'}))).outcome,'already-present');
});

test('unsupported browser timezone blocks before reserving or sending a REST update',async()=>{
 const f=fixture();f.ui.validateRestDate=async()=>{throw Error('timezone');};await assert.rejects(f.helper().update(input()),/timezone/);assert.equal(f.entries.size,0);assert.deepEqual(f.counts(),{writes:0,uiWrites:0});
});

test('DOB workflow preflight and read are read-only, including same-timestamp correction eligibility',async()=>{
 const f=fixture(),context={clientId:1,assessmentCode:'ENTRY'};
 assert.deepEqual(await f.helper().read(context),{clientId:1,dateOfBirth:'1980-07-04',effectiveDate:'2026-10-23T18:00:00.000Z'});
 const candidate={...context,dateOfBirth:'1984-02-29',effectiveDate:'2026-10-23T18:00:00Z'};
 await assert.rejects(f.helper().validate(candidate),/existing effective timestamp/);await f.helper().validate({...candidate,allowEntryCorrection:true});
 await assert.rejects(f.helper().validate({...candidate,effectiveDate:'2026-10-23T17:00:00Z'}),/historical correction/);
 assert.deepEqual(f.counts(),{writes:0,uiWrites:0});assert.equal(f.entries.size,0);
});
test('completed DOB verification permits later equal values only when requested and rejects date drift',async()=>{
 const f=fixture(),expected={clientId:1,assessmentCode:'ENTRY',dateOfBirth:'1980-07-04',effectiveDate:'2026-10-23T17:00:00Z'};
 await assert.rejects(f.helper().verify(expected),/saved birth date changed/);await f.helper().verify({...expected,allowLater:true});
 f.setDob('1980-07-05');await assert.rejects(f.helper().verify({...expected,allowLater:true}),/saved birth date changed/);
 assert.deepEqual(f.counts(),{writes:0,uiWrites:0});
});

for(const quality of ["Client doesn't know (HUD)",'Client prefers not to answer (HUD)'])test(`DOB reader preserves a missing date with quality ${quality}`,async()=>{
 const f=fixture();f.setDob(null);f.client.svpprofdobtype=quality;
 assert.deepEqual(await f.helper().read({clientId:1,assessmentCode:'ENTRY'}),{clientId:1,dateOfBirth:null,effectiveDate:null});
 for(const missing of [undefined,null,''])await assert.rejects(f.helper().update(input({dateOfBirth:missing})),/valid YYYY-MM-DD/);
 assert.equal(f.client.svpprofdobtype,quality);assert.deepEqual(f.counts(),{writes:0,uiWrites:0});assert.equal(f.entries.size,0);
});
