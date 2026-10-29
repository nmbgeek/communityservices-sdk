# WellSky Community Services SDK

`@choiceapps/communityservices-sdk` is a server-side TypeScript SDK for **WellSky Community Services (HMIS), formerly ServicePoint**. It provides typed Client API V2/V3 requests and workflow helpers for clients, households, assessments, enrollments, services, shelter stays, and contacts.

**Start with [Using the SDK](docs/using-the-sdk.md)** for installation, credentials, a complete REST read, a browser session, and guidance on durable writes. The [documentation index](docs/README.md) links to the detailed task guides.

## Requirements

- Node 22 or newer.
- Credentials for your Community Services tenant when connecting to WellSky.
- For browser workflows: `playwright-core` and an installed Chrome/Chromium executable. These helpers run in Node, not in a frontend bundle.

REST imports support ESM and CommonJS. The optional `/browser` export is ESM-only. All tenants use the same methods; your tenant and connection settings select the system.

## Install

```sh
npm install @choiceapps/communityservices-sdk
```

The public package uses the default npm registry. No registry token is needed to install it.

## Run an offline example

```sh
node node_modules/@choiceapps/communityservices-sdk/examples/quickstart.mjs
```

It prints `Read synthetic client 123; no network requests.` and uses the real SDK transport with synthetic responses. No HMIS account is needed for this example. See the [source and explanation](docs/getting-started.md).

## Make your first API call

This fragment assumes your application supplies `tenant`, REST `username` and `password`, and an authorized `clientId`:

```js
import {WellSkyClient, toItems} from '@choiceapps/communityservices-sdk';

const api = new WellSkyClient({
  tenant,
  auth: {kind: 'credentials', username, password},
});
const people = toItems(await api.clients.get({path: {clientId}}));
```

The root export uses V3; use `/v2` or `/v3` to choose explicitly. Responses preserve the server's shape, and `toItems()` extracts supported collection formats. See [the complete runnable read](docs/using-the-sdk.md#4-read-an-existing-client), [configuration](docs/configuration.md), and [all HTTP operations](API.md).

## Choose a workflow

| Work | Documentation |
| --- | --- |
| Authentication, reads, pagination, and bulk calls | [REST client](docs/rest-client.md) |
| Client creation, households, notes, goals, and actions | [Durable records](docs/durable-records.md) |
| Program metadata, questions, and picklist answers | [Assessments](docs/assessments.md) |
| Enrollment, interim reviews, household changes, and exits | [Enrollments](docs/enrollments.md) |
| Profile fields and date of birth | [Profiles](docs/profiles.md) |
| Services, SSVF details, and Funding Sources | [Services](docs/services.md), [SSVF rules](SSVF.md) |
| Needs without service delivery | [Independent needs](docs/independent-needs.md) |
| Shelter check-in/check-out and bed availability | [Shelters](docs/shelters.md), [inventory](docs/shelter-inventory.md) |
| Outreach and shelter contact events | [Current Living Situation](docs/current-living-situation.md) |
| Attachments and goal case notes | [Files and notes](docs/files-and-notes.md) |

For UI-backed operations, see [browser sessions](docs/browser-session.md). Use stable event keys and a persistent journal for workflow writes. After an error, reconcile the original operation before submitting again; a lost response does not prove rollback. [Troubleshooting](docs/troubleshooting.md) explains recovery.

## Examples and reference

- [Integration methods](docs/integration-methods.md) explains why workflows combine REST, GWT-RPC, browser forms, and multipart uploads.
- [WellSky feedback](docs/vendor-issues/README.md) preserves reproduced issues, contract questions, and API coverage requests.

- [Packaged examples](examples/README.md) cover individual and household workflows and compile against the public SDK.
- [Helper reference](docs/reference.md) indexes public exports and type declarations.
- [Capabilities](docs/capabilities.md) records supported behavior and findings reproduced in a sandbox tenant.
- [Dates and answers](docs/dates-and-answers.md) explains calendar dates and effective timestamps.
- [Development guide](docs/development.md) covers building, tests, and releases.
- [Agent guide](AGENTS.md) documents integration rules for coding assistants.
- [Changelog](CHANGELOG.md) records versioned changes.

This is an independent integration and has no WellSky endorsement.

## License and source

Copyright 2026 Choice Technology Solutions, LLC. Licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE) for attribution.

[GitLab](https://gitlab.home.nmbgeek.com/nmbgeek/communityservices-sdk) is the source of truth. The [public GitHub mirror](https://github.com/nmbgeek/communityservices-sdk) receives branches and tags from GitLab and runs npm trusted publishing. Make repository changes in GitLab.
