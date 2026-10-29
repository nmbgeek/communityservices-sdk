import { GwtEnrollmentHelpers, type GwtEnrollmentSession, type GwtMutationStore } from "@choiceapps/communityservices-sdk";

/** Supply a trusted authenticated browser adapter and a shared durable journal.
 * prepare() must capture/serialize inside this call and prevent the original UI request from being sent.
 * readEnrollment() must return complete fresh GWT state, including every review and household member.
 * See docs/browser-session.md for the adapter contract. */
export async function updateSyntheticHousehold(session: GwtEnrollmentSession, store: GwtMutationStore, input: {tenant:string;moduleBaseUrl:string;clientId:number;enrollmentId:number;memberClientIds:number[];reviewDate:string}) {
  const helpers = new GwtEnrollmentHelpers({
    tenant: input.tenant,
    moduleBaseUrl: input.moduleBaseUrl,
    session,
    store,
  });
  const membership = await helpers.addHouseholdMembers({ clientId: input.clientId, enrollmentId: input.enrollmentId, memberClientIds: input.memberClientIds });
  const interim = await helpers.createInterimUpdate({ clientId: input.clientId, enrollmentId: input.enrollmentId, clientIds: [input.clientId, ...input.memberClientIds], reviewDate: input.reviewDate });
  return { membership, interim }; // Reuse the same target, dates and journal when retrying.
}
