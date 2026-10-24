CREATE TABLE workspace_repository_worktrees (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    source_identity TEXT NOT NULL,
    checkout_identity TEXT,
    branch TEXT NOT NULL,
    base_checkout_path TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    workspace_link TEXT NOT NULL,
    setup_status TEXT NOT NULL CHECK (setup_status IN ('pending', 'ready', 'failed')),
    error_code TEXT,
    error_detail TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, repository_id),
    UNIQUE (repository_id, worktree_path),
    CHECK ((setup_status = 'ready' AND checkout_identity IS NOT NULL) OR setup_status <> 'ready'),
    CHECK ((setup_status = 'failed' AND error_detail IS NOT NULL) OR setup_status <> 'failed')
);

CREATE INDEX workspace_worktrees_by_status
    ON workspace_repository_worktrees(workspace_id, setup_status, repository_id);

CREATE TABLE workspace_session_context (
    open_code_session_id TEXT PRIMARY KEY NOT NULL
        REFERENCES sessions(open_code_session_id) ON UPDATE RESTRICT ON DELETE CASCADE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    role TEXT NOT NULL CHECK (role IN ('workspace', 'orchestrator', 'worker')),
    repository_id TEXT REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    CHECK ((role IN ('workspace', 'orchestrator') AND repository_id IS NULL) OR
           (role = 'worker' AND repository_id IS NOT NULL))
);

CREATE INDEX workspace_sessions_by_repo
    ON workspace_session_context(workspace_id, repository_id, role);

CREATE UNIQUE INDEX one_workspace_orchestrator
    ON workspace_session_context(workspace_id) WHERE role = 'orchestrator';

CREATE UNIQUE INDEX one_workspace_home_session
    ON workspace_session_context(workspace_id) WHERE role = 'workspace';

CREATE TABLE workspace_tags (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE CASCADE,
    tag TEXT NOT NULL CHECK (length(trim(tag)) BETWEEN 1 AND 80),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, tag)
);

CREATE INDEX workspace_tags_by_tag ON workspace_tags(tag, workspace_id);

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

INSERT OR IGNORE INTO settings(key, value, updated_at)
VALUES ('repository_library_root', '~/OpenCode Projects/Repositories/', 0);
