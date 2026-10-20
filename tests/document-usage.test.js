import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createStore } from "../server/store.js";
import {
  documentUsageSchema,
  validateDocumentUsage,
} from "../server/document-usage.js";

function fixture(t) {
  const store = createStore(":memory:");
  t.after(() => store.db.close());
  const user = { id: randomUUID() },
    other = { id: randomUUID() };
  for (const owner of [user, other])
    store.db
      .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
      .run(owner.id, `${owner.id}@example.test`, "unused", "Test", "UTC", "[]");
  const app = store.save(user.id, "application", {
    company: "Acme",
    title: "Engineer",
  });
  const fileId = randomUUID();
  store.db
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
  const document = store.save(user.id, "document", {
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

test("submitted versions derive evidence from owned immutable documents and reject forged snapshots", (t) => {
  const { store, user, input, fileId, document } = fixture(t);
  const validated = validateDocumentUsage(
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
  store.save(user.id, "document", {
    title: "Resume February",
    fileId,
    documentId: document.id,
    versionNumber: 3,
  });
  assert.deepEqual(validateDocumentUsage(input, user, store), validated);
});

test("submitted versions validate application, document and file ownership independently", (t) => {
  const { store, user, other, input, fileId } = fixture(t);
  const otherApp = store.save(other.id, "application", { title: "Private" });
  const otherDocument = store.save(other.id, "document", {
    title: "Private",
    fileId,
  });
  assert.throws(
    () =>
      validateDocumentUsage(
        { ...input, applicationId: otherApp.id },
        user,
        store,
      ),
    /Invalid application link/,
  );
  assert.throws(
    () =>
      validateDocumentUsage(
        { ...input, documentVersionId: otherDocument.id },
        user,
        store,
      ),
    /Document version not found/,
  );
  const badDocument = store.save(user.id, "document", {
    title: "Wrong file owner",
    fileId,
  });
  store.db
    .prepare("UPDATE files SET user_id=? WHERE id=?")
    .run(other.id, fileId);
  assert.throws(
    () =>
      validateDocumentUsage(
        { ...input, documentVersionId: badDocument.id },
        user,
        store,
      ),
    /Document file not found/,
  );
});

test("submitted versions require explicit real dates and preserve correction and retraction history", (t) => {
  const { store, user, input } = fixture(t);
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
  let usage = store.save(
    user.id,
    "document_usage",
    validateDocumentUsage(input, user, store),
  );
  const firstVersion = usage.version;
  usage = store.save(
    user.id,
    "document_usage",
    validateDocumentUsage(
      { ...input, submittedDate: "2026-01-03", notes: "Corrected date" },
      user,
      store,
    ),
    usage.id,
    usage.version,
  );
  assert.throws(
    () =>
      store.save(
        user.id,
        "document_usage",
        validateDocumentUsage(input, user, store),
        usage.id,
        firstVersion,
      ),
    /Changed in another window/,
  );
  usage = store.save(
    user.id,
    "document_usage",
    validateDocumentUsage({ ...usage, retracted: true }, user, store),
    usage.id,
    usage.version,
  );
  assert.equal(usage.retracted, true);
  usage = store.save(
    user.id,
    "document_usage",
    validateDocumentUsage({ ...usage, retracted: false }, user, store),
    usage.id,
    usage.version,
  );
  assert.equal(usage.retracted, false);
  const events = store.db
    .prepare("SELECT * FROM events WHERE record_id=? ORDER BY rowid")
    .all(usage.id);
  assert.equal(events.length, 4);
  assert.equal(JSON.parse(events[0].after_data).submittedDate, "2026-01-02");
  assert.equal(JSON.parse(events[2].after_data).retracted, true);
});

test("legacy submitted documents retain unknown version numbers", (t) => {
  const { store, user, input, document } = fixture(t);
  const stored = JSON.parse(store.get(user.id, document.id).data);
  delete stored.versionNumber;
  delete stored.createdAt;
  store.db
    .prepare("UPDATE records SET data=? WHERE id=?")
    .run(JSON.stringify(stored), document.id);
  const usage = validateDocumentUsage(input, user, store);
  assert.equal(usage.documentVersionNumber, null);
  assert.equal(usage.documentCreatedAt, "2026-01-01T12:00:00.000Z");
});
