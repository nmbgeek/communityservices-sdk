/** Exact Entry/Exit labels exposed by the WellSky UI, shared by browser workflows and ports. */
export const entryExitTypes=Object.freeze(['Basic','Basic Center Program Entry/Exit','HUD','PATH','Quick Call','RHY','Standard','Transitional Living Program Entry/Exit','VA'] as const);
export type EntryExitType=typeof entryExitTypes[number];
