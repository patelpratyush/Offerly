import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { evaluate } from "./phase0-evaluate.js";
import { guardApplicationLink } from "../server/integrations/recruiting-match-guard.js";

const SYSTEM = "openai/gpt-6-luna:phase0-gpt-v1";

function envelope(split, predictions) {
  return { version: 1, split, system: SYSTEM, predictions };
}

export function analyzeHeldOut({ oldGold, oldPredictions, freshGold, freshPredictions }) {
  if (
    oldPredictions.system !== SYSTEM ||
    freshPredictions.system !== SYSTEM ||
    oldPredictions.split !== "held-out" ||
    freshPredictions.split !== "held-out"
  )
    throw new Error("Unexpected GPT held-out artifacts");
  const oldExamples = oldGold.examples.filter((item) => item.split === "held-out");
  const freshExamples = freshGold.examples.map((item) => ({ ...item, split: "held-out" }));
  const pooledGold = {
    version: oldGold.version,
    provenance: oldGold.provenance,
    examples: [...oldExamples, ...freshExamples],
  };
  const pooledPredictions = [
    ...oldPredictions.predictions,
    ...freshPredictions.predictions,
  ];
  const raw = envelope("held-out", pooledPredictions);
  const inputsById = new Map(
    [...oldExamples, ...freshExamples].map((item) => [item.id, item.input]),
  );
  const vetoes = [];
  const guardedPredictions = pooledPredictions.map((prediction) => {
    if (prediction.applicationId === null) return prediction;
    const source = inputsById.get(prediction.id);
    if (!source) throw new Error("Unknown predicted held-out example");
    const guarded = guardApplicationLink(source, prediction.applicationId);
    if (guarded.applicationId === null)
      vetoes.push({ id: prediction.id, reason: guarded.reason });
    return { ...prediction, applicationId: guarded.applicationId };
  });
  const guarded = envelope("held-out", guardedPredictions);
  const freshRaw = evaluate(
    { version: freshGold.version, provenance: freshGold.provenance, examples: freshExamples },
    envelope("held-out", freshPredictions.predictions),
  );
  return {
    version: 1,
    system: SYSTEM,
    synthetic: true,
    humanValidated: false,
    pooledExamples: pooledGold.examples.length,
    raw: evaluate(pooledGold, raw),
    guarded: evaluate(pooledGold, guarded),
    freshRaw,
    guardVetoes: vetoes,
    limitation:
      "Developer-authored repository fixtures only; not a blind or independent human evaluation. Guarded precision and small point estimates do not establish production or automatic-stage safety.",
  };
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function run() {
  const root = new URL("../", import.meta.url);
  const inputs = [
    "eval/phase0/recruiting.json",
    "eval/phase0/predictions-mail-gpt-6-luna-held-out-v1.json",
    "eval/phase0/recruiting-fresh.json",
    "eval/phase0/predictions-mail-gpt-6-luna-fresh-held-out-v1.json",
  ];
  const [oldGold, oldPredictions, freshGold, freshPredictions] = await Promise.all(
    inputs.map((filename) => readJson(new URL(filename, root))),
  );
  const analysis = analyzeHeldOut({ oldGold, oldPredictions, freshGold, freshPredictions });
  const output = new URL("reference/phase0/model-analysis-gpt-6-luna-v1.json", root);
  try {
    await lstat(output);
    throw new Error("GPT analysis artifact already exists; overwrite prohibited");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  analysis.inputSha256 = Object.fromEntries(
    await Promise.all(
      inputs.map(async (filename) => [
        filename.split("/").at(-1),
        createHash("sha256").update(await readFile(new URL(filename, root))).digest("hex"),
      ]),
    ),
  );
  await writeFile(output, JSON.stringify(analysis, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      raw: analysis.raw,
      guarded: analysis.guarded,
      freshRaw: analysis.freshRaw,
      guardVetoes: analysis.guardVetoes,
      output: "reference/phase0/model-analysis-gpt-6-luna-v1.json",
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/phase0-openai-analysis.js");
    process.exitCode = 2;
  } else {
    run().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}
