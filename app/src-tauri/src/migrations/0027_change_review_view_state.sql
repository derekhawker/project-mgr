CREATE TABLE change_review_repository_state (
    workspace_id TEXT NOT NULL,
    ticket_filename TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    head_commit TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, ticket_filename, repository_id)
);

CREATE TABLE change_review_viewed_files (
    workspace_id TEXT NOT NULL,
    ticket_filename TEXT NOT NULL,
    repository_id TEXT NOT NULL,
    path TEXT NOT NULL,
    PRIMARY KEY (workspace_id, ticket_filename, repository_id, path),
    FOREIGN KEY (workspace_id, ticket_filename, repository_id)
        REFERENCES change_review_repository_state(workspace_id, ticket_filename, repository_id)
        ON DELETE CASCADE
);
