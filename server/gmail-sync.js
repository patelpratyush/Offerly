import { z } from "zod";
import { HttpError } from "./security.js";
import {
  gmailAccount,
  gmailAccessToken,
  markGmailRevoked,
} from "./gmail-account.js";
import { extractRecruitingMessage } from "./integrations/gmail-extraction.js";
const TWO_HOURS = 7200000;
const RETENTION = 30 * 86400000;
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const inputSchema = z
  .object({
    after: date,
    before: date,
    maxMessages: z.number().int().min(1).max(1000),
  })
  .strict()
  .refine(
    (v) =>
      Date.parse(v.before) > Date.parse(v.after) &&
      Date.parse(v.before) - Date.parse(v.after) <= 366 * 86400000,
    "Choose a window of at most 366 days",
  );
export async function initializeGmailSync(store) {
  if (store.db.hosted) return;
  await store.db
    .exec(`CREATE TABLE IF NOT EXISTS gmail_sync(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,generation TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE IF NOT EXISTS gmail_seen(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,source_id TEXT NOT NULL,PRIMARY KEY(user_id,source_id));`);
}
async function row(store, user) {
  return store.db.prepare("SELECT * FROM gmail_sync WHERE user_id=?").get(user);
}
const decode = (r) =>
  r ? JSON.parse(r.state) : { status: "idle", processed: 0, proposed: 0 };
function publicState(state) {
  const {
    status,
    processed,
    proposed,
    after,
    before,
    maxMessages,
    lastError,
    nextSyncAt,
    truncated,
    resync,
    coverageIncomplete,
  } = state;
  return {
    status,
    processed,
    proposed,
    after,
    before,
    maxMessages,
    lastError,
    nextSyncAt,
    truncated,
    resync,
    coverageIncomplete,
  };
}
async function update(store, r, state) {
  const result = await store.db
    .prepare(
      "UPDATE gmail_sync SET state=?,version=version+1 WHERE user_id=? AND generation=? AND version=?",
    )
    .run(JSON.stringify(state), r.user_id, r.generation, r.version);
  return result.changes > 0;
}
export function mountGmailSync(app, store, options = {}) {
  app.get("/api/gmail/import", async (req, res) =>
    res.json(publicState(decode(await row(store, req.user.id)))),
  );
  app.post("/api/gmail/import", async (req, res) => {
    const input = inputSchema.parse(req.body);
    const account = await gmailAccount(store, req.user.id);
    if (account?.status !== "connected")
      throw new HttpError(409, "Connect Gmail first");
    const state = {
      ...input,
      status: "queued",
      processed: 0,
      proposed: 0,
      pageToken: "",
      historyId: "",
      mode: "import",
      nextSyncAt: 0,
      lastError: "",
      attempts: 0,
    };
    await store.atomic(async () => {
      const old = decode(await row(store, req.user.id));
      if (["queued", "running", "retry"].includes(old.status))
        throw new HttpError(409, "Cancel the current import first");
      await store.db
        .prepare(
          "INSERT INTO gmail_sync(user_id,generation,state,version) VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,state=excluded.state,version=gmail_sync.version+1",
        )
        .run(req.user.id, account.generation, JSON.stringify(state));
    });
    res.json(publicState(state));
  });
  for (const action of ["cancel", "retry"])
    app.post(`/api/gmail/import/${action}`, async (req, res) => {
      const r = await row(store, req.user.id);
      const state = decode(r);
      if (
        !r ||
        (action === "retry"
          ? !["failed", "canceled"].includes(state.status)
          : !["queued", "running", "retry"].includes(state.status))
      )
        throw new HttpError(409, "Import cannot perform this action");
      const next = {
        ...state,
        status: action === "cancel" ? "canceled" : "queued",
        attempts: 0,
        leaseUntil: 0,
        nextSyncAt: 0,
        lastError: "",
      };
      if (!(await update(store, r, next)))
        throw new HttpError(409, "Import changed; refresh first");
      res.json(publicState(next));
    });
  void options;
}
async function request(path, token, fetchImpl) {
  const response = await fetchImpl(
    `https://gmail.googleapis.com/gmail/v1/users/me/${path}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) {
    await response.body?.cancel();
    const error = new Error("gmail_provider_failure");
    error.status = response.status;
    error.retryAfter = Math.min(
      86400000,
      Math.max(0, Number(response.headers.get("retry-after")) || 0) * 1000,
    );
    throw error;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 2 * 1024 * 1024) throw new Error("gmail_response_too_large");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function processGmailSync(
  store,
  {
    deadline = Date.now() + 15000,
    now = Date.now(),
    fetchImpl = fetch,
    accessToken = gmailAccessToken,
    enabled = process.env.GMAIL_ENABLED === "true",
  } = {},
) {
  if (!enabled) return { disabled: true, processed: 0 };
  const rows = await store.db
    .prepare("SELECT * FROM gmail_sync ORDER BY user_id")
    .all();
  let processed = 0;
  for (const initial of rows) {
    if (Date.now() >= deadline) break;
    await purgeGmailEvidence(store, initial.user_id, { now });
    const state = decode(initial),
      account = await gmailAccount(store, initial.user_id);
    if (
      !account ||
      account.status !== "connected" ||
      String(account.generation) !== String(initial.generation)
    )
      continue;
    if (
      ["failed", "canceled", "idle"].includes(state.status) ||
      state.nextSyncAt > now ||
      state.leaseUntil > now
    )
      continue;
    const claim = { ...state, status: "running", leaseUntil: now + 120000 };
    if (!(await update(store, initial, claim))) continue;
    let current = { ...initial, version: initial.version + 1 };
    try {
      const token = await accessToken(
        store,
        initial.user_id,
        account.generation,
      );
      if (!claim.historyId) {
        const profile = await request("profile", token, fetchImpl);
        if (!/^\d+$/.test(profile.historyId))
          throw new Error("invalid_history");
        claim.historyId = profile.historyId;
        // Persist the starting cursor before reading messages. A crash must not
        // replace it with a newer cursor and silently skip concurrent arrivals.
        if (!(await update(store, current, claim))) continue;
        current = { ...current, version: current.version + 1 };
      }
      let page = claim.pendingPage;
      if (!page && claim.mode === "history") {
        const params = new URLSearchParams({
          startHistoryId: claim.historyId,
          maxResults: "20",
          historyTypes: "messageAdded",
          ...(claim.pageToken ? { pageToken: claim.pageToken } : {}),
        });
        try {
          page = await request(`history?${params}`, token, fetchImpl);
        } catch (error) {
          if (error.status !== 404) throw error;
          claim.mode = "import";
          claim.pageToken = "";
          claim.historyId = "";
          claim.processed = 0;
          claim.resync = true;
          claim.resyncAfter = claim.after;
          claim.resyncBefore = new Date(now + 86400000)
            .toISOString()
            .slice(0, 10);
          claim.status = "queued";
          claim.leaseUntil = 0;
          claim.nextSyncAt = now;
          await update(store, current, claim);
          continue;
        }
      } else if (!page) {
        const params = new URLSearchParams({
          q: `after:${Math.floor(Date.parse(claim.resyncAfter || claim.after) / 1000)} before:${Math.floor(Date.parse(claim.resyncBefore || claim.before) / 1000)}`,
          maxResults: String(Math.min(20, claim.maxMessages - claim.processed)),
          ...(claim.pageToken ? { pageToken: claim.pageToken } : {}),
        });
        page = await request(`messages?${params}`, token, fetchImpl);
      }
      const entries =
        claim.mode === "history"
          ? [
              ...new Map(
                (page.history || [])
                  .flatMap((h) => h.messagesAdded || [])
                  .map((e) => [e.message.id, e.message]),
              ).values(),
            ]
          : page.messages || [];
      if (!Array.isArray(entries) || entries.length > 1000)
        throw new Error("invalid_page");
      const applications = await store.list(initial.user_id, "application");
      const proposals = [];
      let consumed = claim.pageOffset || 0;
      let count = 0;
      for (const entry of entries.slice(consumed)) {
        if (
          count >= 5 ||
          Date.now() >= deadline ||
          (claim.mode === "import" &&
            claim.processed + count >= claim.maxMessages)
        )
          break;
        count++;
        consumed++;
        if (!/^[a-f0-9]+$/i.test(entry.id)) throw new Error("invalid_message");
        const seen = await store.db
          .prepare(
            "SELECT source_id FROM gmail_seen WHERE user_id=? AND source_id=?",
          )
          .get(initial.user_id, entry.id);
        if (seen) continue;
        let message;
        try {
          message = await request(
            `messages/${entry.id}?format=full`,
            token,
            fetchImpl,
          );
        } catch (error) {
          if (error.status === 404) {
            proposals.push({ id: entry.id });
            continue;
          }
          throw error;
        }
        proposals.push({
          id: entry.id,
          evidence: extractRecruitingMessage(message, applications),
        });
      }
      await store.atomic(async () => {
        const latest = await row(store, initial.user_id),
          active = await gmailAccount(store, initial.user_id);
        if (
          !latest ||
          latest.version !== current.version ||
          active?.status !== "connected" ||
          String(active.generation) !== String(initial.generation)
        )
          return;
        for (const item of proposals) {
          if (
            await store.db
              .prepare(
                "SELECT source_id FROM gmail_seen WHERE user_id=? AND source_id=?",
              )
              .get(initial.user_id, item.id)
          )
            continue;
          if (item.evidence) {
            const evidence = await store.save(
              initial.user_id,
              "recruiting_evidence",
              {
                ...item.evidence,
                proposedContacts: item.evidence.contacts,
                expiresAt: new Date(now + RETENTION).toISOString(),
                recordedAt: new Date(now).toISOString(),
              },
              undefined,
              undefined,
              "recruiting_gmail",
            );
            await store.save(
              initial.user_id,
              "recruiting_job",
              {
                evidenceId: evidence.id,
                status: "queued",
                attempts: 0,
                availableAt: now,
                leaseUntil: 0,
              },
              undefined,
              undefined,
              "recruiting_gmail",
            );
            claim.proposed++;
          }
          await store.db
            .prepare(
              "INSERT INTO gmail_seen(user_id,source_id) VALUES(?,?) ON CONFLICT(user_id,source_id) DO NOTHING",
            )
            .run(initial.user_id, item.id);
        }
        claim.processed += count;
        if (
          consumed < entries.length &&
          !(claim.mode === "import" && claim.processed >= claim.maxMessages)
        ) {
          claim.pendingPage = page;
          claim.pageOffset = consumed;
          claim.status = "queued";
          claim.leaseUntil = 0;
          claim.nextSyncAt = now;
          await update(store, current, claim);
          processed += count;
          return { processed };
        }
        delete claim.pendingPage;
        delete claim.pageOffset;
        claim.pageToken = page.nextPageToken || "";
        if (
          claim.pageToken &&
          (typeof claim.pageToken !== "string" || claim.pageToken.length > 4096)
        )
          throw new Error("invalid_page_token");
        if (claim.mode === "import" && claim.processed >= claim.maxMessages) {
          claim.pageToken = "";
          claim.truncated = !!page.nextPageToken || consumed < entries.length;
          claim.coverageIncomplete = claim.truncated;
        }
        if (!claim.pageToken) {
          if (claim.mode === "history") {
            if (!/^\d+$/.test(page.historyId))
              throw new Error("invalid_history");
            claim.historyId = page.historyId;
            claim.status = claim.coverageIncomplete ? "partial" : "completed";
            claim.nextSyncAt = now + TWO_HOURS;
          } else {
            claim.mode = "history";
            claim.status = "queued";
            claim.nextSyncAt = now;
          }
        } else {
          claim.status = "queued";
          claim.nextSyncAt = now;
        }
        claim.leaseUntil = 0;
        claim.attempts = 0;
        claim.lastError = "";
        await update(store, current, claim);
        processed += count;
      });
    } catch (error) {
      if (error.status === 401)
        await markGmailRevoked(store, initial.user_id, account.generation);
      const attempts = (claim.attempts || 0) + 1;
      await update(store, current, {
        ...claim,
        status: attempts >= 5 || error.status === 401 ? "failed" : "retry",
        attempts,
        leaseUntil: 0,
        nextSyncAt:
          now +
          Math.max(
            error.retryAfter || 0,
            Math.min(TWO_HOURS, 30000 * 2 ** attempts),
          ),
        lastError:
          error.status === 401
            ? "Reconnect Gmail to continue"
            : "Gmail sync failed; retry available",
      });
    }
  }
  return { processed };
}

export async function purgeGmailEvidence(
  store,
  userId,
  { all = false, now = Date.now() } = {},
) {
  return store.atomic(async () => {
    const evidence = (await store.list(userId, "recruiting_evidence")).filter(
      (e) =>
        e.sourceType === "gmail" && (all || Date.parse(e.expiresAt) <= now),
    );
    const ids = new Set(evidence.map((e) => e.id));
    const sourceIds = evidence.map((e) => e.sourceId);
    function redact(value) {
      if (
        typeof value === "string" &&
        value.startsWith("Gmail participant; source ") &&
        (all || sourceIds.some((id) => value.includes(id)))
      )
        return "Gmail participant; source evidence expired";
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value).map(([k, v]) => [k, redact(v)]),
        );
      return value;
    }
    for (const contact of await store.list(userId, "contact")) {
      const data = { ...contact };
      delete data.id;
      delete data.version;
      const redacted = JSON.stringify(redact(data));
      if (redacted !== JSON.stringify(data))
        await store.db
          .prepare(
            "UPDATE records SET data=?,version=version+1 WHERE user_id=? AND id=?",
          )
          .run(redacted, userId, contact.id);
    }
    // Audit snapshots may retain earlier contact provenance after manual edits.
    for (const event of await store.db
      .prepare("SELECT id,before_data,after_data FROM events WHERE user_id=?")
      .all(userId)) {
      const before = event.before_data
        ? JSON.stringify(redact(JSON.parse(event.before_data)))
        : null;
      const after = JSON.stringify(redact(JSON.parse(event.after_data)));
      if (before !== event.before_data || after !== event.after_data)
        await store.db
          .prepare(
            "UPDATE events SET before_data=?,after_data=? WHERE user_id=? AND id=?",
          )
          .run(before, after, userId, event.id);
    }
    for (const kind of ["recruiting_job", "recruiting_review"])
      for (const record of await store.list(userId, kind))
        if (ids.has(record.evidenceId)) ids.add(record.id);
    // Operation receipts contain full review snapshots. Clear them with their audit
    // copies rather than retain expired content in an idempotency cache.
    if (ids.size || all)
      for (const record of await store.list(userId, "recruiting_operation"))
        if (all || [...ids].some((id) => JSON.stringify(record).includes(id)))
          ids.add(record.id);
    for (const id of ids) {
      await store.db
        .prepare("DELETE FROM events WHERE user_id=? AND record_id=?")
        .run(userId, id);
      await store.db
        .prepare("DELETE FROM records WHERE user_id=? AND id=?")
        .run(userId, id);
    }
    if (all) {
      await store.db
        .prepare("DELETE FROM gmail_sync WHERE user_id=?")
        .run(userId);
      await store.db
        .prepare("DELETE FROM gmail_seen WHERE user_id=?")
        .run(userId);
    }
    return { purged: ids.size };
  });
}
