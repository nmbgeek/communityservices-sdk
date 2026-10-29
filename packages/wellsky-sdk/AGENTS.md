# WellSky Community Services SDK agent guide

This guide is for agents integrating or maintaining `@choiceapps/communityservices-sdk` for WellSky Community Services (HMIS), formerly ServicePoint. WellSky is the company, and its other software products are outside this SDK's scope. Legacy ServicePoint names in URLs and GWT classes refer to this same platform. The [documentation index](docs/README.md) is the human entry point. The REST SDK is server-side Node 22+. The ESM-only `browser` export controls Playwright from Node; do not import it into frontend bundles.

## Establish the task before writing

1. Read [capabilities](docs/capabilities.md) to choose the supported path. A generated method proves Swagger coverage, not a successful tenant-specific operation.
2. Inspect the [API table](API.md) and [helper contracts](docs/reference.md). Preserve exact parameter names such as `clientId`, `client_id`, and `enrollment_id`.
3. Obtain tenant, connection settings, permitted target IDs, provider, dates, and source keys from the application. Do not infer authorization from an ID, hostname, provider list, or example.
4. Discover the program's assessment defaults, then its client-scoped questions and picklists. Resolve option codes; do not copy fixture IDs or numeric lookup values.
5. Use `createClientCreator` for source-ID mapping, `createHouseholds` for membership, and `createCasePlans` for journaled notes/goals/actions. Read [durable records](docs/durable-records.md). Do not guess a lost client receipt from demographics.
6. Make every assessment field an explicit answer, subassessment operation, carry-forward, or application-approved not-applicable explanation. Metadata does not decide eligibility or complete conditional branching.

The package's examples use synthetic or application-owned inputs. Live verification can create records or mint tokens. Perform it only within the task's authorized tenant and scope; documentation work requires no live writes.

## Preserve these invariants

- REST authentication and UI login are separate. Never extract browser credentials, store cookies, print tokens, or copy `.env` values into reports. The REST client does not load credential files. Browser login reads the selected file.
- Use the configured tenant consistently for REST, browser sessions, metadata, and durable journals. All configured tenants use identical operations. Reject mismatched REST/UI tenants and cross-tenant navigation.
- A failed or empty read does not prove absence. An HTTP success does not prove all fields saved. Never retry a raw write because its response was lost.
- Retain identical intent, source keys, and the durable store when resuming. Do not delete a journal, regenerate a key, remove an unexplained crash lock, or replay a captured RPC to get past a conflict.
- Reauthentication refreshes the session, not the mutation. Reconcile the original operation. Read [the recovery procedure](docs/troubleshooting.md) for `SESSION_INTERRUPTED` or ambiguous commits.
- A household enrollment needs a head throughout every member's enrollment. Never promote a later entrant or change the head mid-enrollment. Retroactive correction is a separate workflow and requires the same first entry date. A real mid-enrollment change normally requires closing all enrollments and starting a fresh one.
- DOB is a strict calendar date through the DOB helper. Enrollment and review dates are explicit instants. Keep mobile effective-date correction separate from DOB encoding and stored verification dates. Read [date contracts](docs/dates-and-answers.md).
- Every recorded service needs an associated need verified Closed/Fully Met. Use the service recorder for these guarantees and SSVF/UI completion. Generic `bulk` does not provide them.
- Profile, case-plan, and goal attachments have different entity contexts. Do not promise public visibility or alter sharing based on a profile upload's location.
- Keep the managed Playwright page dedicated to the helpers. Use fresh UI/GWT models and the shared page lock. Multi-host writers need a shared durable store and locking implementation.

## Find the implementation

Installed packages contain `dist/esm`, `dist/cjs`, `browser`, examples, and documentation. Use [declaration links](docs/reference.md) to inspect exact types. Internal file paths are not additional supported import entry points.

In a source checkout, runtime logic is in `src`, generated REST contracts are in `src/generated`, and browser helpers are in `browser`. `specs` pins Swagger/provenance/overrides. Tests are in `test`. Run SDK commands in `packages/wellsky-sdk`. The repository contains only the SDK and its supporting documentation and tests.

In the SDK source checkout, follow the enclosing repository's AGENTS.md, including its GitNexus impact checks before modifying symbols. In an application consuming the installed package, follow that application's repository instructions; this package does not install a GitNexus index or its tools. Do not hand-edit generated files or API.md; use `npm run generate` in the SDK checkout after an intentional contract change. Preserve unrelated workspace changes. Documented sandbox findings are dated evidence, not instructions to replay fixture setup or override current source contracts.

## Verify and report

For a source change, run the relevant tests, then `npm run package:check`. Documentation changes must pass `npm run docs:check`; the package check also validates shipped links and examples. Set `WELLSKY_TEST_CHROME` to an installed executable for full local browser fixtures. Tests can skip those fixtures when Chrome is unavailable; report skips rather than claiming full browser proof.

For a live task, verify actual saved values through the appropriate REST and UI/GWT reads. Record original IDs, same-key retry results, and mutation counts. Do not claim production or live verification from fake tests alone. Keep private evidence outside the package.

When finishing, state what changed, what passed, and what remains unverified. Do not claim that a workflow is atomic, that a journal prevents external writers from racing, or that the server supplies an idempotency key.
