export interface UiConnectionOptions {tenant:string;moduleBaseUrl?:string;}
export interface UiConnection {readonly tenant:string;readonly moduleBaseUrl:string;readonly scope:string;}
/** Resolve a tenant's application URL. Both live and training use this contract. */
export function resolveUiConnection(options:UiConnectionOptions):UiConnection;
