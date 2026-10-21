import { readFileSync } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseSync } from "node:sqlite";
import pg from "pg";
import { HttpError } from "./security.js";

// Only the repository's parameterized SQL dialect is accepted here. Values are
// always passed separately; user input never participates in SQL translation.
export function postgresSQL(sql) {
  let text = sql
    .replace(
      /json_extract\((\w+(?:\.\w+)?),'\$\.(\w+)'\)/g,
      (_, column, key) => {
        const expression = `(${column}::jsonb->>'${key}')`;
        return ["availableAt", "leaseUntil", "versionNumber"].includes(key)
          ? `CAST(${expression} AS bigint)`
          : expression;
      },
    )
    .replace(
      /json_each\((\w+(?:\.\w+)?),'\$\.(\w+)'\)/g,
      (_, column, key) =>
        `jsonb_array_elements_text(COALESCE(${column}::jsonb->'${key}', '[]'::jsonb)) AS items(value)`,
    )
    .replace(/length\(CAST\((\w+) AS BLOB\)\)/gi, "octet_length($1)")
    .replace(/\browid\b/g, "sequence")
    .replace(
      /INSERT INTO records VALUES/gi,
      "INSERT INTO records(id,user_id,kind,data,version) VALUES",
    )
    .replace(
      /INSERT INTO events VALUES/gi,
      "INSERT INTO events(id,user_id,record_id,at,before_data,after_data,actor) VALUES",
    )
    .replace(
      /INSERT INTO users VALUES/gi,
      "INSERT INTO users(id,email,password,name,timezone,stages) VALUES",
    )
    .replace(
      /INSERT INTO sessions VALUES/gi,
      "INSERT INTO sessions(token,user_id,expires,last_seen) VALUES",
    )
    .replace(/count=count\+1/g, "count=rate_limits.count+1");
  let parameter = 0,
    quoted = false,
    output = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === "'") {
      if (quoted && text[index + 1] === "'") {
        output += "''";
        index++;
        continue;
      }
      quoted = !quoted;
    }
    output += char === "?" && !quoted ? `$${++parameter}` : char;
  }
  return output;
}

export function openDatabase(
  path,
  { pool: suppliedPool, schema = "offerly" } = {},
) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema))
    throw new TypeError("Invalid database schema");
  const hosted = /^postgres(?:ql)?:\/\//.test(path);
  const contexts = new AsyncLocalStorage();
  let counter = 0,
    tail = Promise.resolve();
  const connection = hosted ? new URL(path) : null;
  // pg connection-string SSL flags override explicit ssl options. Reject them so
  // a URL can never silently disable certificate verification.
  if (
    connection &&
    [...connection.searchParams.keys()].some((key) => key.startsWith("ssl"))
  )
    throw new Error(
      "Configure TLS through server settings, not database URL parameters",
    );
  const raw = hosted ? null : new DatabaseSync(path);
  const pool = hosted
    ? suppliedPool ||
      new pg.Pool({
        connectionString: path,
        max: 3,
        idleTimeoutMillis: 10000,
        connectionTimeoutMillis: 10000,
        application_name: "offerly",
        // Hosted URLs must configure verified TLS. Never disable certificate checks.
        ssl: ["127.0.0.1", "localhost"].includes(new URL(path).hostname)
          ? false
          : {
              rejectUnauthorized: true,
              ...(connection.hostname.endsWith(".pooler.supabase.com") ||
              /^db\.[a-z0-9]+\.supabase\.co$/.test(connection.hostname)
                ? {
                    ca: readFileSync(
                      new URL("./certs/supabase-ca-2021.crt", import.meta.url),
                      "utf8",
                    ),
                  }
                : {}),
            },
      })
    : null;
  if (pool)
    pool.on("error", () => console.error('{"event":"database_pool_error"}'));
  async function exclusive(fn) {
    const before = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await before;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  async function execute(sql, values = [], mode = "all", direct = false) {
    const context = contexts.getStore();
    if (!hosted && !context && !direct)
      return exclusive(() => execute(sql, values, mode, true));
    if (!hosted) {
      if (mode === "exec") return raw.exec(sql);
      return raw.prepare(sql)[mode](...values);
    }
    const client = context?.client || (await pool.connect());
    try {
      // Transaction poolers may switch backend connections between statements.
      // Pin even standalone queries while applying transaction-local settings.
      if (!context) {
        await client.query("BEGIN");
        await client.query(
          `SET LOCAL search_path TO ${schema}, pg_catalog; SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '20s'`,
        );
      }
      const result = await client.query(postgresSQL(sql), values);
      if (!context) await client.query("COMMIT");
      const rows = (result.rows || []).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => {
            const type = result.fields?.find(
              (field) => field.name === key,
            )?.dataTypeID;
            return [key, type === 20 ? Number(value) : value];
          }),
        ),
      );
      return mode === "get"
        ? rows[0]
        : mode === "run"
          ? { changes: result.rowCount }
          : rows;
    } catch (error) {
      if (!context) await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      if (!context) client.release();
    }
  }
  async function atomic(fn) {
    const parent = contexts.getStore();
    if (parent) {
      const name = `offerly_${++counter}`;
      await execute(`SAVEPOINT ${name}`, [], "exec");
      try {
        const result = await fn();
        await execute(`RELEASE SAVEPOINT ${name}`, [], "exec");
        return result;
      } catch (error) {
        await execute(`ROLLBACK TO SAVEPOINT ${name}`, [], "exec");
        await execute(`RELEASE SAVEPOINT ${name}`, [], "exec");
        throw error;
      }
    }
    const transaction = async () => {
      const client = hosted ? await pool.connect() : null;
      return contexts.run({ client }, async () => {
        try {
          await execute(
            hosted ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN IMMEDIATE",
            [],
            "exec",
          );
          if (hosted)
            await client.query(
              `SET LOCAL search_path TO ${schema}, pg_catalog; SET LOCAL statement_timeout = '15s'; SET LOCAL idle_in_transaction_session_timeout = '20s'`,
            );
          const result = await fn();
          await execute("COMMIT", [], "exec");
          return result;
        } catch (error) {
          await execute("ROLLBACK", [], "exec").catch(() => {});
          if (["40001", "40P01"].includes(error.code))
            throw new HttpError(
              409,
              "Concurrent change detected. Refresh and retry.",
            );
          throw error;
        } finally {
          if (client) client.release();
        }
      });
    };
    return hosted ? transaction() : exclusive(transaction);
  }
  return {
    hosted,
    atomic,
    prepare: (sql) => ({
      get: (...args) => execute(sql, args, "get"),
      all: (...args) => execute(sql, args, "all"),
      run: (...args) => execute(sql, args, "run"),
    }),
    exec: (sql) => execute(sql, [], "exec"),
    close: () => (hosted ? pool.end() : raw.close()),
  };
}
