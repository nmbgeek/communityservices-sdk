import test from 'node:test';
import assert from 'node:assert/strict';
import { WellSkyClient, encodeAnswers, buildAssessmentDefinition } from '../dist/esm/index.js';
import { WellSkyClient as V2Client } from '../dist/esm/v2.js';
const catalog = [
  [1,'RACE_ETH_WHI','White'],[2,'RACE_ETH_HSP','Hispanic/Latina/o'],[3,'RACE_ETH_PI','Native Hawaiian or Pacific Islander'],
  [4,'RACE_ETH_DONTKNOW',"Client doesn't know"],[5,'RACE_ETH_REFUSE','Client prefers not to answer'],[6,'RACE_ETH_DNC','Data not collected'],
  [101,'RACE_ETH_COMBO_WHI','White'],[102,'RACE_ETH_COMBO_HSP','Hispanic/Latina/o'],[103,'RACE_ETH_COMBO_PI','Native Hawaiian or Pacific Islander'],
  [104,'RACE_ETH_COMBO_DK',"Client doesn't know"],[105,'RACE_ETH_COMBO_R','Client prefers not to answer'],[106,'RACE_ETH_COMBO_DNC','Data not collected'],
  [200,'RACE_ETH_COMBO_HSP_PI','Hispanic/Latina/o; Native Hawaiian or Pacific Islander']
].map(([picklist_value_id,code,name])=>({picklist_value_id,code,name,picklist_id:88}));
const questions=(options=catalog,field='HUD_RACEETHNICITY')=>buildAssessmentDefinition({tenant:'synthetic',assessmentCode:'SYNTHETIC',mobile:[{question_id:90,virt_field_name:field,question_type:'lookup',picklist_id:88,picklist_value_list:options}],generic:[]}).questions;
const encode=(answer,options=catalog,extra={})=>encodeAnswers(questions(options),{HUD_RACEETHNICITY:answer},{endpoint:'mobile',...extra})[0].answer_value;
test('race single-category names and legacy codes resolve to tenant combination IDs',()=>{
 for(const answer of [{option:{code:'RACE_ETH_WHI'}},{option:{code:'RACE_ETH_COMBO_WHI'}},{option:{name:' White '}},{value:'White'}])assert.equal(encode(answer),'101');
 assert.equal(encode({option:{code:'RACE_ETH_WHI'}},catalog.map(o=>({...o,picklist_value_id:o.picklist_value_id+1000}))),'1101');
});
test('race categories combine in canonical order, deduplicate and preserve endpoint-specific labels',()=>{
 const answer={options:[{code:'RACE_ETH_PI'},{code:'RACE_ETH_HSP'},{code:'RACE_ETH_PI'}]};assert.equal(encode(answer),'200');
 assert.equal(encode({value:['Native Hawaiian or Pacific Islander','Hispanic/Latina/o']}),'200');
 assert.equal(encode({options:[{code:'RACE_ETH_COMBO_HSP_PI'},{code:'RACE_ETH_PI'}]}),'200');
 let selected;assert.equal(encode(answer,catalog,{endpoint:'standalone',writeLabel:(_q,o)=>{selected=o;return 'verified label';}}),'verified label');assert.equal(selected.code,'RACE_ETH_COMBO_HSP_PI');
});
test('race missing-answer states resolve safely and reject incomplete or conflicting selections',()=>{
 for(const [code,id]of [['DONTKNOW','104'],['REFUSE','105'],['DNC','106']])assert.equal(encode({option:{code:`RACE_ETH_${code}`}}),id);
 assert.equal(encode({state:'client_refused'},catalog,{stateCodes:{client_refused:['RACE_ETH_REFUSE']}}),'105');
 assert.throws(()=>encode({options:[{code:'RACE_ETH_DNC'},{code:'RACE_ETH_WHI'}]}),{name:'ValidationError'});
 assert.throws(()=>encode({options:[]}),{name:'ValidationError'});
 assert.throws(()=>encode({option:{code:'RACE_ETH_WHI'}},catalog.filter(o=>o.code!=='RACE_ETH_COMBO_WHI')),{name:'UnknownPicklistValueError'});
 assert.throws(()=>encode({option:{code:'UNKNOWN',name:'White'}}),{name:'UnknownPicklistValueError'});
});
test('race normalization never changes unrelated lookup fields',()=>{
 assert.equal(encodeAnswers(questions(catalog,'OTHER'),{OTHER:{option:{code:'RACE_ETH_WHI'}}},{endpoint:'mobile'})[0].answer_value,'1');
 assert.throws(()=>encodeAnswers(questions(catalog,'OTHER'),{OTHER:{options:[{code:'RACE_ETH_WHI'}]}},{endpoint:'mobile'}),{name:'ValidationError'});
});
const base={tenant:'synthetic',auth:{kind:'none'},maxReadRetries:0};
const path={clientId:123,assessmentCode:'SYNTHETIC'};
const body=[{question_id:1,question_type:'date',virt_field_name:'START',answer_value:'2026-10-18T16:00:00Z'}];
for(const Client of [WellSkyClient,V2Client]){
 const version=Client===V2Client?'V2':'V3';
 test(`${version}: corrected mobile dates preserve input instants across offsets, seasons and midnight`,async()=>{
  const calls=[];const client=new Client({...base,mobileAssessmentDateCorrectionMinutes:420,fetch:async(url,init)=>{calls.push({url:new URL(url),body:JSON.parse(init.body)});return new Response('[]');}});
  for(const [input,expected]of [['2026-10-18T16:00:00Z','2026-10-18T23:00:00.000Z'],['2026-10-18T12:00:00-04:00','2026-10-18T23:00:00.000Z'],['2026-01-10T17:00:00Z','2026-01-11T00:00:00.000Z'],['2026-07-10T23:30:00.123Z','2026-07-11T06:30:00.123Z']]){
   const args={path,query:{dateEffective:input},body};await client.assessmentsMobile.addAnswer(args);assert.equal(calls.at(-1).url.searchParams.get('dateEffective'),expected);assert.deepEqual(calls.at(-1).body,body);assert.equal(args.query.dateEffective,input);
  }
 });
 test(`${version}: standalone writes, reads, omitted dates and unconfigured raw writes stay unchanged`,async()=>{
  const calls=[];const fetch=async url=>{calls.push(new URL(url));return new Response('[]');};const client=new Client({...base,mobileAssessmentDateCorrectionMinutes:420,fetch});
  await client.assessments.create({path,query:{dateEffective:'2026-10-18T16:00:00Z'},body});await client.assessments.get({path,query:{dateEffective:'2026-10-18T16:00:00Z'}});await client.assessmentsMobile.addAnswer({path,body});
  assert.deepEqual(calls.map(u=>u.searchParams.get('dateEffective')),['2026-10-18T16:00:00Z','2026-10-18T16:00:00Z',null]);
  await new Client({...base,fetch}).assessmentsMobile.addAnswer({path,query:{dateEffective:'2026-10-18T16:00:00Z'},body});assert.equal(calls.at(-1).searchParams.get('dateEffective'),'2026-10-18T16:00:00Z');
 });
 test(`${version}: invalid corrected dates fail before authentication or network`,async()=>{
  const client=new Client({...base,auth:{kind:'credentials',username:'synthetic',password:'synthetic'},mobileAssessmentDateCorrectionMinutes:420,fetch:async()=>{assert.fail('must not send');}});
  for(const dateEffective of ['2026-10-18','2026-10-18T16:00:00','2026-02-30T12:00:00Z','2026-10-18T24:00:00Z','2026-10-18T12:00:00+14:01','not-a-date'])await assert.rejects(client.assessmentsMobile.addAnswer({path,query:{dateEffective},body}),e=>e.name==='ValidationError'&&e.fields.includes('dateEffective'));
  for(const n of [NaN,Infinity,1.5,841,-841])assert.throws(()=>new Client({...base,mobileAssessmentDateCorrectionMinutes:n}),{name:'ValidationError'});
 });
}
