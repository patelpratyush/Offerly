import { z } from "zod";
import { HttpError } from "./security.js";
import {
  templates,
  tones,
  generateDraft,
  findPlaceholders,
} from "./message-templates.js";

// Phase 4 preparation records. Everything is owner-scoped, version-checked and
// manually authored: no model, no sending, no email scopes.
const text = (max) => z.string().trim().max(max);
const uuid = z.string().uuid();
const optionalUrl = z
  .union([
    z.literal(""),
    z
      .string()
      .max(2048)
      .url()
      .refine((value) => {
        const parsed = new URL(value);
        return (
          ["https:", "http:"].includes(parsed.protocol) &&
          !parsed.username &&
          !parsed.password
        );
      }, "Use an HTTP or HTTPS URL without embedded credentials"),
  ])
  .default("");
export const sensitiveCategories = [
  "eligibility",
  "sponsorship",
  "salary",
  "relocation",
  "start_date",
];
export const answerSchema = z.object({
  clientId: uuid.optional(),
  question: text(500).min(1),
  category: z
    .enum(["experience", "preference", "other", ...sensitiveCategories])
    .default("other"),
  answer: text(10000).default(""),
  characterLimit: z.number().int().min(1).max(100000).nullable().default(null),
  provenance: z
    .enum([
      "Written by me",
      "Copied from an application form",
      "From my resume or documents",
      "Other",
    ])
    .default("Written by me"),
  provenanceNote: text(500).default(""),
  confirmed: z.boolean().default(false),
  confirmedValue: text(10000).optional(),
  archived: z.boolean().default(false),
});
const person = z.object({
  name: text(200).min(1),
  role: text(200).default(""),
  contactId: z.union([z.literal(""), uuid]).default(""),
});
export const prepSchema = z.object({
  clientId: uuid.optional(),
  applicationId: uuid,
  roundId: uuid,
  roleDescriptionUrl: optionalUrl,
  roleDescriptionNote: text(5000).default(""),
  people: z.array(person).max(20).default([]),
  logistics: z
    .object({
      format: text(200).default(""),
      location: text(500).default(""),
      link: optionalUrl,
      notes: text(5000).default(""),
    })
    .default({ format: "", location: "", link: "", notes: "" }),
  notes: text(10000).default(""),
  projectExamples: text(10000).default(""),
  practiceQuestions: z
    .array(
      z.object({
        question: text(1000).min(1),
        myNotes: text(5000).default(""),
      }),
    )
    .max(50)
    .default([]),
  postInterviewNotes: text(10000).default(""),
  archived: z.boolean().default(false),
});
export const draftSchema = z.object({
  clientId: uuid.optional(),
  template: z.enum(templates),
  applicationId: uuid,
  roundId: z.union([z.literal(""), uuid]).default(""),
  contactIds: z.array(uuid).max(10).default([]),
  subject: text(300).default(""),
  body: text(10000).default(""),
  state: z.enum(["draft", "ready"]).default("draft"),
  archived: z.boolean().default(false),
});

const parse = (row) => ({
  ...JSON.parse(row.data),
  id: row.id,
  version: row.version,
});
async function owned(store, user, id, kind) {
  const row = await store.get(user.id, id);
  if (!row || row.kind !== kind) return undefined;
  return parse(row);
}
async function requireOwned(store, user, id, kind, message) {
  const record = await owned(store, user, id, kind);
  if (!record) throw new HttpError(400, message);
  return record;
}

export function normalizeAnswer(
  input,
  previous,
  now = new Date().toISOString(),
) {
  const data = { ...input };
  const sensitive = sensitiveCategories.includes(data.category);
  const count = [...data.answer].length;
  if (data.characterLimit && count > data.characterLimit)
    throw new HttpError(
      400,
      `Answer is ${count} characters; the limit is ${data.characterLimit}`,
    );
  if (previous && previous.category !== data.category && sensitive)
    data.confirmed = false;
  const confirmedNow =
    data.confirmed && !!data.answer && data.confirmedValue === data.answer;
  const stillConfirmed =
    data.confirmed &&
    !!previous?.confirmed &&
    previous.answer === data.answer &&
    previous.category === data.category;
  if (sensitive && data.answer && !confirmedNow && !stillConfirmed)
    throw new HttpError(
      400,
      "Eligibility, sponsorship, salary, relocation and start-date answers need you to confirm this exact value. Leave the answer blank if you have not decided.",
    );
  const confirmed = confirmedNow || stillConfirmed;
  delete data.confirmedValue;
  return {
    ...data,
    confirmed,
    lastConfirmedAt: confirmedNow
      ? now
      : stillConfirmed
        ? previous.lastConfirmedAt || ""
        : "",
    characterCount: count,
    unanswered: !data.answer,
  };
}

async function validateAnswer(ctx, input, previous) {
  return normalizeAnswer(input, previous);
}
async function validatePrep({ store, user, list }, input, previous) {
  const application = await requireOwned(
    store,
    user,
    input.applicationId,
    "application",
    "Choose one of your applications",
  );
  const round = await requireOwned(
    store,
    user,
    input.roundId,
    "round",
    "Choose one of your interview rounds",
  );
  if (round.applicationId !== application.id)
    throw new HttpError(400, "That round belongs to a different application");
  if (
    previous &&
    (previous.applicationId !== input.applicationId ||
      previous.roundId !== input.roundId)
  )
    throw new HttpError(400, "A preparation page cannot move to another round");
  for (const p of input.people)
    if (p.contactId)
      await requireOwned(
        store,
        user,
        p.contactId,
        "contact",
        "Unknown contact",
      );
  const existing = (await list("interview_prep")).find(
    (r) => r.roundId === input.roundId && r.id !== previous?.id && !r.archived,
  );
  if (existing && !input.archived)
    throw new HttpError(409, "This round already has a preparation page");
  return input;
}
async function validateDraft({ store, user }, input, previous) {
  const application = await requireOwned(
    store,
    user,
    input.applicationId,
    "application",
    "Choose one of your applications",
  );
  if (previous && previous.applicationId !== input.applicationId)
    throw new HttpError(400, "A draft cannot move to another application");
  let round;
  if (input.roundId) {
    round = await requireOwned(
      store,
      user,
      input.roundId,
      "round",
      "Choose one of your interview rounds",
    );
    if (round.applicationId !== application.id)
      throw new HttpError(400, "That round belongs to a different application");
  }
  if (new Set(input.contactIds).size !== input.contactIds.length)
    throw new HttpError(400, "Recipients must be unique");
  const contacts = [];
  for (const id of input.contactIds)
    contacts.push(
      await requireOwned(store, user, id, "contact", "Unknown recipient"),
    );
  if (input.state === "ready") {
    if (!input.subject || !input.body)
      throw new HttpError(400, "A ready draft needs a subject and body");
    if (!contacts.some((c) => c.email))
      throw new HttpError(
        400,
        "A ready draft needs at least one recipient with an email address",
      );
    const open = findPlaceholders(input.subject, input.body);
    if (open.length)
      throw new HttpError(
        400,
        `Replace every [[placeholder]] before marking ready (${open.length} left)`,
      );
  }
  return input;
}

const definitions = {
  answers: { kind: "answer", schema: answerSchema, validate: validateAnswer },
  preps: { kind: "interview_prep", schema: prepSchema, validate: validatePrep },
  drafts: {
    kind: "message_draft",
    schema: draftSchema,
    validate: validateDraft,
  },
};
export const preparationKinds = Object.values(definitions).map((d) => d.kind);

export function mountPreparation(app, store, limit) {
  const { list, save, atomic } = store;
  app.get("/api/prepare", async (req, res, next) => {
    try {
      res.json({
        answers: await list(req.user.id, "answer"),
        preps: await list(req.user.id, "interview_prep"),
        drafts: await list(req.user.id, "message_draft"),
        tailored: await list(req.user.id, "tailored_material"),
      });
    } catch (e) {
      next(e);
    }
  });
  for (const [name, def] of Object.entries(definitions)) {
    const context = (user) => ({
      store,
      user,
      list: (kind) => list(user.id, kind),
    });
    app.post(`/api/prepare/${name}`, async (req, res, next) => {
      try {
        await limit("prepare:" + req.user.id, 120, 60000);
        const input = def.schema.parse(req.body);
        res.json(
          await atomic(async () => {
            if (input.clientId) {
              // Retried creates return the first result instead of duplicating.
              const existing = (await list(req.user.id, def.kind)).find(
                (r) => r.clientId === input.clientId,
              );
              if (existing) return existing;
            }
            const data = await def.validate(context(req.user), input);
            return save(req.user.id, def.kind, data);
          }),
        );
      } catch (e) {
        next(e);
      }
    });
    app.put(`/api/prepare/${name}/:id`, async (req, res, next) => {
      try {
        await limit("prepare:" + req.user.id, 120, 60000);
        const version = z.number().int().positive().parse(req.body.version);
        const input = def.schema.parse(req.body);
        res.json(
          await atomic(async () => {
            const previous = await owned(
              store,
              req.user,
              req.params.id,
              def.kind,
            );
            if (!previous) throw new HttpError(404, "Record not found");
            if (previous.version !== version)
              throw new HttpError(
                409,
                "Changed in another window. Refresh before saving.",
              );
            const data = await def.validate(context(req.user), input, previous);
            // Server-owned identity survives edits.
            if (previous.clientId) data.clientId = previous.clientId;
            return save(req.user.id, def.kind, data, previous.id, version);
          }),
        );
      } catch (e) {
        next(e);
      }
    });
  }
  // Deterministic template fill from selected real records. Nothing is stored.
  app.post("/api/prepare/drafts/generate", async (req, res, next) => {
    try {
      const input = z
        .object({
          template: z.enum(templates),
          applicationId: uuid,
          roundId: z.union([z.literal(""), uuid]).default(""),
          contactIds: z.array(uuid).max(10).default([]),
          tone: z.enum(tones).default("standard"),
        })
        .parse(req.body);
      const application = await requireOwned(
        store,
        req.user,
        input.applicationId,
        "application",
        "Choose one of your applications",
      );
      const round = input.roundId
        ? await requireOwned(
            store,
            req.user,
            input.roundId,
            "round",
            "Choose one of your interview rounds",
          )
        : undefined;
      if (round && round.applicationId !== application.id)
        throw new HttpError(
          400,
          "That round belongs to a different application",
        );
      const contacts = [];
      for (const id of input.contactIds)
        contacts.push(
          await requireOwned(
            store,
            req.user,
            id,
            "contact",
            "Unknown recipient",
          ),
        );
      res.json(
        generateDraft({
          template: input.template,
          application,
          contacts,
          round,
          userName: req.user.name,
          tone: input.tone,
        }),
      );
    } catch (e) {
      next(e);
    }
  });
}
