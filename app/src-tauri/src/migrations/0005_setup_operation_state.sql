CREATE TABLE setup_operation_state (
    operation_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
    session_id TEXT NOT NULL REFERENCES sessions(open_code_session_id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('active', 'canceled')),
    canceled_at INTEGER
);

CREATE INDEX setup_operation_state_by_task ON setup_operation_state(task_id);

INSERT INTO setup_operation_state(operation_id, workspace_id, task_id, session_id, status, canceled_at)
SELECT setup_operation_id, workspace_id, id, setup_session_id, 'active', NULL
FROM tasks
WHERE setup_operation_id IS NOT NULL AND setup_session_id IS NOT NULL;
