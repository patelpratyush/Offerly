#!/usr/bin/env node
import {
  loadDesktopClient,
  createLocalClient,
  safeFailure,
} from "../server/integrations/gmail-local.js";
import { loadRefreshToken } from "../server/integrations/gmail-keychain.js";
import {
  createImportProof,
  readRecruitingProof,
} from "../server/integrations/recruiting-import-proof.js";

const controller = new AbortController();
const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
const proof = createImportProof();
let client;
const report = {
  check: "phase0-local-historical-import",
  rulesVersion: "candidate-rules-v1",
  completed: false,
  contentPersisted: false,
  externalAiUsed: false,
  workspaceMutations: false,
  matchingAccuracyValidated: false,
  productionReady: false,
};
try {
  if (process.argv.length !== 2) throw new Error("invalid_arguments");
  const config = loadDesktopClient(process.env.GOOGLE_OAUTH_CLIENT_FILE);
  const refresh = await loadRefreshToken(config.clientId);
  if (!refresh) throw new Error("saved_authorization_required");
  client = createLocalClient(config, { signal: controller.signal });
  client.setCredentials({ refresh_token: refresh });
  report.selection = await readRecruitingProof({
    getAccessToken: async () => (await client.getAccessToken()).token,
    signal: controller.signal,
    onMessage: (message) => {
      proof.import(message);
      const before = proof.snapshot().candidates;
      proof.import(message);
      if (proof.snapshot().candidates !== before)
        throw new Error("replay_created_duplicate");
    },
  });
  report.counts = proof.snapshot();
  report.replayCreatesZeroNewCandidates =
    report.counts.replayDuplicates === report.counts.scanned;
  report.structuredCandidatesDemonstrated = report.counts.candidates > 0;
  report.completed =
    report.replayCreatesZeroNewCandidates &&
    report.structuredCandidatesDemonstrated;
  if (!report.structuredCandidatesDemonstrated)
    report.failure = "no_recruiting_candidates";
  if (!report.completed) process.exitCode = 1;
} catch (error) {
  report.counts = proof.snapshot();
  Object.assign(
    report,
    controller.signal.aborted ? { failure: "cancelled" } : safeFailure(error),
  );
  process.exitCode = 1;
} finally {
  proof.clear();
  client?.setCredentials({});
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  console.log(JSON.stringify(report, null, 2));
}
