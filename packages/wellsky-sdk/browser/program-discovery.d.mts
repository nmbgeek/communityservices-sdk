import type {Page} from 'playwright-core';
export interface AssessmentCatalogItem { assessmentId:number; name:string; code:string }
export interface ProviderAssessmentItem extends AssessmentCatalogItem { assignedToAssessmentTab:boolean }
export interface AssessmentDisplayDefault {
  location:string;
  label:string;
  allowMultiple:boolean|null;
  assessmentName:string|null;
  /** Unresolved includes absent/ambiguous names in the active published provider catalog. */
  resolution:'unset'|'resolved'|'unresolved';
  assessment:ProviderAssessmentItem|null;
}
export interface ProgramDiscovery {
 readonly connection?:import("./connection.mjs").UiConnection;
  listAssessments():Promise<{source:'admin-catalog';retrievedAt:string;assessments:AssessmentCatalogItem[]}>;
  getProviderAssessments(input:{providerId:number}):Promise<{
    source:'provider-display-settings';providerId:number;retrievedAt:string;
    assessments:ProviderAssessmentItem[];defaults:AssessmentDisplayDefault[];
  }>;
}
/** Requires an authenticated, dedicated application page and administrative read access. No Save is clicked. */
export function createProgramDiscovery(input:{page:Page}):ProgramDiscovery;
