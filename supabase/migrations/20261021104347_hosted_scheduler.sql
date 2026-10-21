BEGIN;
CREATE TABLE offerly.scheduler_state (
  id integer PRIMARY KEY CHECK (id = 1),
  lease_owner text NOT NULL DEFAULT '',
  lease_until bigint NOT NULL DEFAULT 0,
  recruiting_cursor text NOT NULL DEFAULT '',
  reminder_cursor text NOT NULL DEFAULT '',
  started_at bigint NOT NULL DEFAULT 0,
  finished_at bigint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','running','completed','failed')),
  result text NOT NULL DEFAULT '{}'
);
INSERT INTO offerly.scheduler_state(id) VALUES (1);
ALTER TABLE offerly.scheduler_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.scheduler_state FROM PUBLIC;
-- Runtime role is provisioned separately on fresh installations.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'offerly_app') THEN
    GRANT SELECT, UPDATE ON offerly.scheduler_state TO offerly_app;
    CREATE POLICY server_access ON offerly.scheduler_state TO offerly_app USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
