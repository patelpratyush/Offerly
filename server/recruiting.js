import { mapAsync as _mapAsync } from "./async.js";
import { z } from "zod";
import { createHash } from "node:crypto";
import { HttpError } from "./security.js";
const changesSchema = z
  .object({
    stage: z.string().trim().min(1).max(100).optional(),
    owner: z.enum(["You", "Employer", "Nobody", "Unclear"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Propose at least one change");
const safeUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const u = new URL(value);
      return (
        ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
      );
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS URL without credentials")
  .default("");
const evidenceSchema = z
  .object({
    operationId: z.uuid(),
    sourceId: z.string().trim().min(1).max(200),
    excerpt: z.string().trim().min(1).max(10000),
    sourceUrl: safeUrl,
    effectiveAt: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString()),
    company: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    requisition: z.string().trim().max(200).default(""),
    applicationId: z.uuid().optional(),
    changes: changesSchema,
  })
  .strict();
const decisionSchema = z
  .object({
    operationId: z.uuid(),
    version: z.number().int().positive(),
    decision: z.enum(["accept", "reject", "correct"]),
    applicationId: z.uuid().optional(),
    changes: changesSchema.optional(),
    applicationVersion: z.number().int().positive().optional(),
    override: z.boolean().default(false),
  })
  .strict();
const actionSchema = z
  .object({ operationId: z.uuid(), version: z.number().int().positive() })
  .strict();
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function record(store, user, id, kind) {
  const row = await store.get(user, id);
  if (!row || row.kind !== kind) throw new HttpError(404, "Record not found");
  return { ...JSON.parse(row.data), id: row.id, version: row.version };
}
function dataOf(value) {
  const data = { ...value };
  delete data.id;
  delete data.version;
  return data;
}
async function save(store, user, kind, data, old, actor = "recruiting") {
  return await store.save(user, kind, data, old?.id, old?.version, actor);
}
async function receipt(store, user, operationId) {
  return (await store.list(user, "recruiting_operation")).find(
    (r) => r.operationId === operationId,
  );
}
async function operation(store, user, scope, input, fn) {
  return await store.atomic(async () => {
    const fingerprint = hash({ scope, input });
    const old = await receipt(store, user, input.operationId);
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new HttpError(
          409,
          "Operation ID was already used with different data",
        );
      return old.result;
    }
    const result = await fn();
    await save(store, user, "recruiting_operation", {
      operationId: input.operationId,
      fingerprint,
      result,
    });
    return result;
  });
}
const norm = (value) =>
  (value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
async function match(store, user, evidence) {
  const apps = (await store.list(user, "application")).filter(
    (a) => !a.archived,
  );
  if (evidence.applicationId) {
    const a = apps.find((a) => a.id === evidence.applicationId);
    return {
      candidateApplicationIds: a ? [a.id] : [],
      matchingRationale: a
        ? "Application explicitly selected by you"
        : "Selected application is unavailable; choose another target",
    };
  }
  let candidates = apps.filter(
    (a) => norm(a.company) === norm(evidence.company),
  );
  if (evidence.requisition) {
    candidates = candidates.filter(
      (a) => norm(a.requisition) === norm(evidence.requisition),
    );
    return {
      candidateApplicationIds: candidates.map((a) => a.id),
      matchingRationale:
        "Exact normalized company and requisition match; review required",
    };
  }
  candidates = candidates.filter((a) => norm(a.title) === norm(evidence.title));
  return {
    candidateApplicationIds: candidates.map((a) => a.id),
    matchingRationale:
      "Exact normalized company and role match; review required",
  };
}
export async function recordManualLocks(
  store,
  userId,
  before,
  after,
  applicationId,
  actor = "manual",
) {
  if (!before || actor.startsWith("recruiting")) return;
  for (const field of ["stage", "owner"])
    if (before[field] !== after[field]) {
      const old = (await store.list(userId, "field_lock")).find(
        (lock) => lock.applicationId === applicationId && lock.field === field,
      );
      await save(
        store,
        userId,
        "field_lock",
        {
          applicationId,
          field,
          locked: true,
          value: after[field],
          recordedAt: new Date().toISOString(),
          actor,
        },
        old,
        "recruiting_manual_lock",
      );
    }
}
// One bounded tick. Atomic claims and optimistic versions also protect
// separate workers using the same SQLite database; no network runs under a lease.
const jobCursors = new WeakMap();
export async function processRecruitingJobs(
  store,
  { now = Date.now(), deadline = Infinity, cursor: suppliedCursor } = {},
) {
  const time =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : Date.parse(now);
  if (!Number.isFinite(time)) throw new TypeError("Invalid worker time");
  const cursor = suppliedCursor ?? jobCursors.get(store) ?? "";
  const rows = await store.db
    .prepare(
      "SELECT id,user_id FROM records WHERE id>? AND kind='recruiting_job' AND ((json_extract(data,'$.status') IN ('queued','retry') AND json_extract(data,'$.availableAt')<=?) OR (json_extract(data,'$.status')='running' AND json_extract(data,'$.leaseUntil')<=?)) ORDER BY id LIMIT 20",
    )
    .all(cursor, time, time);
  let processed = 0,
    visited = 0,
    nextCursor = cursor;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    visited++;
    nextCursor = row.id;
    let claimed;
    try {
      claimed = await store.atomic(async () => {
        const job = await record(store, row.user_id, row.id, "recruiting_job");
        if (
          !(
            ["queued", "retry"].includes(job.status) && job.availableAt <= time
          ) &&
          !(job.status === "running" && job.leaseUntil <= time)
        )
          return null;
        if (job.attempts >= 3) {
          await save(
            store,
            row.user_id,
            "recruiting_job",
            {
              ...dataOf(job),
              status: "failed",
              leaseUntil: 0,
              lastError: "Retry limit reached",
            },
            job,
          );
          return null;
        }
        return await save(
          store,
          row.user_id,
          "recruiting_job",
          {
            ...dataOf(job),
            status: "running",
            attempts: job.attempts + 1,
            leaseUntil: time + 30000,
          },
          job,
        );
      });
      if (!claimed) continue;
      await store.atomic(async () => {
        const job = await record(store, row.user_id, row.id, "recruiting_job");
        if (job.version !== claimed.version || job.status !== "running") return;
        const evidence = await record(
          store,
          row.user_id,
          job.evidenceId,
          "recruiting_evidence",
        );
        let review = (await store.list(row.user_id, "recruiting_review")).find(
          (r) => r.evidenceId === evidence.id,
        );
        if (!review)
          review = await save(store, row.user_id, "recruiting_review", {
            evidenceId: evidence.id,
            jobId: job.id,
            status: "pending",
            ...(await match(store, row.user_id, evidence)),
            proposedChanges: evidence.changes,
            effectiveAt: evidence.effectiveAt,
            recordedAt: new Date(time).toISOString(),
          });
        await save(
          store,
          row.user_id,
          "recruiting_job",
          {
            ...dataOf(job),
            status: "completed",
            reviewId: review.id,
            leaseUntil: 0,
            lastError: "",
          },
          job,
        );
      });
      processed++;
    } catch {
      if (claimed)
        try {
          await store.atomic(async () => {
            const job = await record(
              store,
              row.user_id,
              row.id,
              "recruiting_job",
            );
            if (job.version !== claimed.version || job.status !== "running")
              return;
            await save(
              store,
              row.user_id,
              "recruiting_job",
              {
                ...dataOf(job),
                status: job.attempts >= 3 ? "failed" : "retry",
                availableAt: time + Math.min(300000, 1000 * 2 ** job.attempts),
                leaseUntil: 0,
                lastError:
                  "Processing failed; no application changes were made",
              },
              job,
            );
          });
        } catch {
          /* Quotas or deletion can prevent status writes. Expired leases remain recoverable. */
        }
    }
  }
  if (visited === rows.length && rows.length < 20) nextCursor = "";
  if (suppliedCursor === undefined) jobCursors.set(store, nextCursor);
  return { processed, nextCursor };
}
export function mountRecruiting(app, store, validate) {
  app.post("/api/recruiting/evidence", async (req, res) => {
    const input = evidenceSchema.parse(req.body);
    const result = await operation(
      store,
      req.user.id,
      "evidence",
      input,
      async () => {
        if (input.applicationId)
          await record(store, req.user.id, input.applicationId, "application");
        if (
          input.changes.stage &&
          !JSON.parse(req.user.stages).includes(input.changes.stage)
        )
          throw new HttpError(400, "Unknown stage");
        const payload = { ...input };
        delete payload.operationId;
        const fingerprint = hash(payload);
        const existing = (
          await store.list(req.user.id, "recruiting_evidence")
        ).find((e) => e.sourceId === input.sourceId);
        if (existing) {
          if (existing.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "Source ID already contains different evidence",
            );
          const job = (await store.list(req.user.id, "recruiting_job")).find(
            (j) => j.evidenceId === existing.id,
          );
          return { evidence: existing, job };
        }
        const evidence = await save(store, req.user.id, "recruiting_evidence", {
          ...payload,
          fingerprint,
          recordedAt: new Date().toISOString(),
          sourceType: "manual",
        });
        const job = await save(store, req.user.id, "recruiting_job", {
          evidenceId: evidence.id,
          status: "queued",
          attempts: 0,
          availableAt: Date.now(),
          leaseUntil: 0,
        });
        return { evidence, job };
      },
    );
    res.json(result);
  });
  app.post("/api/recruiting/reviews/:id/decide", async (req, res) => {
    const input = decisionSchema.parse(req.body);
    const result = await operation(
      store,
      req.user.id,
      `decide:${req.params.id}`,
      input,
      async () => {
        const review = await record(
          store,
          req.user.id,
          req.params.id,
          "recruiting_review",
        );
        if (review.version !== input.version)
          throw new HttpError(409, "Review changed; refresh before deciding");
        if (review.status !== "pending")
          throw new HttpError(409, "Review already decided");
        if (input.decision === "reject")
          return {
            review: await save(
              store,
              req.user.id,
              "recruiting_review",
              {
                ...dataOf(review),
                status: "rejected",
                decisionAt: new Date().toISOString(),
                decisionOperationId: input.operationId,
              },
              review,
              "recruiting_reject",
            ),
          };
        if (!input.applicationId || !input.applicationVersion)
          throw new HttpError(
            400,
            "Choose an application and its current version",
          );
        const target = await record(
          store,
          req.user.id,
          input.applicationId,
          "application",
        );
        if (target.version !== input.applicationVersion)
          throw new HttpError(
            409,
            "Application changed; refresh before deciding",
          );
        const changes =
          input.decision === "correct" ? input.changes : review.proposedChanges;
        if (!changes) throw new HttpError(400, "Supply corrected changes");
        const locks = (await store.list(req.user.id, "field_lock")).filter(
          (lock) =>
            lock.applicationId === target.id &&
            Object.hasOwn(changes, lock.field),
        );
        const clocks = (
          await store.list(req.user.id, "recruiting_clock")
        ).filter(
          (clock) =>
            clock.applicationId === target.id &&
            Object.hasOwn(changes, clock.field),
        );
        if (!input.override && locks.some((lock) => lock.locked))
          throw new HttpError(
            409,
            "Manual field lock requires an explicit override",
          );
        if (
          !input.override &&
          clocks.some((clock) => clock.effectiveAt > review.effectiveAt)
        )
          throw new HttpError(
            409,
            "Older evidence requires an explicit override",
          );
        if (
          !input.override &&
          ["Rejected", "Withdrawn"].includes(target.stage) &&
          changes.stage &&
          changes.stage !== target.stage
        )
          throw new HttpError(
            409,
            "Reopening a terminal application requires an explicit override",
          );
        const merged = await validate(
          req.user,
          "application",
          { ...dataOf(target), ...changes },
          dataOf(target),
        );
        const applied = await save(
          store,
          req.user.id,
          "application",
          merged,
          target,
          "recruiting_accept",
        );
        const lockSnapshots = (
          await _mapAsync(Object.keys(changes), async (field) => {
            const lock = locks.find((item) => item.field === field);
            if (!lock && input.decision !== "correct") return [];
            return [
              {
                before: lock || null,
                after: await save(
                  store,
                  req.user.id,
                  "field_lock",
                  {
                    ...(lock ? dataOf(lock) : {}),
                    applicationId: target.id,
                    field,
                    value: merged[field],
                    locked: input.decision === "correct",
                    recordedAt: new Date().toISOString(),
                    actor:
                      input.decision === "correct"
                        ? "manual_correction"
                        : "review_override",
                  },
                  lock,
                  "recruiting_override",
                ),
              },
            ];
          })
        ).flat();
        const clockSnapshots = await _mapAsync(
          Object.keys(changes),
          async (field) => {
            const old = clocks.find((clock) => clock.field === field);
            return {
              before: old || null,
              after: await save(
                store,
                req.user.id,
                "recruiting_clock",
                {
                  applicationId: target.id,
                  field,
                  effectiveAt: review.effectiveAt,
                  reviewId: review.id,
                },
                old,
              ),
            };
          },
        );
        const updated = await save(
          store,
          req.user.id,
          "recruiting_review",
          {
            ...dataOf(review),
            status: input.decision === "correct" ? "corrected" : "accepted",
            applicationId: target.id,
            decisionAt: new Date().toISOString(),
            decisionOperationId: input.operationId,
            acceptedChanges: changes,
            override: input.override,
            beforeApplication: dataOf(target),
            appliedApplicationVersion: applied.version,
            lockSnapshots,
            clockSnapshots,
          },
          review,
          "recruiting_decision",
        );
        return { review: updated, application: applied };
      },
    );
    res.json(result);
  });
  app.post("/api/recruiting/reviews/:id/undo", async (req, res) => {
    const input = actionSchema.parse(req.body);
    res.json(
      await operation(
        store,
        req.user.id,
        `undo:${req.params.id}`,
        input,
        async () => {
          const review = await record(
            store,
            req.user.id,
            req.params.id,
            "recruiting_review",
          );
          if (
            review.version !== input.version ||
            !["accepted", "corrected", "rejected"].includes(review.status)
          )
            throw new HttpError(
              409,
              "Review cannot be undone in its current state",
            );
          let application;
          if (review.status !== "rejected") {
            const current = await record(
              store,
              req.user.id,
              review.applicationId,
              "application",
            );
            if (current.version !== review.appliedApplicationVersion)
              throw new HttpError(409, "Later application edits prevent undo");
            for (const snapshot of [
              ...review.lockSnapshots,
              ...review.clockSnapshots,
            ]) {
              const current = await store.get(req.user.id, snapshot.after.id);
              if (!current || current.version !== snapshot.after.version)
                throw new HttpError(409, "Later field decisions prevent undo");
            }
            application = await save(
              store,
              req.user.id,
              "application",
              await validate(
                req.user,
                "application",
                review.beforeApplication,
                dataOf(current),
              ),
              current,
              "recruiting_undo",
            );
            for (const [kind, snapshots] of [
              ["field_lock", review.lockSnapshots],
              ["recruiting_clock", review.clockSnapshots],
            ])
              for (const snapshot of snapshots) {
                if (snapshot.before)
                  await save(
                    store,
                    req.user.id,
                    kind,
                    dataOf(snapshot.before),
                    snapshot.after,
                    "recruiting_undo",
                  );
                else
                  await save(
                    store,
                    req.user.id,
                    kind,
                    {
                      ...dataOf(snapshot.after),
                      effectiveAt: "",
                      reviewId: "",
                      retracted: true,
                      ...(kind === "field_lock" ? { locked: false } : {}),
                    },
                    snapshot.after,
                    "recruiting_undo",
                  );
              }
          }
          const updated = await save(
            store,
            req.user.id,
            "recruiting_review",
            {
              ...dataOf(review),
              status: "undone",
              undoneAt: new Date().toISOString(),
            },
            review,
            "recruiting_undo",
          );
          return { review: updated, ...(application ? { application } : {}) };
        },
      ),
    );
  });
  app.post("/api/recruiting/jobs/:id/retry", async (req, res) => {
    const input = actionSchema.parse(req.body);
    res.json(
      await operation(
        store,
        req.user.id,
        `retry:${req.params.id}`,
        input,
        async () => {
          const job = await record(
            store,
            req.user.id,
            req.params.id,
            "recruiting_job",
          );
          if (job.version !== input.version || job.status !== "failed")
            throw new HttpError(
              409,
              "Only the current failed job can be retried",
            );
          return await save(
            store,
            req.user.id,
            "recruiting_job",
            {
              ...dataOf(job),
              status: "queued",
              attempts: 0,
              leaseUntil: 0,
              availableAt: Date.now(),
              lastError: "",
            },
            job,
            "recruiting_retry",
          );
        },
      ),
    );
  });
  for (const [path, kind, transform] of [
    [
      "locks",
      "field_lock",
      (old) => ({
        ...dataOf(old),
        locked: false,
        recordedAt: new Date().toISOString(),
      }),
    ],
    [
      "jobs",
      "recruiting_job",
      (old) => {
        if (!["queued", "retry", "running"].includes(old.status))
          throw new HttpError(409, "Only pending jobs can be canceled");
        return { ...dataOf(old), status: "canceled", leaseUntil: 0 };
      },
    ],
  ])
    app.post(
      `/api/recruiting/${path}/:id/${path === "locks" ? "unlock" : "cancel"}`,
      async (req, res) => {
        const input = actionSchema.parse(req.body);
        res.json(
          await operation(
            store,
            req.user.id,
            `${path}:${req.params.id}`,
            input,
            async () => {
              const old = await record(store, req.user.id, req.params.id, kind);
              if (old.version !== input.version)
                throw new HttpError(409, "Record changed; refresh first");
              return await save(
                store,
                req.user.id,
                kind,
                transform(old),
                old,
                "recruiting_manual_action",
              );
            },
          ),
        );
      },
    );
}
