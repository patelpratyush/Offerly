import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
const row = z
  .object({
    id: z.string().min(1),
    applicationId: z.string().nullable(),
    events: z.array(z.string().min(1)).max(20),
  })
  .strict();
function indexed(rows) {
  const parsed = z.array(row).parse(rows),
    map = new Map(parsed.map((r) => [r.id, r]));
  if (map.size !== parsed.length) throw new Error("Duplicate case IDs");
  for (const r of parsed)
    if (new Set(r.events).size !== r.events.length)
      throw new Error("Duplicate event labels");
  return map;
}
function rate(n, d) {
  if (!d) return { numerator: n, denominator: d, value: null, wilson95: null };
  const p = n / d,
    z = 1.959963984540054,
    k = 1 + (z * z) / d,
    mid = (p + (z * z) / (2 * d)) / k,
    half = (z * Math.sqrt((p * (1 - p)) / d + (z * z) / (4 * d * d))) / k;
  return {
    numerator: n,
    denominator: d,
    value: p,
    wilson95: [Math.max(0, mid - half), Math.min(1, mid + half)],
  };
}
// Offline only: inputs remain on disk; report contains aggregate metrics only.
export function evaluateRecruitingAi(goldRows, predictionRows) {
  const gold = indexed(goldRows),
    predictions = indexed(predictionRows);
  if (
    gold.size !== predictions.size ||
    [...gold.keys()].some((id) => !predictions.has(id))
  )
    throw new Error("Case IDs must match exactly");
  let links = 0,
    correctLinks = 0,
    tp = 0,
    fp = 0,
    fn = 0,
    exact = 0;
  const types = new Set(
    [...gold.values(), ...predictions.values()].flatMap((r) => r.events),
  );
  const perEvent = {};
  for (const type of types) {
    let a = 0,
      b = 0,
      c = 0;
    for (const [id, g] of gold) {
      const p = predictions.get(id),
        actual = g.events.includes(type),
        proposed = p.events.includes(type);
      if (actual && proposed) a++;
      if (proposed && !actual) b++;
      if (actual && !proposed) c++;
    }
    perEvent[type] = { precision: rate(a, a + b), recall: rate(a, a + c) };
    tp += a;
    fp += b;
    fn += c;
  }
  for (const [id, g] of gold) {
    const p = predictions.get(id);
    if (p.applicationId) {
      links++;
      if (p.applicationId === g.applicationId) correctLinks++;
    }
    if (
      g.applicationId === p.applicationId &&
      JSON.stringify([...g.events].sort()) ===
        JSON.stringify([...p.events].sort())
    )
      exact++;
  }
  return {
    cases: gold.size,
    applicationLinkPrecision: rate(correctLinks, links),
    linkCoverage: rate(links, gold.size),
    eventPrecision: rate(tp, tp + fp),
    eventRecall: rate(tp, tp + fn),
    exactAgreement: rate(exact, gold.size),
    perEvent,
    stageSafetyMeasured: false,
    productionQualityApproved: false,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length !== 4) throw new Error();
    const [gold, predictions] = await Promise.all(
      process.argv
        .slice(2)
        .map(async (p) => JSON.parse(await readFile(p, "utf8"))),
    );
    console.log(
      JSON.stringify(evaluateRecruitingAi(gold, predictions), null, 2),
    );
  } catch {
    console.error(
      "Evaluation failed: provide two valid JSON arrays with matching unique case IDs. No input content printed.",
    );
    process.exitCode = 1;
  }
}
