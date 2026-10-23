import { readFile, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  predict,
  modelInput,
  boundedJson,
  provenance,
} from "./phase0-model.js";
import { evaluate } from "./phase0-evaluate.js";
import { guardApplicationLink } from "../server/integrations/recruiting-match-guard.js";

const MODEL = "qwen3:4b";
const DIGEST =
  "359d7dd4bcdab3d86b87d73ac27966f4dbb9f5efdfcc75d34a8764a09474fae7";
const PROMPT = "phase0-local-v3";
const FRESH_SHA =
  "4f052061f42af090dd2cf5465ddc87c959d7d03b824c197f57fe5e88dba2faf8";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const file = (path) => new URL(`../${path}`, import.meta.url);
const names = (mode) => ({
  report: `docs/phase0/model-reasoning-${mode}.json`,
  raw: `eval/phase0/predictions-mail-reasoning-${mode}-raw.json`,
  guarded: `eval/phase0/predictions-mail-reasoning-${mode}-guarded.json`,
});
const decisionFile = "docs/phase0/model-reasoning-decision.json";
const optionsFor = (think) => ({
  think,
  numPredict: think ? 1024 : 512,
  requestTimeoutMs: 180000,
});
export function selectArm(rows) {
  const total = 4;
  const complete =
    rows.length === total && rows.every((row) => row.valid && row.exact);
  const times = rows.map((row) => row.durationMs).sort((a, b) => a - b);
  const median = rows.length === total ? (times[1] + times[2]) / 2 : null;
  return {
    arm:
      complete && median <= 120000
        ? "reasoning-with-source-guard"
        : "nonthinking-v3-with-source-guard",
    allDevExact: complete,
    medianDurationMs: median,
  };
}
export function guardedPrediction(input, raw) {
  const guard = guardApplicationLink(input, raw.applicationId);
  return {
    prediction: { ...raw, applicationId: guard.applicationId },
    reason: guard.reason,
  };
}
export function localRequest(think, fetcher = fetch) {
  return (path, body) =>
    boundedJson(path, body, {
      requestTimeoutMs: 180000,
      fetcher: (url, init) => {
        if (url !== "http://127.0.0.1:11434/api/chat")
          throw Error("Fixed chat endpoint required");
        const payload = JSON.parse(init.body);
        payload.think = think;
        payload.options.num_predict = think ? 1024 : 512;
        return fetcher(url, { ...init, body: JSON.stringify(payload) });
      },
    });
}
async function absent(paths) {
  for (const path of paths) {
    try {
      await lstat(file(path));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    throw Error("Immutable evaluation artifact already exists");
  }
}
async function record(path, value) {
  await writeFile(file(path), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
  });
}
async function sourceHashes() {
  return Object.fromEntries(
    await Promise.all(
      [
        ["runner", "scripts/phase0-reasoning.js"],
        ["frozenModelModule", "scripts/phase0-model.js"],
        ["guard", "server/integrations/recruiting-match-guard.js"],
        ["evaluator", "scripts/phase0-evaluate.js"],
      ].map(async ([name, path]) => [name, sha(await readFile(file(path)))]),
    ),
  );
}
async function verifyModel() {
  const tags = await boundedJson("/api/tags");
  if (!tags.models?.some((row) => row.name === MODEL && row.digest === DIGEST))
    throw Error("Expected local model missing");
}
async function evaluateRows(dataset, examples, think, sanityStop) {
  const raw = {
    version: 1,
    split: sanityStop ? "dev" : "held-out",
    system: `ollama/${MODEL}:${PROMPT}:think=${think}`,
    predictions: [],
  };
  const guarded = {
    ...raw,
    system: `${raw.system}+source-evidence-veto`,
    predictions: [],
  };
  const diagnostics = [];
  for (const item of examples) {
    const started = Date.now();
    let result;
    try {
      const input = modelInput("mail", dataset, item);
      result = await predict("mail", input, localRequest(think), {
        model: MODEL,
        promptVersion: PROMPT,
      });
      const protectedResult = guardedPrediction(input, result.prediction);
      raw.predictions.push({ id: item.id, ...result.prediction });
      guarded.predictions.push({ id: item.id, ...protectedResult.prediction });
      diagnostics.push({
        id: item.id,
        valid: true,
        durationMs: Date.now() - started,
        usage: result.usage,
        guardReason: protectedResult.reason,
        ...(sanityStop
          ? {
              exact:
                result.prediction.applicationId ===
                  item.expected.applicationId &&
                JSON.stringify([...result.prediction.events].sort()) ===
                  JSON.stringify([...item.expected.events].sort()),
            }
          : {}),
      });
    } catch (error) {
      const placeholder = { id: item.id, applicationId: null, events: [] };
      raw.predictions.push(placeholder);
      guarded.predictions.push({ ...placeholder });
      diagnostics.push({
        id: item.id,
        valid: false,
        durationMs: Date.now() - started,
        category:
          error.name === "TimeoutError"
            ? "timeout"
            : "request-or-invalid-output",
        ...(sanityStop ? { exact: false } : {}),
      });
    }
    console.log(
      JSON.stringify({
        progress: {
          mode: sanityStop ? "dev" : "fresh",
          id: item.id,
          ...diagnostics.at(-1),
        },
      }),
    );
    if (sanityStop && diagnostics.length <= 2 && !diagnostics.at(-1).valid)
      break;
  }
  const complete =
    diagnostics.length === examples.length &&
    diagnostics.every((row) => row.valid);
  const guardReasons = {};
  for (const row of diagnostics)
    if (row.guardReason)
      guardReasons[row.guardReason] = (guardReasons[row.guardReason] || 0) + 1;
  return {
    raw,
    guarded,
    diagnostics,
    complete,
    coverage: {
      numerator: diagnostics.filter((row) => row.valid).length,
      attempted: diagnostics.length,
      denominator: examples.length,
    },
    rawMetrics: complete ? evaluate(dataset, raw) : null,
    guardedMetrics: complete ? evaluate(dataset, guarded) : null,
    guardReasons,
    fullAbstentions: guarded.predictions.filter(
      (row) => row.applicationId === null && !row.events.length,
    ).length,
    linksVetoed: raw.predictions.filter(
      (row, i) =>
        row.applicationId !== null &&
        guarded.predictions[i].applicationId === null,
    ).length,
  };
}
export async function run(mode) {
  if (!["dev", "freeze", "fresh"].includes(mode))
    throw Error("Use fixed dev, freeze or fresh mode");
  if (mode === "freeze") {
    await absent([decisionFile]);
    const dev = JSON.parse(await readFile(file(names("dev").report), "utf8"));
    const hashes = await sourceHashes();
    for (const key of ["runner", "frozenModelModule", "evaluator"])
      if (dev.sourceSha256[key] !== hashes[key])
        throw Error("Development runner/source mismatch");
    const selected = selectArm(dev.diagnostics);
    await record(decisionFile, {
      version: 1,
      ...selected,
      options: optionsFor(selected.arm === "reasoning-with-source-guard"),
      sourceSha256: hashes,
      devSourceSha256: dev.sourceSha256,
      guardUpdatedAfterDev: hashes.guard !== dev.sourceSha256.guard,
      expectedFreshSha256: FRESH_SHA,
      systemPromptSha256: dev.systemPromptSha256,
      devReport: names("dev").report,
      frozenAt: new Date().toISOString(),
      rationale:
        "Selection uses raw dev correctness/latency only; reviewed source-veto updates are separately hashed before fresh evaluation. No fresh labels read.",
    });
    console.log(JSON.stringify({ decision: decisionFile, ...selected }));
    return;
  }
  const paths = names(mode);
  await absent([
    ...Object.values(paths),
    ...(mode === "dev" ? [decisionFile] : []),
  ]);
  let decision;
  const hashes = await sourceHashes();
  if (mode === "fresh") {
    decision = JSON.parse(await readFile(file(decisionFile), "utf8"));
    if (
      JSON.stringify(decision.sourceSha256) !== JSON.stringify(hashes) ||
      decision.expectedFreshSha256 !== FRESH_SHA
    )
      throw Error("Frozen decision/source mismatch");
  }
  // Fresh fixture is opened only after the decision and all source hashes match.
  const datasetBytes = await readFile(
    file(
      mode === "dev"
        ? "eval/phase0/recruiting.json"
        : "eval/phase0/recruiting-fresh.json",
    ),
  );
  const fixtureSha256 = sha(datasetBytes);
  if (mode === "fresh" && fixtureSha256 !== FRESH_SHA)
    throw Error("Fresh fixture digest mismatch");
  const dataset = JSON.parse(datasetBytes.toString("utf8"));
  const examples = dataset.examples.filter(
    (row) => row.split === (mode === "dev" ? "dev" : "held-out"),
  );
  if (
    !dataset.provenance?.includes("synthetic") ||
    examples.length !== (mode === "dev" ? 4 : 24)
  )
    throw Error("Expected fixed synthetic fixture missing");
  await verifyModel();
  const think =
    mode === "dev" || decision.arm === "reasoning-with-source-guard";
  const promptEvidence = await provenance({
    model: MODEL,
    promptVersion: PROMPT,
  });
  const report = {
    version: 1,
    mode,
    model: MODEL,
    digest: DIGEST,
    promptVersion: PROMPT,
    options: optionsFor(think),
    sourceSha256: hashes,
    fixtureSha256,
    systemPromptSha256: promptEvidence.systemPromptSha256,
    synthetic: true,
    humanValidated: false,
    autoApplyEnabled: false,
    startedAt: new Date().toISOString(),
    freshRuns: mode === "fresh" ? 1 : 0,
  };
  const result = await evaluateRows(dataset, examples, think, mode === "dev");
  Object.assign(report, result);
  report.finishedAt = new Date().toISOString();
  await record(paths.raw, result.raw);
  await record(paths.guarded, result.guarded);
  await record(paths.report, report);

  console.log(
    JSON.stringify({
      report: paths.report,
      complete: report.complete,
      coverage: report.coverage,
      rawMetrics: report.rawMetrics,
      guardedMetrics: report.guardedMetrics,
      ...(mode === "dev" ? { decision: selectArm(result.diagnostics) } : {}),
    }),
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  run(process.argv[2]).catch(() => {
    console.error(
      "Local reasoning evaluation failed; inspect fixed configuration and immutable artifacts",
    );
    process.exitCode = 1;
  });
