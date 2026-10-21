import { createHmac, timingSafeEqual } from "node:crypto";
import { digest } from "./security.js";

// Signatures bind a short-lived timestamp to one fixed endpoint. Never send
// CRON_SECRET itself through pg_net's platform-managed request queue.
export function schedulerAuthorization(req, env, path, now = Date.now()) {
  if (
    !env.APP_ORIGIN ||
    req.headers.host !== new URL(env.APP_ORIGIN).host ||
    req.headers["x-forwarded-proto"] !== "https"
  )
    return { status: 400 };
  const secret = env.CRON_SECRET;
  if (req.method !== "GET" || typeof secret !== "string" || secret.length < 32)
    return { status: 401 };
  const at = req.headers["x-offerly-scheduler-at"],
    signature = req.headers["x-offerly-scheduler-signature"];
  if (
    typeof at === "string" &&
    /^\d{13}$/.test(at) &&
    typeof signature === "string" &&
    /^[a-f0-9]{64}$/.test(signature) &&
    Number(at) <= now + 5000 &&
    Number(at) >= now - 60000 &&
    timingSafeEqual(
      Buffer.from(signature, "hex"),
      createHmac("sha256", secret).update(`${at}:${path}`).digest(),
    )
  )
    return { status: 200, signedAt: Number(at) };
  if (
    timingSafeEqual(
      Buffer.from(digest(req.headers.authorization || "")),
      Buffer.from(digest(`Bearer ${secret}`)),
    )
  )
    return { status: 200, signedAt: 0 };
  return { status: 401 };
}
