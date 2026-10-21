import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { stages } from "./store.js";
import { HttpError, digest } from "./security.js";
const derive = promisify(scrypt),
  parameters = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
let activeHashes = 0;
async function key(password, salt, options = parameters) {
  if (activeHashes >= 2)
    throw new HttpError(503, "Authentication busy. Try again shortly.");
  activeHashes++;
  try {
    return await derive(password, salt, 64, options);
  } finally {
    activeHashes--;
  }
}
export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1:${salt}:${(await key(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const parts = (encoded || "").split(":");
  const modern = parts.length === 3 && parts[0] === "scrypt-v1";
  const salt = modern ? parts[1] : parts[0];
  const expected = modern ? parts[2] : parts[1];
  const valid =
    /^[a-f0-9]{32}$/.test(salt || "") && /^[a-f0-9]{128}$/.test(expected || "");
  const actual = await key(
    password,
    valid ? salt : "0".repeat(32),
    valid && !modern
      ? { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }
      : parameters,
  );
  return valid && timingSafeEqual(actual, Buffer.from(expected, "hex"));
}
export function sessionCookie(req, name) {
  const values = (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.startsWith(name + "="));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(value) ? value : null;
}
export function mountAuth(app, store, config, limit) {
  const { db, atomic } = store,
    cookieName = config.production ? "__Host-offerly" : "session";
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: config.production,
    path: "/",
  };
  const clear = (res) => res.clearCookie(cookieName, cookieOptions);
  const credentials = z.object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z.string().min(1).max(256),
    name: z.string().trim().min(1).max(100).optional(),
    timezone: z.string().max(100).optional(),
    invitation: z.string().max(256).optional(),
  });
  app.get("/api/auth/config", (req, res) =>
    res.json({
      registrationEnabled: !config.production || !!config.registrationToken,
      invitationRequired: config.production && !!config.registrationToken,
      uploadsAvailable: !config.production || !!config.scannerSocket,
    }),
  );
  app.post("/api/auth/:action", async (req, res, next) => {
    try {
      if (!["register", "login"].includes(req.params.action))
        throw new HttpError(404, "Not found");
      await limit("auth-ip:" + req.ip, 30, 900000);
      const input = credentials.parse(req.body);
      await limit("auth-email:" + input.email, 10, 900000);
      if (req.params.action === "register") {
        if (
          config.production &&
          (!config.registrationToken ||
            digest(input.invitation || "") !== digest(config.registrationToken))
        )
          throw new HttpError(
            403,
            "Registration is unavailable or the invitation is invalid",
          );
        if (input.password.length < 15)
          throw new HttpError(
            400,
            "Use a password with at least 15 characters",
          );
      }
      let user = await db
        .prepare("SELECT * FROM users WHERE email=?")
        .get(input.email);
      if (req.params.action === "register") {
        const timezone = input.timezone || "UTC";
        try {
          new Intl.DateTimeFormat("en", { timeZone: timezone });
        } catch {
          throw new HttpError(400, "Invalid timezone");
        }
        const password = await hashPassword(input.password);
        if (user)
          throw new HttpError(
            400,
            "Unable to create account. Try signing in instead.",
          );
        user = {
          id: randomUUID(),
          email: input.email,
          password,
          name: input.name || "Job seeker",
          timezone,
          stages: JSON.stringify(stages),
        };
        // Recheck after asynchronous hashing to prevent registration races.
        if (
          await db
            .prepare("SELECT id FROM users WHERE email=?")
            .get(input.email)
        )
          throw new HttpError(
            400,
            "Unable to create account. Try signing in instead.",
          );
        await db
          .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
          .run(
            user.id,
            user.email,
            user.password,
            user.name,
            user.timezone,
            user.stages,
          );
      } else {
        if (!(await verifyPassword(input.password, user?.password)))
          throw new HttpError(401, "Email or password incorrect");
        // The account could have been deleted or its password changed while hashing.
        const fresh = await db
          .prepare("SELECT * FROM users WHERE id=?")
          .get(user.id);
        if (!fresh || fresh.password !== user.password)
          throw new HttpError(401, "Email or password incorrect");
        if (!user.password.startsWith("scrypt-v1:")) {
          const password = await hashPassword(input.password);
          const result = await db
            .prepare("UPDATE users SET password=? WHERE id=? AND password=?")
            .run(password, user.id, user.password);
          if (!result.changes) throw new HttpError(401, "Sign in again");
          user.password = password;
        }
      }
      const token = randomBytes(32).toString("hex"),
        now = Date.now();
      await atomic(async () => {
        const current = await db
          .prepare("SELECT password FROM users WHERE id=?")
          .get(user.id);
        if (!current || current.password !== user.password)
          throw new HttpError(401, "Sign in again");
        await db
          .prepare("DELETE FROM sessions WHERE expires<=? OR last_seen<=?")
          .run(now, now - 1800000);
        const old = sessionCookie(req, cookieName);
        if (old)
          await db
            .prepare("DELETE FROM sessions WHERE token=?")
            .run(digest(old));
        await db
          .prepare(
            "DELETE FROM sessions WHERE user_id=? AND token NOT IN (SELECT token FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 9)",
          )
          .run(user.id, user.id);
        await db
          .prepare(
            "INSERT INTO sessions(token,user_id,expires,last_seen) VALUES(?,?,?,?)",
          )
          .run(digest(token), user.id, now + 43200000, now);
      });
      res.cookie(cookieName, token, { ...cookieOptions, maxAge: 43200000 });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.use("/api", async (req, res, next) => {
    try {
      const token = sessionCookie(req, cookieName),
        now = Date.now();
      const user =
        token &&
        (await db
          .prepare(
            "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND s.last_seen>?",
          )
          .get(digest(token), now, now - 1800000));
      if (!user)
        throw Object.assign(new HttpError(401, "Sign in to continue"), {
          code: "SESSION_REQUIRED",
        });
      req.user = user;
      req.sessionHash = digest(token);
      await db
        .prepare("UPDATE sessions SET last_seen=? WHERE token=?")
        .run(now, req.sessionHash);
      await limit("user:" + user.id, 300, 60000);
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method))
        await limit("write:" + user.id, 90, 60000);
      next();
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/logout", async (req, res) => {
    await db.prepare("DELETE FROM sessions WHERE token=?").run(req.sessionHash);
    clear(res);
    res.json({ ok: true });
  });
  const reauthenticate = async (req, password) => {
    await limit("reauth:" + req.user.id, 10, 900000);
    if (
      typeof password !== "string" ||
      password.length > 256 ||
      !(await verifyPassword(password, req.user.password))
    )
      throw new HttpError(401, "Current password incorrect");
    const fresh = await db
      .prepare("SELECT password FROM users WHERE id=?")
      .get(req.user.id);
    const session = await db
      .prepare(
        "SELECT token FROM sessions WHERE token=? AND expires>? AND last_seen>?",
      )
      .get(req.sessionHash, Date.now(), Date.now() - 1800000);
    if (!fresh || fresh.password !== req.user.password || !session)
      throw new HttpError(401, "Sign in again");
  };
  app.post("/api/account/password", async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = z
        .object({
          currentPassword: z.string().max(256),
          newPassword: z.string().min(15).max(256),
        })
        .parse(req.body);
      await reauthenticate(req, currentPassword);
      const password = await hashPassword(newPassword);
      await atomic(async () => {
        // Hashing yields to other requests; logout/revocation must win before commit.
        const session = await db
          .prepare(
            "SELECT token FROM sessions WHERE token=? AND user_id=? AND expires>? AND last_seen>?",
          )
          .get(req.sessionHash, req.user.id, Date.now(), Date.now() - 1800000);
        if (!session)
          throw Object.assign(new HttpError(401, "Sign in again"), {
            code: "SESSION_REQUIRED",
          });
        const updated = await db
          .prepare("UPDATE users SET password=? WHERE id=? AND password=?")
          .run(password, req.user.id, req.user.password);
        if (!updated.changes)
          throw new HttpError(409, "Account changed. Sign in again");
        await db
          .prepare("DELETE FROM sessions WHERE user_id=?")
          .run(req.user.id);
      });
      clear(res);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.delete("/api/account", async (req, res, next) => {
    try {
      if (req.body.confirm !== req.user.email)
        throw new HttpError(400, "Enter your email to confirm deletion");
      await reauthenticate(req, req.body.password);
      await atomic(async () => {
        const session = await db
          .prepare(
            "SELECT token FROM sessions WHERE token=? AND user_id=? AND expires>? AND last_seen>?",
          )
          .get(req.sessionHash, req.user.id, Date.now(), Date.now() - 1800000);
        if (!session) throw new HttpError(401, "Sign in again");
        const result = await db
          .prepare("DELETE FROM users WHERE id=? AND password=?")
          .run(req.user.id, req.user.password);
        if (!result.changes)
          throw new HttpError(409, "Account changed. Sign in again");
      });
      clear(res);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  return { reauthenticate };
}
