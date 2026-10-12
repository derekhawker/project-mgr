CREATE TABLE workspaces (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    home_path TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'quick_requests')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    CHECK ((status = 'active' AND completed_at IS NULL) OR
           (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= created_at))
);

CREATE UNIQUE INDEX one_quick_requests_workspace
    ON workspaces(kind) WHERE kind = 'quick_requests';

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    home_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    setup_status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (setup_status IN ('not_started', 'in_progress', 'incomplete', 'ready', 'canceled')),
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    quick_request_created_at INTEGER,
    quick_request_dismissed_at INTEGER,
    quick_request_expires_at INTEGER,
    quick_request_expired_at INTEGER,
    quick_request_promoted_at INTEGER,
    UNIQUE (workspace_id, slug),
    CHECK ((status = 'active' AND completed_at IS NULL) OR
           (status = 'completed' AND completed_at IS NOT NULL AND completed_at >= created_at)),
    CHECK (
        (quick_request_created_at IS NULL AND
         quick_request_dismissed_at IS NULL AND
         quick_request_expires_at IS NULL AND
         quick_request_expired_at IS NULL AND
         quick_request_promoted_at IS NULL)
        OR
        (quick_request_created_at IS NOT NULL AND
         quick_request_created_at = created_at AND
         (quick_request_dismissed_at IS NULL OR
          quick_request_dismissed_at >= quick_request_created_at) AND
         (quick_request_expired_at IS NULL OR
          (quick_request_expires_at IS NOT NULL AND
           quick_request_expired_at >= quick_request_expires_at)) AND
         ((quick_request_promoted_at IS NULL AND quick_request_expires_at IS NOT NULL) OR
          (quick_request_promoted_at IS NOT NULL AND
           quick_request_expires_at IS NULL AND
           quick_request_promoted_at >= quick_request_created_at)))
    )
);

CREATE INDEX tasks_by_workspace ON tasks(workspace_id, status, created_at);

CREATE TRIGGER tasks_match_workspace_kind_on_insert
BEFORE INSERT ON tasks
WHEN
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'quick_requests' AND
     (NEW.quick_request_created_at IS NULL OR NEW.quick_request_promoted_at IS NOT NULL))
    OR
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'regular' AND
     NEW.quick_request_created_at IS NOT NULL AND NEW.quick_request_promoted_at IS NULL)
    OR
    ((SELECT status FROM workspaces WHERE id = NEW.workspace_id) <> 'active')
BEGIN
    SELECT RAISE(ABORT, 'task kind does not match owning workspace');
END;

CREATE TRIGGER tasks_match_workspace_kind_on_update
BEFORE UPDATE OF workspace_id, quick_request_created_at, quick_request_promoted_at ON tasks
WHEN
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'quick_requests' AND
     (NEW.quick_request_created_at IS NULL OR NEW.quick_request_promoted_at IS NOT NULL))
    OR
    ((SELECT kind FROM workspaces WHERE id = NEW.workspace_id) = 'regular' AND
     NEW.quick_request_created_at IS NOT NULL AND NEW.quick_request_promoted_at IS NULL)
    OR
    ((SELECT status FROM workspaces WHERE id = NEW.workspace_id) <> 'active')
BEGIN
    SELECT RAISE(ABORT, 'task kind does not match owning workspace');
END;

CREATE TRIGGER tasks_cannot_reopen
BEFORE UPDATE OF status ON tasks
WHEN OLD.status = 'completed' AND NEW.status <> 'completed'
BEGIN
    SELECT RAISE(ABORT, 'completed tasks cannot be reopened');
END;

CREATE TRIGGER tasks_move_only_when_promoted
BEFORE UPDATE OF workspace_id ON tasks
WHEN OLD.workspace_id <> NEW.workspace_id AND
     (OLD.quick_request_created_at IS NULL OR
      OLD.quick_request_promoted_at IS NOT NULL OR
      NEW.quick_request_promoted_at IS NULL)
BEGIN
    SELECT RAISE(ABORT, 'only an unpromoted Quick Request can change workspace');
END;

CREATE TABLE repository_catalog (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL UNIQUE,
    repository_identity TEXT NOT NULL UNIQUE,
    purpose TEXT,
    purpose_status TEXT NOT NULL DEFAULT 'unavailable'
        CHECK (purpose_status IN ('available', 'unavailable')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE workspace_repositories (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    checkout_path TEXT NOT NULL,
    checkout_mode TEXT NOT NULL CHECK (checkout_mode IN ('existing', 'managed')),
    branch TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'failed')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, repository_id),
    UNIQUE (workspace_id, checkout_path)
);

CREATE TABLE task_repositories (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    branch TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    setup_status TEXT NOT NULL CHECK (setup_status IN ('ready', 'failed', 'not_attempted')),
    error_code TEXT,
    error_detail TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (task_id, repository_id),
    UNIQUE (repository_id, worktree_path),
    UNIQUE (task_id, repository_id, worktree_path)
);

CREATE TABLE sessions (
    open_code_session_id TEXT PRIMARY KEY NOT NULL,
    owner_workspace_id TEXT REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    owner_task_id TEXT REFERENCES tasks(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    directory TEXT NOT NULL,
    last_known_status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK ((owner_workspace_id IS NOT NULL AND owner_task_id IS NULL) OR
           (owner_workspace_id IS NULL AND owner_task_id IS NOT NULL))
);

CREATE INDEX sessions_by_workspace ON sessions(owner_workspace_id, created_at);
CREATE INDEX sessions_by_task ON sessions(owner_task_id, created_at);

CREATE TRIGGER sessions_require_active_owner
BEFORE INSERT ON sessions
WHEN
    (NEW.owner_workspace_id IS NOT NULL AND
     ((SELECT status FROM workspaces WHERE id = NEW.owner_workspace_id) <> 'active' OR
      (SELECT kind FROM workspaces WHERE id = NEW.owner_workspace_id) <> 'regular'))
    OR
    (NEW.owner_task_id IS NOT NULL AND
     (SELECT status FROM tasks WHERE id = NEW.owner_task_id) <> 'active')
BEGIN
    SELECT RAISE(ABORT, 'new sessions require an active eligible owner');
END;

CREATE TRIGGER session_association_is_immutable
BEFORE UPDATE OF owner_workspace_id, owner_task_id, directory ON sessions
BEGIN
    SELECT RAISE(ABORT, 'session owner and directory are immutable');
END;

CREATE TABLE cleanup_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    worktree_path TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'running', 'deferred', 'retained', 'removed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    last_attempt_at INTEGER,
    next_attempt_at INTEGER,
    deferral_reason TEXT,
    failure_detail TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (task_id, repository_id, worktree_path)
        REFERENCES task_repositories(task_id, repository_id, worktree_path)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
    UNIQUE (task_id, repository_id, worktree_path)
);

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO settings(key, value, updated_at)
VALUES ('project_home_root', '~/OpenCode Projects/', 0),
       ('default_model', 'openai/gpt-6-luna', 0);

CREATE TRIGGER workspaces_id_is_immutable
BEFORE UPDATE OF id ON workspaces
BEGIN
    SELECT RAISE(ABORT, 'workspace IDs are immutable');
END;

CREATE TRIGGER tasks_id_is_immutable
BEFORE UPDATE OF id ON tasks
BEGIN
    SELECT RAISE(ABORT, 'task IDs are immutable');
END;

CREATE TRIGGER repository_catalog_id_is_immutable
BEFORE UPDATE OF id ON repository_catalog
BEGIN
    SELECT RAISE(ABORT, 'repository IDs are immutable');
END;

CREATE TRIGGER sessions_id_is_immutable
BEFORE UPDATE OF open_code_session_id ON sessions
BEGIN
    SELECT RAISE(ABORT, 'OpenCode session IDs are immutable');
END;

CREATE TRIGGER cleanup_jobs_id_is_immutable
BEFORE UPDATE OF id ON cleanup_jobs
BEGIN
    SELECT RAISE(ABORT, 'cleanup job IDs are immutable');
END;
