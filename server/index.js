import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import express from "express";
import { fork } from "node:child_process";
import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { securityConfig } from "./security.js";
process.umask(0o077);
const config = securityConfig();
const database = resolve(process.env.DATABASE_PATH || "data/offerly.sqlite");
mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
const store = await createStore(database),
  app = await createApp(store, config);
if (config.production) {
  const root = resolve("dist");
  app.use(express.static(root, { dotfiles: "deny", index: false }));
  app.get("/{*path}", (req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile("index.html", { root });
  });
}
const port = Number(process.env.PORT) || 3001;
const server = app.listen(port, "127.0.0.1", () =>
  console.log(`Offerly API listening on http://127.0.0.1:${port}`),
);
const worker = fork(new URL("./worker.js", import.meta.url), [], {
  env: { ...process.env, DATABASE_PATH: database },
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
server.maxRequestsPerSocket = 1000;
let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  worker.kill("SIGTERM");
  server.close(() => {
    store.db.close();
    process.exit(code);
  });
  setTimeout(() => {
    server.closeAllConnections();
  }, 10000).unref();
}
worker.on("error", () => {
  console.error("Background worker could not start");
  shutdown(1);
});
worker.on("exit", () => {
  if (!closing) {
    console.error("Background worker stopped; restart the service");
    shutdown(1);
  }
});
process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());
