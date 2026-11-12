import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createApp } from "../../server/app.js";
import { createStore } from "../helpers/store.js";
import { buildDocx, docxText } from "../../server/docx-text.js";
import { validateDocument } from "../../server/files.js";
import { analyzeCoverage } from "../../src/lib/coverage.ts";

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
  const register = async (email) => {
    const r = await request("/auth/register", "POST", {
      name: "Test User",
      email,
      password: "a-secure-test-password",
      timezone: "America/New_York",
    });
    assert.equal(r.status, 200);
    return r.cookie;
  };
  return { request, raw, register, store };
}
const create = async (request, cookie, kind, data) => {
  const r = await request(`/records/${kind}`, "POST", data, cookie);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};

test("answers require explicit confirmed values for sensitive categories and stay private", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const blank = await request(
    "/prepare/answers",
    "POST",
    { question: "Will you need sponsorship?", category: "sponsorship" },
    a,
  );
  assert.equal(blank.status, 200);
  assert.equal(blank.data.unanswered, true);
  assert.equal(blank.data.confirmed, false);
  const unconfirmed = await request(
    "/prepare/answers",
    "POST",
    { question: "Salary?", category: "salary", answer: "150000" },
    a,
  );
  assert.equal(unconfirmed.status, 400);
  const wrongValue = await request(
    "/prepare/answers",
    "POST",
    {
      question: "Salary?",
      category: "salary",
      answer: "150000",
      confirmed: true,
      confirmedValue: "140000",
    },
    a,
  );
  assert.equal(wrongValue.status, 400);
  const clientId = randomUUID();
  const body = {
    clientId,
    question: "Start date?",
    category: "start_date",
    answer: "2026-09-01",
    confirmed: true,
    confirmedValue: "2026-09-01",
    lastConfirmedAt: "1999-01-01T00:00:00Z",
  };
  const saved = await request("/prepare/answers", "POST", body, a);
  assert.equal(saved.status, 200);
  assert.ok(saved.data.lastConfirmedAt.startsWith("20"));
  assert.notEqual(saved.data.lastConfirmedAt, "1999-01-01T00:00:00Z");
  assert.equal(saved.data.characterCount, 10);
  // Retried create is idempotent.
  const replay = await request("/prepare/answers", "POST", body, a);
  assert.equal(replay.data.id, saved.data.id);
  assert.equal(
    (await request("/prepare", "GET", undefined, a)).data.answers.length,
    2,
  );
  // Changing a confirmed sensitive answer without re-confirmation is rejected.
  const edit = await request(
    `/prepare/answers/${saved.data.id}`,
    "PUT",
    {
      ...body,
      answer: "2026-10-01",
      confirmed: true,
      version: saved.data.version,
    },
    a,
  );
  assert.equal(edit.status, 400);
  // Unchanged answer keeps its confirmation date.
  const keep = await request(
    `/prepare/answers/${saved.data.id}`,
    "PUT",
    {
      ...body,
      confirmedValue: undefined,
      question: "When can you start?",
      version: saved.data.version,
    },
    a,
  );
  assert.equal(keep.status, 200);
  assert.equal(keep.data.lastConfirmedAt, saved.data.lastConfirmedAt);
  const stale = await request(
    `/prepare/answers/${saved.data.id}`,
    "PUT",
    { ...body, version: saved.data.version },
    a,
  );
  assert.equal(stale.status, 409);
  // Non-sensitive answers enforce the user's character limit.
  const limited = await request(
    "/prepare/answers",
    "POST",
    {
      question: "Why us?",
      category: "experience",
      answer: "abcdef",
      characterLimit: 5,
    },
    a,
  );
  assert.equal(limited.status, 400);
  // Isolation.
  assert.equal(
    (
      await request(
        `/prepare/answers/${saved.data.id}`,
        "PUT",
        { ...body, confirmedValue: undefined, version: keep.data.version },
        b,
      )
    ).status,
    404,
  );
  assert.equal(
    (await request("/prepare", "GET", undefined, b)).data.answers.length,
    0,
  );
});

test("interview preparation is bound to an owned round, unique per round and version checked", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const app = await create(request, a, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Interviewing",
  });
  const other = await create(request, a, "application", {
    company: "Beta",
    title: "Dev",
    stage: "Saved",
  });
  const round = await create(request, a, "round", {
    title: "Technical interview",
    applicationId: app.id,
    status: "Scheduled",
    date: "2026-12-01",
    timezone: "America/New_York",
  });
  const contact = await create(request, a, "contact", { name: "Pat Lee" });
  const foreign = await create(request, b, "application", {
    company: "X",
    title: "Y",
    stage: "Saved",
  });
  const payload = {
    applicationId: app.id,
    roundId: round.id,
    people: [{ name: "Pat Lee", contactId: contact.id }],
    practiceQuestions: [{ question: "Tell me about a system you scaled" }],
    notes: "mine",
  };
  assert.equal(
    (
      await request(
        "/prepare/preps",
        "POST",
        { ...payload, applicationId: other.id },
        a,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await request(
        "/prepare/preps",
        "POST",
        { ...payload, applicationId: foreign.id },
        b,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request("/prepare/preps", "POST", payload, b)).status,
    400,
  );
  const saved = await request("/prepare/preps", "POST", payload, a);
  assert.equal(saved.status, 200);
  assert.equal(
    (await request("/prepare/preps", "POST", payload, a)).status,
    409,
  );
  const updated = await request(
    `/prepare/preps/${saved.data.id}`,
    "PUT",
    {
      ...payload,
      postInterviewNotes: "went well",
      version: saved.data.version,
    },
    a,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.data.postInterviewNotes, "went well");
  assert.equal(
    (
      await request(
        `/prepare/preps/${saved.data.id}`,
        "PUT",
        { ...payload, version: saved.data.version },
        a,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await request(
        `/prepare/preps/${saved.data.id}`,
        "PUT",
        { ...payload, applicationId: other.id, version: updated.data.version },
        a,
      )
    ).status,
    400,
  );
  // Preparation is not an assessment record.
  assert.equal(
    (await request("/workspace", "GET", undefined, a)).data.assessments.length,
    0,
  );
});

test("message drafts are template based, show gaps as placeholders and cannot be sent", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const app = await create(request, a, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Submitted",
  });
  const round = await create(request, a, "round", {
    title: "Phone screen",
    applicationId: app.id,
    status: "Invited",
    timezone: "UTC",
  });
  const withEmail = await create(request, a, "contact", {
    name: "Pat Lee",
    email: "pat@acme.example",
  });
  const noEmail = await create(request, a, "contact", { name: "Sam Roe" });
  const gen = await request(
    "/prepare/drafts/generate",
    "POST",
    {
      template: "thank_you",
      applicationId: app.id,
      roundId: round.id,
      contactIds: [withEmail.id, noEmail.id],
    },
    a,
  );
  assert.equal(gen.status, 200);
  assert.match(gen.data.body, /^Hi Pat and Sam,/);
  assert.match(gen.data.body, /Phone screen/);
  assert.match(gen.data.body, /Test User/);
  assert.ok(gen.data.placeholders.length > 0);
  assert.ok(gen.data.notes.some((n) => /not Completed/.test(n)));
  assert.ok(gen.data.notes.some((n) => /Sam Roe has no email/.test(n)));
  const followUp = await request(
    "/prepare/drafts/generate",
    "POST",
    {
      template: "follow_up",
      applicationId: app.id,
      contactIds: [withEmail.id],
    },
    a,
  );
  assert.doesNotMatch(followUp.data.body, /submitted on/);
  const referral = await request(
    "/prepare/drafts/generate",
    "POST",
    { template: "referral", applicationId: app.id, contactIds: [] },
    a,
  );
  assert.match(referral.data.body, /^Hi \[\[recipient name\]\],/);
  assert.doesNotMatch(referral.data.body, /attached|attach/i);
  assert.equal(
    (
      await request(
        "/prepare/drafts/generate",
        "POST",
        {
          template: "follow_up",
          applicationId: app.id,
          contactIds: [withEmail.id],
        },
        b,
      )
    ).status,
    400,
  );
  const draft = {
    template: "thank_you",
    applicationId: app.id,
    roundId: round.id,
    contactIds: [withEmail.id],
    subject: gen.data.subject,
    body: gen.data.body,
    state: "ready",
  };
  assert.equal(
    (await request("/prepare/drafts", "POST", draft, a)).status,
    400,
    "placeholders block ready",
  );
  const saved = await request(
    "/prepare/drafts",
    "POST",
    { ...draft, state: "draft" },
    a,
  );
  assert.equal(saved.status, 200);
  const ready = await request(
    `/prepare/drafts/${saved.data.id}`,
    "PUT",
    {
      ...draft,
      body: "Thank you for your time.",
      version: saved.data.version,
    },
    a,
  );
  assert.equal(ready.status, 200);
  assert.equal(ready.data.state, "ready");
  assert.equal(
    (await request("/prepare/drafts", "POST", { ...draft, state: "sent" }, a))
      .status,
    400,
  );
  assert.equal(
    (
      await request(
        "/prepare/drafts",
        "POST",
        { ...draft, body: "ok", contactIds: [noEmail.id] },
        a,
      )
    ).status,
    400,
    "ready needs an addressable recipient",
  );
  for (const path of [
    `/prepare/drafts/${saved.data.id}/send`,
    "/prepare/send",
    "/send",
  ])
    assert.equal((await request(path, "POST", {}, a)).status, 404);
});

test("DOCX writer output passes upload validation and round-trips text", async () => {
  const body = buildDocx("Line one & <two>\n\nThird");
  assert.equal(
    await validateDocument("x.docx", body),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
  assert.equal(await docxText(body), "Line one & <two>\n\nThird");
});

test("coverage reports supported, partial and missing requirements without inventing", () => {
  const result = analyzeCoverage(
    "Built Python services on AWS.",
    "Requirements\n- Python and AWS experience\n- Kubernetes operations\n- Python and Terraform skills",
  );
  const by = Object.fromEntries(result.requirements.map((r) => [r.text, r]));
  assert.equal(by["Python and AWS experience"].status, "found");
  assert.equal(by["Kubernetes operations"].status, "gap");
  assert.equal(by["Python and Terraform skills"].status, "partial");
  assert.deepEqual(by["Python and Terraform skills"].missing, ["terraform"]);
  assert.equal(
    result.keywords.find((k) => k.term === "kubernetes").found,
    false,
  );
});

test("tailored text becomes a new labeled version without touching submitted versions", async (t) => {
  const { request, raw, register, store } = await setup(t);
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
      name: "resume.docx",
      body: buildDocx("Python engineer\nBuilt APIs").toString("base64"),
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
  const usage = await create(request, a, "document_usage", {
    applicationId: app.id,
    documentVersionId: version.id,
    submittedDate: "2026-01-02",
    purpose: "Resume",
    notes: "",
  });
  const text = await request(
    `/prepare/document-text/${version.id}`,
    "GET",
    undefined,
    a,
  );
  assert.equal(text.data.available, true);
  assert.match(text.data.text, /Python engineer/);
  assert.equal(
    (await request(`/prepare/document-text/${version.id}`, "GET", undefined, b))
      .status,
    404,
  );
  const clientId = randomUUID();
  const input = {
    clientId,
    applicationId: app.id,
    baseDocumentId: version.id,
    text: "Python engineer\nBuilt reliable APIs",
    gaps: ["Kubernetes operations"],
  };
  assert.equal(
    (await request("/prepare/tailored", "POST", input, b)).status,
    400,
  );
  const saved = await request("/prepare/tailored", "POST", input, a);
  assert.equal(saved.status, 200);
  const replay = await request("/prepare/tailored", "POST", input, a);
  assert.equal(replay.data.id, saved.data.id);
  const documents = (await request("/workspace", "GET", undefined, a)).data
    .documents;
  assert.equal(documents.length, 2);
  const tailored = documents.find((d) => d.id === saved.data.documentVersionId);
  assert.equal(tailored.label, "Tailored (edited text)");
  assert.equal(tailored.documentId, version.id);
  assert.equal(tailored.versionNumber, 2);
  const original = documents.find((d) => d.id === version.id);
  assert.equal(original.label, "Resume");
  assert.equal(original.fileId, upload.data.id);
  const row = await store.db
    .prepare("SELECT version FROM records WHERE id=?")
    .get(version.id);
  assert.equal(row.version, 1, "base version record is untouched");
  const put = await request(
    `/records/document/${tailored.id}`,
    "PUT",
    { ...tailored, version: 1 },
    a,
  );
  assert.equal(put.status, 400, "versions remain immutable");
  const file = await request(`/files/${tailored.fileId}`, "GET", undefined, a);
  assert.equal(file.status, 200);
  const after = (
    await request("/workspace", "GET", undefined, a)
  ).data.documentUsages.find((u) => u.id === usage.id);
  assert.equal(after.documentVersionId, version.id);
  assert.equal(after.documentHash, usage.documentHash);
  const exported = await raw(
    "/prepare/export",
    "POST",
    { text: input.text, name: "My Resume" },
    a,
  );
  assert.equal(exported.status, 200);
  assert.match(
    exported.headers.get("content-disposition"),
    /My%20Resume\.docx/,
  );
  assert.equal(
    await docxText(Buffer.from(await exported.arrayBuffer())),
    input.text,
  );
});

test("contact import previews, flags invalid rows, matches only verified emails and commits idempotently", async (t) => {
  const { request, register } = await setup(t);
  const a = await register("a@example.com"),
    b = await register("b@example.com");
  const verified = await create(request, a, "contact", {
    name: "Vera Verified",
    email: "vera@acme.example",
    emailConfirmed: true,
  });
  await create(request, a, "contact", {
    name: "Una Unverified",
    email: "una@acme.example",
  });
  await create(request, a, "contact", { name: "Alex Kim", company: "Old Co" });
  const csv = [
    "Full Name,Email Address,Company,Relationship",
    "Vera V.,VERA@acme.example,Acme,Recruiter",
    "Una U.,una@acme.example,Acme,Recruiter",
    "Alex Kim,alex@new.example,New Co,Other",
    ",bad@example.com,X,Recruiter",
    "Bad Email,not-an-email,X,Recruiter",
    "Twin One,twin@new.example,X,Other",
    "Twin Two,TWIN@new.example,X,Other",
  ].join("\n");
  const preview = await request("/import/contacts/preview", "POST", { csv }, a);
  assert.equal(preview.status, 200);
  const status = Object.fromEntries(
    preview.data.rows.map((r) => [r.row, r.status]),
  );
  assert.deepEqual(status, {
    2: "duplicate",
    3: "new",
    4: "new",
    5: "invalid",
    6: "invalid",
    7: "new",
    8: "file_duplicate",
  });
  assert.equal(preview.data.rows[0].duplicateOf.id, verified.id);
  assert.equal(preview.data.rows[2].suggestions[0].name, "Alex Kim");
  const operationId = randomUUID();
  const commit = await request(
    "/import/contacts/commit",
    "POST",
    { csv, operationId },
    a,
  );
  assert.equal(commit.status, 200);
  assert.equal(commit.data.created, 3);
  const replay = await request(
    "/import/contacts/commit",
    "POST",
    { csv, operationId },
    a,
  );
  assert.equal(replay.data.replayed, true);
  const again = await request(
    "/import/contacts/commit",
    "POST",
    { csv, operationId: randomUUID() },
    a,
  );
  assert.equal(again.data.created, 0, "re-import does not duplicate");
  assert.equal(
    (
      await request(
        "/import/contacts/commit",
        "POST",
        { csv: csv + "\nZ,z@z.example,,", operationId },
        a,
      )
    ).status,
    409,
  );
  const contacts = (await request("/workspace", "GET", undefined, a)).data
    .contacts;
  assert.equal(contacts.length, 6);
  assert.equal(
    contacts.filter((c) => c.email === "una@acme.example").length,
    2,
    "unverified email is never merged",
  );
  assert.equal(
    contacts.filter(
      (c) => c.name === "Vera Verified" || c.email === "vera@acme.example",
    ).length,
    1,
  );
  const twin = contacts.find((c) => c.email === "twin@new.example");
  assert.equal(twin.provenance.name.source, "Imported");
  assert.equal(twin.emailConfirmed, false);
  assert.equal(
    (await request("/workspace", "GET", undefined, b)).data.contacts.length,
    0,
  );
  assert.equal(
    (await request("/import/contacts/preview", "POST", { csv: "Foo\nbar" }, a))
      .status,
    400,
  );
});
