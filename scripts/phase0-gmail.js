#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  authorizeLocal,
  createLocalClient,
  loadDesktopClient,
  scanAllMail,
  revokeLocal,
  safeFailure,
} from "../server/integrations/gmail-local.js";

import {
  loadRefreshToken,
  saveRefreshToken,
  deleteRefreshToken,
} from "../server/integrations/gmail-keychain.js";

const manualRemoval = () =>
  console.error(
    "Token revocation failed. Remove Offerly Local access in Google Account → Third-party connections.",
  );
const args = process.argv.slice(2);
if (
  args.length !== 1 ||
  !["--authorize-only", "--all-mail", "--disconnect"].includes(args[0])
) {
  console.error(
    "Usage: node scripts/phase0-gmail.js --authorize-only | --all-mail | --disconnect",
  );
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let client;
  let retained = false;
  const report = {
    check: "gmail-local-live-proof",
    allMailIncludingSpamTrash: args[0] === "--all-mail",
    authorizationValidated: false,
    mailboxAccessPerformed: false,
    completed: false,
    tokenRevoked: false,
    credentialsStoredInKeychain: false,
    accessRetained: false,
    plaintextPersisted: false,
    externalAiUsed: false,
    attachmentEndpointsRequested: false,
  };
  try {
    const config = loadDesktopClient(process.env.GOOGLE_OAUTH_CLIENT_FILE);
    const storedToken = await loadRefreshToken(config.clientId);
    if (args[0] === "--disconnect") {
      if (storedToken) {
        try {
          report.tokenRevoked = await revokeLocal(storedToken);
        } catch {
          /* Safe aggregate only. */
        }
        await deleteRefreshToken(config.clientId);
        if (!report.tokenRevoked) {
          manualRemoval();
          process.exitCode = 1;
        }
      }
      report.completed = !storedToken || report.tokenRevoked;
    } else {
      if (storedToken) {
        retained = true;
        report.credentialsStoredInKeychain = true;
        report.accessRetained = true;
        client = createLocalClient(config, { signal: controller.signal });
        client.setCredentials({ refresh_token: storedToken });
        try {
          const access = await client.getAccessToken();
          if (!access.token) throw Error("authorization_scope_missing");
          retained = true;
        } catch (error) {
          // Only an explicitly expired/revoked grant permits automatic reconnect.
          if (error?.response?.data?.error !== "invalid_grant") throw error;
          await deleteRefreshToken(config.clientId);
          client.setCredentials({});
          client = undefined;
          retained = false;
          report.credentialsStoredInKeychain = false;
          report.accessRetained = false;
        }
      }
      if (!client) {
        console.log(
          "Opening Google consent. Authorization will stay in macOS Keychain; email content stays in memory.",
        );
        client = await authorizeLocal(config, {
          signal: controller.signal,
          persistent: true,
          openBrowser: (url) =>
            new Promise((resolve, reject) => {
              const command =
                process.platform === "darwin"
                  ? "open"
                  : process.platform === "win32"
                    ? null
                    : "xdg-open";
              if (!command) {
                reject(Error("browser_unavailable"));
                return;
              }
              const child = spawn(command, [url], {
                stdio: "ignore",
                shell: false,
              });
              child.once("error", () => reject(Error("browser_unavailable")));
              child.once("exit", (code) =>
                code === 0 ? resolve() : reject(Error("browser_unavailable")),
              );
            }),
        });
        if (!client.credentials.refresh_token)
          throw Error("authorization_scope_missing");
        await saveRefreshToken(
          config.clientId,
          client.credentials.refresh_token,
        );
        retained = true;
      }
      report.credentialsStoredInKeychain = retained;
      report.accessRetained = retained;
      report.authorizationValidated = true;
      if (args[0] === "--all-mail") {
        report.mailboxAccessPerformed = true;
        report.counts = await scanAllMail({
          getAccessToken: async () => (await client.getAccessToken()).token,
          signal: controller.signal,
          progress: (counts) => {
            const previous = report.counts;
            report.counts = counts;
            if (
              counts.completed ||
              previous?.requestRetries !== counts.requestRetries ||
              (counts.messagesRead > 0 &&
                counts.messagesRead % 100 === 0 &&
                previous?.messagesRead !== counts.messagesRead)
            )
              console.log(JSON.stringify({ progress: counts }));
          },
        });
      }
      report.completed =
        args[0] === "--authorize-only" || report.counts.completed;
      if (!report.completed) {
        report.failure = "mailbox_scan_partial";
        process.exitCode = 1;
      }
    }
  } catch (error) {
    if (error?.message === "authorization_revocation_failed")
      console.error(
        "Token revocation failed. Remove Offerly Local access in Google Account → Third-party connections.",
      );
    Object.assign(
      report,
      controller.signal.aborted ? { failure: "cancelled" } : safeFailure(error),
    );
    process.exitCode = 1;
  } finally {
    if (
      !retained &&
      (client?.credentials.refresh_token || client?.credentials.access_token)
    ) {
      try {
        report.tokenRevoked = await revokeLocal(
          client.credentials.refresh_token || client.credentials.access_token,
        );
      } catch {
        /* Aggregate failure only. */
      }
      client.setCredentials({});
      if (!report.tokenRevoked) {
        console.error(
          "Token revocation failed. Remove Offerly Local access in Google Account → Third-party connections.",
        );
        process.exitCode = 1;
      }
    }
    client?.setCredentials({});
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    console.log(JSON.stringify(report, null, 2));
  }
}
