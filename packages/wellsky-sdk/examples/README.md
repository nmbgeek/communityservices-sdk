# Packaged examples

[Package overview](../README.md) · [Documentation index](../docs/README.md)

Every file here ships with the package and imports the public `@choiceapps/communityservices-sdk` entry points. No example loads `.env`, credentials, or a live session on import.

| File | Purpose | Execution |
| --- | --- | --- |
| [shelter-inventory.mts](shelter-inventory.mts) | Discover unit lists and report beds, occupants, holds, overflow, and known or unknown vacancies | Exported functions; caller supplies a dedicated authenticated application page; each list is a separate snapshot |
| [shelters.mts](shelters.mts) | Shelter mode discovery, household check-in/checkout, durable source keys | Exported functions; caller supplies beds, dates, assessment preparation, UI, and store; exercised against installed package |
| [quickstart.mjs](quickstart.mjs) | Read a synthetic client through the real SDK transport | Run directly; no network or credentials |
| [durable-records.mts](durable-records.mts) | Client source mapping, household creation/later members, case plans, keyed goal notes, bulk recovery decisions | Exported functions; application supplies API, store, UI ports, and inputs |
| [usage.ts](usage.ts) | REST clients, pagination, generic service operations | Exported functions; raw writes have no durable journal |
| [verification-snapshot.ts](verification-snapshot.ts) | Read assessment records effective at enrollment | Exported function; caller supplies assessment context |
| [program-discovery.ts](program-discovery.ts) | Program and VA-entry assessment discovery | Exported function; authenticated page required |
| [enrollment-workflow.mts](enrollment-workflow.mts) | Single entry and interim assessment plans | Exported function; caller supplies plans and dependencies |
| [individual-exit-workflow.mts](individual-exit-workflow.mts) | Standalone program enrollment exit and assessment | Verified entry key, enrollment reader, exit UI port and durable store required |
| [catalog-write-labels.mts](catalog-write-labels.mts) | Discover full lookup labels without existing answers; automatic workflow configuration | Authenticated enrollment session and current assessment definition required |
| [checked-assessment-writes.mts](checked-assessment-writes.mts) | Exact readback lookup labels and checked mobile scalar inserts | Unobserved labels remain unresolved; preflight does not make writes atomic |
| [enrollment-discovery-and-correction.mts](enrollment-discovery-and-correction.mts) | Discover/adopt from the head and bind existing correction rows | Explicit row IDs and unique verified household membership required |
| [entry-correction-workflow.mts](entry-correction-workflow.mts) | Same-date scalar clears and existing row edits | Original entry/row keys, verified lookup labels and durable store required |
| [existing-enrollment-exits.mts](existing-enrollment-exits.mts) | Adopt manual individual or household entries, then exit | Explicit enrollment identities and original household head required |
| [household-enrollment-workflow.mts](household-enrollment-workflow.mts) | Per-member enrollment and review | Existing household and per-member answer plans required |
| [household-lifecycle-workflow.mts](household-lifecycle-workflow.mts) | Selected exits and a later child entry | Household membership precedes program attachment |
| [household-exit-workflow.mts](household-exit-workflow.mts) | Household exit with destination details | Explicit exit dates and per-member plans required |
| [gwt-enrollment-session.ts](gwt-enrollment-session.ts) | Custom GWT session and journal integration | Caller supplies all target IDs and dates |
| [gwt-file-store.mjs](gwt-file-store.mjs) | Compatibility re-export of the durable file store | Safe to import |

After installation, run the offline example from your application directory:

```sh
node node_modules/@choiceapps/communityservices-sdk/examples/quickstart.mjs
```

To use a TypeScript integration example, copy it into your application's source tree and compile with TypeScript's NodeNext module resolution. Install `playwright-core` for the browser type contracts and `@types/node` as a development dependency when compiling them in your application. Keep ESM `.mts` examples as `.mts` or use an ESM package. The examples are ordinary packaged files, not additional package export paths.

## What the package check proves

`npm run package:check` in the SDK checkout packs and installs the tarball in a temporary consumer. It compares every installed example with the source file, copies the installed examples outside the package, compiles all TypeScript examples against installed declarations, and imports every compiled example with global network access blocked. The offline quickstart executes its assertions.

The durable-record example also runs against the installed SDK's fake REST transport and a real temporary file journal. Checks cover stable source IDs, household head guards, later members, Client Notes/goals/actions, same-key retries, explicit source-key conflict, and structured service recovery decisions. Synthetic UI ports are used where needed. This verifies package behavior and example integration; it does not log in, click a real UI, or replace the separate live sandbox acceptance tests.

Installed checks also run the client-creation, attachment-retry, session-authentication, independent-needs, and GWT mapped-reader regression suites against the tarball. Browser example compilation uses `skipLibCheck` for peer declarations while still checking example code against the installed SDK types. Separate consumer checks reject invalid veteran-status literals and verify the exported attachment-conflict contract.

`independent-needs.mts` discovers tenant-wide service types and separate provider quicklists, records explicit PIT needs, and maps a chosen taxonomy type to the service recorder. Dependencies, event keys, provider, and selections are supplied by the application.

[coordinated-entry-events.mts](coordinated-entry-events.mts) records application-supplied Coordinated Entry Events with durable keys, verified lookup labels, and event-specific follow-up answers such as referral locations and results. It compiles against the installed package without opening a live session.

[current-living-situation.mts](current-living-situation.mts) records application-supplied outreach or night-by-night shelter contact events with distinct durable keys and optional recording-program picklist selections. It compiles and imports against the installed package without opening a live session.
