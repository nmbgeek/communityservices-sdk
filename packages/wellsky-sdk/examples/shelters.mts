import type {WellSkyClient, GwtEnrollmentHelpers} from '@choiceapps/communityservices-sdk';
import {
  createShelters, readShelterProgram,
  type ShelterUiPort, type UiMutationStore,
  type ShelterCheckInInput, type ShelterCheckoutInput,
} from '@choiceapps/communityservices-sdk/browser';

/** Pass createShelterUi({page: session.page}) from a managed browser session.
 * Prepare program-required assessment answers explicitly before check-in/checkout.
 * Keep this store and the same source keys when reconciling an interrupted operation.
 */
export function shelterWorkflow(api:WellSkyClient, ui:ShelterUiPort, store:UiMutationStore,
  enrollmentHelpers:Pick<GwtEnrollmentHelpers,'addHouseholdMembers'>) {
  return createShelters({api,ui,store,enrollmentHelpers});
}

export async function checkInHousehold(
  workflow:ReturnType<typeof shelterWorkflow>, input:ShelterCheckInInput,
) {
  // Require existing same-program enrollment unless the application explicitly
  // selects create-if-missing for night-by-night. Named beds must be available.
  return workflow.checkIn(input);
}

export async function checkOutHousehold(
  workflow:ReturnType<typeof shelterWorkflow>, input:ShelterCheckoutInput,
) {
  // lastNight is established by the application. checkoutDate must fall on the
  // following calendar day in timeZone. Nightly checkout leaves enrollment open.
  return workflow.checkout(input);
}

export const discoverShelterMode = readShelterProgram;
