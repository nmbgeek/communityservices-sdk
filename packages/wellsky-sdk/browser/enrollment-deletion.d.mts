import type {Page} from 'playwright-core';
import type {UiConnection} from './connection.mjs';
import type {EnrollmentListSnapshot, UiMutationStore} from './index.mjs';

export interface EnrollmentDeletionInput {key:string;clientId:number;enrollmentId:number;providerId:number;}
export interface EnrollmentDeletionResult {
  key:string;clientId:number;enrollmentId:number;
  outcome:'deleted'|'reconciled'|'already-deleted'|'already-absent';
}
export interface EnrollmentDeletionUi {
  readonly connection:UiConnection;
  withLock<T>(work:()=>Promise<T>):Promise<T>;
  listEnrollments(target:{clientId:number}):Promise<EnrollmentListSnapshot>;
  /** Call beforeConfirm immediately before the single confirmation click. Never retry that click. */
  confirmDelete(input:EnrollmentDeletionInput,beforeConfirm:()=>Promise<void>):Promise<void>;
}
export class EnrollmentDeletionError extends Error {
  readonly code:'ENROLLMENT_DELETION_CONFLICT';readonly reason:string;
  constructor(reason:string);
}
export function createEnrollmentDeletionUi(options:{page:Page}):EnrollmentDeletionUi;
export function createEnrollmentDeletion(options:{ui:EnrollmentDeletionUi;store:UiMutationStore}):{
  deleteEnrollment(input:EnrollmentDeletionInput):Promise<EnrollmentDeletionResult>;
};
