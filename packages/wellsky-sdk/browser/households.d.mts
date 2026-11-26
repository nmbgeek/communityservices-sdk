import type {Page} from 'playwright-core';
import type {WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
export interface HouseholdMembershipInput {
 clientId:number;dateJoined:string;
 /** Ignored in membership-only reuse. */
 relationship?:string|null;
}
export interface HouseholdMemberInput extends HouseholdMembershipInput {relationship:string;}
export interface HouseholdMember<Relationship extends string|null=string> extends HouseholdMembershipInput {
 relationship:Relationship;head:boolean;dateEnded:string|null;isActive:boolean;
}
export interface HouseholdSnapshot<Relationship extends string|null=string> {
 householdId:number;householdType:Relationship;members:HouseholdMember<Relationship>[];
}
export interface HouseholdResult<Relationship extends string|null=string> {
 key:string;outcome:'verified'|'already-present';household:HouseholdSnapshot<Relationship>;
}
export interface HouseholdMembershipReuseInput {
 key:string;headClientId:number;
 /** Ignored in membership-only reuse. */
 householdType?:string|null;
 members:HouseholdMembershipInput[];
}
export interface HouseholdCreateInput extends HouseholdMembershipReuseInput {householdType:string;members:HouseholdMemberInput[];}
export type HouseholdCreateOptions=
 | {reuseContainingHousehold?:boolean;createSeparateHousehold?:false}
 | {createSeparateHousehold:true;reuseContainingHousehold?:false};
export interface HouseholdCreateResolutionInput {
 key:string;headClientId:number;
 /** Reference to independent confirmation that the original create did not apply. */
 evidenceReference:string;confirmedNotApplied:true;
}
export interface HouseholdUi {
 readonly connection?:import("./connection.mjs").UiConnection;confirmNoHouseholds(clientId:number):Promise<boolean>;}
export interface HouseholdMutation {key:string;householdId:number;headClientId:number;}
export interface Households {
 read(householdId:number):Promise<HouseholdSnapshot>;
 /** Select by verified head, IDs and dates. Never sends a household mutation. */
 create(input:HouseholdMembershipReuseInput,options:{reuseContainingHousehold:'membership-only';createSeparateHousehold?:false}):Promise<HouseholdResult<string|null>>;
 create(input:HouseholdCreateInput,options?:HouseholdCreateOptions):Promise<HouseholdResult>;
 /** Retire a positively confirmed uncommitted create. Recheck the original baseline and never replay. */
 resolveCreateNotApplied(input:HouseholdCreateResolutionInput):Promise<{key:string;outcome:'not-applied'|'already-resolved'}>;
 addMembers(input:HouseholdMutation&{householdType?:string;members:HouseholdMemberInput[]}):Promise<HouseholdResult>;
 /** Ends household membership only. The head cannot leave an active household. */
 endMembers(input:HouseholdMutation&{clientIds:number[];dateEnded:string}):Promise<HouseholdResult>;
 /** Only non-head relationships may change. */
 updateRelationships(input:HouseholdMutation&{members:{clientId:number;relationship:string}[]}):Promise<HouseholdResult>;
}
export function createHouseholds(options:{api:WellSkyClient;store:UiMutationStore;ui:HouseholdUi}):Households;
export function getHouseholdOptions():{householdTypes:string[];relationships:string[];verifiedOn:string};
export function createHouseholdUi(options:{page:Page}):HouseholdUi;
