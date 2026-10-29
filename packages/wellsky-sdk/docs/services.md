# Record services and select Funding Sources

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

The snippets assume an authenticated browser session and a REST `api`. Obtain IDs from the application and current lookups before writing.

## Service recording and Funding Sources

The service recorder combines REST creation with fresh UI completion for fields missing from Swagger. Every successful row has an associated need verified as **Closed / Fully Met**. SSVF service type, assistance type and amount use REST; assistance-period dates and Funding Source allocations use the current UI. Service dates remain separate from the assistance period.

```js
import {createServiceUi, createServiceRecorder,
  createFileGwtMutationStore} from '@choiceapps/communityservices-sdk/browser';

const ui = createServiceUi({page: session.page});
const choices = await ui.listFundingSources({
  // Existing service used only to obtain the current UI lookup and policy.
  context: {clientId, serviceId: existingServiceId, providerId},
  providerId, serviceCodeId: taxonomyCodeId, // Numeric taxonomy ID, not 'BH-3800.7000'.
});
const selected = choices.find(f => f.fundId === selectedFundId && f.fundCycleId === selectedCycleId);
if (!selected) throw new Error('Selected funding source is unavailable');

const recorder = createServiceRecorder({api, ui,
  store: createFileGwtMutationStore('/private/path/service-journal')});
const report = await recorder.recordBulk([{
  key: 'external-system-stable-row-id',
  body: {
    clientId, serviceProvider: providerId, serviceCode: 'BH-3800.7000',
    serviceStartDate: '2026-10-22T12:15:00-04:00',
    serviceEndDate: '2026-10-22T12:15:00-04:00',
    serviceNote: 'Synthetic example',
    ssvfInformation: {typeOfSsvfService: 'Shallow Subsidy',
      ssvfFinancialAssistanceType: 'Rental assistance', ssvfFinancialAssistanceAmount: 925},
  },
  financialAssistancePeriod: {
    start: '2026-10-01T12:00:00-04:00', end: '2026-10-31T12:00:00-04:00',
  },
  fundingSources: [{fundId:selected.fundId, fundCycleId:selected.fundCycleId,
    name:selected.name, amount:925}],
}], {onResult: result => saveApplicationProgress(result)});
```

Use IDs from the actual lookup, not the example IDs. Choices include names, descriptions, balances and submission deadlines; a null balance is not zero. Availability is provider/service/session dependent. The lookup needs a permitted existing service context but makes no record changes. The numeric service-code ID is available as `codeId` on the associated need; it is distinct from the taxonomy string used to create services.

`recordBulk` structurally validates all rows first, saves sequentially, stops at the first failure, and reports fulfilled/rejected/skipped rows. Cancellation applies between rows. Keep stable row keys and the same durable journal when retrying or reordering a batch. The recorder appends a deterministic marker to each service note. It never blindly repeats an uncertain REST create or UI save; partial saves may require manual reconciliation. Server business validation can fail after REST creation because UI completion is not atomic. Batches accept up to 10,000 rows; this is a bound, not a throughput guarantee. File journals coordinate one host; multiple hosts require a shared durable lock/store. Browser completion is experimental. Low-level REST `api.bulk` remains available but does not provide these service/need completion guarantees.

The recorder pins the service and associated need IDs in the journal. A retry rejects a different returned service ID, a changed need association, or a need readback with the wrong ID or an explicitly inactive state. Matching status text alone does not establish identity. Older journals without a need ID pin the first validated service readback before UI work; they cannot prove the historical need association before that observation.

If `onResult` throws, `callbackFailed` is true and remaining rows are skipped. The completed row keeps its actual outcome. Restore application progress from the returned report and reconcile with the original keys before resuming; a failed progress callback does not undo a saved service.

Live evidence, confirmed fields, UI request sequence and limitations are in [service findings](capabilities.md).

Use `getSsvfServiceRules({typeOfSsvfService, ssvfFinancialAssistanceType})` to obtain the choices reproduced in a sandbox tenant, visible dependent fields, required flags, limits and REST/UI mappings. The recorder supports the three dependent benefit picklists and the Other explanation. Nonfinancial services no longer require a financial type or amount. Selecting a financial type requires both assistance dates. Invalid choices and answers for an inactive service branch fail before writes, including anywhere in a bulk batch. See [SSVF field rules and examples](../SSVF.md) for every choice and the scope of the UI verification.

Rejected bulk rows retain a `message` and structured `error` fields, including the failed stage, code, kind, status, reauthentication result, and bounded causes when available. Use the [recovery example](../examples/durable-records.mts) to return those diagnostics to your application. A `SESSION_INTERRUPTED` result does not authorize automatic replay of the REST create or UI save.

## Independent needs and available service types

Use [the shared service-type catalog](independent-needs.md) to choose from the provider quicklist or broader AIRS/service taxonomy. Supply its `code` to `body.serviceCode`. For a PIT need without service delivery, use `createNeedRecorder`; its status and outcome are explicit and it creates no service or referral.

Applications should [cache the catalog](independent-needs.md#cache-the-catalog-in-your-application) once per tenant, with quicklists cached separately per provider/program rather than rereading thousands of terms for every form. Keep transaction verification reads fresh.

## Shelter services and beds

Use [the shelter guide](shelters.md) for bed assignments and enrollment coverage. The ordinary service recorder does not check clients into beds or maintain night-by-night shelter enrollments. Shelter inventory reporting, live bed availability, and service-type catalogs are separate data.
