CREATE TABLE setup_operations (
    operation_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    session_id TEXT NOT NULL REFERENCES sessions(open_code_session_id) ON DELETE RESTRICT,
    report_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX setup_operations_by_task ON setup_operations(task_id, created_at);
