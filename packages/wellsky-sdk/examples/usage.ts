import { WellSkyClient, toItems, type ClientOptions, type ServiceAddViewModel } from "@choiceapps/communityservices-sdk";
import { WellSkyClient as WellSkyV2 } from "@choiceapps/communityservices-sdk/v2";

// These functions do not run on import. Pass credentials from your server's secret store.
export async function findClient(options: ClientOptions, clientId: number) {
  const client = new WellSkyClient(options);
  return toItems(await client.clients.get({ path: { clientId } }));
}

export async function readClients(options: ClientOptions, consume: (clientId: number) => Promise<void>) {
  const client = new WellSkyClient(options);
  for await (const person of client.paginate("GET /clients", { query: { perPage: 30 }, maxPages: 100 })) {
    if (person.clientId !== undefined) await consume(person.clientId);
  }
}

export async function createService(options: ClientOptions, body: ServiceAddViewModel) {
  return toItems(await new WellSkyClient(options).services.create({ body }));
}

export async function findClientV2(options: ClientOptions, clientId: number) {
  return toItems(await new WellSkyV2(options).clients.get({ path: { clientId } }));
}
