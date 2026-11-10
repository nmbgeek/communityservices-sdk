import {
 createEnrollmentWorkflow,
 type EnrollmentWorkflowOptions,
 type AdoptEnrollmentInput,
 type AdoptHouseholdEnrollmentInput,
 type ExitEnrollmentInput,
 type HouseholdExitInput,
} from '@choiceapps/communityservices-sdk/browser';

/** Adoption reads WellSky and records its identities locally; it creates no enrollment. */
export async function exitManualEnrollment(
 dependencies:EnrollmentWorkflowOptions,
 existing:AdoptEnrollmentInput,
 exit:Omit<ExitEnrollmentInput,'enrollmentKey'|'clientId'>,
){
 const workflow=createEnrollmentWorkflow(dependencies);
 await workflow.adoptEnrollment(existing);
 return workflow.exitEnrollment({...exit,enrollmentKey:existing.key,clientId:existing.clientId});
}

/** Adopt the complete linked cohort, then exit only the members selected in exit.members. */
export async function exitManualHousehold(
 dependencies:EnrollmentWorkflowOptions,
 existing:AdoptHouseholdEnrollmentInput,
 exit:Omit<HouseholdExitInput,'enrollmentKey'|'headClientId'>,
){
 const workflow=createEnrollmentWorkflow(dependencies);
 await workflow.adoptHouseholdEnrollment(existing);
 return workflow.exitHousehold({...exit,enrollmentKey:existing.key,headClientId:existing.headClientId});
}
