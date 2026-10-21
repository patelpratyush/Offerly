import { timingSafeEqual } from "node:crypto";
import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { securityConfig, digest } from "./security.js";
import { processRecruitingJobs } from "./recruiting.js";
import { processReminders } from "./reminders.js";

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
      initialization ||= initialize().catch((error) => {
        initialization = undefined;
        throw error;
      });
      const { app, store, config } = await initialization;
      if (new URL(req.url, config.origin).pathname === "/api/jobs/run") {
        if (
          req.headers.host !== new URL(config.origin).host ||
          req.headers["x-forwarded-proto"] !== "https"
        ) {
          res.statusCode = 400;
          return res.end();
        }
        const secret = env.CRON_SECRET;
        if (
          req.method !== "GET" ||
          !secret ||
          secret.length < 32 ||
          !timingSafeEqual(
            Buffer.from(digest(req.headers.authorization || "")),
            Buffer.from(digest(`Bearer ${secret}`)),
          )
        ) {
          res.statusCode = 401;
          return res.end();
        }
        const deadline = Date.now() + 35000;
        const recruiting = await processRecruitingJobs(store, { deadline });
        const reminders = await processReminders(store, { deadline });
        res.setHeader("Content-Type", "application/json");
        return res.end(JSON.stringify({ recruiting, reminders }));
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
