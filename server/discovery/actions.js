// Per-user discovery state: saved, dismissed (with feedback), watchlist and
// saved searches. Every statement is scoped by user id, and the target job or
// company must exist. Operations are idempotent.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { HttpError } from "../security.js";
import { filterSchema } from "./feed.js";
export const DISMISS_REASONS = [
  "not_relevant",
  "wrong_seniority",
  "wrong_location",
  "company",
  "compensation",
  "already_seen",
  "other",
];
const iso = () => new Date().toISOString();
async function requireJob(store, jobId) {
  const job = await store.db
    .prepare("SELECT id FROM discovery_jobs WHERE id=?")
    .get(jobId);
  if (!job) throw new HttpError(404, "Job not found");
}
async function upsertState(store, userId, jobId, patch) {
  await requireJob(store, jobId);
  await store.atomic(async () => {
    const row = await store.db
      .prepare("SELECT * FROM discovery_user_jobs WHERE user_id=? AND job_id=?")
      .get(userId, jobId);
    const next = {
      saved_at: row?.saved_at ?? null,
      dismissed_at: row?.dismissed_at ?? null,
      dismiss_reason: row?.dismiss_reason ?? "",
      ...patch,
    };
    await store.db
      .prepare(
        "INSERT INTO discovery_user_jobs(user_id,job_id,saved_at,dismissed_at,dismiss_reason) VALUES(?,?,?,?,?) ON CONFLICT(user_id,job_id) DO UPDATE SET saved_at=excluded.saved_at,dismissed_at=excluded.dismissed_at,dismiss_reason=excluded.dismiss_reason",
      )
      .run(
        userId,
        jobId,
        next.saved_at,
        next.dismissed_at,
        next.dismiss_reason,
      );
  });
}
export const saveJob = async (store, userId, jobId) => {
  const row = await store.db
    .prepare(
      "SELECT saved_at FROM discovery_user_jobs WHERE user_id=? AND job_id=?",
    )
    .get(userId, jobId);
  // Re-saving keeps the original timestamp; saving also clears a dismissal.
  await upsertState(store, userId, jobId, {
    saved_at: row?.saved_at || iso(),
    dismissed_at: null,
    dismiss_reason: "",
  });
};
export const unsaveJob = (store, userId, jobId) =>
  upsertState(store, userId, jobId, { saved_at: null });
export const dismissJob = async (store, userId, jobId, reason) => {
  if (!DISMISS_REASONS.includes(reason))
    throw new HttpError(400, "Choose a listed reason");
  const row = await store.db
    .prepare(
      "SELECT dismissed_at FROM discovery_user_jobs WHERE user_id=? AND job_id=?",
    )
    .get(userId, jobId);
  await upsertState(store, userId, jobId, {
    dismissed_at: row?.dismissed_at || iso(),
    dismiss_reason: reason,
    saved_at: null,
  });
};
export const restoreJob = (store, userId, jobId) =>
  upsertState(store, userId, jobId, { dismissed_at: null, dismiss_reason: "" });
export async function setWatch(store, userId, companyId, watched) {
  const company = await store.db
    .prepare("SELECT id FROM discovery_companies WHERE id=?")
    .get(companyId);
  if (!company) throw new HttpError(404, "Company not found");
  if (watched)
    await store.db
      .prepare(
        "INSERT INTO discovery_watchlist(user_id,company_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      )
      .run(userId, companyId, iso());
  else
    await store.db
      .prepare(
        "DELETE FROM discovery_watchlist WHERE user_id=? AND company_id=?",
      )
      .run(userId, companyId);
}
export const searchSchema = z
  .object({ name: z.string().trim().min(1).max(80), filters: filterSchema })
  .strict();
const MAX_SEARCHES = 25;
const searchView = (r) => ({
  id: r.id,
  name: r.name,
  filters: JSON.parse(r.filters),
  updatedAt: r.updated_at,
});
export async function listSearches(store, userId) {
  return (
    await store.db
      .prepare(
        "SELECT * FROM discovery_saved_searches WHERE user_id=? ORDER BY created_at,id",
      )
      .all(userId)
  ).map(searchView);
}
export async function createSearch(store, userId, input) {
  const v = searchSchema.parse(input);
  return store.atomic(async () => {
    const count = await store.db
      .prepare(
        "SELECT COUNT(*) AS n FROM discovery_saved_searches WHERE user_id=?",
      )
      .get(userId);
    if (Number(count.n) >= MAX_SEARCHES)
      throw new HttpError(
        413,
        `Limit of ${MAX_SEARCHES} saved searches reached`,
      );
    const id = randomUUID(),
      now = iso();
    await store.db
      .prepare(
        "INSERT INTO discovery_saved_searches(id,user_id,name,filters,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
      .run(id, userId, v.name, JSON.stringify(v.filters), now, now);
    return searchView(
      await store.db
        .prepare(
          "SELECT * FROM discovery_saved_searches WHERE id=? AND user_id=?",
        )
        .get(id, userId),
    );
  });
}
export async function updateSearch(store, userId, id, input) {
  const v = searchSchema.parse(input);
  const result = await store.db
    .prepare(
      "UPDATE discovery_saved_searches SET name=?,filters=?,updated_at=? WHERE id=? AND user_id=?",
    )
    .run(v.name, JSON.stringify(v.filters), iso(), id, userId);
  if (!result.changes) throw new HttpError(404, "Saved search not found");
}
export async function deleteSearch(store, userId, id) {
  await store.db
    .prepare("DELETE FROM discovery_saved_searches WHERE id=? AND user_id=?")
    .run(id, userId);
}
