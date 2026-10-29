# Community Services SDK repository guide

This is the source repository for `@choiceapps/communityservices-sdk`, a server-side TypeScript SDK for WellSky Community Services, also known as HMIS or ServicePoint. Node 22 or newer is required. The optional browser helpers control Playwright from Node; they are not frontend code.

Use this file as the shared repository guidance. `CLAUDE.md` points here. When working inside the package, also follow [packages/wellsky-sdk/AGENTS.md](packages/wellsky-sdk/AGENTS.md), which documents integration contracts and ships with the SDK. Keep repository tooling instructions here and consumer guidance in the package.

## Start with the owning source

- Read [capabilities](packages/wellsky-sdk/docs/capabilities.md) before choosing a REST, GWT, or browser workflow. Generated Swagger coverage does not establish that an operation works for a particular tenant.
- Use the [documentation index](packages/wellsky-sdk/docs/README.md), [API table](packages/wellsky-sdk/API.md), [helper reference](packages/wellsky-sdk/docs/reference.md), and [examples](packages/wellsky-sdk/examples/README.md) for public contracts.
- Inspect the current working tree and preserve unrelated edits. Verify branch, version, and publication status from Git, package metadata, CI, and the registry rather than from historical reports.
- Keep durable product knowledge in the relevant SDK guide, example, or regression test. Do not recreate root audit reports, investigation summaries, or handoff documents. Keep sanitized reproduction dates, controls, and limitations with the relevant SDK documentation; they are evidence, not instructions to repeat writes.
- Preserve the rationale for REST, GWT-RPC, browser, and multipart choices in [integration methods](packages/wellsky-sdk/docs/integration-methods.md). Keep actionable vendor feedback in [WellSky feedback](packages/wellsky-sdk/docs/vendor-issues/README.md), separating reproduced behavior, suspected causes, contract questions, and capability requests. Never imply a support ticket was sent or resolved without evidence.

## Repository map

| Path | Responsibility |
| --- | --- |
| `packages/wellsky-sdk/src` | REST transport, authentication, validation, metadata, assessment helpers, GWT enrollment contracts, and fake client |
| `packages/wellsky-sdk/src/generated` | Generated V2/V3 clients and models |
| `packages/wellsky-sdk/browser` | ESM browser adapters, workflow orchestration, tenant connections, session recovery, and matching `.d.mts` declarations |
| `packages/wellsky-sdk/specs` | Pinned Swagger contracts, reviewed overrides, and provenance |
| `packages/wellsky-sdk/scripts` | Generation, builds, documentation checks, installed-consumer verification, and CI publication |
| `packages/wellsky-sdk/test` | Synthetic runtime, browser, and compile-time regressions |
| `packages/wellsky-sdk/docs` and `examples` | Shipped usage documentation and public-import examples |
| `.github/workflows/publish.yml` | GitHub mirror verification and public npm publication using OIDC |
| `.gitlab-ci.yml` | Node 22, Node 24, browser verification, and private npm publication |

Run npm commands in `packages/wellsky-sdk`; there is no root npm workspace command. Build output lives in `dist/esm` and `dist/cjs`. Public imports are the package root, `/v2`, `/v3`, `/testing`, and `/browser`. The root selects REST V3. REST entry points support ESM and CommonJS; `/browser` is ESM-only with an optional `playwright-core` peer.

## Tenant and workflow contracts

All configured tenants use identical SDK operations. For the default browser host, the tenant identifier selects the path segment. The REST client sends the configured tenant to the shared API host.

- Require an explicit tenant for browser login. Derive the module URL through `resolveUiConnection`; custom HTTPS module URLs must match the tenant path.
- Use neutral helper names such as `openUiSession`, `createServiceRecorder`, and `createCurrentLivingSituationRecorder`. Do not add tenant-specific aliases or restore `environment`, `allowProduction`, or `productionTenants` options.
- Preserve REST/UI tenant consistency, pinned-page navigation checks, and journal isolation by tenant and deployment. Program, provider, client, assessment, and picklist IDs belong to the selected tenant.
- REST credentials and UI credentials are separate. Never commit credentials, tokens, cookies, client data, or private probe output. Browser login reads the selected credential file; the REST client does not load it.
- Use current metadata and fresh UI/GWT models. The browser and GWT adapters implement operations the REST API cannot fully express; do not replace them with guessed routes or captured RPC replays.
- Preserve source keys, intent validation, durable journals, locking, and read-back verification. A lost response or expired login does not authorize repeating a mutation. Reauthenticate, then reconcile the original operation.
- Preserve household head and enrollment coverage rules, strict calendar-date DOB handling, and verified Closed/Fully Met needs for recorded services. Read the package agent guide and owning workflow documentation before changing these contracts.

Synthetic fixtures can use any configured tenant identifier without contacting HMIS. Live verification requires an authorized target and operation; even a read-only check can mint a token. Do not contact HMIS as routine documentation or release verification.

## Change the right files

Do not hand-edit `src/generated`, `API.md`, or build output. Review changes to the pinned specs or generator, run `npm run generate`, and inspect the resulting diff. `npm run specs:check` contacts upstream Swagger endpoints to detect drift; it does not update the snapshots.

For a public browser API change, update its `.mjs` implementation, `.d.mts` declaration, browser entry exports, reference documentation, examples, and relevant consumer checks together. Examples must import public package entry points. Keep source behavior, compiled declarations, and the installed tarball consistent.

## Verify changes

```sh
cd packages/wellsky-sdk
npm ci
npm run generate:check
npm run docs:check
npm test
npm run package:check
```

Choose the checks appropriate to the change. Documentation changes must pass `docs:check`. Source changes require relevant regressions and `package:check`; that command already includes the source suite, so do not run it twice without a reason. The package check builds and installs a tarball into a clean consumer, checks public imports and declarations, and compiles and exercises shipped examples.

Set `WELLSKY_TEST_CHROME` to an installed Chrome or Chromium executable to include browser fixtures. Without it, browser-dependent tests can skip. For connection or tenant changes, exercise both configurations:

```sh
WELLSKY_TEST_TENANT=tenant-a WELLSKY_TEST_CHROME=/absolute/path/to/chrome npm run package:check
WELLSKY_TEST_TENANT=tenant-b WELLSKY_TEST_CHROME=/absolute/path/to/chrome npm run package:check
```

These tests use synthetic data and intercepted traffic. Report failures and skips accurately, and distinguish local fixture coverage, CI verification, and live acceptance. A local tarball is not a published package.

## Git and releases

GitLab is the source of truth; GitHub `nmbgeek/communityservices-sdk` is a push mirror. Maintain the GitHub workflow here in GitLab. Public npm uses `@choiceapps/communityservices-sdk` and GitHub OIDC; no npm token belongs in repository secrets. Keep root/package Apache-2.0 `LICENSE` and `NOTICE` copies identical, with Choice Technology Solutions, LLC as copyright holder.

The default branch is `main`. Use `codex/` for task branches when needed, and remove completed task branches when authorized. Preserve unrelated working-tree changes when committing or switching branches.

The package uses the `0.x` release series. Read the current version from `packages/wellsky-sdk/package.json`; keep its lockfile and changelog consistent. Release tags use `v<package-version>`. Do not reuse a published version or delete releases as part of ordinary maintenance.

The private registry is GitLab project `48`, `nmbgeek/communityservices-sdk`. See [the release procedure](packages/wellsky-sdk/docs/development.md#gitlab-ci-releases). A matching version tag triggers publication after all three verification jobs pass. A default-branch pipeline can also publish with an explicit matching `RELEASE_VERSION`. The publish job uses `CI_JOB_TOKEN`, verifies the uploaded artifact's integrity, and installs it for consumer checks. Confirm pipeline and registry results before reporting a release as available.

## GitNexus checks

Use the GitNexus MCP tools for code exploration and impact analysis. The registered index for this checkout is `communityservices-sdk`; use `list_repos` to resolve it if the checkout or registration changes. Do not infer the index name from the local folder name or rely on stored symbol counts.

- Before editing any function, class, or method, run `impact({repo: "communityservices-sdk", target: "symbolName", direction: "upstream"})`. Disambiguate by file or symbol UID where necessary. Report direct callers, affected processes, and risk to the user.
- Warn the user before proceeding when impact is HIGH or CRITICAL. Never ignore these findings.
- Use `query({repo: "communityservices-sdk", search_query: "concept"})` to explore unfamiliar execution flows, then `context` for callers and callees.
- Use `rename` with a preview for symbol renames, not find-and-replace. Verify declaration files and imports as well as implementations; an incomplete preview is not evidence that no other references exist.
- Before every commit, run `detect_changes` and review the affected scope. For branch regression review, compare against the current default branch with `scope: "compare"` and `base_ref: "origin/main"` after fetching it.
- For security reviews, `explain` can report source-to-sink findings when the index was built with `--pdg`.

Refresh stale indexes from the repository root with `node .gitnexus/run.cjs analyze --index-only`. Use `--force --index-only` when a clean rebuild is necessary. `--index-only` preserves these maintained instruction files. If the local runner is absent, use the installed GitNexus CLI or `npx gitnexus analyze --index-only`.

Index resources include `gitnexus://repo/communityservices-sdk/context`, `/clusters`, `/processes`, and `/process/{name}`. GitNexus skills may be installed under `.claude/skills/gitnexus`; use the available exploring, impact-analysis, debugging, refactoring, guide, or CLI skill for the relevant task.

When interacting with Cloudflare, use the `cf` CLI unless the project has a Wrangler configuration file.
