# Phase 0 Gmail validation

Updated October 22, 2026. Real local Google authorization and historical body
retrieval succeeded. All-mail scans initially stopped after about 100 messages
with HTTP 403 `rateLimitExceeded`; full traversal has not yet passed. Reusable offline authorization was stored in macOS login Keychain and successfully reused by a separate process without opening a browser. A paced all-mail scan is now running. This does
not validate recruiting extraction, matching, ongoing sync, or hosted OAuth.

## Authorization and data boundaries

Owner explicitly authorized reading all emails, including personal messages,
across history, including Spam and Trash. Owner subsequently requested reusable
access instead of repeated permission prompts. Request only
`https://www.googleapis.com/auth/gmail.readonly`: no sending, modifying, labeling,
or deleting email. The scope is restricted; metadata scope does not provide bodies
or avoid restricted-scope obligations. [Google scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

Local Desktop OAuth uses the system browser, PKCE S256, 256-bit single-use state,
a transient IPv4 loopback listener, and an exact redirect URI. Tokens and provider
errors never appear in logs. Initial browser approval remains required. Refresh
tokens use macOS Keychain; access tokens remain in memory. No plaintext token-file
fallback exists. Later runs reuse the saved grant; invalid/revoked grants reconnect.
Google External/Testing Gmail refresh tokens normally expire after seven days;
revocation, password changes and policies can also require reauthorization.
[Expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration)

Email content stays in memory, processed one message at a time, never rendered,
executed, printed, persisted, or sent to external AI. No attachment endpoints or
raw MIME are requested. Gmail may include inline attachment bytes or nested MIME
headers in full-message responses; attachment parts are skipped without decoding
or saving. Aggregate output contains no addresses, subjects, message/thread IDs,
body excerpts, authorization URLs, codes, or tokens. Counts do not prove semantic
extraction accuracy. No application records are changed.

## Owner setup

1. Enable Gmail API in a dedicated Google Cloud project.
2. Configure Google Auth Platform branding and External/Testing audience. Add only
   consenting accounts as test users.
3. Add `gmail.readonly` under Data Access.
4. Create a **Desktop app** OAuth client and download its original JSON.
5. Save it as ignored `data/google-oauth-client.json`, mode `600`; set only
   `GOOGLE_OAUTH_CLIENT_FILE=data/google-oauth-client.json` in ignored `.env.local`.
   Never paste credentials into chat or commit downloaded JSON.

Client configuration and test user were supplied. Initial browser approvals have
succeeded. [Desktop setup and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app),
[Gmail quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs)

## Commands

```sh
# Configuration checks only: no network or consent.
npm run phase0:gmail
# Connect/reuse grant without reading messages.
npm run phase0:gmail:live -- --authorize-only
# Read all returned messages locally; output aggregates only.
npm run phase0:gmail:live -- --all-mail
# Revoke Google grant and remove local Keychain token.
npm run phase0:gmail:live -- --disconnect
```

macOS and Swift command-line tools are required for local Keychain helper.
Credential JSON must be private, regular, nonsymlink, and ignored/outside Git.
Keychain access fails closed when unavailable or denied; no plaintext fallback.
Disconnect removes the local credential even if remote revocation fails and
prints manual Google Account removal instructions in that case. Revoking this
Desktop client's grant can affect other sessions using the same client.

## Retrieval limits and truthful reporting

Pagination uses batches of 100, including Spam/Trash. Requests are spaced at least
one second apart; every request has a 20-second timeout and capped response
(16 MiB for a message, 1 MiB for a list, 64 KiB for an error). Known transient
rate-limit 403, 429, and 5xx errors permit six retries with bounded exponential
backoff. Provider Retry-After delays up to 60 seconds are honored; longer delays
stop safely. Permission, domain policy, daily quota and unknown 403 reasons stop.
Only fixed error categories, numeric HTTP status and allowlisted provider reasons
leave the process; raw provider messages never do.

Deleted messages (404) and oversized responses are counted as skips and allow
pagination to continue. Any skip keeps `completed: false`. `paginationCompleted`
means the returned page chain was exhausted, not a consistent mailbox snapshot.
Cancellation, quota exhaustion and other errors retain partial aggregate counts
without claiming completion. Refreshable access avoids one-hour access-token
expiry stopping a long scan. SIGINT/SIGTERM stop reading but retain the reusable
Keychain grant until explicit disconnect or Google expiry/revocation.
[Message list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[Message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[Error handling](https://developers.google.com/workspace/gmail/api/guides/handle-errors)

## Hosted and public release gates

This local tool is not a production Gmail connection UI. Hosted web OAuth,
per-user ownership, encrypted hosted credential storage, disconnect/deletion,
retention policy, deduplication, durable cursors, ongoing sync, recruiting evidence
review, extraction accuracy and correction/undo still need implementation and
validation. Reserved hosted callback `/api/connections/gmail/callback` is not
implemented; do not configure it for this Desktop test.

Google documents personal-use/development verification exceptions, but a private
invite gate alone does not establish eligibility. Resolve the actual exception or
restricted-scope verification and applicable assessment before broader rollout.
Do not publish merely to bypass Testing expiry. Google data-use duties still
apply, including restrictions on advertising and general-purpose model training.
[Verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification),
[Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
