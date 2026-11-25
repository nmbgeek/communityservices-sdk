import type {Page} from 'playwright-core';
import type {WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
export type ClientSex='Male'|'Female'|"Client doesn't know"|'Client prefers not to answer'|'Data not collected';
/** Fields in Client Profile > Client Record. DOB, legacy Gender and race are separate. */
export interface ClientRecordValues {
 firstName:string;middleName:string;lastName:string;suffix:string;search_alias:string;
 socSecNo:string;nameDataQuality:string;ssnDataQuality:string;veteranStatus:string;sex:ClientSex|'';
}
export interface ClientProfileSnapshot {values:ClientRecordValues;choices:Record<'nameDataQuality'|'ssnDataQuality'|'veteranStatus'|'sex',string[]>;}
export interface ClientProfileUi {
 readonly connection?:import("./connection.mjs").UiConnection;
 inspect(clientId:number):Promise<ClientProfileSnapshot>;
 updateSex(input:{clientId:number;sex:ClientSex;expected:ClientRecordValues;beforeSave:()=>Promise<void>;afterSaveClick?:()=>void}):Promise<ClientProfileSnapshot>;
}
export type ClientProfileChanges=Partial<Omit<ClientRecordValues,'sex'>>&{sex?:ClientSex};
export interface ClientProfileUpdate {clientId:number;key:string;changes:ClientProfileChanges;/** Required for REST changes; Sex uses current UI audit context. */dateEffective?:string;}
export interface ClientProfile {
 read(clientId:number):Promise<ClientProfileSnapshot&{clientId:number}>;
 /** Same key/input/journal reconciles uncertain writes. Never automatically replays an update. */
 update(input:ClientProfileUpdate):Promise<{clientId:number;key:string;outcome:'verified'|'already-present';values:ClientRecordValues}>;
}
export type ProfileDiagnosticField=keyof ClientRecordValues|'svpprofdob'|'svpprofdobtype'|'svpprofgender'|'hud_raceethnicity'|'hud_raceethnicitydetail'|'phone'|'email';
export type ProfileWriteDispatch='read-only'|'dispatched'|'unknown';
export type ProfileFailureReason='REST_READ_FAILED'|'UI_READ_FAILED'|'REST_UI_DISAGREE'|'CHOICE_UNAVAILABLE'|
 'PROTECTED_FIELDS_CHANGED'|'REST_TARGET_MISMATCH'|'UI_TARGET_MISMATCH'|'REST_WRITE_REJECTED'|'REST_WRITE_UNCONFIRMED'|
 'REST_WRITE_NOT_SENT'|'UI_PREPARATION_FAILED'|'UI_SAVE_UNCONFIRMED';
export interface ProfileFailureDiagnostic {
 transport:'rest'|'ui';
 phase:'preflight'|'write'|'readback'|'reconciliation'|'final';
 stage:'unplanned'|'planned'|'rest-attempted'|'rest-verified'|'ui-attempted'|'verified';
 dispatch:ProfileWriteDispatch;
 reason:ProfileFailureReason;
 httpStatus?:number;
 browserFailure?:'timeout'|'session-interrupted'|'browser-error';
}
export interface ProfileWriteDiagnostic extends Omit<ProfileFailureDiagnostic,'reason'|'dispatch'> {
 operation:'clientProfile.update';
 reason:ProfileFailureReason|'REST_VERIFIED'|'PROFILE_VERIFIED';
 nextAction:'none'|'verify-same-key'|'staff-review';
 /** Dispatch evidence for this invocation at the time of the check. */
 writes:{rest:ProfileWriteDispatch;ui:ProfileWriteDispatch};
 firstFailure?:ProfileFailureDiagnostic;
 comparison?:{
  kind:'rest-ui'|'rest-target'|'ui-target';
  intendedFieldsMatch:boolean;
  protectedFieldsMatch:boolean;
 } & ({fieldDetail:'available';differingFields:ProfileDiagnosticField[]}|{fieldDetail:'unavailable'});
}
export function createClientProfile(options:{api:WellSkyClient;ui:ClientProfileUi;store:UiMutationStore;onDiagnostic?:(event:ProfileWriteDiagnostic)=>void}):ClientProfile;
export function createClientProfileUi(options:{page:Page}):ClientProfileUi;
