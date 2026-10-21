-- Run with the database owner through npm run scheduler:setup.
-- Secrets are supplied separately as bound parameters, never embedded here.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS offerly.scheduler_dispatch (
  id integer PRIMARY KEY CHECK (id = 1),
  request_id bigint NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE offerly.scheduler_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.scheduler_dispatch FROM PUBLIC, anon, authenticated, offerly_app;

CREATE OR REPLACE FUNCTION offerly.invoke_scheduler() RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  origin text;
  secret text;
  request_id bigint;
  signed_at text;
BEGIN
  SELECT decrypted_secret INTO origin FROM vault.decrypted_secrets WHERE name = 'offerly_scheduler_origin';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'offerly_scheduler_secret';
  IF origin IS NULL OR origin !~ '^https://[^/]+$' OR secret IS NULL OR length(secret) < 32 THEN
    RAISE EXCEPTION 'Offerly scheduler configuration missing or invalid';
  END IF;
  signed_at := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text;
  SELECT net.http_get(
    url := origin || '/api/jobs/run',
    -- pg_net queue grants are platform-managed. Never put the secret in it.
    headers := jsonb_build_object(
      'x-offerly-scheduler-at', signed_at,
      'x-offerly-scheduler-signature', encode(extensions.hmac(signed_at || ':/api/jobs/run', secret, 'sha256'), 'hex')
    ),
    timeout_milliseconds := 55000
  ) INTO request_id;
  INSERT INTO offerly.scheduler_dispatch(id, request_id, dispatched_at)
    VALUES (1, request_id, now())
    ON CONFLICT (id) DO UPDATE SET request_id = EXCLUDED.request_id, dispatched_at = EXCLUDED.dispatched_at;
  DELETE FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'offerly-workspace-tick')
    AND end_time < now() - interval '7 days';
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION offerly.invoke_scheduler() FROM PUBLIC, anon, authenticated, offerly_app;

CREATE TABLE IF NOT EXISTS offerly.scanner_dispatch (
  id integer PRIMARY KEY CHECK (id = 1),
  request_id bigint NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE offerly.scanner_dispatch ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON offerly.scanner_dispatch FROM PUBLIC, anon, authenticated, offerly_app;

CREATE OR REPLACE FUNCTION offerly.invoke_scanner_maintenance() RETURNS bigint
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE origin text; secret text; request_id bigint; signed_at text;
BEGIN
  SELECT decrypted_secret INTO origin FROM vault.decrypted_secrets WHERE name = 'offerly_scheduler_origin';
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'offerly_scheduler_secret';
  IF origin IS NULL OR origin !~ '^https://[^/]+$' OR secret IS NULL OR length(secret) < 32 THEN
    RAISE EXCEPTION 'Offerly scheduler configuration missing or invalid';
  END IF;
  signed_at := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint::text;
  SELECT net.http_get(
    url := origin || '/api/jobs/scanner',
    headers := jsonb_build_object(
      'x-offerly-scheduler-at', signed_at,
      'x-offerly-scheduler-signature', encode(extensions.hmac(signed_at || ':/api/jobs/scanner', secret, 'sha256'), 'hex')
    ), timeout_milliseconds := 300000
  ) INTO request_id;
  INSERT INTO offerly.scanner_dispatch(id, request_id, dispatched_at)
    VALUES (1, request_id, now()) ON CONFLICT (id) DO UPDATE
    SET request_id = EXCLUDED.request_id, dispatched_at = EXCLUDED.dispatched_at;
  DELETE FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'offerly-scanner-maintenance')
    AND end_time < now() - interval '7 days';
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION offerly.invoke_scanner_maintenance() FROM PUBLIC, anon, authenticated, offerly_app;
