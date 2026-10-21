BEGIN;
ALTER TABLE offerly.files ADD COLUMN storage_key text;
ALTER TABLE offerly.files ADD COLUMN byte_size bigint CHECK (byte_size > 0);
-- Intentionally no user foreign key: deletion work outlives its account.
CREATE TABLE offerly.file_objects (
  storage_key text PRIMARY KEY,
  user_id text NOT NULL,
  file_id text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  expires_at bigint NOT NULL,
  state text NOT NULL CHECK (state IN ('pending','attached','deleting'))
);
CREATE INDEX file_objects_owner ON offerly.file_objects(user_id);
CREATE INDEX file_objects_cleanup ON offerly.file_objects(state,expires_at);
CREATE TABLE offerly.scanner_state (
  id integer PRIMARY KEY CHECK (id = 1),
  snapshot_id text NOT NULL DEFAULT '',
  definitions_at bigint NOT NULL DEFAULT 0,
  engine_version text NOT NULL DEFAULT '',
  lease_until bigint NOT NULL DEFAULT 0,
  last_signed_at bigint NOT NULL DEFAULT 0,
  updated_at bigint NOT NULL DEFAULT 0
);
INSERT INTO offerly.scanner_state(id) VALUES (1);
ALTER TABLE offerly.file_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE offerly.scanner_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.file_objects, offerly.scanner_state FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'offerly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.file_objects TO offerly_app;
    GRANT SELECT, UPDATE ON offerly.scanner_state TO offerly_app;
    CREATE POLICY server_access ON offerly.file_objects TO offerly_app USING (true) WITH CHECK (true);
    CREATE POLICY server_access ON offerly.scanner_state TO offerly_app USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
