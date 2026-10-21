import { request as httpRequest } from "node:http";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { scryptSync, randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { createStore } from "../server/store.js";
import { securityConfig, digest } from "../server/security.js";
import { validateDocument, scanWithClamav } from "../server/files.js";
const password = "test-security-password-123";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF");
async function setup(t, options = {}) {
  const store = await createStore(":memory:");
  const app = await createApp(store, options);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.db.close();
  });
  const request = async (path, method = "GET", body, cookie, headers = {}) => {
    const result = await new Promise((resolve, reject) => {
      const outgoing = httpRequest(
        `http://127.0.0.1:${server.address().port}/api${path}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(!["GET", "HEAD"].includes(method)
              ? {
                  "Content-Length": Buffer.byteLength(
                    typeof body === "string"
                      ? body
                      : JSON.stringify(body ?? {}),
                  ),
                }
              : {}),
            "X-Offerly-Request": "1",
            ...(options.production
              ? {
                  Host: "offerly.example",
                  "X-Forwarded-Proto": "https",
                  Origin: "https://offerly.example",
                }
              : {}),
            ...(cookie ? { Cookie: cookie } : {}),
            ...headers,
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (c) => chunks.push(c));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              raw: Buffer.concat(chunks).toString(),
              headers: new Headers(
                Object.entries(response.headers).flatMap(([k, v]) =>
                  Array.isArray(v)
                    ? v.map((value) => [k, value])
                    : v === undefined
                      ? []
                      : [[k, v]],
                ),
              ),
            }),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end(
        ["GET", "HEAD"].includes(method)
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body ?? {}),
      );
    });
    const res = result;
    const raw = res.raw;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return {
      status: res.status,
      data,
      headers: res.headers,
      cookie: res.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const register = async (email = "security@example.com") => {
    const r = await request("/auth/register", "POST", {
      email,
      password,
      invitation: options.registrationToken,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.cookie;
  };
  return { store, request, register };
}
test("rejects cross-site, wrong-origin, wrong-host, missing custom headers and simple form requests", async (t) => {
  const { request, register } = await setup(t);
  const c = await register();
  for (const headers of [
    { "X-Offerly-Request": "" },
    { Origin: "https://evil.example" },
    { Origin: "null" },
    { Origin: "http://[malformed" },
    { "Sec-Fetch-Site": "cross-site" },
  ])
    assert.equal(
      (await request("/logout", "POST", {}, c, headers)).status,
      403,
    );
  assert.equal(
    (
      await request("/logout", "POST", "x=1", c, {
        "Content-Type": "text/plain",
      })
    ).status,
    415,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, c, { Host: "evil.example" }))
      .status,
    421,
  );
  assert.equal(
    (
      await request("/workspace", "GET", undefined, c, {
        "Sec-Fetch-Site": "cross-site",
      })
    ).status,
    403,
  );
  assert.equal((await request("/workspace", "GET", undefined, c)).status, 200);
});
test("auth cookies, idle timeout, absolute expiry, logout and password changes revoke access", async (t) => {
  const { request, register, store } = await setup(t);
  let c = await register();
  const login = await request("/auth/login", "POST", {
    email: "security@example.com",
    password,
  });
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
  const c2 = login.cookie;
  assert.equal(
    (
      await request(
        "/account/password",
        "POST",
        { currentPassword: "wrong", newPassword: "replacement-password-123" },
        c,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/account/password",
        "POST",
        { currentPassword: password, newPassword: "replacement-password-123" },
        c,
      )
    ).status,
    200,
  );
  for (const session of [c, c2])
    assert.equal(
      (await request("/workspace", "GET", undefined, session)).status,
      401,
    );
  assert.equal(
    (
      await request("/auth/login", "POST", {
        email: "security@example.com",
        password,
      })
    ).status,
    401,
  );
  c = (
    await request("/auth/login", "POST", {
      email: "security@example.com",
      password: "replacement-password-123",
    })
  ).cookie;
  await store.db
    .prepare("UPDATE sessions SET last_seen=?")
    .run(Date.now() - 1800001);
  assert.equal((await request("/workspace", "GET", undefined, c)).status, 401);
  c = (
    await request("/auth/login", "POST", {
      email: "security@example.com",
      password: "replacement-password-123",
    })
  ).cookie;
  await store.db.prepare("UPDATE sessions SET expires=?").run(Date.now() - 1);
  assert.equal((await request("/workspace", "GET", undefined, c)).status, 401);
  c = (
    await request("/auth/login", "POST", {
      email: "security@example.com",
      password: "replacement-password-123",
    })
  ).cookie;
  await request("/logout", "POST", {}, c);
  assert.equal((await request("/workspace", "GET", undefined, c)).status, 401);
});
test("account deletion needs current password and invalidates all private access", async (t) => {
  const { request, register, store } = await setup(t);
  const c = await register();
  assert.equal(
    (
      await request(
        "/account",
        "DELETE",
        { confirm: "security@example.com" },
        c,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/account",
        "DELETE",
        { confirm: "security@example.com", password: "incorrect" },
        c,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await request(
        "/account",
        "DELETE",
        { confirm: "security@example.com", password },
        c,
      )
    ).status,
    200,
  );
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM users").get()).n,
    0,
  );
  assert.equal((await request("/workspace", "GET", undefined, c)).status, 401);
});
test("persistent account/IP throttling cannot be bypassed with forwarded headers", async (t) => {
  const { request, register, store } = await setup(t);
  await register();
  // Prefill the exact persisted bucket to exercise rejection without expensive repeated hashing.
  const key = digest("auth-email:security@example.com");
  await store.db
    .prepare("UPDATE rate_limits SET count=10 WHERE key=?")
    .run(key);
  assert.equal(
    (
      await request(
        "/auth/login",
        "POST",
        { email: "security@example.com", password },
        undefined,
        { "X-Forwarded-For": "203.0.113.2" },
      )
    ).status,
    429,
  );
  const server = await createApp(store);
  assert.ok(server); // Reconstructing the app retains DB-backed rate limits.
  assert.equal(
    (
      await store.db
        .prepare("SELECT count FROM rate_limits WHERE key=?")
        .get(key)
    ).count,
    10,
  );
});
test("production refuses missing HTTPS config, requires invitations, enforces secure host and transport", async (t) => {
  assert.throws(
    () => securityConfig({ production: true, origin: undefined }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      securityConfig({ production: true, origin: "http://offerly.example" }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      securityConfig({
        production: true,
        origin: "https://offerly.example",
        registrationToken: "short",
      }),
    /32/,
  );
  const { request, register } = await setup(t, {
    production: true,
    origin: "https://offerly.example",
    trustProxy: true,
    registrationToken: "test-only-invitation-code-at-least-32-chars",
  });
  assert.equal(
    (
      await request("/auth/register", "POST", {
        email: "security@example.com",
        password,
      })
    ).status,
    403,
  );
  const c = await register();
  assert.match(c, /^__Host-offerly=/);
  const r = await request("/auth/login", "POST", {
    email: "security@example.com",
    password,
  });
  assert.match(r.headers.get("set-cookie"), /Secure/);
  assert.match(r.headers.get("strict-transport-security"), /max-age=/);
  assert.equal(
    (
      await request("/workspace", "GET", undefined, c, {
        "X-Forwarded-Proto": "http",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/workspace", "GET", undefined, c, {
        Host: "other.example",
      })
    ).status,
    421,
  );
  assert.equal(
    (
      await request(
        "/files",
        "POST",
        { name: "resume.pdf", body: pdf.toString("base64") },
        c,
      )
    ).status,
    503,
  );
});
test("file signatures, canonical encoding, ownership, version lineage and quotas enforced", async (t) => {
  const { request, register, store } = await setup(t);
  const c = await register(),
    other = await register("other@example.com");
  for (const f of [
    { name: "fake.docx", body: Buffer.from("PKnot-a-docx").toString("base64") },
    {
      name: "fake.pdf",
      body: Buffer.from("<html>fake</html>").toString("base64"),
    },
    { name: "../resume.pdf", body: pdf.toString("base64") },
    { name: "resume.pdf", body: "%%%%" },
  ])
    assert.equal((await request("/files", "POST", f, c)).status, 400);
  const f = await request(
    "/files",
    "POST",
    { name: "resume.pdf", body: pdf.toString("base64") },
    c,
  );
  assert.equal(f.status, 200);
  assert.equal(
    (await request("/files/" + f.data.id, "GET", undefined, other)).status,
    404,
  );
  const d = (
    await request(
      "/records/document",
      "POST",
      { title: "v1", fileId: f.data.id },
      c,
    )
  ).data;
  const of = (
    await request(
      "/files",
      "POST",
      { name: "other.pdf", body: pdf.toString("base64") },
      other,
    )
  ).data;
  assert.equal(
    (
      await request(
        "/records/document",
        "POST",
        { title: "v2", fileId: of.id, documentId: d.id },
        other,
      )
    ).status,
    400,
  );
  const file = await request("/files/" + f.data.id, "GET", undefined, c);
  assert.equal(file.headers.get("content-type"), "application/octet-stream");
  assert.match(file.headers.get("content-security-policy"), /sandbox/);
  assert.match(file.headers.get("content-disposition"), /^attachment/);
  const owner = (
    await store.db
      .prepare("SELECT id FROM users WHERE email=?")
      .get("other@example.com")
  ).id;
  for (let i = 0; i < 99; i++)
    await store.db
      .prepare(
        "INSERT INTO files(id,user_id,name,mime,hash,body,created_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        randomUUID(),
        owner,
        "test.pdf",
        "application/pdf",
        "test",
        pdf,
        new Date().toISOString(),
      );
  assert.equal(
    (
      await request(
        "/files",
        "POST",
        { name: "quota.pdf", body: pdf.toString("base64") },
        other,
      )
    ).status,
    413,
  );
});
test("unscanned legacy files stay blocked in production, including full exports", async (t) => {
  const { request, register, store } = await setup(t, {
    production: true,
    origin: "https://offerly.example",
    trustProxy: true,
    registrationToken: "test-only-invitation-code-at-least-32-chars",
    scannerSocket: "/test-only",
    scanDocument: async () => {},
  });
  const c = await register();
  const file = (
    await request(
      "/files",
      "POST",
      { name: "resume.pdf", body: pdf.toString("base64") },
      c,
    )
  ).data;
  assert.ok(file.id);
  assert.equal(
    (await request("/files/" + file.id, "GET", undefined, c)).status,
    200,
  );
  await store.db
    .prepare("UPDATE files SET scanned_at=NULL WHERE id=?")
    .run(file.id);
  assert.equal(
    (await request("/files/" + file.id, "GET", undefined, c)).status,
    403,
  );
  const exported = await request("/export.json", "GET", undefined, c);
  assert.equal(exported.status, 200);
  assert.equal(exported.data.files[0].body, null);
  assert.match(exported.data.files[0].omitted, /screening/);
});
test("malformed inputs and internal database errors do not leak internals; large bodies require authentication", async (t) => {
  const { request, register, store } = await setup(t);
  const c = await register();
  assert.equal(
    (await request("/records/application", "POST", "{broken", c)).status,
    400,
  );
  assert.equal(
    (await request("/records/constructor", "POST", {}, c)).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/records/application",
        "POST",
        { company: "x".repeat(300000) },
        c,
      )
    ).status,
    413,
  );
  assert.equal(
    (await request("/files", "POST", { body: "x".repeat(300000) })).status,
    401,
  );
  const w = await request("/workspace", "GET", undefined, c);
  assert.equal(w.headers.get("cache-control"), "no-store");
  assert.match(w.headers.get("content-security-policy"), /object-src 'none'/);
  await store.db.exec("DROP TABLE records");
  const failed = await request("/workspace", "GET", undefined, c);
  assert.equal(failed.status, 500);
  assert.equal(failed.data.error, "Request failed. Try again later.");
  assert.doesNotMatch(JSON.stringify(failed.data), /SQL|records|stack/i);
});
test("legacy hashes migrate after successful sign-in and database files use restrictive permissions", async (t) => {
  const { request, store } = await setup(t);
  const salt = "a".repeat(32),
    legacy = salt + ":" + scryptSync(password, salt, 64).toString("hex");
  await store.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run(
      randomUUID(),
      "legacy@example.com",
      legacy,
      "Legacy",
      "UTC",
      '["Saved"]',
    );
  assert.equal(
    (
      await request("/auth/login", "POST", {
        email: "legacy@example.com",
        password,
      })
    ).status,
    200,
  );
  assert.match(
    (await store.db.prepare("SELECT password FROM users").get()).password,
    /^scrypt-v1:/,
  );
  const dir = mkdtempSync(join(tmpdir(), "offerly-security-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "private.sqlite"),
    fileStore = await createStore(path);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  fileStore.db.close();
});
test("ClamAV protocol accepts clean only, rejects infected, unavailable and malformed responses", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "offerly-av-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [index, response] of [
    "stream: OK\0",
    "stream: Eicar-Test-Signature FOUND\0",
    "stream: ERROR\0",
  ].entries()) {
    const path = join(dir, "scan" + index + ".sock");
    const server = createServer((socket) => {
      let all = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        all = Buffer.concat([all, chunk]);
        if (all.length >= 10 + 4 + pdf.length + 4) {
          assert.equal(all.subarray(0, 10).toString(), "zINSTREAM\0");
          assert.equal(all.readUInt32BE(10), pdf.length);
          socket.end(response);
        }
      });
    });
    await new Promise((r) => server.listen(path, r));
    if (index === 0) await scanWithClamav(pdf, path);
    else
      await assert.rejects(
        scanWithClamav(pdf, path),
        index === 1 ? /screening/ : /unavailable/,
      );
    await new Promise((r) => server.close(r));
  }
  await assert.rejects(
    scanWithClamav(pdf, join(dir, "missing.sock")),
    /unavailable/,
  );
});
// Minimal stored ZIP fixture; no shell tools or network are involved.
function zipFixture(entries) {
  let offset = 0;
  const locals = [],
    centrals = [];
  const crc32 = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const [filename, content] of Object.entries(entries)) {
    const name = Buffer.from(filename),
      body = Buffer.from(content),
      crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
test("DOCX validation accepts a Word package and rejects disguised ZIPs, macros, entities and traversal", async () => {
  const entries = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml":
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Resume</w:t></w:r></w:p></w:body></w:document>',
  };
  assert.match(
    await validateDocument("resume.docx", zipFixture(entries)),
    /wordprocessingml/,
  );
  for (const invalid of [
    { "readme.txt": "not a Word document" },
    { ...entries, "word/vbaProject.bin": "malicious macro" },
    { ...entries, "word/activeX/control.bin": "active content" },
    { ...entries, "../escape.txt": "bad path" },
    {
      ...entries,
      "word/document.xml":
        '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]><document>&x;</document>',
    },
    { ...entries, "word/document.xml": "<html>not a document</html>" },
    { ...entries, "word/document.xml": "<document><invalid></document>" },
  ])
    await assert.rejects(
      validateDocument("resume.docx", zipFixture(invalid)),
      /DOCX/,
    );
});
test("scanner failure never persists upload bytes", async (t) => {
  const { request, register, store } = await setup(t, {
    scannerSocket: "/nonexistent-offerly-test-scanner",
  });
  const c = await register();
  assert.equal(
    (
      await request(
        "/files",
        "POST",
        { name: "resume.pdf", body: pdf.toString("base64") },
        c,
      )
    ).status,
    503,
  );
  assert.equal(
    (await store.db.prepare("SELECT count(*) n FROM files").get()).n,
    0,
  );
});
test("noncanonical API paths do not bypass request protection", async (t) => {
  const { request, register } = await setup(t);
  const c = await register();
  assert.equal(
    (
      await request("/../API/logout", "POST", {}, c, {
        "X-Offerly-Request": "",
      })
    ).status,
    403,
  );
  assert.equal((await request("/logout/", "POST", {}, c)).status, 404);
  assert.equal((await request("/workspace", "GET", undefined, c)).status, 200);
});
test("session revocation after password verification prevents password-change commit", async (t) => {
  const { store, request, register } = await setup(t);
  const cookie = await register("revoke-race@example.com");
  const before = (await store.db.prepare("SELECT password FROM users").get())
    .password;
  const prepare = store.db.prepare.bind(store.db);
  let revoked = false;
  // Model logout precisely after reauthentication's session read, while the
  // asynchronous password-change operation still has work before its commit.
  store.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (
      sql ===
      "SELECT token FROM sessions WHERE token=? AND expires>? AND last_seen>?"
    ) {
      return new Proxy(statement, {
        get(target, name) {
          if (name === "get")
            return (...args) => {
              const value = target.get(...args);
              if (value)
                queueMicrotask(() => {
                  prepare("DELETE FROM sessions").run();
                  revoked = true;
                });
              return value;
            };
          const value = Reflect.get(target, name);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    return statement;
  };
  const result = await request(
    "/account/password",
    "POST",
    { currentPassword: password, newPassword: "replacement-secure-password" },
    cookie,
  );
  assert.equal(revoked, true);
  assert.equal(result.status, 401);
  assert.equal(result.data.code, "SESSION_REQUIRED");
  assert.equal(
    (await prepare("SELECT password FROM users").get()).password,
    before,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, cookie)).status,
    401,
  );
});
