import test from "node:test";
import assert from "node:assert/strict";
import { guardApplicationLink } from "../server/integrations/recruiting-match-guard.js";

const applications = [
  {
    id: "a",
    company: "Lumen Orchard",
    title: "Engineer I",
    requisition: "BE-1",
  },
  {
    id: "b",
    company: "Lumen Orchard",
    title: "Engineer II",
    requisition: "BE-10",
  },
];
const check = (body, id = "a", subject = "") =>
  guardApplicationLink({ subject, body, applications }, id);
test("retains an exact company and full title, including normalized text", () => {
  assert.equal(
    check("Your application at LUMEN  ORCHARD for Engineer I is received.")
      .applicationId,
    "a",
  );
});
test("abstains for ambiguous same-company roles and contradictory requisitions", () => {
  assert.equal(
    check("Lumen Orchard: Engineer I and Engineer II applications.")
      .applicationId,
    null,
  );
  assert.equal(
    check("Lumen Orchard application BE-1 and BE-10.").applicationId,
    null,
  );
});
test("unique requisition outranks contextual role mentions", () => {
  assert.deepEqual(
    check(
      "Lumen Orchard application BE-1. Discuss Engineer I and Engineer II.",
    ),
    { applicationId: "a", reason: "explicit_requisition" },
  );
});
test("never redirects a proposed application", () => {
  assert.equal(check("Lumen Orchard application BE-10.").applicationId, null);
  assert.equal(
    check("Lumen Orchard application BE-1.", "unknown").reason,
    "unknown_application",
  );
  assert.deepEqual(check("Lumen Orchard application BE-1.", null), {
    applicationId: null,
    reason: "no_proposal",
  });
});
test("requires complete identifiers and titles with namespace boundaries", () => {
  for (const body of [
    "Lumen Orchard application BE-1-2.",
    "Lumen Orchard application XBE-1.",
    "Lumen Orchard application BE-100.",
    "Lumen Orchard application Engineer II.",
  ]) {
    assert.equal(check(body).applicationId, null, body);
  }
});
test("ignores quoted lines and common reply and forward history", () => {
  for (const body of [
    "Thanks.\n> Lumen Orchard application BE-1.",
    "Thanks.\nOn Tuesday, Pat wrote:\nLumen Orchard application BE-1.",
    "Thanks.\n---------- Forwarded message ---------\nLumen Orchard application BE-1.",
    "Thanks.\nFrom: Pat\nSent: Tuesday\nSubject: Lumen Orchard application BE-1.",
  ]) {
    assert.equal(check(body).applicationId, null, body);
  }
  assert.equal(
    check("From: Lumen Orchard recruiting\nYour application BE-1 has arrived.")
      .applicationId,
    "a",
  );
});
test("ignores a wrapped reply header within four lines", () => {
  assert.equal(
    check(
      "Thanks.\nOn Tuesday, October 22,\nPat wrote:\nLumen Orchard application BE-1.",
    ).applicationId,
    null,
  );
});
test("subject may establish application identity", () => {
  assert.equal(
    check("Thanks for replying.", "a", "Lumen Orchard — Engineer I application")
      .applicationId,
    "a",
  );
});
test("rejects newsletters and generic outreach without individual application identity", () => {
  assert.equal(
    check("Lumen Orchard newsletter: Engineer I. Unsubscribe here.")
      .applicationId,
    null,
  );
  assert.equal(
    check("Lumen Orchard is reaching out about an opportunity for Engineer I.")
      .applicationId,
    null,
  );
  assert.equal(
    check(
      "Your application to Lumen Orchard BE-1 is received. Unsubscribe from updates.",
    ).applicationId,
    "a",
  );
});
test("fails closed on malformed and oversized input", () => {
  for (const input of [
    null,
    {},
    { subject: "", body: "", applications: {} },
    { subject: "", body: "x".repeat(100001), applications },
    {
      subject: "",
      body: "",
      applications: [{ id: "a", company: 4, title: "Engineer" }],
    },
  ]) {
    assert.deepEqual(guardApplicationLink(input, "a"), {
      applicationId: null,
      reason: "invalid_input",
    });
  }
});
