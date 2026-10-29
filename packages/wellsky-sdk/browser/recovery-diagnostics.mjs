/** Serializable diagnostics only. Never copies response bodies, headers, tokens or request data. */
export function recoveryDiagnostics(error,depth=0){
 const result={name:typeof error?.name==='string'?error.name:'Error'};
 for(const key of ['code','kind','stage','recoveryStage','operation','requestId','correlationId'])if(typeof error?.[key]==='string')result[key]=error[key];
 for(const key of ['status','retryAfterMs'])if(Number.isFinite(error?.[key]))result[key]=error[key];
 if(typeof error?.reauthenticated==='boolean')result.reauthenticated=error.reauthenticated;
 if(depth<2&&error?.cause&&error.cause!==error)result.cause=recoveryDiagnostics(error.cause,depth+1);
 return result;
}
