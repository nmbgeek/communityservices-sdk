import { WellSkyClient, toItems, type ClientViewModelV2 } from "../dist/esm/index.js";
import { WellSkyClient as V2Client, type ClientAddViewModel } from "../dist/esm/v2.js";
import type { ApiResponse, CountedCollection } from "../dist/esm/index.js";

const counted: CountedCollection<ClientViewModelV2> = { count: 1, values: [{ clientId: 123 }] };
const responseWithCount: ApiResponse<ClientViewModelV2> = counted;
const countedItems: ClientViewModelV2[] = toItems(responseWithCount);
void countedItems;

const client = new WellSkyClient({ tenant: "example_training", auth: { kind: "token", token: "example" } });
const v2 = new V2Client({ tenant: "example_training", auth: { kind: "none" } });
const oldPayload: ClientAddViewModel = { firstName: "Example", lastName: "Person" };
void v2.clients.create({ body: oldPayload });
void v2.clients.create({ body: { ...oldPayload, svpprofrace: "example" } });
void client.clients.create({ body: { firstName: "Example", lastName: "Person", hud_raceethnicity: "example" } });
// @ts-expect-error V3 race/ethnicity fields do not belong to V2 payloads.
void v2.clients.create({ body: { ...oldPayload, hud_raceethnicity: "example" } });
// @ts-expect-error V2 race fields do not belong to V3 payloads.
void client.clients.create({ body: { firstName: "Example", lastName: "Person", svpprofrace: "example" } });
void client.clients.list();
void client.clients.get({ path: { clientId: 123 } }).then(response => {
  const items: ClientViewModelV2[] = toItems(response);
  return items;
});
void client.request("GET /clients", { query: { perPage: 10, "$filter": "clientId gt 0" } });
void client.request("GET /clients/{clientId}", { path: { clientId: 123 } });
void client.paginate("GET /services/{clientId}", { path: { clientId: 123 } });
// @ts-expect-error Missing required path.
void client.clients.get();
// @ts-expect-error Client identifiers are numbers.
void client.clients.get({ path: { clientId: "123" } });
// @ts-expect-error Required request bodies cannot be omitted.
void client.services.create();
// @ts-expect-error Invalid payload.
void client.services.create({ body: { clientId: 123 } });
// @ts-expect-error No arbitrary endpoint strings.
void client.request("DELETE /services/123");
// @ts-expect-error Typed request enforces path requirements.
void client.request("GET /clients/{clientId}");
// @ts-expect-error Query types are checked.
void client.clients.list({ query: { perPage: "ten" } });
// @ts-expect-error Only paginated GET operations can be iterated.
void client.paginate("POST /services/create", { body: {} });
// @ts-expect-error Version belongs to the entry point, not mutable client config.
new WellSkyClient({ tenant: "example", auth: { kind: "none" }, version: "2.0" });
