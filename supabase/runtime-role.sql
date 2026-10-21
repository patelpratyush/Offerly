-- Run once as the migration owner, AFTER the schema migration.
-- Set the password separately with psql's \password offerly_app command.
BEGIN;
CREATE ROLE offerly_app LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT USAGE ON SCHEMA offerly TO offerly_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA offerly TO offerly_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA offerly TO offerly_app;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','sessions','records','events','import_batches','files','rate_limits','mutation_receipts'] LOOP
    EXECUTE format('CREATE POLICY server_access ON offerly.%I TO offerly_app USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END $$;
COMMIT;
