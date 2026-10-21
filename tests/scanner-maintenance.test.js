import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { createStore } from "./helpers/store.js";
import { createScannerMaintenanceHandler } from "../server/scanner-maintenance.js";

const path = "/api/jobs/scanner";
const secret = "scanner-maintenance-test-secret-at-least-32-chars";
const env = { DATABASE_URL: "postgresql://unused.invalid/test", APP_ORIGIN: "https://offerly.test", CRON_SECRET: secret };
const sign = (at, endpoint = path) => ({
  "x-offerly-scheduler-at": String(at),
  "x-offerly-scheduler-signature": createHmac("sha256", secret).update(`${at}:${endpoint}`).digest("hex"),
});

async function setup(t, overrides = {}) {
  const store = await createStore(":memory:");
  const calls = { initialized: 0, refreshed: [], retired: [] };
  const handler = createScannerMaintenanceHandler({
    env,
    storeFactory: async () => { calls.initialized++; return store; },
    refresh: async (input) => {
      calls.refreshed.push(input);
      return overrides.refresh ? overrides.refresh(input) : { snapshotId: "snap_new", definitionsAt: Date.now(), engineVersion: "1.4.3" };
    },
    retire: async (id, options) => {
      calls.retired.push({ id, options });
      return overrides.retire ? overrides.retire(id, options) : true;
    },
  });
  const server = createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await store.db.close(); });
  async function request({ at = Date.now(), headers = sign(at), endpoint = path, method = "GET" } = {}) {
    return new Promise((resolve, reject) => {
      const outgoing = httpRequest(`http://127.0.0.1:${server.address().port}${endpoint}`, {
        method, headers: { Host: "offerly.test", "x-forwarded-proto": "https", ...headers },
      }, (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          resolve({ status: response.statusCode, data: raw ? JSON.parse(raw) : undefined, raw, headers: response.headers });
        });
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }
  return { store, calls, request };
}

async function seed(store, extra = {}) {
  const state = { snapshot_id: "snap_old", definitions_at: Date.now() - 3600000, engine_version: "1.4.2", updated_at: 0, lease_until: 0, ...extra };
  const fields = Object.keys(state);
  await store.db.prepare(`UPDATE scanner_state SET ${fields.map((field) => `${field}=?`).join(",")} WHERE id=1`).run(...Object.values(state));
}

test("scanner maintenance authenticates endpoint-bound fresh signatures before database initialization", async (t) => {
  const { calls, request } = await setup(t);
  assert.equal((await request({ headers: {} })).status, 401);
  assert.equal((await request({ headers: sign(Date.now(), "/api/jobs/run") })).status, 401);
  assert.equal((await request({ headers: sign(Date.now() - 61000) })).status, 401);
  assert.equal((await request({ headers: sign(Date.now() + 6000) })).status, 401);
  assert.equal((await request({ method: "POST" })).status, 401);
  assert.equal((await request({ endpoint: "/api/jobs/other" })).status, 404);
  assert.equal((await request({ headers: { ...sign(Date.now()), Host: "evil.test" } })).status, 400);
  assert.equal(calls.initialized, 0);
  assert.equal(calls.refreshed.length, 0);
});

test("fresh snapshots and unexpired maintenance leases skip expensive refresh", async (t) => {
  const { store, calls, request } = await setup(t);
  await seed(store, { updated_at: Date.now() });
  assert.deepEqual((await request()).data, { skipped: true });
  await seed(store, { lease_until: Date.now() + 300000 });
  assert.deepEqual((await request()).data, { skipped: true });
  assert.equal(calls.refreshed.length, 0);
  assert.equal((await store.db.prepare("SELECT snapshot_id FROM scanner_state").get()).snapshot_id, "snap_old");
});

test("expired leases recover, concurrent invocation skips, committed refresh retains grace and blocks replay", async (t) => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  let entered;
  const started = new Promise((resolve) => { entered = resolve; });
  const { store, calls, request } = await setup(t, { refresh: async () => {
    entered(); await wait;
    return { snapshotId: "snap_new", definitionsAt: Date.now(), engineVersion: "1.4.3" };
  } });
  await seed(store, { lease_until: Date.now() - 1 });
  const at = Date.now();
  const first = request({ at });
  await started;
  const overlap = await request({ at: at + 1 });
  assert.deepEqual(overlap.data, { skipped: true });
  release();
  assert.deepEqual((await first).data, { refreshed: true });
  const state = await store.db.prepare("SELECT * FROM scanner_state").get();
  assert.equal(state.snapshot_id, "snap_new");
  assert.equal(state.previous_snapshot_id, "snap_old");
  assert.equal(state.engine_version, "1.4.3");
  assert.ok(Number(state.definitions_at) > 0);
  assert.ok(Number(state.retire_after) > Date.now() + 110000);
  assert.equal(Number(state.lease_until), 0);
  await store.db.prepare("UPDATE scanner_state SET updated_at=0 WHERE id=1").run();
  assert.deepEqual((await request({ at })).data, { skipped: true });
  assert.equal(calls.refreshed.length, 1);
});

test("refresh failure preserves working snapshot and releases lease without exposing provider secrets", async (t) => {
  const { store, calls, request } = await setup(t, { refresh: async () => { throw new Error("provider-token-secret"); } });
  await seed(store);
  const result = await request();
  assert.equal(result.status, 503);
  assert.deepEqual(result.data, { error: "Scanner maintenance unavailable" });
  assert.ok(!result.raw.includes("provider-token-secret"));
  assert.equal(result.headers["cache-control"], "no-store");
  const state = await store.db.prepare("SELECT * FROM scanner_state").get();
  assert.equal(state.snapshot_id, "snap_old");
  assert.equal(state.engine_version, "1.4.2");
  assert.equal(Number(state.lease_until), 0);
  assert.equal(calls.refreshed.length, 1);
});

test("snapshot retirement waits for grace and passes active snapshot guard; failure stays durable", async (t) => {
  let canRetire = false;
  const { store, calls, request } = await setup(t, { retire: async () => canRetire });
  await seed(store, { updated_at: Date.now(), previous_snapshot_id: "snap_previous", retire_after: Date.now() + 120000 });
  await request();
  assert.equal(calls.retired.length, 0);
  await store.db.prepare("UPDATE scanner_state SET retire_after=0 WHERE id=1").run();
  assert.equal((await request()).status, 503);
  assert.equal(calls.retired.length, 1);
  assert.deepEqual(calls.retired[0], { id: "snap_previous", options: { activeSnapshotId: "snap_old" } });
  assert.equal((await store.db.prepare("SELECT previous_snapshot_id FROM scanner_state").get()).previous_snapshot_id, "snap_previous");
  await store.db.prepare("UPDATE scanner_state SET updated_at=0 WHERE id=1").run();
  assert.equal((await request()).status, 503);
  assert.equal(calls.refreshed.length, 0);
  assert.equal((await store.db.prepare("SELECT previous_snapshot_id FROM scanner_state").get()).previous_snapshot_id, "snap_previous");
  await store.db.prepare("UPDATE scanner_state SET updated_at=? WHERE id=1").run(Date.now());
  canRetire = true;
  await request();
  assert.equal((await store.db.prepare("SELECT previous_snapshot_id FROM scanner_state").get()).previous_snapshot_id, "");
  assert.equal(calls.refreshed.length, 0);
});

test("active refresh lease prevents retirement even after previous snapshot grace expires", async (t) => {
  const { store, calls, request } = await setup(t);
  await seed(store, { previous_snapshot_id: "snap_previous", retire_after: 0, lease_until: Date.now() + 300000 });
  assert.deepEqual((await request()).data, { skipped: true });
  assert.equal(calls.retired.length, 0);
  assert.equal((await store.db.prepare("SELECT previous_snapshot_id FROM scanner_state").get()).previous_snapshot_id, "snap_previous");
});
