# Develop and release the SDK

[Documentation index](README.md) · [Agent guide](../AGENTS.md)

Run commands in `packages/wellsky-sdk`. Node 22 or newer is required. Local tests use synthetic data and do not authenticate to HMIS. The repository contains the SDK and its supporting documentation and tests.

## Fake client and validation

```ts
import { createFakeWellSkyClient } from '@choiceapps/communityservices-sdk/testing';
const fake = createFakeWellSkyClient();
fake.fake.set('GET /clients/{clientId}', {
  kind: 'reply', body: [{ clientId }],
});
```

The fake implements the same V3 client and runs through the real transport and validation. Script replies, network errors, custom handlers, and commit-then-error behavior. No request falls through to a real network. Use synthetic data only; the fake intentionally exposes its scripted calls/state to tests.

```sh
npm ci
npm run generate
npm run generate:check
npm run docs:check
npm test
npm run package:check
```

`npm run generate` rewrites generated files from the pinned contracts. Use `generate:check` for a read-only consistency check. Run `npm run specs:check` separately when checking upstream drift: it contacts the public WellSky Swagger endpoints, compares them to the pinned snapshots, and does not update files or authenticate to HMIS. A mismatch requires review before regeneration.

## Include browser fixtures

Without `WELLSKY_TEST_CHROME`, the suite skips tests that require a real browser. Install a compatible Chrome or Chromium executable, then set its absolute path when running the package check. For example, on macOS:

```sh
WELLSKY_TEST_CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' npm run package:check
```

These browser tests use local synthetic forms and intercepted responses, not a live HMIS login. Check the test summary for skipped tests before describing a run as complete browser coverage. GitLab's `verify:browser` job installs Chromium and its system dependencies, sets `WELLSKY_TEST_CHROME`, and runs the package check. The separate Node 22 and 24 jobs still check the package without a browser.

The local suite covers every versioned HTTP operation, metadata, tenant/auth controls, concurrency, bulk execution, cancellation, verification, and end-dating. Package checks install the tarball and its optional Playwright Core peer in a clean consumer, check shipped documentation links and runtime-export coverage, compare installed examples to source, compile every example against installed declarations, and execute offline example checks with network access blocked. Installed client-creation, attachment-retry, and session-authentication regressions run separately. ESM and CommonJS REST declarations and imports are also checked, along with ESM browser consumer types. Any live verification requires an explicitly authorized tenant and operation. Preserve sanitized conclusions, reproduction dates, and limitations in the relevant SDK guide or vendor report. Keep raw captures, credentials, and client data outside the repository and package; do not replay historical fixture setup.

## GitLab CI releases

The root `.gitlab-ci.yml` runs verification on Node 22 and 24 and a separate Chromium fixture job on Node 22. Publishing requires all three jobs and uses the tested Node 22 tarball, GitLab's `CI_JOB_TOKEN`, and the current project's npm registry. The publish job checks version agreement, verifies registry integrity, and installs the published package and optional browser peer in a clean directory. It runs the shared installed-consumer checks there, including every shipped example, public entry points, type checks, and retry regressions.

Release either by pushing a matching version tag (for example, `v0.1.0`), or by running a pipeline on the default branch with the matching `RELEASE_VERSION` (for example, `0.1.0`). Change `package.json` and its lockfile first for future versions. Never reuse a published version. No long-lived publishing token is required.

These are release procedures, not evidence that the current working tree has been published. A local `package:check` creates a tarball but does not upload it. Verify the actual release pipeline, registry version, and installed artifact before claiming registry availability.

See [CHANGELOG.md](../CHANGELOG.md) for compatibility changes. This package is an independent integration and has no WellSky endorsement.

## GitHub mirror and public npm releases

GitLab is the source of truth. Its push mirror copies branches and tags to `nmbgeek/communityservices-sdk` on GitHub. Commit changes, including `.github/workflows/publish.yml`, in GitLab. Do not edit the mirror or push independent commits there.

The GitHub workflow checks Node 22, Node 24, and Chromium using synthetic fixtures. A matching `v<version>` tag publishes the tested Chromium-job tarball as public `@choiceapps/communityservices-sdk`. Main pushes only verify. To recover an interrupted release, run `publish.yml` manually against the existing version tag. An identical existing artifact is verified without republishing; a different artifact under the same version fails. npm versions cannot be replaced.

Configure the npm package's trusted publisher for GitHub owner `nmbgeek`, repository `communityservices-sdk`, workflow filename `publish.yml`, with publishing allowed and no environment name. The workflow runs on GitHub-hosted runners, grants `id-token: write` only to the publish job, and uses npm 11.19.1. It needs no `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret. The package's repository URL points to this public mirror so npm can attach provenance. GitLab publication remains a separate job using `CI_JOB_TOKEN`.

An npm owner with 2FA must complete the initial package setup before OIDC publishing can work. For an existing package, configure it in npm settings or with an authenticated npm CLI:

```sh
npm trust github @choiceapps/communityservices-sdk --repo nmbgeek/communityservices-sdk --file publish.yml --allow-publish --yes
```

See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for initial setup requirements. This workflow does not bootstrap credentials or create a placeholder release. Verify the workflow result, registry integrity, provenance, and installed-consumer checks before calling a release available.

## License

The SDK is Apache-2.0, copyright 2026 Choice Technology Solutions, LLC. Keep the repository and package copies of `LICENSE` and `NOTICE` identical. Package verification checks that both files ship unchanged.

## Tenant parity regression checks

The synthetic workflow and browser fixtures accept `WELLSKY_TEST_TENANT` to select the fixture tenant. Run the same package checks with two distinct tenant values:

```sh
WELLSKY_TEST_TENANT=tenant-a npm run package:check
WELLSKY_TEST_TENANT=tenant-b npm run package:check
```

Set `WELLSKY_TEST_CHROME` to the local Chrome executable to include the browser fixtures. These checks intercept browser traffic and use synthetic records; selecting another fixture tenant here does not access the live tenant. The suite also checks shared-journal isolation, neutral public exports, cross-tenant rejection, and explicit tenant types for login and custom need adapters.
