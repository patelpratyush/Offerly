import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "csv-parse/sync";
import { createApp } from "../server/app.js";
import { createStore } from "./helpers/store.js";
async function setup(t) {
  const store = await createStore(":memory:");
  const server = (await createApp(store)).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    store.db.close();
  });
  const request = async (path, method = "GET", body, cookie) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-Offerly-Request": "1",
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: ["GET", "HEAD"].includes(method)
          ? undefined
          : JSON.stringify(body || {}),
      },
    );
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
    return {
      status: response.status,
      data,
      raw,
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  };
  const register = async (email) => {
    const result = await request("/auth/register", "POST", {
      name: "Completion",
      email,
      password: "completion-test-password",
    });
    assert.equal(result.status, 200);
    return result.cookie;
  };
  const create = async (cookie, kind, data) => {
    const result = await request("/records/" + kind, "POST", data, cookie);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    return result.data;
  };
  return { store, request, register, create };
}
test("contact provenance persists across edits without forging confirmations or timestamps", async (t) => {
  const { request, register, create } = await setup(t);
  const cookie = await register("contact-completion@example.com"),
    other = await register("contact-other@example.com");
  const app = await create(cookie, "application", {
    company: "Acme",
    title: "Engineer",
    stage: "Saved",
  });
  const contact = await create(cookie, "contact", {
    name: "Alex",
    email: "alex@example.com",
    emailConfirmed: true,
    company: "Agency",
    hiringCompany: "Acme",
    agency: "Talent",
    relationshipType: "Recruiter",
    phone: "+1 555 0100",
    linkedinUrl: "https://www.linkedin.com/in/example",
    lastInteraction: "2026-10-19",
    applicationIds: [app.id],
    provenance: {
      company: {
        source: "Email signature",
        evidence: "Signature names Agency",
        confirmed: false,
        recordedAt: "1900-01-01",
      },
    },
  });
  assert.equal(contact.emailConfirmed, true);
  assert.equal(contact.provenance.company.source, "Email signature");
  assert.notEqual(contact.provenance.company.recordedAt, "1900-01-01");
  const edited = (
    await request(
      `/records/contact/${contact.id}`,
      "PUT",
      {
        ...contact,
        email: "different@example.com",
        provenance: {
          ...contact.provenance,
          company: { ...contact.provenance.company, recordedAt: "1900-01-01" },
        },
      },
      cookie,
    )
  ).data;
  assert.equal(edited.emailConfirmed, false);
  assert.equal(
    edited.provenance.company.recordedAt,
    contact.provenance.company.recordedAt,
  );
  const cleared = (
    await request(
      `/records/contact/${contact.id}`,
      "PUT",
      { ...edited, company: "" },
      cookie,
    )
  ).data;
  assert.equal(cleared.provenance.company, undefined);
  assert.equal(
    (await request(`/records/contact/${contact.id}`, "PUT", cleared, other))
      .status,
    404,
  );
  assert.equal(
    (
      await request(
        "/records/contact",
        "POST",
        { name: "Private link", applicationIds: [app.id] },
        other,
      )
    ).status,
    400,
  );
  const second = await create(cookie, "contact", {
    name: "Alex",
    email: "second@example.com",
  });
  assert.notEqual(second.id, contact.id);
  const history = (
    await request(`/events/${contact.id}`, "GET", undefined, cookie)
  ).data;
  assert.ok(
    history.some(
      (e) =>
        JSON.parse(e.after_data).provenance.company?.source ===
        "Email signature",
    ),
  );
  const exported = (await request("/export.json", "GET", undefined, cookie))
    .data;
  assert.ok(
    exported.records.some(
      (r) =>
        r.kind === "contact" && JSON.parse(r.data).hiringCompany === "Acme",
    ),
  );
});
test("offer dates and listing captures survive CSV export/import with explicit date format", async (t) => {
  const { request, register, create } = await setup(t);
  const cookie = await register("offer-completion@example.com");
  const app = await create(cookie, "application", {
    company: "OfferCo",
    title: "Engineer",
    stage: "Saved",
    offerOutcome: "Accepted",
    offerReceivedDate: "2026-10-01",
    offerDecisionDate: "2026-10-02",
    description: "Original listing",
    descriptionCapturedDate: "2026-09-30",
    descriptionSourceUrl: "https://example.com/role",
  });
  assert.equal(app.stage, "Saved");
  assert.equal(
    (
      await request(
        `/records/application/${app.id}`,
        "PUT",
        { ...app, offerOutcome: "Pending" },
        cookie,
      )
    ).status,
    400,
  );
  const csv = (await request("/export.csv", "GET", undefined, cookie)).raw;
  const rows = parse(csv, { columns: true });
  assert.equal(rows[0].offerDecisionDate, "2026-10-02");
  assert.equal(rows[0].descriptionSourceUrl, "https://example.com/role");
  const preview = (
    await request(
      "/import/preview",
      "POST",
      {
        csv: "company,title,offerOutcome,offerReceivedDate,offerDecisionDate,description,descriptionCapturedDate,descriptionSourceUrl\nImported,Engineer,Declined,10/02/2026,10/03/2026,Pasted listing,09/29/2026,https://example.com/imported",
        dateFormat: "MDY",
      },
      cookie,
    )
  ).data;
  assert.equal(preview.rows[0].data.offerDecisionDate, "2026-10-03");
  assert.equal(preview.rows[0].data.descriptionCapturedDate, "2026-09-29");
  assert.equal(
    (await request("/import/commit", "POST", { id: preview.id }, cookie))
      .status,
    200,
  );
  const workspace = (await request("/workspace", "GET", undefined, cookie))
    .data;
  assert.equal(workspace.listingSnapshots.length, 2);
  assert.ok(
    workspace.listingSnapshots.some(
      (s) =>
        s.description === "Pasted listing" && s.capturedDate === "2026-09-29",
    ),
  );
});
test("listing revisions are immutable, private, and do not invent legacy capture dates", async (t) => {
  const { store, request, register, create } = await setup(t);
  const cookie = await register("listing-completion@example.com"),
    other = await register("listing-other@example.com");
  let app = await create(cookie, "application", {
    company: "CaptureCo",
    title: "Engineer",
    stage: "Saved",
    description: "Version one",
    descriptionCapturedDate: "2026-10-01",
    descriptionSourceUrl: "https://example.com/one",
  });
  app = (
    await request(
      `/records/application/${app.id}`,
      "PUT",
      { ...app, priority: "High" },
      cookie,
    )
  ).data;
  assert.equal(
    (await request("/workspace", "GET", undefined, cookie)).data
      .listingSnapshots.length,
    1,
  );
  app = (
    await request(
      `/records/application/${app.id}`,
      "PUT",
      {
        ...app,
        description: "Version two",
        descriptionCapturedDate: "2026-10-02",
        descriptionSourceUrl: "https://example.com/two",
      },
      cookie,
    )
  ).data;
  assert.equal(app.description, "Version two");
  const snapshots = (await request("/workspace", "GET", undefined, cookie)).data
    .listingSnapshots;
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].description, "Version one");
  assert.equal(snapshots[0].sourceUrl, "https://example.com/one");
  assert.equal(
    (
      await request(
        `/records/listing_snapshot/${snapshots[0].id}`,
        "PUT",
        { ...snapshots[0], description: "Tamper" },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (await request(`/events/${snapshots[0].id}`, "GET", undefined, other))
      .status,
    404,
  );
  assert.equal(
    (await request("/workspace", "GET", undefined, other)).data.listingSnapshots
      .length,
    0,
  );
  const legacy = await create(cookie, "application", {
    company: "Legacy",
    title: "Role",
    stage: "Saved",
  });
  await store.db
    .prepare("UPDATE records SET data=? WHERE id=?")
    .run(
      JSON.stringify({ ...legacy, description: "Legacy pasted text" }),
      legacy.id,
    );
  await request(
    `/records/application/${legacy.id}`,
    "PUT",
    {
      ...legacy,
      description: "New text",
      descriptionCapturedDate: "2026-10-20",
    },
    cookie,
  );
  const history = (
    await request("/workspace", "GET", undefined, cookie)
  ).data.listingSnapshots.filter((s) => s.applicationId === legacy.id);
  assert.equal(history.length, 2);
  assert.equal(history[0].capturedDate, "");
  assert.equal(history[0].sourceUrl, "");
  assert.equal(history[0].description, "Legacy pasted text");
});
test("submitted versions survive newer uploads, corrections and duplicate merge reversal", async (t) => {
  const { store, request, register, create } = await setup(t);
  const cookie = await register("usage-completion@example.com"),
    other = await register("usage-other@example.com");
  const app = await create(cookie, "application", {
    company: "UsageCo",
    title: "Engineer",
    stage: "Saved",
  });
  const duplicate = await create(cookie, "application", {
    company: "UsageCo",
    title: "Engineer",
    stage: "Saved",
  });
  const upload = async (marker) =>
    (
      await request(
        "/files",
        "POST",
        {
          name: "resume.pdf",
          body: Buffer.from(
            `%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n${marker}\n%%EOF`,
          ).toString("base64"),
        },
        cookie,
      )
    ).data;
  const file1 = await upload("first"),
    doc1 = await create(cookie, "document", {
      title: "Resume v1",
      fileId: file1.id,
      createdAt: "1900",
      versionNumber: 9,
    });
  assert.equal(doc1.versionNumber, 1);
  assert.notEqual(doc1.createdAt, "1900");
  const input = {
    applicationId: duplicate.id,
    documentVersionId: doc1.id,
    submittedDate: "2026-10-19",
    purpose: "Resume",
    fileId: "forged",
    documentHash: "forged",
  };
  const usage = await create(cookie, "document_usage", input);
  assert.equal(
    (await request("/records/document_usage", "POST", input, cookie)).data.id,
    usage.id,
  );
  assert.equal(
    (await request("/records/document_usage", "POST", input, other)).status,
    400,
  );
  const file2 = await upload("second"),
    doc2 = await create(cookie, "document", {
      title: "Resume v2",
      fileId: file2.id,
      documentId: doc1.id,
    });
  assert.equal(doc2.versionNumber, 2);
  const stored = (await request("/workspace", "GET", undefined, cookie)).data
    .documentUsages[0];
  assert.equal(stored.fileId, file1.id);
  assert.notEqual(stored.documentHash, "forged");
  assert.equal(stored.documentVersionNumber, 1);
  const args = { leftId: app.id, rightId: duplicate.id, targetId: app.id };
  const preview = (
    await request("/duplicates/merge-preview", "POST", args, cookie)
  ).data;
  assert.ok(preview.affected.some((r) => r.kind === "document_usage"));
  const review = (
    await request(
      "/duplicates/review",
      "POST",
      {
        ...args,
        leftVersion: 1,
        rightVersion: 1,
        decision: "merge",
        fingerprint: preview.fingerprint,
      },
      cookie,
    )
  ).data;
  assert.equal(
    (await request("/workspace", "GET", undefined, cookie)).data
      .documentUsages[0].applicationId,
    app.id,
  );
  assert.equal(
    (await request(`/duplicates/${review.id}/undo`, "POST", {}, cookie)).status,
    200,
  );
  let current = (await request("/workspace", "GET", undefined, cookie)).data
    .documentUsages[0];
  assert.equal(current.applicationId, duplicate.id);
  current = (
    await request(
      `/records/document_usage/${usage.id}`,
      "PUT",
      {
        ...current,
        documentVersionId: doc2.id,
        notes: "Correction after checking sent file",
      },
      cookie,
    )
  ).data;
  assert.equal(current.fileId, file2.id);
  const history = (
    await request(`/events/${usage.id}`, "GET", undefined, cookie)
  ).data;
  assert.ok(
    history.some(
      (e) => JSON.parse(e.before_data || "null")?.fileId === file1.id,
    ),
  );
  assert.ok(
    Buffer.from(
      (
        await store.db
          .prepare("SELECT body FROM files WHERE id=?")
          .get(file1.id)
      ).body,
    ).includes(Buffer.from("first")),
  );
  const retracted = (
    await request(
      `/records/document_usage/${usage.id}`,
      "PUT",
      { ...current, retracted: true },
      cookie,
    )
  ).data;
  assert.equal(retracted.retracted, true);
  assert.equal(
    (
      await request(
        `/records/document_usage/${usage.id}`,
        "PUT",
        { ...retracted, retracted: false },
        cookie,
      )
    ).data.retracted,
    false,
  );
  assert.equal(
    (
      await request(
        `/records/document_usage/${usage.id}`,
        "PUT",
        current,
        cookie,
      )
    ).status,
    409,
  );
  const exported = (await request("/export.json", "GET", undefined, cookie))
    .data;
  assert.ok(
    exported.records.some(
      (r) =>
        r.kind === "document_usage" && JSON.parse(r.data).fileId === file2.id,
    ),
  );
});
test("listing history quota failure rolls back the application and its event", async (t) => {
  const { store, register, create, request } = await setup(t);
  const cookie = await register("listing-quota@example.com");
  const app = await create(cookie, "application", {
    company: "Quota",
    title: "Engineer",
    stage: "Saved",
  });
  const user = (
    await store.db.prepare("SELECT user_id FROM records WHERE id=?").get(app.id)
  ).user_id;
  const count = (
    await store.db
      .prepare("SELECT count(*) n FROM events WHERE user_id=?")
      .get(user)
  ).n;
  await store.atomic(async () => {
    const insert = store.db.prepare("INSERT INTO events VALUES(?,?,?,?,?,?,?)");
    for (let i = count; i < 49999; i++)
      await insert.run(
        `quota-${i}`,
        user,
        app.id,
        "2026-10-20",
        null,
        "{}",
        "manual",
      );
  });
  const result = await request(
    `/records/application/${app.id}`,
    "PUT",
    {
      ...app,
      description: "Must roll back if snapshot cannot be stored",
    },
    cookie,
  );
  assert.equal(result.status, 413);
  assert.equal((await store.get(user, app.id)).version, app.version);
  assert.equal(
    JSON.parse((await store.get(user, app.id)).data).description,
    "",
  );
  assert.equal((await store.list(user, "listing_snapshot")).length, 0);
  assert.equal(
    (
      await store.db
        .prepare("SELECT count(*) n FROM events WHERE user_id=?")
        .get(user)
    ).n,
    49999,
  );
});
