import type {Page} from 'playwright-core';
import type {WellSkyClient,ServiceAddViewModel} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
import type {SsvfInformation} from './ssvf-rules.mjs';
export interface ServiceUiContext {clientId:number;serviceId:number;providerId:number;serviceNote?:string;}
export interface FundingSourceOption {fundId:number;fundCycleId:number;name:string;description:string|null;remainingBalance:number|null;submissionDeadline:string|null;}
export interface FundingAllocation {fundId:number;fundCycleId:number;name:string;amount:number;}
export interface ServiceUiDetails {financialAssistancePeriod?:{start:string;end:string}|null;fundingSources:FundingAllocation[];ssvfInformation?:SsvfInformation;}
export interface ServiceUiSnapshot {
 /** Visible SSVF controls, verified separately from REST readback. */
 ssvfInformation?:Record<string,string|number>;
 needStatus:string|null;needOutcome:string|null;serviceStart:string|null;serviceEnd:string|null;
 financialAssistancePeriod:{start:string|null;end:string|null};timezone:string;
 fundingSources:(FundingAllocation&{allocationId:number})[];
}
export interface ServiceUi {
 readonly connection?:import("./connection.mjs").UiConnection;
 assertReady():Promise<void>;
 inspect(context:ServiceUiContext):Promise<ServiceUiSnapshot>;
 matches(snapshot:ServiceUiSnapshot,expected:ServiceUiDetails):boolean;
 complete(context:ServiceUiContext,expected:ServiceUiDetails,beforeSave:()=>Promise<void>):Promise<ServiceUiSnapshot>;
 /** Read-only context supplies the current UI query/policy. Overrides filter choices before creating a service. */
 listFundingSources(input:{context:ServiceUiContext;providerId?:number;serviceCodeId?:number}):Promise<FundingSourceOption[]>;
}
export interface ServiceRecordInput {
 /** Stable source row identifier, never a batch position or randomly regenerated retry key. */
 key:string;
 body:Omit<Pick<ServiceAddViewModel,'clientId'|'serviceProvider'|'serviceCode'|'serviceStartDate'|'serviceEndDate'|'serviceNote'|'serviceCosts'>,'serviceEndDate'>&{
  serviceEndDate:string;needStatus?:'Closed';
  ssvfInformation?:SsvfInformation;
 };
 /** Required when ssvfFinancialAssistanceType is supplied; rejected otherwise. */
 financialAssistancePeriod?:{start:string;end:string};
 fundingSources?:FundingAllocation[];
}
export interface ServiceRecordResult {key:string;outcome:'verified'|'already-present';serviceId:number;needId:number;ui:ServiceUiSnapshot;}
export interface RecoveryDiagnostic {name:string;code?:string;kind?:string;stage?:string;recoveryStage?:string;operation?:string;requestId?:string;correlationId?:string;status?:number;retryAfterMs?:number;reauthenticated?:boolean;cause?:RecoveryDiagnostic;}
export type ServiceBulkResult = {index:number;key:string;outcome:'fulfilled';value:ServiceRecordResult}|{index:number;key:string;outcome:'rejected';message:string;error:RecoveryDiagnostic}|{index:number;key:string;outcome:'skipped'};
export interface ServiceRecorder {
 record(input:ServiceRecordInput):Promise<ServiceRecordResult>;
 /** Sequential UI saves; stops at first failed row. Retry with the same keys/store to reconcile. */
 recordBulk(inputs:ServiceRecordInput[],options?:{signal?:AbortSignal;onResult?:(result:ServiceBulkResult)=>void|Promise<void>}):Promise<{results:ServiceBulkResult[];callbackFailed:boolean}>;
}
export function createServiceRecorder(options:{api:WellSkyClient;ui:ServiceUi;store:UiMutationStore}):ServiceRecorder;
export function createServiceUi(options:{page:Page}):ServiceUi;
