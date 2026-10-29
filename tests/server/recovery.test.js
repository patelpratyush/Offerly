import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
import { digest } from "../../server/security.js";
const password = "recovery-original-password-123";
const newPassword = "recovery-replacement-password-456";
async function setup(t) {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await store.db.close();
  });
  async function request(path, body, cookie, method = "POST") {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Offerly-Request": "1",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      },
    );
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }
  const email = "recovery@example.test";
  const registered = await request("/auth/register", { email, password });
  assert.equal(registered.status, 200);
  return { store, request, email, cookie: registered.cookie };
}
test("recovery codes are hashed, owner-bound, single use and revoke all sessions and codes", async (t) => {
  const { store, request, email, cookie } = await setup(t);
  const generated = await request(
    "/account/recovery-codes",
    { password },
    cookie,
  );
  assert.equal(generated.status, 200);
  assert.equal(new Set(generated.data.codes).size, 10);
  const code = generated.data.codes[0];
  assert.match(code, /^(?:[a-f0-9]{4}-){7}[a-f0-9]{4}$/);
  const rows = await store.db
    .prepare("SELECT code_hash FROM recovery_codes")
    .all();
  assert.equal(rows.length, 10);
  assert.ok(
    rows.some((row) => row.code_hash === digest(code.replaceAll("-", ""))),
  );
  assert.ok(rows.every((row) => !generated.data.codes.includes(row.code_hash)));
  const invalid = await request("/auth/recover", {
    email: "other@example.test",
    code,
    newPassword,
  });
  assert.equal(invalid.status, 400);
  assert.equal(
    (await request("/auth/recover", { email, code, newPassword })).status,
    200,
  );
  assert.equal(
    (await request("/workspace", undefined, cookie, "GET")).status,
    401,
  );
  assert.equal(
    (
      await request("/auth/recover", {
        email,
        code: generated.data.codes[1],
        newPassword,
      })
    ).status,
    400,
  );
  assert.equal((await request("/auth/login", { email, password })).status, 401);
  assert.equal(
    (await request("/auth/login", { email, password: newPassword })).status,
    200,
  );
  assert.equal(
    Number(
      (await store.db.prepare("SELECT count(*) AS n FROM recovery_codes").get())
        .n,
    ),
    0,
  );
});
test("generation requires password; rotation and normal password changes invalidate prior codes", async (t) => {
  const { request, email, cookie } = await setup(t);
  assert.equal(
    (await request("/account/recovery-codes", { password: "wrong" }, cookie))
      .status,
    401,
  );
  const first = await request("/account/recovery-codes", { password }, cookie);
  const second = await request("/account/recovery-codes", { password }, cookie);
  assert.equal(second.status, 200);
  assert.equal(
    (
      await request("/auth/recover", {
        email,
        code: first.data.codes[0],
        newPassword,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/account/password",
        { currentPassword: password, newPassword },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await request("/auth/recover", {
        email,
        code: second.data.codes[0],
        newPassword,
      })
    ).status,
    400,
  );
});
test("concurrent recovery can commit only once", async (t) => {
  const { request, email, cookie } = await setup(t);
  const generated = await request(
    "/account/recovery-codes",
    { password },
    cookie,
  );
  const responses = await Promise.all(
    [0, 1].map(() =>
      request("/auth/recover", {
        email,
        code: generated.data.codes[0],
        newPassword,
      }),
    ),
  );
  assert.equal(
    responses.filter((response) => response.status === 200).length,
    1,
  );
  assert.ok(
    responses.every((response) => [200, 400, 409].includes(response.status)),
  );
  assert.equal(
    (
      await request("/auth/recover", {
        email,
        code: generated.data.codes[0],
        newPassword,
      })
    ).status,
    400,
  );
});
test("persistent recovery throttles reject the sixth sequential guess", async (t) => {
  const { request, email } = await setup(t);
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await request("/auth/recover", { email, code: "wrong", newPassword }))
        .status,
      400,
    );
  assert.equal(
    (await request("/auth/recover", { email, code: "wrong", newPassword }))
      .status,
    429,
  );
});
