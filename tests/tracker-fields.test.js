import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  applicationDetailsShape,
  validateApplicationDetails,
} from "../server/application-details.js";

const schema = z.object({
  ...applicationDetailsShape,
  description: z.string().default(""),
  stage: z.string().default("Applied"),
});
const parse = (data) => validateApplicationDetails(schema.parse(data));

test("legacy applications keep unknown offer and listing dates without inventing facts", () => {
  const data = parse({});
  assert.equal(data.offerOutcome, "Not recorded");
  assert.equal(data.offerReceivedDate, "");
  assert.equal(data.offerDecisionDate, "");
  assert.equal(data.descriptionCapturedDate, "");
});

test("offer decisions require truthful chronological dates independent of stage", () => {
  for (const offerOutcome of ["Accepted", "Declined"]) {
    assert.throws(() => parse({ offerOutcome }), /actual decision date/);
    assert.throws(
      () =>
        parse({
          offerOutcome,
          offerDecisionDate: "2026-10-19",
          offerReceivedDate: "2026-10-20",
        }),
      /cannot precede/,
    );
    assert.equal(
      parse({
        offerOutcome,
        offerDecisionDate: "2026-10-20",
        stage: "Custom stage",
      }).stage,
      "Custom stage",
    );
  }
  for (const offerOutcome of ["Not recorded", "Pending"]) {
    assert.throws(
      () => parse({ offerOutcome, offerDecisionDate: "2026-10-20" }),
      /Only accepted or declined/,
    );
  }
  assert.equal(
    parse({
      offerOutcome: "Accepted",
      offerDecisionDate: "2026-10-20",
      offerReceivedDate: "2026-10-20",
    }).offerOutcome,
    "Accepted",
  );
});

test("offer and listing date fields reject impossible dates", () => {
  for (const field of [
    "offerReceivedDate",
    "offerDecisionDate",
    "descriptionCapturedDate",
  ]) {
    for (const value of [
      "2026-02-29",
      "2026-04-31",
      "2026-13-01",
      "today",
      "2026-1-2",
    ]) {
      assert.equal(
        schema.safeParse({ [field]: value }).success,
        false,
        `${field}: ${value}`,
      );
    }
    assert.equal(schema.safeParse({ [field]: "2024-02-29" }).success, true);
  }
});

test("listing provenance requires saved text and safe bounded source URLs", () => {
  assert.throws(
    () => parse({ descriptionCapturedDate: "2026-10-20" }),
    /require a saved/,
  );
  assert.throws(
    () =>
      parse({
        description: "  ",
        descriptionSourceUrl: "https://example.com/job",
      }),
    /require a saved/,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///etc/passwd",
    "https://user:pass@example.com",
    `https://example.com/${"a".repeat(2050)}`,
  ]) {
    assert.equal(
      schema.safeParse({ descriptionSourceUrl: url }).success,
      false,
    );
  }
  const data = parse({
    description: "Engineering role",
    descriptionSourceUrl: "https://example.com/job",
    descriptionCapturedDate: "2026-10-20",
  });
  assert.equal(data.descriptionSourceUrl, "https://example.com/job");
});
