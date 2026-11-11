import {createEnrollmentWorkflow,type EnrollmentWorkflowOptions,type EntryCorrectionInput} from '@choiceapps/communityservices-sdk/browser';

/** The head's explicit target identifies a cohort; ambiguous household matches fail. */
export async function adoptFromHead(dependencies:EnrollmentWorkflowOptions,input:{key:string;headClientId:number;headEnrollmentId:number}){
 const workflow=createEnrollmentWorkflow(dependencies);
 const discovery=await workflow.discoverHouseholdEnrollment({headClientId:input.headClientId,headEnrollmentId:input.headEnrollmentId});
 const adopted=await workflow.adoptHouseholdEnrollment(input);
 return {discovery,adopted};
}

/** Select IDs from an authorized assessment read. The SDK never guesses a row by date/value. */
export async function bindAndCorrectManualRows(
 dependencies:EnrollmentWorkflowOptions,
 input:{registrationKey:string;correction:EntryCorrectionInput;rows:Array<{key:string;parentField:string;recordsetId:number}>},
){
 const workflow=createEnrollmentWorkflow(dependencies),{clientId,enrollmentKey}=input.correction;
 await workflow.registerEntryRows({key:input.registrationKey,clientId,enrollmentKey,rows:input.rows});
 return workflow.correctEntry(input.correction);
}
