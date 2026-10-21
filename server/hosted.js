import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { securityConfig } from "./security.js";
import { schedulerAuthorization } from "./scheduler-auth.js";
import { runScheduler } from "./scheduler.js";
import { createBlobStorage } from "./blob-storage.js";
import { scanWithSandbox } from "./sandbox-scanner.js";
import { processFileCleanup } from "./file-lifecycle.js";

export function createHostedHandler({
  env = process.env,
  storeFactory = createStore,
} = {}) {
  let initialization;
  const initialize = async () => {
    if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || ""))
      throw new Error("DATABASE_URL required");
    const config = securityConfig({
      production: true,
      origin: env.APP_ORIGIN,
      registrationToken: env.REGISTRATION_TOKEN,
      vercel: true,
      scannerSocket: undefined,
    });
    const store = await storeFactory(env.DATABASE_URL);
    try {
      config.uploadsAvailable = async () => false;
      if (env.BLOB_STORE_ID)
        config.fileStorage = createBlobStorage({ storeId: env.BLOB_STORE_ID });
      if (config.fileStorage && env.HOSTED_UPLOADS_ENABLED === "true") {
        config.scanDocument = async (body) => {
          const state = await store.db
            .prepare(
              "SELECT snapshot_id,definitions_at FROM scanner_state WHERE id=1",
            )
            .get();
          await scanWithSandbox(body, {
            snapshotId: state?.snapshot_id,
            definitionsAt: Number(state?.definitions_at),
          });
        };
        config.uploadsAvailable = async () => {
          const state = await store.db
            .prepare(
              "SELECT snapshot_id,definitions_at FROM scanner_state WHERE id=1",
            )
            .get();
          return (
            !!state?.snapshot_id &&
            Number(state.definitions_at) >= Date.now() - 48 * 60 * 60 * 1000
          );
        };
      }
      const cleanupStorage = env.BLOB_STORE_ID
        ? createBlobStorage({ storeId: env.BLOB_STORE_ID })
        : undefined;
      // Detect unapplied migrations before accepting traffic.
      await store.db.prepare("SELECT id FROM users LIMIT 1").all();
      return {
        app: await createApp(store, config),
        store,
        config,
        cleanupStorage,
      };
    } catch (error) {
      await store.db.close();
      throw error;
    }
  };
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const isJob =
        new URL(req.url, "https://localhost").pathname === "/api/jobs/run";
      let signedAt = 0;
      if (isJob) {
        const authorization = schedulerAuthorization(req, env, "/api/jobs/run");
        if (authorization.status !== 200) {
          res.statusCode = authorization.status;
          return res.end();
        }
        signedAt = authorization.signedAt;
      }
      initialization ||= initialize().catch((error) => {
        initialization = undefined;
        throw error;
      });
      const { app, store, cleanupStorage } = await initialization;
      if (isJob) {
        const result = await runScheduler(store, {
          signedAt,
          ...(cleanupStorage
            ? {
                cleanup: (store, options) =>
                  processFileCleanup(store, cleanupStorage, options),
              }
            : {}),
        });
        console.info(JSON.stringify({ event: "scheduler_tick", ...result }));
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify(result));
      }
      return app(req, res);
    } catch {
      console.error(JSON.stringify({ event: "hosted_api_unavailable" }));
      res.statusCode = 503;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          error:
            "Sign-in service unavailable. Server setup needs attention. Please contact the app owner.",
        }),
      );
    }
  };
}
