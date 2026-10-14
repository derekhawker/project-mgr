ALTER TABLE tasks ADD COLUMN setup_operation_id TEXT;
ALTER TABLE tasks ADD COLUMN setup_session_id TEXT;
ALTER TABLE tasks ADD COLUMN setup_cancelled_at INTEGER;
ALTER TABLE tasks ADD COLUMN setup_cancellation_detail TEXT;

CREATE TABLE setup_events (
    event_id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    operation_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('canceled', 'resumed')),
    detail TEXT,
    created_at INTEGER NOT NULL
);
CREATE INDEX setup_events_by_task ON setup_events(task_id, created_at);
