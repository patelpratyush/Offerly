BEGIN;
CREATE TABLE offerly.gmail_accounts (
  user_id text PRIMARY KEY REFERENCES offerly.users(id) ON DELETE CASCADE,
  generation text NOT NULL,
  credentials text NOT NULL DEFAULT '',
  status text NOT NULL,
  connected_at bigint NOT NULL DEFAULT 0
);
CREATE TABLE offerly.gmail_oauth_states (
  user_id text PRIMARY KEY REFERENCES offerly.users(id) ON DELETE CASCADE,
  state_hash text NOT NULL,
  session_hash text NOT NULL,
  verifier text NOT NULL,
  expires bigint NOT NULL,
  generation text NOT NULL
);
ALTER TABLE offerly.gmail_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE offerly.gmail_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.gmail_accounts, offerly.gmail_oauth_states FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON offerly.gmail_accounts, offerly.gmail_oauth_states FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON offerly.gmail_accounts, offerly.gmail_oauth_states FROM authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'offerly_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.gmail_accounts, offerly.gmail_oauth_states TO offerly_app;
    CREATE POLICY server_access ON offerly.gmail_accounts TO offerly_app USING (true) WITH CHECK (true);
    CREATE POLICY server_access ON offerly.gmail_oauth_states TO offerly_app USING (true) WITH CHECK (true);
  END IF;
END $$;
COMMIT;
