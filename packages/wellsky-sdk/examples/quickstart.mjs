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
