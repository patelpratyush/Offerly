import { createHash } from "node:crypto";
import { z } from "zod";
import { HttpError } from "./security.js";
import { readCsv } from "./imports.js";
import { contactSchema, normalizeContact } from "./contact-details.js";

// CON 03 P1: CSV contact import. Identity is never inferred from names: only a
// verified (user-confirmed) email counts as a duplicate; name-only matches are
// shown as suggestions and still import as separate, unverified contacts.
export const contactImportFields = [
  "name",
  "email",
  "company",
  "role",
  "phone",
  "linkedinUrl",
  "relationshipType",
  "notes",
];
const aliases = {
  name: ["name", "full name", "contact name"],
  email: ["email", "email address", "e-mail"],
  company: ["company", "employer", "organization"],
  role: ["role", "title", "job title", "position"],
  phone: ["phone", "phone number", "mobile"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedinurl", "linkedin profile"],
  relationshipType: ["relationship", "relationship type", "relationshiptype"],
  notes: ["notes", "note"],
};
const lower = (value) => (value || "").trim().toLowerCase();
const requestSchema = z.object({
  csv: z.string(),
  mapping: z.record(z.string(), z.string()).optional(),
});
function mappingFor(headers, supplied) {
  const mapping =
    supplied ||
    Object.fromEntries(
      contactImportFields.flatMap((field) => {
        const header = headers.find((h) => aliases[field].includes(lower(h)));
        return header ? [[field, header]] : [];
      }),
    );
  for (const [field, column] of Object.entries(mapping))
    if (
      !contactImportFields.includes(field) ||
      (column && !headers.includes(column))
    )
      throw new HttpError(400, "Invalid column mapping");
  if (!mapping.name) throw new HttpError(400, "Map the Name column first");
  return mapping;
}

export async function analyzeContactCsv(store, userId, body, now) {
  const input = requestSchema.parse(body);
  const { headers, rows } = readCsv(input.csv);
  const mapping = mappingFor(headers, input.mapping);
  const existing = await store.list(userId, "contact");
  const verified = new Map();
  for (const contact of existing) {
    if (contact.email && contact.emailConfirmed)
      verified.set(lower(contact.email), contact);
    for (const extra of contact.additionalEmails || [])
      if (extra.confirmed) verified.set(lower(extra.email), contact);
  }
  const importedEmails = new Set(
    existing
      .filter((c) => c.email && c.provenance?.email?.source === "Imported")
      .map((c) => lower(c.email)),
  );
  const importedNames = new Set(
    existing
      .filter((c) => !c.email && c.provenance?.name?.source === "Imported")
      .map((c) => `${lower(c.name)}|${lower(c.company)}`),
  );
  const seenEmails = new Set(),
    seenNames = new Set();
  const results = rows.map((row, index) => {
    const rowNumber = index + 2;
    const raw = {};
    for (const [field, column] of Object.entries(mapping))
      if (column) {
        const value = (row[headers.indexOf(column)] || "").trim();
        if (value) raw[field] = value;
      }
    const provenance = Object.fromEntries(
      Object.keys(raw).map((field) => [
        field,
        {
          source: "Imported",
          evidence: `CSV import, row ${rowNumber}`,
          confirmed: false,
        },
      ]),
    );
    const parsed = contactSchema.safeParse({
      ...raw,
      emailConfirmed: false,
      provenance,
    });
    if (!parsed.success)
      return {
        row: rowNumber,
        status: "invalid",
        errors: parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "row"}: ${i.message}`),
        input: raw,
      };
    const contact = normalizeContact(parsed.data, {}, now);
    const email = lower(contact.email),
      nameKey = `${lower(contact.name)}|${lower(contact.company)}`;
    const base = { row: rowNumber, input: raw, contact };
    if (email && verified.has(email))
      return {
        ...base,
        status: "duplicate",
        duplicateOf: {
          id: verified.get(email).id,
          name: verified.get(email).name,
        },
      };
    if (email ? importedEmails.has(email) : importedNames.has(nameKey))
      return { ...base, status: "already_imported" };
    if (email ? seenEmails.has(email) : seenNames.has(nameKey))
      return { ...base, status: "file_duplicate" };
    if (email) seenEmails.add(email);
    else seenNames.add(nameKey);
    const suggestions = existing
      .filter((c) => lower(c.name) === lower(contact.name))
      .slice(0, 3)
      .map((c) => ({ id: c.id, name: c.name, company: c.company }));
    return { ...base, status: "new", suggestions };
  });
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  return { headers, mapping, rows: results, counts };
}

export function mountContactImport(app, store) {
  const { list, save, atomic } = store;
  app.post("/api/import/contacts/preview", async (req, res, next) => {
    try {
      const result = await analyzeContactCsv(
        store,
        req.user.id,
        req.body,
        new Date().toISOString(),
      );
      res.json({
        ...result,
        note: "Only a user-confirmed email counts as the same person. Same-name matches are suggestions and are imported as separate, unverified contacts.",
      });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/import/contacts/commit", async (req, res, next) => {
    try {
      const operationId = z.string().uuid().parse(req.body.operationId);
      const fingerprint = createHash("sha256")
        .update(JSON.stringify([req.body.csv, req.body.mapping || null]))
        .digest("hex");
      res.json(
        await atomic(async () => {
          const receipt = (
            await list(req.user.id, "contact_import_receipt")
          ).find((r) => r.operationId === operationId);
          if (receipt) {
            if (receipt.fingerprint !== fingerprint)
              throw new HttpError(
                409,
                "This import ID was already used with different data",
              );
            return { ...receipt.result, replayed: true };
          }
          const now = new Date().toISOString();
          const analysis = await analyzeContactCsv(
            store,
            req.user.id,
            req.body,
            now,
          );
          const created = [];
          for (const row of analysis.rows)
            if (row.status === "new")
              created.push(
                (
                  await save(
                    req.user.id,
                    "contact",
                    row.contact,
                    undefined,
                    undefined,
                    "import",
                  )
                ).id,
              );
          const result = {
            created: created.length,
            createdIds: created,
            skipped: analysis.rows.length - created.length,
            counts: analysis.counts,
          };
          await save(req.user.id, "contact_import_receipt", {
            operationId,
            fingerprint,
            result,
            at: now,
          });
          return result;
        }),
      );
    } catch (e) {
      next(e);
    }
  });
}
