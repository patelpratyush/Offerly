import { z } from "zod";
import { stringify } from "csv-stringify/sync";
import { dayNumber } from "./zoned-time.js";
// ANA 01: descriptive aggregates from the caller's own records only. Every
// metric states numerator, denominator and sample size. Unknown dates are
// excluded and counted, never treated as zero.
const SMALL_SAMPLE = 30;
const NOTE =
  "Descriptive only, small sample. These figures describe your own records and cannot show that a source or document version caused an outcome.";
const VERIFIED_ROUND = ["Scheduled", "Completed", "Rescheduled"];
const OFFER_STAGE = "Offer";
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
const weekOf = (date) => {
  const n = dayNumber(date);
  // 1970-01-01 was a Thursday; shift so weeks begin on Monday.
  const monday = n - ((n + 3) % 7);
  return new Date(monday * 86400000).toISOString().slice(0, 10);
};
const median = (values) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b),
    m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const rate = (n, d) => (d ? n / d : null);
const quantity = (values, unit = "days") => ({
  sampleSize: values.length,
  median: median(values),
  min: values.length ? Math.min(...values) : null,
  max: values.length ? Math.max(...values) : null,
  unit,
});
function group(items) {
  const submitted = items.length,
    interview = items.filter((i) => i.interview).length,
    offer = items.filter((i) => i.offer).length;
  return {
    submitted,
    interview,
    offer,
    interviewRate: rate(interview, submitted),
    offerRate: rate(offer, submitted),
    smallSample: submitted < SMALL_SAMPLE,
  };
}
export async function computeInsights(store, userId, range = {}) {
  const list = (kind) => store.list(userId, kind);
  const [applications, rounds, usages, documents, assessments] =
    await Promise.all([
      list("application"),
      list("round"),
      list("document_usage"),
      list("document"),
      list("assessment"),
    ]);
  const history = await store.db
    .prepare(
      `SELECT e.record_id id,e.at at,json_extract(e.after_data,'$.stage') stage
       FROM events e JOIN records r ON r.id=e.record_id AND r.user_id=e.user_id
       WHERE e.user_id=? AND r.kind='application' ORDER BY e.at,e.rowid`,
    )
    .all(userId);
  const stageEvents = new Map();
  for (const h of history) {
    if (!stageEvents.has(h.id)) stageEvents.set(h.id, []);
    stageEvents.get(h.id).push({ at: h.at, stage: h.stage });
  }
  const versions = new Map(documents.map((d) => [d.id, d]));
  const byApp = (items) => {
    const m = new Map();
    for (const i of items) {
      if (!m.has(i.applicationId)) m.set(i.applicationId, []);
      m.get(i.applicationId).push(i);
    }
    return m;
  };
  const roundsByApp = byApp(rounds),
    usagesByApp = byApp(usages.filter((u) => !u.retracted)),
    assessmentsByApp = byApp(assessments);
  let unknownSubmissionDate = 0,
    outsideRange = 0,
    responseUnknownStart = 0;
  const cohort = [],
    submissionEvents = [];
  for (const app of applications) {
    const used = (usagesByApp.get(app.id) || []).filter((u) =>
      isDate(u.submittedDate),
    );
    const dates = [...new Set(used.map((u) => u.submittedDate))].sort();
    const eventDates = dates.length
      ? dates
      : isDate(app.appliedDate)
        ? [app.appliedDate]
        : [];
    if (!eventDates.length) {
      if (!["Saved", "Preparing"].includes(app.stage)) {
        unknownSubmissionDate++;
        if (
          roundsByApp.has(app.id) ||
          assessmentsByApp.has(app.id) ||
          (stageEvents.get(app.id) || []).some((v) =>
            ["Rejected", OFFER_STAGE].includes(v.stage),
          )
        )
          responseUnknownStart++;
      }
      continue;
    }
    const first = eventDates[0];
    if ((range.from && first < range.from) || (range.to && first > range.to)) {
      outsideRange++;
      continue;
    }
    for (const date of eventDates) submissionEvents.push({ app, date });
    const appRounds = (roundsByApp.get(app.id) || []).filter((r) =>
      VERIFIED_ROUND.includes(r.status),
    );
    const visits = stageEvents.get(app.id) || [];
    const offer =
      (app.offerOutcome && app.offerOutcome !== "Not recorded") ||
      isDate(app.offerReceivedDate) ||
      visits.some((v) => v.stage === OFFER_STAGE);
    cohort.push({
      app,
      first,
      used,
      interview: appRounds.length > 0,
      offer: !!offer,
      source: (app.source || "").trim() || "Not recorded",
    });
  }
  // Submissions per week and cohort conversion.
  const weeks = new Map();
  for (const e of submissionEvents) {
    const w = weekOf(e.date);
    weeks.set(w, (weeks.get(w) || 0) + 1);
  }
  const cohortWeeks = new Map();
  for (const c of cohort) {
    const w = weekOf(c.first);
    if (!cohortWeeks.has(w)) cohortWeeks.set(w, []);
    cohortWeeks.get(w).push(c);
  }
  const recordFirst = new Map();
  const itemIds = [...rounds, ...assessments].map((i) => i.id);
  if (itemIds.length) {
    const rows = await store.db
      .prepare(
        `SELECT e.record_id id,min(e.at) at FROM events e JOIN records r ON r.id=e.record_id AND r.user_id=e.user_id
         WHERE e.user_id=? AND r.kind IN ('round','assessment') GROUP BY e.record_id`,
      )
      .all(userId);
    for (const r of rows) recordFirst.set(r.id, r.at);
  }
  const firstEventAt = (id) => recordFirst.get(id);
  // Time to first response: submission date to the first employer-driven record
  // (interview round, assessment, rejection or offer). Uses the date Offerly
  // recorded the response, which can lag the real one.
  const responseDays = [];
  let responseNone = 0,
    responseChronology = 0;
  for (const c of cohort) {
    const cand = [];
    for (const item of [
      ...(roundsByApp.get(c.app.id) || []),
      ...(assessmentsByApp.get(c.app.id) || []),
    ]) {
      const ev = firstEventAt(item.id);
      if (ev) cand.push(ev);
    }
    for (const v of stageEvents.get(c.app.id) || [])
      if (["Rejected", OFFER_STAGE].includes(v.stage)) {
        cand.push(v.at);
        break;
      }
    if (!cand.length) {
      responseNone++;
      continue;
    }
    const at = cand.sort()[0].slice(0, 10);
    const days = dayNumber(at) - dayNumber(c.first);
    if (days < 0) {
      responseChronology++;
      continue;
    }
    responseDays.push(days);
  }
  // Time in stage from consecutive recorded stage changes. Open visits excluded.
  const appIds = new Set(applications.map((a) => a.id));
  const stageDurations = new Map();
  let openVisits = 0;
  for (const [id, events] of stageEvents) {
    if (!appIds.has(id)) continue;
    const visits = [];
    for (const e of events)
      if (!visits.length || visits.at(-1).stage !== e.stage)
        visits.push({ stage: e.stage, at: e.at });
    visits.forEach((v, i) => {
      if (!v.stage) return;
      if (i === visits.length - 1) {
        openVisits++;
        return;
      }
      const days = (Date.parse(visits[i + 1].at) - Date.parse(v.at)) / 86400000;
      if (!Number.isFinite(days) || days < 0) return;
      if (!stageDurations.has(v.stage)) stageDurations.set(v.stage, []);
      stageDurations.get(v.stage).push(days);
    });
  }
  const bySource = new Map(),
    byVersion = new Map();
  for (const c of cohort) {
    if (!bySource.has(c.source)) bySource.set(c.source, []);
    bySource.get(c.source).push(c);
    const resumes = c.used.filter((u) => u.purpose === "Resume");
    const keys = new Map();
    for (const u of resumes) {
      const v = versions.get(u.documentVersionId);
      const number = u.documentVersionNumber || v?.versionNumber;
      keys.set(
        u.documentVersionId,
        `${u.title || v?.title || "Resume"}${number ? " v" + number : ""}`,
      );
    }
    if (!keys.size) keys.set("none", "No resume version recorded");
    for (const [key, label] of keys) {
      if (!byVersion.has(key)) byVersion.set(key, { label, items: [] });
      byVersion.get(key).items.push(c);
    }
  }
  const sorted = (m) => [...m].sort((a, b) => b[1].length - a[1].length);
  return {
    generatedAt: new Date().toISOString(),
    range: { from: range.from || "", to: range.to || "" },
    note: NOTE,
    smallSampleThreshold: SMALL_SAMPLE,
    totals: {
      applications: applications.length,
      uniqueSubmittedApplications: cohort.length,
      submissionEvents: submissionEvents.length,
      excluded: { unknownSubmissionDate, outsideRange },
    },
    submissionsPerWeek: [...weeks]
      .sort()
      .map(([weekStart, count]) => ({ weekStart, count })),
    conversion: {
      definition:
        "Cohort = unique applications with a known submission date (earliest recorded submission, else applied date). Interview = at least one Scheduled, Completed or Rescheduled round record. Offer = recorded offer fields or a recorded Offer stage.",
      overall: group(cohort),
      byWeek: [...cohortWeeks]
        .sort()
        .map(([weekStart, items]) => ({ weekStart, ...group(items) })),
    },
    timeToFirstResponse: {
      definition:
        "Days from submission date to the first recorded interview round, assessment, rejection or offer, using the date it was recorded in Offerly. Recording can lag the real response.",
      ...quantity(responseDays),
      excluded: {
        noResponseRecorded: responseNone,
        unknownSubmissionDate: responseUnknownStart,
        responseBeforeSubmission: responseChronology,
      },
    },
    timeInStage: {
      definition:
        "Days between consecutive recorded stage changes in the append-only history (recording time). Stages an application is still in are excluded.",
      stages: [...stageDurations]
        .map(([stage, v]) => ({ stage, ...quantity(v) }))
        .sort((a, b) => b.sampleSize - a.sampleSize),
      excluded: { stillInStage: openVisits },
    },
    bySource: sorted(bySource).map(([source, items]) => ({
      source,
      ...group(items),
    })),
    byDocumentVersion: [...byVersion.values()]
      .sort((a, b) => b.items.length - a.items.length)
      .map(({ label, items }) => ({ version: label, ...group(items) })),
    byDocumentVersionNote:
      "An application that used more than one resume version appears under each, so rows overlap and do not sum to the total.",
  };
}
const fmt = (v) => (v === null || v === undefined ? "" : v);
export function insightsCsv(i) {
  const rows = [];
  const push = (section, group, metric, num, den, rateValue, n, note = "") =>
    rows.push({
      section,
      group,
      metric,
      numerator: fmt(num),
      denominator: fmt(den),
      rate: rateValue === null ? "" : Number(rateValue.toFixed(4)),
      sampleSize: fmt(n),
      note,
    });
  const groupRows = (section, name, g) => {
    push(
      section,
      name,
      "interview conversion",
      g.interview,
      g.submitted,
      g.interviewRate,
      g.submitted,
      g.smallSample ? "descriptive only, small sample" : "descriptive only",
    );
    push(
      section,
      name,
      "offer conversion",
      g.offer,
      g.submitted,
      g.offerRate,
      g.submitted,
      g.smallSample ? "descriptive only, small sample" : "descriptive only",
    );
  };
  push(
    "totals",
    "all",
    "unique submitted applications",
    i.totals.uniqueSubmittedApplications,
    i.totals.applications,
    null,
    i.totals.uniqueSubmittedApplications,
    `excluded unknown submission date: ${i.totals.excluded.unknownSubmissionDate}`,
  );
  for (const w of i.submissionsPerWeek)
    push(
      "submissions per week",
      w.weekStart,
      "submissions",
      w.count,
      "",
      null,
      w.count,
    );
  groupRows("conversion", "all submitted", i.conversion.overall);
  for (const w of i.conversion.byWeek)
    groupRows("conversion by submission week", w.weekStart, w);
  push(
    "time to first response",
    "all",
    "median days",
    i.timeToFirstResponse.median,
    "",
    null,
    i.timeToFirstResponse.sampleSize,
    `excluded no response ${i.timeToFirstResponse.excluded.noResponseRecorded}; unknown submission date ${i.timeToFirstResponse.excluded.unknownSubmissionDate}`,
  );
  for (const s of i.timeInStage.stages)
    push(
      "time in stage",
      s.stage,
      "median days",
      s.median,
      "",
      null,
      s.sampleSize,
      "completed stage visits only",
    );
  for (const s of i.bySource) groupRows("outcomes by source", s.source, s);
  for (const v of i.byDocumentVersion)
    groupRows("outcomes by resume version", v.version, v);
  return stringify(rows, {
    header: true,
    columns: [
      "section",
      "group",
      "metric",
      "numerator",
      "denominator",
      "rate",
      "sampleSize",
      "note",
    ],
    escape_formulas: true,
  });
}
const rangeSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: "Start date must not follow end date",
  });
export function mountInsights(app, store, limit) {
  app.get("/api/insights", async (req, res) => {
    res.json(
      await computeInsights(store, req.user.id, rangeSchema.parse(req.query)),
    );
  });
  app.get("/api/insights.csv", async (req, res) => {
    await limit("export:" + req.user.id, 10, 3600000);
    const insights = await computeInsights(
      store,
      req.user.id,
      rangeSchema.parse(req.query),
    );
    res
      .type("text/csv")
      .attachment("offerly-insights.csv")
      .send(insightsCsv(insights));
  });
}
