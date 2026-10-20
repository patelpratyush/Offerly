// Dedicated browser-test runtime. Never reuse a developer's app or database.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = mkdtempSync(join(tmpdir(), "offerly-e2e-"));
const env = {
  ...process.env,
  NODE_ENV: "development",
  DATABASE_PATH: join(directory, "workspace.sqlite"),
  PORT: "3002",
  OFFERLY_API_PORT: "3002",
  TRUST_PROXY_LOOPBACK: "false",
};
for (const key of ["APP_ORIGIN", "REGISTRATION_TOKEN", "CLAMAV_SOCKET"])
  delete env[key];
let stopping = false;
const children = [
  spawn(process.execPath, ["server/index.js"], { env, stdio: "inherit" }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "4173"],
    { env, stdio: "inherit" },
  ),
];
const exits = children.map(
  (child) =>
    new Promise((resolve) => {
      child.once("exit", resolve);
      child.once("error", () => resolve(1));
    }),
);
async function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
  }, 5000);
  await Promise.all(exits);
  clearTimeout(timeout);
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = code;
}
for (const exit of exits) void exit.then(() => stop(1));
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));
