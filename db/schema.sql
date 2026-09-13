-- Idempotent schema for field-dispatch-automation.
-- Safe to run repeatedly:  npm run db:migrate
BEGIN;

CREATE TABLE IF NOT EXISTS completed_jobs (
  id              serial PRIMARY KEY,
  job_id          varchar(64)  NOT NULL UNIQUE,
  customer_email  varchar(254) NOT NULL,
  summary         text,
  price           numeric(10,2) NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now()
);

-- Columns added on top of the original 5-column table.
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS tech_name        varchar(120);
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS raw_notes        text;
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS status           varchar(32) NOT NULL DEFAULT 'notified';
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS pdf_data         bytea;
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS photo_count      integer NOT NULL DEFAULT 0;
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS summary_sent_at  timestamptz;
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS last_error       text;
ALTER TABLE completed_jobs ADD COLUMN IF NOT EXISTS updated_at       timestamptz NOT NULL DEFAULT now();

-- Pre-existing rows were fully processed; new rows start at 'received'.
ALTER TABLE completed_jobs ALTER COLUMN status SET DEFAULT 'received';

-- The pipeline inserts the row before the LLM summary exists (that insert is the idempotency lock).
ALTER TABLE completed_jobs ALTER COLUMN summary DROP NOT NULL;

-- created_at was "timestamp without time zone"; Neon wrote it as UTC.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'completed_jobs' AND column_name = 'created_at'
      AND data_type = 'timestamp without time zone'
  ) THEN
    ALTER TABLE completed_jobs
      ALTER COLUMN created_at TYPE timestamptz USING created_at AT TIME ZONE 'UTC';
    ALTER TABLE completed_jobs ALTER COLUMN created_at SET DEFAULT now();
    ALTER TABLE completed_jobs ALTER COLUMN created_at SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'completed_jobs_status_check') THEN
    ALTER TABLE completed_jobs ADD CONSTRAINT completed_jobs_status_check
      CHECK (status IN ('received', 'summarized', 'stored', 'notified', 'notify_failed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS completed_jobs_customer_email_idx ON completed_jobs (lower(customer_email));
CREATE INDEX IF NOT EXISTS completed_jobs_created_at_idx     ON completed_jobs (created_at);

-- Follow-up communications. Agents may INSERT drafts; only humans move them past 'draft'.
CREATE TABLE IF NOT EXISTS follow_ups (
  id              serial PRIMARY KEY,
  job_id          varchar(64)  NOT NULL REFERENCES completed_jobs(job_id) ON DELETE CASCADE,
  customer_email  varchar(254) NOT NULL,
  subject         varchar(200) NOT NULL,
  body            text         NOT NULL,
  status          varchar(16)  NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'approved', 'rejected', 'sent', 'failed')),
  created_by      varchar(120) NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  reviewed_by     varchar(120),
  reviewed_at     timestamptz,
  sent_at         timestamptz,
  last_error      text
);

CREATE INDEX IF NOT EXISTS follow_ups_job_id_idx ON follow_ups (job_id);
CREATE INDEX IF NOT EXISTS follow_ups_status_idx ON follow_ups (status);

COMMIT;
