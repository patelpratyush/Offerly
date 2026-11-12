import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
import { validateDocument } from "../../server/files.js";
import { buildPdf, pdfText } from "../../server/pdf-text.js";
import { deflateSync } from "node:zlib";
import { generateDraft, tones } from "../../server/message-templates.js";

async function setup(t) {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const raw = (path, method, body, cookie) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Offerly-Request": "1",
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body:
        body === undefined
          ? ["GET", "HEAD"].includes(method)
            ? undefined
            : "{}"
          : JSON.stringify(body),
    });
  const request = async (path, method = "GET", body, cookie) => {
    const res = await raw(path, method, body, cookie);
    return {
      status: res.status,
      cookie: res.headers.get("set-cookie")?.split(";")[0],
      data: await res.json().catch(() => null),
    };
  };
  const register = async (email) =>
    (
      await request("/auth/register", "POST", {
        name: "Test User",
        email,
        password: "a-secure-test-password",
        timezone: "America/New_York",
      })
    ).cookie;
  return { request, raw, register, store };
}
const create = async (request, cookie, kind, data) => {
  const r = await request(`/records/${kind}`, "POST", data, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};

test("built PDF is valid, wrapped, escaped, bounded and passes the upload validator", async () => {
  const long = "word ".repeat(400);
  const text = `Résumé (draft) \\ end\n${long}\nline with ünïcode and 日本語\n\n${"x".repeat(300)}`;
  const pdf = buildPdf(text);
  assert.equal(await validateDocument("r.pdf", pdf), "application/pdf");
  const source = pdf.toString("latin1");
  assert.match(source, /^%PDF-1\.4/);
  assert.match(source, /%%EOF\n$/);
  const start = Number(source.match(/startxref\n(\d+)/)[1]);
  assert.equal(source.slice(start, start + 4), "xref");
  for (const m of source.matchAll(/(\d{10}) 00000 n/g))
    assert.match(source.slice(Number(m[1])), /^\d+ 0 obj/);
  const read = pdfText(pdf);
  assert.equal(read.available, true);
  assert.match(read.text, /^Résumé \(draft\) \\ end/);
  assert.match(read.text, /ünïcode and \?\?\?/);
  assert.ok(
    read.text.split("\n").every((l) => l.length < 120),
    "lines wrap",
  );
  assert.equal(
    read.text.replace(/\s+/g, ""),
    text.replace(/日本語/, "???").replace(/\s+/g, ""),
  );
  assert.equal(pdfText(buildPdf("")).available, false, "empty is unreadable");
  assert.throws(() => buildPdf("line\n".repeat(20000)), /too long/);
});

test("PDF reader handles simple compressed streams and refuses unsupported or hostile files", () => {
  const stream = deflateSync(
    Buffer.from(
      "BT /F1 12 Tf 72 700 Td [(Hello) -300 (World)] TJ 0 -14 Td (Second line) Tj ET",
    ),
  );
  const make = (
    extra = "",
    content = stream,
    filter = "/Filter /FlateDecode",
  ) =>
    Buffer.concat([
      Buffer.from(
        `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R ${extra} >>\nendobj\n4 0 obj\n<< ${filter} /Length ${content.length} >>\nstream\n`,
        "latin1",
      ),
      content,
      Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n"),
    ]);
  const ok = pdfText(make());
  assert.equal(ok.available, true);
  assert.equal(ok.text, "Hello World\nSecond line");
  assert.equal(pdfText(make("/Encrypt 9 0 R")).available, false);
  assert.equal(pdfText(make("/Subtype /Type0")).available, false);
  assert.equal(
    pdfText(make("", Buffer.from("garbage"), "/Filter /DCTDecode")).available,
    false,
  );
  assert.equal(pdfText(make("", Buffer.from("not deflate"))).available, false);
  const bomb = deflateSync(Buffer.alloc(50 * 1024 * 1024, 0x20));
  assert.equal(pdfText(make("", bomb)).available, false, "bomb is capped");
  assert.equal(pdfText(Buffer.from("%PDF-1.4\n%%EOF")).available, false);
  assert.equal(pdfText(Buffer.alloc(6 * 1024 * 1024)).available, false);
  const junk = deflateSync(
    Buffer.from(
      "BT (\\001\\002\\003\\004\\005\\006\\007\\010\\016\\017) Tj ET",
    ),
  );
  assert.equal(pdfText(make("", junk)).available, false);
});

test("PDF export, saved PDF version and PDF text loading work through the API", async (t) => {
  const { request, raw, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const app = await create(request, a, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Submitted",
  });
  const upload = await request(
    "/files",
    "POST",
    {
      name: "resume.pdf",
      body: buildPdf("Python engineer\nBuilt APIs").toString("base64"),
    },
    a,
  );
  assert.equal(upload.status, 200);
  const version = await create(request, a, "document", {
    title: "Resume",
    fileId: upload.data.id,
    label: "Resume",
    applicationIds: [app.id],
  });
  const loaded = await request(
    `/prepare/document-text/${version.id}`,
    "GET",
    undefined,
    a,
  );
  assert.equal(loaded.data.available, true);
  assert.equal(loaded.data.text, "Python engineer\nBuilt APIs");
  assert.match(loaded.data.notice, /check/i);
  assert.equal(
    (await request(`/prepare/document-text/${version.id}`, "GET", undefined, b))
      .status,
    404,
  );
  const exported = await raw(
    "/prepare/export",
    "POST",
    { text: "Reviewed text (ok)", name: "My Resume", format: "pdf" },
    a,
  );
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get("content-type"), "application/pdf");
  assert.match(exported.headers.get("content-disposition"), /My%20Resume\.pdf/);
  assert.equal(
    pdfText(Buffer.from(await exported.arrayBuffer())).text,
    "Reviewed text (ok)",
  );
  const saved = await request(
    "/prepare/tailored",
    "POST",
    {
      clientId: crypto.randomUUID(),
      applicationId: app.id,
      baseDocumentId: version.id,
      text: "Reviewed text",
      format: "pdf",
    },
    a,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const docs = (await request("/workspace", "GET", undefined, a)).data
    .documents;
  const original = docs.find((d) => d.id === version.id);
  const tailored = docs.find((d) => d.id === saved.data.documentVersionId);
  assert.equal(original.fileId, version.fileId, "earlier version unchanged");
  assert.notEqual(tailored.fileId, version.fileId);
  const file = await raw(`/files/${tailored.fileId}`, "GET", undefined, a);
  assert.equal(file.status, 200);
  assert.equal(
    (await request("/prepare/export", "POST", { text: "x", format: "exe" }, a))
      .status,
    400,
  );
});

test("tone variants are deterministic, keep placeholders and never invent facts", () => {
  const application = { title: "Engineer", company: "Acme", appliedDate: "" };
  for (const template of [
    "follow_up",
    "thank_you",
    "availability",
    "referral",
    "deadline_extension",
  ]) {
    const bodies = new Set();
    for (const tone of tones) {
      const first = generateDraft({
        template,
        application,
        contacts: [],
        tone,
      });
      assert.deepEqual(
        first,
        generateDraft({ template, application, contacts: [], tone }),
      );
      assert.ok(first.placeholders.includes("[[recipient name]]"));
      assert.ok(first.placeholders.includes("[[your name]]"));
      assert.doesNotMatch(first.body, /applied|submitted on/i);
      bodies.add(first.body);
    }
    assert.equal(bodies.size, tones.length, `${template} tones differ`);
  }
  const standard = generateDraft({
    template: "follow_up",
    application,
    contacts: [],
  });
  assert.deepEqual(
    standard,
    generateDraft({
      template: "follow_up",
      application,
      contacts: [],
      tone: "standard",
    }),
  );
  assert.match(standard.body, /^Hi \[\[recipient name\]\],/);
  assert.match(
    generateDraft({
      template: "referral",
      application,
      contacts: [{ name: "Ana Lee" }],
      userName: "Sam",
      tone: "formal",
    }).body,
    /^Dear Ana,[\s\S]*Sincerely,\nSam$/,
  );
  assert.throws(() =>
    generateDraft({ template: "follow_up", application, tone: "angry" }),
  );
});

test("draft generation accepts a tone and rejects unknown ones", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com");
  const app = await create(request, a, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Submitted",
  });
  const body = {
    template: "follow_up",
    applicationId: app.id,
    roundId: "",
    contactIds: [],
  };
  const warm = await request(
    "/prepare/drafts/generate",
    "POST",
    { ...body, tone: "warm" },
    a,
  );
  assert.equal(warm.status, 200);
  assert.match(warm.data.body, /hope you're doing well/);
  assert.equal(
    (
      await request(
        "/prepare/drafts/generate",
        "POST",
        { ...body, tone: "pushy" },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/prepare/drafts/generate", "POST", body, a)).status,
    200,
  );
});

test("reminder deliveries expose real source references and stay owner scoped", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const app = await create(request, a, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Interviewing",
  });
  const date = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const round = await create(request, a, "round", {
    title: "Panel",
    applicationId: app.id,
    status: "Scheduled",
    date,
    time: "10:00",
    timezone: "America/New_York",
    url: "https://meet.example.test/panel",
  });
  const view = await request("/reminder-settings", "GET", undefined, a);
  const list = view.data.deliveries.filter((d) => d.sourceId === round.id);
  assert.ok(list.length >= 1);
  for (const d of list) {
    assert.equal(d.sourceKind, "round");
    assert.equal(d.applicationId, app.id);
    assert.equal(d.sourceUrl, "https://meet.example.test/panel");
    assert.ok(d.sentAt === "" || d.state === "sent", "no invented sent time");
  }
  const other = await request("/reminder-settings", "GET", undefined, b);
  assert.deepEqual(other.data.deliveries, []);
});
