import { createStore } from "./store.js";
import { refreshScannerSnapshot } from "./sandbox-scanner.js";

// Operational CLI; SDK reads local OIDC or Vercel-managed production credentials.
// Pass --env-file=.env --env-file=.env.local when running locally.
const command = process.argv[2];
if (!["refresh", "status"].includes(command))
  throw new Error(
    "Usage: node --env-file=.env --env-file=.env.local server/scanner-admin.js refresh|status",
  );
if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || ""))
  throw new Error("Hosted DATABASE_URL required");
let store;
let leaseUntil;
try {
  store = await createStore(process.env.DATABASE_URL);
  const state = await store.db
    .prepare("SELECT * FROM scanner_state WHERE id=1")
    .get();
  if (command === "status") {
    console.log(
      JSON.stringify(
        state
          ? {
              snapshotId: state.snapshot_id,
              definitionsAt: state.definitions_at,
              engineVersion: state.engine_version,
              updatedAt: state.updated_at,
              previousSnapshotId: state.previous_snapshot_id || null,
              retireAfter: state.retire_after,
              fresh:
                Number(state.definitions_at) >=
                Date.now() - 48 * 60 * 60 * 1000,
            }
          : { configured: false },
      ),
    );
  } else {
    const started = Date.now();
    leaseUntil = started + 6 * 60 * 1000;
    const claimed = await store.db
      .prepare(
        "UPDATE scanner_state SET lease_until=? WHERE id=1 AND lease_until<=? RETURNING snapshot_id",
      )
      .get(leaseUntil, started);
    if (!claimed)
      throw new Error("Scanner maintenance already running or state missing");
    const metadata = await refreshScannerSnapshot({
      snapshotId: claimed.snapshot_id || undefined,
      onProgress: (event) => console.log(JSON.stringify(event)),
    });
    const saved = await store.db
      .prepare(
        `UPDATE scanner_state SET
          previous_snapshot_id=CASE WHEN snapshot_id<>? THEN snapshot_id ELSE previous_snapshot_id END,
          retire_after=CASE WHEN snapshot_id<>? THEN ? ELSE retire_after END,
          snapshot_id=?,definitions_at=?,engine_version=?,updated_at=?,lease_until=0
          WHERE id=1 AND lease_until=?`,
      )
      .run(
        metadata.snapshotId,
        metadata.snapshotId,
        Date.now() + 120000,
        metadata.snapshotId,
        metadata.definitionsAt,
        metadata.engineVersion,
        Date.now(),
        leaseUntil,
      );
    if (saved.changes !== 1) throw new Error("Scanner maintenance lease lost");
    console.log(JSON.stringify({ event: "scanner_ready", ...metadata }));
  }
} catch {
  // Provider errors may include credentials or upload contents; never print them.
  console.error(
    "Scanner command failed. Check database access, Sandbox authentication, engine installation and signature availability.",
  );
  process.exitCode = 1;
} finally {
  if (store) {
    if (leaseUntil) {
      try {
        await store.db
          .prepare(
            "UPDATE scanner_state SET lease_until=0 WHERE id=1 AND lease_until=?",
          )
          .run(leaseUntil);
      } catch {
        /* A failed connection leaves the bounded lease to expire. */
      }
    }
    await store.db.close();
  }
}
