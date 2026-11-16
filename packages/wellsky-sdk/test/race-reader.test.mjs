import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPlaywrightGwtSession} from '@choiceapps/communityservices-sdk/browser';
import {decodeRaceDemographics} from '../browser/gwt-race.mjs';
import {raceWire} from './race-wire-fixture.mjs';
const base='https://wscs.wellsky.com/tenant-b/com.bowmansystems.sp5.core.ServicePoint/';
function reader(body=raceWire,status=200){
 const events=new EventEmitter(),calls=[];
 const page={url:()=>base+'index.html#loadClient;clientId=1',setDefaultTimeout(){},locator:()=>({count:async()=>0}),getByText:()=>({isVisible:async()=>true}),waitForFunction:async()=>{},on:events.on.bind(events),off:events.off.bind(events),getByRole:()=>({click:async()=>events.emit('request',{url:()=>base+'service/MetaQueryService',postData:()=>`7|0|9|${base}|CURRENT_POLICY|`,allHeaders:async()=>({'content-type':'text/x-gwt-rpc','x-gwt-module-base':base,'x-gwt-permutation':'CURRENT_PERMUTATION'})})}),evaluate:async(_,request)=>{calls.push(request);return {status,body};}};
 return {calls,read:target=>createPlaywrightGwtSession({page,tenant:'tenant-b',moduleBaseUrl:base}).readRaceEthnicity(target??{clientId:1,questionId:90})};
}
test('raw demographic decoder retains blank UI text despite a valid lookup',()=>{
 const good=decodeRaceDemographics(raceWire);assert.equal(good.clientId,1);assert.equal(good.questionId,90);assert.equal(good.optionId,11);assert.equal(good.categoryText,'WHI');
 const blank=decodeRaceDemographics(raceWire.replace('"WHI"','""'));assert.equal(blank.optionId,11);assert.equal(blank.categoryText,'');
});
test('reader uses a fresh demographic RPC, checks identity, and never uses normalized history',async()=>{
 const f=reader(),s=await f.read();assert.equal(s.answers[0].categoryText,'WHI');assert.equal(s.answers[0].optionId,11);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,base+'service/ClientService');assert.match(f.calls[0].body,/\|getBasicClientDemographicInfo\|/);assert.match(f.calls[0].body,/\|CURRENT_POLICY\|/);assert.doesNotMatch(f.calls[0].body,/getClientQuestionAnswers/);
 await assert.rejects(reader().read({clientId:1,questionId:91}),/identity mismatch/);
 await assert.rejects(reader(raceWire,500).read(),/read failed/);
});
test('schema drift, wrong fields, malformed responses and history DTOs fail closed',()=>{
 for(const body of [raceWire.replace('DaAnswer/2864568370','DaAnswer/1'),raceWire.replace('HUD_RACEETHNICITY','OTHER'),raceWire.replace('DaAnswer/2864568370','AssessmentAnswer/3353818850'),'//EX[]','//OK[]','not GWT'])assert.throws(()=>decodeRaceDemographics(body));
 const empty='//OK[0,0,0,0,0,5,1,["[Lcom.bowmansystems.sp5.model.client.DaAnswer;/1756264905"],0,7]';assert.equal(decodeRaceDemographics(empty),null);
});
