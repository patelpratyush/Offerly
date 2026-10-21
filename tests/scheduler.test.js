import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "./helpers/store.js";
import { runScheduler } from "../server/scheduler.js";
import { processReminders } from "../server/reminders.js";
import { processRecruitingJobs } from "../server/recruiting.js";

test("scheduler lease blocks overlap and persists both queue cursors", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const first = runScheduler(store, {
    recruiting: async (s, { cursor }) => {
      assert.equal(cursor, "");
      entered();
      await gate;
      return { processed: 20, nextCursor: "review-cursor" };
    },
    reminders: async () => ({
      processed: 500,
      changed: 1,
      failed: 0,
      nextCursor: "reminder-cursor",
    }),
  });
  await started;
  assert.deepEqual(await runScheduler(store), {
    skipped: true,
    reason: "already_running_or_replayed",
  });
  release();
  await first;
  const state = await store.db
    .prepare("SELECT * FROM scheduler_state WHERE id=1")
    .get();
  assert.equal(state.status, "completed");
  assert.equal(state.lease_until, 0);
  await runScheduler(store, {
    recruiting: async (s, { cursor }) => {
      assert.equal(cursor, "review-cursor");
      return { processed: 0, nextCursor: "" };
    },
    reminders: async (s, { cursor }) => {
      assert.equal(cursor, "reminder-cursor");
      return { processed: 0, nextCursor: "" };
    },
  });
});

test("signed scheduler requests cannot replay or move backwards", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const at = Date.now();
  assert.equal(
    (await runScheduler(store, { signedAt: at })).reminders.processed,
    0,
  );
  assert.equal((await runScheduler(store, { signedAt: at })).skipped, true);
  assert.equal((await runScheduler(store, { signedAt: at - 1 })).skipped, true);
  assert.equal(
    (await runScheduler(store, { signedAt: at + 1 })).reminders.processed,
    0,
  );
});

test("expired leases recover; failed runs release lease without storing errors", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await store.db
    .prepare(
      "UPDATE scheduler_state SET lease_owner='dead',lease_until=1 WHERE id=1",
    )
    .run();
  await assert.rejects(
    runScheduler(store, {
      recruiting: async () => {
        throw new Error("sensitive database URL");
      },
    }),
    /sensitive/,
  );
  const state = await store.db
    .prepare("SELECT * FROM scheduler_state WHERE id=1")
    .get();
  assert.equal(state.status, "failed");
  assert.equal(state.lease_until, 0);
  assert.doesNotMatch(JSON.stringify(state), /sensitive/);
  assert.equal((await runScheduler(store)).reminders.processed, 0);
});

test("expired processing budgets preserve cursors and report actual visits", async (t) => {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  await store.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run(
      "scheduler-user",
      "scheduler@example.test",
      "unused",
      "Test",
      "UTC",
      "[]",
    );
  await store.db
    .prepare("INSERT INTO records VALUES(?,?,?,?,?)")
    .run(
      "z-reminder",
      "scheduler-user",
      "reminder",
      JSON.stringify({ state: "scheduled" }),
      1,
    );
  await store.db
    .prepare("INSERT INTO records VALUES(?,?,?,?,?)")
    .run(
      "z-job",
      "scheduler-user",
      "recruiting_job",
      JSON.stringify({ status: "queued", availableAt: 0 }),
      1,
    );
  const options = { deadline: 0, cursor: "a" };
  assert.deepEqual(await processReminders(store, options), {
    processed: 0,
    changed: 0,
    failed: 0,
    nextCursor: "a",
  });
  assert.deepEqual(await processRecruitingJobs(store, options), {
    processed: 0,
    nextCursor: "a",
  });
});
