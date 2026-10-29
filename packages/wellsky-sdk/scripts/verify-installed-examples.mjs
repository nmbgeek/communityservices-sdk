// Copied into an isolated consumer by verify-package.mjs. No repository imports.
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createFakeWellSkyClient} from '@choiceapps/communityservices-sdk/testing';
import {GwtEnrollmentHelpers} from '@choiceapps/communityservices-sdk';
import {
 createFileGwtMutationStore,createClientWorkflows,
 createServiceRecorder,SessionInterruptedError,
} from '@choiceapps/communityservices-sdk/browser';

let networkAttempts=0;
globalThis.fetch=async()=>{networkAttempts++;throw Error('Examples must not use the network');};
const compiled=resolve('compiled-examples');
const files=readdirSync(compiled).filter(n=>/\.(?:mjs|js)$/.test(n));
for(const file of files)await import(pathToFileURL(resolve(compiled,file)).href);
const example=await import(pathToFileURL(resolve(compiled,'durable-records.mjs')).href);
const api=createFakeWellSkyClient({tenant:'tenant-b',maxReadRetries:0});
const clients=[],households=[],notes=[],goals=[];
const reply=(operation,handle)=>api.fake.set(operation,{kind:'handler',handle});
const counted=values=>({body:{count:values.length,values}});
reply('GET /clients',r=>counted(clients.filter(c=>r.query.query.includes(c.firstName)&&r.query.query.includes(c.lastName))));
reply('POST /clients/create',r=>{const row={...r.body,clientId:1001+clients.length,isActive:true};clients.push(row);return {body:row};});
reply('GET /clients/{clientId}',r=>({body:clients.find(c=>c.clientId===Number(r.path.clientId))}));
reply('GET /households/client/{clientId}',r=>counted(households.filter(h=>h.clients.some(c=>c.clientId===Number(r.path.clientId)))));
reply('GET /households/{householdId}',r=>({body:households.find(h=>h.householdId===Number(r.path.householdId))}));
const household=(body,householdId)=>({householdId,isActive:true,householdType:body.householdType,clients:body.householdClients.map(m=>({clientId:m.clientId,headofhouseholdStatus:m.headOfHouseholdStatus,headofhouseholdRelationship:m.headOfHouseholdRelationship,dateJoined:m.dateJoined,dateLeft:m.dateEnded??null,isActive:m.isActive??true}))});
reply('POST /households/create',r=>{const row=household(r.body,2001+households.length);households.push(row);return {body:row};});
reply('PUT /households/update/{householdId}',r=>{const index=households.findIndex(h=>h.householdId===Number(r.path.householdId));households[index]=household(r.body,Number(r.path.householdId));return {body:households[index]};});
reply('GET /clientnotes',()=>counted(notes));
reply('POST /clientnotes/create',r=>{const row={...r.body,client_note_id:3001+notes.length,active:true};notes.push(row);return {body:row};});
reply('PUT /clientnotes/update',r=>{const row=notes.find(n=>n.client_note_id===Number(r.query.clientNoteId));Object.assign(row,r.body);return {body:row};});
reply('GET /goals/client/{clientId}',r=>counted(goals.filter(g=>g.clientId===Number(r.path.clientId))));
reply('GET /goals/{goalId}',r=>({body:goals.find(g=>g.goalId===Number(r.path.goalId))}));
reply('POST /goals/create',r=>{const row={...r.body,goalId:4001+goals.length,isActive:true,actionSteps:[]};goals.push(row);return {body:row};});
reply('PUT /goals/update/{goalId}',r=>{const row=goals.find(g=>g.goalId===Number(r.path.goalId));Object.assign(row,r.body);return {body:row};});
reply('POST /goals/actions/create/{goalId}',r=>{const row=goals.find(g=>g.goalId===Number(r.path.goalId));row.actionSteps.push({...r.body,goalId:row.goalId,goalActionStepId:5001,isActive:true,actionstep:r.body.actionStep});return {body:row};});
reply('PUT /goals/actions/update/{goalActionStepId}',r=>{const row=goals.flatMap(g=>g.actionSteps).find(a=>a.goalActionStepId===Number(r.path.goalActionStepId));Object.assign(row,r.body,{actionstep:r.body.actionStep});return {body:row};});

const directory=resolve('example-journal');
const store=()=>createFileGwtMutationStore(directory);
const ui={households:{confirmNoHouseholds:async()=>true},casePlans:{confirmEmpty:async()=>true}};
const records=()=>example.durableRecords(api,store(),ui);
const date='2026-10-20T16:00:00Z';
const person=(sourceId,firstName)=>({sourceId,body:{firstName,lastName:'OfflineExample',dateEffective:date}});
const input={householdSourceId:'household-source',householdType:'Couple With No Children',head:person('head-source','Head'),member:person('member-source','Member'),joinedAt:date,memberRelationship:'Other relative'};
const first=await example.createPeopleAndHousehold(records(),input);
const writes=()=>api.fake.calls.filter(c=>!c.operation.startsWith('GET ')).length;
let before=writes();
const retried=await example.createPeopleAndHousehold(records(),input);
assert.equal(writes(),before);assert.equal(retried.household.household.householdId,first.household.household.householdId);
await assert.rejects(records().clients.create({...input.head,body:{...input.head.body,firstName:'Changed'}}),e=>e.code==='SOURCE_ID_CONFLICT');
await assert.rejects(records().clients.create({...input.head,sourceId:'another-person-source'}),e=>e.code==='POSSIBLE_DUPLICATE');
const child=await records().clients.create(person('child-source','Child'));
const context={householdId:first.household.household.householdId,headClientId:first.head.clientId};
const later={...context,key:'child-membership',householdType:'Two Parent Family',member:{clientId:child.clientId,relationship:'Daughter',dateJoined:'2026-10-22T16:00:00Z'}};
await example.addLaterMember(records(),later);before=writes();await example.addLaterMember(records(),later);assert.equal(writes(),before);
await assert.rejects(records().households.endMembers({...context,key:'bad-head',clientIds:[first.head.clientId],dateEnded:'2026-10-23T16:00:00Z'}),/Head cannot/);
await records().households.updateRelationships({...context,key:'member-relationship',members:[{clientId:first.member.clientId,relationship:'Significant other'}]});
await records().households.endMembers({...context,key:'member-departure',clientIds:[first.member.clientId],dateEnded:'2026-10-23T16:00:00Z'});
assert.equal((await records().households.read(context.householdId)).members.filter(m=>m.head).length,1);

const clientId=first.head.clientId;
const plan={clientId,sourceId:'plan-source',note:{note_date:date,note:'Synthetic Client Note'},goal:{providerId:10,dateGoalsSet:date,classification:'Case Plan',type:'Develop a Case Plan',overallStatus:'In Progress',goalDescription:'Synthetic goal'},action:{providerId:10,dateSet:date,actionStep:'Synthetic action',status:'In Progress'}};
const created=await example.createCasePlan(records(),plan);before=writes();await example.createCasePlan(records(),plan);assert.equal(writes(),before);
const changes=[['updateClientNote',{key:'note-revision',clientId,recordId:created.note.recordId,values:{note:'Revised synthetic note'}}],['updateGoal',{key:'goal-revision',clientId,recordId:created.goal.recordId,values:{goalDescription:'Revised goal',percentComplete:'50%'}}],['updateActionStep',{key:'action-revision',clientId,goalId:created.goal.recordId,recordId:created.action.recordId,values:{actionStep:'Revised action'}}]];
for(const [method,change]of changes)await records().casePlans[method](change);
before=writes();for(const [method,change]of changes)await records().casePlans[method](change);await example.createCasePlan(records(),plan);assert.equal(writes(),before);
assert.equal(notes.length,1);assert.equal(goals.length,1);assert.equal(goals[0].actionSteps.length,1);

// Lose a real fake-transport acknowledgement; do not infer a client ID from names.
const lost=person('lost-source','LostReceipt');let receipt;
api.fake.enqueue('POST /clients/create',{kind:'commit-then-error',status:500,commit:r=>{receipt={...r.body,clientId:1001+clients.length,isActive:true};clients.push(receipt);}});
await assert.rejects(records().clients.create(lost),e=>e.code==='CLIENT_CREATE_UNCERTAIN');before=writes();await assert.rejects(records().clients.create(lost),e=>e.code==='CLIENT_CREATE_UNCERTAIN');
await example.resolveMissingClientReceipt(records(),lost,receipt.clientId);await records().clients.create(lost);assert.equal(writes(),before);

// A conflicting keyed note fails before any browser access. A real UI save is a live acceptance test.
let browserAccess=false;
const page=new Proxy({},{get(_target,key){if(key==='url')return ()=>'https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/index.html';browserAccess=true;throw Error('Unexpected browser access');}});
const conflictStore={...store(),read:async()=>[{intent:{checksum:'prior-intent'},state:'verified',noteId:1}]};
const workflows=createClientWorkflows({page,store:conflictStore});
await assert.rejects(example.writeGoalProgress(workflows,{key:'goal-note-source',clientId,goalId:created.goal.recordId,providerId:10,noteDate:'2026-10-23',note:'Changed'}),e=>e.code==='CASE_NOTE_SOURCE_CONFLICT');assert.equal(browserAccess,false);

const serviceUi={assertReady:async()=>{throw new SessionInterruptedError(true);}};
const recorder=createServiceRecorder({api,store:store(),ui:serviceUi});
const row={key:'service-source',body:{clientId,serviceProvider:10,serviceCode:'BH-3800.7000',serviceStartDate:date,serviceEndDate:date}};
const report=await example.recordServiceBatch(recorder,[row,{...row,key:'next-source'}]);
assert.equal(report.failures[0].error.code,'SESSION_INTERRUPTED');assert.equal(report.failures[0].error.stage,'session-preflight');assert.equal(report.failures[0].nextAction,'reconcile-same-key');assert.equal(report.results[1].outcome,'skipped');

// Existing GWT state must be journaled even when no server write is necessary.
const moduleBase='https://training.invalid/tenant-b/com.bowmansystems.sp5.core.ServicePoint/';
const snapshot={source:'gwt-rpc',tenant:'tenant-b',sessionId:'synthetic-session',revision:'v1',clientId:1,enrollmentId:10,projectStartDate:date,householdClientIds:[1,2],members:[{clientId:1,enrollmentId:10},{clientId:2,enrollmentId:11}],reviews:[{reviewId:20,type:'Update',reviewDate:date,clientIds:[1,2]}]};
let gwtWrites=0;
const session={readEnrollment:async()=>structuredClone(snapshot),prepare:async()=>{gwtWrites++;throw Error('Unexpected preparation');},send:async()=>{gwtWrites++;throw Error('Unexpected send');}};
const gwt=()=>new GwtEnrollmentHelpers({tenant:'tenant-b',moduleBaseUrl:moduleBase,session,store:store()});
const member={clientId:1,enrollmentId:10,memberClientIds:[2]},review={clientId:1,enrollmentId:10,clientIds:[1,2],reviewDate:date};
assert.equal((await gwt().addHouseholdMembers(member)).outcome,'already-present');
assert.equal((await gwt().createInterimUpdate(review)).outcome,'already-present');
assert.equal((await gwt().createInterimUpdate(review)).outcome,'reconciled');
snapshot.reviews=[];
await assert.rejects(gwt().createInterimUpdate(review),e=>e.reason==='previously-verified-missing');
snapshot.members.pop();
await assert.rejects(gwt().addHouseholdMembers(member),e=>e.reason==='previously-verified-missing');
assert.equal(gwtWrites,0);

let savedService,serviceCreates=0,serviceSaves=0,done=false,drift;
reply('GET /services/{clientId}',()=>counted(savedService?[savedService]:[]));
reply('POST /services/create',r=>{serviceCreates++;savedService={...r.body,serviceId:6001,needId:7001,isActive:true};return {body:savedService};});
reply('GET /services/complete/{serviceId}',()=>({body:{...savedService,...drift}}));
reply('GET /needs/complete/{needId}',()=>({body:{needId:7001,clientId,needProvider:10,isActive:true,statusInformation:{needStatus:'Closed',needOutcome:'Fully Met'}}}));
const completedUi={assertReady:async()=>{},inspect:async()=>({done}),matches:s=>s.done,complete:async(_context,_expected,beforeSave)=>{await beforeSave();serviceSaves++;done=true;return {done};}};
const services=()=>createServiceRecorder({api,store:store(),ui:completedUi});
await services().record(row);await services().record(row);
for(const replacement of [{serviceId:6002},{needId:7002}]){drift=replacement;await assert.rejects(services().record(row),/identity/);}
assert.equal(serviceCreates,1);assert.equal(serviceSaves,1);
assert.equal(networkAttempts,0);
console.log(`Installed examples: ${files.length} imported; durable creation, membership, case plans, keyed conflicts, and recovery assertions passed without network access`);
console.log('Installed retry regressions: adopted GWT records and service/need identities remain protected across helper replacement');

const needExample=await import(pathToFileURL(resolve(compiled,'independent-needs.mjs')).href);
const savedNeeds=[];let needSaves=0;
const needUi={list:async()=>structuredClone(savedNeeds),create:async(values,beforeSave)=>{await beforeSave();needSaves++;savedNeeds.push({...values,needId:8001,serviceCount:0});}};
const pit={key:'pit-source',clientId,providerId:10,serviceCodeId:60,needDate:date,status:'Identified',outcome:'Not Met',reasonUnmet:'All Services Full'};
await needExample.recordPointInTimeNeed(needUi,store(),pit,api.tenant);
await needExample.recordPointInTimeNeed(needUi,store(),pit,api.tenant);
await assert.rejects(needExample.recordPointInTimeNeed(needUi,store(),{...pit,status:'Closed'},api.tenant),e=>e.code==='NEED_CONFLICT');
assert.equal(needSaves,1);assert.equal(savedNeeds[0].serviceCount,0);
const selected={serviceCodeId:60,code:'BH-1800',description:'Synthetic shelter term',codeSetId:1,parentServiceCodeId:null};
const choices=await needExample.discoverServiceTypes({listServiceTypes:async()=>({types:[selected]})},{clientId});assert.equal(choices.types.length,1);
const quick=await needExample.discoverServiceQuicklist({listServiceQuicklist:async()=>({providerId:10,types:[selected]})},{clientId,providerId:10});assert.equal(quick.types[0].code,selected.code);
await needExample.recordChosenService({record:async value=>{assert.equal(value.body.serviceCode,selected.code);}},selected,{...row,body:{...row.body,serviceCode:undefined}});
console.log('Installed independent-needs example: same-key retry, changed-intent conflict, and service taxonomy selection passed');

const shelterExample=await import(pathToFileURL(resolve(compiled,'shelters.mjs')).href);
const shelterStays=[],shelterEntries=[];let shelterWrites=0;
reply('GET /providers/complete/{providerId}',()=>({body:{providerId:10,providerName:'Example shelter',projectType:'Transitional housing',emergencyShelterTrackingMethod:'Entry/Exit Date'}}));
reply('GET /households/{householdId}',()=>({body:{householdId:20,isActive:true,clients:[1,2].map(clientId=>({clientId,isActive:true,headofhouseholdStatus:clientId===1,dateJoined:'2026-10-19T12:00:00Z',dateLeft:null}))}}));
reply('GET /services/{clientId}',r=>counted(shelterStays.filter(s=>s.clientId===Number(r.path.clientId))));
reply('GET /services/complete/{serviceId}',r=>({body:shelterStays.find(s=>s.serviceId===Number(r.path.serviceId))}));
const shelterUi={
 assertBedsAvailable:async()=>{},
 getUnitList:async()=>({unitListId:30,name:'Example units'}),
 listEnrollments:async()=>structuredClone(shelterEntries),confirmNoServices:async()=>true,
 verifyStayIdentity:async({stays,unitListId})=>stays.map(s=>({serviceId:s.serviceId,clientId:s.clientId,bedId:s.clientId,unitListId})),
 checkIn:async(n,before)=>{await before();shelterWrites++;for(const member of n.members){
  shelterStays.push({serviceId:800+member.clientId,clientId:member.clientId,provider_id:10,isActive:true,shelter_item:true,needId:900+member.clientId,serviceStartDate:n.entryDate,serviceEndDate:null,unitList:n.unitListName,unitNameNumber:member.bedName,groupId:800,serviceNote:''});
  shelterEntries.push({enrollmentId:700+member.clientId,clientId:member.clientId,providerId:10,entryDate:n.entryDate,exitDate:null,groupId:700,type:'HUD',destination:null,reason:null});
 }},
 checkout:async(n,before)=>{await before();shelterWrites++;for(const s of shelterStays)s.serviceEndDate=n.checkoutDate;for(const e of shelterEntries){e.exitDate=n.checkoutDate;e.destination=n.destination;e.reason=n.reasonForLeaving;}},
};
const shelter=()=>shelterExample.shelterWorkflow(api,shelterUi,store(),{addHouseholdMembers:async()=>{throw Error('Unexpected membership write');}});
const checkIn={key:'shelter-in',providerId:10,unitListId:30,householdId:20,headClientId:1,entryDate:'2026-10-20T20:00:00-04:00',members:[{clientId:1,bedName:'Bed 1'},{clientId:2,bedName:'Bed 2'}]};
const checkOut={key:'shelter-out',checkInKey:'shelter-in',clientIds:[1,2],checkoutDate:'2026-10-23T08:00:00-04:00',lastNight:'2026-10-22',timeZone:'America/New_York',destination:'Data not collected',reasonForLeaving:'Completed program'};
assert.equal((await shelterExample.discoverShelterMode(api,{providerId:10})).mode,'entry-exit');
await shelterExample.checkInHousehold(shelter(),checkIn);
assert.equal((await shelterExample.checkInHousehold(shelter(),checkIn)).outcome,'already-present');
await assert.rejects(shelterExample.checkInHousehold(shelter(),{...checkIn,unitListId:31}),e=>e.reason==='intent-changed');
await shelterExample.checkOutHousehold(shelter(),checkOut);
assert.equal((await shelterExample.checkOutHousehold(shelter(),checkOut)).outcome,'already-present');
assert.equal(shelterWrites,2);assert.equal(shelterStays.length,2);assert.equal(shelterEntries.length,2);assert.equal(networkAttempts,0);
console.log('Installed shelter example: discovery, household check-in/checkout, stable-key retries and changed-intent conflict passed');
