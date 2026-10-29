# Attachment authentication fails after successful ordinary API authentication

[WellSky feedback](README.md) · [SDK attachment handling](../files-and-notes.md)

Status: reproduced in a sandbox tenant on October 22, 2026. Attachment reads failed in V2 and V3. A native multipart create also failed. The root cause is unconfirmed; the evidence does not establish a failure for every account or tenant. This is prepared feedback, not a record of a submitted or acknowledged support ticket.

## Observed contract and result

The pinned attachment contracts require REST bearer authentication plus body credentials. `POST /fileattachments/clients/get` takes `username`, `password`, and `client_id`. `POST /fileattachments/clients/create` takes multipart credentials, entity metadata, and `fileData`.

| Control | Observed result |
| --- | --- |
| Fresh `SetAuthKey` using the supplied REST account | HTTP 200 and a token |
| Ordinary client GET using that token | HTTP 200 and the expected synthetic client |
| Attachment list using the same token and credentials | HTTP 400: `User details are not matching with token user details` in both API versions |
| Native JSON list request outside the SDK | Same failure |
| Native Node FormData upload | Same mismatch; locally decoded multipart fields and bytes matched the intended values |
| Fresh authenticated browser attachment read after the failed upload | Existing attachment identities unchanged; attempted filename absent |

The username had no surrounding whitespace and matched the token's `unique_name`. The token's `user_id` contained literal single quotes around the numeric value, for example `"'1234'"`. That format is a possible contributor if the server compares quoted and unquoted identities. It is not a proven cause. Account permissions or another server lookup remain possible explanations.

Alternate documented authentication routes did not produce a working attachment token. No evidence justified password encoding changes, editing a signed token, or silently using another account.

## Reproduction for an authorized support session

1. Select a synthetic client and an account with confirmed intended attachment permissions.
2. Mint a fresh REST token and confirm an ordinary client GET succeeds.
3. Use the same token, tenant, and account in the documented attachment-list request for V3 and V2.
4. Compare the HTTP result and sanitized error with a native request outside the SDK.

The list request is enough to demonstrate the mismatch without uploading a file. Token minting can still affect other sessions. An upload reproduction requires separately authorized write scope.

## Questions for WellSky

- What account type, permissions, and token flow do these attachment routes require?
- Does attachment identity validation accept the single-quoted `user_id` issued by `SetAuthKey`?
- Are the additional body credentials expected to match the bearer-token account exactly?
- If additional requirements exist, can they be included in Swagger with a working request example?

The SDK currently uses browser-authenticated multipart uploads and verifies stored bytes by downloading and hashing them. No client-side REST serialization or authentication defect was established. Supply request timestamps, versions, paths, and correlation identifiers to support; keep passwords, bearer tokens, raw JWTs, and client data out of shared reports.
