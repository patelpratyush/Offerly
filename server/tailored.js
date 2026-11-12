import { z } from "zod";
import { HttpError } from "./security.js";
import { readDocumentBody } from "./files.js";
import { buildDocx, docxText } from "./docx-text.js";
import { buildPdf, pdfText } from "./pdf-text.js";

// DOC 03/04 deterministic slice. Text is user-edited; the server never rewrites
// it, never edits a submitted version, and only appends a new immutable version.
const safeName = (value) =>
  (value || "document")
    .replace(/[^\w .-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100) || "document";
const tailoredInput = z.object({
  clientId: z.string().uuid(),
  applicationId: z.string().uuid(),
  baseDocumentId: z.string().uuid(),
  text: z.string().trim().min(1).max(60000),
  gaps: z.array(z.string().trim().max(500)).max(100).default([]),
  format: z.enum(["docx", "pdf"]).default("docx"),
});

export function mountTailored(app, store, config, limit, storeFile) {
  const { db, list, get, save, atomic } = store;
  const document = async (userId, id, kind) => {
    const row = await get(userId, id);
    if (!row || row.kind !== kind) return undefined;
    return { ...JSON.parse(row.data), id: row.id, version: row.version };
  };
  app.get("/api/prepare/document-text/:id", async (req, res, next) => {
    try {
      await limit("document-text:" + req.user.id, 30, 60000);
      const version = await document(req.user.id, req.params.id, "document");
      if (!version) throw new HttpError(404, "Document version not found");
      const file = await db
        .prepare("SELECT * FROM files WHERE id=? AND user_id=?")
        .get(version.fileId, req.user.id);
      if (!file) throw new HttpError(404, "File not found");
      if (config.production && !file.scanned_at)
        throw new HttpError(
          403,
          "This older document must be uploaded again for security screening",
        );
      if (/\.pdf$/i.test(file.name)) {
        const result = pdfText(await readDocumentBody(file, config));
        return res.json(
          result.available
            ? {
                ...result,
                notice:
                  "Extracted from a simple text-based PDF. Line breaks follow the PDF's layout; check it against the original and fix anything out of order.",
              }
            : result,
        );
      }
      if (!/\.docx$/i.test(file.name))
        return res.json({
          available: false,
          reason:
            "Text extraction is available for DOCX files and simple text-based PDFs only. Paste the resume text instead.",
        });
      res.json({
        available: true,
        text: await docxText(await readDocumentBody(file, config)),
        notice:
          "Extracted from the document's paragraphs. Check it against the original; tables and formatting are not included.",
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/prepare/export", async (req, res, next) => {
    try {
      await limit("prepare-export:" + req.user.id, 20, 60000);
      const input = z
        .object({
          text: z.string().min(1).max(60000),
          name: z.string().max(200).default("tailored-resume"),
          format: z.enum(["docx", "pdf"]).default("docx"),
        })
        .parse(req.body);
      const pdf = input.format === "pdf";
      res
        .set({
          "Content-Type": pdf
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName(input.name))}.${input.format}`,
        })
        .send(pdf ? buildPdf(input.text) : buildDocx(input.text));
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/prepare/tailored", async (req, res, next) => {
    try {
      await limit("prepare-tailored:" + req.user.id, 10, 60000);
      const input = tailoredInput.parse(req.body);
      const existing = async () =>
        (await list(req.user.id, "tailored_material")).find(
          (r) => r.clientId === input.clientId,
        );
      const replay = await existing();
      if (replay) return res.json(replay);
      const base = await document(
        req.user.id,
        input.baseDocumentId,
        "document",
      );
      if (!base)
        throw new HttpError(400, "Choose one of your document versions");
      if (!(await document(req.user.id, input.applicationId, "application")))
        throw new HttpError(400, "Choose one of your applications");
      const fileId = await storeFile(
        req.user.id,
        req.sessionHash,
        `${safeName(base.title)} - tailored.${input.format}`,
        input.format === "pdf" ? buildPdf(input.text) : buildDocx(input.text),
      );
      res.json(
        await atomic(async () => {
          const again = await existing();
          if (again) return again;
          const version = await save(req.user.id, "document", {
            title: base.title,
            fileId,
            applicationIds: [input.applicationId],
            label: "Tailored (edited text)",
            documentId: base.documentId || base.id,
          });
          return save(req.user.id, "tailored_material", {
            clientId: input.clientId,
            applicationId: input.applicationId,
            baseDocumentVersionId: base.id,
            documentVersionId: version.id,
            text: input.text,
            gaps: input.gaps,
            origin: "Edited by you. Not generated by a model.",
          });
        }),
      );
    } catch (e) {
      next(e);
    }
  });
}
