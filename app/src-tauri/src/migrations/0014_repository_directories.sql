CREATE TABLE IF NOT EXISTS repository_scan_directories (
    path TEXT PRIMARY KEY NOT NULL,
    included INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_disallowed (
    repository_id TEXT PRIMARY KEY NOT NULL
        REFERENCES repository_catalog(id) ON UPDATE RESTRICT ON DELETE CASCADE,
    created_at INTEGER NOT NULL
);

-- Existing catalog entries were explicitly discovered before saved scan roots
-- existed. Preserve them as individually selected roots during migration.
INSERT OR IGNORE INTO repository_scan_directories(path, created_at, updated_at)
SELECT repository_path, created_at, updated_at FROM repository_catalog;
