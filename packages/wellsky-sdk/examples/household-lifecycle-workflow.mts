import type {WellSkyClient,GwtEnrollmentHelpers} from '@choiceapps/communityservices-sdk';
import type {Page} from 'playwright-core';
import {
 createDateOfBirth,createDateOfBirthUi,createEnrollmentWorkflow,createProgramDiscovery,createHouseholdExitUi,
 createMemberEntryDatePort,
 type EnrollmentReader,type UiMutationStore,type EnrollmentAssessmentPlan,
} from '@choiceapps/communityservices-sdk/browser';

/** All members must already belong to the household. The new child's joined date
 * must be on or before their own entry. Application policy builds age-appropriate plans. */
export async function householdLifecycle(options:{
 api:WellSkyClient;page:Page;helpers:GwtEnrollmentHelpers;enrollmentSession:EnrollmentReader;store:UiMutationStore;
 sourceEnrollmentKey:string;headClientId:number;departingMemberId:number;childClientId:number;
 memberExitDate:string;childEntryDate:string;sourceExitKey:string;sourceChildEntryKey:string;
 memberExitPlan:EnrollmentAssessmentPlan;childEntryPlan:EnrollmentAssessmentPlan;
}){
 const workflow=createEnrollmentWorkflow({
  ...options,birthDates:createDateOfBirth({api:options.api,ui:createDateOfBirthUi({page:options.page}),store:options.store}),discovery:createProgramDiscovery({page:options.page}),
  exitUi:createHouseholdExitUi({page:options.page}),
  memberEntryDatePort:createMemberEntryDatePort(options),
 });
 const exit=await workflow.exitHousehold({
  key:options.sourceExitKey,enrollmentKey:options.sourceEnrollmentKey,headClientId:options.headClientId,
  exitDate:options.memberExitDate,destination:'Rental by client, no ongoing housing subsidy',reasonForLeaving:'Completed program',
  members:[{clientId:options.departingMemberId,assessment:options.memberExitPlan}],
 });
 const child=await workflow.addHouseholdMembers({
  key:options.sourceChildEntryKey,enrollmentKey:options.sourceEnrollmentKey,headClientId:options.headClientId,
  entryDate:options.childEntryDate,members:[{clientId:options.childClientId,assessment:options.childEntryPlan}],
 });
 // Later child interims/exits still use sourceEnrollmentKey. The workflow resolves
 // the child's own entry key and date from the durable household journal.
 return {exit,child};
}
