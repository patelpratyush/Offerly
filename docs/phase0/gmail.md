# Phase 0 Gmail validation

Checked 2026-10-22 against MAIL 01–05. **Dependency research complete; live OAuth and consented historical import NOT validated.** Do not mark the Phase 0 Gmail exit complete from this document or configuration checks.

## Observed repository and tool state

- Offerly has no Gmail OAuth routes, refresh-token store, consent screen, mailbox import adapter, or Gmail connection UI.
- Local `.env`/`.env.local` inspection found `APP_ORIGIN` present; `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GMAIL_TOKEN_ENCRYPTION_KEY` absent. Only presence was inspected/reported; no credentials were printed.
- Codex has Gmail read/search tools available. That connection belongs to the assistant's tool environment, not Offerly. Its token is not an Offerly credential. No mailbox was searched, read, or imported for this work.
- No Google Cloud project, consent, verification status, or production environment credentials were inspected. Local absence does not prove production absence.

## Scope and pilot decision

Request **only** `https://www.googleapis.com/auth/gmail.readonly` for initial mailbox import. It permits message content needed for evidence and cannot send, label, modify, or delete mail. `gmail.metadata` cannot supply bodies and remains restricted, so it does not solve extraction or avoid verification requirements. [Google scope reference](https://developers.google.com/workspace/gmail/api/auth/scopes)

Google documents a personal-use verification exception for a few users personally known to the developer, plus a development/testing exception. Offerly's two-person invited pilot may fit; an invitation gate by itself is not an exemption for a broader public product. Record the owner's use case and applicable exception before connecting accounts. The exception is not a Google approval or a waiver of data-use/security duties. [Verification and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)

Use External/Testing for the first controlled prototype. Add exactly the consenting Google accounts as test users. Gmail-scope refresh tokens in Testing expire after **seven days**; reconnect is expected. Revocation, Gmail password changes, and administrator policies can also invalidate tokens. Do not promise permanent access or publish the app merely to bypass testing limits. [OAuth expiration](https://developers.google.com/identity/protocols/oauth2#expiration)

For a public launch, resolve restricted-scope verification and applicable annual independent security assessment before release; server-side storage/transmission is within Google's assessment discussion. Confirm requirements with Google for the actual architecture and exception rather than declaring a private pilot automatically certified. Offerly's email-derived productivity tracking appears consistent with a listed productivity/reporting category; Google determines eligibility. Do not use Gmail data for ads or general-purpose model training. Disclose any extraction provider and minimize transferred content. [Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)

## Recommended Phase 0 route: real local Desktop OAuth prototype

Budget: **$0 additional spend**. Use a Desktop app client and loopback browser callback on this Mac for the one-run integration proof. No owned domain, Vercel deployment, web callback, or token-encryption key is needed for this local in-memory-only prototype. Do not add paid services. Google API quotas and any policy restrictions still apply. The desktop prototype is not the later hosted Gmail integration.

### Exact owner setup

1. Open [Google Cloud Console](https://console.cloud.google.com/). Select/create a dedicated **Offerly pilot** project. Under APIs & Services → Library, enable **Gmail API**. Do not enable unrelated paid APIs or attach paid infrastructure for this proof.
2. Open Google Auth Platform → Branding (Get Started if needed). Set app name **Offerly pilot**, choose your support email, and supply your developer contact email. Review Google's policy acknowledgment yourself.
3. Set Audience **External** and publishing status **Testing**. Add your own Google account under **Test users**. Add your friend only when they agree to test their own mailbox. Do not choose Internal for unrelated personal Gmail accounts.
4. Under Data Access, add exactly `https://www.googleapis.com/auth/gmail.readonly`. No send/modify/full-mail permission. The scope permits mailbox reading; our prototype must enforce the narrower user-approved window and query.
5. Under Clients → Create client, choose **Desktop app**, name **Offerly local validation**, and create it. Download the client JSON. It should contain top-level `installed` with `client_id`, `client_secret`, `auth_uri`, `token_uri`, and `redirect_uris` (typically `http://localhost`). Do not choose Web application for this local proof.
6. Save the file locally as `data/google-oauth-client.json` inside this repository. `data/` is already Git-ignored. Restrict permissions with `chmod 600 data/google-oauth-client.json`. Never commit the file, paste its contents into chat, or store refresh/access tokens in it. The readiness script also accepts an owner-only file outside this repository.
7. Add only the path to ignored `.env.local`: `GOOGLE_OAUTH_CLIENT_FILE=data/google-oauth-client.json`. No credentials need to be pasted into environment text or chat.
8. Run the readiness command below. Tell Codex **“Desktop client saved”**, and specify the consenting mailbox and intended 30-day date interval locally before any OAuth/import run. Do not paste mailbox contents. Configuration shape passing does not prove Google project state or authorize reading.

Steps use [Google's desktop credential guide](https://developers.google.com/identity/protocols/oauth2/native-app) and [Gmail Node quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs). Google describes desktop clients as public clients: downloaded `client_secret` is an identifier supplied by Google's client format, not a substitute for PKCE. Keep the file private anyway.

### Local prototype contract, after client provisioning

No OAuth implementation was added during readiness work. Once the owner provisions the client, use a maintained Google OAuth library, an external system browser, **PKCE S256**, and unpredictable single-use state. Bind a transient HTTP listener only to **127.0.0.1** on an available port, and use the exact selected `http://127.0.0.1:<port>/` URI in both authorization and code exchange. Desktop OAuth permits loopback redirects; do not use deprecated out-of-band copy/paste codes, an embedded browser, or the Vercel hostname. Validate callback state, reject duplicate callbacks, stop listener after completion/timeout, and never log authorization codes or token responses.

Access and refresh tokens stay **in memory for this one-run proof**. Do not copy Google's quickstart `token.json` persistence approach. No stored token file means no token-encryption key needed for this proof; a future durable connection needs encrypted credentials and key management. Request only read scope, check actual granted scope, and obtain explicit mailbox/query/date-window consent before any message request. Open consent only on explicit invocation, never during readiness. Revoke temporary grant after proof if the user chooses; discard all token references and exit. Confirm revocation outcomes without printing token values.

Google's [desktop OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app) specifies PKCE, external-browser authorization, and loopback response handling. Future implementation must follow current docs and installed client-library APIs rather than copying unmaintained samples.

## Read-only configuration checks

```sh
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/phase0-gmail-readiness.js
```

Default `desktop` mode reads only the named ignored/outside-repository credential JSON (regular nonsymlink file, at most 64 KiB). It checks owner-only permissions, installed-client shape, client ID shape, Google authorization/token endpoints, and localhost/loopback redirect support. Output contains booleans and fixed status labels only; no path, credential, token, or email values. No network requests, consent browser, or mailbox reads. Exit 2 means missing/invalid configuration. Exit 0 means config shape passes, **not** authorization/import success.

Optional later hosted readiness:

```sh
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/phase0-gmail-readiness.js web
```

The later Phase 2 Web application client would use server-only `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GMAIL_TOKEN_ENCRYPTION_KEY` (canonical base64 32 random bytes), and exact `APP_ORIGIN=https://offerly-nine-delta.vercel.app`. Reserved future redirect: `https://offerly-nine-delta.vercel.app/api/connections/gmail/callback`. **That hosted endpoint is not implemented.** Do not configure or invoke it for the local proof. Later public hosting also needs real policies, ownership/branding verification and applicable assessments; a Vercel subdomain is not evidence of owning `vercel.app`.

## Future recruiting-import acceptance checklist

Original recruiting-only proposal used a 30-day window and at most 100 candidate
messages. Owner subsequently explicitly authorized all emails across history,
including personal messages. The local live proof below supersedes that proposed
window; it retains no source text and performs no extraction or application updates.
The following broader import checks remain future product acceptance requirements,
not claims that the count-only local scan satisfies them.

- [ ] Desktop OAuth allow/deny flows tested; wrong/replayed state fails closed, loopback listener never binds a public interface, and no tokens remain on disk.
- [ ] Granted scopes checked; no send/modify permission requested; declined access leaves manual tracking usable.
- [ ] Access/refresh tokens held only in memory and never logged or persisted; successful refresh and revoked/expired token handling tested.
- [ ] Bounded import reports candidate/read/relevant/review counts without logging subjects, addresses, body text, or tokens.
- [ ] Repeat same import: no duplicate message/event; connection + provider message ID unique.
- [ ] Evidence from representative real recruiting messages is reviewed by consenting user; model off remains usable.
- [ ] Ambiguous same-company roles, newsletters, old quoted text, reschedules, and rejection/offer conflicts enter review rather than inventing updates.
- [ ] Account/connection ownership checked per batch; pause/disconnect prevents subsequent fetches; unlink/delete clears credential and retained source data according to disclosed policy.
- [ ] Resume from last committed page; simulate expired history cursor with bounded overlap rescan and deduplication. [Google sync guidance](https://developers.google.com/workspace/gmail/api/guides/sync)
- [ ] Commit only aggregate validation metadata: timestamp, date-window length, consented message counts, replay results, review accuracy totals, redacted error categories, and limits. Do not commit mailbox identity, message/thread IDs, subjects, addresses, excerpts, query values, real mail fixtures, codes, or tokens. Show raw evidence only locally to consenting user and discard it after the run.

**Current state:** Desktop OAuth client provisioned privately; local PKCE reader
implemented; owner authorized all-mail reads. Live authorization/retrieval results
must still be observed. Hosted web OAuth, durable import, extraction and encrypted
credential storage remain later work.

## Local live proof (October 22, 2026)

A real Desktop OAuth reader now exists. It does not run implicitly during tests,
readiness checks, deployment, or app sign-in. After owner chooses scope:

```sh
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/phase0-gmail.js --authorize-only
node --env-file-if-exists=.env --env-file-if-exists=.env.local scripts/phase0-gmail.js --all-mail
```

`--all-mail` requires explicit owner consent and reads every message returned by
Gmail across history, including spam and trash. Current owner explicitly requested
all emails, including personal messages. Google browser consent remains required.
The process opens the system browser, binds an ephemeral IPv4 loopback callback,
uses S256 PKCE plus a random 256-bit single-use state, requests `gmail.readonly`,
and holds tokens only in memory. It never sends mail content to external AI.

Messages are paginated in batches of 100 and fetched sequentially, one message at
a time. MIME text is decoded in memory and discarded. Email text is never rendered,
executed, followed as links, printed, or written to disk. Attachment endpoints and
raw MIME are never requested. Gmail may include small embedded attachment data in
its full-message response; such parts are discarded without decoding or use.
Only aggregate counts leave the process. No local report file is written.

This proves authorization and body retrieval, **not** recruiting extraction,
application matching, or production Gmail integration. Mailbox contents can change
during pagination; completion means all pages returned by that scan were visited,
not a transactionally consistent mailbox snapshot. Access-token expiry, deleted
messages, oversized responses, quota exhaustion, cancellation, or API failure stop
the scan without claiming completion. No refresh token is requested or stored.

Each Gmail request has a 20-second deadline and a 16-MiB response cap (list responses
1 MiB). HTTP 429/5xx receive at most two retries. The OAuth callback expires after
three minutes. SIGINT/SIGTERM cancel retrieval. Successful OAuth access is revoked
in cleanup, including cancellation; if revocation fails, output instructs the owner
to remove the grant in Google Account → Third-party connections. Token revocation
for this dedicated Desktop client can invalidate other grants for the same client.

Official references:
[Desktop OAuth and PKCE](https://developers.google.com/identity/protocols/oauth2/native-app),
[message pagination](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list),
[full message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get),
[Google Auth Library](https://github.com/googleapis/google-auth-library-nodejs).

### Safe live diagnostics and concurrent mailbox changes

Reports include only allowlisted failure categories and, for HTTP failures, numeric
HTTP status. Raw provider responses, exception text, URLs, IDs and mailbox content
never appear in diagnostics. Aggregate progress updates after every visited message
in memory; console progress remains limited to each 100 successful reads. Failed
runs preserve the latest aggregate counts in their final report.

A message deleted between listing and retrieval (HTTP 404) is counted as
`messagesSkippedDeleted`. A response exceeding the fixed message-size cap is counted
as `messagesSkippedOversized`. These two known conditions allow pagination to
continue, but any skip forces `completed: false` and a partial-scan exit status.
`paginationCompleted: true` means the returned page chain was exhausted; it does
not mean every listed message was read. Other failures stop the scan. Access-token
expiry during a large mailbox scan remains a safe stop; no credentials are persisted.
