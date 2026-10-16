CREATE TABLE IF NOT EXISTS task_repository_selection (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE CASCADE,
    repository_ids_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
