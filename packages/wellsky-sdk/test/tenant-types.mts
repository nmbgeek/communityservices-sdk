import {chromium} from 'playwright-core';
import {WellSkyClient} from '@choiceapps/communityservices-sdk';
import {openEnrollmentSession,createFileGwtMutationStore,createNeedUi,createNeedRecorder,createServiceUi,createServiceRecorder,type LoginOptions,type IndependentNeedUi,type UiMutationStore} from '@choiceapps/communityservices-sdk/browser';
const options:LoginOptions={tenant:'tenant-a',chromium};
const store=createFileGwtMutationStore('/private/synthetic-journal');
const api=new WellSkyClient({tenant:options.tenant,auth:{kind:'none'}});
const session=await openEnrollmentSession({...options,store});
createServiceRecorder({api,ui:createServiceUi({page:session.page}),store});
createNeedRecorder({ui:createNeedUi({page:session.page}),store});
declare const customUi:IndependentNeedUi;
declare const customStore:UiMutationStore;
createNeedRecorder({ui:customUi,store:customStore,tenant:'tenant-a'});
// @ts-expect-error Custom adapters must identify their tenant.
createNeedRecorder({ui:customUi,store:customStore});
// @ts-expect-error Login must identify the target tenant.
openEnrollmentSession({chromium,store});

// @ts-expect-error Environment classification is not a client option.
new WellSkyClient({tenant:"tenant-a",auth:{kind:"none"},environment:"production"});
// @ts-expect-error Production opt-in is not a client option.
new WellSkyClient({tenant:"tenant-a",auth:{kind:"none"},allowProduction:true});
