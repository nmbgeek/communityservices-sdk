import {createHash} from 'node:crypto';
import {pageConnection, resolveUiConnection} from './connection.mjs';
import {withPageLock} from './page-lock.mjs';
import {createPlaywrightGwtSession} from './playwright-session.mjs';

export class ExitDeletionError extends Error {
  constructor(reason) {
    super(`Exit deletion: ${reason}`);
    this.name = 'ExitDeletionError';
    this.code = 'EXIT_DELETION_CONFLICT';
    this.reason = reason;
  }
}

const fail = reason => { throw new ExitDeletionError(reason); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fields = ['projectExitDate', 'destination', 'destinationCode', 'reasonForLeaving', 'reasonForLeavingCode', 'exitSubgroupId'];

const targetFields = ['clientId', 'enrollmentId', 'providerId'];

function normalizeTarget(input, allowedFields = targetFields) {
  if (!input || Object.keys(input).some(key => !allowedFields.includes(key)) ||
      targetFields.some(field => !positive(input[field]))) fail('invalid-input');
  return {clientId: input.clientId, enrollmentId: input.enrollmentId, providerId: input.providerId};
}

function normalize(input) {
  const target = normalizeTarget(input, [...targetFields, 'key', 'expectedExitDate', 'expectedEnrollmentIds']);
  if (typeof input.key !== 'string' || !input.key.trim() || input.key.length > 200 ||
      /[\x00-\x1f]/.test(input.key)) fail('invalid-input');
  const {expectedExitDate, expectedEnrollmentIds} = input;
  let expectedDate, expectedIds;
  if (expectedExitDate !== undefined) {
    if (typeof expectedExitDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(expectedExitDate) ||
        !Number.isFinite(Date.parse(expectedExitDate)) ||
        new Date(expectedExitDate.slice(0, 19) + 'Z').toISOString().slice(0, 19) !== expectedExitDate.slice(0, 19)) fail('invalid-input');
    expectedDate = new Date(expectedExitDate).toISOString();
  }
  if (expectedEnrollmentIds !== undefined) {
    if (!Array.isArray(expectedEnrollmentIds) || !expectedEnrollmentIds.includes(target.enrollmentId) ||
        [...expectedEnrollmentIds].some(id => !positive(id)) ||
        new Set(expectedEnrollmentIds).size !== expectedEnrollmentIds.length) fail('invalid-input');
    expectedIds = [...expectedEnrollmentIds].sort((a, b) => a - b);
  }
  return {key: input.key, ...target,
    ...(expectedDate === undefined ? {} : {expectedExitDate: expectedDate}),
    ...(expectedIds === undefined ? {} : {expectedEnrollmentIds: expectedIds})};
}

function readState(snapshot, input, connection) {
  if (snapshot?.source !== 'gwt-rpc' || snapshot.tenant !== connection.tenant ||
      snapshot.clientId !== input.clientId || snapshot.enrollmentId !== input.enrollmentId ||
      !Array.isArray(snapshot.members) || !Array.isArray(snapshot.exits) ||
      snapshot.members.length !== snapshot.exits.length || !Number.isFinite(Date.parse(snapshot.projectStartDate)))
    fail('incomplete-enrollment-read');
  if (snapshot.providerId !== input.providerId) fail('provider-mismatch');
  const exits = snapshot.members.map(member => {
    const matches = snapshot.exits.filter(exit => exit.clientId === member.clientId && exit.enrollmentId === member.enrollmentId);
    if (!positive(member.clientId) || !positive(member.enrollmentId) || matches.length !== 1)
      fail('incomplete-enrollment-read');
    const exit = matches[0];
    if (fields.some(field => exit[field] !== null && (typeof exit[field] !== 'string' || !exit[field])) ||
        (exit.projectExitDate !== null && !Number.isFinite(Date.parse(exit.projectExitDate))) ||
        !Array.isArray(exit.clientIds) || !Array.isArray(exit.enrollmentIds)) fail('incomplete-exit-read');
    return {
      clientId: member.clientId,
      enrollmentId: member.enrollmentId,
      ...Object.fromEntries(fields.map(field => [field, exit[field]])),
      clientIds: [...exit.clientIds].sort((a, b) => a - b),
      enrollmentIds: [...exit.enrollmentIds].sort((a, b) => a - b),
    };
  }).sort((a, b) => a.enrollmentId - b.enrollmentId);
  if (new Set(exits.map(exit => exit.enrollmentId)).size !== exits.length ||
      new Set(exits.map(exit => exit.clientId)).size !== exits.length) fail('ambiguous-enrollment-members');
  const target = exits.find(exit => exit.enrollmentId === input.enrollmentId && exit.clientId === input.clientId);
  if (!target) fail('exit-target-missing');
  const context = [snapshot.projectStartDate, snapshot.groupId, snapshot.householdId, snapshot.enrollmentType];
  return {context, exits, target};
}

function linkedExits({exits, target}) {
  const linked = exits.filter(exit => exit === target ||
    (target.exitSubgroupId !== null && exit.exitSubgroupId === target.exitSubgroupId));
  const enrollmentIds = linked.map(exit => exit.enrollmentId);
  const clientIds = linked.map(exit => exit.clientId).sort((a, b) => a - b);
  if (linked.some(exit => exit.projectExitDate !== target.projectExitDate ||
      JSON.stringify(exit.enrollmentIds) !== JSON.stringify(enrollmentIds) ||
      JSON.stringify(exit.clientIds) !== JSON.stringify(clientIds))) fail('incomplete-exit-subgroup');
  return linked;
}

function describeExit(state) {
  const linked = linkedExits(state);
  const exitDate = state.target.projectExitDate;
  if (exitDate === null && fields.some(field => state.target[field] !== null)) fail('incomplete-open-exit-data');
  const linkedEnrollmentIds = exitDate === null ? [] : linked.map(exit => exit.enrollmentId);
  const separatelyExitedEnrollmentIds = state.exits
    .filter(exit => exit.projectExitDate !== null && !linkedEnrollmentIds.includes(exit.enrollmentId))
    .map(exit => exit.enrollmentId);
  return {exitDate: exitDate === null ? null : new Date(exitDate).toISOString(), linkedEnrollmentIds, separatelyExitedEnrollmentIds};
}

function reopened(exit) {
  return {
    ...exit,
    ...Object.fromEntries(fields.map(field => [field, null])),
    clientIds: [exit.clientId],
    enrollmentIds: [exit.enrollmentId],
  };
}

/** Remove exit data for one exit subgroup and verify that its enrollments remain active. */
export function createExitDeletion({ui, store}) {
  const connection = resolveUiConnection(ui?.connection);
  if (!['withLock', 'readEnrollment', 'confirmDelete'].every(key => typeof ui?.[key] === 'function') ||
      !['withLock', 'read', 'write'].every(key => typeof store?.[key] === 'function')) fail('ui-and-store-required');
  // An exit may be selected through any linked member. Share the journal and lock across anchors.
  const scope = JSON.stringify([connection.scope, 'exit-deletion']);
  const read = async target => readState(await ui.readEnrollment(target), target, connection);
  const previewExit = async raw => {
    const target = normalizeTarget(raw);
    return ui.withLock(async () => describeExit(await read(target)));
  };
  const deleteExit = async raw => {
    const input = normalize(raw);
    const keyHash = hash(input.key);
    const intent = [input.clientId, input.enrollmentId, input.providerId];
    if (input.expectedExitDate !== undefined || input.expectedEnrollmentIds !== undefined) {
      intent.push(input.expectedExitDate, input.expectedEnrollmentIds);
    }
    const intentHash = hash(intent);
    const {clientId, enrollmentId, providerId} = input;
    const target = {clientId, enrollmentId, providerId};
    return ui.withLock(() => store.withLock(scope, async () => {
      const entries = await store.read(scope);
      if (!Array.isArray(entries) || entries.some(entry => !entry || entry.version !== 1 ||
          !['attempted', 'verified'].includes(entry.stage) ||
          !['keyHash', 'intentHash', 'expected'].every(key => /^[a-f0-9]{64}$/.test(entry[key])) ||
          !Array.isArray(entry.enrollmentIds) || !entry.enrollmentIds.length || entry.enrollmentIds.some(id => !positive(id))) ||
          new Set(entries.map(entry => entry.keyHash)).size !== entries.length) fail('invalid-journal');
      let entry = entries.find(value => value.keyHash === keyHash);
      if (entry && entry.intentHash !== intentHash) fail('intent-changed');
      const verify = async (state, outcome) => {
        if (hash([state.context, state.exits]) !== entry.expected) fail('unresolved-delete');
        if (entry.stage !== 'verified') {
          entry.stage = 'verified';
          await store.write(scope, entries);
        }
        return {key: input.key, clientId: input.clientId, enrollmentId: input.enrollmentId,
          reopenedEnrollmentIds: [...entry.enrollmentIds], outcome};
      };
      const state = await read(target);
      if (entry) return verify(state, entry.stage === 'verified' ? 'already-deleted' : 'reconciled');
      const preview = describeExit(state);
      if (input.expectedExitDate !== undefined && input.expectedExitDate !== preview.exitDate) fail('exit-date-changed');
      if (input.expectedEnrollmentIds !== undefined &&
          JSON.stringify(input.expectedEnrollmentIds) !== JSON.stringify(preview.linkedEnrollmentIds)) fail('exit-members-changed');
      if (entries.some(value => value.stage === 'attempted' &&
          value.enrollmentIds.some(id => state.exits.some(exit => exit.enrollmentId === id)))) fail('unresolved-delete');
      if (preview.exitDate === null) {
        return {key: input.key, clientId: input.clientId, enrollmentId: input.enrollmentId,
          reopenedEnrollmentIds: [], outcome: 'already-open'};
      }
      const enrollmentIds = preview.linkedEnrollmentIds;
      const expected = hash([state.context, state.exits.map(exit => enrollmentIds.includes(exit.enrollmentId) ? reopened(exit) : exit)]);
      let attempted = false;
      let failure;
      try {
        await ui.confirmDelete(input, async () => {
          if (attempted) fail('second-delete-attempt');
          entry = {version: 1, stage: 'attempted', keyHash, intentHash, expected, enrollmentIds};
          entries.push(entry);
          await store.write(scope, entries);
          attempted = true;
        });
      } catch (error) {
        failure = error;
      }
      if (!attempted) throw failure ?? new ExitDeletionError('adapter-did-not-journal');
      return verify(await read(target), failure ? 'reconciled' : 'deleted');
    }));
  };
  return {previewExit, deleteExit};
}

// GWT renders the exit trash as a bundled sprite with no ID, label, or title.
const trashSprite = 'U0lEQVR42mNgGAWUAoeIBAXb4OT7tiHJ/1EwUAwkR5ahGIYRiQePBXQBNHf9qAWjFoxaMGoBcRY8JNoCYN1AhgUp/kDNN4iw4KJdcIrXaNVMNgAAYqyJxS7axF0AAAAASUVORK5CYII=';

/** Playwright port for createExitDeletion. Calls run under the shared page lock. */
export function createExitDeletionUi({page}) {
  const connection = pageConnection(page);
  const reader = createPlaywrightGwtSession({page, ...connection});
  const control = id => page.locator(`[id="${id}"]:visible`);
  const cancel = control('ExitDataPopup.cancel-button');
  const dialogs = page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible');
  const popup = cancel.locator('xpath=ancestor::*[@role="dialog"][1]');
  const confirmation = page.getByRole('alertdialog', {name: 'Please Confirm', exact: true});
  const guard = async () => {
    const url = new URL(page.url());
    if (url.origin + url.pathname !== connection.moduleBaseUrl + 'index.html' ||
        await control('formfield-password').count()) fail('authenticated-page-required');
  };
  return {
    connection,
    withLock: work => withPageLock(page, work),
    async readEnrollment(target) {
      await guard();
      if (await confirmation.isVisible()) fail('confirmation-still-open');
      return reader.readEnrollment({clientId: target.clientId, enrollmentId: target.enrollmentId});
    },
    async confirmDelete(raw, beforeConfirm) {
      const input = normalize(raw);
      await guard();
      if (await dialogs.count()) fail('close-dialogs-before-deletion');
      if (!await page.getByText(new RegExp(`^Client - \\(${input.clientId}\\)`)).isVisible()) fail('client-mismatch');
      const edit = control(`ClientEntryExitTab.editExit-imageLink_${input.enrollmentId}`);
      if (await edit.count() !== 1 || await edit.getAttribute('title') !== 'Edit Exit') fail('edit-exit-unavailable');
      let confirmationStarted = false;
      try {
        await edit.click();
        await popup.waitFor();
        if (await dialogs.count() !== 1 ||
            !await popup.getByText(`Edit Exit Data - (${input.clientId})`, {exact: false}).isVisible())
          fail('exit-popup-mismatch');
        const trash = popup.locator(`img.gwt-Image[tabindex="0"][aria-hidden="false"][style*="${trashSprite}"]:visible`);
        if (await trash.count() !== 1) fail('delete-exit-control-unavailable');
        await trash.click();
        await confirmation.waitFor();
        if (!await confirmation.getByText('Are you sure you want to delete this Exit Data?', {exact: true}).isVisible())
          fail('unsupported-confirmation');
        const yes = confirmation.getByRole('button', {name: 'Yes', exact: true});
        if (await yes.count() !== 1 || !await yes.isEnabled()) fail('confirmation-unavailable');
        await guard();
        await beforeConfirm();
        confirmationStarted = true;
        await yes.click();
        await confirmation.waitFor({state: 'hidden'});
        await cancel.waitFor({state: 'hidden'});
        await page.waitForFunction(() => !document.body.innerText.includes('Processing...') &&
          !document.body.innerText.includes('Loading...'));
      } finally {
        if (!confirmationStarted) {
          if (await confirmation.isVisible()) {
            const no = confirmation.getByRole('button', {name: 'No', exact: true});
            if (await no.count() === 1) await no.click();
          }
          if (!await confirmation.isVisible() && await cancel.isVisible()) await cancel.click();
        }
      }
    },
  };
}
