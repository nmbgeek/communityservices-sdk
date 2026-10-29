import type {Page} from 'playwright-core';
import type {WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
export interface CasePlanUi {
 readonly connection?:import("./connection.mjs").UiConnection;confirmEmpty(input:{kind:'note'|'goal';clientId:number}):Promise<boolean>;}
export interface NoteValues {note_date:string;note:string;}
export interface GoalValues {providerId:number;dateGoalsSet:string;classification:string;type:string;overallStatus:string;goalDescription:string;targetDate?:string|null;outcome?:string;outcomeDate?:string|null;projectFollowupDate?:string|null;followupMade?:boolean;followupUser?:string;percentComplete?:string;caseManager?:string;}
export interface ActionValues {providerId:number;dateSet:string;actionStep:string;status:string;targetDate?:string|null;outcome?:string;outcomeDate?:string|null;followupOutcome?:string;}
export interface CasePlanResult {key:string;recordId:number;kind:'note'|'goal'|'action';outcome:'verified'|'already-present';values:Record<string,string|number|boolean|null>;}
export interface RecordInput<T> {key:string;clientId:number;values:T;}
export interface CasePlans {
 createClientNote(input:RecordInput<NoteValues>):Promise<CasePlanResult>;
 updateClientNote(input:RecordInput<Partial<NoteValues>>&{recordId:number}):Promise<CasePlanResult>;
 createGoal(input:RecordInput<GoalValues>):Promise<CasePlanResult>;
 updateGoal(input:RecordInput<Partial<GoalValues>>&{recordId:number}):Promise<CasePlanResult>;
 createActionStep(input:RecordInput<ActionValues>&{goalId:number}):Promise<CasePlanResult>;
 updateActionStep(input:RecordInput<Partial<ActionValues>>&{goalId:number;recordId:number}):Promise<CasePlanResult>;
}
export function createCasePlans(options:{api:WellSkyClient;ui:CasePlanUi;store:UiMutationStore}):CasePlans;
export function createCasePlanUi(options:{page:Page}):CasePlanUi;
