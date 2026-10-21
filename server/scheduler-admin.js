import pg from "pg";
import { readFile } from "node:fs/promises";

// Owner-only operational CLI. Never import into the HTTP application.
const command = process.argv[2];
if (!["setup", "status", "pause"].includes(command))
  throw new Error(
    "Usage: node --env-file=.env server/scheduler-admin.js setup|status|pause",
  );
if (!process.env.DATABASE_ADMIN_URL)
  throw new Error(
    "DATABASE_ADMIN_URL required locally; never add it to Vercel",
  );
const url = new URL(process.env.DATABASE_ADMIN_URL);
if ([...url.searchParams.keys()].some((key) => key.startsWith("ssl")))
  throw new Error("URL TLS overrides are not allowed");
if (
  !url.hostname.endsWith(".pooler.supabase.com") &&
  !/^db\.[a-z0-9]+\.supabase\.co$/.test(url.hostname)
)
  throw new Error(
    "Scheduler provisioning requires the existing Supabase database",
  );
const client = new pg.Client({
  connectionString: url.toString(),
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: true,
    ca: await readFile(
      new URL("./certs/supabase-ca-2021.crt", import.meta.url),
      "utf8",
    ),
  },
});
let step = "connect";
try {
  await client.connect();
  if (command === "setup") {
    const origin = process.env.APP_ORIGIN,
      secret = process.env.CRON_SECRET;
    if (
      !origin ||
      new URL(origin).origin !== origin ||
      !origin.startsWith("https://") ||
      !secret ||
      secret.length < 32
    )
      throw new Error(
        "Exact HTTPS APP_ORIGIN and CRON_SECRET of at least 32 characters required",
      );
    await client.query("BEGIN");
    try {
      step = "install";
      await client.query(
        await readFile(
          new URL("../deploy/supabase-scheduler.sql", import.meta.url),
          "utf8",
        ),
      );
      for (const [name, value] of [
        ["offerly_scheduler_origin", origin],
        ["offerly_scheduler_secret", secret],
      ]) {
        step = "read_vault";
        const { rows } = await client.query(
          "SELECT id FROM vault.secrets WHERE name=$1",
          [name],
        );
        step = "write_vault";
        if (rows.length)
          await client.query("SELECT vault.update_secret($1,$2)", [
            rows[0].id,
            value,
          ]);
        else
          await client.query("SELECT vault.create_secret($1,$2)", [
            value,
            name,
          ]);
      }
      step = "schedule";
      await client.query(
        "SELECT cron.schedule('offerly-workspace-tick','* * * * *','SELECT offerly.invoke_scheduler();')",
      );
      await client.query(
        "SELECT cron.schedule('offerly-scanner-maintenance','15 * * * *','SELECT offerly.invoke_scanner_maintenance();')",
      );
      await client.query(
        "SELECT cron.alter_job(jobid,active:=true) FROM cron.job WHERE jobname IN ('offerly-workspace-tick','offerly-scanner-maintenance')",
      );
      await client.query("COMMIT");
      console.log(
        "Workspace scheduler enabled every minute; scanner maintenance checked hourly. Credentials stored in Vault.",
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } else if (command === "pause") {
    await client.query(
      "SELECT cron.alter_job(jobid,active:=false) FROM cron.job WHERE jobname IN ('offerly-workspace-tick','offerly-scanner-maintenance')",
    );
    console.log("Scheduler paused. Queued work preserved.");
  } else {
    const queries = {
      schedule:
        "SELECT jobname,schedule,active FROM cron.job WHERE jobname IN ('offerly-workspace-tick','offerly-scanner-maintenance')",
      worker:
        "SELECT started_at,finished_at,status,lease_until,result FROM offerly.scheduler_state WHERE id=1",
      dispatch:
        "SELECT d.dispatched_at,r.status_code,r.timed_out,r.error_msg FROM offerly.scheduler_dispatch d LEFT JOIN net._http_response r ON r.id=d.request_id WHERE d.id=1",
      recentRuns:
        "SELECT status,start_time,end_time FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='offerly-workspace-tick') ORDER BY start_time DESC LIMIT 5",
      scanner:
        "SELECT definitions_at,engine_version,updated_at,lease_until FROM offerly.scanner_state WHERE id=1",
      scannerDispatch:
        "SELECT d.dispatched_at,r.status_code,r.timed_out,r.error_msg FROM offerly.scanner_dispatch d LEFT JOIN net._http_response r ON r.id=d.request_id WHERE d.id=1",
    };
    const result = {};
    for (const [key, sql] of Object.entries(queries)) {
      step = key;
      result[key] = (await client.query(sql)).rows;
    }
    console.log(JSON.stringify(result, null, 2));
  }
} catch (error) {
  // pg errors can echo SQL parameter values. Keep operational failures secret-free.
  console.error(
    "Scheduler command failed. Check database access, schema migrations, extensions and configuration.",
  );
  console.error(
    JSON.stringify({
      step,
      code: /^[A-Z0-9]{5}$/.test(error.code || "")
        ? error.code
        : "configuration_or_connection",
    }),
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
