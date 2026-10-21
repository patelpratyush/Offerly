import { z } from "zod";
import { HttpError } from "./security.js";
export const documentUsageSchema = z.object({
  applicationId: z.string().uuid(),
  documentVersionId: z.string().uuid(),
  submittedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (value) =>
        !Number.isNaN(Date.parse(value)) &&
        new Date(value).toISOString().slice(0, 10) === value,
      "Enter a valid submission date",
    ),
  purpose: z.enum(["Resume", "Cover letter", "Other"]),
  notes: z.string().trim().max(10000).default(""),
  retracted: z.boolean().default(false),
});
// Submitted evidence is independent of library links. A later library version
// must never silently replace the exact bytes recorded as submitted.
export async function validateDocumentUsage(input, user, store) {
  const data = documentUsageSchema.parse(input);
  const application = await store.get(user.id, data.applicationId);
  const version = await store.get(user.id, data.documentVersionId);
  if (application?.kind !== "application")
    throw new HttpError(400, "Invalid application link");
  if (version?.kind !== "document")
    throw new HttpError(400, "Document version not found");
  const document = JSON.parse(version.data);
  const file = await store.db
    .prepare("SELECT id,hash,created_at FROM files WHERE id=? AND user_id=?")
    .get(document.fileId, user.id);
  if (!file) throw new HttpError(400, "Document file not found");
  return {
    ...data,
    title: document.title,
    fileId: file.id,
    documentHash: file.hash,
    documentVersionNumber: document.versionNumber || null,
    documentCreatedAt: document.createdAt || file.created_at,
  };
}
