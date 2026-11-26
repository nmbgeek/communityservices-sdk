import test from 'node:test';
import assert from 'node:assert/strict';
import {createExitDeletion, createExitDeletionUi, resolveUiConnection} from '@choiceapps/communityservices-sdk/browser';

const tenant = process.env.WELLSKY_TEST_TENANT ?? 'tenant-b';
const connection = resolveUiConnection({tenant});
const input = {key: 'remove-exit-50', clientId: 1, enrollmentId: 50, providerId: 2};

function fixture() {
  const members = [1, 2, 3].map(clientId => ({clientId, enrollmentId: 49 + clientId}));
  const open = member => ({
    ...member, projectExitDate: null, destination: null, destinationCode: null,
    reasonForLeaving: null, reasonForLeavingCode: null, exitSubgroupId: null,
    clientIds: [member.clientId], enrollmentIds: [member.enrollmentId],
  });
  const exits = members.map((member, index) => ({
    ...open(member), projectExitDate: '2026-02-02T00:00:00Z', destination: 'Other', reasonForLeaving: 'Completed',
    exitSubgroupId: index < 2 ? 'linked' : 'separate',
    clientIds: index < 2 ? [1, 2] : [3], enrollmentIds: index < 2 ? [50, 51] : [52],
  }));
  let journal = [], confirms = 0;
  const f = {exits, members, loseResponse: false, unavailable: false, commitCount: 2};
  const ui = {
    connection,
    withLock: work => work(),
    readEnrollment: async target => {
      if (f.unavailable && confirms) throw Error('read unavailable');
      return structuredClone({
        source: 'gwt-rpc', tenant, clientId: target.clientId, enrollmentId: target.enrollmentId,
        providerId: 2, projectStartDate: '2026-01-01T00:00:00Z', groupId: 'group',
        members: f.members, exits: f.exits,
      });
    },
    async confirmDelete(_, beforeConfirm) {
      await beforeConfirm();
      assert.equal(journal.at(-1).stage, 'attempted');
      confirms++;
      for (let i = 0; i < f.commitCount; i++) f.exits[i] = open(f.members[i]);
      if (f.loseResponse) throw Error('response unavailable');
    },
  };
  const store = {
    withLock: (_, work) => work(),
    read: async () => structuredClone(journal),
    write: async (_, records) => { journal = structuredClone(records); },
  };
  return Object.assign(f, {helper: () => createExitDeletion({ui, store}), count: () => confirms, journal: () => structuredClone(journal)});
}

test('reopens the entire linked exit and preserves a separate exit from the same household', async () => {
  const f = fixture();
  const other = structuredClone(f.exits[2]);
  assert.deepEqual(await f.helper().deleteExit(input), {
    key: input.key, clientId: 1, enrollmentId: 50, reopenedEnrollmentIds: [50, 51], outcome: 'deleted',
  });
  assert.deepEqual(f.exits[2], other);
  assert.equal((await f.helper().deleteExit(input)).outcome, 'already-deleted');
  assert.equal((await f.helper().deleteExit({...input, key: 'another-key'})).outcome, 'already-open');
  assert.equal(f.count(), 1);
});

test('reconciles a committed exit removal after an unavailable response and read', async () => {
  const f = fixture();
  f.loseResponse = f.unavailable = true;
  await assert.rejects(f.helper().deleteExit(input), /read unavailable/);
  f.unavailable = false;
  assert.equal((await f.helper().deleteExit(input)).outcome, 'reconciled');
  assert.equal(f.count(), 1);
});

test('partial reopening blocks another confirmation through either member', async () => {
  const f = fixture();
  f.commitCount = 1;
  for (const target of [input, input, {...input, key: 'other-member', clientId: 2, enrollmentId: 51}]) {
    await assert.rejects(f.helper().deleteExit(target), {code: 'EXIT_DELETION_CONFLICT'});
  }
  assert.equal(f.count(), 1);
});

test('incomplete subgroup or mismatched provider cannot confirm', async () => {
  const f = fixture();
  await assert.rejects(f.helper().deleteExit({...input, providerId: 3}), {reason: 'provider-mismatch'});
  f.exits[0].enrollmentIds.push(99);
  await assert.rejects(f.helper().deleteExit(input), {reason: 'incomplete-exit-subgroup'});
  assert.equal(f.count(), 0);
});

const target = {clientId: input.clientId, enrollmentId: input.enrollmentId, providerId: input.providerId};

test('exit preview reads the selected subgroup and identifies a separate same-day exit', async () => {
  const f = fixture();
  const helper = f.helper();
  assert.deepEqual(await helper.previewExit(target), {
    exitDate: '2026-02-02T00:00:00.000Z', linkedEnrollmentIds: [50, 51], separatelyExitedEnrollmentIds: [52],
  });
  await assert.rejects(helper.previewExit({...target, providerId: 3}), {reason: 'provider-mismatch'});
  f.exits[0].enrollmentIds.push(52);
  await assert.rejects(helper.previewExit(target), {reason: 'incomplete-exit-subgroup'});
  assert.equal(f.count(), 0);
  assert.deepEqual(f.journal(), []);
});

test('confirmed date and membership prevent stale exit deletion', async () => {
  for (const mode of ['date', 'members']) {
    const f = fixture();
    const helper = f.helper();
    const preview = await helper.previewExit(target);
    if (mode === 'date') {
      for (const exit of f.exits.slice(0, 2)) exit.projectExitDate = '2026-02-03T00:00:00Z';
    } else {
      for (const exit of f.exits.slice(0, 2)) {
        Object.assign(exit, {exitSubgroupId: 'own-' + exit.enrollmentId, enrollmentIds: [exit.enrollmentId], clientIds: [exit.clientId]});
      }
    }
    await assert.rejects(helper.deleteExit({...input, expectedExitDate: preview.exitDate,
      expectedEnrollmentIds: preview.linkedEnrollmentIds}), {reason: mode === 'date' ? 'exit-date-changed' : 'exit-members-changed'});
    assert.equal(f.count(), 0);
    assert.deepEqual(f.journal(), []);
  }
});

test('same-key exit recovery retains staff confirmation and never confirms twice', async () => {
  const f = fixture();
  const helper = f.helper();
  const preview = await helper.previewExit(target);
  const confirmed = {...input, expectedExitDate: preview.exitDate, expectedEnrollmentIds: preview.linkedEnrollmentIds};
  const separate = structuredClone(f.exits[2]);
  f.loseResponse = f.unavailable = true;
  await assert.rejects(helper.deleteExit(confirmed), /read unavailable/);
  f.unavailable = false;
  await assert.rejects(helper.deleteExit({...input, expectedEnrollmentIds: [50]}), {reason: 'intent-changed'});
  const result = await helper.deleteExit({...confirmed, expectedExitDate: '2026-02-01T19:00:00-05:00', expectedEnrollmentIds: [51, 50]});
  assert.equal(result.outcome, 'reconciled');
  assert.deepEqual(result.reopenedEnrollmentIds, [50, 51]);
  assert.deepEqual(f.exits[2], separate);
  assert.deepEqual(await helper.previewExit(target), {
    exitDate: null, linkedEnrollmentIds: [], separatelyExitedEnrollmentIds: [52],
  });
  await assert.rejects(helper.deleteExit({...confirmed, key: 'new-key'}), {reason: 'exit-date-changed'});
  assert.equal(f.count(), 1);
});

test('UI scopes the trash to Edit Exit and journals before clicking Yes', {skip: !process.env.WELLSKY_TEST_CHROME}, async () => {
  const {chromium} = await import('playwright-core');
  const browser = await chromium.launch({executablePath: process.env.WELLSKY_TEST_CHROME, headless: true});
  try {
    const sprite = 'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAAU0lEQVR42mNgGAWUAoeIBAXb4OT7tiHJ/1EwUAwkR5ahGIYRiQePBXQBNHf9qAWjFoxaMGoBcRY8JNoCYN1AhgUp/kDNN4iw4KJdcIrXaNVMNgAAYqyJxS7axF0AAAAASUVORK5CYII=';
    const trap = `<img aria-hidden="false" class="gwt-Image" tabindex="0" style="width:24px;height:24px;background:url(data:image/png;base64,${sprite})">`;
    for (const wrongPrompt of [false, true]) {
      const page = await browser.newPage();
      await page.route('**/*', route => route.fulfill({contentType: 'text/html', body: `
        <div>Client - (1)</div>
        <img id="ClientEntryExitTab.editExit-imageLink_50" title="Edit Exit" width="24" height="24">
        ${trap}
        <div id="exit" role="dialog" hidden>
          <h2>Edit Exit Data - (1)</h2>
          ${trap}
          <button id="ExitDataPopup.cancel-button">Cancel</button>
        </div>
        <div id="confirm" role="alertdialog" aria-label="Please Confirm" hidden>
          <p>${wrongPrompt ? 'Are you sure you want to delete this Entry / Exit (#50)?' : 'Are you sure you want to delete this Exit Data?'}</p>
          <div role="button" tabindex="0">Yes</div><div role="button" tabindex="0">No</div>
        </div>
        <script>
          window.events = [];
          const popup = document.querySelector('#exit'), confirm = document.querySelector('#confirm');
          document.querySelector('[title="Edit Exit"]').onclick = () => { events.push('edit'); popup.hidden = false; };
          document.querySelector('body > img.gwt-Image').onclick = () => events.push('wrong-icon');
          popup.querySelector('img').onclick = () => { events.push('trash'); confirm.hidden = false; };
          popup.querySelector('button').onclick = () => { events.push('cancel'); popup.hidden = true; };
          confirm.children[1].onclick = () => { events.push('yes'); confirm.hidden = popup.hidden = true; };
          confirm.children[2].onclick = () => { events.push('no'); confirm.hidden = true; };
        </script>`}));
      await page.goto(connection.moduleBaseUrl + 'index.html');
      const ui = createExitDeletionUi({page});
      const run = () => ui.withLock(() => ui.confirmDelete(input, () => page.evaluate(() => events.push('journal'))));
      if (wrongPrompt) await assert.rejects(run(), {reason: 'unsupported-confirmation'});
      else await run();
      assert.deepEqual(await page.evaluate(() => events),
        wrongPrompt ? ['edit', 'trash', 'no', 'cancel'] : ['edit', 'trash', 'journal', 'yes']);
      await page.close();
    }
  } finally {
    await browser.close();
  }
});
