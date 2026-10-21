import { timingSafeEqual, createHmac } from "node:crypto";
import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { securityConfig, digest } from "./security.js";
import { runScheduler } from "./scheduler.js";

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
      // Detect unapplied migrations before accepting traffic.
      await store.db.prepare("SELECT id FROM users LIMIT 1").all();
      return { app: await createApp(store, config), store, config };
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
        if (
          !env.APP_ORIGIN ||
          req.headers.host !== new URL(env.APP_ORIGIN).host ||
          req.headers["x-forwarded-proto"] !== "https"
        ) {
          res.statusCode = 400;
          return res.end();
        }
        const secret = env.CRON_SECRET;
        const at = req.headers["x-offerly-scheduler-at"];
        const signature = req.headers["x-offerly-scheduler-signature"];
        if (
          secret &&
          typeof at === "string" &&
          /^\d{13}$/.test(at) &&
          typeof signature === "string" &&
          /^[a-f0-9]{64}$/.test(signature) &&
          Number(at) <= Date.now() + 5000 &&
          Number(at) >= Date.now() - 60000 &&
          timingSafeEqual(
            Buffer.from(signature, "hex"),
            createHmac("sha256", secret).update(`${at}:/api/jobs/run`).digest(),
          )
        )
          signedAt = Number(at);
        if (
          req.method !== "GET" ||
          !secret ||
          secret.length < 32 ||
          (!signedAt &&
            !timingSafeEqual(
              Buffer.from(digest(req.headers.authorization || "")),
              Buffer.from(digest(`Bearer ${secret}`)),
            ))
        ) {
          res.statusCode = 401;
          return res.end();
        }
      }
      initialization ||= initialize().catch((error) => {
        initialization = undefined;
        throw error;
      });
      const { app, store } = await initialization;
      if (isJob) {
        const result = await runScheduler(store, { signedAt });
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
