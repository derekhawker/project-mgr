ALTER TABLE workspace_repositories RENAME TO workspace_repositories_legacy;

CREATE TABLE workspace_repositories (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    checkout_path TEXT NOT NULL,
    checkout_mode TEXT NOT NULL CHECK (checkout_mode IN ('existing', 'managed', 'clone')),
    branch TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'failed')),
    source_identity TEXT NOT NULL,
    checkout_identity TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, repository_id),
    UNIQUE (workspace_id, checkout_path)
);

INSERT INTO workspace_repositories(
    workspace_id, repository_id, checkout_path, checkout_mode, branch,
    verification_status, source_identity, checkout_identity, default_branch, created_at
)
SELECT old.workspace_id, old.repository_id, old.checkout_path, old.checkout_mode, old.branch,
       old.verification_status, catalog.repository_identity, catalog.repository_identity,
       old.branch, old.created_at
FROM workspace_repositories_legacy old
JOIN repository_catalog catalog ON catalog.id = old.repository_id;

DROP TABLE workspace_repositories_legacy;

CREATE TABLE workspace_repository_setup (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    repository_id TEXT NOT NULL REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
    setup_status TEXT NOT NULL CHECK (setup_status IN ('pending', 'ready', 'failed')),
    plan_json TEXT NOT NULL,
    checkout_identity TEXT,
    error_code TEXT,
    error_detail TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, repository_id),
    CHECK ((setup_status = 'failed' AND error_detail IS NOT NULL) OR setup_status <> 'failed'),
    CHECK ((setup_status = 'ready' AND checkout_identity IS NOT NULL) OR setup_status <> 'ready')
);

CREATE INDEX workspace_repository_setup_by_status
    ON workspace_repository_setup(workspace_id, setup_status, repository_id);
