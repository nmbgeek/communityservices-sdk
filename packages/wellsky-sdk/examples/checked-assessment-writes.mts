import {
 createReadBackWriteLabelResolver,writeMobileAnswersChecked,
 type AssessmentDefinition,type WriteLabelObservation,type CheckedMobileWriteOptions,type WellSkyClient,
} from '@choiceapps/communityservices-sdk';

/** Observations must come from the definition's tenant. Unobserved options stay unresolved. */
export function exactWriteLabels(definition:AssessmentDefinition,observations:WriteLabelObservation[]){
 return createReadBackWriteLabelResolver(definition,observations);
}

/** Pass the original requested instant; the SDK transport owns any configured mobile date correction. */
export async function insertMobileAnswers(api:WellSkyClient,input:CheckedMobileWriteOptions){
 return writeMobileAnswersChecked(api,input);
}
