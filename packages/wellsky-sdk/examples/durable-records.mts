import type {WellSkyClient} from '@choiceapps/communityservices-sdk';
import {
	createClientCreator, createHouseholds, createCasePlans,
	type UiMutationStore, type HouseholdUi, type CasePlanUi,
	type ClientCreationInput, type HouseholdMemberInput,
	type NoteValues, type GoalValues, type ActionValues,
	type ClientWorkflows, type ServiceRecorder, type ServiceRecordInput,
} from '@choiceapps/communityservices-sdk/browser';

/** Application-owned dependencies. Use one persistent store across restarts and callers. */
export function durableRecords(api:WellSkyClient, store:UiMutationStore, ui:{households:HouseholdUi;casePlans:CasePlanUi}) {
	return {
		clients:createClientCreator({api,store}),
		households:createHouseholds({api,store,ui:ui.households}),
		casePlans:createCasePlans({api,store,ui:ui.casePlans}),
	};
}
export type DurableRecords = ReturnType<typeof durableRecords>;

/** These source IDs belong to your upstream records. Never regenerate them for a retry. */
export async function createPeopleAndHousehold(records:DurableRecords, input:{
	householdSourceId:string;householdType:string;
	head:ClientCreationInput;member:ClientCreationInput;
	joinedAt:string;memberRelationship:string;
}) {
	const head=await records.clients.create(input.head);
	const member=await records.clients.create(input.member);
	const household=await records.households.create({
		key:input.householdSourceId,headClientId:head.clientId,householdType:input.householdType,
		members:[
			{clientId:head.clientId,relationship:'Self',dateJoined:input.joinedAt},
			{clientId:member.clientId,relationship:input.memberRelationship,dateJoined:input.joinedAt},
		],
	});
	return {head,member,household};
}

/** This adds household membership. Attach the person to a program separately. */
export function addLaterMember(records:DurableRecords, input:{
	key:string;householdId:number;headClientId:number;householdType:string;member:HouseholdMemberInput;
}) {
	const {member,...context}=input;
	return records.households.addMembers({...context,members:[member]});
}

/** No automatic recovery by name or DOB. Call only after verifying the create receipt externally. */
export function resolveMissingClientReceipt(records:DurableRecords, original:ClientCreationInput, verifiedCreatedClientId:number) {
	return records.clients.resolveCreated({...original,clientId:verifiedCreatedClientId});
}

/** Separate keys allow a partially completed sequence to resume. This is not atomic. */
export async function createCasePlan(records:DurableRecords, input:{
	clientId:number;sourceId:string;note:NoteValues;goal:GoalValues;action:ActionValues;
}) {
	const {clientId,sourceId}=input;
	const note=await records.casePlans.createClientNote({key:`${sourceId}:note`,clientId,values:input.note});
	const goal=await records.casePlans.createGoal({key:`${sourceId}:goal`,clientId,values:input.goal});
	const action=await records.casePlans.createActionStep({key:`${sourceId}:action`,clientId,goalId:goal.recordId,values:input.action});
	return {note,goal,action};
}

/** Require a source key even though the SDK keeps legacy unkeyed calls compatible. */
export function writeGoalProgress(workflows:ClientWorkflows, input:Parameters<ClientWorkflows['createCaseNote']>[0]&{key:string}) {
	return workflows.createCaseNote(input);
}

/** Return diagnostics to the application. This example never retries a raw write. */
export async function recordServiceBatch(recorder:ServiceRecorder, rows:ServiceRecordInput[]) {
	const batch=await recorder.recordBulk(rows);
	const failures=batch.results.flatMap(row=>{
		if(row.outcome!=='rejected')return [];
		const nextAction=row.error.code==='SESSION_INTERRUPTED'
			? row.error.reauthenticated?'reconcile-same-key':'authenticate-then-reconcile'
			: 'review-saved-state';
		return [{key:row.key,message:row.message,error:row.error,nextAction}];
	});
	return {...batch,failures};
}
