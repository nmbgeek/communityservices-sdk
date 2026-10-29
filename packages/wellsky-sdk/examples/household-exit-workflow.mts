import type {WellSkyClient,GwtEnrollmentHelpers} from '@choiceapps/communityservices-sdk';
import type {Page} from 'playwright-core';
import {
  createDateOfBirth,createDateOfBirthUi,createEnrollmentWorkflow,createProgramDiscovery,createHouseholdExitUi,
  type EnrollmentReader,type UiMutationStore,type ExitWorkflowDiscovery,
  type EnrollmentAssessmentPlan,type HouseholdExitDetailInput,
} from '@choiceapps/communityservices-sdk/browser';

/** Continue a verified household enrollment in the same durable workflow store.
 * Application policy chooses each member's answers and the records that changed. */
export async function exitHousehold(options:HouseholdExitDetailInput&{
  api:WellSkyClient;page:Page;helpers:GwtEnrollmentHelpers;
  enrollmentSession:EnrollmentReader;store:UiMutationStore;
  sourceExitId:string;sourceEnrollmentId:string;headClientId:number;
  clientIds:number[];providerId:number;exitDate:string;
  destination:string;reasonForLeaving:string;
  buildExitPlan:(clientId:number,definition:ExitWorkflowDiscovery)=>EnrollmentAssessmentPlan;
}){
  const workflow=createEnrollmentWorkflow({
    ...options,birthDates:createDateOfBirth({api:options.api,ui:createDateOfBirthUi({page:options.page}),store:options.store}),discovery:createProgramDiscovery({page:options.page}),
    exitUi:createHouseholdExitUi({page:options.page}),
  });
  const members=[];
  for(const clientId of options.clientIds){
    const definition=await workflow.discoverExit({clientId,providerId:options.providerId,type:'HUD',entryDate:options.exitDate});
    members.push({clientId,assessment:options.buildExitPlan(clientId,definition)});
  }
  return workflow.exitHousehold({
    key:options.sourceExitId,enrollmentKey:options.sourceEnrollmentId,
    headClientId:options.headClientId,exitDate:options.exitDate,
    destination:options.destination,reasonForLeaving:options.reasonForLeaving,members,
    ...(options.destinationDetails?{destinationDetails:options.destinationDetails}:{}),
    ...(options.reasonForLeavingOther?{reasonForLeavingOther:options.reasonForLeavingOther}:{}),
  });
}
