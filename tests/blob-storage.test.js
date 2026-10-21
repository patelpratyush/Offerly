import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createBlobStorage } from "../server/blob-storage.js";

const key = "documents/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002";
const body = Buffer.from("private resume");
const metadata = { size: body.length, hash: createHash("sha256").update(body).digest("hex") };
const response = (bytes = body, overrides = {}) => ({ statusCode: 200, blob: { pathname: key, size: body.length }, stream: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }), ...overrides });
const safe503 = (error) => error.status === 503 && error.message === "Document storage unavailable. Please try again.";

test("private immutable uploads and uncached authenticated reads use only server keys", async () => {
  const calls = [];
  const sdk = {
    put: async (...args) => { calls.push(["put", ...args]); return { pathname: key, url: "never-return-this" }; },
    get: async (...args) => { calls.push(["get", ...args]); return response(); },
    del: async (...args) => { calls.push(["del", ...args]); },
  };
  const storage = createBlobStorage({ sdk, storeId: "store_example" });
  assert.equal(await storage.put(key, body), key);
  assert.deepEqual(await storage.read(key, metadata), body);
  await storage.delete(key);
  await storage.delete(key);
  const upload = calls[0][3];
  assert.equal(upload.access, "private");
  assert.equal(upload.allowOverwrite, false);
  assert.equal(upload.addRandomSuffix, false);
  assert.equal(upload.contentType, "application/octet-stream");
  assert.equal(upload.storeId, "store_example");
  assert.equal(calls[1][2].access, "private");
  assert.equal(calls[1][2].useCache, false);
  assert.ok(upload.abortSignal instanceof AbortSignal);
  assert.ok(calls.every((call) => call[1] === key));
});

test("invalid keys and oversized inputs fail before any SDK call", async () => {
  let calls = 0;
  const sdk = new Proxy({}, { get() { return () => { calls++; }; } });
  const storage = createBlobStorage({ sdk });
  for (const bad of ["https://evil.test/resume", "../resume", key + "/file.pdf", key.toUpperCase(), null]) {
    await assert.rejects(storage.put(bad, body), safe503);
    await assert.rejects(storage.read(bad, metadata), safe503);
    await assert.rejects(storage.delete(bad), safe503);
  }
  await assert.rejects(storage.put(key, Buffer.alloc(2097153)), safe503);
  await assert.rejects(storage.read(key, { ...metadata, size: 2097153 }), safe503);
  assert.equal(calls, 0);
});

test("read rejects altered content, truncated or oversized streams and wrong metadata", async () => {
  for (const result of [response(Buffer.from("wrong content!")), response(body.subarray(1)), response(Buffer.alloc(2097153)), response(body, { blob: { pathname: "other", size: body.length } }), response(body, { statusCode: 304 })]) {
    const storage = createBlobStorage({ sdk: { get: async () => result } });
    await assert.rejects(storage.read(key, metadata), safe503);
  }
});

test("missing objects return safe 404; provider details never escape", async () => {
  const missing = createBlobStorage({ sdk: { get: async () => null } });
  await assert.rejects(missing.read(key, metadata), (error) => error.status === 404 && error.message === "Document not found");
  const fail = async () => { throw new Error("SECRET TOKEN provider URL"); };
  const storage = createBlobStorage({ sdk: { put: fail, get: fail, del: fail } });
  await assert.rejects(storage.put(key, body), safe503);
  await assert.rejects(storage.read(key, metadata), safe503);
  await assert.rejects(storage.delete(key), safe503);
  await assert.rejects(createBlobStorage({ sdk: { put: async () => ({ pathname: key + "suffix" }) } }).put(key, body), safe503);
});
