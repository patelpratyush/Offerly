import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./security.js";

export const AI_CONSENT_VERSION = "2026-11-05-v1";
export const AI_CONSENT_TEXT =
  "Allow Offerly to send minimized recruiting email excerpts to OpenAI for review suggestions. Provider abuse-monitoring logs may retain submitted content for up to 30 days, or longer when required for legal or safety reasons. Suggestions never change application fields without your acceptance. You can withdraw consent at any time; withdrawal stops future requests but cannot recall content already submitted.";
const consentSchema = z
  .object({ consent: z.boolean(), version: z.string().max(100).optional() })
  .strict();
function integer(value, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new HttpError(503, "AI budget configuration is invalid");
  return result;
}
function denied(status, message) {
  return Object.assign(new HttpError(status, message), {
    code: "AI_POLICY_DENIED",
  });
}
function config(options = {}) {
  const result = {
    enabled: options.enabled ?? process.env.RECRUITING_AI_ENABLED === "true",
    qualityApproved:
      options.qualityApproved ??
      process.env.RECRUITING_AI_QUALITY_APPROVED === "true",
    qualityEvidenceVersion: String(
      options.qualityEvidenceVersion ??
        process.env.RECRUITING_AI_EVIDENCE_VERSION ??
        "",
    ).slice(0, 200),
    projectDailyRequestLimit: integer(
      options.projectDailyRequestLimit ??
        process.env.RECRUITING_AI_PROJECT_DAILY_REQUEST_LIMIT,
      100,
      1,
      10000,
    ),
    projectDailySpendLimitMicroDollars: integer(
      options.projectDailySpendLimitMicroDollars ??
        process.env.RECRUITING_AI_PROJECT_DAILY_SPEND_MICRODOLLARS,
      1000000,
      1,
      100000000,
    ),
    dailyRequestLimit: integer(
      options.dailyRequestLimit ??
        process.env.RECRUITING_AI_DAILY_REQUEST_LIMIT,
      20,
      1,
      1000,
    ),
    dailySpendLimitMicroDollars: integer(
      options.dailySpendLimitMicroDollars ??
        process.env.RECRUITING_AI_DAILY_SPEND_MICRODOLLARS,
      200000,
      1,
      100000000,
    ),
    reservationMicroDollars: integer(
      options.reservationMicroDollars ??
        process.env.RECRUITING_AI_RESERVATION_MICRODOLLARS,
      10000,
      1,
      10000000,
    ),
    maxInputCharacters: integer(
      options.maxInputCharacters ??
        process.env.RECRUITING_AI_MAX_INPUT_CHARACTERS,
      12000,
      1,
      50000,
    ),
    maxOutputTokens: integer(
      options.maxOutputTokens ?? process.env.RECRUITING_AI_MAX_OUTPUT_TOKENS,
      512,
      1,
      2048,
    ),
  };
  if (result.reservationMicroDollars > result.dailySpendLimitMicroDollars)
    throw new HttpError(503, "AI reservation exceeds daily budget");
  return result;
}
export async function initializeAiPolicy(store) {
  if (store.db.hosted) return;
  await store.db
    .exec(`CREATE TABLE IF NOT EXISTS recruiting_ai_consent(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,version TEXT NOT NULL,generation TEXT NOT NULL,accepted_at BIGINT NOT NULL,withdrawn_at BIGINT NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS recruiting_ai_budget(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,requests BIGINT NOT NULL,reserved_microdollars BIGINT NOT NULL,PRIMARY KEY(user_id,day));
    CREATE TABLE IF NOT EXISTS recruiting_ai_reservations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,day TEXT NOT NULL,reserved_microdollars BIGINT NOT NULL,created_at BIGINT NOT NULL,consent_generation TEXT NOT NULL,evidence_version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS recruiting_ai_project_budget(day TEXT PRIMARY KEY,requests BIGINT NOT NULL,reserved_microdollars BIGINT NOT NULL);`);
}
function time(options) {
  const now = options.now ?? Date.now();
  if (!Number.isSafeInteger(now) || now < 0)
    throw new HttpError(503, "Invalid AI policy time");
  return { now, day: new Date(now).toISOString().slice(0, 10) };
}
export async function aiPolicy(store, userId, options = {}) {
  const settings = config(options),
    { day } = time(options);
  const consent = await store.db
    .prepare(
      "SELECT version,generation,withdrawn_at FROM recruiting_ai_consent WHERE user_id=?",
    )
    .get(userId);
  const budget = await store.db
    .prepare(
      "SELECT requests,reserved_microdollars FROM recruiting_ai_budget WHERE user_id=? AND day=?",
    )
    .get(userId, day);
  const project = await store.db
    .prepare(
      "SELECT requests,reserved_microdollars FROM recruiting_ai_project_budget WHERE day=?",
    )
    .get(day);
  const projectRequestsUsed = Number(project?.requests || 0),
    projectReservedMicroDollars = Number(project?.reserved_microdollars || 0);
  const consented =
    consent?.version === AI_CONSENT_VERSION &&
    Number(consent.withdrawn_at) === 0;
  const requestsUsed = Number(budget?.requests || 0),
    reservedMicroDollars = Number(budget?.reserved_microdollars || 0);
  return {
    ...settings,
    consented,
    consentVersion: consent?.version || null,
    consentGeneration: consent?.generation || null,
    projectRequestsUsed,
    projectReservedMicroDollars,
    requiredConsentVersion: AI_CONSENT_VERSION,
    consentText: AI_CONSENT_TEXT,
    requestsUsed,
    reservedMicroDollars,
    budgetDay: day,
    available:
      settings.enabled &&
      settings.qualityApproved &&
      !!settings.qualityEvidenceVersion.trim() &&
      projectRequestsUsed < settings.projectDailyRequestLimit &&
      projectReservedMicroDollars + settings.reservationMicroDollars <=
        settings.projectDailySpendLimitMicroDollars &&
      consented &&
      requestsUsed < settings.dailyRequestLimit &&
      reservedMicroDollars + settings.reservationMicroDollars <=
        settings.dailySpendLimitMicroDollars,
    automaticStageUpdates: false,
  };
}
export async function reserveAiRequest(store, userId, options = {}) {
  const settings = config(options),
    { now, day } = time(options);
  // Caller must price its fixed model and bounded payload pessimistically before
  // attempting a reservation. Reserving never authorizes an unbounded request.
  const estimate = options.estimatedMicroDollars;
  if (
    !Number.isSafeInteger(estimate) ||
    estimate < 1 ||
    estimate > settings.reservationMicroDollars
  )
    throw new HttpError(
      400,
      "AI request estimate exceeds reservation or is missing",
    );
  return store.atomic(async () => {
    const policy = await aiPolicy(store, userId, options);
    if (
      !policy.enabled ||
      !policy.qualityApproved ||
      !policy.qualityEvidenceVersion.trim()
    )
      throw denied(
        403,
        "AI extraction remains disabled pending quality approval",
      );
    if (!policy.consented)
      throw denied(403, "Explicit AI data-processing consent is required");
    if (!policy.available)
      throw denied(429, "Daily AI request or spend budget reached");
    const reservationId = randomUUID();
    await store.db
      .prepare(
        "INSERT INTO recruiting_ai_project_budget(day,requests,reserved_microdollars) VALUES(?,1,?) ON CONFLICT(day) DO UPDATE SET requests=recruiting_ai_project_budget.requests+1,reserved_microdollars=recruiting_ai_project_budget.reserved_microdollars+excluded.reserved_microdollars",
      )
      .run(day, settings.reservationMicroDollars);
    await store.db
      .prepare(
        "INSERT INTO recruiting_ai_budget(user_id,day,requests,reserved_microdollars) VALUES(?,?,1,?) ON CONFLICT(user_id,day) DO UPDATE SET requests=recruiting_ai_budget.requests+1,reserved_microdollars=recruiting_ai_budget.reserved_microdollars+excluded.reserved_microdollars",
      )
      .run(userId, day, settings.reservationMicroDollars);
    await store.db
      .prepare(
        "INSERT INTO recruiting_ai_reservations(id,user_id,day,reserved_microdollars,created_at,consent_generation,evidence_version) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        reservationId,
        userId,
        day,
        settings.reservationMicroDollars,
        now,
        policy.consentGeneration,
        policy.qualityEvidenceVersion,
      );
    // Never refund timed-out/ambiguous provider calls: they may have been billed.
    return {
      reservationId,
      consentVersion: policy.consentVersion,
      consentGeneration: policy.consentGeneration,
      qualityEvidenceVersion: policy.qualityEvidenceVersion,
      maxInputCharacters: settings.maxInputCharacters,
      maxOutputTokens: settings.maxOutputTokens,
      reservedMicroDollars: settings.reservationMicroDollars,
    };
  });
}
export function mountAiPolicy(app, store, options = {}) {
  app.get("/api/recruiting/ai-policy", async (req, res) =>
    res.json(await aiPolicy(store, req.user.id, options)),
  );
  app.post("/api/recruiting/ai-policy", async (req, res) => {
    const input = consentSchema.parse(req.body),
      { now } = time(options);
    if (input.consent && input.version !== AI_CONSENT_VERSION)
      throw new HttpError(409, "Read and accept the current AI consent policy");
    await store.atomic(async () => {
      if (input.consent)
        await store.db
          .prepare(
            "INSERT INTO recruiting_ai_consent(user_id,version,generation,accepted_at,withdrawn_at) VALUES(?,?,?,?,0) ON CONFLICT(user_id) DO UPDATE SET version=excluded.version,generation=excluded.generation,accepted_at=excluded.accepted_at,withdrawn_at=0",
          )
          .run(req.user.id, AI_CONSENT_VERSION, randomUUID(), now);
      else await revokeAiConsent(store, req.user.id, options);
    });
    res.json(await aiPolicy(store, req.user.id, options));
  });
}

export async function revokeAiConsent(store, userId, options = {}) {
  const { now } = time(options);
  await store.db
    .prepare(
      "UPDATE recruiting_ai_consent SET withdrawn_at=?,generation=? WHERE user_id=?",
    )
    .run(now || 1, randomUUID(), userId);
}
export async function validateAiReservation(
  store,
  userId,
  reservation,
  options = {},
) {
  const policy = await aiPolicy(store, userId, options);
  const row = await store.db
    .prepare(
      "SELECT * FROM recruiting_ai_reservations WHERE id=? AND user_id=?",
    )
    .get(reservation.reservationId, userId);
  if (
    !row ||
    !policy.enabled ||
    !policy.qualityApproved ||
    !policy.consented ||
    !policy.qualityEvidenceVersion.trim() ||
    row.consent_generation !== policy.consentGeneration ||
    row.evidence_version !== policy.qualityEvidenceVersion
  )
    throw denied(403, "AI authorization changed; discard this result");
  return true;
}
