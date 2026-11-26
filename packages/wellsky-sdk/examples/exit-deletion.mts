import type {Page} from 'playwright-core';
import {createExitDeletion, createExitDeletionUi, createFileGwtMutationStore, type ExitDeletionInput, type ExitDeletionTarget, type ExitDeletionPreview} from '@choiceapps/communityservices-sdk/browser';

export function previewEnrollmentExit(page: Page, journalDirectory: string, target: ExitDeletionTarget) {
  return createExitDeletion({
    ui: createExitDeletionUi({page}),
    store: createFileGwtMutationStore(journalDirectory),
  }).previewExit(target);
}

/** Pass the preview that staff confirmed for this target. */
export function reopenConfirmedExit(
  page: Page, journalDirectory: string, target: ExitDeletionTarget & {key: string}, confirmed: ExitDeletionPreview,
) {
  if (confirmed.exitDate === null) throw Error('The selected enrollment is already open');
  return reopenEnrollment(page, journalDirectory, {
    ...target, expectedExitDate: confirmed.exitDate, expectedEnrollmentIds: confirmed.linkedEnrollmentIds,
  });
}

/** The target authorizes reopening every active enrollment linked to the selected exit. */
export async function reopenEnrollment(page: Page, journalDirectory: string, target: ExitDeletionInput) {
  const deletion = createExitDeletion({
    ui: createExitDeletionUi({page}),
    store: createFileGwtMutationStore(journalDirectory),
  });
  return deletion.deleteExit(target);
}
