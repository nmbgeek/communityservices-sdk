import type {DateOfBirth} from './date-of-birth.mjs';
import type {Answers, AssessmentDefinition, GwtEnrollmentHelpers, Provider, WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore,EnrollmentReader} from './index.mjs';
import type {ProviderAssessmentItem, ProgramDiscovery} from './program-discovery.mjs';
import type {HouseholdExitUi,HouseholdExitDetailInput} from './household-exit.mjs';
import type {MemberEntryDatePort} from './member-entry-date.mjs';

export interface EnrollmentSubassessmentPlan {
  /** Stable source row key, retained across retries. */
  key:string;
  parentField:string;
  answers:Answers;
}
export interface EnrollmentEndDatePlan {
  parentField:string;
  recordsetId:number;
  /** Used to reject an end date before the stored row's start. */
  startDateField:string;
  endDateField:string;
  endDate:string;
}
/** Every editable top-level field needs an answer, subassessment operation,
 * explicit applicability reason, or a nonempty value to carry forward.
 * The application determines applicability and required verification types. */
export interface EnrollmentAssessmentPlan {
  /** SVPPROFDOB requires {value:'YYYY-MM-DD'} and the birthDates dependency. Other date answers remain timestamps. */
  answers?:Answers;
  subassessments?:EnrollmentSubassessmentPlan[];
  endDates?:EnrollmentEndDatePlan[];
  notApplicable?:Record<string,string>;
  carryForward?:string[];
}
export interface EnrollmentDiscoveryInput {
  clientId:number;
  providerId:number;
  type:'HUD'|'VA';
  /** Timezone-qualified timestamp with whole-second precision. */
  entryDate:string;
}
export interface EnrollmentWorkflowDiscovery {
  provider:Provider;
  entry:{assessment:ProviderAssessmentItem;definition:AssessmentDefinition};
  interim:{assessment:ProviderAssessmentItem;definition:AssessmentDefinition};
}
export interface EnrollmentWorkflowInput extends EnrollmentDiscoveryInput {
  key:string;
  assessment:EnrollmentAssessmentPlan;
}
export interface InterimWorkflowInput {
  key:string;
  /** Key of a verified entry in the same durable store and client scope. */
  enrollmentKey:string;
  clientId:number;
  reviewDate:string;
  assessment:EnrollmentAssessmentPlan;
}
export interface EnrollmentWorkflowResult {
  key:string;
  outcome:'verified'|'already-present';
  clientId:number;
  enrollmentId:number;
  assessmentCode:string;
  /** The subassessment plan's stable row keys map to stored recordset IDs. */
  recordsetIds:Record<string,number>;
  effectiveDate:string;
  /** Fresh client API and UI verification of the member's calendar DOB. */
  birthDate?:{clientId:number;dateOfBirth:string;effectiveDate:string};
}
export interface InterimWorkflowResult extends EnrollmentWorkflowResult {reviewId:number;}
export interface ExitWorkflowResult extends EnrollmentWorkflowResult {projectExitDate:string;exitSubgroupId:string;}
export interface ExitWorkflowDiscovery extends EnrollmentWorkflowDiscovery {exit:{assessment:ProviderAssessmentItem;definition:AssessmentDefinition};}
export interface EnrollmentWorkflowStatus {
  key:string;
  kind:'entry'|'interim'|'exit';
  stage:'pending'|'verified';
  assessmentCode:string;
  enrollmentId?:number;
  reviewId?:number;
  projectExitDate?:string;
  exitSubgroupId?:string;
  recordsetIds:Record<string,number>;
  steps:{name:string;state:'attempted'|'verified'}[];
}
export interface EnrollmentWorkflow {
  discover(input:EnrollmentDiscoveryInput):Promise<EnrollmentWorkflowDiscovery>;
  discoverExit(input:EnrollmentDiscoveryInput):Promise<ExitWorkflowDiscovery>;
  createEnrollment(input:EnrollmentWorkflowInput):Promise<EnrollmentWorkflowResult>;
  createInterim(input:InterimWorkflowInput):Promise<InterimWorkflowResult>;
  /** Reads the local journal only. A verified journal is not fresh server verification. */
  getStatus(input:{clientId:number;key:string}):Promise<EnrollmentWorkflowStatus|null>;
  createHouseholdEnrollment(input:HouseholdEnrollmentInput):Promise<HouseholdEnrollmentResult>;
  addHouseholdMembers(input:HouseholdMemberAdditionInput):Promise<HouseholdEnrollmentResult>;
  createHouseholdInterim(input:HouseholdInterimInput):Promise<HouseholdInterimResult>;
  exitHousehold(input:HouseholdExitInput):Promise<HouseholdExitResult>;
  /** Local progress only. Member keys can be passed to getStatus for individual steps. */
  getHouseholdStatus(input:{headClientId:number;key:string}):Promise<HouseholdWorkflowStatus|null>;
}
export interface HouseholdMemberPlan {clientId:number;assessment:EnrollmentAssessmentPlan;}
export interface HouseholdEnrollmentInput extends Omit<EnrollmentDiscoveryInput,'clientId'> {
  key:string;
  /** Existing household with all selected clients already joined at entry. */
  householdId:number;
  headClientId:number;
  /** At least two unique clients, including the head. Order is immaterial. */
  members:HouseholdMemberPlan[];
}
export interface HouseholdMemberAdditionInput {
  key:string;
  /** Stable key of the original verified household enrollment. */
  enrollmentKey:string;
  headClientId:number;
  /** Later than the original entry. Applies to the selected new clients only. */
  entryDate:string;
  /** At least one new client in the existing household, excluding the head. */
  members:HouseholdMemberPlan[];
}
export interface HouseholdInterimInput {
  key:string;
  enrollmentKey:string;
  headClientId:number;
  reviewDate:string;
  /** Nonempty selected subset of the enrolled cohort, including a singleton. The head may be excluded. */
  members:HouseholdMemberPlan[];
}
export interface HouseholdExitInput extends HouseholdExitDetailInput {
  key:string;
  enrollmentKey:string;
  headClientId:number;
  exitDate:string;
  /** Exact available labels from exitUi.listOptions. Shared only by selected members. */
  destination:string;
  reasonForLeaving:string;
  /** Nonempty selected subset of the enrolled cohort, including a singleton. The head may be excluded.
   * Assessment answers remain per person; unselected enrollments and exits are preserved. */
  members:HouseholdMemberPlan[];
}
export interface HouseholdEnrollmentResult {
  key:string;
  outcome:'verified'|'already-present';
  householdId:number;
  headClientId:number;
  members:EnrollmentWorkflowResult[];
}
export interface HouseholdInterimResult extends Omit<HouseholdEnrollmentResult,'members'> {members:InterimWorkflowResult[];}
export interface HouseholdExitResult extends Omit<HouseholdEnrollmentResult,'members'> {members:ExitWorkflowResult[];}
export interface HouseholdWorkflowStatus {
  key:string;
  kind:'entry'|'addition'|'interim'|'exit';
  stage:'pending'|'verified';
  householdId:number;
  headClientId:number;
  members:Array<{clientId:number;key:string}&Partial<Omit<InterimWorkflowResult&ExitWorkflowResult,'clientId'|'key'>>>;
}
export interface EnrollmentWorkflowOptions {
  api:Pick<WellSkyClient,'tenant'|'clients'|'providers'|'enrollments'|'assessments'|'assessmentsMobile'|'subassessments'>&Partial<Pick<WellSkyClient,'households'>>;
  discovery:Pick<ProgramDiscovery,'getProviderAssessments'>;
  helpers:Pick<GwtEnrollmentHelpers,'createInterimUpdate'>&Partial<Pick<GwtEnrollmentHelpers,'addHouseholdMembers'>>;
  store:UiMutationStore;
  /** Required for SVPPROFDOB answers or carry-forward. Share this workflow's durable store. */
  birthDates?:DateOfBirth;
  /** Required, along with api.households and helpers.addHouseholdMembers, for household operations. */
  enrollmentSession?:EnrollmentReader;
  /** Required for exitHousehold; the workflow owns its durable write journal. */
  exitUi?:HouseholdExitUi;
  /** Required to set the later entry date for newly attached household members. */
  memberEntryDatePort?:MemberEntryDatePort;
}
export class EnrollmentWorkflowError extends Error {
  readonly reason:string;
  constructor(reason:string);
}
/** Tenant-configured. Retain stable keys and one durable store for all cooperating writers.
 * A partial or uncertain write requires reconciliation; no automatic write replay occurs. */
export function createEnrollmentWorkflow(options:EnrollmentWorkflowOptions):EnrollmentWorkflow;
