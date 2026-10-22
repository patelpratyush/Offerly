import { writeFile } from "node:fs/promises";
import {
  SOURCE_BOARDS,
  probeSource,
} from "../server/integrations/job-sources.js";
const results = [];
// Sequential: six board requests plus one description probe, no scraping, no retries, no application POSTs.
for (const { provider, board } of SOURCE_BOARDS) {
  try {
    const { jobs, ...result } = await probeSource(provider, board);
    results.push({
      ...result,
      normalized: jobs.length,
      sample: jobs.slice(0, 2),
    });
  } catch (error) {
    results.push({
      provider,
      board,
      status: "failed",
      checked_at: new Date().toISOString(),
      error: String(error.message).slice(0, 150),
    });
  }
}
let descriptionProbe;
try {
  const { jobs, ...result } = await probeSource("greenhouse", "stripe", {
    includeDescriptions: true,
  });
  descriptionProbe = {
    ...result,
    descriptions: jobs.filter((job) => job.description).length,
    description_format: "html-entities",
  };
} catch (error) {
  descriptionProbe = {
    status: "failed",
    error: String(error.message).slice(0, 150),
  };
}
const report = {
  generated_at: new Date().toISOString(),
  scope: "Metadata-only technical probes; no redistribution approval",
  results,
  description_probe: descriptionProbe,
};
await writeFile(
  new URL("../docs/phase0/source-probe.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    results.map(({ provider, board, status, normalized, rejected, error }) => ({
      provider,
      board,
      status,
      normalized,
      rejected,
      error,
    })),
    null,
    2,
  ),
);
if (
  descriptionProbe.status !== "ok" ||
  results.some((r) => r.status !== "ok" || !r.complete)
)
  process.exitCode = 1;
