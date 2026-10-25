import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../helpers/store.js";
import {
  documentUsageSchema,
  validateDocumentUsage,
} from "../../server/document-usage.js";
async function fixture(t) {
  const store = await createStore(":memory:");
  t.after(() => store.db.close());
  const user = { id: randomUUID() },
    other = { id: randomUUID() };
  for (const owner of [user, other])
    await store.db
      .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
      .run(owner.id, `${owner.id}@example.test`, "unused", "Test", "UTC", "[]");
  const app = await store.save(user.id, "application", {
    company: "Acme",
    title: "Engineer",
  });
  const fileId = randomUUID();
  await store.db
    .prepare(
      "INSERT INTO files(id,user_id,name,mime,hash,body,created_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      fileId,
      user.id,
      "resume.pdf",
      "application/pdf",
      "verified-file-hash",
      Buffer.from("fixture"),
      "2026-01-01T12:00:00.000Z",
    );
  const document = await store.save(user.id, "document", {
    title: "Resume January",
    fileId,
  });
  const input = {
    applicationId: app.id,
    documentVersionId: document.id,
    submittedDate: "2026-01-02",
    purpose: "Resume",
  };
  return { store, user, other, app, fileId, document, input };
}
test("submitted versions derive evidence from owned immutable documents and reject forged snapshots", async (t) => {
  const { store, user, input, fileId, document } = await fixture(t);
  const validated = await validateDocumentUsage(
    {
      ...input,
      title: "forged",
      documentHash: "forged",
      fileId: randomUUID(),
      documentVersionNumber: 99,
    },
    user,
    store,
  );
  assert.equal(validated.title, "Resume January");
  assert.equal(validated.fileId, fileId);
  assert.equal(validated.documentHash, "verified-file-hash");
  assert.equal(validated.documentVersionNumber, document.versionNumber || null);
  assert.equal(
    validated.documentCreatedAt,
    document.createdAt || "2026-01-01T12:00:00.000Z",
  );
  await store.save(user.id, "document", {
    title: "Resume February",
    fileId,
    documentId: document.id,
    versionNumber: 3,
  });
  assert.deepEqual(await validateDocumentUsage(input, user, store), validated);
});
test("submitted versions validate application, document and file ownership independently", async (t) => {
  const { store, user, other, input, fileId } = await fixture(t);
  const otherApp = await store.save(other.id, "application", {
    title: "Private",
  });
  const otherDocument = await store.save(other.id, "document", {
    title: "Private",
    fileId,
  });
  await assert.rejects(
    async () =>
      await validateDocumentUsage(
        { ...input, applicationId: otherApp.id },
        user,
        store,
      ),
    /Invalid application link/,
  );
  await assert.rejects(
    async () =>
      await validateDocumentUsage(
        { ...input, documentVersionId: otherDocument.id },
        user,
        store,
      ),
    /Document version not found/,
  );
  const badDocument = await store.save(user.id, "document", {
    title: "Wrong file owner",
    fileId,
  });
  await store.db
    .prepare("UPDATE files SET user_id=? WHERE id=?")
    .run(other.id, fileId);
  await assert.rejects(
    async () =>
      await validateDocumentUsage(
        { ...input, documentVersionId: badDocument.id },
        user,
        store,
      ),
    /Document file not found/,
  );
});
test("submitted versions require explicit real dates and preserve correction and retraction history", async (t) => {
  const { store, user, input } = await fixture(t);
  for (const submittedDate of [
    undefined,
    "",
    "2026-02-30",
    "2026-1-2",
    "not-a-date",
  ])
    assert.equal(
      documentUsageSchema.safeParse({ ...input, submittedDate }).success,
      false,
    );
  assert.equal(
    documentUsageSchema.safeParse({ ...input, submittedDate: "2024-02-29" })
      .success,
    true,
  );
  let usage = await store.save(
    user.id,
    "document_usage",
    await validateDocumentUsage(input, user, store),
  );
  const firstVersion = usage.version;
  usage = await store.save(
    user.id,
    "document_usage",
    await validateDocumentUsage(
      { ...input, submittedDate: "2026-01-03", notes: "Corrected date" },
      user,
      store,
    ),
    usage.id,
    usage.version,
  );
  await assert.rejects(
    async () =>
      await store.save(
        user.id,
        "document_usage",
        await validateDocumentUsage(input, user, store),
        usage.id,
        firstVersion,
      ),
    /Changed in another window/,
  );
  usage = await store.save(
    user.id,
    "document_usage",
    await validateDocumentUsage({ ...usage, retracted: true }, user, store),
    usage.id,
    usage.version,
  );
  assert.equal(usage.retracted, true);
  usage = await store.save(
    user.id,
    "document_usage",
    await validateDocumentUsage({ ...usage, retracted: false }, user, store),
    usage.id,
    usage.version,
  );
  assert.equal(usage.retracted, false);
  const events = await store.db
    .prepare("SELECT * FROM events WHERE record_id=? ORDER BY rowid")
    .all(usage.id);
  assert.equal(events.length, 4);
  assert.equal(JSON.parse(events[0].after_data).submittedDate, "2026-01-02");
  assert.equal(JSON.parse(events[2].after_data).retracted, true);
});
test("legacy submitted documents retain unknown version numbers", async (t) => {
  const { store, user, input, document } = await fixture(t);
  const stored = JSON.parse((await store.get(user.id, document.id)).data);
  delete stored.versionNumber;
  delete stored.createdAt;
  await store.db
    .prepare("UPDATE records SET data=? WHERE id=?")
    .run(JSON.stringify(stored), document.id);
  const usage = await validateDocumentUsage(input, user, store);
  assert.equal(usage.documentVersionNumber, null);
  assert.equal(usage.documentCreatedAt, "2026-01-01T12:00:00.000Z");
});
