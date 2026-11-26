import {
  createEnrollmentWorkflow,
  EnrollmentWorkflowError,
  type EntryExitType,
  type EnrollmentAssessmentPlan,
  type EnrollmentWorkflowDiscovery,
  type EnrollmentWorkflowResult,
  type EnrollmentWorkflowOptions,
} from '@choiceapps/communityservices-sdk/browser';

/** Call with a REST client, authenticated discovery/enrollment adapters,
 * a birthDates adapter for DOB plans, and the same durable store on every run.
 * Types other than HUD/VA require dependencies.assessmentLocations from current provider discovery.
 * This example does not log in or run itself. */
export async function enrollAndReview(
  dependencies:EnrollmentWorkflowOptions,
  input:{
    clientId:number;
    providerId:number;
    type:EntryExitType;
    /** Stable application record ID, not a new UUID on each retry. */
    sourceId:string;
    entryDate:string;
    reviewDate:string;
    buildEntryPlan:(catalog:EnrollmentWorkflowDiscovery)=>EnrollmentAssessmentPlan;
    buildInterimPlan:(entry:EnrollmentWorkflowResult,catalog:EnrollmentWorkflowDiscovery)=>EnrollmentAssessmentPlan;
  },
) {
  const workflow=createEnrollmentWorkflow(dependencies);
  // Configure metadataCache according to the application's rollout for new operations.
  async function workerFor(key:string) {
    const status=await workflow.getStatus({clientId:input.clientId,key});
    if (status?.durableDiscovery && !dependencies.metadataCache) {
      throw new Error('Restore the original metadata cache to resume this operation');
    }
    if (status && !status.durableDiscovery && dependencies.metadataCache) {
      const {metadataCache,...legacyOptions}=dependencies;
      return createEnrollmentWorkflow(legacyOptions);
    }
    return workflow;
  }
  const context={clientId:input.clientId,providerId:input.providerId,type:input.type,entryDate:input.entryDate};
  const enrollmentKey=`${input.sourceId}:entry`;
  const entryWorker=await workerFor(enrollmentKey);
  const catalog=await entryWorker.discover(context);
  // Render catalog.entry/interim.definition in the application's intake form.
  // Plans must explicitly cover applicable fields and all required verification types.
  const entry=await entryWorker.createEnrollment({
    ...context,key:enrollmentKey,assessment:{...input.buildEntryPlan(catalog), ...(catalog.schemaRevision ? {schemaRevision:catalog.schemaRevision} : {})},
  });
  // Use entry.recordsetIds and the discovered startDateField/endDateField names
  // when ending a changed verification row. Carry forward
  // unchanged groups instead of adding copies. End the old row on the prior day.
  // On a rejected operation, call workflow.getStatus({clientId, key}) with that
  // operation's original key. Inspect the attempted steps before retrying the
  // same intent. Never remove the journal or generate a fresh key to bypass it.
  const reviewKey=`${input.sourceId}:interim:${input.reviewDate}`;
  const reviewWorker=await workerFor(reviewKey);
  const reviewCatalog=await reviewWorker.discover({...context,entryDate:input.reviewDate});
  const interim=await reviewWorker.createInterim({
    key:reviewKey,enrollmentKey,
    clientId:input.clientId,reviewDate:input.reviewDate,
    assessment:{...input.buildInterimPlan(entry,reviewCatalog), ...(reviewCatalog.schemaRevision ? {schemaRevision:reviewCatalog.schemaRevision} : {})},
  });
  return {entry,interim};
}

/** Use this on enrollment failures to route a verified blank DOB to staff. */
export function needsEntryBirthDateReview(error:unknown):boolean {
  return error instanceof EnrollmentWorkflowError &&
    (error.operation==='createEnrollment'||error.operation==='createHouseholdEnrollment') &&
    error.code==='DOB_HISTORICAL_BACKFILL_UNSUPPORTED' &&
    error.dobHistoryReason==='blank-at-effective-date' && error.nextAction==='staff-review';
}
