import { mapAsync as _mapAsync } from "./async.js";
import { HttpError } from "./security.js";
import { parse } from "csv-parse/sync";
import { randomUUID } from "node:crypto";
import { duplicateReason } from "./duplicates.js";
export const importFields = [
  "company",
  "title",
  "stage",
  "appliedDate",
  "offerOutcome",
  "offerReceivedDate",
  "offerDecisionDate",
  "descriptionCapturedDate",
  "descriptionSourceUrl",
  "location",
  "source",
  "requisition",
  "url",
  "priority",
  "owner",
  "workArrangement",
  "employmentType",
  "compensationMin",
  "compensationMax",
  "compensationCurrency",
  "compensationPeriod",
  "compensationBasis",
  "notes",
  "description",
  "archived",
];
function readCsv(csv) {
  if (typeof csv !== "string" || csv.length > 2000000)
    throw new HttpError(400, "Choose a CSV smaller than 2 MB");
  let rows;
  try {
    rows = parse(csv, {
      skip_empty_lines: true,
      bom: true,
      trim: true,
      max_record_size: 100000,
    });
  } catch {
    throw new HttpError(400, "Malformed CSV. Check quoting and column counts.");
  }
  const headers = rows.shift();
  if (
    !headers?.length ||
    headers.some((h) => !h) ||
    new Set(headers).size !== headers.length
  )
    throw new HttpError(400, "CSV needs unique, non-empty column headers");
  if (rows.length > 1000)
    throw new HttpError(400, "Import up to 1,000 rows at a time");
  return { headers, rows };
}
function interpretedDate(value, format) {
  if (!value || format === "ISO") return value || "";
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match)
    throw new HttpError(
      400,
      `Date must use ${format === "MDY" ? "MM/DD/YYYY" : "DD/MM/YYYY"}`,
    );
  const [, a, b, year] = match;
  return `${year}-${(format === "MDY" ? a : b).padStart(2, "0")}-${(format === "MDY" ? b : a).padStart(2, "0")}`;
}
export function mountImportRoutes(app, store, validate) {
  const { db, list, save, atomic } = store;
  app.post("/api/import/columns", (req, res, next) => {
    try {
      const { headers, rows } = readCsv(req.body.csv);
      res.json({
        headers,
        sample: rows.slice(0, 3),
        count: rows.length,
        fields: importFields,
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/import/preview", async (req, res, next) => {
    try {
      const { headers, rows } = readCsv(req.body.csv);
      const mapping =
        req.body.mapping ||
        Object.fromEntries(
          importFields.filter((f) => headers.includes(f)).map((f) => [f, f]),
        );
      if (!mapping || typeof mapping !== "object" || Array.isArray(mapping))
        throw new HttpError(400, "Invalid column mapping");
      for (const [field, column] of Object.entries(mapping))
        if (
          !importFields.includes(field) ||
          typeof column !== "string" ||
          (column && !headers.includes(column))
        )
          throw new HttpError(400, "Invalid column mapping");
      if (!mapping.company || !mapping.title)
        throw new HttpError(
          400,
          "Map Company and Role title before previewing",
        );
      const format = req.body.dateFormat || "ISO";
      if (!["ISO", "MDY", "DMY"].includes(format))
        throw new HttpError(400, "Choose a supported date format");
      const existing = await list(req.user.id, "application"),
        seen = [];
      const preview = await _mapAsync(rows, async (row, index) => {
        try {
          const raw = Object.fromEntries(
            Object.entries(mapping)
              .filter(([, v]) => v)
              .map(([field, column]) => [field, row[headers.indexOf(column)]]),
          );
          for (const key of Object.keys(raw))
            if (raw[key] === "") delete raw[key];
          const data = await validate(req.user, "application", {
            ...raw,
            stage: raw.stage || "Saved",
            appliedDate: interpretedDate(raw.appliedDate, format),
            offerReceivedDate: interpretedDate(raw.offerReceivedDate, format),
            offerDecisionDate: interpretedDate(raw.offerDecisionDate, format),
            descriptionCapturedDate: interpretedDate(
              raw.descriptionCapturedDate,
              format,
            ),
            archived: raw.archived === "true",
          });
          const match = [...existing, ...seen].find((a) =>
            duplicateReason(a, data),
          );
          seen.push({ ...data, id: `row-${index + 2}` });
          return {
            row: index + 2,
            data,
            duplicate: !!match,
            reason: match ? duplicateReason(match, data) : null,
            matchId: match?.id || null,
          };
        } catch (e) {
          return { row: index + 2, error: e.message };
        }
      });
      await db
        .prepare("DELETE FROM import_batches WHERE user_id=? AND expires<?")
        .run(req.user.id, Date.now());
      const usage = await db
        .prepare(
          "SELECT count(*) n,COALESCE(sum(length(CAST(rows AS BLOB))),0) bytes FROM import_batches WHERE user_id=?",
        )
        .get(req.user.id);
      if (
        usage.n >= 100 ||
        usage.bytes + Buffer.byteLength(JSON.stringify(preview)) >
          10 * 1024 * 1024
      )
        throw new HttpError(
          413,
          "Import preview limit reached. Wait for old previews to expire.",
        );
      const id = randomUUID();
      await db
        .prepare("INSERT INTO import_batches VALUES(?,?,?,?,?,?)")
        .run(
          id,
          req.user.id,
          JSON.stringify(preview),
          Date.now() + 3600000,
          null,
          null,
        );
      await db
        .prepare(
          "DELETE FROM import_batches WHERE user_id=? AND expires<? AND result IS NULL",
        )
        .run(req.user.id, Date.now());
      res.json({ id, rows: preview, dateFormat: format });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/import/commit", async (req, res, next) => {
    try {
      const result = await atomic(async () => {
        if (typeof req.body.id !== "string" || req.body.id.length > 100)
          throw new HttpError(400, "Invalid preview ID");
        const batch = await db
          .prepare("SELECT * FROM import_batches WHERE id=? AND user_id=?")
          .get(req.body.id || "", req.user.id);
        if (!batch)
          throw Object.assign(new HttpError(400, "Import preview not found"), {
            status: 404,
          });
        if (batch.result)
          return { ...JSON.parse(batch.result), replayed: true };
        if (batch.expires < Date.now())
          throw new HttpError(400, "Preview expired. Preview your file again.");
        const decisions = req.body.decisions || {};
        if (
          !decisions ||
          typeof decisions !== "object" ||
          Array.isArray(decisions)
        )
          throw new HttpError(400, "Invalid row decisions");
        const rows = JSON.parse(batch.rows),
          existing = await list(req.user.id, "application");
        for (const [row, decision] of Object.entries(decisions))
          if (
            !rows.some((r) => String(r.row) === row) ||
            !["skip", "import", "keep"].includes(decision)
          )
            throw new HttpError(400, "Invalid row decision");
        let count = 0,
          skipped = 0;
        const ids = [];
        for (const row of rows) {
          if (row.error) {
            skipped++;
            continue;
          }
          const choice =
            decisions[row.row] || (row.duplicate ? "skip" : "import");
          if (choice === "skip") {
            skipped++;
            continue;
          }
          const match = existing.find((a) => duplicateReason(a, row.data));
          if (match && choice !== "keep")
            throw Object.assign(
              new HttpError(
                400,
                `Row ${row.row} now matches another application. Preview again and review duplicates.`,
              ),
              { status: 409 },
            );
          const data = await validate(req.user, "application", row.data);
          const saved = await save(
            req.user.id,
            "application",
            data,
            undefined,
            undefined,
            "csv import",
          );
          existing.push(saved);
          ids.push(saved.id);
          count++;
        }
        const result = { count, skipped, ids };
        await db
          .prepare(
            "UPDATE import_batches SET result=?,decisions=?,rows='[]',expires=? WHERE id=? AND user_id=?",
          )
          .run(
            JSON.stringify(result),
            JSON.stringify(decisions),
            Date.now() + 7 * 86400000,
            batch.id,
            req.user.id,
          );
        return result;
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });
}
