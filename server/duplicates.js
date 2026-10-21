import { mapAsync as _mapAsync } from "./async.js";
import { HttpError } from "./security.js";
import { z } from "zod";
import { createHash } from "node:crypto";
export const normalized = (value) =>
  (value || "").trim().replace(/\s+/g, " ").toLowerCase();
const identity = (a) => [
  a.id,
  normalized(a.company),
  normalized(a.title),
  normalized(a.requisition),
  a.url || "",
];
export function duplicateReason(a, b) {
  if (normalized(a.company) !== normalized(b.company)) return null;
  const ar = normalized(a.requisition),
    br = normalized(b.requisition);
  if (ar && br) return ar === br ? "Same employer and requisition ID" : null;
  if (a.url && b.url && a.url === b.url) return "Same employer and job URL";
  return normalized(a.title) === normalized(b.title)
    ? "Same employer and role; requisition not confirmed"
    : null;
}
export function pairKey(a, b) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        [identity(a), identity(b)].sort((x, y) => x[0].localeCompare(y[0])),
      ),
    )
    .digest("hex");
}
export function duplicatePairs(applications, reviews = []) {
  const reviewed = new Set(
    reviews.filter((r) => r.decision !== "undone").map((r) => r.pairKey),
  );
  const companies = new Map();
  const pairs = [];
  let comparisons = 0;
  for (const a of applications.filter((a) => !a.archived)) {
    const key = normalized(a.company),
      previous = companies.get(key) || [];
    for (const b of previous) {
      if (++comparisons > 100000 || pairs.length >= 100) {
        pairs.limited = true;
        return pairs;
      }
      const reason = duplicateReason(a, b);
      if (reason) {
        const key = pairKey(a, b);
        if (!reviewed.has(key)) pairs.push({ key, left: b, right: a, reason });
      }
    }
    previous.push(a);
    companies.set(key, previous);
  }
  return pairs;
}
export function mountDuplicateRoutes(app, store) {
  const { get, save, list, atomic } = store;
  async function mergePlan(user, leftId, rightId, targetId) {
    if (leftId === rightId || ![leftId, rightId].includes(targetId))
      throw new HttpError(400, "Choose two applications and a primary record");
    const records = await _mapAsync([leftId, rightId], async (id) => {
      const row = await get(user, id);
      if (row?.kind !== "application")
        throw new HttpError(404, "Application not found");
      return { ...JSON.parse(row.data), id: row.id, version: row.version };
    });
    if (!duplicateReason(...records) || records.some((r) => r.archived))
      throw new HttpError(400, "Choose active duplicate candidates");
    const primary = records.find((r) => r.id === targetId),
      source = records.find((r) => r.id !== targetId);
    const children = (
      await _mapAsync(
        [
          "contact",
          "document",
          "document_usage",
          "round",
          "assessment",
          "task",
        ],
        async (kind) =>
          (await list(user, kind))
            .filter(
              (r) =>
                r.applicationId === source.id ||
                r.applicationIds?.includes(source.id),
            )
            .map((r) => ({ kind, ...r })),
      )
    ).flat();
    if (children.length > 100)
      throw new HttpError(
        413,
        "Merge supports up to 100 linked records. Review links manually first.",
      );
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([primary, source, children]))
      .digest("hex");
    return { primary, source, children, fingerprint };
  }
  app.post("/api/duplicates/merge-preview", async (req, res, next) => {
    try {
      const v = z
        .object({
          leftId: z.string().uuid(),
          rightId: z.string().uuid(),
          targetId: z.string().uuid(),
        })
        .parse(req.body);
      const plan = await mergePlan(
        req.user.id,
        v.leftId,
        v.rightId,
        v.targetId,
      );
      res.json({
        fingerprint: plan.fingerprint,
        primaryId: plan.primary.id,
        sourceId: plan.source.id,
        affected: plan.children.map((r) => ({
          id: r.id,
          kind: r.kind,
          title: r.title || r.name,
        })),
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/duplicates/review", async (req, res, next) => {
    try {
      const result = await atomic(async () => {
        const {
          leftId,
          rightId,
          leftVersion,
          rightVersion,
          decision,
          targetId,
          fingerprint,
        } = z
          .object({
            leftId: z.string().uuid(),
            rightId: z.string().uuid(),
            leftVersion: z.number().int().positive(),
            rightVersion: z.number().int().positive(),
            decision: z.enum(["keep", "archive", "merge"]),
            fingerprint: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            targetId: z.string().uuid().optional(),
          })
          .parse(req.body);
        if (
          !["keep", "archive", "merge"].includes(decision) ||
          leftId === rightId
        )
          throw new HttpError(400, "Invalid review decision");
        const owned = async (id) => {
          const r = await get(req.user.id, id);
          if (r?.kind !== "application")
            throw Object.assign(new HttpError(400, "Application not found"), {
              status: 404,
            });
          return { ...JSON.parse(r.data), id: r.id, version: r.version };
        };
        const left = await owned(leftId),
          right = await owned(rightId);
        if (left.version !== leftVersion || right.version !== rightVersion)
          throw Object.assign(
            new HttpError(
              400,
              "Applications changed. Refresh duplicate review.",
            ),
            { status: 409 },
          );
        if (!duplicateReason(left, right))
          throw new HttpError(
            400,
            "These applications are no longer duplicate candidates",
          );
        const key = pairKey(left, right);
        const previous = (await list(req.user.id, "duplicate_review")).find(
          (r) => r.pairKey === key && r.decision !== "undone",
        );
        if (previous) return previous;
        if (decision === "merge") {
          const plan = await mergePlan(req.user.id, leftId, rightId, targetId);
          if (fingerprint !== plan.fingerprint)
            throw new HttpError(
              409,
              "Linked records changed. Preview this merge again.",
            );
          const changes = [
            { kind: "application", record: plan.primary, data: plan.primary },
            {
              kind: "application",
              record: plan.source,
              data: { ...plan.source, archived: true },
            },
            ...plan.children.map((r) => ({
              kind: r.kind,
              record: r,
              data: {
                ...r,
                ...(r.applicationId === plan.source.id
                  ? { applicationId: plan.primary.id }
                  : {}),
                ...(r.applicationIds
                  ? {
                      applicationIds: [
                        ...new Set(
                          r.applicationIds.map((id) =>
                            id === plan.source.id ? plan.primary.id : id,
                          ),
                        ),
                      ],
                    }
                  : {}),
              },
            })),
          ];
          const undo = changes.map(({ kind, record }) => {
            const data = { ...record };
            delete data.id;
            delete data.version;
            delete data.kind;
            return { id: record.id, kind, version: record.version + 1, data };
          });
          const review = {
            pairKey: key,
            applicationIds: [leftId, rightId],
            decision,
            targetId,
            sourceId: plan.source.id,
            undo,
          };
          if (Buffer.byteLength(JSON.stringify(review)) > 200 * 1024)
            throw new HttpError(
              413,
              "Linked records are too large for a reversible merge. Review links manually.",
            );
          for (const change of changes) {
            const data = { ...change.data };
            delete data.id;
            delete data.version;
            delete data.kind;
            await save(
              req.user.id,
              change.kind,
              data,
              change.record.id,
              change.record.version,
              "manual_merge",
            );
          }
          return await save(req.user.id, "duplicate_review", review);
        }
        let targetVersion = null,
          previousArchived = null;
        if (decision === "archive") {
          if (![leftId, rightId].includes(targetId))
            throw new HttpError(400, "Choose one of these applications");
          const target = targetId === leftId ? left : right;
          previousArchived = target.archived;
          const { id, version, ...data } = target;
          targetVersion = (
            await save(
              req.user.id,
              "application",
              { ...data, archived: true },
              id,
              version,
            )
          ).version;
        }
        return await save(req.user.id, "duplicate_review", {
          pairKey: key,
          applicationIds: [leftId, rightId],
          decision,
          targetId: decision === "archive" ? targetId : "",
          targetVersion,
          previousArchived,
        });
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/duplicates/:id/undo", async (req, res, next) => {
    try {
      const result = await atomic(async () => {
        const record = await get(req.user.id, req.params.id);
        if (record?.kind !== "duplicate_review")
          throw Object.assign(new HttpError(400, "Review not found"), {
            status: 404,
          });
        const review = JSON.parse(record.data);
        if (review.decision === "undone") return { ok: true };
        if (review.decision === "merge") {
          for (const original of review.undo) {
            const current = await get(req.user.id, original.id);
            if (
              !current ||
              current.kind !== original.kind ||
              current.version !== original.version
            )
              throw new HttpError(
                409,
                "A merged record changed. Undo cannot overwrite later edits.",
              );
          }
          for (const original of review.undo)
            await save(
              req.user.id,
              original.kind,
              original.data,
              original.id,
              original.version,
              "manual_merge_undo",
            );
        }
        if (review.decision === "archive") {
          const target = await get(req.user.id, review.targetId);
          if (!target || target.version !== review.targetVersion)
            throw Object.assign(
              new HttpError(
                400,
                "Archived application changed. Restore it from the archive instead.",
              ),
              { status: 409 },
            );
          await save(
            req.user.id,
            "application",
            { ...JSON.parse(target.data), archived: review.previousArchived },
            target.id,
            target.version,
          );
        }
        await save(
          req.user.id,
          "duplicate_review",
          { ...review, decision: "undone" },
          record.id,
          record.version,
        );
        return { ok: true };
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
}
