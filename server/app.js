import express from "express";
import { mountRecruiting } from "./recruiting.js";
import { mountReminders } from "./reminders.js";
import { z } from "zod";
import {
  securityConfig,
  installSecurity,
  createLimiter,
  HttpError,
} from "./security.js";
import { mountAuth } from "./auth.js";
import { mountFiles } from "./files.js";
import { mountImportRoutes } from "./imports.js";
import { duplicatePairs, mountDuplicateRoutes } from "./duplicates.js";
import { savedViewSchema, mountTracker } from "./tracker.js";
import { contactSchema, normalizeContact } from "./contact-details.js";
import {
  documentUsageSchema,
  validateDocumentUsage,
} from "./document-usage.js";
import {
  applicationDetailsShape,
  validateApplicationDetails,
} from "./application-details.js";
import { stringify } from "csv-stringify/sync";
const text = z.string().trim().max(10000);
const date = z
  .union([
    z.literal(""),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine(
        (v) =>
          !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
      ),
  ])
  .default("");
const url = z
  .union([z.literal(""), z.url().refine((v) => /^https?:\/\//.test(v))])
  .default("");
const amount = z
  .union([z.literal(""), z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/)])
  .default("");
const schemas = {
  saved_view: savedViewSchema,
  application: z.object({
    ...applicationDetailsShape,
    company: text.min(1).max(200),
    title: text.min(1).max(300),
    stage: text.min(1).max(50),
    priority: z.enum(["Low", "Medium", "High"]).default("Medium"),
    owner: z.enum(["You", "Employer", "Nobody", "Unclear"]).default("Unclear"),
    compensationMin: amount,
    compensationMax: amount,
    compensationCurrency: z
      .union([z.literal(""), z.string().regex(/^[A-Z]{3}$/)])
      .default(""),
    compensationPeriod: z
      .enum(["Unknown", "Hour", "Day", "Week", "Month", "Year"])
      .default("Unknown"),
    compensationBasis: z.enum(["Unknown", "Base", "Total"]).default("Unknown"),
    location: text.default(""),
    source: text.default(""),
    workArrangement: z
      .enum(["Unknown", "Remote", "Hybrid", "On-site"])
      .default("Unknown"),
    employmentType: z
      .enum([
        "Unknown",
        "Full-time",
        "Part-time",
        "Contract",
        "Internship",
        "Temporary",
      ])
      .default("Unknown"),
    url,
    requisition: text.default(""),
    appliedDate: date,
    notes: text.default(""),
    description: text.default(""),
    archived: z.boolean().default(false),
  }),
  contact: contactSchema,
  document_usage: documentUsageSchema,
  task: z.object({
    title: text.min(1),
    applicationId: text.default(""),
    due: date,
    done: z.boolean().default(false),
  }),
  round: z
    .object({
      title: text.min(1),
      applicationId: text.min(1),
      status: z.enum([
        "Invited",
        "Scheduled",
        "Completed",
        "Canceled",
        "Rescheduled",
      ]),
      date: date,
      time: z
        .union([z.literal(""), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)])
        .default(""),
      timezone: text.min(1).max(100),
      url,
      notes: text.default(""),
    })
    .refine(
      (v) => !["Scheduled", "Rescheduled"].includes(v.status) || !!v.date,
      { message: "Scheduled rounds require a date" },
    ),
  assessment: z
    .object({
      title: text.min(1),
      applicationId: text.min(1),
      status: z
        .enum(["Not started", "In progress", "Completed", "Canceled"])
        .default("Not started"),
      due: date,
      completedDate: date,
      score: text.max(200).default(""),
      url,
      notes: text.default(""),
    })
    .refine((v) => v.status !== "Completed" || !!v.completedDate, {
      message: "Enter the actual completion date",
    })
    .refine((v) => !v.completedDate || v.status === "Completed", {
      message: "Only completed assessments can have a completion date",
    })
    .refine((v) => !v.score || v.status === "Completed", {
      message: "Only completed assessments can have a score",
    }),
  document: z.object({
    title: text.min(1),
    fileId: text.min(1),
    applicationIds: z.array(z.string().uuid()).max(100).default([]),
    label: text.default("Resume"),
    documentId: z.union([z.literal(""), z.string().uuid()]).default(""),
  }),
};
export async function createApp(store, options = {}) {
  const { db, list, get, save } = store;
  const app = express();
  const config = securityConfig(options),
    limit = await createLimiter(db);
  installSecurity(app, config, limit);
  const smallJson = express.json({
    limit: "256kb",
    inflate: false,
    strict: true,
  });
  const importJson = express.json({
    limit: "3mb",
    inflate: false,
    strict: true,
  });
  const fileJson = express.json({
    limit: config.vercel ? "3mb" : "28mb",
    inflate: false,
    strict: true,
  });
  // Large request bodies are parsed only after authentication and route throttling.
  app.use("/api", (req, res, next) => {
    if (req.path === "/files" || req.path.startsWith("/import/")) return next();
    smallJson(req, res, next);
  });
  mountAuth(app, store, config, limit);
  let activeUploads = 0,
    activeExports = 0;
  app.use("/api", (req, res, next) => {
    const upload = req.path === "/files" && req.method === "POST",
      exporting = req.path === "/export.json";
    if ((upload && activeUploads >= 2) || (exporting && activeExports >= 2))
      return next(new HttpError(503, "Server busy. Try again shortly."));
    if (upload) activeUploads++;
    if (exporting) activeExports++;
    if (upload || exporting) {
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        if (upload) activeUploads--;
        if (exporting) activeExports--;
      };
      res.once("finish", release);
      res.once("close", release);
    }
    next();
  });
  app.use("/api", async (req, res, next) => {
    try {
      if (req.path === "/files" && req.method === "POST") {
        await limit("file-body:" + req.user.id, 5, 60000);
        return fileJson(req, res, next);
      }
      if (req.path.startsWith("/import/")) {
        await limit("import:" + req.user.id, 20, 60000);
        return importJson(req, res, next);
      }
      next();
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body))
    )
      return next(new HttpError(400, "A JSON object is required"));
    next();
  });
  app.get("/api/workspace", async (req, res) => {
    const u = req.user;
    const duplicates = duplicatePairs(
      await list(u.id, "application"),
      await list(u.id, "duplicate_review"),
    );
    res.json({
      user: {
        name: u.name,
        email: u.email,
        timezone: u.timezone,
        stages: JSON.parse(u.stages),
      },
      applications: await list(u.id, "application"),
      savedViews: (await list(u.id, "saved_view")).filter((v) => !v.archived),
      contacts: await list(u.id, "contact"),
      tasks: await list(u.id, "task"),
      rounds: await list(u.id, "round"),
      documents: await list(u.id, "document"),
      documentUsages: await list(u.id, "document_usage"),
      listingSnapshots: await list(u.id, "listing_snapshot"),
      assessments: await list(u.id, "assessment"),
      evidence: await list(u.id, "recruiting_evidence"),
      recruitingJobs: await list(u.id, "recruiting_job"),
      reviews: await list(u.id, "recruiting_review"),
      fieldLocks: await list(u.id, "field_lock"),
      reminders: await list(u.id, "reminder"),
      duplicates,
      duplicateScanLimited: !!duplicates.limited,
      duplicateReviews: (await list(u.id, "duplicate_review")).filter(
        (r) => r.decision !== "undone",
      ),
    });
  });
  app.put("/api/settings", async (req, res, next) => {
    try {
      const v = z
        .object({
          timezone: text.max(100),
          stages: z.array(text.min(1).max(50)).min(1).max(30),
        })
        .parse(req.body);
      try {
        new Intl.DateTimeFormat("en", { timeZone: v.timezone });
      } catch {
        throw new HttpError(400, "Invalid timezone");
      }
      if (new Set(v.stages).size !== v.stages.length)
        throw new HttpError(400, "Stage names must be unique");
      if (
        (await list(req.user.id, "application")).some(
          (a) => !v.stages.includes(a.stage),
        )
      )
        throw new HttpError(
          400,
          "Cannot remove a stage used by an application",
        );
      await db
        .prepare("UPDATE users SET timezone=?,stages=? WHERE id=?")
        .run(v.timezone, JSON.stringify(v.stages), req.user.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  async function validate(user, kind, body, previous) {
    if (!Object.hasOwn(schemas, kind))
      throw new HttpError(400, "Unknown record type");
    let data = schemas[kind].parse(body);
    if (kind === "contact") data = normalizeContact(data, previous);
    if (kind === "application") validateApplicationDetails(data);
    if (kind === "document_usage")
      data = await validateDocumentUsage(data, user, store);
    if (!data) throw new HttpError(400, "Unknown record type");
    if (kind === "application" && !JSON.parse(user.stages).includes(data.stage))
      throw new HttpError(400, "Unknown stage");
    if (
      kind === "application" &&
      data.compensationMin &&
      data.compensationMax &&
      Number(data.compensationMin) > Number(data.compensationMax)
    )
      throw new HttpError(400, "Compensation minimum must not exceed maximum");
    for (const id of [
      ...(data.applicationIds || []),
      ...(data.applicationId ? [data.applicationId] : []),
    ]) {
      if ((await get(user.id, id))?.kind !== "application")
        throw new HttpError(400, "Invalid application link");
    }
    if (
      kind === "document" &&
      !(await db
        .prepare("SELECT id FROM files WHERE id=? AND user_id=?")
        .get(data.fileId, user.id))
    )
      throw new HttpError(400, "File not found");
    if (
      kind === "document" &&
      data.documentId &&
      (await get(user.id, data.documentId))?.kind !== "document"
    )
      throw new HttpError(400, "Invalid document version link");
    if (kind === "document" && data.documentId) {
      const parent = await get(user.id, data.documentId);
      data.documentId = JSON.parse(parent.data).documentId || parent.id;
    }
    if (kind === "round")
      try {
        new Intl.DateTimeFormat("en", { timeZone: data.timezone });
      } catch {
        throw new HttpError(400, "Invalid timezone");
      }
    return data;
  }
  await mountTracker(app, store, validate);
  mountRecruiting(app, store, validate);
  mountReminders(app, store);
  async function matchingSubmission(userId, data, excludeId) {
    if (data.retracted) return undefined;
    return (await list(userId, "document_usage")).find(
      (v) =>
        v.id !== excludeId &&
        !v.retracted &&
        v.applicationId === data.applicationId &&
        v.documentVersionId === data.documentVersionId &&
        v.submittedDate === data.submittedDate &&
        v.purpose === data.purpose,
    );
  }
  app.post("/api/records/:kind", async (req, res, next) => {
    try {
      const data = await validate(req.user, req.params.kind, req.body);
      if (req.params.kind === "document_usage") {
        const existing = await matchingSubmission(req.user.id, data);
        if (existing) {
          if (existing.notes !== data.notes)
            throw new HttpError(
              409,
              "This submission is already recorded. Correct the existing record instead.",
            );
          return res.json(existing);
        }
      }
      res.json(await save(req.user.id, req.params.kind, data));
    } catch (e) {
      next(e);
    }
  });
  app.put("/api/records/:kind/:id", async (req, res, next) => {
    try {
      if (req.params.kind === "document")
        return res.status(400).json({
          error: "Document versions are immutable. Upload a new version.",
        });
      const old = await get(req.user.id, req.params.id);
      if (!old || old.kind !== req.params.kind)
        throw new HttpError(404, "Record not found");
      const data = await validate(
        req.user,
        req.params.kind,
        req.body,
        JSON.parse(old.data),
      );
      if (
        req.params.kind === "document_usage" &&
        (await matchingSubmission(req.user.id, data, req.params.id))
      )
        throw new HttpError(
          409,
          "This submission is already recorded. Correct the existing record instead.",
        );
      res.json(
        await save(
          req.user.id,
          req.params.kind,
          data,
          req.params.id,
          z.number().int().positive().parse(req.body.version),
        ),
      );
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/events/:id", async (req, res) => {
    const record = await get(req.user.id, req.params.id);
    if (!record) return res.status(404).json({ error: "Record not found" });
    // Historical snapshots retain link/unlink evidence even after a child moves.
    const events = await db
      .prepare(
        `SELECT e.*,r.kind FROM events e JOIN records r ON r.id=e.record_id AND r.user_id=e.user_id
      WHERE e.user_id=? AND (e.record_id=? OR (?='application' AND (
        json_extract(e.after_data,'$.applicationId')=? OR json_extract(e.before_data,'$.applicationId')=?
        OR EXISTS(SELECT 1 FROM json_each(e.after_data,'$.applicationIds') WHERE value=?)
        OR EXISTS(SELECT 1 FROM json_each(e.before_data,'$.applicationIds') WHERE value=?)
      ))) ORDER BY e.at DESC,e.rowid DESC`,
      )
      .all(
        req.user.id,
        record.id,
        record.kind,
        record.id,
        record.id,
        record.id,
        record.id,
      );
    res.json(events);
  });
  mountFiles(app, store, config, limit);
  mountImportRoutes(app, store, validate);
  mountDuplicateRoutes(app, store);
  app.get("/api/export.csv", async (req, res) => {
    await limit("export:" + req.user.id, 3, 3600000);
    const columns = [
      "id",
      "company",
      "title",
      "stage",
      "priority",
      "owner",
      "location",
      "source",
      "workArrangement",
      "employmentType",
      "compensationMin",
      "compensationMax",
      "compensationCurrency",
      "compensationPeriod",
      "compensationBasis",
      "url",
      "requisition",
      "appliedDate",
      "offerOutcome",
      "offerReceivedDate",
      "offerDecisionDate",
      "descriptionCapturedDate",
      "descriptionSourceUrl",
      "notes",
      "description",
      "archived",
      "timezone",
    ];
    res
      .type("text/csv")
      .attachment("offerly-applications.csv")
      .send(
        stringify(
          (await list(req.user.id, "application")).map((v) => ({
            ...v,
            timezone: req.user.timezone,
          })),
          { header: true, columns, escape_formulas: true },
        ),
      );
  });
  app.get("/api/export.json", async (req, res, next) => {
    try {
      await limit("export:" + req.user.id, 3, 3600000);
      // Stream each bounded row/file instead of materializing the full workspace in memory.
      res.attachment("offerly-workspace.json").type("application/json");
      const write = async (chunk) => {
        if (res.destroyed) throw new HttpError(499, "Download canceled");
        if (!res.write(chunk))
          await new Promise((resolve, reject) => {
            const clean = () => {
              res.off("drain", drained);
              res.off("close", closed);
            };
            const drained = () => {
              clean();
              resolve();
            };
            const closed = () => {
              clean();
              reject(new Error("Download canceled"));
            };
            res.once("drain", drained);
            res.once("close", closed);
          });
      };
      await write(
        JSON.stringify({
          exportedAt: new Date().toISOString(),
          timezone: req.user.timezone,
          stages: JSON.parse(req.user.stages),
        }).slice(0, -1),
      );
      for (const [name, query] of [
        ["records", "SELECT kind,id,data,version FROM records WHERE user_id=?"],
        [
          "imports",
          "SELECT id,rows,decisions,result FROM import_batches WHERE user_id=?",
        ],
        ["events", "SELECT * FROM events WHERE user_id=?"],
        [
          "files",
          "SELECT id,name,mime,hash,created_at,scanned_at FROM files WHERE user_id=?",
        ],
      ]) {
        await write("," + JSON.stringify(name) + ":[");
        let first = true;
        for (const row of await db.prepare(query).all(req.user.id)) {
          if (!first) await write(",");
          first = false;
          if (name === "files") {
            if (config.production && !row.scanned_at)
              await write(
                JSON.stringify({
                  ...row,
                  body: null,
                  omitted: "Document requires security screening",
                }),
              );
            else {
              const file = await db
                .prepare("SELECT body FROM files WHERE id=? AND user_id=?")
                .get(row.id, req.user.id);
              await write(
                JSON.stringify({
                  ...row,
                  body: Buffer.from(file.body).toString("base64"),
                }),
              );
            }
          } else await write(JSON.stringify(row));
        }
        await write("]");
      }
      await write("}");
      res.end();
    } catch (e) {
      if (res.headersSent) res.destroy();
      else next(e);
    }
  });
  app.use("/api", (req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    let status = 500,
      message = "Request failed. Try again later.";
    if (err instanceof HttpError) {
      status = err.status;
      message = err.message;
    } else if (err instanceof z.ZodError) {
      status = 400;
      message = err.issues
        .slice(0, 10)
        .map((i) => i.path.join(".") + ": " + i.message)
        .join("; ");
    } else if (err.type === "entity.too.large") {
      status = 413;
      message = "Request body too large";
    } else if (err.type === "entity.parse.failed") {
      status = 400;
      message = "Invalid JSON body";
    } else if (err.type === "encoding.unsupported") {
      status = 415;
      message = "Compressed request bodies are not supported";
    }
    if (status === 429 || status === 503) res.set("Retry-After", "60");
    if (status >= 500)
      console.error(
        JSON.stringify({
          event: "request_error",
          requestId: req.requestId,
          status,
        }),
      );
    res.status(status).json({
      error: message,
      requestId: req.requestId,
      ...(err.code === "SESSION_REQUIRED" ? { code: "SESSION_REQUIRED" } : {}),
    });
  });
  return app;
}
