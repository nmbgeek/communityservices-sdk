import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadBackWriteLabelResolver,encodeAnswers} from '@choiceapps/communityservices-sdk';

const tenant='synthetic-tenant';
const option=(id,name)=>({id,name,code:String(id),picklistId:1,picklistCode:'TEST',displayOrder:id,hudVisibility:0});
const question={questionId:10,fieldName:'LIVING',questionType:'lookup',options:[option(1,'Rental by client, no ongoing housing subsidy '),option(2,'Two to six nights'),option(3,'Unobserved ')],children:[]};
const definition={tenant,questions:[question]};
const read=(id,label)=>({question_id:10,virt_field_name:'LIVING',question_type:'lookup',answer_value:String(id),answer_value_text:label});
test('readback resolver preserves exact HUD and non-HUD labels with identical visibility flags',()=>{
 const writeLabel=createReadBackWriteLabelResolver(definition,[{tenant,response:[read(1,'Rental by client, no ongoing housing subsidy (HUD)'),read(2,'Two to six nights')]}]);
 assert.equal(writeLabel(question,question.options[0]),'Rental by client, no ongoing housing subsidy (HUD)');assert.equal(writeLabel(question,question.options[1]),'Two to six nights');
 assert.equal(encodeAnswers([question],{LIVING:{option:{code:'1'}}},{endpoint:'standalone',writeLabel})[0].answer_value,'Rental by client, no ongoing housing subsidy (HUD)');
 assert.equal(writeLabel(question,question.options[2]),undefined);assert.throws(()=>encodeAnswers([question],{LIVING:{option:{code:'3'}}},{endpoint:'standalone',writeLabel}),/validation/);
});
test('resolver refuses conflicting evidence, other tenants and changed option identities',()=>{
 assert.throws(()=>createReadBackWriteLabelResolver(definition,[{tenant:'other',response:read(1,'Label')}]),/validation/);
 assert.throws(()=>createReadBackWriteLabelResolver(definition,[{tenant,response:[read(1,'Label'),read(1,'Different')]}]),/validation/);
 assert.throws(()=>createReadBackWriteLabelResolver(definition,[{tenant,response:read(99,'Unknown')}]),/validation/);
 const resolve=createReadBackWriteLabelResolver(definition,[{tenant,response:{value:[read(1,'Exact  (HUD) ')]}}]);assert.equal(resolve(question,question.options[0]),'Exact  (HUD) ');assert.equal(resolve(question,{...question.options[0],name:'Changed'}),undefined);
});
test('nested observations resolve labels without changing metadata or retaining unrelated answer fields',()=>{
 const before=structuredClone(definition),resolve=createReadBackWriteLabelResolver(definition,[{tenant,response:[{sub_assessment_answer_list:[{recordset_id:4,sub_assessment_list:[{...read(1,'Full (HUD)'),privateNote:'not a label'}]}]}]}]);
 assert.equal(resolve(question,question.options[0]),'Full (HUD)');assert.deepEqual(definition,before);
});
