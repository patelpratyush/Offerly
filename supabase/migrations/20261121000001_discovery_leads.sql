BEGIN;
ALTER TABLE offerly.discovery_sources DROP CONSTRAINT discovery_sources_platform_check;
ALTER TABLE offerly.discovery_sources ADD CONSTRAINT discovery_sources_platform_check CHECK(platform IN ('greenhouse','lever','ashby','smartrecruiters','workable'));
CREATE TABLE offerly.discovery_leads(platform TEXT NOT NULL,board_id TEXT NOT NULL,url TEXT NOT NULL,origin TEXT NOT NULL CHECK(origin IN ('application','gmail','manual')),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','promoted','rejected')),seen_count INTEGER NOT NULL DEFAULT 1,first_seen_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,PRIMARY KEY(platform,board_id));
ALTER TABLE offerly.discovery_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.discovery_leads FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.discovery_leads FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.discovery_leads FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.discovery_leads TO offerly_app;
CREATE POLICY server_access ON offerly.discovery_leads TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
COMMIT;
