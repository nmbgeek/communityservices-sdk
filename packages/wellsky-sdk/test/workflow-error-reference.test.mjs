import test from 'node:test';
import assert from 'node:assert/strict';
import {collectWorkflowErrors} from '../scripts/workflow-error-reference.mjs';
import {EnrollmentWorkflowError} from '@choiceapps/communityservices-sdk/browser';
const map=`const codes=new Map([['known refusal','KNOWN_REFUSAL']]);function workflowErrorCode(reason){return codes.get(reason)??'WORKFLOW_FAILED';}`;
test('error inventory includes explicit conditional codes and checks both conditional refusal branches',()=>{
 const source=`fail('known refusal');fail(condition?'ROW_ONE':'ROW_TWO','row refused');throw new EnrollmentWorkflowError('specific refusal',{code:condition?'SPECIAL_ONE':'SPECIAL_TWO'});this.code='READ_FAILED';`;
 const codes=collectWorkflowErrors(map,{source}).map(v=>v.code);
 assert.deepEqual(codes,['KNOWN_REFUSAL','READ_FAILED','ROW_ONE','ROW_TWO','SPECIAL_ONE','SPECIAL_TWO','WORKFLOW_FAILED']);
 assert.throws(()=>collectWorkflowErrors(map,{source:`fail(condition?'known refusal':'new refusal');`}),/new refusal/);
 assert.throws(()=>collectWorkflowErrors(map,{source:`throw new EnrollmentWorkflowError(condition?'new refusal':'known refusal');`}),/new refusal/);
});
test('previously generic adoption and verification refusals have specific stable codes',()=>{
 for(const [reason,code]of [['adoption requires the complete linked enrollment cohort','ADOPTION_COMPLETE_COHORT_REQUIRED'],['linked household enrollment requires adoptHouseholdEnrollment','ADOPTION_HOUSEHOLD_REQUIRED'],['verified step changed','VERIFIED_STEP_CHANGED']])assert.equal(new EnrollmentWorkflowError(reason).code,code);
});
