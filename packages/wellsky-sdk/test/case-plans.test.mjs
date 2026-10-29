const testTenant=process.env.WELLSKY_TEST_TENANT??'tenant-b';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCasePlans} from '../browser/case-plans.mjs';
function fixture(){
 const notes=[],goals=[],entries=new Map();let writes=0,fault;
 const store={withLock:async(_,fn)=>fn(),read:async k=>structuredClone(entries.get(k)??[]),write:async(k,v)=>entries.set(k,structuredClone(v))};
 const mutate=fn=>{writes++;if(fault!=='before')fn();if(fault)throw Error('lost');};
 const api={tenant:testTenant,clients:{get:async({path})=>({clientId:path.clientId,isActive:true})},clientNotes:{list:async()=>({count:notes.length,values:structuredClone(notes)}),create:async({body})=>mutate(()=>notes.push({client_note_id:notes.length+1,active:true,...body})),update:async({query,body})=>mutate(()=>Object.assign(notes.find(n=>n.client_note_id===query.clientNoteId),body))},goals:{
 listForClient:async()=>({count:goals.length,values:structuredClone(goals)}),get:async({path})=>structuredClone(goals.find(g=>g.goalId===path.goalId)),
 create:async({body})=>mutate(()=>goals.push({goalId:goals.length+10,isActive:true,...body,actionSteps:[]})),update:async({path,body})=>mutate(()=>Object.assign(goals.find(g=>g.goalId===path.goalId),body)),
 createAction:async({path,body})=>mutate(()=>goals.find(g=>g.goalId===path.goalId).actionSteps.push({goalActionStepId:20,goalId:path.goalId,isActive:true,...body,actionstep:body.actionStep})),
 updateAction:async({path,body})=>mutate(()=>Object.assign(goals.flatMap(g=>g.actionSteps).find(a=>a.goalActionStepId===path.goalActionStepId),body,{actionstep:body.actionStep})),
 }};
 return {api,store,ui:{confirmEmpty:async()=>true},notes,goals,fault:v=>{fault=v;},writes:()=>writes,helper(){return createCasePlans(this);}};
}
const note=()=>({key:'note',clientId:1,values:{note_date:'2026-10-20T16:00:00Z',note:'Synthetic note'}});
const goal=()=>({key:'goal',clientId:1,values:{providerId:3,dateGoalsSet:'2026-10-20T16:00:00Z',classification:'Case Plan',type:'Develop a Case Plan',overallStatus:'In Progress',goalDescription:'Synthetic goal'}});
const action=()=>({key:'action',clientId:1,goalId:10,values:{providerId:3,dateSet:'2026-10-21T16:00:00Z',actionStep:'Synthetic step',status:'In Progress'}});
test('all three entities create and update once; retries retain IDs after later updates',async()=>{
 const f=fixture(),calls=[['createClientNote',note()],['createGoal',goal()],['createActionStep',action()],['updateClientNote',{key:'note-edit',clientId:1,recordId:1,values:{note:'Updated'}}],['updateGoal',{key:'goal-edit',clientId:1,recordId:10,values:{goalDescription:'Updated goal'}}],['updateActionStep',{key:'action-edit',clientId:1,goalId:10,recordId:20,values:{actionStep:'Updated step'}}]];
 for(const [method,input]of calls)await f.helper()[method](input);for(const [method,input]of calls)assert.equal((await f.helper()[method](input)).outcome,'already-present');assert.equal(f.writes(),6);assert.equal(f.goals[0].classification,'Case Plan');assert.equal(f.goals[0].clientId,1);
});
for(const kind of ['note','goal','action'])for(const fault of ['before','after'])test(`${kind} create response lost ${fault} commit is never resent`,async()=>{
 const f=fixture();if(kind==='action')await f.helper().createGoal(goal());const before=f.writes();f.fault(fault);const [method,input]={note:['createClientNote',note()],goal:['createGoal',goal()],action:['createActionStep',action()]}[kind];
 if(fault==='before'){await assert.rejects(f.helper()[method](input));await assert.rejects(f.helper()[method](input),/unresolved/);}else{await f.helper()[method](input);await f.helper()[method](input);}assert.equal(f.writes(),before+1);
});
test('changed key content, wrong goal ownership, unknown fields and duplicate lists fail closed',async()=>{
 const f=fixture();await f.helper().createClientNote(note());await assert.rejects(f.helper().createClientNote({...note(),values:{...note().values,note:'Changed'}}),/conflicts/);await assert.rejects(f.helper().createGoal({...goal(),values:{...goal().values,householdId:42}}));await f.helper().createGoal(goal());f.goals[0].clientId=2;await assert.rejects(f.helper().createActionStep(action()),/ownership/);assert.equal(f.writes(),2);
 const g=fixture();g.api.clientNotes.list=async()=>({count:2,values:[]});await assert.rejects(g.helper().createClientNote(note()),/Incomplete/);assert.equal(g.writes(),0);
});
test('unresolved operation blocks a different source key and storage failure blocks save',async()=>{
 const f=fixture();f.fault('before');await assert.rejects(f.helper().createClientNote(note()));await assert.rejects(f.helper().createGoal(goal()),/unresolved/);assert.equal(f.writes(),1);
 const g=fixture();g.store.write=async()=>{throw Error('disk');};await assert.rejects(g.helper().createGoal(goal()),/disk/);assert.equal(g.writes(),0);
});
for(const fault of ['before','after'])test(`lost update acknowledgement ${fault} commit preserves fields and never repeats`,async()=>{
 const f=fixture();await f.helper().createGoal(goal());f.fault(fault);const update={key:'edit',clientId:1,recordId:10,values:{goalDescription:'Updated',percentComplete:'50%'}};
 if(fault==='before'){await assert.rejects(f.helper().updateGoal(update));await assert.rejects(f.helper().updateGoal(update),/unresolved/);}else{await f.helper().updateGoal(update);await f.helper().updateGoal(update);}assert.equal(f.writes(),2);assert.equal(f.goals[0].classification,'Case Plan');
});
test('inactive client prevents a case-plan write and percent values use the actual UI labels',async()=>{
 const f=fixture();await assert.rejects(f.helper().createGoal({...goal(),values:{...goal().values,percentComplete:'50'}}),/UI label/);f.api.clients.get=async()=>({clientId:1,isActive:false});await assert.rejects(f.helper().createClientNote(note()),/Active client/);assert.equal(f.writes(),0);
});
