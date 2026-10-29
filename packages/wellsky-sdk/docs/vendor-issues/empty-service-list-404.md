# Service collection returns 404 for a client with no services

Status: reproduced in a sandbox tenant on October 24, 2026, using Client API V3. V2 and other tenant deployments were not tested for this issue.

## Request

An authenticated request for an existing, active synthetic client with no service transactions:

```http
GET /client-api-prod/services/{clientId}?perPage=100&startPage=1&total_count=true
Host: csclientapi.wellsky.com
x-tenant: your-tenant
x-version: 3.0
Authorization: Bearer <redacted>
```

Use a new synthetic client in an authorized sandbox tenant. Verify the client exists before making this request. Do not substitute a nonexistent client ID.

## Expected and actual results

Expected: HTTP 200 with a counted empty collection, consistent with the same endpoint's nonempty collection response:

```json
{"count":0,"values":[]}
```

Actual: HTTP 404. The SDK reported `UpstreamError`, `kind: "http"`, `status: 404`, operation `GET /services/{clientId}`.

The client could be opened in the Community Services UI. A fresh, counted GWT query for active service IDs returned zero rows with total zero. The failed REST read therefore did not indicate a missing client. Requests for the user-created shelter examples with existing service records returned HTTP 200 and counted collections.

## Reproduction steps

1. Create a synthetic client through the normal client-creation workflow.
2. Open that client in the UI and confirm that no services have been recorded.
3. Call the endpoint above with valid V3 credentials for the same tenant.
4. Record the HTTP status and response body without including tokens in the report.
5. Compare with a client that has at least one active service transaction.

## Impact and SDK workaround

A collection reader cannot distinguish this response from a missing client, authorization problem, or other routing failure using HTTP status alone. Treating every 404 as an empty collection could let a retry create duplicate services.

The shelter workflow only treats this specific first-page 404 as empty after a separate authenticated, client-scoped GWT read proves there are zero active services. It propagates other errors and rejects incomplete reads. This workaround requires a UI session; it is not a change to the generic REST transport's 404 semantics.

## Questions for WellSky

- Is HTTP 404 for an existing client's empty service collection intentional? If so, please document a response code/body that distinguishes it from missing or inaccessible clients.
- Could empty collections return HTTP 200 with `count: 0` and `values: []`?
- Do other collection endpoints or API versions follow the same convention?

This report intentionally omits credentials, client demographics, and raw GWT payloads. Private sandbox evidence retains the synthetic IDs for an authorized support follow-up.
