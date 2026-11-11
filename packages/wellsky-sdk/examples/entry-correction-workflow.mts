import {
 createEnrollmentWorkflow,
 type EnrollmentWorkflowOptions,
 type EntryCorrectionInput,
  type ResolveEntryCorrectionInput,
} from '@choiceapps/communityservices-sdk/browser';

/** The application supplies explicit answers, clears and original row keys.
 * Dependencies include enrollmentSession and a verified writeLabel resolver.
 * Reuse the original entry store; input.key identifies this correction, while
 * input.enrollmentKey identifies the existing createEnrollment operation. */
export async function correctOriginalEntry(dependencies:EnrollmentWorkflowOptions,input:EntryCorrectionInput){
 const workflow=createEnrollmentWorkflow(dependencies);
 return workflow.correctEntry(input);
}

/** The confirmation callback must use independent server or administrative evidence.
 * The SDK also checks the complete pre-write state before and after that callback.
 * Retain the rejected key; submit a corrected request under a new key afterward. */
export async function resolveRejectedCorrection(dependencies:EnrollmentWorkflowOptions,input:ResolveEntryCorrectionInput){
 return createEnrollmentWorkflow(dependencies).resolveEntryCorrection(input);
}
