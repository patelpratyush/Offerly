BEGIN;
CREATE TABLE offerly.recruiting_ai_consent(user_id text PRIMARY KEY REFERENCES offerly.users(id) ON DELETE CASCADE,version text NOT NULL,generation text NOT NULL,accepted_at bigint NOT NULL,withdrawn_at bigint NOT NULL DEFAULT 0);
CREATE TABLE offerly.recruiting_ai_budget(user_id text NOT NULL REFERENCES offerly.users(id) ON DELETE CASCADE,day text NOT NULL,requests bigint NOT NULL,reserved_microdollars bigint NOT NULL,PRIMARY KEY(user_id,day));
CREATE TABLE offerly.recruiting_ai_reservations(id text PRIMARY KEY,user_id text NOT NULL REFERENCES offerly.users(id) ON DELETE CASCADE,day text NOT NULL,reserved_microdollars bigint NOT NULL,created_at bigint NOT NULL,consent_generation text NOT NULL,evidence_version text NOT NULL);
ALTER TABLE offerly.recruiting_ai_consent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.recruiting_ai_consent FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.recruiting_ai_consent FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.recruiting_ai_consent FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.recruiting_ai_consent TO offerly_app;
CREATE POLICY server_access ON offerly.recruiting_ai_consent TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
ALTER TABLE offerly.recruiting_ai_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.recruiting_ai_budget FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.recruiting_ai_budget FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.recruiting_ai_budget FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.recruiting_ai_budget TO offerly_app;
CREATE POLICY server_access ON offerly.recruiting_ai_budget TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
ALTER TABLE offerly.recruiting_ai_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.recruiting_ai_reservations FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.recruiting_ai_reservations FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.recruiting_ai_reservations FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.recruiting_ai_reservations TO offerly_app;
CREATE POLICY server_access ON offerly.recruiting_ai_reservations TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
CREATE TABLE offerly.recruiting_ai_project_budget(day text PRIMARY KEY,requests bigint NOT NULL,reserved_microdollars bigint NOT NULL);
ALTER TABLE offerly.recruiting_ai_project_budget ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.recruiting_ai_project_budget FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.recruiting_ai_project_budget FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.recruiting_ai_project_budget FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.recruiting_ai_project_budget TO offerly_app;
CREATE POLICY server_access ON offerly.recruiting_ai_project_budget TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
COMMIT;
