export {createPlaywrightEnrollmentHelpers,createPlaywrightGwtSession} from './playwright-session.mjs';
export {openUiSession,LoginError} from './ui-login.mjs';
import {openUiSession} from './ui-login.mjs';
import {createPlaywrightEnrollmentHelpers,createPlaywrightGwtSession} from './playwright-session.mjs';
import {createClientWorkflows} from './client-workflows.mjs';
import {withPageLock} from './page-lock.mjs';
/** Authenticate once, use the same page for all writes, and retain the caller's durable journal. */
export async function openEnrollmentSession({store,...loginOptions}) {
  const session=await openUiSession(loginOptions);
  try {
    const helpers=createPlaywrightEnrollmentHelpers({page:session.page,store,...session.connection});
    const reader=createPlaywrightGwtSession({page:session.page,...session.connection});
    const enrollmentSession={connection:session.connection,readEnrollment:target=>withPageLock(session.page,()=>reader.readEnrollment(target))};
    return Object.assign(session,{helpers,enrollmentSession,workflows:createClientWorkflows({page:session.page,store})});
  }catch(error){await session.close();throw error;}
}
export {createClientWorkflows} from './client-workflows.mjs';
export {AttachmentConflictError} from './attachment-conflict.mjs';
export {createFileGwtMutationStore} from './file-store.mjs';
export {createServiceUi} from './service-ui.mjs';
export {createServiceRecorder} from './service-recording.mjs';
export {getSsvfServiceRules} from './ssvf-rules.mjs';
export {createProgramDiscovery} from './program-discovery.mjs';
export {createEnrollmentWorkflow,EnrollmentWorkflowError} from './enrollment-workflow.mjs';
export {createMemberEntryDatePort} from './member-entry-date.mjs';
export {createHouseholdExitUi} from './household-exit.mjs';

export {SessionInterruptedError} from './session-authentication.mjs';
export {createClientProfile} from './client-profile.mjs';
export {createClientProfileUi} from './client-profile-ui.mjs';
export {createDateOfBirth,validateBirthDate} from './date-of-birth.mjs';
export {createDateOfBirthUi} from './date-of-birth-ui.mjs';
export {createHouseholds,getHouseholdOptions} from './households.mjs';
export {createHouseholdUi} from './households-ui.mjs';
export {createClientCreator} from './client-creation.mjs';
export {createCasePlans} from './case-plans.mjs';
export {createCasePlanUi} from './case-plans-ui.mjs';
export {createNeedRecorder,NeedConflictError} from './need-recording.mjs';
export {createNeedUi} from './need-ui.mjs';
export {createShelters,readShelterProgram,ShelterConflictError} from './shelters.mjs';
export {createShelterUi} from './shelter-ui.mjs';
export {createShelterInventory, ShelterInventoryError} from './shelter-inventory.mjs';

export * from './current-living-situation.mjs';

export {resolveUiConnection} from './connection.mjs';
