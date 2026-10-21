import { test } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { createStore } from "./helpers/store.js";
import { HttpError, digest } from "../server/security.js";
import { processFileCleanup, reserveFileObject } from "../server/file-lifecycle.js";

const password = "hosted-files-password-12345";
const invitation = "hosted-files-invitation-at-least-32-characters";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
const upload = { name: "resume.pdf", body: pdf.toString("base64") };

async function setup(t, overrides = {}) {
  const store = await createStore(":memory:");
  const objects = new Map();
  const calls = { put: [], read: [], delete: [], scan: [] };
  const storage = {
    async put(key, bytes) { calls.put.push(key); objects.set(key, Buffer.from(bytes)); },
    async read(key, metadata) {
      calls.read.push({ key, metadata });
      if (!objects.has(key)) throw new HttpError(404, "Document not found");
      return objects.get(key);
    },
    async delete(key) { calls.delete.push(key); objects.delete(key); },
    ...overrides.storage,
  };
  const app = await createApp(store, {
    production: true, origin: "https://offerly.test", trustProxy: true,
    vercel: true, registrationToken: invitation, fileStorage: storage,
    scanDocument: async (bytes) => { calls.scan.push(bytes); await overrides.scan?.(bytes, store); },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await store.db.close(); });
  async function request(path, method = "GET", body, cookie) {
    const bytes = body === undefined ? undefined : JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: {
          Host: "offerly.test", Origin: "https://offerly.test", "X-Forwarded-Proto": "https",
          "X-Offerly-Request": "1", "Content-Type": "application/json",
          ...(bytes ? { "Content-Length": Buffer.byteLength(bytes) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks);
          let data;
          try { data = JSON.parse(raw.toString()); } catch { data = raw; }
          resolve({ status: response.statusCode, data, raw, headers: response.headers, cookie: response.headers["set-cookie"]?.[0].split(";")[0] });
        });
      });
      outgoing.on("error", reject);
      outgoing.end(bytes);
    });
  }
  async function register(email = "hosted@example.test") {
    const response = await request("/auth/register", "POST", { email, password, invitation });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    return response.cookie;
  }
  return { store, objects, calls, storage, request, register };
}

test("hosted documents use private storage; downloads require ownership and exports hide object keys", async (t) => {
  const { store, objects, calls, request, register } = await setup(t);
  const owner = await register();
  const other = await register("other@example.test");
  const result = await request("/files", "POST", upload, owner);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const file = await store.db.prepare("SELECT * FROM files WHERE id=?").get(result.data.id);
  assert.equal(Buffer.from(file.body).length, 0);
  assert.equal(Number(file.byte_size), pdf.length);
  assert.equal(file.hash, digest(pdf));
  assert.ok(file.scanned_at);
  assert.equal(file.storage_key, `documents/${file.user_id}/${file.id}`);
  assert.deepEqual(objects.get(file.storage_key), pdf);
  assert.equal((await request(`/files/${file.id}`)).status, 401);
  assert.equal((await request(`/files/${file.id}`, "GET", undefined, other)).status, 404);
  assert.equal(calls.read.length, 0);
  const downloaded = await request(`/files/${file.id}`, "GET", undefined, owner);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(downloaded.raw, pdf);
  assert.match(downloaded.headers["content-disposition"], /^attachment/);
  assert.match(downloaded.headers["content-security-policy"], /sandbox/);
  assert.deepEqual(calls.read[0].metadata, { size: pdf.length, hash: digest(pdf) });
  const exported = await request("/export.json", "GET", undefined, owner);
  assert.equal(exported.status, 200);
  assert.ok(exported.data.files.some((entry) => entry.id === file.id));
  assert.ok(!exported.raw.includes(Buffer.from(file.storage_key)));
  assert.ok(!exported.raw.includes(Buffer.from(pdf.toString("base64"))));
});

test("infection and scanner outage reject uploads before storage writes and release reservations", async (t) => {
  for (const status of [400, 503]) {
    await t.test(String(status), async (t) => {
      const { store, calls, request, register } = await setup(t, { scan: async () => { throw new HttpError(status, status === 400 ? "Document failed malware screening" : "Document screening unavailable"); } });
      const cookie = await register();
      assert.equal((await request("/files", "POST", upload, cookie)).status, status);
      assert.equal(calls.put.length, 0);
      assert.equal((await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n, 0);
      assert.equal((await store.db.prepare("SELECT count(*) n FROM files").get()).n, 0);
    });
  }
});

test("hosted size limit and durable pending reservations enforce quota before scanning or writes", async (t) => {
  const { store, calls, request, register } = await setup(t);
  const cookie = await register();
  const oversized = Buffer.concat([pdf, Buffer.alloc(2 * 1024 * 1024)]);
  assert.equal((await request("/files", "POST", { ...upload, body: oversized.toString("base64") }, cookie)).status, 413);
  const user = await store.db.prepare("SELECT id FROM users WHERE email=?").get("hosted@example.test");
  for (let index = 0; index < 5; index++) {
    const fileId = randomUUID();
    await reserveFileObject(store, { key: `documents/${user.id}/${fileId}`, userId: user.id, fileId, size: 20 * 1024 * 1024 });
  }
  assert.equal((await request("/files", "POST", upload, cookie)).status, 413);
  assert.equal(calls.scan.length, 0);
  assert.equal(calls.put.length, 0);
});

test("session revoked during scan cannot attach a document and compensates uploaded object", async (t) => {
  const { store, objects, calls, request, register } = await setup(t, {
    scan: async (_, store) => { await store.db.prepare("DELETE FROM sessions").run(); },
  });
  const cookie = await register();
  assert.equal((await request("/files", "POST", upload, cookie)).status, 401);
  assert.equal(calls.put.length, 1);
  assert.deepEqual(calls.delete, calls.put);
  assert.equal(objects.size, 0);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM files").get()).n, 0);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n, 0);
});

test("ambiguous storage failure keeps durable orphan cleanup until grace period", async (t) => {
  const { store, calls, storage, request, register } = await setup(t, { storage: { put: async () => { throw new Error("private-provider-secret"); } } });
  const cookie = await register();
  const result = await request("/files", "POST", upload, cookie);
  assert.equal(result.status, 500);
  assert.ok(!result.raw.includes(Buffer.from("private-provider-secret")));
  const pending = await store.db.prepare("SELECT * FROM file_objects").get();
  assert.equal(pending.state, "pending");
  assert.equal((await processFileCleanup(store, storage)).processed, 0);
  assert.equal(calls.delete.length, 0);
  assert.equal((await processFileCleanup(store, storage, { now: Number(pending.expires_at) + 1 })).deleted, 1);
  assert.deepEqual(calls.delete, [pending.storage_key]);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n, 0);
});

test("metadata failure after confirmed upload queues retry when compensating delete fails", async (t) => {
  const fixture = await setup(t, { storage: { delete: async () => { throw new Error("storage down"); } } });
  const { store, objects, request, register } = fixture;
  const cookie = await register();
  const prepare = store.db.prepare.bind(store.db);
  store.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO files(")) return { run: async () => { throw new Error("private database detail"); } };
    return prepare(sql);
  };
  const result = await request("/files", "POST", upload, cookie);
  store.db.prepare = prepare;
  assert.equal(result.status, 500);
  assert.ok(!result.raw.includes(Buffer.from("private database detail")));
  assert.equal(objects.size, 1);
  const pending = await prepare("SELECT * FROM file_objects").get();
  assert.equal(pending.state, "deleting");
  assert.equal((await processFileCleanup(store, { delete: async (key) => objects.delete(key) })).deleted, 1);
  assert.equal(objects.size, 0);
  assert.equal((await prepare("SELECT count(*) n FROM files").get()).n, 0);
});

test("account deletion preserves durable object cleanup and retries provider failure", async (t) => {
  const { store, objects, storage, request, register } = await setup(t);
  const cookie = await register();
  assert.equal((await request("/files", "POST", upload, cookie)).status, 200);
  assert.equal((await request("/account", "DELETE", { confirm: "hosted@example.test", password }, cookie)).status, 200);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM users").get()).n, 0);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM files").get()).n, 0);
  assert.equal((await store.db.prepare("SELECT * FROM file_objects").get()).state, "deleting");
  const failed = await processFileCleanup(store, { delete: async () => { throw new Error("provider unavailable"); } });
  assert.equal(failed.failed, 1);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n, 1);
  const retry = await store.db.prepare("SELECT expires_at FROM file_objects").get();
  assert.equal((await processFileCleanup(store, storage, { now: Number(retry.expires_at) + 1 })).deleted, 1);
  assert.equal(objects.size, 0);
  assert.equal((await store.db.prepare("SELECT count(*) n FROM file_objects").get()).n, 0);
});

test("lost commit acknowledgement never deletes an object already attached to a committed file", async (t) => {
  const { store, objects, calls, request, register } = await setup(t);
  const cookie = await register();
  const prepare = store.db.prepare.bind(store.db);
  const atomic = store.atomic.bind(store);
  let attached = false;
  store.db.prepare = (sql) => {
    if (sql.startsWith("INSERT INTO files(")) attached = true;
    return prepare(sql);
  };
  store.atomic = async (operation) => {
    const result = await atomic(operation);
    if (attached) { attached = false; throw new Error("Commit acknowledgement lost"); }
    return result;
  };
  const result = await request("/files", "POST", upload, cookie);
  store.db.prepare = prepare;
  store.atomic = atomic;
  assert.equal(result.status, 500);
  const file = await prepare("SELECT * FROM files").get();
  assert.ok(file?.storage_key);
  assert.equal((await prepare("SELECT * FROM file_objects").get()).state, "attached");
  assert.deepEqual(objects.get(file.storage_key), pdf);
  assert.equal(calls.delete.length, 0);
});
