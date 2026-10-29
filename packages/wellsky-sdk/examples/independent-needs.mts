import {
 createNeedRecorder, type IndependentNeedUi, type UiMutationStore,
 type NeedUi, type IndependentNeedInput, type ServiceRecorder,
 type ServiceRecordInput, type ServiceTypeOption,
} from '@choiceapps/communityservices-sdk/browser';

/** Pass createNeedUi({page: session.page}) from a managed browser session. */
export function independentNeeds(ui:IndependentNeedUi,store:UiMutationStore,tenant:string){
 return createNeedRecorder({ui,store,tenant});
}

/** Cache once per tenant, with expiry. clientId is only browser navigation context. */
export function discoverServiceTypes(ui:NeedUi,context:{clientId:number}){
 return ui.listServiceTypes(context);
}

/** Cache per tenant and provider. This does not reread the full taxonomy. */
export function discoverServiceQuicklist(ui:NeedUi,context:{clientId:number;providerId:number}){
 return ui.listServiceQuicklist(context);
}

/** Explicit status/outcome: a PIT need does not imply delivery of a service. */
export function recordPointInTimeNeed(ui:IndependentNeedUi,store:UiMutationStore,input:IndependentNeedInput,tenant:string){
 return independentNeeds(ui,store,tenant).record(input);
}

/** Services accept the discovered taxonomy string; independent needs accept serviceCodeId. */
export function recordChosenService(recorder:ServiceRecorder,type:ServiceTypeOption,input:Omit<ServiceRecordInput,'body'>&{body:Omit<ServiceRecordInput['body'],'serviceCode'>}){
 return recorder.record({...input,body:{...input.body,serviceCode:type.code}});
}
