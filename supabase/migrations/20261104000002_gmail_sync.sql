BEGIN;
CREATE TABLE offerly.gmail_sync(user_id text PRIMARY KEY REFERENCES offerly.users(id) ON DELETE CASCADE,generation text NOT NULL,state text NOT NULL,version integer NOT NULL DEFAULT 1);
CREATE TABLE offerly.gmail_seen(user_id text NOT NULL REFERENCES offerly.users(id) ON DELETE CASCADE,source_id text NOT NULL,PRIMARY KEY(user_id,source_id));
ALTER TABLE offerly.gmail_sync ENABLE ROW LEVEL SECURITY;
ALTER TABLE offerly.gmail_seen ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.gmail_sync, offerly.gmail_seen FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON offerly.gmail_sync, offerly.gmail_seen FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON offerly.gmail_sync, offerly.gmail_seen FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'offerly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.gmail_sync, offerly.gmail_seen TO offerly_app;
    CREATE POLICY server_access ON offerly.gmail_sync TO offerly_app USING (true) WITH CHECK (true);
    CREATE POLICY server_access ON offerly.gmail_seen TO offerly_app USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
