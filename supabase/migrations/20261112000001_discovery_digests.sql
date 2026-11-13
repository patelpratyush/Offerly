BEGIN;
ALTER TABLE offerly.discovery_alert_rules ADD COLUMN cadence TEXT NOT NULL DEFAULT 'immediate' CHECK(cadence IN ('immediate','daily','weekly'));
ALTER TABLE offerly.discovery_notifications ADD COLUMN digest_id TEXT NOT NULL DEFAULT '';
CREATE TABLE offerly.discovery_digest_settings(user_id TEXT PRIMARY KEY REFERENCES offerly.users(id) ON DELETE CASCADE,hour INTEGER NOT NULL DEFAULT 8 CHECK(hour>=0 AND hour<=23),weekday INTEGER NOT NULL DEFAULT 1 CHECK(weekday>=0 AND weekday<=6),updated_at TEXT NOT NULL);
CREATE TABLE offerly.discovery_digests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES offerly.users(id) ON DELETE CASCADE,cadence TEXT NOT NULL CHECK(cadence IN ('daily','weekly')),period_key TEXT NOT NULL,payload TEXT NOT NULL DEFAULT '{}',item_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,delivered_at TEXT NOT NULL,read_at TEXT,UNIQUE(user_id,cadence,period_key));
CREATE INDEX idx_disc_digests_user ON offerly.discovery_digests(user_id,delivered_at);
CREATE TABLE offerly.discovery_state(key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL);
CREATE INDEX idx_disc_notes_rule ON offerly.discovery_notifications(rule_id,status);
ALTER TABLE offerly.discovery_digest_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.discovery_digest_settings FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.discovery_digest_settings FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.discovery_digest_settings FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.discovery_digest_settings TO offerly_app;
CREATE POLICY server_access ON offerly.discovery_digest_settings TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
ALTER TABLE offerly.discovery_digests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.discovery_digests FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.discovery_digests FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.discovery_digests FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.discovery_digests TO offerly_app;
CREATE POLICY server_access ON offerly.discovery_digests TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
ALTER TABLE offerly.discovery_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.discovery_state FROM PUBLIC;
DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON offerly.discovery_state FROM anon; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON offerly.discovery_state FROM authenticated; END IF;
IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='offerly_app') THEN
GRANT SELECT, INSERT, UPDATE, DELETE ON offerly.discovery_state TO offerly_app;
CREATE POLICY server_access ON offerly.discovery_state TO offerly_app USING(true) WITH CHECK(true);
END IF;
END $$;
COMMIT;
