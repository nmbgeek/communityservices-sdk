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
 updateSex(input:{clientId:number;sex:ClientSex;expected:ClientRecordValues;beforeSave:()=>Promise<void>}):Promise<ClientProfileSnapshot>;
}
export type ClientProfileChanges=Partial<Omit<ClientRecordValues,'sex'>>&{sex?:ClientSex};
export interface ClientProfileUpdate {clientId:number;key:string;changes:ClientProfileChanges;/** Required for REST changes; Sex uses current UI audit context. */dateEffective?:string;}
export interface ClientProfile {
 read(clientId:number):Promise<ClientProfileSnapshot&{clientId:number}>;
 /** Same key/input/journal reconciles uncertain writes. Never automatically replays an update. */
 update(input:ClientProfileUpdate):Promise<{clientId:number;key:string;outcome:'verified'|'already-present';values:ClientRecordValues}>;
}
export function createClientProfile(options:{api:WellSkyClient;ui:ClientProfileUi;store:UiMutationStore}):ClientProfile;
export function createClientProfileUi(options:{page:Page}):ClientProfileUi;
