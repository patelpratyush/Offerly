import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHostedHandler } from "../server/hosted.js";
import { createStore } from "../server/store.js";
import { openDatabase, postgresSQL } from "../server/database.js";

test("hosted setup failures are retryable and never expose connection secrets", async (t) => {
  const env = {
    DATABASE_URL: "postgresql://secret-password@invalid/db",
    APP_ORIGIN: "https://offerly.test",
  };
  let attempts = 0;
  const handler = createHostedHandler({
    env,
    storeFactory: async () => {
      attempts++;
      throw new Error(env.DATABASE_URL);
    },
  });
  const server = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => server.close());
  for (let i = 0; i < 2; i++) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/auth/config`,
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.doesNotMatch(await response.text(), /secret-password|postgresql/);
  }
  assert.equal(attempts, 2);
});

test("hosted job execution requires exact secret, method, host and HTTPS", async (t) => {
  const store = await createStore(":memory:");
  const secret = "s".repeat(40);
  let initializations = 0;
  const handler = createHostedHandler({
    env: {
      DATABASE_URL: "postgresql://localhost/test",
      APP_ORIGIN: "https://offerly.test",
      CRON_SECRET: secret,
    },
    storeFactory: async () => {
      initializations++;
      return store;
    },
  });
  const server = http.createServer(handler).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const call = (headers = {}, method = "GET") =>
    new Promise((resolve, reject) => {
      const request = http.request(
        {
          hostname: "127.0.0.1",
          port: server.address().port,
          path: "/api/jobs/run",
          method,
          headers: {
            host: "offerly.test",
            "x-forwarded-proto": "https",
            ...headers,
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk;
          });
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              json: async () => JSON.parse(body),
            }),
          );
        },
      );
      request.on("error", reject);
      request.end();
    });
  assert.equal((await call()).status, 401);
  assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
  assert.equal(
    (await call({ authorization: `Bearer ${secret}` }, "POST")).status,
    401,
  );
  assert.equal(
    (await call({ authorization: `Bearer ${secret}`, host: "other.test" }))
      .status,
    400,
  );
  assert.equal(
    initializations,
    0,
    "rejected cron requests must not initialize database",
  );
  const result = await call({ authorization: `Bearer ${secret}` });
  assert.equal(result.status, 200);
  assert.equal((await result.json()).reminders.processed, 0);
});

test("SQL translation keeps placeholders inside strings and rejects URL TLS overrides", () => {
  assert.equal(
    postgresSQL("SELECT '?' AS literal, ? AS value"),
    "SELECT '?' AS literal, $1 AS value",
  );
  assert.throws(
    () => openDatabase("postgresql://example.com/test?sslmode=no-verify"),
    /TLS/,
  );
  assert.throws(
    () => openDatabase(":memory:", { schema: "unsafe;sql" }),
    /schema/,
  );
});
