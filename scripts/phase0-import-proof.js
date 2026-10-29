#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  loadDesktopClient,
  createLocalClient,
  safeFailure,
} from "../server/integrations/gmail-local.js";
import { loadRefreshToken } from "../server/integrations/gmail-keychain.js";
import {
  createImportProof,
  readRecruitingProof,
  verifyImportReplay,
} from "../server/integrations/recruiting-import-proof.js";

const PROOF_SOURCES = [
  "scripts/phase0-import-proof.js",
  "server/integrations/recruiting-import-proof.js",
];

export async function proofMetadata({ root = new URL("../", import.meta.url), git = spawnSync } = {}) {
  let commit = null;
  try {
    const result = git("git", ["rev-parse", "HEAD"], {
      cwd: new URL(root).pathname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status === 0 && /^[a-f0-9]{40,64}\s*$/i.test(result.stdout))
      commit = result.stdout.trim();
  } catch {
    // Commit metadata is helpful but must not block the local proof.
  }
  const digest = createHash("sha256");
  for (const filename of PROOF_SOURCES) {
    digest.update(filename).update("\0");
    digest.update(await readFile(new URL(filename, root)));
    digest.update("\0");
  }
  return {
    generatedAt: new Date().toISOString(),
    gitCommit: commit,
    rulesVersion: "candidate-rules-v1",
    proofSourcesSha256: digest.digest("hex"),
  };
}

export async function runImportProof({
  read = readRecruitingProof,
  createProof = createImportProof,
  metadata = proofMetadata,
  getAccessToken,
  signal,
} = {}) {
  const selected = [];
  const selection = await read({
    getAccessToken,
    signal,
    onMessage: (message) => selected.push(message),
  });
  const replay = verifyImportReplay(selected, createProof);
  return {
    check: "phase0-local-historical-import",
    ...(await metadata()),
    completed: replay.replayCreatesZeroNewCandidates && replay.crossRunReplayMatches && replay.counts.candidates > 0,
    contentPersisted: false,
    externalAiUsed: false,
    workspaceMutations: false,
    matchingAccuracyValidated: false,
    productionReady: false,
    selection,
    counts: replay.counts,
    replayCreatesZeroNewCandidates: replay.replayCreatesZeroNewCandidates,
    crossRunReplayMatches: replay.crossRunReplayMatches,
    structuredCandidatesDemonstrated: replay.counts.candidates > 0,
    ...(!replay.counts.candidates ? { failure: "no_recruiting_candidates" } : {}),
  };
}

async function main() {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const proof = createImportProof();
  let client;
  let report;
  try {
    if (process.argv.length !== 2) throw new Error("invalid_arguments");
    const config = loadDesktopClient(process.env.GOOGLE_OAUTH_CLIENT_FILE);
    const refresh = await loadRefreshToken(config.clientId);
    if (!refresh) throw new Error("saved_authorization_required");
    client = createLocalClient(config, { signal: controller.signal });
    client.setCredentials({ refresh_token: refresh });
    report = await runImportProof({
      getAccessToken: async () => (await client.getAccessToken()).token,
      signal: controller.signal,
    });
    if (!report.completed) process.exitCode = 1;
  } catch (error) {
    report = {
      check: "phase0-local-historical-import",
      ...(await proofMetadata().catch(() => ({}))),
      completed: false,
      contentPersisted: false,
      externalAiUsed: false,
      workspaceMutations: false,
      matchingAccuracyValidated: false,
      productionReady: false,
      failure: controller.signal.aborted ? "cancelled" : safeFailure(error).failure,
    };
    process.exitCode = 1;
  } finally {
    proof.clear();
    client?.setCredentials({});
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    console.log(JSON.stringify(report, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
