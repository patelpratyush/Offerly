import { createStore } from "./store.js";
import { schedulerAuthorization } from "./scheduler-auth.js";
import {
  refreshScannerSnapshot,
  deleteScannerSnapshot,
} from "./sandbox-scanner.js";

export function createScannerMaintenanceHandler({
  env = process.env,
  storeFactory = createStore,
  refresh = refreshScannerSnapshot,
  retire = deleteScannerSnapshot,
} = {}) {
  let initialization;
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Content-Type-Options", "nosniff");
    let store, lease;
    try {
      const path = "/api/jobs/scanner";
      if (new URL(req.url, "https://localhost").pathname !== path) {
        res.statusCode = 404;
        return res.end();
      }
      const authorization = schedulerAuthorization(req, env, path);
      if (authorization.status !== 200) {
        res.statusCode = authorization.status;
        return res.end();
      }
      if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL || ""))
        throw new Error("Hosted database required");
      initialization ||= storeFactory(env.DATABASE_URL).catch((error) => {
        initialization = undefined;
        throw error;
      });
      store = await initialization;
      const now = Date.now();
      lease = now + 330000; // Exceeds this dedicated function's 300-second limit.
      const claimed = await store.db
        .prepare(
          "UPDATE scanner_state SET lease_until=?,last_signed_at=CASE WHEN ?>last_signed_at THEN ? ELSE last_signed_at END WHERE id=1 AND lease_until<=? AND (updated_at<? OR (previous_snapshot_id<>'' AND retire_after<=?)) AND (CAST(? AS BIGINT)=0 OR last_signed_at<?) RETURNING snapshot_id,updated_at,previous_snapshot_id,retire_after",
        )
        .get(
          lease,
          authorization.signedAt,
          authorization.signedAt,
          now,
          now - 24 * 60 * 60 * 1000,
          now,
          authorization.signedAt,
          authorization.signedAt,
        );
      if (!claimed) {
        lease = undefined;
        return res.end(JSON.stringify({ skipped: true }));
      }
      if (claimed.previous_snapshot_id) {
        if (
          Number(claimed.retire_after) > now ||
          !(await retire(claimed.previous_snapshot_id, {
            activeSnapshotId: claimed.snapshot_id,
          }))
        )
          throw new Error("Previous snapshot retirement pending");
        await store.db
          .prepare(
            "UPDATE scanner_state SET previous_snapshot_id='',retire_after=0 WHERE id=1 AND lease_until=? AND previous_snapshot_id=?",
          )
          .run(lease, claimed.previous_snapshot_id);
      }
      if (Number(claimed.updated_at) >= now - 24 * 60 * 60 * 1000) {
        await store.db
          .prepare(
            "UPDATE scanner_state SET lease_until=0 WHERE id=1 AND lease_until=?",
          )
          .run(lease);
        lease = undefined;
        return res.end(JSON.stringify({ skipped: true }));
      }
      const metadata = await refresh({
        snapshotId: claimed.snapshot_id || undefined,
      });
      const saved = await store.db
        .prepare(
          "UPDATE scanner_state SET previous_snapshot_id=snapshot_id,retire_after=?,snapshot_id=?,definitions_at=?,engine_version=?,updated_at=?,lease_until=0 WHERE id=1 AND lease_until=?",
        )
        .run(
          Date.now() + 120000,
          metadata.snapshotId,
          metadata.definitionsAt,
          metadata.engineVersion,
          Date.now(),
          lease,
        );
      if (!saved.changes) throw new Error("Maintenance lease expired");
      lease = undefined;
      console.info(
        JSON.stringify({
          event: "scanner_refreshed",
          definitionsAt: metadata.definitionsAt,
          engineVersion: metadata.engineVersion,
        }),
      );
      return res.end(JSON.stringify({ refreshed: true }));
    } catch {
      if (store && lease) {
        try {
          await store.db
            .prepare(
              "UPDATE scanner_state SET lease_until=0 WHERE id=1 AND lease_until=?",
            )
            .run(lease);
        } catch {
          /* Expired leases recover automatically. */
        }
      }
      console.error('{"event":"scanner_maintenance_failed"}');
      res.statusCode = 503;
      return res.end(
        JSON.stringify({ error: "Scanner maintenance unavailable" }),
      );
    }
  };
}
