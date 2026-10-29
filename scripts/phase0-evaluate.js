import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const id = z.string().min(1).max(100);
const event = z.enum([
  "confirmation",
  "assessment",
  "interview",
  "rejection",
  "offer",
]);
const goldSchema = z
  .object({
    version: z.literal(1),
    provenance: z.literal(
      "synthetic; authored labels; not independently human validated",
    ),
    examples: z
      .array(
        z
          .object({
            id,
            split: z.enum(["dev", "held-out"]),
            family: id,
            input: z
              .object({
                subject: z.string(),
                body: z.string(),
                receivedAt: z.iso.datetime(),
                applications: z.array(
                  z
                    .object({
                      id,
                      company: z.string(),
                      title: z.string(),
                      requisition: z.string(),
                    })
                    .strict(),
                ),
              })
              .strict(),
            expected: z
              .object({
                applicationId: id.nullable(),
                events: z.array(event),
                rationale: z.string(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const extendedEvents = [
  "confirmation", "assessment", "interview", "rejection", "offer",
  "review-update", "assessment-deadline", "availability-request",
  "scheduled-interview", "reschedule", "cancellation", "recruiter-request",
];
const extendedGoldSchema = z.object({
  version: z.literal(1),
  provenance: z.literal("synthetic; authored labels; not independently human validated"),
  examples: z.array(z.object({
    id,
    split: z.enum(["dev", "held-out"]),
    family: id,
    input: z.object({
      subject: z.string(), body: z.string(), receivedAt: z.iso.datetime(),
      applications: z.array(z.object({ id, company: z.string(), title: z.string(), requisition: z.string() }).strict()).min(1),
    }).strict(),
    expected: z.object({
      applicationId: id.nullable(),
      events: z.array(z.enum(extendedEvents)),
      rationale: z.string(),
    }).strict(),
  }).strict()).min(1),
}).strict();

export function validateExtendedFixtures(input) {
  const gold = extendedGoldSchema.parse(input);
  const ids = new Set();
  for (const item of gold.examples) {
    if (ids.has(item.id)) throw new Error("Duplicate extended fixture ID");
    ids.add(item.id);
    if (new Set(item.expected.events).size !== item.expected.events.length)
      throw new Error("Duplicate extended fixture event");
    if (item.expected.applicationId && !item.input.applications.some((app) => app.id === item.expected.applicationId))
      throw new Error("Unknown extended fixture application");
  }
  return { valid: true, examples: gold.examples.length, eventTypes: extendedEvents.length };
}
const predictionsSchema = z
  .object({
    version: z.literal(1),
    split: z.enum(["dev", "held-out"]),
    system: z.string().min(1),
    predictions: z.array(
      z
        .object({ id, applicationId: id.nullable(), events: z.array(event) })
        .strict(),
    ),
  })
  .strict();
export function wilson95(numerator, denominator) {
  if (!denominator) return null;
  const z = 1.959963984540054;
  const p = numerator / denominator;
  const z2 = z * z;
  const scale = 1 + z2 / denominator;
  const center = (p + z2 / (2 * denominator)) / scale;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator)) /
    scale;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}
const fraction = (numerator, denominator) => ({
  numerator,
  denominator,
  value: denominator ? numerator / denominator : null,
  wilson95: wilson95(numerator, denominator),
});
export function evaluate(goldInput, predictionsInput) {
  const gold = goldSchema.parse(goldInput);
  const supplied = predictionsSchema.parse(predictionsInput);
  const goldIds = new Set(),
    familySplits = new Map();
  for (const item of gold.examples) {
    if (goldIds.has(item.id)) throw new Error("Duplicate gold ID");
    goldIds.add(item.id);
    if (
      familySplits.has(item.family) &&
      familySplits.get(item.family) !== item.split
    )
      throw new Error("Family leaks across splits");
    familySplits.set(item.family, item.split);
    if (new Set(item.expected.events).size !== item.expected.events.length)
      throw new Error("Duplicate gold event");
    if (
      item.expected.applicationId &&
      !item.input.applications.some(
        (app) => app.id === item.expected.applicationId,
      )
    )
      throw new Error("Unknown gold application");
  }
  const items = gold.examples.filter((item) => item.split === supplied.split);
  if (!items.length) throw new Error("Empty evaluation split");
  const predictions = new Map();
  for (const prediction of supplied.predictions) {
    if (predictions.has(prediction.id))
      throw new Error("Duplicate prediction ID");
    if (!items.some((item) => item.id === prediction.id))
      throw new Error("Unknown or wrong-split prediction ID");
    if (new Set(prediction.events).size !== prediction.events.length)
      throw new Error("Duplicate predicted event");
    predictions.set(prediction.id, prediction);
  }
  if (predictions.size !== items.length)
    throw new Error(
      "Every split example requires prediction; use null and [] for abstention",
    );
  let links = 0,
    correctLinks = 0,
    eligibleLinks = 0,
    eventPredictions = 0,
    trueEvents = 0,
    expectedEvents = 0,
    abstentions = 0;
  const perEvent = Object.fromEntries(
    event.options.map((name) => [
      name,
      { correct: 0, predicted: 0, expected: 0 },
    ]),
  );
  for (const item of items) {
    const prediction = predictions.get(item.id);
    if (
      prediction.applicationId !== null &&
      !item.input.applications.some(
        (app) => app.id === prediction.applicationId,
      )
    )
      throw new Error("Unknown predicted application");
    if (item.expected.applicationId !== null) eligibleLinks++;
    if (prediction.applicationId !== null) {
      links++;
      if (prediction.applicationId === item.expected.applicationId)
        correctLinks++;
    }
    if (prediction.applicationId === null && !prediction.events.length)
      abstentions++;
    eventPredictions += prediction.events.length;
    expectedEvents += item.expected.events.length;
    for (const name of event.options) {
      const predicted = prediction.events.includes(name),
        expected = item.expected.events.includes(name);
      if (predicted) perEvent[name].predicted++;
      if (expected) perEvent[name].expected++;
      if (predicted && expected) {
        perEvent[name].correct++;
        trueEvents++;
      }
    }
  }
  return {
    system: supplied.system,
    split: supplied.split,
    synthetic: true,
    examples: items.length,
    applicationLinkPrecision: fraction(correctLinks, links),
    applicationLinkRecall: fraction(correctLinks, eligibleLinks),
    applicationLinkCoverage: fraction(links, items.length),
    fullAbstentionRate: fraction(abstentions, items.length),
    eventPrecision: fraction(trueEvents, eventPredictions),
    eventRecall: fraction(trueEvents, expectedEvents),
    perEvent: Object.fromEntries(
      Object.entries(perEvent).map(([name, counts]) => [
        name,
        {
          precision: fraction(counts.correct, counts.predicted),
          recall: fraction(counts.correct, counts.expected),
        },
      ]),
    ),
    limitation:
      "Synthetic offline extraction/link metrics only. No model, human relevance, auto-apply safety, date, or compensation validation claim.",
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 4)
      throw new Error(
        "Usage: node scripts/phase0-evaluate.js GOLD.json PREDICTIONS.json",
      );
    console.log(
      JSON.stringify(
        evaluate(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
          JSON.parse(readFileSync(process.argv[3], "utf8")),
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(
      error instanceof z.ZodError ? "Invalid evaluation schema" : error.message,
    );
    process.exitCode = 1;
  }
}

// Fit values are provisional author judgments; independent pilot review remains required.
export function evaluateFit(goldInput, predictionsInput) {
  const compensation = z
    .object({
      base: z.number().nonnegative().nullable(),
      total: z.number().nonnegative().nullable(),
      currency: z.string().length(3).nullable(),
    })
    .strict();
  const expected = z
    .object({
      eligibility: z
        .object({
          status: z.enum(["eligible", "ineligible", "unknown"]),
          reason: z.string(),
        })
        .strict(),
      provisionalFitRange: z
        .object({
          minimum: z.number().min(0).max(100),
          maximum: z.number().min(0).max(100),
        })
        .strict(),
      compensation,
      postedDate: z.iso.date().nullable(),
      confirmedLast24Hours: z.boolean(),
    })
    .strict();
  const gold = z
    .object({
      version: z.literal(1),
      provenance: z.literal(
        "synthetic; authored labels; not independently human validated",
      ),
      asOf: z.iso.datetime(),
      profile: z
        .object({
          approved: z.literal(true),
          skills: z.array(z.string()),
          yearsExperience: z.number().nonnegative(),
          workAuthorization: z.string(),
          location: z.string(),
          remote: z.boolean(),
        })
        .strict(),
      examples: z
        .array(
          z
            .object({
              id,
              split: z.enum(["dev", "held-out"]),
              family: id,
              title: z.string(),
              description: z.string(),
              postedAt: z
                .object({
                  value: z.iso.datetime(),
                  precision: z.literal("instant"),
                })
                .strict()
                .nullable(),
              expected,
            })
            .strict(),
        )
        .min(1),
    })
    .strict()
    .parse(goldInput);
  const supplied = z
    .object({
      version: z.literal(1),
      split: z.enum(["dev", "held-out"]),
      system: z.string().min(1),
      predictions: z.array(
        z
          .object({
            id,
            score: z.number().min(0).max(100).nullable(),
            eligibility: z.enum(["eligible", "ineligible", "unknown"]),
            evidence: z.array(z.string().min(1)).min(1),
            compensation,
            confirmedLast24Hours: z.boolean(),
          })
          .strict(),
      ),
    })
    .strict()
    .parse(predictionsInput);
  const ids = new Set(),
    families = new Map();
  for (const item of gold.examples) {
    if (ids.has(item.id)) throw new Error("Duplicate gold ID");
    ids.add(item.id);
    if (families.has(item.family) && families.get(item.family) !== item.split)
      throw new Error("Family leaks across splits");
    families.set(item.family, item.split);
    if (
      item.expected.provisionalFitRange.minimum >
      item.expected.provisionalFitRange.maximum
    )
      throw new Error("Invalid fit range");
    const posted = item.postedAt?.value ?? null;
    if (item.expected.postedDate !== (posted ? posted.slice(0, 10) : null))
      throw new Error("Posting date label lacks matching input evidence");
    const age = posted ? Date.parse(gold.asOf) - Date.parse(posted) : null;
    if (
      item.expected.confirmedLast24Hours !==
      (age !== null && age >= 0 && age <= 86400000)
    )
      throw new Error("Recency label disagrees with posting evidence");
    for (const field of ["base", "total"]) {
      const amount = item.expected.compensation[field];
      if (amount !== null && !item.description.includes(String(amount)))
        throw new Error("Compensation label lacks input amount evidence");
    }
    const currency = item.expected.compensation.currency;
    if (currency !== null && !item.description.includes(currency))
      throw new Error("Compensation label lacks input currency evidence");
  }
  const items = gold.examples.filter((item) => item.split === supplied.split);
  if (!items.length) throw new Error("Empty evaluation split");
  const predictions = new Map();
  for (const prediction of supplied.predictions) {
    if (predictions.has(prediction.id))
      throw new Error("Duplicate prediction ID");
    if (!items.some((item) => item.id === prediction.id))
      throw new Error("Unknown or wrong-split prediction ID");
    predictions.set(prediction.id, prediction);
  }
  if (predictions.size !== items.length)
    throw new Error("Every split example requires prediction");
  let eligibilityCorrect = 0,
    compensationCorrect = 0,
    recencyCorrect = 0,
    scores = 0,
    scoresInRange = 0;
  for (const item of items) {
    const predicted = predictions.get(item.id),
      label = item.expected;
    eligibilityCorrect += Number(
      predicted.eligibility === label.eligibility.status,
    );
    compensationCorrect += Number(
      ["base", "total", "currency"].every(
        (field) => predicted.compensation[field] === label.compensation[field],
      ),
    );
    recencyCorrect += Number(
      predicted.confirmedLast24Hours === label.confirmedLast24Hours,
    );
    if (predicted.score !== null) {
      scores++;
      scoresInRange += Number(
        predicted.score >= label.provisionalFitRange.minimum &&
          predicted.score <= label.provisionalFitRange.maximum,
      );
    }
  }
  return {
    system: supplied.system,
    split: supplied.split,
    synthetic: true,
    examples: items.length,
    eligibilityAccuracy: fraction(eligibilityCorrect, items.length),
    compensationExactAccuracy: fraction(compensationCorrect, items.length),
    recencyAccuracy: fraction(recencyCorrect, items.length),
    scoreCoverage: fraction(scores, items.length),
    provisionalRangeAgreement: fraction(scoresInRange, scores),
    limitation:
      "Author-assigned synthetic ranges only; evidence text presence is checked but truth is not machine verified; no human relevance or recommendation usefulness claim.",
  };
}
