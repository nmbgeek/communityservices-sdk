import {createCatalogWriteLabelResolver,flattenQuestions,type WellSkyClient} from '@choiceapps/communityservices-sdk';
import {createEnrollmentWorkflow,type EnrollmentCatalogReader,type EnrollmentWorkflowOptions} from '@choiceapps/communityservices-sdk/browser';

/** Standalone encoders can discover exact labels before any option has been answered. */
export async function discoverLabels(api:WellSkyClient,enrollmentSession:EnrollmentCatalogReader,input:{clientId:number;assessmentCode:string}){
 const definition=await api.assessments.getDefinition(input);
 const optionIds=[...new Set(flattenQuestions(definition.questions).filter(({question})=>question.questionType==='lookup').flatMap(({question})=>question.options.map(o=>o.id)))];
 const catalog=await enrollmentSession.readPicklistOptions({clientId:input.clientId,optionIds});
 return {definition,writeLabel:createCatalogWriteLabelResolver(definition,catalog)};
}

/** Built-in enrollment sessions discover labels automatically when writeLabel is omitted. */
export function automaticWorkflow(options:Omit<EnrollmentWorkflowOptions,'writeLabel'|'yesNoWrites'|'enrollmentSession'>&{enrollmentSession:EnrollmentCatalogReader}){
 return createEnrollmentWorkflow({...options,yesNoWrites:'standard'});
}
