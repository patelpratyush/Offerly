#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  authorizeLocal,
  loadDesktopClient,
  scanAllMail,
  revokeLocal,
  safeFailure,
} from "../server/integrations/gmail-local.js";

const args = process.argv.slice(2);
if (
  args.length !== 1 ||
  !["--authorize-only", "--all-mail"].includes(args[0])
) {
  console.error(
    "Usage: node scripts/phase0-gmail.js --authorize-only | --all-mail",
  );
  process.exitCode = 2;
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let client;
  const report = {
    check: "gmail-local-live-proof",
    allMailIncludingSpamTrash: args[0] === "--all-mail",
    authorizationValidated: false,
    mailboxAccessPerformed: false,
    completed: false,
    tokenRevoked: false,
    plaintextPersisted: false,
    externalAiUsed: false,
    attachmentEndpointsRequested: false,
  };
  try {
    const config = loadDesktopClient(process.env.GOOGLE_OAUTH_CLIENT_FILE);
    console.log(
      "Opening Google consent in browser. Mail content stays local; output contains counts only.",
    );
    client = await authorizeLocal(config, {
      signal: controller.signal,
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
    report.authorizationValidated = true;
    if (args[0] === "--all-mail") {
      report.mailboxAccessPerformed = true;
      report.counts = await scanAllMail({
        token: client.credentials.access_token,
        signal: controller.signal,
        progress: (counts) => {
          const previous = report.counts;
          report.counts = counts;
          if (
            counts.completed ||
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
    if (client?.credentials.access_token) {
      try {
        report.tokenRevoked = await revokeLocal(
          client.credentials.access_token,
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
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    console.log(JSON.stringify(report, null, 2));
  }
}
