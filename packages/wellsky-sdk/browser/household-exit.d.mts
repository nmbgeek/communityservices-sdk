import type {Page} from 'playwright-core';
export interface HouseholdExitTarget {clientId:number;enrollmentId:number;}
export type HouseholdExitDestinationDetails =
 | {kind:'rental-subsidy';rentalSubsidyType:string}
 | {kind:'other';explanation:string};
export interface HouseholdExitDetailInput {
 /** Required for the corresponding destination; omitted for every other destination. */
 destinationDetails?:HouseholdExitDestinationDetails;
 /** Required only when the reason is Other. Explanations are 1..100 characters. */
 reasonForLeavingOther?:string;
}
export interface HouseholdExitUiInput extends HouseholdExitTarget,HouseholdExitDetailInput {
 /** Nonempty selected subset of the enrollment group. Includes target clientId, which need not be the head. */
 clientIds:number[];exitDate:string;destination:string;reasonForLeaving:string;
}
export interface HouseholdExitOptions {
 destinations:{value:string;name:string}[];reasons:{value:string;name:string}[];
 rentalSubsidyTypes:{value:string;name:string}[];
}
export interface HouseholdExitStoredDetails {
 destinationDetails:HouseholdExitDestinationDetails|null;
 reasonForLeavingOther:string|null;
}
export interface HouseholdExitUi {
 readonly connection?:import("./connection.mjs").UiConnection;
 listOptions(target:HouseholdExitTarget):Promise<HouseholdExitOptions>;
 /** Reopen the saved member exit and read the persisted conditional fields, then cancel. */
 readExitDetails(target:HouseholdExitTarget):Promise<HouseholdExitStoredDetails>;
 validateExit(input:HouseholdExitUiInput):Promise<void>;
 /** One save attempt only. Use through the durable exitHousehold workflow. */
 saveExit(input:HouseholdExitUiInput):Promise<void>;
}
/** UI port with fresh conditional choices and per-member readback. */
export function createHouseholdExitUi(options:{page:Page}):HouseholdExitUi;
