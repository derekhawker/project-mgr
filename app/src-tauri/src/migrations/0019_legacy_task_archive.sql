CREATE TABLE legacy_task_archives (
    task_id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    archived_at INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    restored_at INTEGER
);

CREATE INDEX legacy_task_archives_by_workspace
    ON legacy_task_archives(workspace_id, archived_at, task_id);
