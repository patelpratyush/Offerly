import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./security.js";
const schema = z
  .object({
    operationId: z.uuid(),
    version: z.number().int().positive(),
    kind: z.enum(["task", "round", "assessment"]),
    override: z.boolean().default(false),
    targetId: z.uuid().optional(),
    targetVersion: z.number().int().positive().optional(),
    data: z.record(z.string(), z.unknown()),
  })
  .strict();
// Event dates and target round must be explicitly supplied by the user. Email
// received time never establishes a meeting time or deadline.
export function mountRecruitingActions(app, store, validate) {
  app.post("/api/recruiting/reviews/:id/action", async (req, res) => {
    const input = schema.parse(req.body);
    const result = await store.atomic(async () => {
      const row = await store.get(req.user.id, req.params.id);
      if (!row || row.kind !== "recruiting_review")
        throw new HttpError(404, "Review not found");
      const review = JSON.parse(row.data);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      if (review.actionOperationId === input.operationId) {
        if (review.actionFingerprint !== fingerprint)
          throw new HttpError(
            409,
            "Operation ID already used with different data",
          );
        return { ok: true, retracted: review.status === "undone" };
      }
      if (
        row.version !== input.version ||
        !["accepted", "corrected"].includes(review.status)
      )
        throw new HttpError(
          409,
          "Accept the application link before applying an event action",
        );
      if (review.actionSnapshot)
        throw new HttpError(409, "Event action already applied");
      const target = input.targetId
        ? await store.get(req.user.id, input.targetId)
        : null;
      if (
        input.targetId &&
        (!target ||
          target.kind !== input.kind ||
          target.version !== input.targetVersion ||
          JSON.parse(target.data).applicationId !== review.applicationId)
      )
        throw new HttpError(
          409,
          "Event target changed or belongs to another application",
        );
      const before = target ? JSON.parse(target.data) : null;
      if (!input.override && before?.recruitingEffectiveAt > review.effectiveAt)
        throw new HttpError(
          409,
          "Older event evidence requires an explicit override",
        );
      const data = await validate(
        req.user,
        input.kind,
        { ...before, ...input.data, applicationId: review.applicationId },
        before,
      );
      data.recruitingEffectiveAt = review.effectiveAt;
      const after = await store.save(
        req.user.id,
        input.kind,
        data,
        target?.id,
        target?.version,
        "recruiting_event_accept",
      );
      await store.save(
        req.user.id,
        "recruiting_review",
        {
          ...review,
          actionOperationId: input.operationId,
          actionFingerprint: fingerprint,
          actionSnapshot: { kind: input.kind, before, after },
        },
        row.id,
        row.version,
        "recruiting_event_accept",
      );
      return { ok: true, action: after };
    });
    res.json(result);
  });
}
