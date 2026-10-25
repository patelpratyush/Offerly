# Gmail import and cursor design proposal

Status: design proposal for Phase 2. Not implemented or provider-validated. Phase 0 local scripts perform a bounded one-page message selection and do not establish durable cursors.

## Initial import

1. Record account connection generation and requested time window.
2. Enumerate `users.messages.list` results using `pageToken` until no `nextPageToken` remains or configured message/time/byte budget is reached. Persist each page checkpoint only after every listed message has either been fetched and durably handled or recorded as a retryable failure.
3. Fetch individual messages in bounded batches; avoid attachments. Persist only minimized evidence required for review under an explicit retention policy.
4. Read a current mailbox `historyId` after initial enumeration. Save it as cursor only after initial items and the cursor are committed consistently. Handle concurrent mailbox changes by consuming history from a safe starting point before declaring sync complete.

## Incremental sync

- Store each account's opaque `historyId` cursor encrypted or access-controlled with account ownership. Never compare IDs lexically; use Gmail's History API contract.
- Call `users.history.list(startHistoryId=cursor)` and follow every returned `nextPageToken`. Process message additions/deletions and label changes according to documented supported behavior. Advance cursor atomically with durable event processing only after all pages are handled.
- HTTP 404 for an expired cursor means history is unavailable. Mark sync as resyncing, perform a bounded idempotent mailbox resync, establish a fresh cursor, and preserve already-reviewed user decisions.
- Use bounded retries and provider `Retry-After`; rate-limit responses pause work and retain cursor. Alert on repeated failures and stale sync status.

## Idempotency and ordering

Use an idempotency key derived from provider message ID plus normalized event fingerprint (event type, application identity evidence, effective timestamp, and evidence digest). Keep provider message ID private. A duplicate fetch must not create a second review item. Preserve event effective time separately from email received time; reject stale status changes and require review for ambiguous application links.

## Disconnect, deletion, and retention

- Disconnect increments a connection generation, stops queued work, revokes provider authorization where supported, and removes stored refresh credentials. In-flight workers must recheck generation before commit.
- Account deletion removes credentials, cursor state, retained message evidence, queued review data, and derived contact data under documented deletion semantics; retain only legally required minimal audit records if applicable.
- Select and disclose a content/evidence retention window before hosted connection. Options include no retained body (temporary processing plus minimal evidence), short fixed retention for unresolved review items, and user-controlled retention with explicit expiry. Expired evidence must be deleted while preserving non-content audit facts required by product behavior.
- Maintain a separate operational retention period for non-content counters and error categories. Do not log message bodies, subjects, addresses, IDs, tokens, or raw provider errors.

## Recovery and validation

Test page-token continuation, interrupted-page resume, duplicate delivery, cursor expiration/404 resync, rate-limit pause, concurrent mailbox changes, disconnect during a worker, deletion, and retention expiry with synthetic/provider-mocked data. Validate history gaps and cursor advancement in isolated accounts before enabling a hosted pilot. This proposal does not authorize live Gmail scans or claim production readiness.
