# Documentation index

[Package overview](../README.md) · [Agent instructions](../AGENTS.md)

These guides cover WellSky Community Services (HMIS), formerly ServicePoint. References to WellSky APIs here mean this platform's Client API, not APIs for other WellSky products.

## Learn the client

Start with [Using the SDK](using-the-sdk.md) for installation, authentication, REST and browser reads, workflow selection, and recovery. You can also run the [offline quickstart](getting-started.md). It runs a real SDK client against the built-in fake transport, with no HMIS account or writes.

Then read [REST configuration](rest-client.md) for authentication and tenant connection settings. Browser credentials have a separate contract in [browser sessions](browser-session.md).

## Understand the implementation choices

[Why the SDK uses REST, GWT-RPC, and browser forms](integration-methods.md) records the method used for each workflow, the limitation that led to it, alternatives rejected, and the recovery guarantees that must survive a future change.

## Complete a task

| Task | Guide | Example or contract |
| --- | --- | --- |
| Create clients, manage households, and journal case plans | [Durable records](durable-records.md) | [Creation, membership, notes and recovery](../examples/durable-records.mts) |
| Read clients, page results, or run generic bulk calls | [REST client](rest-client.md) | [REST usage](../examples/usage.ts) |
| Inspect questions, resolve picklists, or encode answers | [Assessments](assessments.md) | [Program discovery](../examples/program-discovery.ts) |
| Read verification rows at enrollment | [Assessment snapshots](assessments.md#read-verification-records-at-enrollment) | [Verification snapshot](../examples/verification-snapshot.ts) |
| Update Client Record, Sex, or DOB | [Profiles](profiles.md) | [Helper signatures](reference.md#browser-helpers) |
| Create enrollment and interim assessments | [Enrollments](enrollments.md) | [Single client](../examples/enrollment-workflow.mts), [household](../examples/household-enrollment-workflow.mts) |
| Exit selected members or add a child later | [Household lifecycle](enrollments.md#later-household-members-and-staggered-exits) | [Lifecycle](../examples/household-lifecycle-workflow.mts), [exit](../examples/household-exit-workflow.mts) |
| Record services, SSVF details, or Funding Sources | [Services](services.md), [SSVF rules](../SSVF.md) | [Service contract](../browser/service-recording.d.mts) |
| Record a need without a service | [Independent needs](independent-needs.md) | [Need discovery and recording](../examples/independent-needs.mts) |
| Record outreach or shelter contacts | [Current Living Situation](current-living-situation.md) | Program-entry starts, contact dates, and distinct event identities |
| Understand shelter stays and enrollment coverage | [Shelters](shelters.md) | Household check-in/checkout, enrollment guards, and retry protection |
| Report shelter inventory and vacancies | [Shelter inventory](shelter-inventory.md) | Unit lists, named beds, occupants, holds, overflow, and bounded complete snapshots |
| Upload attachments or write goal case notes | [Files and notes](files-and-notes.md) | [Browser contracts](../browser/index.d.mts) |
| Supply a custom GWT session | [Session adapter](browser-session.md#experimental-gwt-enrollment-helpers) | [Adapter contract](../examples/gwt-enrollment-session.ts) |
| Recover an interrupted write | [Troubleshooting](troubleshooting.md) | Keep the original request and journal |

Most guide snippets are integration fragments with application-provided inputs. They do not run themselves. The offline quickstart is a complete executable example. Examples ship with the package. Package checks compile the TypeScript files and exercise the new workflows against a clean installed tarball with synthetic adapters; install `playwright-core` to compile examples that use its types.

## Look up a contract

- [Capabilities](capabilities.md) separates generated REST methods, tested helpers, and unsupported behavior.
- [Configuration reference](configuration.md) lists REST options and browser credentials.
- [Dates and answer semantics](dates-and-answers.md) distinguishes calendar DOBs, effective timestamps, and verification intervals.
- [Helper reference](reference.md) indexes all public runtime exports and declaration files.
- [Generated API table](../API.md) lists HTTP operations for both versions.
- [SSVF rules](../SSVF.md) lists conditional choices and required fields.

## Maintain the SDK

Follow [development and release](development.md) for checks, generated-code boundaries, and packaging. [Agent instructions](../AGENTS.md) provide the shorter operational entry point. [llms.txt](../llms.txt) provides a text-only documentation map.

Credentials and raw authenticated captures stay outside this package. The [capabilities guide](capabilities.md) retains sanitized acceptance evidence and limits; [WellSky feedback](vendor-issues/README.md) retains reproducible observations and support questions. These dated summaries do not claim that every provider or deployment has been tested.

## Report upstream issues

[WellSky feedback](vendor-issues/README.md) separates reproduced failures, contract questions, and missing public capabilities. The reports preserve evidence and SDK workarounds without claiming a confirmed root cause or a submitted support ticket.
