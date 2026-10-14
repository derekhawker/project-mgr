ALTER TABLE sessions ADD COLUMN event_cursor TEXT;
ALTER TABLE sessions ADD COLUMN reconciliation_status TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE sessions ADD COLUMN reconciliation_uncertain INTEGER NOT NULL DEFAULT 1 CHECK (reconciliation_uncertain IN (0, 1));
ALTER TABLE sessions ADD COLUMN pending_input_json TEXT;
