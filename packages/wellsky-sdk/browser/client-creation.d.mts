import type {WellSkyClient} from '../dist/esm/index.js';
import type {UiMutationStore} from './index.mjs';
export type VeteranStatus='Yes (HUD)'|'No (HUD)'|"Client doesn't know (HUD)"|'Client prefers not to answer (HUD)'|'Data not collected (HUD)';
export interface ClientCreationInput {
 sourceId:string;
 body:{firstName:string;lastName:string;dateEffective:string;middleName?:string;suffix?:string;search_alias?:string;nameDataQuality?:string;socSecNo?:string;ssnDataQuality?:string;veteranStatus?:VeteranStatus};
 /** Explicitly create a distinct person despite flagged candidates. Never merges. */allowDistinctClient?:boolean;
}
export interface ClientCreationResult {sourceId:string;clientId:number;outcome:'verified'|'already-present';}
export interface ClientCreator {
 create(input:ClientCreationInput):Promise<ClientCreationResult>;
 /** Operator must verify this ID belongs to the attempted create before calling. No server write. */
 resolveCreated(input:ClientCreationInput&{clientId:number}):Promise<ClientCreationResult>;
 lookup(sourceId:string):Promise<{clientId:number|null;stage:'attempted'|'created'|'verified'}|null>;
}
export function createClientCreator(options:{api:WellSkyClient;store:UiMutationStore}):ClientCreator;
