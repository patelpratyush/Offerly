BEGIN;
ALTER TABLE offerly.scheduler_state ADD COLUMN last_signed_at bigint NOT NULL DEFAULT 0;
COMMIT;
