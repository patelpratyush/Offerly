# SQLite backup and recovery

Run these commands as the dedicated application OS user, using Node 24. The destination parent directory must already exist, be private to that user, and reside on encrypted storage. Backups contain password hashes, account details and uploaded documents. These tools do not encrypt files or configure scheduling, retention or off-host replication.

## Create a backup

```sh
npm run db:backup -- /private/data/offerly.sqlite /private/backups/offerly-2026-10-20.sqlite
```

The app may stay running. The tool uses SQLite's [online backup API](https://nodejs.org/download/release/v24.5.0/docs/api/sqlite.html) to include committed WAL data consistently. It checks database integrity, foreign keys and required schema, then publishes a standalone snapshot with mode 0600. Existing destinations and destination sidecars are refused. Publication uses an exclusive hard link on the same filesystem; the filesystem must support hard links and fsync. Interrupted runs can leave private `.offerly-snapshot-*` temporary directories; remove abandoned directories only after confirming no backup process is running.

A successful snapshot is not evidence of off-host durability. Schedule this command with failure alerts, encrypt and replicate backups, and test your storage provider's recovery path. Do not blindly copy a live SQLite database file.

## Restore to a fresh path

1. Stop the app and background writers. Record the old DATABASE_PATH and retain the old database for rollback according to your retention policy.
2. Choose a new path with no database or sidecar files. Restore only backups from trusted storage:

   ```sh
   npm run db:restore -- /private/backups/offerly-2026-10-20.sqlite /private/data/restored-2026-10-20.sqlite
   ```

3. The tool verifies the restored database and deletes all restored sessions before publishing it. Users must sign in again. It does not overwrite or switch the running database.
4. **Reconcile account deletions and password changes made after the snapshot before exposing the restored app.** Recovery rolls account state back, including password hashes, deleted accounts and uploaded data. Session revocation does not prevent an old password from working. Use your incident and deletion records to remediate this before reopening access.
5. Set DATABASE_PATH to the new absolute path and start the app with the existing production TLS, origin and scanner configuration. Verify sign-in, owner isolation, application records, document access and monitoring in an isolated deployment first. Unscanned legacy files remain blocked in production.
6. Record recovery duration and acceptable data loss. Reapply retention/deletion schedules to old databases, backups, replicas and temporary files. Retain rollback material only as long as policy requires.

The command does not migrate older schema versions. Keep the corresponding app version with backups; perform any required migrations on an isolated restored copy. Never use the live production path for a restoration drill.

## Automated evidence

`node --test tests/backup.test.js` checks backup from an open WAL database, snapshot isolation from later writes, restored file bytes, session revocation, restrictive permissions, refusal of existing paths/symlinks/sidecars, and failure on missing, malformed or unrelated databases. These synthetic local checks do not establish recovery time, backup retention compliance or deployment readiness.
