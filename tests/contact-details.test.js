import test from "node:test";
import assert from "node:assert/strict";
import { contactSchema, normalizeContact } from "../server/contact-details.js";
const first = "2026-01-01T00:00:00.000Z";
const later = "2026-01-02T00:00:00.000Z";
test("contact provenance is server stamped, preserved only for unchanged evidence, removed for empty values", () => {
  const initial = normalizeContact(
    contactSchema.parse({
      name: "Ada",
      company: "Example",
      provenance: {
        company: {
          source: "Email signature",
          evidence: "Signature in scheduling message",
          recordedAt: "forged",
        },
      },
    }),
    {},
    first,
  );
  assert.equal(initial.provenance.company.recordedAt, first);
  assert.equal(initial.provenance.company.confirmed, false);
  const unchanged = normalizeContact(
    contactSchema.parse(initial),
    initial,
    later,
  );
  assert.equal(unchanged.provenance.company.recordedAt, first);
  const changed = normalizeContact(
    contactSchema.parse({ ...initial, company: "New company" }),
    initial,
    later,
  );
  assert.equal(changed.provenance.company.recordedAt, later);
  const cleared = normalizeContact(
    contactSchema.parse({ ...initial, company: "" }),
    initial,
    later,
  );
  assert.equal(cleared.provenance.company, undefined);
  const evidence = normalizeContact(
    contactSchema.parse({
      ...initial,
      provenance: {
        company: { ...initial.provenance.company, evidence: "New message" },
      },
    }),
    initial,
    later,
  );
  assert.equal(evidence.provenance.company.recordedAt, later);
});
test("changed contact values cannot inherit identity confirmation", () => {
  const initial = normalizeContact(
    contactSchema.parse({
      name: "Ada",
      email: "ada@example.com",
      emailConfirmed: true,
      provenance: { name: { source: "Manual entry", confirmed: true } },
    }),
    {},
    first,
  );
  assert.equal(initial.emailConfirmed, true);
  const changed = normalizeContact(
    contactSchema.parse({
      ...initial,
      name: "Grace",
      email: "grace@example.com",
    }),
    initial,
    later,
  );
  assert.equal(changed.emailConfirmed, false);
  assert.equal(changed.provenance.email.confirmed, false);
  assert.equal(changed.provenance.name.confirmed, false);
  const confirmed = normalizeContact(
    contactSchema.parse({
      ...initial,
      email: "grace@example.com",
      emailConfirmedValue: "grace@example.com",
    }),
    initial,
    later,
  );
  assert.equal(confirmed.emailConfirmed, true);
  assert.equal(confirmed.emailConfirmedValue, undefined);
});
test("contact details validate dates, sources, URLs, email identities and provenance keys", () => {
  for (const invalid of [
    { lastInteraction: "2026-02-30" },
    { linkedinUrl: "javascript:alert(1)" },
    { linkedinUrl: "https://linkedin.com.evil.test/person" },
    { linkedinUrl: "https://user:pass@linkedin.com/in/person" },
    {
      email: "ada@example.com",
      additionalEmails: [{ email: "ADA@example.com" }],
    },
    { provenance: { company: { source: "Email signature" } } },
    { provenance: { password: { source: "Manual entry" } } },
    { additionalEmails: [{ email: "ada@example.com", confirmed: "true" }] },
  ])
    assert.equal(
      contactSchema.safeParse({ name: "Ada", ...invalid }).success,
      false,
    );
  const valid = contactSchema.parse({
    name: "Ada",
    lastInteraction: "2024-02-29",
    linkedinUrl: "https://www.linkedin.com/in/ada",
    additionalEmails: [
      {
        email: "ada@example.com",
        source: "Introduction",
        evidence: "Introduced in team email",
      },
    ],
  });
  assert.equal(valid.additionalEmails[0].confirmed, false);
  assert.equal(valid.emailConfirmed, false);
});
test("additional email edits require fresh confirmation and server-owned timestamps", () => {
  const initial = normalizeContact(
    contactSchema.parse({
      name: "Ada",
      additionalEmails: [{ email: "ada@example.com", confirmed: true }],
    }),
    {},
    first,
  );
  const changed = normalizeContact(
    contactSchema.parse({
      ...initial,
      additionalEmails: [
        {
          ...initial.additionalEmails[0],
          email: "grace@example.com",
          recordedAt: "forged",
        },
      ],
    }),
    initial,
    later,
  );
  assert.equal(changed.additionalEmails[0].confirmed, false);
  assert.equal(changed.additionalEmails[0].recordedAt, later);
  const confirmed = normalizeContact(
    contactSchema.parse({
      ...initial,
      additionalEmails: [
        {
          ...initial.additionalEmails[0],
          email: "grace@example.com",
          confirmedValue: "grace@example.com",
        },
      ],
    }),
    initial,
    later,
  );
  assert.equal(confirmed.additionalEmails[0].confirmed, true);
  assert.equal(confirmed.additionalEmails[0].confirmedValue, undefined);
});
test("changing a field drops carried evidence but accepts newly supplied provenance", () => {
  const initial = normalizeContact(
    contactSchema.parse({
      name: "Ada",
      company: "Original",
      provenance: {
        company: {
          source: "Email signature",
          evidence: "Original signature",
          confirmed: true,
        },
      },
    }),
    {},
    first,
  );
  const stale = normalizeContact(
    contactSchema.parse({ ...initial, company: "Changed" }),
    initial,
    later,
  );
  assert.deepEqual(stale.provenance.company, {
    source: "Manual entry",
    evidence: "",
    confirmed: false,
    recordedAt: later,
  });
  const updated = normalizeContact(
    contactSchema.parse({
      ...initial,
      company: "Changed",
      provenance: {
        company: {
          source: "Email signature",
          evidence: "New signature",
          confirmed: false,
        },
      },
    }),
    initial,
    later,
  );
  assert.deepEqual(updated.provenance.company, {
    source: "Email signature",
    evidence: "New signature",
    confirmed: false,
    recordedAt: later,
  });
});
test("contact field limits and trimmed confirmation proofs are enforced", () => {
  for (const field of ["name", "company", "role", "agency", "hiringCompany"]) {
    assert.equal(
      contactSchema.safeParse({ name: "Ada", [field]: "x".repeat(201) })
        .success,
      false,
    );
  }
  assert.equal(
    contactSchema.safeParse({ name: "Ada", notes: "x".repeat(10001) }).success,
    false,
  );
  const before = normalizeContact(
    contactSchema.parse({ name: "Ada", company: "Original" }),
    {},
    first,
  );
  const after = normalizeContact(
    contactSchema.parse({
      ...before,
      company: " New company ",
      provenance: {
        company: {
          source: "Manual entry",
          confirmed: true,
          confirmedValue: " New company ",
        },
      },
    }),
    before,
    later,
  );
  assert.equal(after.company, "New company");
  assert.equal(after.provenance.company.confirmed, true);
});
