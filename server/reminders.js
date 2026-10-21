import { z } from "zod";
import { HttpError } from "./security.js";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const sourceKinds = ["application", "round", "assessment", "task"];
const createSchema = z
  .object({
    operationId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    applicationId: z.uuid(),
    sourceKind: z.enum(sourceKinds),
    sourceId: z.uuid(),
    dueDate: date,
  })
  .strict();
const actionSchema = z
  .object({
    operationId: z.uuid(),
    version: z.number().int().positive(),
    action: z.enum(["dismiss", "snooze", "cancel"]),
    dueDate: date.optional(),
  })
  .strict();
const active = (data) => ["scheduled", "due"].includes(data.state);
const unpack = (row) =>
  row && { ...JSON.parse(row.data), id: row.id, version: row.version };
const signature = (kind, data) =>
  JSON.stringify(
    kind === "round"
      ? [data.status, data.date || "", data.time || "", data.timezone || ""]
      : kind === "assessment"
        ? [data.status, data.due || "", data.completedDate || ""]
        : kind === "task"
          ? [!!data.done, data.due || ""]
          : [
              !!data.archived,
              ["Rejected", "Withdrawn"].includes(data.stage),
              data.offerOutcome || "Not recorded",
            ],
  );
async function source(store, userId, data) {
  const appRow = await store.get(userId, data.applicationId),
    row = await store.get(userId, data.sourceId);
  if (
    !appRow ||
    appRow.kind !== "application" ||
    !row ||
    row.kind !== data.sourceKind
  )
    throw new HttpError(404, "Reminder source not found");
  const application = unpack(appRow),
    item = unpack(row);
  if (
    (data.sourceKind === "application" && item.id !== application.id) ||
    (data.sourceKind !== "application" && item.applicationId !== application.id)
  )
    throw new HttpError(
      400,
      "Reminder source must belong to the selected application",
    );
  const closedApp =
    application.archived ||
    ["Rejected", "Withdrawn"].includes(application.stage) ||
    ["Accepted", "Declined"].includes(application.offerOutcome);
  const unavailable =
    data.sourceKind === "task"
      ? item.done
      : closedApp ||
        (data.sourceKind === "round" &&
          ["Canceled", "Completed"].includes(item.status)) ||
        (data.sourceKind === "assessment" &&
          ["Canceled", "Completed"].includes(item.status));
  return { signature: signature(data.sourceKind, item), unavailable };
}
async function localDate(store, userId, now) {
  const user = await store.db
    .prepare("SELECT timezone FROM users WHERE id=?")
    .get(userId);
  if (!user) throw new HttpError(404, "Account not found");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: user.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
async function refreshOne(store, userId, item, now) {
  if (!active(item)) return false;
  let cancellation = "";
  try {
    const current = await source(store, userId, item);
    if (current.unavailable)
      cancellation = "Source completed, canceled, or application closed";
    else if (current.signature !== item.sourceSignature)
      cancellation =
        "Source occurrence changed; create a reminder for the new occurrence";
  } catch (error) {
    if (error.status !== 404 && error.status !== 400) throw error;
    cancellation = "Source no longer available";
  }
  const state = cancellation
    ? "canceled"
    : item.dueDate <= (await localDate(store, userId, now))
      ? "due"
      : "scheduled";
  if (state === item.state) return false;
  const { id, version, ...data } = item;
  await store.save(
    userId,
    "reminder",
    {
      ...data,
      state,
      cancellationReason: cancellation,
      updatedAt: now.toISOString(),
    },
    id,
    version,
    "reminder_scheduler",
  );
  return true;
}
const cursors = new WeakMap();
export async function processReminders(
  store,
  {
    now = new Date(),
    userId,
    deadline = Infinity,
    cursor: suppliedCursor,
  } = {},
) {
  now = new Date(now);
  if (!Number.isFinite(now.getTime()))
    throw new TypeError("Invalid scheduler time");
  const cursor = userId ? "" : (suppliedCursor ?? cursors.get(store) ?? "");
  const rows = await store.db
    .prepare(
      `SELECT * FROM records WHERE kind='reminder' AND json_extract(data,'$.state') IN ('scheduled','due') ${userId ? "AND user_id=?" : "AND id>?"} ORDER BY id LIMIT 500`,
    )
    .all(userId || cursor);
  let changed = 0,
    failed = 0,
    processed = 0,
    nextCursor = cursor;
  for (const row of rows) {
    if (Date.now() >= deadline) break;
    processed++;
    nextCursor = row.id;
    try {
      changed += Number(await refreshOne(store, row.user_id, unpack(row), now));
    } catch {
      failed++;
    }
  }
  if (processed === rows.length && rows.length < 500) nextCursor = "";
  if (!userId && suppliedCursor === undefined) cursors.set(store, nextCursor);
  return { processed, changed, failed, nextCursor };
}
export async function reconcileReminders(
  store,
  userId,
  kind,
  before,
  after,
  id,
) {
  if (!sourceKinds.includes(kind)) return;
  const rows = await store.db
    .prepare(
      "SELECT * FROM records WHERE user_id=? AND kind='reminder' AND json_extract(data,'$.state') IN ('scheduled','due') AND (json_extract(data,'$.sourceId')=? OR json_extract(data,'$.applicationId')=?) LIMIT 501",
    )
    .all(userId, id, id);
  if (rows.length > 500)
    throw new HttpError(413, "Too many active reminders to reconcile");
  for (const row of rows)
    await refreshOne(store, userId, unpack(row), new Date());
}
async function operation(store, userId, operationId, payload, fn) {
  return await store.atomic(async () => {
    const key = JSON.stringify(payload);
    const row = await store.db
      .prepare(
        "SELECT data FROM records WHERE user_id=? AND kind='reminder_operation' AND json_extract(data,'$.operationId')=? LIMIT 1",
      )
      .get(userId, operationId);
    if (row) {
      const old = JSON.parse(row.data);
      if (old.payload !== key)
        throw new HttpError(
          409,
          "Operation ID was already used for a different request",
        );
      return old.result;
    }
    const result = await fn();
    await store.save(
      userId,
      "reminder_operation",
      { operationId, payload: key, result },
      undefined,
      undefined,
      "reminder_operation",
    );
    return result;
  });
}
export function mountReminders(app, store) {
  app.get("/api/reminders", async (req, res) => {
    res.json(await store.list(req.user.id, "reminder"));
  });
  app.post("/api/reminders", async (req, res) => {
    const body = createSchema.parse(req.body),
      userId = req.user.id;
    const result = await operation(
      store,
      userId,
      body.operationId,
      { type: "create", ...body },
      async () => {
        if (
          (
            await store.db
              .prepare(
                "SELECT count(*) n FROM records WHERE user_id=? AND kind='reminder' AND json_extract(data,'$.state') IN ('scheduled','due')",
              )
              .get(userId)
          ).n >= 100
        )
          throw new HttpError(413, "Limit of 100 active reminders reached");
        const current = await source(store, userId, body);
        if (current.unavailable)
          throw new HttpError(
            409,
            "This source is already completed or canceled",
          );
        const data = { ...body };
        delete data.operationId;
        const now = new Date();
        return await store.save(
          userId,
          "reminder",
          {
            ...data,
            precision: "date",
            sourceSignature: current.signature,
            state:
              body.dueDate <= (await localDate(store, userId, now))
                ? "due"
                : "scheduled",
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            cancellationReason: "",
          },
          undefined,
          undefined,
          "reminder_created",
        );
      },
    );
    res.status(201).json(result);
  });
  app.post("/api/reminders/:id/action", async (req, res) => {
    const id = z.uuid().parse(req.params.id),
      body = actionSchema.parse(req.body),
      userId = req.user.id;
    if ((body.action === "snooze") !== !!body.dueDate)
      throw new HttpError(400, "Only snooze requires a new date");
    const result = await operation(
      store,
      userId,
      body.operationId,
      { type: "action", id, ...body },
      async () => {
        const row = await store.get(userId, id);
        if (!row || row.kind !== "reminder")
          throw new HttpError(404, "Reminder not found");
        const item = unpack(row);
        if (item.version !== body.version)
          throw new HttpError(
            409,
            "Reminder changed. Refresh before continuing.",
          );
        if (!active(item))
          throw new HttpError(409, "Reminder is no longer active");
        const current = await source(store, userId, item);
        if (current.unavailable || current.signature !== item.sourceSignature)
          throw new HttpError(
            409,
            "Reminder source changed. Refresh before continuing.",
          );
        const today = await localDate(store, userId, new Date());
        if (body.action === "snooze" && body.dueDate <= today)
          throw new HttpError(
            400,
            "Choose a snooze date after today in your workspace timezone",
          );
        const data = { ...item };
        delete data.id;
        delete data.version;
        return await store.save(
          userId,
          "reminder",
          {
            ...data,
            dueDate: body.dueDate || data.dueDate,
            state:
              body.action === "dismiss"
                ? "dismissed"
                : body.action === "cancel"
                  ? "canceled"
                  : "scheduled",
            updatedAt: new Date().toISOString(),
          },
          id,
          body.version,
          `reminder_${body.action}`,
        );
      },
    );
    res.json(result);
  });
}
