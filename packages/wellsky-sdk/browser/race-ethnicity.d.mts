import type {AnswerValue,EncodingOptions,WellSkyClient} from '../dist/esm/index.js';
import type {EnrollmentReader,UiMutationStore} from './index.mjs';
export interface RaceEthnicityTarget {key:string;clientId:number;assessmentCode:string;effectiveDate:string;}
export interface RaceEthnicityUpdate extends RaceEthnicityTarget {answer:AnswerValue;}
export interface RaceEthnicityResult {
 clientId:number;answerId:number;optionId:number;categoryText:string;
 requestedEffectiveDate:string;
 /** Actual server timestamp. Same-second corrections can create a millisecond revision. */
 effectiveDate:string;
 outcome:'verified'|'reconciled'|'already-present';
}
export class RaceEthnicityError extends Error {readonly code:'RACE_ETHNICITY_CONFLICT';readonly reason:string;constructor(reason:string,options?:ErrorOptions);}
/** Writes and repairs the current race answer. A newer answer or a future date blocks the write. */
export function createRaceEthnicity(options:{
 api:Pick<WellSkyClient,'tenant'|'assessments'>;
 enrollmentSession:EnrollmentReader&Required<Pick<EnrollmentReader,'readRaceEthnicity'>>;
 store:UiMutationStore;writeLabel?:EncodingOptions['writeLabel'];
}):{
 update(input:RaceEthnicityUpdate):Promise<RaceEthnicityResult>;
 /** Preserve the existing selection at this effective second, and populate its missing UI text. */
 repair(input:RaceEthnicityTarget):Promise<RaceEthnicityResult>;
};
