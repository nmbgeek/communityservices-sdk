# Using the SDK

[Documentation index](README.md) · [Package overview](../README.md)

This guide takes an application from installation to its first REST read and browser session, then explains how to choose a workflow for writing records. Use Node 22 or newer. The SDK runs on your server; keep credentials and client records there.

## 1. Install the package

Install from the public npm registry. No registry token is required.

```sh
npm install @choiceapps/communityservices-sdk
```

For JavaScript, use `.mjs` files or set `"type": "module"` in your application's `package.json`. TypeScript applications can use `.mts` with `module` and `moduleResolution` set to `NodeNext`. REST imports also support CommonJS:

```js
const {WellSkyClient, toItems} = require('@choiceapps/communityservices-sdk');
```

The optional `/browser` export requires ESM. Install its dependency only when using browser workflows:

```sh
npm install playwright-core
```

It also needs an installed Chrome/Chromium executable. Set `HMIS_CHROME_PATH` to that executable, or install the matching Playwright browser using `npx playwright-core install chromium`.

## 2. Try an offline read

The installed package includes a runnable example with synthetic data:

```sh
node node_modules/@choiceapps/communityservices-sdk/examples/quickstart.mjs
```

Expected output:

```text
Read synthetic client 123; no network requests.
```

This runs the real SDK validation and transport through a fake that cannot contact WellSky. See the [offline quickstart](getting-started.md) for its source.

## 3. Configure your tenant and credentials

The application supplies the tenant. Every tenant uses the same SDK operations; no environment switch or separate helper names are needed. Tenant IDs, provider IDs, client IDs, and picklist choices must come from the deployment you are connecting to.

REST and browser credentials are separate:

| Credential | Used for |
| --- | --- |
| REST username/password, token, or token provider | Authenticating `WellSkyClient` API requests |
| `HMIS_UI_USER` and `HMIS_UI_PASSWORD` | Signing in to the web application through a browser helper |

For local development, create a private `.env.local` and exclude it from version control:

```dotenv
WELLSKY_TENANT=your-tenant
WELLSKY_USERNAME=your-rest-username
WELLSKY_PASSWORD=your-rest-password
WELLSKY_CLIENT_ID=replace-with-an-authorized-client-id
```

These `WELLSKY_*` names are conventions used by the example below. The REST client does not read the file or environment automatically. Node's `--env-file` option loads it, and your application passes the values to the SDK. Deployed applications can supply the same values through their secret manager.

## 4. Read an existing client

Save this complete example as `read-client.mjs`. It prints only the number of returned records; consume the client data inside your application.

```js
import {WellSkyClient, WellSkyError, toItems} from '@choiceapps/communityservices-sdk';

const {WELLSKY_TENANT: tenant, WELLSKY_USERNAME: username,
  WELLSKY_PASSWORD: password} = process.env;
const clientId = Number(process.env.WELLSKY_CLIENT_ID);
if (!tenant || !username || !password) throw new Error('Tenant and REST credentials are required');
if (!Number.isSafeInteger(clientId) || clientId < 1) throw new Error('A valid client ID is required');

const api = new WellSkyClient({
  tenant,
  auth: {kind: 'credentials', username, password},
  timeoutMs: 30000,
});

try {
  const people = toItems(await api.clients.get({path: {clientId}}));
  console.log(`Read ${people.length} client record(s).`);
} catch (error) {
  if (error instanceof WellSkyError) {
    console.error({kind: error.kind, operation: error.operation, status: error.status});
  } else {
    console.error('The read could not be completed.');
  }
  process.exitCode = 1;
}
```

Run it with your configured client ID:

```sh
node --env-file=.env.local read-client.mjs
```

The root import uses V3. Import `WellSkyClient` from `@choiceapps/communityservices-sdk/v2` or `/v3` to choose explicitly. For a caller-managed token, replace `auth` with `{kind: 'token', token}`. For application-owned renewal, use `{kind: 'provider', getToken}`. See [REST configuration](rest-client.md) for those contracts.

Requests take a single object containing `path`, `query`, and/or `body`. Match the parameter spelling in the [API table](../API.md). `toItems()` normalizes supported collection response shapes; it does not turn HTTP errors into empty results. A 404 can indicate an upstream problem, so do not assume it means no record exists.

For large reads, use `api.paginate()` rather than treating one page as a complete result. For bounded groups of independent calls, use `api.bulk()`. Both are covered in [pagination and bulk calls](rest-client.md#bulk-execution-and-pagination).

## 5. Open a browser session when needed

Some operations depend on web application forms or GWT calls. The SDK manages a dedicated page for those operations. Browser login is separate from REST authentication.

Add the following to `.env.local`, using the same tenant as your REST client:

```dotenv
HMIS_UI_USER=your-browser-username
HMIS_UI_PASSWORD=your-browser-password
HMIS_CHROME_PATH=/absolute/path/to/chrome
WELLSKY_PROVIDER_ID=replace-with-an-authorized-provider-id
```

Save this as `read-inventory.mjs`. It discovers the provider's shelter unit lists without creating a client record, need, service, or stay:

```js
import {chromium} from 'playwright-core';
import {openUiSession, createShelterInventory} from '@choiceapps/communityservices-sdk/browser';

const tenant = process.env.WELLSKY_TENANT;
const executablePath = process.env.HMIS_CHROME_PATH;
const providerId = Number(process.env.WELLSKY_PROVIDER_ID);
if (!tenant) throw new Error('A tenant is required');
if (!Number.isSafeInteger(providerId) || providerId < 1) throw new Error('A valid provider ID is required');

const session = await openUiSession({
  tenant,
  chromium,
  envFile: '.env.local',
  ...(executablePath ? {executablePath} : {}),
  passwordRecovery: false,
});
try {
  const inventory = createShelterInventory({page: session.page});
  const catalog = await inventory.listUnitLists({providerId});
  console.log(`Found ${catalog.unitLists.length} unit list(s).`);
} finally {
  await session.close();
}
```

```sh
node --env-file=.env.local read-inventory.mjs
```

Omit `HMIS_CHROME_PATH` when using Playwright's installed Chromium. The helper reads UI credentials from `envFile`; Node loads the application's tenant, executable path, and provider ID. By default the module URL is `https://wscs.wellsky.com/<tenant>/com.bowmansystems.sp5.core.ServicePoint/`. Supply `moduleBaseUrl` only when your deployment uses another HTTPS host; its tenant path must match.

This introductory example disables password recovery so it cannot change an expired password. The SDK's default recovery behavior can rotate an expired password and attempt to restore it. Review [password recovery](browser-session.md#expired-ui-passwords) before enabling it.

To read beds and availability, pass a discovered `unitListId` to `inventory.getInventory({providerId, unitListId})`; see the [inventory example](../examples/shelter-inventory.mts). Use the managed page exclusively for SDK helpers and always close the session in `finally`.

## 6. Choose a workflow for writes

Use the helper for the business operation you need. Raw REST calls expose the API; workflow helpers add discovery, validation, UI completion where needed, and durable reconciliation.

| Task | Start with | Guide |
| --- | --- | --- |
| Create a client and retain an external source identity | `createClientCreator` | [Durable records](durable-records.md) |
| Create or update household membership | `createHouseholds` | [Durable records](durable-records.md) |
| Enroll, review, or exit clients and households | `createEnrollmentWorkflow` | [Enrollments](enrollments.md) |
| Update profile fields or date of birth | `createClientProfile`, `createDateOfBirth` | [Profiles](profiles.md) |
| Record a service and complete its associated need | `createServiceRecorder` | [Services](services.md) |
| Record a need without a service | `createNeedRecorder` | [Independent needs](independent-needs.md) |
| Check into or out of shelter beds | `createShelters` | [Shelters](shelters.md) |
| Record outreach or shelter contacts | `createCurrentLivingSituationRecorder` | [Current Living Situation](current-living-situation.md) |
| Write notes, goals, action steps, or attachments | `createCasePlans`, `createClientWorkflows` | [Durable records](durable-records.md), [files and notes](files-and-notes.md) |

Before writing, discover the program's current assessment and picklist definitions and collect the application's intended answers. Do not copy numeric choice IDs or fixture values from another tenant. The [typed examples](../examples/README.md) show the dependencies and inputs required by each workflow; most export functions for your application to call rather than running on import.

Use `createFileGwtMutationStore('/persistent/private/sdk-journal')` for a single-host durable journal, or implement the store contract with shared locking for multiple hosts. Pass the same store to the cooperating helpers. `openEnrollmentSession({tenant, chromium, envFile, store})` returns the authenticated session together with enrollment helpers, an enrollment reader, and client workflows.

Use a stable upstream event ID as the operation's `key`, such as an intake record ID or contact event ID. Reuse that key, the original intent, and the same journal when resuming. Different real events need different keys even when dates and answers match. Persist returned record IDs and workflow results in your application. A temporary or in-memory journal cannot reconcile a process restart.

## 7. Handle failures without duplicating records

A successful HTTP response is not a guarantee that all fields saved. A failed response is not proof that nothing saved. Workflow helpers verify stored results and retain uncertain attempts in their journal.

- For validation or tenant mismatch errors, correct configuration or input before trying again.
- For an interrupted browser session, reauthenticate and reconcile the original operation. A fresh login does not clear its mutation history.
- For an ambiguous commit or conflict, inspect the workflow status and authoritative readback. Keep the original key and journal; do not wrap raw writes in a retry loop.
- For bulk work, persist fulfilled, rejected, and skipped outcomes. A failed progress callback does not undo a completed write.

Read [troubleshooting](troubleshooting.md) and the owning workflow's retry contract for the exact error and recovery path. Keep credentials and client data out of logs.

## Further reference

- [Configuration](configuration.md): connection options, authentication, timeouts, and concurrency.
- [Dates and answers](dates-and-answers.md): calendar dates, explicit instants, and metadata-driven choices.
- [Capabilities](capabilities.md): supported operations, observed limitations, and verification evidence reproduced in a sandbox tenant.
- [Development](development.md): working from source, synthetic tests, and packaging.

Sandbox reproductions establish the behavior observed in those fixtures. They do not establish permissions, configuration, or successful execution for every deployment. The API and helpers use the tenant supplied by your application.
