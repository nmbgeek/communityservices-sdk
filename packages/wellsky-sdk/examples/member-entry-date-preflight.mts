import {createMemberEntryDatePort,entryExitTypes,type MemberEntryDatePlan,type MemberEntryDatePort,type EnrollmentReader} from '@choiceapps/communityservices-sdk/browser';
import type {WellSkyClient} from '@choiceapps/communityservices-sdk';

/** Default preflight validates all nine UI types before any attachment is sent. */
export function memberDates(api:WellSkyClient,enrollmentSession:EnrollmentReader){
 return {supportedTypes:entryExitTypes,port:createMemberEntryDatePort({api,enrollmentSession})};
}

/** Custom ports must expose read-only pre-attachment validation, even before enrollment IDs exist. */
export function withApplicationPreflight(port:MemberEntryDatePort,validate:(plan:MemberEntryDatePlan)=>void|Promise<void>):MemberEntryDatePort{
 return {...port,async validateMemberEntryDatePlan(plan){await port.validateMemberEntryDatePlan(plan);await validate(plan);}};
}
