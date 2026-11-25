import type {Page} from 'playwright-core';
import {createExitDeletion, createExitDeletionUi, createFileGwtMutationStore, type ExitDeletionInput} from '@choiceapps/communityservices-sdk/browser';

/** The target authorizes reopening every active enrollment linked to the selected exit. */
export async function reopenEnrollment(page: Page, journalDirectory: string, target: ExitDeletionInput) {
  const deletion = createExitDeletion({
    ui: createExitDeletionUi({page}),
    store: createFileGwtMutationStore(journalDirectory),
  });
  return deletion.deleteExit(target);
}
