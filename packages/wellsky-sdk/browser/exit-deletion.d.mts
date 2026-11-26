import type {Page} from 'playwright-core';
import type {UiConnection} from './connection.mjs';
import type {PlaywrightEnrollmentSnapshot, UiMutationStore} from './index.mjs';

export interface ExitDeletionTarget {
  clientId: number;
  enrollmentId: number;
  providerId: number;
}
export interface ExitDeletionInput extends ExitDeletionTarget {
  key: string;
  /** Timezone-qualified exit instant the caller confirmed. */
  expectedExitDate?: string;
  /** Complete set of linked enrollment IDs the caller confirmed, including the target. */
  expectedEnrollmentIds?: readonly number[];
}
export interface ExitDeletionPreview {
  /** UTC timestamp, or null when the target is already open. */
  exitDate: string | null;
  linkedEnrollmentIds: number[];
  separatelyExitedEnrollmentIds: number[];
}
export interface ExitDeletionResult {
  key: string;
  clientId: number;
  enrollmentId: number;
  reopenedEnrollmentIds: number[];
  outcome: 'deleted' | 'reconciled' | 'already-deleted' | 'already-open';
}
export interface ExitDeletionUi {
  readonly connection: UiConnection;
  withLock<T>(work: () => Promise<T>): Promise<T>;
  readEnrollment(target: {clientId: number; enrollmentId: number}): Promise<PlaywrightEnrollmentSnapshot>;
  /** Call beforeConfirm immediately before the single confirmation click. Never retry the click. */
  confirmDelete(input: ExitDeletionInput, beforeConfirm: () => Promise<void>): Promise<void>;
}
export class ExitDeletionError extends Error {
  readonly code: 'EXIT_DELETION_CONFLICT';
  readonly reason: string;
  constructor(reason: string);
}
export function createExitDeletionUi(options: {page: Page}): ExitDeletionUi;
export function createExitDeletion(options: {ui: ExitDeletionUi; store: UiMutationStore}): {
  previewExit(target: ExitDeletionTarget): Promise<ExitDeletionPreview>;
  deleteExit(input: ExitDeletionInput): Promise<ExitDeletionResult>;
};
