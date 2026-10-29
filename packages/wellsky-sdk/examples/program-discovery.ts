import {WellSkyClient, readProgramCatalog, flattenQuestions} from '@choiceapps/communityservices-sdk';
import {createProgramDiscovery} from '@choiceapps/communityservices-sdk/browser';
import type {Page} from 'playwright-core';

/** Supply an authenticated server-side API client and a dedicated authenticated UI page.
 * Keep browser credentials/session cookies on the server, never in a consuming web app. */
export async function getProgramAssessmentChoices(api:WellSkyClient, page:Page, providerId:number, metadataClientId:number) {
  const catalog=await readProgramCatalog(api);
  const provider=catalog.providers.find(item=>item.providerId===providerId);
  if(!provider)throw Error('Provider is not active and operational in the API catalog');
  const discovery=createProgramDiscovery({page});
  const configuration=await discovery.getProviderAssessments({providerId});
  const entry=configuration.defaults.find(item=>item.location==='showVaEntry');
  if(entry?.resolution!=='resolved'||!entry.assessment)throw Error('VA entry assessment is not uniquely resolved');
  // REST metadata currently requires a permitted client context even for definitions.
  // Its result strips answers/recordset IDs. It is not a patient/client export.
  const definition=await api.assessments.getDefinition({clientId:metadataClientId,assessmentCode:entry.assessment.code});
  return {provider,configuration,definition,questions:flattenQuestions(definition.questions)};
}
