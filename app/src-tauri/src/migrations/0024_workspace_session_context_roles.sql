-- Rebuild this table rather than editing migration 18: development databases
-- may have applied an older migration 18 that omitted the `workspace` role.
CREATE TABLE workspace_session_context_new (
    open_code_session_id TEXT PRIMARY KEY NOT NULL
        REFERENCES sessions(open_code_session_id) ON UPDATE RESTRICT ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('workspace', 'orchestrator', 'worker')),
    repository_id TEXT REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK ((role IN ('workspace', 'orchestrator') AND repository_id IS NULL) OR
           (role = 'worker' AND repository_id IS NOT NULL))
);

INSERT INTO workspace_session_context_new(open_code_session_id, workspace_id, role, repository_id)
SELECT open_code_session_id, workspace_id, role, repository_id
FROM workspace_session_context;

DROP TABLE workspace_session_context;
ALTER TABLE workspace_session_context_new RENAME TO workspace_session_context;

CREATE INDEX workspace_sessions_by_repo
    ON workspace_session_context(workspace_id, repository_id, role);

CREATE UNIQUE INDEX one_workspace_orchestrator
    ON workspace_session_context(workspace_id) WHERE role = 'orchestrator';

CREATE UNIQUE INDEX one_workspace_home_session
    ON workspace_session_context(workspace_id) WHERE role = 'workspace';

CREATE TRIGGER workspace_session_context_matches_owner
BEFORE INSERT ON workspace_session_context
WHEN NOT EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.open_code_session_id = NEW.open_code_session_id
      AND s.owner_workspace_id = NEW.workspace_id
      AND s.owner_task_id IS NULL
)
BEGIN
    SELECT RAISE(ABORT, 'workspace session context must match its session owner');
END;

CREATE TRIGGER workspace_session_context_matches_directory
BEFORE INSERT ON workspace_session_context
WHEN (NEW.role IN ('workspace', 'orchestrator') AND NOT EXISTS (
        SELECT 1 FROM sessions s JOIN workspaces w ON w.id = NEW.workspace_id
        WHERE s.open_code_session_id = NEW.open_code_session_id
          AND s.directory = w.home_path
    ))
    OR (NEW.role = 'worker' AND NOT EXISTS (
        SELECT 1 FROM sessions s
        JOIN workspace_repository_worktrees wr
          ON wr.workspace_id = NEW.workspace_id
         AND wr.repository_id = NEW.repository_id
         AND wr.worktree_path = s.directory
         AND wr.setup_status = 'ready'
        WHERE s.open_code_session_id = NEW.open_code_session_id
    ))
BEGIN
    SELECT RAISE(ABORT, 'workspace session directory must match its role context');
END;
