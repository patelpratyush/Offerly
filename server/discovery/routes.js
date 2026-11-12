import { z } from "zod";
import { HttpError } from "../security.js";
import { coverage } from "./registry.js";
import { VIEWS, listView, jobDetail, emptyFilters } from "./feed.js";
import { getProfile, saveProfile } from "./profile.js";
import { RUBRIC_VERSION, WEIGHTS } from "./scoring.js";
import {
  DISMISS_REASONS,
  saveJob,
  unsaveJob,
  dismissJob,
  restoreJob,
  setWatch,
  listSearches,
  createSearch,
  updateSearch,
  deleteSearch,
} from "./actions.js";
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  processAlerts,
  listNotifications,
  markRead,
} from "./alerts.js";
const id = z.string().uuid();
export function mountDiscovery(app, store) {
  const uid = (req) => req.user.id;
  app.get("/api/discovery/coverage", async (req, res) => {
    res.json(await coverage(store, uid(req)));
  });
  app.put("/api/discovery/companies/:id/watch", async (req, res) => {
    await setWatch(store, uid(req), id.parse(req.params.id), true);
    res.json({ ok: true });
  });
  app.delete("/api/discovery/companies/:id/watch", async (req, res) => {
    await setWatch(store, uid(req), id.parse(req.params.id), false);
    res.json({ ok: true });
  });
  app.get("/api/discovery/feed", async (req, res) => {
    const view = z.enum(VIEWS).parse(req.query.view || "best");
    let filters = {};
    if (req.query.filters) {
      if (String(req.query.filters).length > 4000)
        throw new HttpError(400, "Filters too large");
      try {
        filters = JSON.parse(String(req.query.filters));
      } catch {
        throw new HttpError(400, "Filters must be JSON");
      }
    }
    const paging = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).max(100000).default(0),
      })
      .parse(req.query);
    res.json(await listView(store, uid(req), view, filters, paging));
  });
  app.get("/api/discovery/filters/defaults", (req, res) => {
    res.json(emptyFilters());
  });
  app.get("/api/discovery/jobs/:id", async (req, res) => {
    const job = await jobDetail(store, uid(req), id.parse(req.params.id));
    if (!job) throw new HttpError(404, "Job not found");
    res.json(job);
  });
  app.put("/api/discovery/jobs/:id/save", async (req, res) => {
    await saveJob(store, uid(req), id.parse(req.params.id));
    res.json({ ok: true });
  });
  app.delete("/api/discovery/jobs/:id/save", async (req, res) => {
    await unsaveJob(store, uid(req), id.parse(req.params.id));
    res.json({ ok: true });
  });
  app.put("/api/discovery/jobs/:id/dismiss", async (req, res) => {
    const body = z
      .object({ reason: z.enum(DISMISS_REASONS) })
      .strict()
      .parse(req.body);
    await dismissJob(store, uid(req), id.parse(req.params.id), body.reason);
    res.json({ ok: true });
  });
  app.delete("/api/discovery/jobs/:id/dismiss", async (req, res) => {
    await restoreJob(store, uid(req), id.parse(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/discovery/profile", async (req, res) => {
    res.json({
      profile: await getProfile(store, uid(req)),
      rubric: { version: RUBRIC_VERSION, weights: WEIGHTS },
    });
  });
  app.put("/api/discovery/profile", async (req, res) => {
    res.json({ profile: await saveProfile(store, uid(req), req.body) });
  });
  app.get("/api/discovery/searches", async (req, res) => {
    res.json(await listSearches(store, uid(req)));
  });
  app.post("/api/discovery/searches", async (req, res) => {
    res.status(201).json(await createSearch(store, uid(req), req.body));
  });
  app.put("/api/discovery/searches/:id", async (req, res) => {
    await updateSearch(store, uid(req), id.parse(req.params.id), req.body);
    res.json({ ok: true });
  });
  app.delete("/api/discovery/searches/:id", async (req, res) => {
    await deleteSearch(store, uid(req), id.parse(req.params.id));
    res.json({ ok: true });
  });
  app.get("/api/discovery/alerts", async (req, res) => {
    res.json(await listRules(store, uid(req)));
  });
  app.post("/api/discovery/alerts", async (req, res) => {
    res.status(201).json(await createRule(store, uid(req), req.body));
  });
  app.put("/api/discovery/alerts/:id", async (req, res) => {
    await updateRule(store, uid(req), id.parse(req.params.id), req.body);
    res.json({ ok: true });
  });
  app.delete("/api/discovery/alerts/:id", async (req, res) => {
    await deleteRule(store, uid(req), id.parse(req.params.id));
    res.json({ ok: true });
  });
  // Evaluate only the caller's own rules; in-app delivery, nothing external.
  app.post("/api/discovery/alerts/process", async (req, res) => {
    res.json(await processAlerts(store, { userId: uid(req) }));
  });
  app.get("/api/discovery/notifications", async (req, res) => {
    res.json(await listNotifications(store, uid(req)));
  });
  app.post("/api/discovery/notifications/read", async (req, res) => {
    const body = z.object({ id: id.optional() }).strict().parse(req.body);
    await markRead(store, uid(req), body.id);
    res.json({ ok: true });
  });
}
