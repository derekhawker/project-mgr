CREATE TABLE repository_catalog_by_path (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    repository_path TEXT NOT NULL UNIQUE,
    repository_identity TEXT NOT NULL,
    purpose TEXT,
    purpose_status TEXT NOT NULL DEFAULT 'unavailable'
        CHECK (purpose_status IN ('available', 'unavailable')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
);

INSERT INTO repository_catalog_by_path (
    id, name, repository_path, repository_identity, purpose, purpose_status,
    created_at, updated_at, deleted_at
)
SELECT id, name, repository_path, repository_identity, purpose, purpose_status,
       created_at, updated_at, deleted_at
FROM repository_catalog;

DROP TABLE repository_catalog;
ALTER TABLE repository_catalog_by_path RENAME TO repository_catalog;

CREATE INDEX repository_catalog_by_identity
    ON repository_catalog(repository_identity);

CREATE TRIGGER repository_catalog_id_is_immutable
BEFORE UPDATE OF id ON repository_catalog
BEGIN
    SELECT RAISE(ABORT, 'repository IDs are immutable');
END;
