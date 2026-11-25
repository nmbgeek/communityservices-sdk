import type {Page} from 'playwright-core';
import type {UiConnection} from './connection.mjs';
import type {PlaywrightEnrollmentSnapshot, UiMutationStore} from './index.mjs';

export interface ExitDeletionInput {
  key: string;
  clientId: number;
  enrollmentId: number;
  providerId: number;
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
  deleteExit(input: ExitDeletionInput): Promise<ExitDeletionResult>;
};
