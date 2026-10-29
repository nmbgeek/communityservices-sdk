import type {GwtEnrollmentExit,WellSkyClient} from '../dist/esm/index.js';
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
 type:'HUD'|'VA';
 /** Requested later start date for this one open enrollment. */
 entryDate:string;
 /** Complete current linked cohort, including the target at its original start date. */
 cohort:readonly MemberEntryDateCohortMember[];
}
export interface MemberEntryDatePort {
 validateMemberEntryDate(input:MemberEntryDateInput):Promise<void>;
 /** At most one date-only PUT. Caller journals before save and owns uncertain outcomes. */
 saveMemberEntryDate(input:MemberEntryDateInput):Promise<void>;
}
export function createMemberEntryDatePort(options:{
 api:Pick<WellSkyClient,'tenant'|'enrollments'>;
 enrollmentSession:EnrollmentReader;
}):MemberEntryDatePort;
