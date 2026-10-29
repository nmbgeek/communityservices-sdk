# Create clients, households, and case plans safely

[Documentation index](README.md) · [Typed integration example](../examples/durable-records.mts) · [Recovery](troubleshooting.md)

These helpers require a V3 `WellSkyClient` configured for the target tenant. The browser adapters require a dedicated authenticated page. All snippets below are integration fragments: your application supplies the IDs, source keys, dates, and values. No example logs in or writes on import.

## Set up the helpers

```js
import {
	createFileGwtMutationStore, createClientCreator,
	createHouseholds, createHouseholdUi,
	createCasePlans, createCasePlanUi,
} from '@choiceapps/communityservices-sdk/browser';

const store = createFileGwtMutationStore(journalDirectory);
const clients = createClientCreator({api, store});
const households = createHouseholds({
	api, store, ui: createHouseholdUi({page: session.page}),
});
const casePlans = createCasePlans({
	api, store, ui: createCasePlanUi({page: session.page}),
});
```

Use the same private journal directory on every retry and process restart. The file store coordinates one host. Multiple hosts need a shared durable locking implementation. These operations are not atomic across entities, and external writers do not use the SDK's lock.

## Map a source person to a client

```js
const original = {
	sourceId: sourcePersonId,
	body: {firstName, lastName, dateEffective: effectiveInstant},
};
const created = await clients.create(original);
const mapping = await clients.lookup(sourcePersonId);
```

`create` records the server-returned client ID and verifies the supported identity fields. An identical source-ID retry returns that ID without another create. A changed creation intent under the same source raises `SOURCE_ID_CONFLICT`. To edit a person later, use the [profile helpers](profiles.md), not a revised creation request. After a legitimate profile edit, `lookup` retrieves the mapping; replaying the old create can reject the changed fields.

Name and SSN candidate matches raise `POSSIBLE_DUPLICATE` with `candidateClientIds`. They never select, link, or merge a person automatically. After reviewing those candidates, an application can explicitly create a distinct person with `allowDistinctClient: true`. Retain that flag with the original intent on retries. The helper does not perform demographic deduplication or fuzzy matching.

If the create response is lost before an ID is durably saved, `CLIENT_CREATE_UNCERTAIN` blocks another create. Verify the server's creation receipt or the target record independently. Only then call:

```js
const recovered = await clients.resolveCreated({
	...original, clientId: verifiedCreatedClientId,
});
```

This records an explicitly verified mapping and performs no server write. It does not find the client for you. Never obtain the ID by automatically choosing a name or DOB match. An ID already mapped to another source is rejected.

Supported creation fields are names, suffix, alias, name quality, SSN and its quality, veteran status, and the explicit effective instant. Use the [DOB helper](profiles.md#birth-dates) for calendar birth dates and the profile/assessment helpers for other fields. Unsupported fields are rejected. The exact input and result contracts are in [client-creation.d.mts](../browser/client-creation.d.mts).

For `veteranStatus`, omit the field or supply exactly `Yes (HUD)`, `No (HUD)`, `Client doesn't know (HUD)`, `Client prefers not to answer (HUD)`, or `Data not collected (HUD)`. Other values, including `Yes`, `No`, and an empty string, raise `INVALID_VETERAN_STATUS` before API access or journal reservation. The helper does not translate aliases. An invalid label accepted by REST can later break service reads or return an error after a service has already been created. This validation does not repair older client records or journals. Review those records and retain the original journal rather than changing a saved creation intent to bypass a conflict. Profile updates validate veteran status against the current UI choices.

## Create and manage a household

```js
const createdHousehold = await households.create({
	key: sourceHouseholdId,
	headClientId,
	householdType,
	members: [
		{clientId: headClientId, relationship: 'Self', dateJoined: joinedAt},
		{clientId: memberClientId, relationship: memberRelationship, dateJoined: joinedAt},
	],
});
const householdId = createdHousehold.household.householdId;
```

`getHouseholdOptions()` returns the verified sandbox labels and their verification date. It is a dated snapshot, not a live configuration query. Use one head with relationship `Self`, unique member IDs, and timezone-qualified join dates. The head's join date must cover every member's membership. Existing invalid head state is a data error and blocks mutation.

Add a child or another person with their own later join date:

```js
await households.addMembers({
	key: sourceMembershipId, householdId, headClientId, householdType,
	members: [{clientId: childClientId, relationship: 'Daughter', dateJoined: childJoinedAt}],
});
await households.updateRelationships({
	key: sourceRelationshipChangeId, householdId, headClientId,
	members: [{clientId: memberClientId, relationship: 'Significant other'}],
});
await households.endMembers({
	key: sourceDepartureId, householdId, headClientId,
	clientIds: [memberClientId], dateEnded: memberLeftAt,
});
```

The helper preserves unrelated members, previous join dates, and ended records. Existing membership cannot be silently replaced or rejoined. The head cannot leave an active household, be demoted, or be replaced through these methods. Household closure and retroactive head corrections need separate workflows.

Household membership is separate from program enrollment. After creating the household, pass its ID to the [household enrollment workflow](enrollments.md). A later child must first belong to the household, then be attached to the program with their own entry date and assessment. Ending household membership does not exit a program. Program exits continue to use the enrollment head-coverage guards.

Creation and changes reconcile exact saved state after uncertain responses. Completed retries also recognize subsequent verified changes in the same journal. External drift and unresolved attempts block writes. See [households.d.mts](../browser/households.d.mts) for all methods.

## Create and update Client Notes, goals, and action steps

```js
const note = await casePlans.createClientNote({
	key: sourceClientNoteId, clientId,
	values: {note_date: noteInstant, note: clientNoteText},
});
const goal = await casePlans.createGoal({
	key: sourceGoalId, clientId,
	values: {
		providerId, dateGoalsSet: goalInstant, classification: 'Case Plan',
		type: 'Develop a Case Plan', overallStatus: 'In Progress',
		goalDescription,
	},
});
const action = await casePlans.createActionStep({
	key: sourceActionId, clientId, goalId: goal.recordId,
	values: {providerId, dateSet: actionInstant, actionStep, status: 'In Progress'},
});
```

Choose classification, type, and status values from the actual tenant form. The strings above are verified sandbox examples, not universal options. Each operation checks ownership and verifies its supported fields after saving. A sequence can stop partway through. Reuse every original key when resuming; the [typed example](../examples/durable-records.mts) gives each component its own stable suffix.

Use a new source key for an intentional update:

```js
await casePlans.updateClientNote({
	key: sourceNoteRevisionId, clientId, recordId: note.recordId,
	values: {note: revisedText},
});
await casePlans.updateGoal({
	key: sourceGoalRevisionId, clientId, recordId: goal.recordId,
	values: {goalDescription: revisedDescription, percentComplete: '50%'},
});
await casePlans.updateActionStep({
	key: sourceActionRevisionId, clientId, goalId: goal.recordId,
	recordId: action.recordId, values: {actionStep: revisedAction},
});
```

Update requests preserve the helper's supported unmodified fields. Unreadable follow-up fields are not exposed as writable helper fields. Percent complete uses UI labels `10%` through `90%`, or an empty string; numeric string `50` is invalid. Consult [case-plans.d.mts](../browser/case-plans.d.mts) for field coverage. Initial empty REST results need fresh UI confirmation. Failed or incomplete reads never authorize a repeat write.

Client Notes differ from goal case notes. The latter use the Goal's **Add Case Note** button or the Notes-column paper icon. Never use the unrelated `households` array observed in REST goal responses to select note participants.

## Give goal case notes a source key

```js
await session.workflows.createCaseNote({
	key: sourceGoalNoteId, clientId, goalId, providerId,
	noteDate: localCalendarDate, note: goalNoteText,
});
```

A keyed retry must retain the same client, goal, provider, calendar date, and text. Changed intent raises `CASE_NOTE_SOURCE_CONFLICT` before browser access. The journal also verifies the saved note ID. The key is optional only for compatibility: unkeyed calls retain text/date/provider matching. Identical existing notes can be reconciled; a new source key is not a command to force a duplicate. Notes are single-client operations.

## Return service diagnostics to the application

Rejected `recordBulk` rows include `message` and structured `error` metadata. Fields include `code`, `kind`, `stage`, `status`, `reauthenticated`, and bounded causes when available. These are optional because some failures are ordinary JavaScript errors. The [typed example](../examples/durable-records.mts) retains them and returns an application action without replaying any write.

For `SESSION_INTERRUPTED`, check `reauthenticated`. Resume with the same row keys and journal only after authentication is ready. Other failures need saved-state review. Keep fulfilled and skipped rows in the application's report. A successful REST create may still need UI completion and Closed/Fully Met need verification. See [services](services.md) and [recovery](troubleshooting.md).
