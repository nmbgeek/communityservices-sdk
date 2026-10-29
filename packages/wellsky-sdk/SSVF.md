# SSVF service fields

The browser SDK exposes `getSsvfServiceRules()` for application forms and validates these rules in `record` and `recordBulk` before reserving a journal entry or writing records. This is a verified snapshot of a service form reproduced in a sandbox tenant under an SSVF RRH provider on October 23, 2026. It is not a live provider configuration query or a statement of reporting requirements. The low-level REST client retains the supplied Swagger contract.

```js
import {getSsvfServiceRules} from '@choiceapps/communityservices-sdk/browser';
const rules = getSsvfServiceRules({
  typeOfSsvfService: 'Assistance obtaining VA benefits',
});
const visibleFields = rules.fields.filter(field => field.visible);
// Each field includes key, label, control, required, transport and any options/maxLength.
```

Use `rules.serviceTypes` and `rules.financialAssistanceTypes` for choices. Omit unselected values instead of sending `-Select-`, null, or an empty string. When a user changes the service type, clear answers for the previous type. The recorder rejects inactive dependent fields rather than silently dropping them. Rules are returned as copies.

## Service types and dependencies

The service type and all four dependent fields are optional in the inspected UI. Blank values passed client-side validation with save requests intercepted before reaching the server. The Other text box has a 100-character limit. No selection within the three dependent picklists revealed another field.

| Type of SSVF Service | Dependent SDK field | Control | UI required |
| --- | --- | --- | --- |
| Outreach services | None | None | No |
| Case management services | None | None | No |
| Assistance obtaining VA benefits | `ifObtainingVaAssistanceBenefits` | Picklist | No |
| Assistance obtaining/coordinating other public benefits | `ifObtainingCoordinatingOtherPublicBenefits` | Picklist | No |
| Direct provision of other public benefits | `ifDirectProvisionOfOtherPublicBenefits` | Picklist | No |
| Other (non-TFA) supportive service approved by VA | `ifOtherNonTfaSupportiveServiceApprovedByVa` | Text, maximum 100 characters | No |
| Shallow Subsidy | None | None | No |
| Returning Home | None | None | No |
| Rapid Resolution | None | None | No |
| Healthcare Navigation | None | None | No |

### Assistance obtaining VA benefits

UI label: If "Assistance obtaining VA benefits". REST field: `ssvfInformation.ifObtainingVaAssistanceBenefits`.

- VA vocational and rehabilitation counseling
- Employment and training services
- Educational assistance
- Health care services

### Assistance obtaining/coordinating other public benefits

UI label: If "Assistance obtaining/coordinating other public benefits". REST field: `ssvfInformation.ifObtainingCoordinatingOtherPublicBenefits`.

- Health care services
- Daily living services
- Personal financial planning services
- Transportation services
- Income support services
- Fiduciary and representative payee services
- Legal services - child support
- Legal services - eviction prevention
- Legal services - outstanding fines and penalties
- Legal services - restore/acquire driver's license
- Legal services - other
- Child care
- Housing counseling

### Direct provision of other public benefits

UI label: If "Direct provision of other public benefits". REST field: `ssvfInformation.ifDirectProvisionOfOtherPublicBenefits`.

- Personal financial planning services
- Transportation services
- Income support services
- Fiduciary and representative payee services
- Legal services - child support
- Legal services - eviction prevention
- Legal services - outstanding fines and penalties
- Legal services - restore/acquire driver's license
- Legal services - other
- Child care
- Housing counseling

### Other (non-TFA) supportive service approved by VA

UI label: If "Other(Non-TFA) Supportive Service approved by VA". REST field: `ssvfInformation.ifOtherNonTfaSupportiveServiceApprovedByVa`.

Free text. The SDK permits 1 to 100 characters when supplied; omit the field to leave it unanswered.

## Financial assistance

Financial assistance is independent of Type of SSVF Service. The same list remains available for all 10 service types. Shallow Subsidy does not automatically select a financial-assistance type. Type, amount, and both dates must be handled separately.

`ssvfFinancialAssistanceType` has these choices:

- Rental assistance
- Utility fee payment assistance
- Security deposit
- Utility deposit
- Moving costs
- Transportation services: tokens/vouchers
- Transportation services: vehicle repair/maintenance
- Child Care
- General housing stability assistance
- Emergency housing assistance
- Shallow subsidy financial assistance
- Food assistance
- Landlord incentive
- Tenant incentive

Selecting any of these 14 choices reveals and requires both SSVF Financial Assistance Start Date and SSVF Financial Assistance End Date. Blank dates triggered the UI's required-field validation for every choice, before any request to save. Leaving the financial type unselected hides the dates and removes their required markers.

Pass those dates as `financialAssistancePeriod: {start, end}` using timezone-qualified timestamps. The recorder requires both, enforces their order, and rejects a period without a financial-assistance type. Swagger has no properties for these dates; the UI adapter fills them and verifies stored readback.

`ssvfFinancialAssistanceAmount` is visible and not marked required in the inspected UI. It can be omitted for nonfinancial services. If supplied, the SDK accepts a finite nonnegative amount with at most two decimal places, up to 1,000,000,000. Funding Sources are separate allocations and retain their existing validation.

## Recording a nonfinancial service

```js
await recorder.record({
  key: 'source-system-stable-service-id',
  body: {
    clientId, serviceProvider,
    serviceCode: 'BH-3800.7000', // Use the taxonomy appropriate to your service.
    serviceStartDate: '2026-10-23T12:00:00-04:00',
    serviceEndDate: '2026-10-23T12:00:00-04:00',
    ssvfInformation: {
      typeOfSsvfService: 'Assistance obtaining VA benefits',
      ifObtainingVaAssistanceBenefits: 'Educational assistance',
    },
  },
});
```

The four conditional values are supported by REST and are verified against both the REST readback and the visible UI control. No GWT workaround is needed for those values. The UI adapter still completes the associated need as Closed / Fully Met and handles financial dates and Funding Sources where supplied. Keep the same key, inputs, and durable journal for retries. Bulk input validates all rows first and stops after an uncertain write.

`SsvfInformation` uses the service type as a discriminant, so TypeScript rejects a dependent field belonging to another branch and invalid picklist literals. `ServiceUiSnapshot.ssvfInformation` includes visible, nonblank values for verification. Hidden controls do not count as proof of stored answers.

The hidden Moving On controls did not appear for any of the 10 currently offered service types. They are not exposed as supported SSVF inputs. Other tenants, providers, and future WellSky releases need their own UI verification before extending these rules.
