import type {WellSkyClient} from '@choiceapps/communityservices-sdk';
import {
  createDateOfBirth,createDateOfBirthUi,createEnrollmentWorkflow,createProgramDiscovery,
  type EnrollmentAssessmentPlan,type EnrollmentWorkflowDiscovery,
  type HouseholdEnrollmentResult,type EnrollmentReader,type UiMutationStore,
} from '@choiceapps/communityservices-sdk/browser';
import type {GwtEnrollmentHelpers} from '@choiceapps/communityservices-sdk';
import type {Page} from 'playwright-core';

/** The application owns answers and applicability for each person. Reuse the same
 * source keys and durable store when resuming after an interruption. */
export async function enrollHouseholdAndReview(options:{
  api:WellSkyClient;
  page:Page;
  helpers:GwtEnrollmentHelpers;
  enrollmentSession:EnrollmentReader;
  store:UiMutationStore;
  sourceEnrollmentId:string;
  sourceReviewId:string;
  householdId:number;
  headClientId:number;
  clientIds:number[];
  providerId:number;
  entryDate:string;
  reviewDate:string;
  buildEntryPlan:(clientId:number,definition:EnrollmentWorkflowDiscovery)=>EnrollmentAssessmentPlan;
  buildInterimPlan:(clientId:number,definition:EnrollmentWorkflowDiscovery,entry:HouseholdEnrollmentResult)=>EnrollmentAssessmentPlan;
}){
  const workflow=createEnrollmentWorkflow({...options,birthDates:createDateOfBirth({api:options.api,ui:createDateOfBirthUi({page:options.page}),store:options.store}),discovery:createProgramDiscovery({page:options.page})});
  const definitions=new Map<number,EnrollmentWorkflowDiscovery>();
  for(const clientId of options.clientIds)definitions.set(clientId,await workflow.discover({clientId,providerId:options.providerId,type:'HUD',entryDate:options.entryDate}));
  const definitionFor=(clientId:number)=>{const value=definitions.get(clientId);if(!value)throw Error('Member definition missing');return value;};
  const entry=await workflow.createHouseholdEnrollment({
    key:options.sourceEnrollmentId,householdId:options.householdId,headClientId:options.headClientId,
    providerId:options.providerId,type:'HUD',entryDate:options.entryDate,
    members:options.clientIds.map(clientId=>({clientId,assessment:options.buildEntryPlan(clientId,definitionFor(clientId))})),
  });
  const interim=await workflow.createHouseholdInterim({
    key:options.sourceReviewId,enrollmentKey:options.sourceEnrollmentId,headClientId:options.headClientId,reviewDate:options.reviewDate,
    members:options.clientIds.map(clientId=>({clientId,assessment:options.buildInterimPlan(clientId,definitionFor(clientId),entry)})),
  });
  return {entry,interim};
}
