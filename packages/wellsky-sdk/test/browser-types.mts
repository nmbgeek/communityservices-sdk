import {chromium} from 'playwright-core';
import {openEnrollmentSession,createPlaywrightEnrollmentHelpers,createClientWorkflows,createFileGwtMutationStore} from '../browser/index.mjs';
import {createServiceUi,createServiceRecorder} from '../browser/index.mjs';
import {WellSkyClient} from '../dist/esm/index.js';
const store=createFileGwtMutationStore('/private/synthetic-journal');
const session=await openEnrollmentSession({tenant:"tenant-a",chromium,store});
const helpers=createPlaywrightEnrollmentHelpers({page:session.page,store,tenant:'synthetic',moduleBaseUrl:'https://example.test/synthetic/com.bowmansystems.sp5.core.ServicePoint/'});
void helpers.addHouseholdMembers({clientId:1,enrollmentId:2,memberClientIds:[3]});
const workflows=createClientWorkflows({page:session.page,store});
void workflows.uploadAttachment({clientId:1,location:{kind:'goal',goalId:2},file:{name:'synthetic.txt',buffer:new Uint8Array([65])}});
// @ts-expect-error A goal attachment needs its goal ID.
void workflows.uploadAttachment({clientId:1,location:{kind:'goal'},file:{name:'x',buffer:new Uint8Array([65])}});
const serviceUi=createServiceUi({page:session.page});
const api=new WellSkyClient({tenant:'tenant-b',auth:{kind:'none'}});
const recorder=createServiceRecorder({api,ui:serviceUi,store});
void serviceUi.listFundingSources({context:{clientId:1,serviceId:2,providerId:3},providerId:4,serviceCodeId:5});
void recorder.recordBulk([{key:'stable-source-row-1',body:{clientId:1,serviceProvider:2,serviceCode:'PH-1000',serviceStartDate:'2026-10-22T12:00:00Z',serviceEndDate:'2026-10-22T12:00:00Z'}}]);
// @ts-expect-error Funding allocations require both fund and funding-cycle IDs.
void recorder.record({key:'x',body:{clientId:1,serviceProvider:2,serviceCode:'PH-1000',serviceStartDate:'x',serviceEndDate:'x'},fundingSources:[{fundId:1,name:'Fund',amount:1}]});

void openEnrollmentSession({tenant:"tenant-a",chromium,store,passwordRecovery:{store,appendCharacter:'!'}});
const recoveryOutcome:'restored-original'|'not-needed'=session.passwordRecovery;
void recoveryOutcome;

void session.ensureAuthenticated();
void session.reauthenticate();
void openEnrollmentSession({tenant:"tenant-a",chromium,store,passwordRecovery:false});
void openEnrollmentSession({tenant:"tenant-a",chromium,store,passwordRecovery:{appendCharacter:'!'}});

import {getSsvfServiceRules,type SsvfInformation} from '../browser/index.mjs';
const va:SsvfInformation={typeOfSsvfService:'Assistance obtaining VA benefits',ifObtainingVaAssistanceBenefits:'Health care services'};
void getSsvfServiceRules(va);
const other:SsvfInformation={typeOfSsvfService:'Other (non-TFA) supportive service approved by VA',ifOtherNonTfaSupportiveServiceApprovedByVa:'Synthetic service'};
void other;
// @ts-expect-error A VA benefits detail cannot belong to an outreach service.
const wrongBranch:SsvfInformation={typeOfSsvfService:'Outreach services',ifObtainingVaAssistanceBenefits:'Health care services'};
// @ts-expect-error Direct provision has a smaller picklist than coordination.
const wrongOption:SsvfInformation={typeOfSsvfService:'Direct provision of other public benefits',ifDirectProvisionOfOtherPublicBenefits:'Health care services'};
void wrongBranch;void wrongOption;

import {createClientProfile,createClientProfileUi} from '../browser/index.mjs';
const profile=createClientProfile({api,store,ui:createClientProfileUi({page:session.page})});
void profile.update({clientId:1,key:'profile-1',changes:{sex:'Female'}});
void profile.update({clientId:1,key:'profile-2',dateEffective:'2026-10-23T16:00:00Z',changes:{middleName:'Synthetic',veteranStatus:'No (HUD)'}});
// @ts-expect-error Legacy Gender is not the separate Client Record Sex field.
void profile.update({clientId:1,key:'bad',changes:{svpprofgender:'Female'}});
// @ts-expect-error Sex options come from the Client Record picklist.
void profile.update({clientId:1,key:'bad-sex',changes:{sex:'Other'}});

import {createDateOfBirth,createDateOfBirthUi} from '../browser/index.mjs';
const birthDate=createDateOfBirth({api,store,ui:createDateOfBirthUi({page:session.page})});
void birthDate.update({clientId:1,key:'dob-1',assessmentCode:'ENTRY',dateOfBirth:'1984-02-29',effectiveDate:'2026-10-23T16:00:00Z'});
void birthDate.update({clientId:1,key:'dob-2',assessmentCode:'ENTRY',dateOfBirth:'1988-02-29',effectiveDate:'2026-10-23T16:00:00Z',entry:{enrollmentId:2,assessmentName:'Entry'}});
// @ts-expect-error DOB corrections use a calendar string, not a JavaScript Date.
void birthDate.update({clientId:1,key:'dob-3',assessmentCode:'ENTRY',dateOfBirth:new Date(),effectiveDate:'2026-10-23T16:00:00Z'});

import {createEnrollmentWorkflow,createProgramDiscovery,type BirthDateSnapshot} from '../browser/index.mjs';
const birthDates=createDateOfBirth({api,store,ui:createDateOfBirthUi({page:session.page})});
const enrollmentWorkflow=createEnrollmentWorkflow({api,store,birthDates,helpers:session.helpers,enrollmentSession:session.enrollmentSession,discovery:createProgramDiscovery({page:session.page})});
const birthSnapshot:BirthDateSnapshot=await birthDates.read({clientId:1,assessmentCode:'ENTRY'});
void birthSnapshot;
void enrollmentWorkflow.createEnrollment({key:'entry',clientId:1,providerId:2,type:'HUD',entryDate:'2026-10-20T16:00:00Z',assessment:{answers:{SVPPROFDOB:{value:'1984-02-29'}}}});
void birthDates.verify({clientId:1,assessmentCode:'ENTRY',dateOfBirth:'1984-02-29',effectiveDate:'2026-10-20T16:00:00Z',allowLater:true});

import {createHouseholds,createHouseholdUi,createClientCreator,createCasePlans,createCasePlanUi} from '../browser/index.mjs';
void createClientCreator({api,store}).create({sourceId:'veteran',body:{firstName:'Synthetic',lastName:'Person',dateEffective:'2026-10-24T16:00:00Z',veteranStatus:'Yes (HUD)'}});
// @ts-expect-error The unqualified Yes label is not a valid veteran status.
void createClientCreator({api,store}).create({sourceId:'veteran',body:{firstName:'Synthetic',lastName:'Person',dateEffective:'2026-10-24T16:00:00Z',veteranStatus:'Yes'}});
const householdManagement=createHouseholds({api,store,ui:createHouseholdUi({page:session.page})});
void householdManagement.create({key:'household-source',headClientId:1,householdType:'Individual',members:[{clientId:1,relationship:'Self',dateJoined:'2026-10-20T16:00:00Z'}]});
void householdManagement.endMembers({key:'leave',householdId:10,headClientId:1,clientIds:[2],dateEnded:'2026-10-23T16:00:00Z'});
const clientCreator=createClientCreator({api,store});
void clientCreator.create({sourceId:'person-source',body:{firstName:'Synthetic',lastName:'Example',dateEffective:'2026-10-20T16:00:00Z'}});
// @ts-expect-error DOB must use the calendar-date helper, not a raw creation timestamp.
void clientCreator.create({sourceId:'bad',body:{firstName:'Synthetic',lastName:'Example',dateEffective:'2026-10-20T16:00:00Z',svpprofdob:'1980-01-01'}});
const plans=createCasePlans({api,store,ui:createCasePlanUi({page:session.page})});
void plans.createClientNote({key:'note-source',clientId:1,values:{note_date:'2026-10-20T16:00:00Z',note:'Synthetic'}});
void plans.updateGoal({key:'goal-update',clientId:1,recordId:3,values:{goalDescription:'Updated'}});
void plans.createActionStep({key:'action-source',clientId:1,goalId:3,values:{providerId:2,dateSet:'2026-10-20T16:00:00Z',actionStep:'Synthetic step',status:'In Progress'}});
void session.workflows.createCaseNote({key:'case-note-source',clientId:1,goalId:3,providerId:2,noteDate:'2026-10-24',note:'Synthetic'});
