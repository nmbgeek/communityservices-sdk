import type {UiConnection,UiConnectionOptions} from './connection.mjs';
import type {Browser, BrowserContext, BrowserType, Page} from 'playwright-core';
import type {GwtEnrollmentExit,GwtEnrollmentHelpers,GwtEnrollmentSession,GwtEnrollmentSnapshot,GwtMutationStore} from '../dist/esm/index.js';
export interface LoginOptions extends UiConnectionOptions {
  chromium: BrowserType;
  envFile?: string;
  executablePath?: string;
  timeoutMs?: number;
  passwordRecovery?: false | PasswordRecoveryOptions;
}
/** Enabled by default with a private per-user file journal. Share a store across hosts. */
export interface PasswordRecoveryOptions {store?:UiMutationStore;appendCharacter?:string;}
export class LoginError extends Error {
  readonly code:'PASSWORD_EXPIRED'|'RECOVERY_UNCERTAIN'|'RECOVERY_CONFIGURATION'|'LOGIN_FAILED';
  readonly stage:string;
  readonly recoveryStage?:string;
}
export interface UiSession {readonly connection:UiConnection;browser: Browser;context: BrowserContext;page: Page;passwordRecovery:'restored-original'|'not-needed';ensureAuthenticated():Promise<void>;reauthenticate():Promise<void>;close():Promise<void>;}
export interface PlaywrightGwtOptions {page:Page;tenant:string;moduleBaseUrl:string;}
export interface PlaywrightEnrollmentSnapshot extends GwtEnrollmentSnapshot {providerId:number;enrollmentType:string;exits:readonly GwtEnrollmentExit[];}
export interface EnrollmentReader {
  readonly connection?:UiConnection;
  readEnrollment(target:{clientId:number;enrollmentId:number}):Promise<PlaywrightEnrollmentSnapshot>;
}
export function openUiSession(options:LoginOptions):Promise<UiSession>;
/** The read-only enrollment session shares the page lock with mutation helpers. */
export function openEnrollmentSession(options:LoginOptions&{store:GwtMutationStore & UiMutationStore}):Promise<UiSession&{helpers:GwtEnrollmentHelpers;enrollmentSession:EnrollmentReader;workflows:ClientWorkflows}>;
export function createPlaywrightGwtSession(options:PlaywrightGwtOptions):Omit<GwtEnrollmentSession,'readEnrollment'>&EnrollmentReader;
export function createPlaywrightEnrollmentHelpers(options:PlaywrightGwtOptions&{store:GwtMutationStore}):GwtEnrollmentHelpers;

/** Durable JSON journal. Use a separate namespace from enrollment intents. */
export interface UiMutationStore {
  withLock<T>(scope:string,work:()=>Promise<T>):Promise<T>;
  read(scope:string):Promise<readonly unknown[]>;
  write(scope:string,records:readonly unknown[]):Promise<void>;
}
export interface BrowserAttachment {
  attachmentId:number;entityId:number|null;entityType:string;entityName:string;
  name:string;extension:string;description:string|null;
}
export type AttachmentConflictReason='intent-changed'|'duplicate-name'|'identity-changed'|'content-changed'|'unresolved';
export class AttachmentConflictError extends Error {
  constructor(reason:AttachmentConflictReason,message:string);
  readonly code:'ATTACHMENT_CONFLICT';
  readonly reason:AttachmentConflictReason;
}
export interface BrowserCaseNote {noteId:number;goalId:number;clientId:number;noteDate:string;note:string;providerId:number;}
export interface ClientWorkflows {
 readonly connection?:import("./connection.mjs").UiConnection;
  listAttachments(clientId:number):Promise<BrowserAttachment[]>;
  downloadAttachment(input:{clientId:number;attachmentId:number}):Promise<Uint8Array>;
  uploadAttachment(input:{clientId:number;location:{kind:'profile'|'case-plans'}|{kind:'goal';goalId:number};file:{name:string;mimeType?:string;buffer:Uint8Array};description?:string}):Promise<{outcome:'written'|'reconciled'|'already-present';attachment:BrowserAttachment;checksum:string}>;
  listCaseNotes(input:{clientId:number;goalId:number}):Promise<BrowserCaseNote[]>;
  createCaseNote(input:{key?:string;clientId:number;goalId:number;providerId:number;noteDate:string;note:string}):Promise<{outcome:'written'|'reconciled'|'already-present';note:BrowserCaseNote}>;
}
export function createClientWorkflows(options:{page:Page;store:UiMutationStore}):ClientWorkflows;
export function createFileGwtMutationStore(directory:string):GwtMutationStore & UiMutationStore;
export * from './service-recording.mjs';
export * from './ssvf-rules.mjs';
export * from './program-discovery.mjs';
export * from './enrollment-workflow.mjs';
export * from './member-entry-date.mjs';
export * from './household-exit.mjs';

export class SessionInterruptedError extends Error {readonly code:'SESSION_INTERRUPTED';readonly reauthenticated:boolean;}
export * from './client-profile.mjs';
export * from './date-of-birth.mjs';
export * from './households.mjs';
export * from './client-creation.mjs';
export * from './case-plans.mjs';
export * from './need-recording.mjs';
export * from './shelters.mjs';
export * from './shelter-inventory.mjs';

export * from './current-living-situation.mjs';

export {resolveUiConnection} from './connection.mjs';
export type {UiConnection,UiConnectionOptions} from './connection.mjs';
