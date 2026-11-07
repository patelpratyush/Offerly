import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../helpers/store.js";
import { initializeGmail } from "../../server/gmail-account.js";
import {
  initializeGmailSync,
  processGmailSync,
  purgeGmailEvidence,
} from "../../server/gmail-sync.js";
import { extractRecruitingMessage } from "../../server/integrations/gmail-extraction.js";
const message = (text) => ({
  id: "abc",
  threadId: "def",
  internalDate: "1791000000000",
  payload: {
    mimeType: "text/plain",
    headers: [
      { name: "Subject", value: "Acme Engineer application" },
      { name: "From", value: "Recruiter <person@example.com>" },
    ],
    body: { data: Buffer.from(text).toString("base64url") },
  },
});
const apps = [
  { id: "app1", company: "Acme", title: "Engineer", requisition: "" },
];
test("deterministic proposals abstain on ambiguous application and conflicting event types", () => {
  const result = extractRecruitingMessage(
    message("Thank you for applying to Acme Engineer"),
    apps,
  );
  assert.equal(result.applicationId, "app1");
  assert.equal(result.changes.stage, "Submitted");
  assert.equal(result.contacts[0].email, "person@example.com");
  assert.equal(
    extractRecruitingMessage(
      message("Thank you for applying to Acme Engineer"),
      [...apps, { ...apps[0], id: "app2" }],
    ).applicationId,
    undefined,
  );
  assert.equal(
    extractRecruitingMessage(
      message("Thank you for applying; not moving forward"),
      apps,
    ),
    null,
  );
  assert.equal(
    extractRecruitingMessage(
      message("Hello\nOn Tuesday wrote:\nThank you for applying"),
      apps,
    ),
    null,
  );
});
async function setup(t) {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await initializeGmail(store);
  await initializeGmailSync(store);
  await store.db
    .prepare(
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES(?,?,?,?,?,?)",
    )
    .run("u", "u@example.com", "x", "U", "UTC", "[]");
  await store.db
    .prepare(
      "INSERT INTO gmail_accounts(user_id,generation,status,credentials,connected_at) VALUES(?,?,?,?,?)",
    )
    .run("u", "generation", "connected", "encrypted", 1);
  const state = {
    status: "queued",
    after: "2026-01-01",
    before: "2026-11-01",
    maxMessages: 10,
    processed: 0,
    proposed: 0,
    mode: "import",
    historyId: "",
    nextSyncAt: 0,
  };
  await store.db
    .prepare(
      "INSERT INTO gmail_sync(user_id,generation,state,version) VALUES(?,?,?,1)",
    )
    .run("u", "generation", JSON.stringify(state));
  return store;
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
test("import then history advances only after durable evidence; replay creates no duplicates", async (t) => {
  const store = await setup(t);
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith("/profile")) return json({ historyId: "100" });
    if (url.includes("/messages?")) return json({ messages: [{ id: "abc" }] });
    if (url.includes("/messages/abc"))
      return json(message("Thank you for applying"));
    return json({
      historyId: "110",
      history: [{ messagesAdded: [{ message: { id: "abc" } }] }],
    });
  };
  const options = {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl,
  };
  await processGmailSync(store, options);
  await processGmailSync(store, options);
  assert.equal((await store.list("u", "recruiting_evidence")).length, 1);
  assert.equal((await store.list("u", "application")).length, 0);
  const state = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  assert.equal(state.historyId, "110");
  assert.equal(state.status, "completed");
  await purgeGmailEvidence(store, "u", { all: true });
  assert.equal((await store.list("u", "recruiting_evidence")).length, 0);
  assert.equal(
    (await store.db.prepare("SELECT * FROM events WHERE user_id=?").all("u"))
      .length,
    0,
  );
});
test("disconnect during provider fetch fences commit", async (t) => {
  const store = await setup(t);
  const fetchImpl = async (url) => {
    if (url.endsWith("/profile")) return json({ historyId: "100" });
    if (url.includes("/messages?")) return json({ messages: [{ id: "abc" }] });
    await store.db
      .prepare(
        "UPDATE gmail_accounts SET status='disconnected' WHERE user_id=?",
      )
      .run("u");
    return json(message("Thank you for applying"));
  };
  await processGmailSync(store, {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl,
  });
  assert.equal((await store.list("u", "recruiting_evidence")).length, 0);
});
test("expired history starts bounded resync without advancing stale cursor", async (t) => {
  const store = await setup(t);
  await store.db.prepare("UPDATE gmail_sync SET state=? WHERE user_id=?").run(
    JSON.stringify({
      mode: "history",
      historyId: "1",
      status: "queued",
      after: "2026-01-01",
      before: "2026-11-01",
      maxMessages: 10,
      processed: 0,
      proposed: 0,
    }),
    "u",
  );
  await processGmailSync(store, {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl: async () => json({}, 404),
  });
  const state = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  assert.equal(state.mode, "import");
  assert.equal(state.historyId, "");
});

test("import budget survives oversized provider page and history checkpoint waits for final page", async (t) => {
  const store = await setup(t);
  const original = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  await store.db
    .prepare("UPDATE gmail_sync SET state=? WHERE user_id=?")
    .run(JSON.stringify({ ...original, maxMessages: 2 }), "u");
  let messageReads = 0;
  const options = {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl: async (url) => {
      if (url.endsWith("/profile")) return json({ historyId: "100" });
      if (url.includes("/messages?"))
        return json({
          messages: [{ id: "a" }, { id: "b" }, { id: "c" }],
          nextPageToken: "more",
        });
      if (url.includes("/messages/")) {
        messageReads++;
        return json({
          ...message("Thank you for applying"),
          id: url.split("/messages/")[1].split("?")[0],
        });
      }
      if (url.includes("pageToken=next")) return json({ historyId: "120" });
      return json({ historyId: "110", nextPageToken: "next" });
    },
  };
  await processGmailSync(store, options);
  assert.equal(messageReads, 2);
  await processGmailSync(store, options);
  let state = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  assert.equal(state.historyId, "100");
  assert.equal(state.pageToken, "next");
  await processGmailSync(store, options);
  state = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  assert.equal(state.historyId, "120");
  assert.equal(state.status, "partial");
  assert.equal(state.coverageIncomplete, true);
});

test("retention redacts accepted contact provenance and audit copies while preserving identity", async (t) => {
  const store = await setup(t);
  await store.save("u", "recruiting_evidence", {
    sourceType: "gmail",
    sourceId: "gmail:abc",
    expiresAt: "2020-01-01T00:00:00Z",
    excerpt: "private mail",
  });
  const contact = await store.save("u", "contact", {
    name: "Accepted Person",
    email: "person@example.com",
    provenance: {
      name: {
        source: "Other",
        evidence: "Gmail participant; source gmail:abc",
      },
    },
  });
  await purgeGmailEvidence(store, "u");
  const retained = JSON.parse((await store.get("u", contact.id)).data);
  assert.equal(retained.name, "Accepted Person");
  assert.equal(
    retained.provenance.name.evidence,
    "Gmail participant; source evidence expired",
  );
  const events = await store.db
    .prepare("SELECT * FROM events WHERE user_id=?")
    .all("u");
  assert.ok(!JSON.stringify(events).includes("gmail:abc"));
  assert.ok(!JSON.stringify(events).includes("private mail"));
});

test("cancel followed by retry fences an earlier worker version", async (t) => {
  const store = await setup(t);
  const fetchImpl = async (url) => {
    if (url.endsWith("/profile")) return json({ historyId: "100" });
    if (url.includes("/messages?")) return json({ messages: [{ id: "abc" }] });
    const current = JSON.parse(
      (
        await store.db
          .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
          .get("u")
      ).state,
    );
    await store.db
      .prepare(
        "UPDATE gmail_sync SET state=?,version=version+2 WHERE user_id=?",
      )
      .run(
        JSON.stringify({ ...current, status: "queued", leaseUntil: 0 }),
        "u",
      );
    return json(message("Thank you for applying"));
  };
  await processGmailSync(store, {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl,
  });
  assert.equal((await store.list("u", "recruiting_evidence")).length, 0);
  const state = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  assert.equal(state.status, "queued");
  assert.equal(state.processed, 0);
});

test("provider unauthorized marks reconnect required without persisting provider details", async (t) => {
  const store = await setup(t);
  await processGmailSync(store, {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl: async () => json({ error: "secret provider response" }, 401),
  });
  const account = await store.db
    .prepare("SELECT * FROM gmail_accounts WHERE user_id=?")
    .get("u");
  assert.notEqual(account.status, "connected");
  assert.equal(account.credentials, "");
  const row = await store.db
    .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
    .get("u");
  assert.ok(!row.state.includes("secret provider response"));
  assert.equal(JSON.parse(row.state).status, "failed");
});

test("AI extraction failure retries without recording message as handled", async (t) => {
  const store = await setup(t);
  const fetchImpl = async (url) => {
    if (url.endsWith("/profile")) return json({ historyId: "100" });
    if (url.includes("/messages?")) return json({ messages: [{ id: "abc" }] });
    return json(message("Non-template recruiting wording"));
  };
  await processGmailSync(store, {
    enabled: true,
    accessToken: async () => "token",
    fetchImpl,
    aiExtract: async () => {
      const e = new Error("sanitized");
      e.code = "RECRUITING_AI_FAILED";
      throw e;
    },
  });
  const state = JSON.parse(
    (
      await store.db
        .prepare("SELECT state FROM gmail_sync WHERE user_id=?")
        .get("u")
    ).state,
  );
  assert.equal(state.status, "retry");
  assert.equal(state.aiStatus, "failed");
  assert.equal(
    (
      await store.db
        .prepare("SELECT * FROM gmail_seen WHERE user_id=?")
        .all("u")
    ).length,
    0,
  );
});
