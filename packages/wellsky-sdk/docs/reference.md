# Public helper reference

[Documentation index](README.md) · [Generated HTTP methods](../API.md)

Only the package export paths below are supported import entry points. Declaration links are files for inspection, not extra runtime import paths. The documentation check compares this inventory with the built runtime exports.

## REST and shared helpers

Import from `@choiceapps/communityservices-sdk`, `@choiceapps/communityservices-sdk/v3`, or `@choiceapps/communityservices-sdk/v2`. The root selects V3 and also exports the testing helpers. Each version supplies its own generated HTTP models and fixed version header.

Runtime exports at the root: `AmbiguousCommitError`, `AssessmentMetadata`, `AuthError`, `CooldownError`, `DefinitionDriftError`, `FakeControl`, `FakeWellSkyClient`, `GwtEnrollmentConflictError`, `GwtEnrollmentHelpers`, `SubassessmentEditor`, `TenantMismatchError`, `ThrottledError`, `UnknownPicklistValueError`, `UpstreamError`, `ValidationError`, `WellSkyClient`, `WellSkyError`, `apiVersion`, `buildAssessmentDefinition`, `compareDefinition`, `createFakeWellSkyClient`, `createInMemoryGwtMutationStore`, `createWellSkyClient`, `encodeAnswers`, `encodeNewSubassessmentRow`, `flattenQuestions`, `mapBulk`, `operationRoutes`, `readEnrollmentVerifications`, `readOutcome`, `readProgramCatalog`, `resolvePicklistOption`, `semanticHash`, `specSha256`, `toItems`, `verifyWrite`.

| Contract | Declaration | Guide |
| --- | --- | --- |
| HTTP clients and generated models | [V3](../dist/esm/generated/v3.d.ts), [V2](../dist/esm/generated/v2.d.ts) | [REST](rest-client.md), [API table](../API.md) |
| Authentication, transport, responses and errors | [Runtime](../dist/esm/runtime.d.ts) | [Configuration](configuration.md), [recovery](troubleshooting.md) |
| Metadata and picklists | [Metadata](../dist/esm/metadata.d.ts) | [Assessments](assessments.md) |
| Answer encoding | [Encoding](../dist/esm/encoding.d.ts) | [Dates and answers](dates-and-answers.md) |
| Write verification | [Verification](../dist/esm/verification.d.ts) | [REST](rest-client.md) |
| Program catalog | [Program discovery](../dist/esm/program-discovery.d.ts) | [Enrollments](enrollments.md) |
| Enrollment verification intervals | [Snapshot](../dist/esm/enrollment-verifications.d.ts) | [Assessments](assessments.md) |
| Low-level GWT enrollment sessions | [GWT](../dist/esm/gwt-enrollments.d.ts) | [Browser sessions](browser-session.md) |

## Browser helpers

Import from `@choiceapps/communityservices-sdk/browser` in server-side ESM. These helpers use the tenant supplied by your application. Browser interfaces require `playwright-core`; some orchestration helpers use REST plus injected UI ports rather than directly launching a browser.

Runtime exports: `AttachmentConflictError`, `EnrollmentWorkflowError`, `LoginError`, `SessionInterruptedError`, `createFileGwtMutationStore`, `createPlaywrightEnrollmentHelpers`, `createPlaywrightGwtSession`, `createCasePlanUi`, `createCasePlans`, `createClientCreator`, `createClientProfile`, `createClientProfileUi`, `createClientWorkflows`, `createDateOfBirth`, `createDateOfBirthUi`, `createEnrollmentWorkflow`, `createHouseholdExitUi`, `createHouseholdUi`, `createHouseholds`, `createMemberEntryDatePort`, `createProgramDiscovery`, `createServiceRecorder`, `createServiceUi`, `getHouseholdOptions`, `getSsvfServiceRules`, `openEnrollmentSession`, `openUiSession`, `validateBirthDate`, `resolveUiConnection`.

| Task | Contract | Methods or behavior |
| --- | --- | --- |
| Login, session, file journal, uploads and goal case notes | [Browser index](../browser/index.d.mts) | Session lifecycle, `uploadAttachment`, `createCaseNote` with optional source key |
| Client creation | [Client creation](../browser/client-creation.d.mts) | `create`, `lookup`, `resolveCreated`; no automatic demographic matching |
| Household management | [Households](../browser/households.d.mts) | `create`, `read`, `addMembers`, `endMembers`, `updateRelationships`; head guards |
| Client Notes, goals and action steps | [Case plans](../browser/case-plans.d.mts) | Create/update methods, supported value fields and record IDs |
| Profile fields and Sex | [Client profile](../browser/client-profile.d.mts) | `read`, `update` |
| Calendar DOB | [Birth dates](../browser/date-of-birth.d.mts) | `read`, `validate`, `verify`, `update` |
| Provider assessment defaults | [Discovery](../browser/program-discovery.d.mts) | `listAssessments`, `getProviderAssessments` |
| Enrollment and household lifecycle | [Workflow](../browser/enrollment-workflow.d.mts) | Discovery, entry, member additions, interim, exit, journal status |
| Entry-date and exit UI ports | [Member entry](../browser/member-entry-date.d.mts), [exit](../browser/household-exit.d.mts) | Fresh reads and targeted completion |
| Services and recovery diagnostics | [Service recording](../browser/service-recording.d.mts) | `record`, `recordBulk`, Funding Sources, `RecoveryDiagnostic` |
| SSVF conditional rules | [SSVF types](../browser/ssvf-rules.d.mts) | [Field rules](../SSVF.md) and dated option snapshots |

Use the [durable-record guide](durable-records.md) and [shipped examples](../examples/README.md) for integration sequences. A type declaration describes accepted inputs; the [capabilities](capabilities.md) page states what has live evidence and what remains unsupported.

## Testing helpers

Import from `@choiceapps/communityservices-sdk/testing`. Runtime exports: `FakeControl`, `FakeWellSkyClient`, `createFakeWellSkyClient`. The [testing declarations](../dist/esm/testing.d.ts) define scripted replies, request capture, and commit-then-error behavior. The fake transport never falls through to the real network.

Independent need recording and service-type discovery: [guide](independent-needs.md), [declarations](../browser/need-recording.d.mts).

Exports: `createNeedRecorder`, `createNeedUi`, `NeedConflictError`.

### Shelter stays

`readShelterProgram` reads the REST provider tracking method. `createShelters` provides journaled `checkIn`, `checkout`, `getProgram`, and explicit `cancelUnsubmittedCheckIn` operations. Cancellation never deletes server records and refuses attempted shelter saves. `createShelterUi` supplies fresh UI forms and counted GWT enrollment reads. `ShelterConflictError` reports `SHELTER_CONFLICT` with a stable `reason`.

See [shelter contracts](../browser/shelters.d.mts), [shelter workflow](shelters.md), and [upstream issues](vendor-issues/README.md). Bed operations require named beds, an existing household, and a persistent shared store. The helper does not complete all assessment questions or schedule inactivity exits.

`createShelterInventory` supplies read-only `listUnitLists` and `getInventory` operations on a dedicated application page. Results include named beds, occupants, held and unknown states, overflow, vacancy counts, observation timestamps, and explicit completeness. `ShelterInventoryError` exposes `SHELTER_INVENTORY_UNAVAILABLE` and a sanitized `reason`. See the [inventory guide](shelter-inventory.md) and [inventory types](../browser/shelter-inventory.d.mts) for identity limits and future-checkout behavior.

### Current Living Situation

`createCurrentLivingSituationRecorder` and `CurrentLivingSituationConflictError`: [contact guide](current-living-situation.md), [declarations](../browser/current-living-situation.d.mts). `record` creates one journaled row per meaningful contact and verifies exact dates, answers, and recordset identity.
