import type {Page} from 'playwright-core';
import type {UiMutationStore} from './index.mjs';
export interface IndependentNeedInput {
 /** Stable upstream event ID. Reuse with identical intent and durable store after failures. */
 key:string;clientId:number;providerId:number;serviceCodeId:number;
 /** Timezone-qualified instant, precision to whole seconds. No REST/mobile offset correction. */
 needDate:string;status:string;outcome:string;reasonUnmet?:string|null;note?:string;amount?:number|null;
}
export interface IndependentNeedValues {clientId:number;providerId:number;serviceCodeId:number;needDate:string;status:string;outcome:string;reasonUnmet:string|null;note:string;amount:number|null;}
export interface IndependentNeedRecord extends IndependentNeedValues {needId:number;serviceCount:number;}
export interface ServiceTypeOption {serviceCodeId:number;code:string;description:string;codeSetId:number;parentServiceCodeId:number|null;}
export interface ServiceTypeCatalog {
 codeSets:{id:number;name:string}[];
 /** Tenant-wide active assignable types. Not provider quicklists or service eligibility. */
 types:ServiceTypeOption[];
}
export interface ServiceQuicklist {
 providerId:number;types:ServiceTypeOption[];
 needOptions:{statuses:{value:string;label:string}[];outcomes:{value:string;label:string}[];unmetReasons:{value:string;label:string}[]};
}
export interface IndependentNeedUi {
 list(context:{clientId:number}):Promise<IndependentNeedRecord[]>;
 /** Adapter must call beforeSave immediately before its one save, never retry the click. */
 create(values:IndependentNeedValues,beforeSave:()=>Promise<void>):Promise<void>;
}
export interface NeedUi extends IndependentNeedUi {
 readonly connection:import("./connection.mjs").UiConnection;
 /** Both services and needs use this AIRS/service-code catalog; client supplies UI context only. */
 listServiceTypes(context:{clientId:number}):Promise<ServiceTypeCatalog>;
 /** Small provider/program quicklist read; does not enumerate the full tenant taxonomy. */
 listServiceQuicklist(context:{clientId:number;providerId:number}):Promise<ServiceQuicklist>;
}
export interface IndependentNeedResult {key:string;need:IndependentNeedRecord;outcome:'verified'|'reconciled'|'already-present';}
export interface NeedRecorder {record(input:IndependentNeedInput):Promise<IndependentNeedResult>;}
export class NeedConflictError extends Error {readonly code:'NEED_CONFLICT';readonly reason:string;constructor(reason:string);}
export function createNeedRecorder(options:{store:UiMutationStore}&({ui:IndependentNeedUi;tenant:string}|{ui:IndependentNeedUi&{readonly connection:import("./connection.mjs").UiConnection};tenant?:string})):NeedRecorder;
export function createNeedUi(options:{page:Page}):NeedUi;
