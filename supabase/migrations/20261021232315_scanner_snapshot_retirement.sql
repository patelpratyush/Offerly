BEGIN;
ALTER TABLE offerly.scanner_state ADD COLUMN previous_snapshot_id text NOT NULL DEFAULT '';
ALTER TABLE offerly.scanner_state ADD COLUMN retire_after bigint NOT NULL DEFAULT 0;
COMMIT;
