import type {GwtEnrollmentExit,WellSkyClient} from '../dist/esm/index.js';
import type {EntryExitType} from './entry-exit-types.mjs';
import type {EnrollmentReader} from './index.mjs';

export interface MemberEntryDateCohortMember {
 clientId:number;
 enrollmentId:number;
 /** Original start date, retained for every member except the requested target. */
 entryDate:string;
 /** Complete authoritative exit metadata, which must remain unchanged. */
 exit:GwtEnrollmentExit;
}
export interface MemberEntryDateInput {
 clientId:number;
 enrollmentId:number;
 providerId:number;
 type:EntryExitType;
 /** Requested later start date for this one open enrollment. */
 entryDate:string;
 /** Complete current linked cohort, including the target at its original start date. */
 cohort:readonly MemberEntryDateCohortMember[];
}
export class MemberEntryDateInputError extends Error {
 readonly code:'MEMBER_ENTRY_DATE_INPUT_INVALID'|'MEMBER_ENTRY_DATE_TYPE_UNSUPPORTED';
 readonly committed:false;readonly fields:readonly string[];
 constructor(message:string,options?:ErrorOptions&{code?:MemberEntryDateInputError['code'];fields?:readonly string[]});
}
export interface MemberEntryDatePlan {
 providerId:number;type:EntryExitType;entryDate:string;
 memberClientIds:readonly number[];cohortClientIds:readonly number[];
}
export interface MemberEntryDatePort {
 /** Read-only input/capability validation before attachment; no new enrollment IDs exist yet. */
 validateMemberEntryDatePlan(input:MemberEntryDatePlan):void|Promise<void>;
 validateMemberEntryDate(input:MemberEntryDateInput):Promise<void>;
 /** At most one date-only PUT. Caller journals before save and owns uncertain outcomes. */
 saveMemberEntryDate(input:MemberEntryDateInput):Promise<void>;
}
export function createMemberEntryDatePort(options:{
 api:Pick<WellSkyClient,'tenant'|'enrollments'>;
 enrollmentSession:EnrollmentReader;
}):MemberEntryDatePort;
