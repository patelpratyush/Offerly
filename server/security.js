import { isIP } from "node:net";
import { createHash, randomUUID } from "node:crypto";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}
export const digest = (value) =>
  createHash("sha256").update(value).digest("hex");
export function securityConfig(overrides = {}) {
  const production =
    overrides.production ?? process.env.NODE_ENV === "production";
  const origin = overrides.origin ?? process.env.APP_ORIGIN;
  if (
    production &&
    (!origin ||
      new URL(origin).protocol !== "https:" ||
      new URL(origin).origin !== origin)
  )
    throw new Error("Production requires APP_ORIGIN as an exact HTTPS origin");
  const registrationToken =
    overrides.registrationToken ?? process.env.REGISTRATION_TOKEN;
  if (production && registrationToken && registrationToken.length < 32)
    throw new Error("REGISTRATION_TOKEN must contain at least 32 characters");
  return {
    production,
    origin,
    registrationToken,
    trustProxy:
      overrides.trustProxy ?? process.env.TRUST_PROXY_LOOPBACK === "true",
    scannerSocket: overrides.scannerSocket ?? process.env.CLAMAV_SOCKET,
    ...overrides,
  };
}
export async function createLimiter(db) {
  if (!db.hosted)
    await db.exec(
      "CREATE TABLE IF NOT EXISTS rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)",
    );
  return async (key, limit, windowMs) =>
    db.atomic(async () => {
      const now = Date.now(),
        hashed = digest(key);
      await db.prepare("DELETE FROM rate_limits WHERE expires<=?").run(now);
      const row = await db
        .prepare("SELECT * FROM rate_limits WHERE key=?")
        .get(hashed);
      if (
        !row &&
        (await db.prepare("SELECT count(*) n FROM rate_limits").get()).n >=
          10000
      )
        throw new HttpError(429, "Server busy. Try again shortly.");
      if (row && row.count >= limit)
        throw new HttpError(429, "Too many requests. Try again later.");
      await db
        .prepare(
          "INSERT INTO rate_limits VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
        )
        .run(hashed, 1, now + windowMs);
    });
}
export function installSecurity(app, config, limit) {
  app.disable("x-powered-by");
  app.enable("case sensitive routing");
  app.enable("strict routing");
  if (config.trustProxy) app.set("trust proxy", "loopback");
  app.use(async (req, res, next) => {
    if (config.vercel && process.env.VERCEL === "1") {
      const ip = req.headers["x-vercel-forwarded-for"];
      if (typeof ip === "string" && isIP(ip))
        Object.defineProperty(req, "ip", { value: ip });
    }
    req.requestId = randomUUID();
    res.set({
      "X-Request-ID": req.requestId,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    });
    if (config.production)
      res.set("Strict-Transport-Security", "max-age=31536000");
    if (/^\/api(?:\/|$)/i.test(req.path)) res.set("Cache-Control", "no-store");
    try {
      if (config.production) {
        if (req.headers.host !== new URL(config.origin).host)
          throw new HttpError(421, "Invalid host");
        if (
          !req.secure &&
          !(
            config.vercel &&
            process.env.VERCEL === "1" &&
            req.headers["x-forwarded-proto"] === "https"
          )
        )
          throw new HttpError(400, "HTTPS is required");
      } else if (!["localhost", "127.0.0.1", "[::1]"].includes(req.hostname))
        throw new HttpError(421, "Invalid host");
      if (/^\/api(?:\/|$)/i.test(req.path)) {
        await limit("api:" + req.ip, 600, 60000);
        if (req.headers["sec-fetch-site"] === "cross-site")
          throw new HttpError(403, "Cross-site requests are not allowed");
        if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
          if (req.headers["x-offerly-request"] !== "1")
            throw new HttpError(403, "Missing request protection header");
          if (!req.is("application/json"))
            throw new HttpError(415, "Content-Type must be application/json");
          if (req.headers.origin) {
            let origin;
            try {
              origin = new URL(req.headers.origin).origin;
            } catch {
              throw new HttpError(403, "Invalid request origin");
            }
            const allowed = config.production
              ? [config.origin]
              : [
                  "http://127.0.0.1:5173",
                  "http://localhost:5173",
                  `http://${req.headers.host}`,
                ];
            if (!allowed.includes(origin) || req.headers.origin !== origin)
              throw new HttpError(403, "Invalid request origin");
          }
        }
      }
      next();
    } catch (e) {
      next(e);
    }
  });
}
