import type {Page} from 'playwright-core';
import type {WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
export interface HouseholdMemberInput {clientId:number;relationship:string;dateJoined:string;}
export interface HouseholdMember extends HouseholdMemberInput {head:boolean;dateEnded:string|null;isActive:boolean;}
export interface HouseholdSnapshot {householdId:number;householdType:string;members:HouseholdMember[];}
export interface HouseholdResult {key:string;outcome:'verified'|'already-present';household:HouseholdSnapshot;}
export interface HouseholdUi {
 readonly connection?:import("./connection.mjs").UiConnection;confirmNoHouseholds(clientId:number):Promise<boolean>;}
export interface HouseholdMutation {key:string;householdId:number;headClientId:number;}
export interface Households {
 read(householdId:number):Promise<HouseholdSnapshot>;
 create(input:{key:string;headClientId:number;householdType:string;members:HouseholdMemberInput[]}):Promise<HouseholdResult>;
 addMembers(input:HouseholdMutation&{householdType?:string;members:HouseholdMemberInput[]}):Promise<HouseholdResult>;
 /** Ends household membership only. The head cannot leave an active household. */
 endMembers(input:HouseholdMutation&{clientIds:number[];dateEnded:string}):Promise<HouseholdResult>;
 /** Only non-head relationships may change. */
 updateRelationships(input:HouseholdMutation&{members:{clientId:number;relationship:string}[]}):Promise<HouseholdResult>;
}
export function createHouseholds(options:{api:WellSkyClient;store:UiMutationStore;ui:HouseholdUi}):Households;
export function getHouseholdOptions():{householdTypes:string[];relationships:string[];verifiedOn:string};
export function createHouseholdUi(options:{page:Page}):HouseholdUi;
