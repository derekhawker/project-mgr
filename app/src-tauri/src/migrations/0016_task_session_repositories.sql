CREATE TABLE IF NOT EXISTS task_session_repositories (
    open_code_session_id TEXT PRIMARY KEY REFERENCES sessions(open_code_session_id) ON UPDATE RESTRICT ON DELETE CASCADE,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    UNIQUE (task_id, repository_id)
);

CREATE INDEX IF NOT EXISTS task_session_repositories_by_task
    ON task_session_repositories(task_id, repository_id);
