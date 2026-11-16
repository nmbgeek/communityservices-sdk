import type {Page} from 'playwright-core';
import {createEnrollmentDeletion,createEnrollmentDeletionUi,createFileGwtMutationStore} from '@choiceapps/communityservices-sdk/browser';

/** Supply an authenticated page and an explicitly authorized record from your application. */
export async function deleteEntryExit(page:Page,journalDirectory:string,target:{key:string;clientId:number;enrollmentId:number;providerId:number}) {
  const deletion=createEnrollmentDeletion({
    ui:createEnrollmentDeletionUi({page}),
    store:createFileGwtMutationStore(journalDirectory),
  });
  return deletion.deleteEnrollment(target);
}
