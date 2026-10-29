import type {Page} from 'playwright-core';
import type {WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
export interface BirthDateEntry {enrollmentId:number;assessmentName:string;}
export interface BirthDateUpdate {
 clientId:number;key:string;assessmentCode:string;
 /** Strict calendar date, not a timestamp. */dateOfBirth:string;
 /** Explicit instant. Never moved to avoid an existing-answer conflict. */effectiveDate:string;
 /** Required to correct a DOB at the same effective timestamp as this enrollment's entry. */entry?:BirthDateEntry;
}
export interface DateOfBirthUi {
 readonly connection?:import("./connection.mjs").UiConnection;
 validateRestDate(dateOfBirth:string):Promise<void>;
 read(clientId:number):Promise<string|null>;
 correctAtEntry(input:BirthDateUpdate&{expectedDateOfBirth:string|null;beforeSave:()=>Promise<void>}):Promise<void>;
}
export interface BirthDateSnapshot {clientId:number;dateOfBirth:string|null;effectiveDate:string|null;}
export interface DateOfBirth {
 read(input:{clientId:number;assessmentCode:string}):Promise<BirthDateSnapshot>;
 /** Read-only preflight; allowEntryCorrection reserves no write and creates no enrollment. */
 validate(input:{clientId:number;assessmentCode:string;dateOfBirth:string;effectiveDate:string;allowEntryCorrection?:boolean}):Promise<BirthDateSnapshot>;
 /** allowLater permits the same calendar value at a newer effective timestamp. */
 verify(input:{clientId:number;assessmentCode:string;dateOfBirth:string;effectiveDate:string;allowLater?:boolean}):Promise<BirthDateSnapshot&{dateOfBirth:string;effectiveDate:string}>;
 update(input:BirthDateUpdate):Promise<{clientId:number;dateOfBirth:string;effectiveDate:string;method:'rest'|'ui';outcome:'verified'|'already-present'}>;
}
export function validateBirthDate(value:unknown):string;
export function createDateOfBirth(options:{api:WellSkyClient;ui:DateOfBirthUi;store:UiMutationStore}):DateOfBirth;
export function createDateOfBirthUi(options:{page:Page}):DateOfBirthUi;
