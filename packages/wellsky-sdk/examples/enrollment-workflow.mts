import {
  createEnrollmentWorkflow,
  type EnrollmentAssessmentPlan,
  type EnrollmentWorkflowDiscovery,
  type EnrollmentWorkflowResult,
  type EnrollmentWorkflowOptions,
} from '@choiceapps/communityservices-sdk/browser';

/** Call with a REST client, authenticated discovery/enrollment adapters,
 * a birthDates adapter for DOB plans, and the same durable store on every run. This example does not log in or run itself. */
export async function enrollAndReview(
  dependencies:EnrollmentWorkflowOptions,
  input:{
    clientId:number;
    providerId:number;
    type:'HUD'|'VA';
    /** Stable application record ID, not a new UUID on each retry. */
    sourceId:string;
    entryDate:string;
    reviewDate:string;
    buildEntryPlan:(catalog:EnrollmentWorkflowDiscovery)=>EnrollmentAssessmentPlan;
    buildInterimPlan:(entry:EnrollmentWorkflowResult,catalog:EnrollmentWorkflowDiscovery)=>EnrollmentAssessmentPlan;
  },
) {
  const workflow=createEnrollmentWorkflow(dependencies);
  const context={clientId:input.clientId,providerId:input.providerId,type:input.type,entryDate:input.entryDate};
  const catalog=await workflow.discover(context);
  // Render catalog.entry/interim.definition in the application's intake form.
  // Plans must explicitly cover applicable fields and all required verification types.
  const enrollmentKey=`${input.sourceId}:entry`;
  const entry=await workflow.createEnrollment({
    ...context,key:enrollmentKey,assessment:input.buildEntryPlan(catalog),
  });
  // Use entry.recordsetIds and the discovered startDateField/endDateField names
  // when ending a changed verification row. Carry forward
  // unchanged groups instead of adding copies. End the old row on the prior day.
  // On a rejected operation, call workflow.getStatus({clientId, key}) with that
  // operation's original key. Inspect the attempted steps before retrying the
  // same intent. Never remove the journal or generate a fresh key to bypass it.
  const interim=await workflow.createInterim({
    key:`${input.sourceId}:interim:${input.reviewDate}`,enrollmentKey,
    clientId:input.clientId,reviewDate:input.reviewDate,
    assessment:input.buildInterimPlan(entry,catalog),
  });
  return {entry,interim};
}
