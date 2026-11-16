import {createHash} from 'node:crypto';
import {pageConnection, resolveUiConnection} from './connection.mjs';
import {withPageLock} from './page-lock.mjs';
import {createPlaywrightGwtSession} from './playwright-session.mjs';

export class EnrollmentDeletionError extends Error {
  constructor(reason) {
    super(`Entry / Exit deletion: ${reason}`);
    this.name = 'EnrollmentDeletionError';
    this.code = 'ENROLLMENT_DELETION_CONFLICT';
    this.reason = reason;
  }
}

const positive = value => Number.isSafeInteger(value) && value > 0;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = reason => { throw new EnrollmentDeletionError(reason); };

function normalize(input) {
  if (!input || Object.keys(input).some(key => !['key', 'clientId', 'enrollmentId', 'providerId'].includes(key)) ||
      typeof input.key !== 'string' || !input.key.trim() || input.key.length > 200 || /[\x00-\x1f]/.test(input.key) ||
      !positive(input.clientId) || !positive(input.enrollmentId) || !positive(input.providerId)) fail('invalid-input');
  return {key: input.key, clientId: input.clientId, enrollmentId: input.enrollmentId, providerId: input.providerId};
}

function activeRows(snapshot, connection, clientId) {
  if (snapshot?.source !== 'gwt-rpc' || snapshot.tenant !== connection.tenant || snapshot.clientId !== clientId ||
      !Array.isArray(snapshot.values) || snapshot.count !== snapshot.values.length ||
      snapshot.values.some(row => row.clientId !== clientId || !positive(row.enrollmentId) || !positive(row.enrollmentProvider) || row.isActive !== true) ||
      new Set(snapshot.values.map(row => row.enrollmentId)).size !== snapshot.values.length) fail('incomplete-enrollment-read');
  return snapshot.values;
}

/** Delete one Entry / Exit through the UI, with a durable journal and fresh active-list verification. */
export function createEnrollmentDeletion({ui, store}) {
  const connection = resolveUiConnection(ui?.connection);
  if (!['withLock', 'listEnrollments', 'confirmDelete'].every(key => typeof ui?.[key] === 'function') ||
      !['withLock', 'read', 'write'].every(key => typeof store?.[key] === 'function')) fail('ui-and-store-required');
  return {async deleteEnrollment(raw) {
    const input = normalize(raw), keyHash = hash(input.key);
    const intentHash = hash([input.clientId, input.enrollmentId, input.providerId]);
    const scope = JSON.stringify([connection.scope, 'entry-exit-deletion', input.clientId]);
    return ui.withLock(() => store.withLock(scope, async () => {
      const entries = await store.read(scope);
      if (!Array.isArray(entries) || entries.some(entry => !entry || entry.version !== 1 ||
          !['attempted', 'verified'].includes(entry.stage) || !positive(entry.enrollmentId) ||
          typeof entry.keyHash !== 'string' || typeof entry.intentHash !== 'string' ||
          !Array.isArray(entry.otherEnrollmentIds) || entry.otherEnrollmentIds.some(id => !positive(id))) ||
          new Set(entries.map(entry => entry.keyHash)).size !== entries.length) fail('invalid-journal');
      let entry = entries.find(value => value.keyHash === keyHash);
      if (entry && (entry.intentHash !== intentHash || entry.enrollmentId !== input.enrollmentId)) fail('intent-changed');
      if (entries.some(value => value.enrollmentId === input.enrollmentId && value.keyHash !== keyHash && value.stage === 'attempted')) fail('unresolved-delete');
      const read = async () => activeRows(await ui.listEnrollments({clientId: input.clientId}), connection, input.clientId);
      const verify = rows => {
        if (rows.some(row => row.enrollmentId === input.enrollmentId)) fail('unresolved-delete');
        if (entry.otherEnrollmentIds.some(id => !rows.some(row => row.enrollmentId === id))) fail('other-enrollment-missing');
      };
      const result = outcome => ({key: input.key, clientId: input.clientId, enrollmentId: input.enrollmentId, outcome});
      const rows = await read(), target = rows.find(row => row.enrollmentId === input.enrollmentId);
      if (!target) {
        if (!entry) return result('already-absent');
        verify(rows);
        const outcome = entry.stage === 'attempted' ? 'reconciled' : 'already-deleted';
        entry.stage = 'verified';
        await store.write(scope, entries);
        return result(outcome);
      }
      if (target.enrollmentProvider !== input.providerId) fail('provider-mismatch');
      if (entry) fail(entry.stage === 'verified' ? 'record-reappeared' : 'unresolved-delete');
      let attempted = false, failure;
      try {
        await ui.confirmDelete(input, async () => {
          if (attempted) fail('second-delete-attempt');
          entry = {version: 1, keyHash, intentHash, enrollmentId: input.enrollmentId, stage: 'attempted',
            otherEnrollmentIds: rows.filter(row => row.enrollmentId !== input.enrollmentId).map(row => row.enrollmentId)};
          entries.push(entry);
          await store.write(scope, entries);
          attempted = true;
        });
      } catch (error) { failure = error; }
      if (!attempted) throw failure ?? new EnrollmentDeletionError('adapter-did-not-journal');
      // A fresh successful read can reconcile a lost response. A failed read never proves absence.
      verify(await read());
      entry.stage = 'verified';
      await store.write(scope, entries);
      return result(failure ? 'reconciled' : 'deleted');
    }));
  }};
}

/** UI port for createEnrollmentDeletion. Calls must run inside withLock. No captured RPC is replayed. */
export function createEnrollmentDeletionUi({page}) {
  const connection = pageConnection(page);
  const reader = createPlaywrightGwtSession({page, ...connection});
  const control = id => page.locator(`[id="${id}"]:visible`);
  const guard = async () => {
    const url = new URL(page.url());
    if (url.origin + url.pathname !== connection.moduleBaseUrl + 'index.html' ||
        await control('formfield-password').count()) fail('authenticated-page-required');
  };
  return {
    connection,
    withLock: work => withPageLock(page, work),
    async listEnrollments(target) {
      await guard();
      if (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) fail('close-dialogs-before-deletion');
      return reader.listEnrollments(target);
    },
    async confirmDelete(input, beforeConfirm) {
      normalize(input);
      await guard();
      if (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count()) fail('close-dialogs-before-deletion');
      if (!await page.getByText(new RegExp(`^Client - \\(${input.clientId}\\)`)).isVisible()) fail('client-mismatch');
      const trash = control(`ClientEntryExitTab.deleteEntryExit-imageLink_${input.enrollmentId}`);
      if (await trash.count() !== 1 || await trash.getAttribute('title') !== 'Delete Entry Exit') fail('delete-control-unavailable');
      let confirmationStarted = false;
      const dialog = page.getByRole('alertdialog', {name: 'Please Confirm', exact: true});
      try {
        await trash.click();
        await dialog.waitFor({state: 'visible', timeout: 30000});
        const prompt = `Are you sure you want to delete this Entry / Exit (#${input.enrollmentId})?`;
        if (await page.locator('[role="dialog"]:visible, [role="alertdialog"]:visible').count() !== 1 ||
            !await dialog.getByText(prompt, {exact: true}).isVisible()) fail('unsupported-confirmation');
        const yes = dialog.getByRole('button', {name: 'Yes', exact: true});
        if (await yes.count() !== 1 || !await yes.isEnabled()) fail('confirmation-unavailable');
        await guard();
        await beforeConfirm();
        confirmationStarted = true;
        await yes.click();
        await trash.waitFor({state: 'hidden', timeout: 30000});
        await dialog.waitFor({state: 'hidden', timeout: 30000});
      } finally {
        // Cancel preparation failures, but never interfere with an in-flight confirmation.
        if (!confirmationStarted && await dialog.isVisible()) {
          const no = dialog.getByRole('button', {name: 'No', exact: true});
          if (await no.count() === 1) await no.click();
        }
      }
    },
  };
}
