import type {WellSkyClient} from '@choiceapps/communityservices-sdk';
import {createRaceEthnicity,type EnrollmentCatalogReader,type UiMutationStore,type RaceEthnicityUpdate,type RaceEthnicityTarget} from '@choiceapps/communityservices-sdk/browser';

export function updateRace(api:WellSkyClient,enrollmentSession:EnrollmentCatalogReader,store:UiMutationStore,input:RaceEthnicityUpdate){
  return createRaceEthnicity({api,enrollmentSession,store}).update(input);
}

/** Use an authorized client's current effective second and a durable operation key. */
export function repairRace(api:WellSkyClient,enrollmentSession:EnrollmentCatalogReader,store:UiMutationStore,input:RaceEthnicityTarget){
  return createRaceEthnicity({api,enrollmentSession,store}).repair(input);
}
