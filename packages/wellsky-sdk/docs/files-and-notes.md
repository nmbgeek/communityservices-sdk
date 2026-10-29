# Upload files and record notes

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

The snippets assume `session` from [browser session setup](browser-session.md), plus application-owned client, goal, and provider IDs.

## Attachments and goal case notes

After an attachment is adopted or created, retries require its saved attachment ID as well as matching bytes and metadata. A missing attachment or an identical replacement under a different ID is a conflict. Inspect the original record and journal; do not discard the journal to upload another copy.

Conflicts raise the exported `AttachmentConflictError` with code `ATTACHMENT_CONFLICT` and a `reason`: `intent-changed`, `duplicate-name`, `identity-changed`, `content-changed`, or `unresolved`. Managed sessions preserve this error without probing or reauthenticating, so an unrelated expired session cannot turn a confirmed conflict into `SESSION_INTERRUPTED`. The next operation still checks authentication normally. Failed reads and uncertain new upload responses remain subject to session recovery and journal reconciliation.

`session.workflows` provides browser-authenticated reads and writes:

```js
const uploaded = await session.workflows.uploadAttachment({
  clientId,
  location: { kind: 'goal', goalId }, // Or {kind:'profile'} / {kind:'case-plans'}.
  file: { name: 'synthetic.txt', mimeType: 'text/plain', buffer: new TextEncoder().encode('Synthetic test') },
  description: 'Synthetic test attachment',
});
const files = await session.workflows.listAttachments(clientId);
const bytes = await session.workflows.downloadAttachment({
  clientId, attachmentId: uploaded.attachment.attachmentId,
});
const note = await session.workflows.createCaseNote({
  key: sourceGoalNoteId, clientId, goalId, providerId,
  noteDate: '2026-10-21', note: 'Synthetic progress note',
});
const notes = await session.workflows.listCaseNotes({clientId, goalId});
```

Uploads are limited to 10,000,000 bytes and verified by downloading and hashing the stored bytes. Repeating the same client/location/name/content/description returns the existing attachment. Reusing the name with different content or description is a conflict. Supply a stable source key for case notes. Reusing it with changed intent raises `CASE_NOTE_SOURCE_CONFLICT`; saved note identity is also checked. Unkeyed legacy calls match the goal, client, provider, exact text, and browser-local calendar date. The helper verifies the provider shown by the goal's note form and saves only for the requested client. It does not switch providers or create notes for multiple household members. Existing identical notes are returned; partial or uncertain attempts are never automatically repeated. These helpers use the same durable store and do not change file visibility settings.

The UI uses authenticated multipart `uploadAttachment` and `downloadAttachment`, while REST uses `fileAttachments.createForClient`/`getForClient` with credentials in the body in addition to the REST token. REST entity labels are `Client Profile`, `Case Plans`, and `Goal`; the UI uses `SpClient`, `CasePlans`, and `SpGoal`. In the tested tenant both REST attachment calls returned a credential/token mismatch even with the token account's credentials. Browser upload/readback succeeded at all three locations. Profile lists include attachments from other locations and paginate at five rows. No anonymous-access or other-provider visibility claim was tested.

Further authentication testing reproduced the failure with native JSON and multipart requests outside the SDK. Ordinary client reads succeeded with the same fresh token. `SetAuthKey` issued a user-ID claim containing literal single quotes, which may affect attachment identity comparisons, but the server's root cause is unconfirmed. Alternate documented authentication routes did not yield a working attachment token. No password transformation or token modification is applied by the SDK.

Use [journaled case-plan helpers](durable-records.md#create-and-update-client-notes-goals-and-action-steps) for Client Notes, goals, and action steps. Raw REST create/update/read methods are also available but do not provide durable retry protection. Include `clientId` when updating a goal; the tested server rejected an update without it despite the optional Swagger field. Goal case notes use the paper icon in the Notes column or Add Case Note inside the goal; they are distinct from Client Notes. The REST goal response did not expose these case notes. Observed goal responses also included unrelated `households` rows while the goal had no household association; do not use that nested array to choose clients for a write.
