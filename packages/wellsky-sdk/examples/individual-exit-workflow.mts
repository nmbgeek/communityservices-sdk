import {
  createEnrollmentWorkflow,
  type EnrollmentWorkflowOptions,
  type ExitEnrollmentInput,
  type ExitEnrollmentResult,
} from '@choiceapps/communityservices-sdk/browser';

/** Supply enrollmentSession and exitUi, and the durable store containing the
 * verified createEnrollment operation identified by input.enrollmentKey.
 * Build input.assessment from workflow.discoverExit before calling this function. */
export async function exitIndividualEnrollment(
  dependencies:EnrollmentWorkflowOptions,
  input:ExitEnrollmentInput,
):Promise<ExitEnrollmentResult> {
  return createEnrollmentWorkflow(dependencies).exitEnrollment(input);
}
