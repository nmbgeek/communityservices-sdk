# Read a synthetic client without an HMIS account

[Documentation index](README.md) · [Using the SDK](using-the-sdk.md)

This example reads one synthetic client through the SDK's real validation and transport code. The fake transport cannot send requests to WellSky.

## Install the package

Use Node 22 or newer, then install from the default npm registry:

```sh
npm install @choiceapps/communityservices-sdk
```

If you are in the SDK source checkout, run `npm ci` and `npm run build` in `packages/wellsky-sdk` instead. This builds the package's self-referenced imports.

## Run the read

Save the following as `quickstart.mjs` in your application directory:

<!-- checked-example: examples/quickstart.mjs -->
```js
import assert from 'node:assert/strict';
import {createFakeWellSkyClient} from '@choiceapps/communityservices-sdk/testing';
import {toItems} from '@choiceapps/communityservices-sdk';

const client = createFakeWellSkyClient();
client.fake.set('GET /clients/{clientId}', {
	kind: 'reply', body: [{clientId: 123, firstName: 'Synthetic'}],
});
const people = toItems(await client.clients.get({path: {clientId: 123}}));
assert.equal(people.length, 1);
assert.equal(people[0].clientId, 123);
assert.equal(client.fake.calls.length, 1);
console.log('Read synthetic client 123; no network requests.');
```

Run it:

```sh
node quickstart.mjs
```

Expected output:

```text
Read synthetic client 123; no network requests.
```

The same file ships as [examples/quickstart.mjs](../examples/quickstart.mjs). From the SDK checkout, run `node examples/quickstart.mjs` after the build.

## Connect your application

For a real read, construct a `WellSkyClient` with your tenant and credentials from your server's secret store. Follow [Configure a client](rest-client.md#configure-a-client). Replace the synthetic ID with an authorized client ID from your application.

For mutations, first choose a verified workflow from the [capability table](capabilities.md). Preserve its journal and stable keys. Do not convert this example into a retry loop around a raw write.
