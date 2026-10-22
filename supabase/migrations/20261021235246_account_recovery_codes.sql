BEGIN;
CREATE TABLE offerly.recovery_codes (
  user_id text NOT NULL REFERENCES offerly.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY (user_id, code_hash)
);
ALTER TABLE offerly.recovery_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.recovery_codes FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON offerly.recovery_codes FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON offerly.recovery_codes FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'offerly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.recovery_codes TO offerly_app;
    CREATE POLICY server_access ON offerly.recovery_codes TO offerly_app USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
