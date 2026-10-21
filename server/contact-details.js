import { z } from "zod";
const text = z.string().trim().max(200);
const source = z.enum([
  "Manual entry",
  "Email signature",
  "Introduction",
  "Other",
]);
const evidence = z.string().trim().max(2000).default("");
const provenanceEntry = z
  .object({
    source: source.default("Manual entry"),
    evidence,
    confirmed: z.boolean().default(false),
    confirmedValue: z.string().trim().max(20000).optional(),
    recordedAt: z.string().max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source !== "Manual entry" && !value.evidence)
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Describe the source evidence for extracted details",
      });
  });
export const contactProvenanceFields = [
  "name",
  "email",
  "company",
  "role",
  "agency",
  "hiringCompany",
  "relationshipType",
  "phone",
  "linkedinUrl",
  "lastInteraction",
  "notes",
];
const date = z
  .string()
  .refine(
    (value) =>
      !value ||
      (/^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value),
    "Use a valid calendar date",
  )
  .default("");
const linkedinUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return (
        parsed.protocol === "https:" &&
        !parsed.username &&
        !parsed.password &&
        (parsed.hostname === "linkedin.com" ||
          parsed.hostname.endsWith(".linkedin.com"))
      );
    } catch {
      return false;
    }
  }, "Use an HTTPS LinkedIn URL")
  .default("");
const extraEmail = z
  .object({
    email: z.email().max(254),
    confirmed: z.boolean().default(false),
    confirmedValue: z.string().trim().max(20000).optional(),
    source: source.default("Manual entry"),
    evidence,
    recordedAt: z.string().max(100).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source !== "Manual entry" && !value.evidence)
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "Describe the email source evidence",
      });
  });
export const contactSchema = z
  .object({
    name: text.min(1),
    email: z.union([z.literal(""), z.email().max(254)]).default(""),
    emailConfirmed: z.boolean().default(false),
    emailConfirmedValue: z.string().trim().max(254).optional(),
    company: text.default(""),
    role: text.default(""),
    agency: text.default(""),
    hiringCompany: text.default(""),
    relationshipType: z
      .enum([
        "Unknown",
        "Recruiter",
        "Hiring manager",
        "Interviewer",
        "Referral",
        "Other",
      ])
      .default("Unknown"),
    phone: z.string().trim().max(100).default(""),
    linkedinUrl,
    lastInteraction: date,
    notes: z.string().trim().max(10000).default(""),
    applicationIds: z.array(z.string().uuid()).max(100).default([]),
    additionalEmails: z.array(extraEmail).max(10).default([]),
    provenance: z
      .object(
        Object.fromEntries(
          contactProvenanceFields.map((key) => [
            key,
            provenanceEntry.optional(),
          ]),
        ),
      )
      .strict()
      .default({}),
  })
  .superRefine((value, ctx) => {
    const seen = new Set(value.email ? [value.email.toLowerCase()] : []);
    value.additionalEmails.forEach((entry, index) => {
      const email = entry.email.toLowerCase();
      if (seen.has(email))
        ctx.addIssue({
          code: "custom",
          path: ["additionalEmails", index, "email"],
          message: "Email addresses must be unique",
        });
      seen.add(email);
    });
  });
// The server owns timestamps; provenance never establishes identity implicitly.
export function normalizeContact(
  data,
  previous = {},
  now = new Date().toISOString(),
) {
  const result = { ...data, provenance: {} };
  result.emailConfirmed =
    !!data.email &&
    data.emailConfirmed === true &&
    (previous.email === undefined ||
      previous.email === data.email ||
      data.emailConfirmedValue === data.email);
  delete result.emailConfirmedValue;
  for (const key of contactProvenanceFields) {
    if (!data[key] || (key === "relationshipType" && data[key] === "Unknown"))
      continue;
    const entry = {
      ...(data.provenance?.[key] || {
        source: "Manual entry",
        evidence: "",
        confirmed: false,
      }),
    };
    if (
      previous[key] !== undefined &&
      previous[key] !== data[key] &&
      entry.confirmedValue !== data[key]
    )
      entry.confirmed = false;
    if (key === "email") entry.confirmed = result.emailConfirmed;
    const old = previous.provenance?.[key];
    if (
      previous[key] !== undefined &&
      previous[key] !== data[key] &&
      old?.source === entry.source &&
      old?.evidence === entry.evidence
    ) {
      entry.source = "Manual entry";
      entry.evidence = "";
    }
    const unchanged =
      previous[key] === data[key] &&
      old?.source === entry.source &&
      old?.evidence === entry.evidence &&
      old?.confirmed === entry.confirmed;
    result.provenance[key] = {
      source: entry.source,
      evidence: entry.evidence,
      confirmed: entry.confirmed,
      recordedAt: unchanged && old.recordedAt ? old.recordedAt : now,
    };
  }
  result.additionalEmails = (data.additionalEmails || []).map((entry) => {
    const old = previous.additionalEmails?.find(
      (item) => item.email === entry.email,
    );
    const normalized = { ...entry };
    if (
      !old &&
      previous.additionalEmails?.length &&
      entry.confirmedValue !== entry.email
    )
      normalized.confirmed = false;
    delete normalized.confirmedValue;
    const unchanged =
      old &&
      old.source === entry.source &&
      old.evidence === entry.evidence &&
      old.confirmed === normalized.confirmed;
    return {
      ...normalized,
      recordedAt: unchanged && old.recordedAt ? old.recordedAt : now,
    };
  });
  return result;
}
