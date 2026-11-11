import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@choiceapps/communityservices-sdk';
const tenant='synthetic',option=(id,code,name)=>({id,code,name,picklistId:7,picklistCode:'CHOICES',displayOrder:id,hudVisibility:0});
const hud=option(10,'YES_HUD','Yes '),plain=option(11,'YES','Yes');
const q={questionId:1,fieldName:'ANSWER',questionType:'lookup',options:[hud,plain],children:[]},definition={tenant,questions:[q]};
const catalog=()=>({source:'gwt-rpc',tenant,clientId:1,count:2,values:[{optionId:10,picklistId:7,code:'YES_HUD',name:'Yes (HUD)'},{optionId:11,picklistId:7,code:'YES',name:'Yes'}]});
test('catalog labels resolve unanswered HUD and non-HUD choices by identity',()=>{
 const writeLabel=sdk.createCatalogWriteLabelResolver(definition,catalog());
 assert.equal(writeLabel(q,hud),'Yes (HUD)');assert.equal(writeLabel(q,plain),'Yes');
 assert.equal(sdk.encodeAnswers([q],{ANSWER:{option:{code:'YES_HUD'}}},{endpoint:'standalone',writeLabel})[0].answer_value,'Yes (HUD)');
 assert.equal(writeLabel(q,{...hud,name:'Changed'}),undefined);assert.equal(writeLabel(q,option(12,'OTHER','Yes ')),undefined);
 assert.equal(writeLabel.tenant,tenant);assert.equal(Object.isFrozen(writeLabel),true);
});
test('catalog resolver refuses missing, duplicate, foreign or mismatched identity evidence',()=>{
 for(const change of [c=>c.tenant='other',c=>c.count=1,c=>c.values.pop(),c=>c.values[1]={...c.values[0]},c=>c.values[0].picklistId=99,c=>c.values[0].code='WRONG',c=>c.values[0].name='',c=>c.source='rest']){
  const c=catalog();change(c);assert.throws(()=>sdk.createCatalogWriteLabelResolver(definition,c));
 }
});
test('resolver excludes catalog extras and retains an immutable exact-label snapshot',()=>{
 const c=catalog();c.values.push({optionId:12,picklistId:7,code:'EXTRA',name:'Extra'});c.count++;
 const writeLabel=sdk.createCatalogWriteLabelResolver(definition,c);c.values[0].name='Changed';assert.equal(writeLabel(q,hud),'Yes (HUD)');assert.equal(writeLabel(q,option(12,'EXTRA','Extra')),undefined);
});
