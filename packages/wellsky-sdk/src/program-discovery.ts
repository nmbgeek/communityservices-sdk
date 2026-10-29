import type { WellSkyClient } from "./generated/v3.js";
import type { Provider } from "./generated/v3-models.js";
import type { RequestOptions } from "./runtime.js";
import { WellSkyError } from "./runtime.js";
import { ValidationError } from "./errors.js";
import { isRecord } from "./validation.js";

export interface ProgramCatalogReader { providers: Pick<WellSkyClient["providers"], "list"> }
export interface ProgramCatalogRequest extends RequestOptions {
  /** Optional immediate parent filter; this does not recursively include descendants. */
  parentProviderId?: number;
  /** Default true. Inactive/nonoperational records are omitted even if the server ignores filters. */
  availableOnly?: boolean;
  /** Stop with an error rather than return an incomplete catalog. Default 100 pages. */
  maxPages?: number;
}
export interface ProgramCatalog {
  source: "rest-providers";
  /** Providers include agencies and parent organizations, not only enrollable programs.
   * Visibility here does not prove the caller may enroll or record services at a provider. */
  providers: Provider[];
  /** Provider 0 is the vendor/system record, not an application program choice. */
  excludedSystemProviderIds: number[];
  retrievedAt: string;
  assessmentAssignments: "requires-browser-discovery";
}

function catalogProvider(value: unknown): Provider & { providerId: number } {
  if (!isRecord(value) || typeof value.providerId !== "number" || !Number.isSafeInteger(value.providerId) || value.providerId < 0 ||
      typeof value.providerName !== "string" || typeof value.active !== "boolean" || typeof value.operational !== "boolean" || typeof value.hudCompliant !== "boolean" ||
      !(value.parentProviderID === null || (typeof value.parentProviderID === "number" && Number.isSafeInteger(value.parentProviderID) && value.parentProviderID >= 0)) ||
      !(value.providerGrantType === null || typeof value.providerGrantType === "string") || typeof value.dateAdded !== "string" || typeof value.dateUpdated !== "string") throw new WellSkyError("protocol", "program catalog");
  return {providerId:value.providerId, providerName:value.providerName, active:value.active, operational:value.operational, hudCompliant:value.hudCompliant,
    parentProviderID:value.parentProviderID, providerGrantType:value.providerGrantType, dateAdded:value.dateAdded, dateUpdated:value.dateUpdated};
}

/** Uses the provider route's counted {count, values} envelope. That route returns 404
 * beyond its final page, so generic empty-page pagination cannot prove completion. */
export async function readProgramCatalog(client: ProgramCatalogReader, options: ProgramCatalogRequest = {}): Promise<ProgramCatalog> {
  const { parentProviderId, availableOnly = true, maxPages = 100, ...request } = options;
  if ((parentProviderId !== undefined && (!Number.isSafeInteger(parentProviderId) || parentProviderId < 1)) ||
      typeof availableOnly !== "boolean" || !Number.isSafeInteger(maxPages) || maxPages < 1) throw new ValidationError("program catalog");
  request.signal?.throwIfAborted();
  // The live providerId sort and parentProviderID query aliases are broken upstream.
  // Retain the server default order and filter the immediate parent locally.
  const providers: Provider[] = [], ids = new Set<number>(), excludedSystemProviderIds: number[] = [];
  let expectedCount: number | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const response: unknown = await client.providers.list({...request, query:{perPage:100,startPage:page,total_count:true,...(availableOnly?{query:"active eq true and operational eq true"}:{})}});
    request.signal?.throwIfAborted();
    if (!isRecord(response) || typeof response.count !== "number" || !Number.isSafeInteger(response.count) || response.count < 0 || !Array.isArray(response.values)) throw new WellSkyError("protocol", "program catalog");
    if (expectedCount !== undefined && response.count !== expectedCount) throw new WellSkyError("protocol", "program catalog changed during pagination");
    expectedCount = response.count;
    for (const raw of response.values) {
      const provider = catalogProvider(raw);
      if (ids.has(provider.providerId)) throw new WellSkyError("protocol", "program catalog duplicate provider");
      ids.add(provider.providerId);
      if (provider.providerId === 0) { excludedSystemProviderIds.push(0); continue; }
      if (availableOnly && (provider.active !== true || provider.operational !== true)) continue;
      if (parentProviderId !== undefined && provider.parentProviderID !== parentProviderId) continue;
      providers.push(provider);
    }
    if (ids.size > expectedCount || (!response.values.length && ids.size !== expectedCount)) throw new WellSkyError("protocol", "program catalog incomplete");
    if (ids.size === expectedCount) return {source:"rest-providers", providers, excludedSystemProviderIds, retrievedAt:new Date().toISOString(), assessmentAssignments:"requires-browser-discovery"};
  }
  throw new WellSkyError("pagination", "program catalog");
}
