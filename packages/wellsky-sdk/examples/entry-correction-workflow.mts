import {
 createEnrollmentWorkflow,
 type EnrollmentWorkflowOptions,
 type EntryCorrectionInput,
} from '@choiceapps/communityservices-sdk/browser';

/** The application supplies explicit answers, clears and original row keys.
 * Dependencies include enrollmentSession and a verified writeLabel resolver.
 * Reuse the original entry store; input.key identifies this correction, while
 * input.enrollmentKey identifies the existing createEnrollment operation. */
export async function correctOriginalEntry(dependencies:EnrollmentWorkflowOptions,input:EntryCorrectionInput){
 const workflow=createEnrollmentWorkflow(dependencies);
 return workflow.correctEntry(input);
}
