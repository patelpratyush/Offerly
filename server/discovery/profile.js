// Candidate profile: user-approved facts, kept separate from eligibility answers
// and preferences. Only approved facts are ever used for scoring.
import { z } from "zod";
import { HttpError } from "../security.js";
const short = (max) => z.string().trim().min(1).max(max);
export const LEVELS = [
  "intern",
  "junior",
  "mid",
  "senior",
  "staff",
  "principal",
  "manager",
  "director",
];
const answer = z.enum(["yes", "no", "unknown"]).default("unknown");
export const profileSchema = z
  .object({
    facts: z
      .object({
        targetRoles: z.array(short(80)).max(20).default([]),
        seniority: z.union([z.literal(""), z.enum(LEVELS)]).default(""),
        yearsExperience: z
          .number()
          .int()
          .min(0)
          .max(60)
          .nullable()
          .default(null),
        skills: z
          .array(z.object({ name: short(60), approved: z.boolean() }).strict())
          .max(100)
          .default([]),
        experienceTerms: z.array(short(60)).max(50).default([]),
      })
      .strict(),
    // Answers about the person, not skills. Never inferred from facts.
    eligibility: z
      .object({
        workAuthorization: z
          .record(z.string().regex(/^[A-Z]{2}$/), answer)
          .default({}),
        needsSponsorship: answer,
        usCitizen: answer,
        securityClearance: z
          .enum(["active", "none", "unknown"])
          .default("unknown"),
        graduationYear: z
          .number()
          .int()
          .min(1950)
          .max(2100)
          .nullable()
          .default(null),
      })
      .strict()
      .default({
        workAuthorization: {},
        needsSponsorship: "unknown",
        usCitizen: "unknown",
        securityClearance: "unknown",
        graduationYear: null,
      }),
    preferences: z
      .object({
        locations: z.array(short(80)).max(20).default([]),
        arrangements: z
          .array(z.enum(["Remote", "Hybrid", "On-site"]))
          .max(3)
          .default([]),
        salaryMin: z
          .number()
          .int()
          .min(0)
          .max(100000000)
          .nullable()
          .default(null),
        salaryCurrency: z
          .union([z.literal(""), z.string().regex(/^[A-Z]{3}$/)])
          .default(""),
        salaryBasis: z.enum(["Base", "Total"]).default("Base"),
      })
      .strict()
      .default({
        locations: [],
        arrangements: [],
        salaryMin: null,
        salaryCurrency: "",
        salaryBasis: "Base",
      }),
  })
  .strict();
const emptyProfile = () => profileSchema.parse({ facts: {} });
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};
export async function getProfile(store, userId) {
  const row = await store.db
    .prepare("SELECT * FROM discovery_profiles WHERE user_id=?")
    .get(userId);
  if (!row)
    return { ...emptyProfile(), version: 0, approvedAt: "", approved: false };
  const parsed = profileSchema.safeParse({
    facts: parseJson(row.facts),
    eligibility: parseJson(row.eligibility),
    preferences: parseJson(row.preferences),
  });
  return {
    ...(parsed.success ? parsed.data : emptyProfile()),
    version: row.version,
    approvedAt: row.approved_at,
    approved: !!row.approved_at,
  };
}
/** Approval is explicit; unchanged resubmission is a no-op (idempotent). */
export async function saveProfile(store, userId, input, now = new Date()) {
  const value = profileSchema.parse(input);
  return store.atomic(async () => {
    const current = await getProfile(store, userId);
    const same =
      current.approved &&
      JSON.stringify([
        current.facts,
        current.eligibility,
        current.preferences,
      ]) ===
        JSON.stringify([value.facts, value.eligibility, value.preferences]);
    if (same) return current;
    const stamp = now.toISOString();
    const version = current.version + 1;
    await store.db
      .prepare(
        "INSERT INTO discovery_profiles(user_id,facts,eligibility,preferences,version,approved_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET facts=excluded.facts,eligibility=excluded.eligibility,preferences=excluded.preferences,version=excluded.version,approved_at=excluded.approved_at,updated_at=excluded.updated_at",
      )
      .run(
        userId,
        JSON.stringify(value.facts),
        JSON.stringify(value.eligibility),
        JSON.stringify(value.preferences),
        version,
        stamp,
        stamp,
      );
    return { ...value, version, approvedAt: stamp, approved: true };
  });
}
export function requireApproved(profile) {
  if (!profile.approved)
    throw new HttpError(409, "Approve your candidate profile first");
}
