import { z } from "zod";
import { createHash } from "node:crypto";
import { HttpError } from "./security.js";

const short = z.string().trim().max(300);
const filterDate = z.union([
  z.literal(""),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    ),
]);
export const savedViewSchema = z.object({
  name: short.min(1).max(60),
  archived: z.boolean().default(false),
  filters: z
    .object({
      query: short.default(""),
      stage: short.default("All stages"),
      priority: z
        .enum(["Any priority", "High", "Medium", "Low"])
        .default("Any priority"),
      owner: z
        .enum(["Any owner", "You", "Employer", "Nobody", "Unclear"])
        .default("Any owner"),
      companyFilter: short.default(""),
      sourceFilter: short.default(""),
      arrangement: z
        .enum(["", "Unknown", "Remote", "Hybrid", "On-site"])
        .default(""),
      dateFrom: filterDate.default(""),
      dateTo: filterDate.default(""),
      includeUnknownDates: z.boolean().default(false),
      archived: z.boolean().default(false),
      board: z.boolean().default(false),
      sort: z.enum(["recent", "company", "priority"]).default("recent"),
    })
    .strict()
    .refine((v) => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, {
      message: "Start date must not follow end date",
    }),
});
const bulkSchema = z
  .object({
    operationId: z.string().uuid(),
    applications: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            version: z.number().int().positive(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    changes: z
      .object({
        stage: short.min(1).max(50).optional(),
        priority: z.enum(["High", "Medium", "Low"]).optional(),
        owner: z.enum(["You", "Employer", "Nobody", "Unclear"]).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .refine((v) => Object.keys(v).length > 0, { message: "Select a change" }),
  })
  .strict();

export function mountTracker(app, store, validate) {
  const { db, get, save, atomic } = store;
  db.exec(`CREATE TABLE IF NOT EXISTS mutation_receipts (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL,
    expires INTEGER NOT NULL, PRIMARY KEY(user_id,operation_id));
    CREATE INDEX IF NOT EXISTS mutation_expiry ON mutation_receipts(expires);`);
  app.post("/api/applications/bulk", (req, res, next) => {
    try {
      const body = bulkSchema.parse(req.body);
      if (
        new Set(body.applications.map((a) => a.id)).size !==
        body.applications.length
      )
        throw new HttpError(400, "Select each application once");
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(body))
        .digest("hex");
      const result = atomic(() => {
        db.prepare("DELETE FROM mutation_receipts WHERE expires<=?").run(
          Date.now(),
        );
        const prior = db
          .prepare(
            "SELECT * FROM mutation_receipts WHERE user_id=? AND operation_id=?",
          )
          .get(req.user.id, body.operationId);
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            throw new HttpError(
              409,
              "This operation ID was used for a different change",
            );
          return { ...JSON.parse(prior.result), replayed: true };
        }
        if (
          db
            .prepare("SELECT count(*) n FROM mutation_receipts WHERE user_id=?")
            .get(req.user.id).n >= 1000
        )
          throw new HttpError(
            429,
            "Bulk edit limit reached. Try again after older operations expire.",
          );
        const prepared = body.applications.map(({ id, version }) => {
          const old = get(req.user.id, id);
          if (!old || old.kind !== "application")
            throw new HttpError(404, "Application not found");
          if (old.version !== version)
            throw new HttpError(
              409,
              "An application changed. Refresh and review your selection. Nothing was updated.",
            );
          return {
            id,
            version,
            data: validate(req.user, "application", {
              ...JSON.parse(old.data),
              ...body.changes,
            }),
          };
        });
        for (const item of prepared)
          save(
            req.user.id,
            "application",
            item.data,
            item.id,
            item.version,
            "manual_bulk",
          );
        const value = {
          count: prepared.length,
          operationId: body.operationId,
          replayed: false,
        };
        db.prepare("INSERT INTO mutation_receipts VALUES(?,?,?,?,?)").run(
          req.user.id,
          body.operationId,
          fingerprint,
          JSON.stringify(value),
          Date.now() + 7 * 86400000,
        );
        return value;
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
}
