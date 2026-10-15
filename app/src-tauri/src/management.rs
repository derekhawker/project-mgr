//! SQLite-backed management records. Conversation history remains in OpenCode;
//! Quick Requests separately retain only their original prompt for the list.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ValueRef};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::safety::{self, GitInspection, ManagedHomeGuard, SafetyError};

pub const DEFAULT_PROJECT_HOME_ROOT: &str = "~/OpenCode Projects/";
pub const DEFAULT_MODEL: &str = "openai/gpt-6-luna";
const QUICK_REQUEST_LIFETIME_MS: i64 = 24 * 60 * 60 * 1_000;
const CLEANUP_RUNNING_STALE_AFTER_MS: i64 = 10_000;
const MIGRATION_1: &str = include_str!("migrations/0001_management.sql");
const MIGRATION_2: &str = include_str!("migrations/0002_home_paths.sql");
const MIGRATION_3: &str = include_str!("migrations/0003_setup_operations.sql");
const MIGRATION_4: &str = include_str!("migrations/0004_setup_cancellation.sql");
const MIGRATION_5: &str = include_str!("migrations/0005_setup_operation_state.sql");
const MIGRATION_6: &str = include_str!("migrations/0006_session_reconciliation.sql");
const MIGRATION_7: &str = include_str!("migrations/0007_session_model.sql");
const MIGRATION_8: &str = include_str!("migrations/0008_setup_repository_selection.sql");
const MIGRATION_9: &str = include_str!("migrations/0009_workspace_starting_prompt.sql");
const MIGRATION_10: &str = include_str!("migrations/0010_remove_starting_prompt_storage.sql");
const MIGRATION_11: &str = include_str!("migrations/0011_quick_request_prompts.sql");
const MIGRATION_12: &str = include_str!("migrations/0012_quick_request_repository_directories.sql");
const MIGRATION_13: &str = include_str!("migrations/0013_quick_requests_project_directory.sql");

fn validate_quick_request_prompt(prompt: &str) -> StoreResult<()> {
    if prompt.trim().is_empty() {
        return Err(ManagementStoreError::InvalidTransition(
            "Quick Request prompt must not be empty".into(),
        ));
    }
    Ok(())
}

fn now_millis_for_cleanup() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[derive(Debug)]
pub enum ManagementStoreError {
    Sqlite(rusqlite::Error),
    Io(std::io::Error),
    InvalidTransition(String),
    NotFound(String),
    UnsupportedSchemaVersion(i64),
    HomeDirectoryUnavailable,
    LockPoisoned,
    Safety(SafetyError),
}

impl std::fmt::Display for ManagementStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Sqlite(error) => write!(formatter, "management database error: {error}"),
            Self::Io(error) => write!(formatter, "management database I/O error: {error}"),
            Self::InvalidTransition(message) => {
                write!(formatter, "invalid lifecycle transition: {message}")
            }
            Self::NotFound(message) => write!(formatter, "management record not found: {message}"),
            Self::UnsupportedSchemaVersion(version) => {
                write!(
                    formatter,
                    "database schema version {version} is newer than this app supports"
                )
            }
            Self::HomeDirectoryUnavailable => {
                formatter.write_str("the user's home directory is unavailable")
            }
            Self::LockPoisoned => formatter.write_str("management database lock is poisoned"),
            Self::Safety(error) => write!(formatter, "{error}"),
        }
    }
}

impl std::error::Error for ManagementStoreError {}

impl From<rusqlite::Error> for ManagementStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Sqlite(error)
    }
}

impl From<std::io::Error> for ManagementStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<SafetyError> for ManagementStoreError {
    fn from(error: SafetyError) -> Self {
        Self::Safety(error)
    }
}

type StoreResult<T> = Result<T, ManagementStoreError>;

macro_rules! sqlite_enum {
    ($enum_name:ident { $($variant:ident => $value:literal),+ $(,)? }) => {
        impl $enum_name {
            pub fn as_str(&self) -> &'static str {
                match self {
                    $(Self::$variant => $value,)+
                }
            }
        }

        impl FromSql for $enum_name {
            fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
                match value.as_str()? {
                    $($value => Ok(Self::$variant),)+
                    _ => Err(FromSqlError::InvalidType),
                }
            }
        }
    };
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceStatus {
    Active,
    Completed,
}
sqlite_enum!(WorkspaceStatus { Active => "active", Completed => "completed" });

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceKind {
    Regular,
    QuickRequests,
}
sqlite_enum!(WorkspaceKind {
    Regular => "regular",
    QuickRequests => "quick_requests"
});

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Active,
    Completed,
}
sqlite_enum!(TaskStatus { Active => "active", Completed => "completed" });

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskSetupStatus {
    NotStarted,
    InProgress,
    Incomplete,
    Ready,
    Canceled,
}
sqlite_enum!(TaskSetupStatus {
    NotStarted => "not_started",
    InProgress => "in_progress",
    Incomplete => "incomplete",
    Ready => "ready",
    Canceled => "canceled"
});

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RepositorySetupStatus {
    Ready,
    Failed,
    NotAttempted,
}
sqlite_enum!(RepositorySetupStatus {
    Ready => "ready",
    Failed => "failed",
    NotAttempted => "not_attempted"
});

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckoutMode {
    Existing,
    Managed,
}
sqlite_enum!(CheckoutMode { Existing => "existing", Managed => "managed" });

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerificationStatus {
    Pending,
    Verified,
    Failed,
}
sqlite_enum!(VerificationStatus {
    Pending => "pending",
    Verified => "verified",
    Failed => "failed"
});

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PurposeStatus {
    Available,
    Unavailable,
}
sqlite_enum!(PurposeStatus { Available => "available", Unavailable => "unavailable" });

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupJobState {
    Queued,
    Running,
    Deferred,
    Retained,
    Removed,
    Failed,
}
sqlite_enum!(CleanupJobState {
    Queued => "queued",
    Running => "running",
    Deferred => "deferred",
    Retained => "retained",
    Removed => "removed",
    Failed => "failed"
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub home_path: String,
    pub kind: WorkspaceKind,
    pub status: WorkspaceStatus,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewWorkspace {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub kind: WorkspaceKind,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRequestLifecycle {
    pub created_at: i64,
    pub dismissed_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub expired_at: Option<i64>,
    pub promoted_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub home_path: String,
    pub status: TaskStatus,
    pub setup_status: TaskSetupStatus,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub quick_request: Option<QuickRequestLifecycle>,
    pub setup_operation_id: Option<String>,
    pub setup_session_id: Option<String>,
    pub setup_cancelled_at: Option<i64>,
    pub setup_cancellation_detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub setup_status: TaskSetupStatus,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub repository_path: String,
    pub repository_identity: String,
    pub purpose: Option<String>,
    pub purpose_status: PurposeStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewRepository {
    pub id: String,
    pub name: String,
    pub repository_path: String,
    pub repository_identity: String,
    pub purpose: Option<String>,
    pub purpose_status: PurposeStatus,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDiscovery {
    pub path: String,
    pub repository_identity: String,
    pub name: String,
    pub purpose: Option<String>,
    pub purpose_status: PurposeStatus,
    pub repository: Repository,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepositoryBinding {
    pub workspace_id: String,
    pub repository_id: String,
    pub checkout_path: String,
    pub checkout_mode: CheckoutMode,
    pub branch: String,
    pub verification_status: VerificationStatus,
    pub created_at: i64,
}

/// Stable paths available to a workspace planning session. Failed or
/// unverified attachment attempts are never session context.
pub fn resolve_workspace_context(
    workspace_home: &Path,
    bindings: &[WorkspaceRepositoryBinding],
) -> Vec<PathBuf> {
    let mut paths = vec![workspace_home.to_path_buf()];
    for binding in bindings {
        if binding.verification_status == VerificationStatus::Verified {
            let path = PathBuf::from(&binding.checkout_path);
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

/// The terminal has one OpenCode directory, but a task conversation must be
/// aware of every verified worktree belonging to that task. Keep this resolver
/// in management rather than reconstructing paths in a UI command.
pub fn resolve_task_context(task_home: &Path, bindings: &[TaskRepositoryBinding]) -> Vec<PathBuf> {
    let mut paths = vec![task_home.to_path_buf()];
    for binding in bindings {
        if binding.setup_status == RepositorySetupStatus::Ready {
            let path = PathBuf::from(&binding.worktree_path);
            if !paths.contains(&path) {
                paths.push(path);
            }
        }
    }
    paths
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRepositoryBinding {
    pub task_id: String,
    pub repository_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub setup_status: RepositorySetupStatus,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationItemResult {
    Ready,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationItem {
    pub item_id: String,
    pub repository_id: String,
    pub repository_path: String,
    pub git_identity: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub result: RegistrationItemResult,
    pub error_code: Option<String>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationReport {
    pub operation_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub items: Vec<RegistrationItem>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationResult {
    pub operation_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub replayed: bool,
    pub items: Vec<RegistrationItem>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "owner_type", content = "owner_id")]
pub enum SessionOwner {
    Workspace(String),
    Task(String),
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRequestRecord {
    pub task: Task,
    pub session: Option<SessionRecord>,
    pub prompt: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub open_code_session_id: String,
    pub owner: SessionOwner,
    pub directory: String,
    pub last_known_status: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub event_cursor: Option<String>,
    pub reconciliation_status: String,
    pub reconciliation_uncertain: bool,
    pub pending_input_json: Option<String>,
    pub selected_model: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewSession {
    pub open_code_session_id: String,
    pub owner: SessionOwner,
    pub directory: String,
    pub last_known_status: String,
    pub created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupJob {
    pub id: String,
    pub task_id: String,
    pub repository_id: String,
    pub worktree_path: String,
    pub state: CleanupJobState,
    pub attempts: i64,
    pub last_attempt_at: Option<i64>,
    pub next_attempt_at: Option<i64>,
    pub deferral_reason: Option<String>,
    pub failure_detail: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCleanupJob {
    pub id: String,
    pub task_id: String,
    pub repository_id: String,
    pub worktree_path: String,
    pub state: CleanupJobState,
    pub created_at: i64,
}

/// A non-destructive cleanup decision. `Removable` means eligible for a later
/// worker; this planner itself never removes worktrees, branches, or files.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case", tag = "classification")]
pub enum CleanupPlan {
    Removable {
        canonical_path: String,
        branch_retained: String,
    },
    Retained {
        canonical_path: Option<String>,
        reason: String,
    },
    Deferred {
        canonical_path: String,
        reason: String,
    },
    Failed {
        reason: String,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setting {
    pub key: String,
    pub value: String,
    pub updated_at: i64,
}

/// Owns one SQLite connection. Access is serialized and every connection enables foreign keys.
pub struct ManagementStore {
    connection: Mutex<Connection>,
    database_path: Option<PathBuf>,
    user_home: PathBuf,
}

impl ManagementStore {
    /// Opens the app-owned database file, applying pending migrations before returning.
    pub fn open(path: impl AsRef<Path>) -> StoreResult<Self> {
        let user_home = std::env::var_os("HOME")
            .map(PathBuf::from)
            .ok_or(ManagementStoreError::HomeDirectoryUnavailable)?;
        Self::open_with_paths(path, user_home, std::env::temp_dir())
    }

    /// Opens the database with explicit home/temp roots, making path resolution deterministic.
    pub fn open_with_paths(
        path: impl AsRef<Path>,
        user_home: impl Into<PathBuf>,
        system_temp_dir: impl Into<PathBuf>,
    ) -> StoreResult<Self> {
        let path = path.as_ref();
        if let Some(parent) = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        Self::from_connection(
            connection,
            Some(path.to_path_buf()),
            user_home.into(),
            system_temp_dir.into(),
        )
    }

    /// Opens an isolated in-memory database for tests and non-persistent callers.
    pub fn in_memory() -> StoreResult<Self> {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(1);
        let fixture_root = std::env::temp_dir().join(format!(
            "opencode-project-manager-test-fixture-{}-{}",
            std::process::id(),
            NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed)
        ));
        Self::in_memory_with_paths(&fixture_root.join("home"), &fixture_root.join("tmp"))
    }

    /// Opens an isolated in-memory database with fixture-controlled path roots.
    pub fn in_memory_with_paths(
        user_home: impl Into<PathBuf>,
        system_temp_dir: impl Into<PathBuf>,
    ) -> StoreResult<Self> {
        let user_home = user_home.into();
        fs::create_dir_all(&user_home)?;
        Self::from_connection(
            Connection::open_in_memory()?,
            None,
            user_home,
            system_temp_dir.into(),
        )
    }

    fn from_connection(
        mut connection: Connection,
        database_path: Option<PathBuf>,
        user_home: PathBuf,
        _system_temp_dir: PathBuf,
    ) -> StoreResult<Self> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        if database_path.is_some() {
            connection.pragma_update(None, "journal_mode", "WAL")?;
            connection.pragma_update(None, "synchronous", "NORMAL")?;
            connection.pragma_update(None, "secure_delete", "ON")?;
        }
        Self::migrate(&mut connection)?;
        if database_path.is_some() {
            connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
        }
        Self::ensure_default_settings(&connection)?;
        Self::sync_quick_requests_home(&connection, &user_home)?;
        Ok(Self {
            connection: Mutex::new(connection),
            database_path,
            user_home,
        })
    }

    pub fn database_path(&self) -> Option<&Path> {
        self.database_path.as_deref()
    }

    fn migrate(connection: &mut Connection) -> StoreResult<()> {
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY NOT NULL,
                applied_at INTEGER NOT NULL
            );",
        )?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current_version: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )?;
        if current_version > 13 {
            return Err(ManagementStoreError::UnsupportedSchemaVersion(
                current_version,
            ));
        }
        if current_version == 0 {
            transaction.execute_batch(MIGRATION_1)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (1, 0)",
                [],
            )?;
        }
        if current_version < 2 {
            transaction.execute_batch(MIGRATION_2)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (2, 0)",
                [],
            )?;
        }
        if current_version < 3 {
            transaction.execute_batch(MIGRATION_3)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (3, 0)",
                [],
            )?;
        }
        if current_version < 4 {
            transaction.execute_batch(MIGRATION_4)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (4, 0)",
                [],
            )?;
        }
        if current_version < 5 {
            transaction.execute_batch(MIGRATION_5)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (5, 0)",
                [],
            )?;
        }
        if current_version < 6 {
            transaction.execute_batch(MIGRATION_6)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (6, 0)",
                [],
            )?;
        }
        if current_version < 7 {
            transaction.execute_batch(MIGRATION_7)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (7, 0)",
                [],
            )?;
        }
        if current_version < 8 {
            transaction.execute_batch(MIGRATION_8)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (8, 0)",
                [],
            )?;
        }
        if current_version < 9 {
            transaction.execute_batch(MIGRATION_9)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (9, 0)",
                [],
            )?;
        }
        if current_version < 10 {
            transaction.execute_batch(MIGRATION_10)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (10, 0)",
                [],
            )?;
        }
        if current_version < 11 {
            transaction.execute_batch(MIGRATION_11)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (11, 0)",
                [],
            )?;
        }
        if current_version < 12 {
            transaction.execute_batch(MIGRATION_12)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (12, 0)",
                [],
            )?;
        }
        if current_version < 13 {
            transaction.execute_batch(MIGRATION_13)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (13, 0)",
                [],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn ensure_default_settings(connection: &Connection) -> StoreResult<()> {
        connection.execute(
            "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?1, ?2, 0)",
            params!["project_home_root", DEFAULT_PROJECT_HOME_ROOT],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?1, ?2, 0)",
            params!["default_model", DEFAULT_MODEL],
        )?;
        Ok(())
    }

    fn quick_requests_directory_from(
        connection: &Connection,
        user_home: &Path,
    ) -> StoreResult<PathBuf> {
        let configured_root = Self::project_home_root_from(connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, user_home)?;
        safety::canonical_descendant(&project_root, &quick_requests_directory(&project_root))
            .map_err(Into::into)
    }

    fn sync_quick_requests_home(connection: &Connection, user_home: &Path) -> StoreResult<()> {
        let Some(path) = connection
            .query_row(
                "SELECT id FROM workspaces WHERE kind = 'quick_requests' LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        else {
            return Ok(());
        };
        let home = path_to_string(&Self::quick_requests_directory_from(connection, user_home)?)?;
        let transaction = connection.unchecked_transaction()?;
        transaction.execute(
            "UPDATE workspaces SET home_path = ?1 WHERE id = ?2",
            params![home, path],
        )?;
        transaction.execute(
            "UPDATE tasks SET home_path = (SELECT home_path FROM workspaces WHERE id = ?1) WHERE workspace_id = ?1 AND quick_request_created_at IS NOT NULL AND quick_request_promoted_at IS NULL",
            [&path],
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn lock(&self) -> StoreResult<MutexGuard<'_, Connection>> {
        self.connection
            .lock()
            .map_err(|_| ManagementStoreError::LockPoisoned)
    }

    pub fn migration_versions(&self) -> StoreResult<Vec<i64>> {
        let connection = self.lock()?;
        let mut statement =
            connection.prepare("SELECT version FROM schema_migrations ORDER BY version")?;
        let versions = statement
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(versions)
    }

    pub fn create_workspace(&self, workspace: &NewWorkspace) -> StoreResult<Workspace> {
        safety::validate_name(&workspace.name)?;
        safety::validate_slug(&workspace.slug)?;
        let mut connection = self.lock()?;
        if let Some(existing) = Self::get_workspace_from(&connection, &workspace.id)? {
            if existing.name == workspace.name
                && existing.slug == workspace.slug
                && existing.description == workspace.description
                && existing.kind == workspace.kind
                && existing.created_at == workspace.created_at
            {
                return Ok(existing);
            }
            return Err(ManagementStoreError::InvalidTransition(format!(
                "workspace ID {} already belongs to a different record",
                workspace.id
            )));
        }
        let existing_slug: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE slug = ?1)",
            [&workspace.slug],
            |row| row.get(0),
        )?;
        if existing_slug {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "workspace slug {} is already in use",
                workspace.slug
            )));
        }

        let (home_path, home_guard) = match workspace.kind {
            WorkspaceKind::Regular => {
                let configured_root = Self::project_home_root_from(&connection)?;
                let project_root =
                    safety::resolve_project_home_root(&configured_root, &self.user_home)?;
                let (home, guard) = safety::ensure_regular_workspace_home(
                    &self.user_home,
                    &project_root,
                    &workspace.slug,
                    &workspace.id,
                )?;
                (home, Some(guard))
            }
            WorkspaceKind::QuickRequests => {
                let shared = Self::quick_requests_directory_from(&connection, &self.user_home)?;
                (safety::canonicalize_or_resolve_missing(&shared)?, None)
            }
        };
        let home_path = path_to_string(&home_path)?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT INTO workspaces(id, name, slug, description, home_path, kind, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                workspace.id,
                workspace.name,
                workspace.slug,
                workspace.description,
                home_path,
                workspace.kind.as_str(),
                workspace.created_at
            ],
        )?;
        transaction.commit()?;
        if let Some(guard) = home_guard {
            guard.commit();
        }
        Self::get_workspace_from(&connection, &workspace.id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("workspace {} after insert", workspace.id))
        })
    }

    /// Compensate for a workspace created solely by a failed promotion.  The
    /// caller supplies no path: the record and configured project root remain
    /// the authority, and the filesystem helper refuses to remove any content.
    pub fn rollback_new_workspace(&self, id: &str) -> StoreResult<()> {
        let mut connection = self.lock()?;
        let workspace = Self::get_workspace_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?;
        if workspace.kind != WorkspaceKind::Regular {
            return Err(ManagementStoreError::InvalidTransition(
                "only regular promotion workspaces can be rolled back".into(),
            ));
        }
        let task_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let binding_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM workspace_repositories WHERE workspace_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if task_count != 0 || binding_count != 0 {
            return Err(ManagementStoreError::InvalidTransition(
                "promotion workspace is no longer empty".into(),
            ));
        }
        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let home = PathBuf::from(&workspace.home_path);
        safety::remove_empty_managed_home(
            &project_root,
            &home,
            "workspace",
            &workspace.id,
            &["notes", "repos", "tasks"],
        )?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute("DELETE FROM workspaces WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    /// Removes the session association created by a failed workspace
    /// initialization attempt. This is intentionally narrow: it is only valid
    /// while the workspace has no tasks or repository bindings.
    pub fn rollback_workspace_session(
        &self,
        workspace_id: &str,
        session_id: &str,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        let owner: Option<String> = connection
            .query_row(
                "SELECT owner_workspace_id FROM sessions WHERE open_code_session_id = ?1",
                [session_id],
                |row| row.get(0),
            )
            .optional()?;
        if owner.as_deref() != Some(workspace_id) {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace initialization session does not belong to the workspace".into(),
            ));
        }
        connection.execute(
            "DELETE FROM sessions WHERE open_code_session_id = ?1",
            [session_id],
        )?;
        Ok(())
    }

    pub fn get_workspace(&self, id: &str) -> StoreResult<Option<Workspace>> {
        let connection = self.lock()?;
        Self::get_workspace_from(&connection, id)
    }

    fn get_workspace_from(connection: &Connection, id: &str) -> StoreResult<Option<Workspace>> {
        connection
            .query_row(
                "SELECT id, name, slug, description, home_path, kind, status, created_at, completed_at
                 FROM workspaces WHERE id = ?1",
                [id],
                |row| {
                    Ok(Workspace {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        slug: row.get(2)?,
                        description: row.get(3)?,
                        home_path: row.get(4)?,
                        kind: row.get(5)?,
                        status: row.get(6)?,
                        created_at: row.get(7)?,
                        completed_at: row.get(8)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_workspaces(&self) -> StoreResult<Vec<Workspace>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, name, slug, description, home_path, kind, status, created_at, completed_at
             FROM workspaces ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(Workspace {
                id: row.get(0)?,
                name: row.get(1)?,
                slug: row.get(2)?,
                description: row.get(3)?,
                home_path: row.get(4)?,
                kind: row.get(5)?,
                status: row.get(6)?,
                created_at: row.get(7)?,
                completed_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn update_workspace_details(
        &self,
        id: &str,
        name: &str,
        slug: &str,
        description: Option<&str>,
        home_path: &str,
    ) -> StoreResult<Workspace> {
        let connection = self.lock()?;
        safety::validate_name(name)?;
        safety::validate_slug(slug)?;
        let existing = Self::get_workspace_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?;
        if existing.slug != slug {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace filesystem slugs are stable and cannot be changed".into(),
            ));
        }
        let expected = match existing.kind {
            WorkspaceKind::Regular => {
                let configured_root = Self::project_home_root_from(&connection)?;
                safety::resolve_project_home_root(&configured_root, &self.user_home)?
                    .join(&existing.slug)
            }
            WorkspaceKind::QuickRequests => {
                Self::quick_requests_directory_from(&connection, &self.user_home)?
            }
        };
        let expected_lexical = expected.clone();
        let expected = safety::canonicalize_or_resolve_missing(&expected)?;
        if expected != expected_lexical {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "workspace home resolves through a symlink instead of its owner path".into(),
            )));
        }
        let supplied = safety::canonicalize_or_resolve_missing(Path::new(home_path))?;
        if expected != supplied || existing.home_path != path_to_string(&expected)? {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "workspace home path does not match its persisted owner and slug".into(),
            )));
        }
        connection.execute(
            "UPDATE workspaces SET name = ?2, description = ?3 WHERE id = ?1",
            params![id, name, description],
        )?;
        Self::get_workspace_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))
    }

    pub fn complete_workspace(&self, id: &str, completed_at: i64) -> StoreResult<Workspace> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = Self::get_workspace_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?;
        if workspace.status != WorkspaceStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "workspace {id} is already completed"
            )));
        }
        if workspace.kind == WorkspaceKind::QuickRequests {
            return Err(ManagementStoreError::InvalidTransition(
                "the Quick Requests workspace cannot be completed".into(),
            ));
        }
        let active_task_ids = transaction
            .prepare(
                "SELECT id FROM tasks WHERE workspace_id = ?1 AND status = 'active' ORDER BY id",
            )?
            .query_map([id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        if !active_task_ids.is_empty() {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "workspace {id} still has active task(s): {}",
                active_task_ids.join(", ")
            )));
        }
        transaction.execute(
            "UPDATE workspaces SET status = 'completed', completed_at = ?2 WHERE id = ?1",
            params![id, completed_at],
        )?;
        transaction.commit()?;
        Self::get_workspace_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))
    }

    pub fn reactivate_workspace(&self, id: &str) -> StoreResult<Workspace> {
        let connection = self.lock()?;
        let workspace = Self::get_workspace_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?;
        if workspace.status != WorkspaceStatus::Completed {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "workspace {id} is not completed"
            )));
        }
        connection.execute(
            "UPDATE workspaces SET status = 'active', completed_at = NULL WHERE id = ?1",
            [id],
        )?;
        Self::get_workspace_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))
    }

    pub fn create_task(&self, task: &NewTask) -> StoreResult<Task> {
        safety::validate_name(&task.name)?;
        safety::validate_slug(&task.slug)?;
        let mut connection = self.lock()?;
        if let Some(existing) = Self::get_task_from(&connection, &task.id)? {
            if existing.workspace_id == task.workspace_id
                && existing.name == task.name
                && existing.slug == task.slug
                && existing.description == task.description
                && existing.created_at == task.created_at
            {
                return Ok(existing);
            }
            return Err(ManagementStoreError::InvalidTransition(format!(
                "task ID {} already belongs to a different record",
                task.id
            )));
        }
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let guard = self.insert_task(&transaction, task, None)?;
        transaction.commit()?;
        if let Some(guard) = guard {
            guard.commit();
        }
        Self::get_task_from(&connection, &task.id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {} after insert", task.id)))
    }

    /// Remove a task that was created by an initialization attempt before any
    /// user-owned setup has been recorded. This is deliberately stricter than
    /// normal task deletion: sessions, repository reports, and cleanup jobs
    /// make the task durable work and therefore refuse this rollback.
    pub fn rollback_new_task(&self, id: &str) -> StoreResult<()> {
        let mut connection = self.lock()?;
        let task = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        if task.status != TaskStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(
                "only an active initialization task can be rolled back".into(),
            ));
        }
        let session_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sessions WHERE owner_task_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let binding_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM task_repositories WHERE task_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let cleanup_count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM cleanup_jobs WHERE task_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if binding_count != 0 || cleanup_count != 0 {
            return Err(ManagementStoreError::InvalidTransition(
                "task initialization has durable repository state".into(),
            ));
        }

        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let home = PathBuf::from(&task.home_path);
        safety::remove_empty_managed_home(
            &project_root,
            &home,
            "task",
            &task.id,
            &["notes", "worktrees"],
        )?;

        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute("DELETE FROM setup_operation_state WHERE task_id = ?1", [id])?;
        if session_count != 0 {
            transaction.execute("DELETE FROM sessions WHERE owner_task_id = ?1", [id])?;
        }
        transaction.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    /// Creates the task and its first exact OpenCode association in one transaction.
    pub fn create_task_with_session(
        &self,
        task: &NewTask,
        session: &NewSession,
    ) -> StoreResult<Task> {
        if session.owner != SessionOwner::Task(task.id.clone()) {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "initial session owner must be task {}",
                task.id
            )));
        }
        safety::validate_name(&task.name)?;
        safety::validate_slug(&task.slug)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let guard = self.insert_task(&transaction, task, None)?;
        Self::insert_session(&transaction, session)?;
        transaction.commit()?;
        if let Some(guard) = guard {
            guard.commit();
        }
        Self::get_task_from(&connection, &task.id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {} after insert", task.id)))
    }

    pub fn create_quick_request(&self, task: &NewTask, original_prompt: &str) -> StoreResult<Task> {
        validate_quick_request_prompt(original_prompt)?;
        let expires_at = task
            .created_at
            .checked_add(QUICK_REQUEST_LIFETIME_MS)
            .ok_or_else(|| {
                ManagementStoreError::InvalidTransition("Quick Request expiry overflow".into())
            })?;
        let lifecycle = QuickRequestLifecycle {
            created_at: task.created_at,
            dismissed_at: None,
            expires_at: Some(expires_at),
            expired_at: None,
            promoted_at: None,
        };
        safety::validate_name(&task.name)?;
        safety::validate_slug(&task.slug)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut quick_request_task = task.clone();
        quick_request_task.description = None;
        let guard = self.insert_task(&transaction, &quick_request_task, Some(&lifecycle))?;
        Self::insert_quick_request_prompt(&transaction, &task.id, original_prompt)?;
        transaction.commit()?;
        if let Some(guard) = guard {
            guard.commit();
        }
        Self::get_task_from(&connection, &task.id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("Quick Request task {} after insert", task.id))
        })
    }

    /// Creates the special workspace on demand under the configured projects root.
    pub fn ensure_quick_requests_workspace(&self, created_at: i64) -> StoreResult<Workspace> {
        if let Some(existing) = self
            .list_workspaces()?
            .into_iter()
            .find(|workspace| workspace.kind == WorkspaceKind::QuickRequests)
        {
            return Ok(existing);
        }
        self.create_workspace(&NewWorkspace {
            id: "quick-requests-workspace".into(),
            name: "Quick Requests".into(),
            slug: "quick-requests".into(),
            description: Some(
                "One-off requests in the shared Quick Requests project folder".into(),
            ),
            kind: WorkspaceKind::QuickRequests,
            created_at,
        })
    }

    pub fn quick_request_directory(&self, repository_id: Option<&str>) -> StoreResult<PathBuf> {
        let Some(repository_id) = repository_id else {
            let connection = self.lock()?;
            return Self::quick_requests_directory_from(&connection, &self.user_home);
        };
        let repository = self
            .list_repositories()?
            .into_iter()
            .find(|repository| repository.id == repository_id)
            .ok_or_else(|| {
                ManagementStoreError::NotFound(format!("registered repository {repository_id}"))
            })?;
        let path = PathBuf::from(repository.repository_path);
        let canonical = std::fs::canonicalize(&path)?;
        if !canonical.is_dir() {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "registered repository is not a directory".into(),
            )));
        }
        Ok(canonical)
    }

    /// The task and exact OpenCode session association are one durable write.
    pub fn create_quick_request_with_session(
        &self,
        task: &NewTask,
        session: &NewSession,
        original_prompt: &str,
    ) -> StoreResult<QuickRequestRecord> {
        self.create_quick_request_with_session_and_model(task, session, "", original_prompt)
    }

    pub fn create_quick_request_with_session_and_model(
        &self,
        task: &NewTask,
        session: &NewSession,
        selected_model: &str,
        original_prompt: &str,
    ) -> StoreResult<QuickRequestRecord> {
        validate_quick_request_prompt(original_prompt)?;
        if session.owner != SessionOwner::Task(task.id.clone()) {
            return Err(ManagementStoreError::InvalidTransition(
                "Quick Request session owner must be its task".into(),
            ));
        }
        let workspace = self.get_workspace(&task.workspace_id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("workspace {}", task.workspace_id))
        })?;
        if workspace.kind != WorkspaceKind::QuickRequests {
            return Err(ManagementStoreError::InvalidTransition(
                "task is not owned by the Quick Requests workspace".into(),
            ));
        }
        let actual = safety::canonicalize_or_resolve_missing(Path::new(&session.directory))?;
        let connection = self.lock()?;
        let default_directory = safety::canonicalize_or_resolve_missing(
            &Self::quick_requests_directory_from(&connection, &self.user_home)?,
        )?;
        drop(connection);
        let is_registered_repository = self.list_repositories()?.iter().any(|repository| {
            std::fs::canonicalize(&repository.repository_path)
                .is_ok_and(|repository_path| repository_path == actual && actual.is_dir())
        });
        if actual != default_directory && !is_registered_repository {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "Quick Request sessions must use the shared directory or a registered repository"
                    .into(),
            )));
        }
        let expires_at = task
            .created_at
            .checked_add(QUICK_REQUEST_LIFETIME_MS)
            .ok_or_else(|| {
                ManagementStoreError::InvalidTransition("Quick Request expiry overflow".into())
            })?;
        let lifecycle = QuickRequestLifecycle {
            created_at: task.created_at,
            dismissed_at: None,
            expires_at: Some(expires_at),
            expired_at: None,
            promoted_at: None,
        };
        safety::validate_name(&task.name)?;
        safety::validate_slug(&task.slug)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut quick_request_task = task.clone();
        quick_request_task.description = None;
        let guard = self.insert_task(&transaction, &quick_request_task, Some(&lifecycle))?;
        Self::insert_quick_request_prompt(&transaction, &task.id, original_prompt)?;
        Self::insert_session_with_model(&transaction, session, Some(selected_model))?;
        transaction.commit()?;
        if let Some(guard) = guard {
            guard.commit();
        }
        let task = Self::get_task_from(&connection, &task.id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("Quick Request task {}", task.id))
        })?;
        let session = Self::get_session_from(&connection, &session.open_code_session_id)?;
        Ok(QuickRequestRecord {
            task,
            session,
            prompt: Some(original_prompt.to_owned()),
        })
    }

    pub fn list_quick_requests(&self, history: bool) -> StoreResult<Vec<QuickRequestRecord>> {
        let recent_cutoff = now_millis_for_cleanup().saturating_sub(QUICK_REQUEST_LIFETIME_MS);
        let workspace = self
            .list_workspaces()?
            .into_iter()
            .find(|workspace| workspace.kind == WorkspaceKind::QuickRequests);
        let Some(workspace) = workspace else {
            return Ok(Vec::new());
        };
        let tasks = self.list_tasks(&workspace.id)?;
        let mut result = Vec::new();
        for task in tasks
            .into_iter()
            .filter(|task| task.quick_request.is_some())
        {
            let session = self
                .list_sessions(&SessionOwner::Task(task.id.clone()))?
                .into_iter()
                .next();
            let visible = task.quick_request.as_ref().is_some_and(|request| {
                history
                    || (request.created_at >= recent_cutoff
                        && request.promoted_at.is_none()
                        && request.dismissed_at.is_none())
            });
            if visible {
                let prompt = self.quick_request_prompt(&task.id)?;
                result.push(QuickRequestRecord {
                    task,
                    session,
                    prompt,
                });
            }
        }
        Ok(result)
    }

    pub fn quick_request_prompt(&self, task_id: &str) -> StoreResult<Option<String>> {
        let connection = self.lock()?;
        Self::quick_request_prompt_from(&connection, task_id)
    }

    fn quick_request_prompt_from(
        connection: &Connection,
        task_id: &str,
    ) -> StoreResult<Option<String>> {
        connection
            .query_row(
                "SELECT prompt.original_prompt
                 FROM quick_request_prompts AS prompt
                 JOIN tasks ON tasks.id = prompt.task_id
                 WHERE prompt.task_id = ?1 AND tasks.quick_request_created_at IS NOT NULL",
                [task_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(Into::into)
    }

    fn insert_quick_request_prompt(
        connection: &Connection,
        task_id: &str,
        original_prompt: &str,
    ) -> StoreResult<()> {
        validate_quick_request_prompt(original_prompt)?;
        connection.execute(
            "INSERT INTO quick_request_prompts(task_id, original_prompt) VALUES (?1, ?2)",
            params![task_id, original_prompt],
        )?;
        Ok(())
    }

    fn insert_task(
        &self,
        connection: &Connection,
        task: &NewTask,
        quick_request: Option<&QuickRequestLifecycle>,
    ) -> StoreResult<Option<ManagedHomeGuard>> {
        let slug_taken: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM tasks WHERE workspace_id = ?1 AND slug = ?2)",
            params![task.workspace_id, task.slug],
            |row| row.get(0),
        )?;
        if slug_taken {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "task slug {} is already in use in workspace {}",
                task.slug, task.workspace_id
            )));
        }
        let (home_path, home_guard) =
            self.prepare_task_home(connection, task, quick_request.is_some())?;
        connection.execute(
            "INSERT INTO tasks(
                id, workspace_id, name, slug, description, home_path, setup_status, created_at,
                quick_request_created_at, quick_request_dismissed_at, quick_request_expires_at,
                quick_request_expired_at, quick_request_promoted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                task.id,
                task.workspace_id,
                task.name,
                task.slug,
                task.description,
                path_to_string(&home_path)?,
                task.setup_status.as_str(),
                task.created_at,
                quick_request.map(|request| request.created_at),
                quick_request.and_then(|request| request.dismissed_at),
                quick_request.and_then(|request| request.expires_at),
                quick_request.and_then(|request| request.expired_at),
                quick_request.and_then(|request| request.promoted_at),
            ],
        )?;
        Ok(home_guard)
    }

    pub fn get_task(&self, id: &str) -> StoreResult<Option<Task>> {
        let connection = self.lock()?;
        Self::get_task_from(&connection, id)
    }

    fn get_task_from(connection: &Connection, id: &str) -> StoreResult<Option<Task>> {
        connection
            .query_row(
                "SELECT id, workspace_id, name, slug, description, home_path, status, setup_status,
                        created_at, completed_at, quick_request_created_at, quick_request_dismissed_at,
                        quick_request_expires_at, quick_request_expired_at, quick_request_promoted_at,
                        setup_operation_id, setup_session_id, setup_cancelled_at, setup_cancellation_detail
                 FROM tasks WHERE id = ?1",
                [id],
                task_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_tasks(&self, workspace_id: &str) -> StoreResult<Vec<Task>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, workspace_id, name, slug, description, home_path, status, setup_status,
                    created_at, completed_at, quick_request_created_at, quick_request_dismissed_at,
                    quick_request_expires_at, quick_request_expired_at, quick_request_promoted_at,
                    setup_operation_id, setup_session_id, setup_cancelled_at, setup_cancellation_detail
             FROM tasks WHERE workspace_id = ?1 ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([workspace_id], task_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn update_task_details(
        &self,
        id: &str,
        name: &str,
        slug: &str,
        description: Option<&str>,
        home_path: &str,
    ) -> StoreResult<Task> {
        let connection = self.lock()?;
        safety::validate_name(name)?;
        safety::validate_slug(slug)?;
        let existing = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        if existing.slug != slug {
            return Err(ManagementStoreError::InvalidTransition(
                "task filesystem slugs are stable and cannot be changed".into(),
            ));
        }
        let expected = self.task_home_path_from(
            &connection,
            &NewTask {
                id: existing.id.clone(),
                workspace_id: existing.workspace_id.clone(),
                name: name.to_owned(),
                slug: existing.slug.clone(),
                description: description.map(str::to_owned),
                setup_status: existing.setup_status,
                created_at: existing.created_at,
            },
            existing
                .quick_request
                .as_ref()
                .is_some_and(|request| request.promoted_at.is_none()),
        )?;
        let expected_lexical = expected.clone();
        let expected = safety::canonicalize_or_resolve_missing(&expected)?;
        if expected != expected_lexical {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "task home resolves through a symlink instead of its owner path".into(),
            )));
        }
        let supplied = safety::canonicalize_or_resolve_missing(Path::new(home_path))?;
        if expected != supplied || existing.home_path != path_to_string(&expected)? {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "task home path does not match its persisted owner and slug".into(),
            )));
        }
        connection.execute(
            "UPDATE tasks SET name = ?2, description = ?3 WHERE id = ?1",
            params![id, name, description],
        )?;
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    pub fn update_task_setup_status(&self, id: &str, status: TaskSetupStatus) -> StoreResult<Task> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE tasks SET setup_status = ?2 WHERE id = ?1",
            params![id, status.as_str()],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::NotFound(format!("task {id}")));
        }
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    /// Binds the durable setup operation to the exact OpenCode conversation.
    /// This identity is immutable for the lifetime of the task setup.
    pub fn bind_task_setup_operation(
        &self,
        task_id: &str,
        operation_id: &str,
        session_id: &str,
    ) -> StoreResult<Task> {
        if operation_id.trim().is_empty() || session_id.trim().is_empty() {
            return Err(ManagementStoreError::InvalidTransition(
                "setup operation and session IDs are required".into(),
            ));
        }
        let connection = self.lock()?;
        let task = Self::get_task_from(&connection, task_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {task_id}")))?;
        if let Some(existing) = task.setup_operation_id.as_deref() {
            if existing != operation_id || task.setup_session_id.as_deref() != Some(session_id) {
                return Err(ManagementStoreError::InvalidTransition(
                    "task setup operation identity cannot be changed".into(),
                ));
            }
            connection.execute(
                "INSERT OR IGNORE INTO setup_operation_state(
                     operation_id, workspace_id, task_id, session_id, status, canceled_at
                 ) VALUES (?1, ?2, ?3, ?4, 'active', NULL)",
                params![operation_id, task.workspace_id, task_id, session_id],
            )?;
            return Ok(task);
        }
        connection.execute(
            "UPDATE tasks SET setup_operation_id = ?2, setup_session_id = ?3 WHERE id = ?1",
            params![task_id, operation_id, session_id],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO setup_operation_state(
                 operation_id, workspace_id, task_id, session_id, status, canceled_at
             ) VALUES (?1, ?2, ?3, ?4, 'active', NULL)",
            params![operation_id, task.workspace_id, task_id, session_id],
        )?;
        Self::get_task_from(&connection, task_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {task_id}")))
    }

    /// Persists the user's confirmed repository subset for a setup operation.
    /// Once selected, retries cannot silently widen or replace that context.
    pub fn save_task_setup_repository_selection(
        &self,
        operation_id: &str,
        repository_ids: &[String],
    ) -> StoreResult<()> {
        let encoded = serde_json::to_string(repository_ids).map_err(|error| {
            ManagementStoreError::InvalidTransition(format!(
                "could not encode task repository selection: {error}"
            ))
        })?;
        let connection = self.lock()?;
        let existing: Option<String> = connection.query_row(
            "SELECT selected_repository_ids FROM setup_operation_state WHERE operation_id = ?1",
            [operation_id],
            |row| row.get::<_, Option<String>>(0),
        )?;
        if let Some(existing) = existing {
            if existing != encoded {
                return Err(ManagementStoreError::InvalidTransition(
                    "confirmed task repository selection cannot be changed during setup".into(),
                ));
            }
            return Ok(());
        }
        let changed = connection.execute(
            "UPDATE setup_operation_state SET selected_repository_ids = ?2 WHERE operation_id = ?1",
            params![operation_id, encoded],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::NotFound(format!(
                "setup operation {operation_id}"
            )));
        }
        Ok(())
    }

    pub fn task_setup_repository_selection(
        &self,
        operation_id: &str,
    ) -> StoreResult<Option<Vec<String>>> {
        let connection = self.lock()?;
        let encoded: Option<String> = connection
            .query_row(
                "SELECT selected_repository_ids FROM setup_operation_state WHERE operation_id = ?1",
                [operation_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .optional()?
            .flatten();
        encoded
            .map(|encoded| {
                serde_json::from_str(&encoded).map_err(|error| {
                    ManagementStoreError::InvalidTransition(format!(
                        "stored task repository selection is invalid: {error}"
                    ))
                })
            })
            .transpose()
    }

    pub fn finish_initial_prompt(&self, session_id: &str, updated_at: i64) -> StoreResult<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute(
            "UPDATE sessions SET last_known_status = 'running', updated_at = ?2
             WHERE open_code_session_id = ?1 AND last_known_status = 'prompting'",
            params![session_id, updated_at],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "session {session_id} is not submitting its initial prompt"
            )));
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn cancel_task_setup(&self, id: &str) -> StoreResult<Task> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = Self::get_task_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        if task.status != TaskStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(
                "completed tasks cannot resume setup".into(),
            ));
        }
        let operation_id = task.setup_operation_id.ok_or_else(|| {
            ManagementStoreError::InvalidTransition("task setup has no operation identity".into())
        })?;
        let session_id = task.setup_session_id.ok_or_else(|| {
            ManagementStoreError::InvalidTransition("task setup has no session identity".into())
        })?;
        let now = management_now_millis();
        if task.setup_cancelled_at.is_some() {
            return Err(ManagementStoreError::InvalidTransition(
                "task setup is already canceled".into(),
            ));
        }
        let detail = "setup canceled by user";
        transaction.execute(
            "UPDATE setup_operation_state SET status = 'canceled', canceled_at = ?2
             WHERE operation_id = ?1 AND task_id = ?3 AND session_id = ?4",
            params![operation_id, now, id, session_id],
        )?;
        transaction.execute(
            "UPDATE tasks SET setup_status = 'incomplete', setup_cancelled_at = ?2,
                    setup_cancellation_detail = ?3 WHERE id = ?1",
            params![id, now, detail],
        )?;
        transaction.execute(
            "UPDATE sessions SET last_known_status = 'canceled', updated_at = ?2 WHERE open_code_session_id = ?1",
            params![session_id, now],
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO setup_events(event_id, task_id, operation_id, session_id, event_type, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, 'canceled', ?5, ?6)",
            params![format!("cancel-{id}-{now}"), id, operation_id, session_id, detail, now],
        )?;
        let task = Self::get_task_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(id.into()))?;
        transaction.commit()?;
        Ok(task)
    }

    pub fn resume_task_setup(
        &self,
        id: &str,
        operation_id: Option<&str>,
        session_id: Option<&str>,
    ) -> StoreResult<Task> {
        let connection = self.lock()?;
        let task = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        if task.status != TaskStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(
                "completed tasks cannot resume setup".into(),
            ));
        }
        if task.setup_operation_id.is_none() || task.setup_session_id.is_none() {
            return Err(ManagementStoreError::InvalidTransition(
                "task setup has no operation identity".into(),
            ));
        }
        if operation_id != task.setup_operation_id.as_deref()
            || session_id != task.setup_session_id.as_deref()
        {
            return Err(ManagementStoreError::InvalidTransition(
                "resume must use the task's existing setup operation and session".into(),
            ));
        }
        if task.setup_status != TaskSetupStatus::Incomplete || task.setup_cancelled_at.is_none() {
            return Err(ManagementStoreError::InvalidTransition(
                "only canceled, incomplete task setup can be resumed".into(),
            ));
        }
        let now = management_now_millis();
        let canceled: bool = connection.query_row(
            "SELECT status = 'canceled' FROM setup_operation_state
             WHERE operation_id = ?1 AND task_id = ?2 AND session_id = ?3",
            params![task.setup_operation_id, id, task.setup_session_id],
            |row| row.get(0),
        )?;
        if !canceled {
            return Err(ManagementStoreError::InvalidTransition(
                "setup operation is not canceled".into(),
            ));
        }
        connection.execute(
            "UPDATE setup_operation_state SET status = 'active', canceled_at = NULL
             WHERE operation_id = ?1 AND task_id = ?2 AND session_id = ?3",
            params![task.setup_operation_id, id, task.setup_session_id],
        )?;
        connection.execute(
            "UPDATE tasks SET setup_status = 'in_progress', setup_cancelled_at = NULL,
                    setup_cancellation_detail = NULL WHERE id = ?1",
            [id],
        )?;
        let task = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(id.into()))?;
        connection.execute(
            "UPDATE sessions SET last_known_status = 'starting', updated_at = ?2 WHERE open_code_session_id = ?1",
            params![task.setup_session_id.clone(), now],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO setup_events(event_id, task_id, operation_id, session_id, event_type, detail, created_at)
             VALUES (?1, ?2, ?3, ?4, 'resumed', NULL, ?5)",
            params![format!("resume-{id}-{now}"), id, task.setup_operation_id.clone(), task.setup_session_id.clone(), now],
        )?;
        Ok(task)
    }

    pub fn complete_task(&self, id: &str, completed_at: i64) -> StoreResult<Task> {
        let connection = self.lock()?;
        let task = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        if task.status != TaskStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "completed task {id} cannot be completed or reopened"
            )));
        }
        connection.execute(
            "UPDATE tasks SET status = 'completed', completed_at = ?2 WHERE id = ?1",
            params![id, completed_at],
        )?;
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    /// Complete and enqueue all existing worktrees in one transaction.  No Git
    /// command is involved in this operation; cleanup is deliberately a later
    /// worker action.
    pub fn complete_task_and_queue_cleanup(
        &self,
        id: &str,
        completed_at: i64,
    ) -> StoreResult<Task> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = Self::get_task_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        if task.status != TaskStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "completed task {id} cannot be completed or reopened"
            )));
        }
        transaction.execute(
            "UPDATE tasks SET status = 'completed', completed_at = ?2 WHERE id = ?1",
            params![id, completed_at],
        )?;
        let mut bindings = transaction.prepare("SELECT task_id, repository_id, worktree_path FROM task_repositories WHERE task_id = ?1")?;
        let rows = bindings
            .query_map([id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(bindings);
        for (task_id, repository_id, worktree_path) in rows {
            let job_id = format!("cleanup-{task_id}-{repository_id}");
            transaction.execute("INSERT INTO cleanup_jobs(id, task_id, repository_id, worktree_path, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, ?5) ON CONFLICT(task_id, repository_id, worktree_path) DO NOTHING", params![job_id, task_id, repository_id, worktree_path, completed_at])?;
        }
        transaction.commit()?;
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    /// Deliberately rejects reopening. Further work must be created as a new task.
    pub fn reopen_task(&self, id: &str) -> StoreResult<Task> {
        let task = self
            .get_task(id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        Err(ManagementStoreError::InvalidTransition(format!(
            "task {id} is {:?}; tasks cannot be reopened",
            task.status
        )))
    }

    pub fn dismiss_quick_request(&self, id: &str, dismissed_at: i64) -> StoreResult<Task> {
        let connection = self.lock()?;
        let task = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        let lifecycle = task.quick_request.ok_or_else(|| {
            ManagementStoreError::InvalidTransition(format!("task {id} is not a Quick Request"))
        })?;
        if lifecycle.dismissed_at.is_none() {
            connection.execute(
                "UPDATE tasks SET quick_request_dismissed_at = ?2 WHERE id = ?1",
                params![id, dismissed_at],
            )?;
        }
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    /// Permanently removes an application-owned Quick Request and its local
    /// prompt/session associations. OpenCode's server-side conversation is not
    /// deleted; callers stop any attached terminal before invoking this.
    pub fn delete_quick_request(&self, id: &str) -> StoreResult<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = Self::get_task_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("Quick Request {id}")))?;
        if task.quick_request.is_none() {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "task {id} is not a Quick Request"
            )));
        }
        let repository_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM task_repositories WHERE task_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        let cleanup_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM cleanup_jobs WHERE task_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if repository_count != 0 || cleanup_count != 0 {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "Quick Request {id} has regular task repository state and cannot be deleted"
            )));
        }
        transaction.execute("DELETE FROM setup_events WHERE task_id = ?1", [id])?;
        transaction.execute("DELETE FROM setup_operations WHERE task_id = ?1", [id])?;
        transaction.execute("DELETE FROM setup_operation_state WHERE task_id = ?1", [id])?;
        transaction.execute("DELETE FROM quick_request_prompts WHERE task_id = ?1", [id])?;
        transaction.execute("DELETE FROM sessions WHERE owner_task_id = ?1", [id])?;
        transaction.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
        transaction.commit()?;
        Ok(())
    }

    /// Marks an eligible, inactive Quick Request as expired. The caller must reconcile session
    /// activity first; storage does not own OpenCode runtime state.
    pub fn expire_quick_request(&self, id: &str, expired_at: i64) -> StoreResult<Task> {
        let connection = self.lock()?;
        let task = Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        let lifecycle = task.quick_request.ok_or_else(|| {
            ManagementStoreError::InvalidTransition(format!("task {id} is not a Quick Request"))
        })?;
        let expires_at = lifecycle.expires_at.ok_or_else(|| {
            ManagementStoreError::InvalidTransition(format!("Quick Request {id} has been promoted"))
        })?;
        if expired_at < expires_at {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "Quick Request {id} is not eligible to expire yet"
            )));
        }
        if lifecycle.expired_at.is_none() {
            connection.execute(
                "UPDATE tasks SET quick_request_expired_at = ?2 WHERE id = ?1",
                params![id, expired_at],
            )?;
        }
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    /// Moves a Quick Request task to a regular workspace without changing its identity or old sessions.
    pub fn promote_quick_request(
        &self,
        id: &str,
        target_workspace_id: &str,
        target_slug: &str,
        promoted_at: i64,
    ) -> StoreResult<Task> {
        safety::validate_slug(target_slug)?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let task = Self::get_task_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
        let lifecycle = task.quick_request.as_ref().ok_or_else(|| {
            ManagementStoreError::InvalidTransition(format!("task {id} is not a Quick Request"))
        })?;
        if task.status != TaskStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "completed Quick Request {id} cannot be promoted"
            )));
        }
        if let Some(previous_promotion) = lifecycle.promoted_at {
            if task.workspace_id == target_workspace_id && task.slug == target_slug {
                transaction.commit()?;
                return Self::get_task_from(&connection, id)?
                    .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")));
            }
            return Err(ManagementStoreError::InvalidTransition(format!(
                "Quick Request {id} was already promoted at {previous_promotion}"
            )));
        }
        if task.workspace_id == target_workspace_id {
            return Err(ManagementStoreError::InvalidTransition(
                "Quick Request promotion requires a different workspace".into(),
            ));
        }
        let target =
            Self::get_workspace_from(&transaction, target_workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {target_workspace_id}"))
            })?;
        if target.status != WorkspaceStatus::Active || target.kind != WorkspaceKind::Regular {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "target workspace {target_workspace_id} must be an active regular workspace"
            )));
        }
        let configured_root = Self::project_home_root_from(&transaction)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let expected_workspace_home = project_root.join(&target.slug);
        let canonical_workspace_home =
            safety::canonicalize_or_resolve_missing(&expected_workspace_home)?;
        if canonical_workspace_home != expected_workspace_home {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "promotion target workspace resolves through a symlink".into(),
            )));
        }
        if safety::canonicalize_or_resolve_missing(Path::new(&target.home_path))?
            != canonical_workspace_home
        {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "promotion target workspace home does not match its configured project root".into(),
            )));
        }
        let (target_home_path, home_guard) = safety::ensure_regular_task_home(
            &self.user_home,
            &project_root,
            &target.slug,
            target_slug,
            &task.id,
        )?;
        transaction.execute(
            "UPDATE tasks SET workspace_id = ?2, slug = ?3, home_path = ?4,
                              quick_request_expires_at = NULL, quick_request_expired_at = NULL,
                              quick_request_promoted_at = ?5
             WHERE id = ?1",
            params![
                id,
                target_workspace_id,
                target_slug,
                path_to_string(&target_home_path)?,
                promoted_at
            ],
        )?;
        transaction.commit()?;
        home_guard.commit();
        Self::get_task_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))
    }

    pub(crate) fn create_repository(&self, repository: &NewRepository) -> StoreResult<Repository> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO repository_catalog(
                id, name, repository_path, repository_identity, purpose, purpose_status, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                repository.id,
                repository.name,
                repository.repository_path,
                repository.repository_identity,
                repository.purpose,
                repository.purpose_status.as_str(),
                repository.created_at
            ],
        )?;
        Self::get_repository_from(&connection, &repository.id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("repository {} after insert", repository.id))
        })
    }

    #[cfg(test)]
    fn update_repository(&self, repository: &Repository) -> StoreResult<Repository> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE repository_catalog SET name = ?2, repository_path = ?3, repository_identity = ?4,
                    purpose = ?5, purpose_status = ?6, updated_at = ?7 WHERE id = ?1",
            params![
                repository.id,
                repository.name,
                repository.repository_path,
                repository.repository_identity,
                repository.purpose,
                repository.purpose_status.as_str(),
                repository.updated_at
            ],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::NotFound(format!(
                "repository {}",
                repository.id
            )));
        }
        Self::get_repository_from(&connection, &repository.id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("repository {}", repository.id)))
    }

    pub fn get_repository(&self, id: &str) -> StoreResult<Option<Repository>> {
        let connection = self.lock()?;
        Self::get_repository_from(&connection, id)
    }

    fn get_repository_from(connection: &Connection, id: &str) -> StoreResult<Option<Repository>> {
        connection
            .query_row(
                "SELECT id, name, repository_path, repository_identity, purpose, purpose_status,
                        created_at, updated_at FROM repository_catalog WHERE id = ?1",
                [id],
                repository_from_row,
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn list_repositories(&self) -> StoreResult<Vec<Repository>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, name, repository_path, repository_identity, purpose, purpose_status,
                    created_at, updated_at FROM repository_catalog ORDER BY name, id",
        )?;
        let rows = statement.query_map([], repository_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Add a verified discovery result, updating an existing catalog record by
    /// either its canonical path or Git identity. Git facts always win over
    /// proposal text supplied by the caller.
    pub fn catalog_discovered_repository(
        &self,
        id: &str,
        path: &Path,
        purpose: Option<&str>,
        created_at: i64,
    ) -> StoreResult<Repository> {
        let inspection = safety::inspect_repository(path)?;
        let canonical_path = path_to_string(&inspection.repository.canonical_root)?;
        let name = inspection
            .repository
            .canonical_root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Repository");
        let connection = self.lock()?;
        let existing = connection.query_row(
            "SELECT id FROM repository_catalog WHERE repository_path = ?1 OR repository_identity = ?2 LIMIT 1",
            params![canonical_path, inspection.repository.identity], |row| row.get::<_, String>(0)).optional()?;
        if let Some(existing_id) = existing {
            drop(connection);
            let repository = self
                .get_repository(&existing_id)?
                .ok_or_else(|| ManagementStoreError::NotFound(existing_id.clone()))?;
            if purpose.is_none() {
                return Ok(repository);
            }
            let connection = self.lock()?;
            connection.execute("UPDATE repository_catalog SET purpose = ?2, purpose_status = 'available', updated_at = ?3 WHERE id = ?1", params![existing_id, purpose, created_at])?;
            return Self::get_repository_from(&connection, &existing_id)?
                .ok_or_else(|| ManagementStoreError::NotFound(existing_id));
        }
        drop(connection);
        self.create_repository(&NewRepository {
            id: id.to_owned(),
            name: name.to_owned(),
            repository_path: canonical_path,
            repository_identity: inspection.repository.identity,
            purpose: purpose.map(str::to_owned),
            purpose_status: if purpose.is_some() {
                PurposeStatus::Available
            } else {
                PurposeStatus::Unavailable
            },
            created_at,
        })
    }

    /// Catalogs a repository explicitly selected by the user. This is the only
    /// production path that grants an external repository catalog ownership.
    pub fn catalog_selected_repository(
        &self,
        id: &str,
        name: &str,
        path: &Path,
        purpose: Option<&str>,
        created_at: i64,
    ) -> StoreResult<Repository> {
        safety::validate_name(name)?;
        let inspection = safety::inspect_repository(path)?;
        let repository_path = path_to_string(&inspection.repository.canonical_root)?;
        let new_repository = NewRepository {
            id: id.to_owned(),
            name: name.to_owned(),
            repository_path,
            repository_identity: inspection.repository.identity,
            purpose: purpose.map(str::to_owned),
            purpose_status: if purpose.is_some() {
                PurposeStatus::Available
            } else {
                PurposeStatus::Unavailable
            },
            created_at,
        };
        let connection = self.lock()?;
        if let Some(existing) = Self::get_repository_from(&connection, id)? {
            if existing.repository_path == new_repository.repository_path
                && existing.repository_identity == new_repository.repository_identity
            {
                return Ok(existing);
            }
            return Err(ManagementStoreError::InvalidTransition(format!(
                "repository ID {id} already belongs to a different Git identity or path"
            )));
        }
        drop(connection);
        self.create_repository(&new_repository)
    }

    /// Inspects a repository for use. Paths inside the validated project home
    /// may be inspected directly; every external path needs an exact existing
    /// catalog ID/path/identity match.
    pub fn inspect_repository_for_use(
        &self,
        path: &Path,
        catalog_id: Option<&str>,
    ) -> StoreResult<GitInspection> {
        let inspection = safety::inspect_repository(path)?;
        let connection = self.lock()?;
        if let Some(catalog_id) = catalog_id {
            let catalog = Self::get_repository_from(&connection, catalog_id)?.ok_or_else(|| {
                ManagementStoreError::Safety(SafetyError::NotCataloged(catalog_id.into()))
            })?;
            verify_catalog_identity(&catalog, &inspection.repository)?;
            return Ok(inspection);
        }
        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        if inspection
            .repository
            .canonical_root
            .starts_with(&project_root)
        {
            return Ok(inspection);
        }
        Err(ManagementStoreError::Safety(SafetyError::NotCataloged(
            inspection.repository.canonical_root.display().to_string(),
        )))
    }

    /// Validates a workspace checkout against the explicitly selected catalog
    /// record before persisting its association.
    pub fn validate_and_save_workspace_repository_binding(
        &self,
        binding: &WorkspaceRepositoryBinding,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        let catalog =
            Self::get_repository_from(&connection, &binding.repository_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("repository {}", binding.repository_id))
            })?;
        let workspace =
            Self::get_workspace_from(&connection, &binding.workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {}", binding.workspace_id))
            })?;
        if workspace.kind != WorkspaceKind::Regular || workspace.status != WorkspaceStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace repository bindings require an active regular workspace".into(),
            ));
        }
        let checkout = safety::inspect_repository(Path::new(&binding.checkout_path))?;
        match binding.checkout_mode {
            CheckoutMode::Existing => verify_catalog_identity(&catalog, &checkout.repository)?,
            CheckoutMode::Managed
                if checkout.repository.identity != catalog.repository_identity =>
            {
                return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                    "managed checkout does not share the selected repository's Git identity".into(),
                )));
            }
            CheckoutMode::Managed => {}
        }
        let Some(default_branch) = checkout.repository.default_branch.as_deref() else {
            return Err(ManagementStoreError::Safety(SafetyError::Git(
                "repository's canonical default branch is unavailable or ambiguous".into(),
            )));
        };
        if binding.branch != default_branch {
            return Err(ManagementStoreError::Safety(SafetyError::Git(format!(
                "workspace checkout branch {:?} is not the repository's default branch {:?}",
                binding.branch, default_branch
            ))));
        }
        let branch = safety::inspect_branch(Path::new(&catalog.repository_path), &binding.branch)?;
        if !branch.valid || !branch.exists {
            return Err(ManagementStoreError::Safety(SafetyError::Git(format!(
                "branch {:?} is invalid or absent",
                binding.branch
            ))));
        }
        match binding.checkout_mode {
            CheckoutMode::Existing => {
                if checkout.repository.canonical_root
                    != safety::canonicalize_or_resolve_missing(Path::new(&catalog.repository_path))?
                {
                    return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                        "existing checkout path must match the selected catalog repository path"
                            .into(),
                    )));
                }
            }
            CheckoutMode::Managed => {
                let configured_root = Self::project_home_root_from(&connection)?;
                let project_root =
                    safety::resolve_project_home_root(&configured_root, &self.user_home)?;
                let workspace_home = safety::canonical_descendant(
                    &project_root,
                    &project_root.join(&workspace.slug),
                )?;
                if workspace_home != project_root.join(&workspace.slug) {
                    return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                        "workspace home resolves through a symlink instead of its owner path"
                            .into(),
                    )));
                }
                let persisted_workspace_home =
                    safety::canonicalize_or_resolve_missing(Path::new(&workspace.home_path))?;
                if workspace_home != persisted_workspace_home {
                    return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                        "workspace home does not match its configured root and slug".into(),
                    )));
                }
                let repos_root = checked_managed_child_directory(&workspace_home, "repos")?;
                let canonical_checkout =
                    safety::canonical_descendant(&repos_root, &checkout.repository.canonical_root)?;
                if canonical_checkout == repos_root
                    || canonical_checkout != checkout.repository.canonical_root
                {
                    return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                        "managed checkout must be a canonical child of workspace repos/".into(),
                    )));
                }
                if branch.owning_worktrees != [canonical_checkout.clone()] {
                    return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                        "managed checkout branch ownership is missing or ambiguous".into(),
                    )));
                }
            }
        }
        if checkout.repository.current_branch.as_deref() != Some(binding.branch.as_str()) {
            return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                format!(
                    "checkout {} is not on requested branch {}",
                    checkout.repository.canonical_root.display(),
                    binding.branch
                ),
            )));
        }
        drop(connection);
        let canonical_binding = WorkspaceRepositoryBinding {
            checkout_path: path_to_string(&checkout.repository.canonical_root)?,
            ..binding.clone()
        };
        self.save_workspace_repository_binding(&canonical_binding)
    }

    pub(crate) fn save_workspace_repository_binding(
        &self,
        binding: &WorkspaceRepositoryBinding,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO workspace_repositories(
                workspace_id, repository_id, checkout_path, checkout_mode, branch, verification_status, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(workspace_id, repository_id) DO UPDATE SET
                checkout_path = excluded.checkout_path,
                checkout_mode = excluded.checkout_mode,
                branch = excluded.branch,
                verification_status = excluded.verification_status",
            params![
                binding.workspace_id,
                binding.repository_id,
                binding.checkout_path,
                binding.checkout_mode.as_str(),
                binding.branch,
                binding.verification_status.as_str(),
                binding.created_at
            ],
        )?;
        Ok(())
    }

    pub fn list_workspace_repository_bindings(
        &self,
        workspace_id: &str,
    ) -> StoreResult<Vec<WorkspaceRepositoryBinding>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT workspace_id, repository_id, checkout_path, checkout_mode, branch,
                    verification_status, created_at FROM workspace_repositories
             WHERE workspace_id = ?1 ORDER BY repository_id",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(WorkspaceRepositoryBinding {
                workspace_id: row.get(0)?,
                repository_id: row.get(1)?,
                checkout_path: row.get(2)?,
                checkout_mode: row.get(3)?,
                branch: row.get(4)?,
                verification_status: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Preserve an attempted attachment when setup is incomplete. This is
    /// intentionally separate from the verified binding path: failed paths
    /// are visible for correction but are never used as session context.
    pub fn record_workspace_repository_failure(
        &self,
        binding: &WorkspaceRepositoryBinding,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        let workspace =
            Self::get_workspace_from(&connection, &binding.workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {}", binding.workspace_id))
            })?;
        if workspace.kind != WorkspaceKind::Regular || workspace.status != WorkspaceStatus::Active {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace repository bindings require an active regular workspace".into(),
            ));
        }
        let _: String = connection.query_row(
            "SELECT id FROM repository_catalog WHERE id = ?1",
            [&binding.repository_id],
            |row| row.get(0),
        )?;
        connection.execute(
            "INSERT INTO workspace_repositories(workspace_id, repository_id, checkout_path, checkout_mode, branch, verification_status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 'failed', ?6)
             ON CONFLICT(workspace_id, repository_id) DO UPDATE SET checkout_path=excluded.checkout_path, checkout_mode=excluded.checkout_mode, branch=excluded.branch, verification_status='failed'",
            params![binding.workspace_id, binding.repository_id, binding.checkout_path, binding.checkout_mode.as_str(), binding.branch, binding.created_at],
        )?;
        Ok(())
    }

    pub(crate) fn save_task_repository_binding(
        &self,
        binding: &TaskRepositoryBinding,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        Self::save_task_repository_binding_from(&connection, binding)
    }

    fn save_task_repository_binding_from(
        connection: &Connection,
        binding: &TaskRepositoryBinding,
    ) -> StoreResult<()> {
        connection.execute(
            "INSERT INTO task_repositories(
                task_id, repository_id, branch, worktree_path, setup_status, error_code,
                error_detail, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
             ON CONFLICT(task_id, repository_id) DO UPDATE SET
                branch = excluded.branch, worktree_path = excluded.worktree_path,
                setup_status = excluded.setup_status, error_code = excluded.error_code,
                error_detail = excluded.error_detail, updated_at = excluded.updated_at",
            params![
                binding.task_id,
                binding.repository_id,
                binding.branch,
                binding.worktree_path,
                binding.setup_status.as_str(),
                binding.error_code,
                binding.error_detail,
                binding.created_at,
                binding.updated_at
            ],
        )?;
        Ok(())
    }

    /// Validates actual Git ownership and task-home containment before a ready
    /// worktree binding can become authoritative. Raw storage is crate-private.
    pub fn validate_and_save_task_repository_binding(
        &self,
        binding: &TaskRepositoryBinding,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        self.validate_and_save_task_repository_binding_from(&connection, binding)
    }

    fn validate_and_save_task_repository_binding_from(
        &self,
        connection: &Connection,
        binding: &TaskRepositoryBinding,
    ) -> StoreResult<()> {
        if binding.setup_status != RepositorySetupStatus::Ready {
            return Err(ManagementStoreError::InvalidTransition(
                "only a ready, independently verified worktree can be bound".into(),
            ));
        }
        let task = Self::get_task_from(&connection, &binding.task_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {}", binding.task_id)))?;
        if task.status != TaskStatus::Active
            || task
                .quick_request
                .as_ref()
                .is_some_and(|request| request.promoted_at.is_none())
        {
            return Err(ManagementStoreError::InvalidTransition(
                "task repository bindings require an active regular task".into(),
            ));
        }
        let workspace =
            Self::get_workspace_from(&connection, &task.workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {}", task.workspace_id))
            })?;
        if workspace.kind != WorkspaceKind::Regular {
            return Err(ManagementStoreError::InvalidTransition(
                "Quick Requests cannot own repository worktrees".into(),
            ));
        }
        let catalog =
            Self::get_repository_from(&connection, &binding.repository_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("repository {}", binding.repository_id))
            })?;
        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let expected_workspace_home = project_root.join(&workspace.slug);
        let expected_task_home = expected_workspace_home.join("tasks").join(&task.slug);
        let canonical_workspace_home =
            safety::canonical_descendant(&project_root, &expected_workspace_home)?;
        if canonical_workspace_home != expected_workspace_home {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "workspace home resolves through a symlink instead of its owner path".into(),
            )));
        }
        let persisted_workspace_home =
            safety::canonicalize_or_resolve_missing(Path::new(&workspace.home_path))?;
        if canonical_workspace_home != persisted_workspace_home {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "persisted workspace home does not match its configured root and slug".into(),
            )));
        }
        let canonical_task_home = safety::canonical_descendant(&project_root, &expected_task_home)?;
        if canonical_task_home != expected_task_home {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "task home resolves through a symlink instead of its owner path".into(),
            )));
        }
        let persisted_task_home =
            safety::canonicalize_or_resolve_missing(Path::new(&task.home_path))?;
        if canonical_task_home != persisted_task_home {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "persisted task home does not match its workspace and slug".into(),
            )));
        }
        let worktrees_root = checked_task_worktrees_root(&canonical_task_home)?;
        let reported_path = Path::new(&binding.worktree_path);
        let canonical_worktree = safety::canonical_descendant(&worktrees_root, reported_path)?;
        if canonical_worktree == worktrees_root || !canonical_worktree.is_dir() {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                format!(
                    "task worktree {} is not a child worktree directory",
                    canonical_worktree.display()
                ),
            )));
        }

        let catalog_inspection = safety::inspect_repository(Path::new(&catalog.repository_path))?;
        verify_catalog_identity(&catalog, &catalog_inspection.repository)?;
        let worktree_inspection = safety::inspect_repository(&canonical_worktree)?;
        if worktree_inspection.repository.identity != catalog.repository_identity {
            return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                format!(
                    "worktree {} belongs to {}, expected {}",
                    canonical_worktree.display(),
                    worktree_inspection.repository.identity,
                    catalog.repository_identity
                ),
            )));
        }
        let branch = safety::inspect_branch(Path::new(&catalog.repository_path), &binding.branch)?;
        if !branch.valid || !branch.exists {
            return Err(ManagementStoreError::Safety(SafetyError::Git(format!(
                "branch {:?} is invalid or absent",
                binding.branch
            ))));
        }
        let owners = branch
            .owning_worktrees
            .iter()
            .filter(|path| **path == canonical_worktree)
            .count();
        if owners != 1 || branch.owning_worktrees.len() != 1 {
            return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                format!(
                    "branch {} ownership is missing or ambiguous across {:?}",
                    binding.branch, branch.owning_worktrees
                ),
            )));
        }
        let conflicting_active_owner: bool = connection.query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM task_repositories tr
                 JOIN tasks t ON t.id = tr.task_id
                 WHERE tr.repository_id = ?1 AND tr.branch = ?2
                   AND tr.task_id <> ?3 AND t.status = 'active'
             )",
            params![binding.repository_id, binding.branch, binding.task_id],
            |row| row.get(0),
        )?;
        if conflicting_active_owner {
            return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                "branch is already associated with another active task".into(),
            )));
        }
        let canonical_binding = TaskRepositoryBinding {
            worktree_path: path_to_string(&canonical_worktree)?,
            ..binding.clone()
        };
        Self::save_task_repository_binding_from(connection, &canonical_binding)
    }

    pub fn list_task_repository_bindings(
        &self,
        task_id: &str,
    ) -> StoreResult<Vec<TaskRepositoryBinding>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT task_id, repository_id, branch, worktree_path, setup_status, error_code,
                    error_detail, created_at, updated_at FROM task_repositories
             WHERE task_id = ?1 ORDER BY repository_id",
        )?;
        let rows = statement.query_map([task_id], |row| {
            Ok(TaskRepositoryBinding {
                task_id: row.get(0)?,
                repository_id: row.get(1)?,
                branch: row.get(2)?,
                worktree_path: row.get(3)?,
                setup_status: row.get(4)?,
                error_code: row.get(5)?,
                error_detail: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Applies one idempotent report from the task setup tool.  Validation is
    /// deliberately item-scoped: one bad worktree never rolls back a valid
    /// worktree reported in the same OpenCode turn.
    pub fn apply_registration_report(
        &self,
        report: &RegistrationReport,
    ) -> StoreResult<RegistrationResult> {
        if report.operation_id.trim().is_empty()
            || report.workspace_id.trim().is_empty()
            || report.task_id.trim().is_empty()
            || report.session_id.trim().is_empty()
        {
            return Err(ManagementStoreError::InvalidTransition(
                "operation, workspace, task, and session IDs are required".into(),
            ));
        }
        let report_json = serde_json::to_string(report).map_err(|e| {
            ManagementStoreError::InvalidTransition(format!(
                "could not serialize setup report: {e}"
            ))
        })?;
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        {
            let canceled: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM setup_operation_state
                 WHERE operation_id = ?1 AND task_id = ?2 AND session_id = ?3
                   AND status = 'canceled')",
                params![report.operation_id, report.task_id, report.session_id],
                |row| row.get(0),
            )?;
            if canceled {
                return Err(ManagementStoreError::InvalidTransition(
                    "setup operation is canceled; resume it explicitly before reporting".into(),
                ));
            }
            if let Some((stored_report, stored_result)) = transaction
                .query_row(
                    "SELECT report_json, result_json FROM setup_operations WHERE operation_id = ?1",
                    [&report.operation_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
            {
                if stored_report != report_json {
                    return Err(ManagementStoreError::InvalidTransition(
                        "operation ID was already applied with different content".into(),
                    ));
                }
                let mut result: RegistrationResult = serde_json::from_str(&stored_result)
                    .map_err(|e| ManagementStoreError::InvalidTransition(e.to_string()))?;
                result.replayed = true;
                transaction.commit()?;
                return Ok(result);
            }
        }

        let task = Self::get_task_from(&transaction, &report.task_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {}", report.task_id)))?;
        let workspace =
            Self::get_workspace_from(&transaction, &report.workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {}", report.workspace_id))
            })?;
        if workspace.status != WorkspaceStatus::Active
            || workspace.kind != WorkspaceKind::Regular
            || task.status != TaskStatus::Active
            || task.workspace_id != workspace.id
        {
            return Err(ManagementStoreError::InvalidTransition(
                "setup owner workspace/task is not active or does not match".into(),
            ));
        }
        let session =
            Self::get_session_from(&transaction, &report.session_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("session {}", report.session_id))
            })?;
        if session.owner != SessionOwner::Task(task.id.clone())
            || session.directory != task.home_path
        {
            return Err(ManagementStoreError::InvalidTransition(
                "caller session does not belong to this task or task home".into(),
            ));
        }
        if task.setup_operation_id.as_deref() != Some(report.operation_id.as_str())
            || task.setup_session_id.as_deref() != Some(report.session_id.as_str())
        {
            return Err(ManagementStoreError::InvalidTransition(
                "registration report does not match the task setup operation".into(),
            ));
        }
        let mut seen = std::collections::HashSet::new();
        if report.items.is_empty() {
            return Err(ManagementStoreError::InvalidTransition(
                "setup report contains no items".into(),
            ));
        }
        let mut output = Vec::with_capacity(report.items.len());
        for item in &report.items {
            if !seen.insert(item.item_id.clone()) {
                return Err(ManagementStoreError::InvalidTransition(format!(
                    "duplicate setup item {}",
                    item.item_id
                )));
            }
            let mut accepted = item.clone();
            let binding = TaskRepositoryBinding {
                task_id: task.id.clone(),
                repository_id: item.repository_id.clone(),
                branch: item.branch.clone().unwrap_or_default(),
                worktree_path: item.worktree_path.clone().unwrap_or_default(),
                setup_status: match item.result {
                    RegistrationItemResult::Ready => RepositorySetupStatus::Ready,
                    RegistrationItemResult::Failed => RepositorySetupStatus::Failed,
                    RegistrationItemResult::NotAttempted => RepositorySetupStatus::NotAttempted,
                },
                error_code: item.error_code.clone(),
                error_detail: item.detail.clone(),
                created_at: task.created_at,
                updated_at: management_now_millis(),
            };
            if matches!(item.result, RegistrationItemResult::Ready) {
                let metadata_error = (|| -> StoreResult<()> {
                    let catalog = Self::get_repository_from(&transaction, &item.repository_id)?
                        .ok_or_else(|| {
                            ManagementStoreError::NotFound(format!(
                                "repository {}",
                                item.repository_id
                            ))
                        })?;
                    let reported =
                        safety::canonicalize_or_resolve_missing(Path::new(&item.repository_path))?;
                    let expected = safety::canonicalize_or_resolve_missing(Path::new(
                        &catalog.repository_path,
                    ))?;
                    if reported != expected {
                        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                            "reported repository path does not match the catalog".into(),
                        )));
                    }
                    let inspection = safety::inspect_repository(Path::new(&item.repository_path))?;
                    if inspection.repository.identity != item.git_identity
                        || inspection.repository.identity != catalog.repository_identity
                    {
                        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                            "reported Git identity does not match the catalog".into(),
                        )));
                    }
                    Ok(())
                })();
                if let Err(error) = metadata_error.and_then(|_| {
                    self.validate_and_save_task_repository_binding_from(&transaction, &binding)
                }) {
                    accepted.result = RegistrationItemResult::Failed;
                    accepted.error_code = Some("validation_failed".into());
                    accepted.detail = Some(error.to_string());
                    let failed = TaskRepositoryBinding {
                        setup_status: RepositorySetupStatus::Failed,
                        error_code: accepted.error_code.clone(),
                        error_detail: accepted.detail.clone(),
                        ..binding
                    };
                    Self::save_task_repository_binding_from(&transaction, &failed)?;
                }
            } else {
                Self::save_task_repository_binding_from(&transaction, &binding)?;
            }
            output.push(accepted);
        }
        let setup_status = if output
            .iter()
            .all(|item| matches!(item.result, RegistrationItemResult::Ready))
        {
            TaskSetupStatus::Ready
        } else {
            TaskSetupStatus::Incomplete
        };
        transaction.execute(
            "UPDATE tasks SET setup_status = ?2 WHERE id = ?1",
            params![task.id, setup_status.as_str()],
        )?;
        let result = RegistrationResult {
            operation_id: report.operation_id.clone(),
            workspace_id: report.workspace_id.clone(),
            task_id: report.task_id.clone(),
            session_id: report.session_id.clone(),
            replayed: false,
            items: output,
        };
        let result_json = serde_json::to_string(&result).map_err(|e| {
            ManagementStoreError::InvalidTransition(format!(
                "could not serialize setup result: {e}"
            ))
        })?;
        transaction.execute(
            "INSERT INTO setup_operations(operation_id, workspace_id, task_id, session_id, report_json, result_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![report.operation_id, report.workspace_id, report.task_id, report.session_id, report_json, result_json, management_now_millis()],
        )?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn list_registration_results(
        &self,
        task_id: &str,
    ) -> StoreResult<Vec<TaskRepositoryBinding>> {
        self.list_task_repository_bindings(task_id)
    }

    pub fn create_session(&self, session: &NewSession) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        Self::insert_session(&connection, session)?;
        Self::get_session_from(&connection, &session.open_code_session_id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!(
                "session {} after insert",
                session.open_code_session_id
            ))
        })
    }

    pub fn create_session_with_model(
        &self,
        session: &NewSession,
        selected_model: &str,
    ) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        Self::insert_session_with_model(&connection, session, Some(selected_model))?;
        Self::get_session_from(&connection, &session.open_code_session_id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!(
                "session {} after insert",
                session.open_code_session_id
            ))
        })
    }

    fn insert_session(connection: &Connection, session: &NewSession) -> StoreResult<()> {
        Self::insert_session_with_model(connection, session, None)
    }

    fn insert_session_with_model(
        connection: &Connection,
        session: &NewSession,
        selected_model: Option<&str>,
    ) -> StoreResult<()> {
        let (workspace_id, task_id) = match &session.owner {
            SessionOwner::Workspace(id) => (Some(id.as_str()), None),
            SessionOwner::Task(id) => (None, Some(id.as_str())),
        };
        connection.execute(
            "INSERT INTO sessions(
                open_code_session_id, owner_workspace_id, owner_task_id, directory,
                last_known_status, created_at, updated_at, selected_model
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
            params![
                session.open_code_session_id,
                workspace_id,
                task_id,
                session.directory,
                session.last_known_status,
                session.created_at,
                selected_model
            ],
        )?;
        Ok(())
    }

    pub fn get_session(&self, open_code_session_id: &str) -> StoreResult<Option<SessionRecord>> {
        let connection = self.lock()?;
        Self::get_session_from(&connection, open_code_session_id).map_err(Into::into)
    }

    /// Validate the routing tuple supplied by the renderer against the durable
    /// owner record.  A session id alone is not enough: two Quick Requests can
    /// deliberately share a directory, while regular sessions must always be
    /// started in their recorded owner directory.
    pub fn validate_session_context(
        &self,
        session_id: &str,
        directory: &Path,
    ) -> StoreResult<SessionRecord> {
        let session = self
            .get_session(session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("session {session_id}")))?;
        let actual = safety::canonicalize_or_resolve_missing(directory)?;
        let persisted = safety::canonicalize_or_resolve_missing(Path::new(&session.directory))?;
        if actual != persisted {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                format!("session {session_id} directory does not match its persisted owner"),
            )));
        }
        let owner_expected = match &session.owner {
            SessionOwner::Workspace(id) => {
                self.get_workspace(id)?
                    .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?
                    .home_path
            }
            SessionOwner::Task(id) => {
                let task = self
                    .get_task(id)?
                    .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
                let quick_shared = task
                    .quick_request
                    .as_ref()
                    .is_some_and(|request| request.promoted_at.is_none());
                if quick_shared {
                    self.get_workspace(&task.workspace_id)?
                        .ok_or_else(|| {
                            ManagementStoreError::NotFound(format!(
                                "workspace {}",
                                task.workspace_id
                            ))
                        })?
                        .home_path
                } else {
                    task.home_path
                }
            }
        };
        let owner_expected = safety::canonicalize_or_resolve_missing(Path::new(&owner_expected))?;
        let historical_quick_request_session = if let SessionOwner::Task(id) = &session.owner {
            self.get_task(id)?
                .is_some_and(|task| task.quick_request.is_some())
        } else {
            false
        };
        // A promoted Quick Request keeps its historical shared-directory
        // sessions. Future sessions use the dedicated task home.
        let historical_quick = if let SessionOwner::Task(id) = &session.owner {
            let task = self
                .get_task(id)?
                .ok_or_else(|| ManagementStoreError::NotFound(format!("task {id}")))?;
            if task
                .quick_request
                .as_ref()
                .is_some_and(|request| request.promoted_at.is_some())
            {
                let quick_workspace = self.get_workspace(&task.workspace_id)?.ok_or_else(|| {
                    ManagementStoreError::NotFound(format!("workspace {}", task.workspace_id))
                })?;
                persisted
                    == safety::canonicalize_or_resolve_missing(Path::new(
                        &quick_workspace.home_path,
                    ))?
            } else {
                false
            }
        } else {
            false
        };
        if actual != owner_expected && !historical_quick && !historical_quick_request_session {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                format!("session {session_id} directory does not match its owner context"),
            )));
        }
        Ok(session)
    }

    /// Atomically claim the initial prompt.  Frontend disabled buttons are only
    /// presentation; this compare-and-set prevents duplicate generation when
    /// two invocations cross at the Tauri boundary.
    pub fn claim_initial_prompt(&self, session_id: &str) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE sessions SET last_known_status = 'prompting', updated_at = ?2
             WHERE open_code_session_id = ?1 AND last_known_status = 'starting'",
            params![session_id, management_now_millis()],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "session {session_id} has already started or cannot be prompted"
            )));
        }
        Self::get_session_from(&connection, session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("session {session_id}")))
    }

    /// A claimed prompt is never left in the non-recoverable `prompting` state.
    /// Persist failure and uncertainty together so restart recovery can surface
    /// the record and an explicit retry can reconcile it first.
    pub fn mark_initial_prompt_failed(
        &self,
        session_id: &str,
        updated_at: i64,
    ) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE sessions SET last_known_status='failed', reconciliation_status='failed',
             reconciliation_uncertain=1, updated_at=?2
             WHERE open_code_session_id=?1 AND last_known_status IN ('prompting', 'starting')",
            params![session_id, updated_at],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "session {session_id} cannot be marked failed"
            )));
        }
        Self::get_session_from(&connection, session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(session_id.into()))
    }

    /// Explicit retry/reconciliation is the only way to move a failed initial
    /// prompt back to startup; no automatic resend is attempted.
    pub fn retry_initial_prompt(
        &self,
        session_id: &str,
        updated_at: i64,
    ) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE sessions SET last_known_status='starting', reconciliation_status='unknown',
             reconciliation_uncertain=1, updated_at=?2
             WHERE open_code_session_id=?1 AND last_known_status='failed'",
            params![session_id, updated_at],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "session {session_id} is not retryable"
            )));
        }
        Self::get_session_from(&connection, session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(session_id.into()))
    }

    /// Atomically claims a failed/uncertain initial prompt for an explicit
    /// retry. Readiness is checked by the command before this compare-and-set;
    /// doing the claim here prevents two renderer invocations from prompting.
    pub fn claim_retry_initial_prompt(
        &self,
        session_id: &str,
        updated_at: i64,
    ) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE sessions SET last_known_status='prompting', reconciliation_status='unknown',
             reconciliation_uncertain=1, updated_at=?2
             WHERE open_code_session_id=?1 AND
               last_known_status IN ('failed', 'unknown', 'reconnecting') AND
               (last_known_status='failed' OR reconciliation_uncertain=1)",
            params![session_id, updated_at],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::InvalidTransition(format!(
                "session {session_id} is not retryable"
            )));
        }
        Self::get_session_from(&connection, session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("session {session_id}")))
    }

    fn get_session_from(
        connection: &Connection,
        id: &str,
    ) -> rusqlite::Result<Option<SessionRecord>> {
        connection
            .query_row(
                "SELECT open_code_session_id, owner_workspace_id, owner_task_id, directory,
                        last_known_status, created_at, updated_at, event_cursor,
                        reconciliation_status, reconciliation_uncertain, pending_input_json, selected_model FROM sessions
                 WHERE open_code_session_id = ?1",
                [id],
                |row| {
                    let workspace_id: Option<String> = row.get(1)?;
                    let task_id: Option<String> = row.get(2)?;
                    let owner = match (workspace_id, task_id) {
                        (Some(id), None) => SessionOwner::Workspace(id),
                        (None, Some(id)) => SessionOwner::Task(id),
                        _ => return Err(rusqlite::Error::InvalidQuery),
                    };
                    Ok(SessionRecord {
                        open_code_session_id: row.get(0)?,
                        owner,
                        directory: row.get(3)?,
                        last_known_status: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                        event_cursor: row.get(7)?,
                        reconciliation_status: row.get(8)?,
                        reconciliation_uncertain: row.get::<_, i64>(9)? != 0,
                        pending_input_json: row.get(10)?,
                        selected_model: row.get(11)?,
                    })
                },
            )
            .optional()
    }

    pub fn list_sessions(&self, owner: &SessionOwner) -> StoreResult<Vec<SessionRecord>> {
        let connection = self.lock()?;
        let (column, owner_id) = match owner {
            SessionOwner::Workspace(id) => ("owner_workspace_id", id),
            SessionOwner::Task(id) => ("owner_task_id", id),
        };
        let sql = format!(
            "SELECT open_code_session_id, owner_workspace_id, owner_task_id, directory,
                    last_known_status, created_at, updated_at, event_cursor,
                    reconciliation_status, reconciliation_uncertain, pending_input_json, selected_model FROM sessions
             WHERE {column} = ?1 ORDER BY created_at, open_code_session_id"
        );
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map([owner_id], |row| {
            let workspace_id: Option<String> = row.get(1)?;
            let task_id: Option<String> = row.get(2)?;
            let owner = match (workspace_id, task_id) {
                (Some(id), None) => SessionOwner::Workspace(id),
                (None, Some(id)) => SessionOwner::Task(id),
                _ => return Err(rusqlite::Error::InvalidQuery),
            };
            Ok(SessionRecord {
                open_code_session_id: row.get(0)?,
                owner,
                directory: row.get(3)?,
                last_known_status: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                event_cursor: row.get(7)?,
                reconciliation_status: row.get(8)?,
                reconciliation_uncertain: row.get::<_, i64>(9)? != 0,
                pending_input_json: row.get(10)?,
                selected_model: row.get(11)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn update_session_status(
        &self,
        open_code_session_id: &str,
        status: &str,
        updated_at: i64,
    ) -> StoreResult<SessionRecord> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE sessions SET last_known_status = ?2, updated_at = ?3 WHERE open_code_session_id = ?1",
            params![open_code_session_id, status, updated_at],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::NotFound(format!(
                "session {open_code_session_id}"
            )));
        }
        Self::get_session_from(&connection, open_code_session_id)?.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("session {open_code_session_id}"))
        })
    }

    pub fn list_all_sessions(&self) -> StoreResult<Vec<SessionRecord>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT open_code_session_id, owner_workspace_id, owner_task_id, directory,
             last_known_status, created_at, updated_at, event_cursor, reconciliation_status,
             reconciliation_uncertain, pending_input_json, selected_model FROM sessions ORDER BY created_at",
        )?;
        let rows = statement.query_map([], |row| Self::session_from_row(row))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Mark durable sessions as needing an API/PTY reconciliation after an
    /// application restart.  We do not claim that an inactive session is
    /// complete, and we retain its exact id, directory, cursor, and pending
    /// input for the reconnect command.
    pub fn mark_sessions_for_startup_reconciliation(&self, now: i64) -> StoreResult<usize> {
        let connection = self.lock()?;
        Ok(connection.execute(
            "UPDATE sessions
             SET last_known_status = 'reconnecting',
                 reconciliation_status = 'reconnecting',
                 reconciliation_uncertain = 1,
                 updated_at = ?1
             WHERE reconciliation_status != 'failed'",
            [now],
        )?)
    }

    fn session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SessionRecord> {
        let workspace_id: Option<String> = row.get(1)?;
        let task_id: Option<String> = row.get(2)?;
        let owner = match (workspace_id, task_id) {
            (Some(id), None) => SessionOwner::Workspace(id),
            (None, Some(id)) => SessionOwner::Task(id),
            _ => return Err(rusqlite::Error::InvalidQuery),
        };
        Ok(SessionRecord {
            open_code_session_id: row.get(0)?,
            owner,
            directory: row.get(3)?,
            last_known_status: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
            event_cursor: row.get(7)?,
            reconciliation_status: row.get(8)?,
            reconciliation_uncertain: row.get::<_, i64>(9)? != 0,
            pending_input_json: row.get(10)?,
            selected_model: row.get(11)?,
        })
    }

    pub fn update_session_reconciliation(
        &self,
        id: &str,
        status: &str,
        cursor: Option<&str>,
        uncertain: bool,
        pending_input_json: Option<&str>,
        updated_at: i64,
    ) -> StoreResult<SessionRecord> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let changed = transaction.execute("UPDATE sessions SET last_known_status=?2, reconciliation_status=?2, event_cursor=?3, reconciliation_uncertain=?4, pending_input_json=?5, updated_at=?6 WHERE open_code_session_id=?1", params![id, status, cursor, uncertain as i64, pending_input_json, updated_at])?;
        if changed == 0 {
            return Err(ManagementStoreError::NotFound(format!("session {id}")));
        }
        transaction.commit()?;
        Self::get_session_from(&connection, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("session {id}")))
    }

    /// Inserts a cleanup job once per task/repository/worktree, making retries idempotent.
    pub fn create_cleanup_job(&self, job: &NewCleanupJob) -> StoreResult<CleanupJob> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO cleanup_jobs(
                id, task_id, repository_id, worktree_path, state, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
             ON CONFLICT(task_id, repository_id, worktree_path) DO NOTHING",
            params![
                job.id,
                job.task_id,
                job.repository_id,
                job.worktree_path,
                job.state.as_str(),
                job.created_at
            ],
        )?;
        Self::get_cleanup_job_for_target(
            &connection,
            &job.task_id,
            &job.repository_id,
            &job.worktree_path,
        )?
        .ok_or_else(|| ManagementStoreError::NotFound(format!("cleanup job {}", job.id)))
    }

    pub fn update_cleanup_job(&self, job: &CleanupJob) -> StoreResult<CleanupJob> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE cleanup_jobs SET state = ?2, attempts = ?3, last_attempt_at = ?4,
                    next_attempt_at = ?5, deferral_reason = ?6, failure_detail = ?7, updated_at = ?8
             WHERE id = ?1",
            params![
                job.id,
                job.state.as_str(),
                job.attempts,
                job.last_attempt_at,
                job.next_attempt_at,
                job.deferral_reason,
                job.failure_detail,
                job.updated_at
            ],
        )?;
        if changed == 0 {
            return Err(ManagementStoreError::NotFound(format!(
                "cleanup job {}",
                job.id
            )));
        }
        Self::get_cleanup_job_from(&connection, &job.id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("cleanup job {}", job.id)))
    }

    pub fn get_cleanup_job(&self, id: &str) -> StoreResult<Option<CleanupJob>> {
        let connection = self.lock()?;
        Self::get_cleanup_job_from(&connection, id).map_err(Into::into)
    }

    fn get_cleanup_job_from(
        connection: &Connection,
        id: &str,
    ) -> rusqlite::Result<Option<CleanupJob>> {
        connection
            .query_row(
                "SELECT id, task_id, repository_id, worktree_path, state, attempts, last_attempt_at,
                        next_attempt_at, deferral_reason, failure_detail, created_at, updated_at
                 FROM cleanup_jobs WHERE id = ?1",
                [id],
                cleanup_job_from_row,
            )
            .optional()
    }

    fn get_cleanup_job_for_target(
        connection: &Connection,
        task_id: &str,
        repository_id: &str,
        worktree_path: &str,
    ) -> rusqlite::Result<Option<CleanupJob>> {
        connection
            .query_row(
                "SELECT id, task_id, repository_id, worktree_path, state, attempts, last_attempt_at,
                        next_attempt_at, deferral_reason, failure_detail, created_at, updated_at
                 FROM cleanup_jobs WHERE task_id = ?1 AND repository_id = ?2 AND worktree_path = ?3",
                params![task_id, repository_id, worktree_path],
                cleanup_job_from_row,
            )
            .optional()
    }

    pub fn list_cleanup_jobs(&self, task_id: &str) -> StoreResult<Vec<CleanupJob>> {
        self.recover_stale_cleanup_jobs(now_millis_for_cleanup())?;
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT id, task_id, repository_id, worktree_path, state, attempts, last_attempt_at,
                    next_attempt_at, deferral_reason, failure_detail, created_at, updated_at
             FROM cleanup_jobs WHERE task_id = ?1 ORDER BY created_at, id",
        )?;
        let rows = statement.query_map([task_id], cleanup_job_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn list_pending_cleanup_jobs(&self, now: i64) -> StoreResult<Vec<CleanupJob>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare("SELECT id, task_id, repository_id, worktree_path, state, attempts, last_attempt_at, next_attempt_at, deferral_reason, failure_detail, created_at, updated_at FROM cleanup_jobs WHERE state IN ('queued','deferred','failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ?1) ORDER BY created_at, id")?;
        let rows = statement.query_map([now], cleanup_job_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// A process can die after claiming a job and before recording its result.
    /// Recovery only makes the job retryable; it never removes the worktree.
    pub fn recover_stale_cleanup_jobs(&self, now: i64) -> StoreResult<usize> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE cleanup_jobs
             SET state = 'queued', attempts = attempts + 1, next_attempt_at = NULL,
                 deferral_reason = 'recovered after cleanup worker restart; retrying',
                 failure_detail = NULL, updated_at = ?1
             WHERE state = 'running' AND
                   (last_attempt_at IS NULL OR last_attempt_at <= ?2)",
            params![now, now - CLEANUP_RUNNING_STALE_AFTER_MS],
        )?;
        Ok(changed)
    }

    /// Startup owns the recovery boundary, so even a claim made moments
    /// before a crash is safe to requeue. Listing uses the stale-only variant
    /// to avoid stealing a claim from a live worker between its two writes.
    pub fn recover_running_cleanup_jobs(&self, now: i64) -> StoreResult<usize> {
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE cleanup_jobs
             SET state = 'queued', attempts = attempts + 1, next_attempt_at = NULL,
                 deferral_reason = 'recovered after cleanup worker restart; retrying',
                 failure_detail = NULL, updated_at = ?1
             WHERE state = 'running'",
            [now],
        )?;
        Ok(changed)
    }

    /// Executes the same guarded removal path used by the background worker.
    /// The running claim is persisted before any Git operation, so an
    /// interrupted process is recoverable on the next startup.
    pub fn execute_cleanup_job(
        &self,
        job_id: &str,
        runtime_active_directories: &[PathBuf],
        now: i64,
    ) -> StoreResult<CleanupJob> {
        let mut job = self
            .get_cleanup_job(job_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("cleanup job {job_id}")))?;
        if job.state == CleanupJobState::Removed {
            return Ok(job);
        }
        job.state = CleanupJobState::Running;
        job.attempts += 1;
        job.last_attempt_at = Some(now);
        job.next_attempt_at = None;
        job.deferral_reason = None;
        job.failure_detail = None;
        job.updated_at = now;
        self.update_cleanup_job(&job)?;

        let plan = self.plan_completed_task_cleanup(
            &job.task_id,
            &job.repository_id,
            runtime_active_directories,
        );
        let (state, reason, failure) = match plan {
            Ok(CleanupPlan::Removable {
                canonical_path,
                branch_retained,
            }) => {
                let result = self
                    .get_repository(&job.repository_id)
                    .map_err(|e| e.to_string())
                    .and_then(|repo| {
                        repo.ok_or_else(|| "repository catalog entry is missing".to_owned())
                    })
                    .and_then(|repo| {
                        safety::remove_clean_worktree(
                            Path::new(&repo.repository_path),
                            Path::new(&canonical_path),
                            &branch_retained,
                        )
                        .map_err(|e| e.to_string())
                    });
                match result {
                    Ok(()) => (CleanupJobState::Removed, None, None),
                    Err(error) => (CleanupJobState::Failed, None, Some(error)),
                }
            }
            Ok(CleanupPlan::Deferred { reason, .. }) => {
                (CleanupJobState::Deferred, Some(reason), None)
            }
            Ok(CleanupPlan::Retained { reason, .. }) => {
                (CleanupJobState::Retained, Some(reason), None)
            }
            Ok(CleanupPlan::Failed { reason }) => (CleanupJobState::Failed, None, Some(reason)),
            Err(error) => (CleanupJobState::Failed, None, Some(error.to_string())),
        };
        job.state = state;
        job.deferral_reason = reason;
        job.failure_detail = failure;
        job.next_attempt_at =
            if matches!(state, CleanupJobState::Deferred | CleanupJobState::Failed) {
                Some(now + 5_000)
            } else {
                None
            };
        job.updated_at = now;
        self.update_cleanup_job(&job)
    }

    pub fn retry_cleanup_jobs(&self, task_id: &str, now: i64) -> StoreResult<Vec<CleanupJob>> {
        let connection = self.lock()?;
        connection.execute("UPDATE cleanup_jobs SET state='queued', next_attempt_at=NULL, deferral_reason=NULL, failure_detail=NULL, updated_at=?2 WHERE task_id=?1 AND state <> 'removed'", params![task_id, now])?;
        drop(connection);
        self.list_cleanup_jobs(task_id)
    }

    /// Plans one completed task binding. Runtime-observed session directories
    /// supplement persisted statuses; both sources defer rather than infer that
    /// an uncertain session is idle.
    pub fn plan_completed_task_cleanup(
        &self,
        task_id: &str,
        repository_id: &str,
        runtime_active_directories: &[PathBuf],
    ) -> StoreResult<CleanupPlan> {
        let connection = self.lock()?;
        let Some(task) = Self::get_task_from(&connection, task_id)? else {
            return Ok(CleanupPlan::Failed {
                reason: format!("task {task_id} is missing"),
            });
        };
        if task.status != TaskStatus::Completed {
            return Ok(CleanupPlan::Failed {
                reason: format!("task {task_id} is not completed"),
            });
        }
        let Some(binding) = connection
            .query_row(
                "SELECT task_id, repository_id, branch, worktree_path, setup_status,
                        error_code, error_detail, created_at, updated_at
                 FROM task_repositories WHERE task_id = ?1 AND repository_id = ?2",
                params![task_id, repository_id],
                |row| {
                    Ok(TaskRepositoryBinding {
                        task_id: row.get(0)?,
                        repository_id: row.get(1)?,
                        branch: row.get(2)?,
                        worktree_path: row.get(3)?,
                        setup_status: row.get(4)?,
                        error_code: row.get(5)?,
                        error_detail: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                    })
                },
            )
            .optional()?
        else {
            return Ok(CleanupPlan::Failed {
                reason: format!("task {task_id} has no binding for repository {repository_id}"),
            });
        };
        if binding.setup_status != RepositorySetupStatus::Ready {
            return Ok(CleanupPlan::Failed {
                reason: "worktree binding is not in the ready state".into(),
            });
        }
        let Some(repository) = Self::get_repository_from(&connection, repository_id)? else {
            return Ok(CleanupPlan::Failed {
                reason: format!("repository catalog entry {repository_id} is missing"),
            });
        };
        let Some(workspace) = Self::get_workspace_from(&connection, &task.workspace_id)? else {
            return Ok(CleanupPlan::Failed {
                reason: format!("workspace {} is missing", task.workspace_id),
            });
        };
        if workspace.kind != WorkspaceKind::Regular {
            return Ok(CleanupPlan::Failed {
                reason: "Quick Request tasks do not own individual worktrees".into(),
            });
        }
        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root =
            match safety::resolve_project_home_root(&configured_root, &self.user_home) {
                Ok(root) => root,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        let expected_workspace_home = project_root.join(&workspace.slug);
        let canonical_workspace_home =
            match safety::canonical_descendant(&project_root, &expected_workspace_home) {
                Ok(path) => path,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if canonical_workspace_home != expected_workspace_home {
            return Ok(CleanupPlan::Failed {
                reason: "workspace home resolves through a symlink instead of its owner path"
                    .into(),
            });
        }
        let persisted_workspace_home =
            match safety::canonicalize_or_resolve_missing(Path::new(&workspace.home_path)) {
                Ok(path) => path,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if canonical_workspace_home != persisted_workspace_home {
            return Ok(CleanupPlan::Failed {
                reason: "persisted workspace home does not match configured ownership".into(),
            });
        }
        let expected_task_home = canonical_workspace_home.join("tasks").join(&task.slug);
        let canonical_task_home =
            match safety::canonical_descendant(&project_root, &expected_task_home) {
                Ok(path) => path,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if canonical_task_home != expected_task_home {
            return Ok(CleanupPlan::Failed {
                reason: "task home resolves through a symlink instead of its owner path".into(),
            });
        }
        let persisted_task_home =
            match safety::canonicalize_or_resolve_missing(Path::new(&task.home_path)) {
                Ok(path) => path,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if canonical_task_home != persisted_task_home {
            return Ok(CleanupPlan::Failed {
                reason: "persisted task home does not match workspace ownership".into(),
            });
        }
        let worktrees_root = match checked_task_worktrees_root(&canonical_task_home) {
            Ok(path) => path,
            Err(error) => {
                return Ok(CleanupPlan::Failed {
                    reason: error.to_string(),
                })
            }
        };
        let canonical_worktree = match safety::canonical_descendant(
            &worktrees_root,
            Path::new(&binding.worktree_path),
        ) {
            Ok(path) => path,
            Err(error) => {
                return Ok(CleanupPlan::Failed {
                    reason: error.to_string(),
                })
            }
        };
        if !canonical_worktree.is_dir() {
            return Ok(CleanupPlan::Failed {
                reason: format!("worktree {} is missing", canonical_worktree.display()),
            });
        }
        if canonical_worktree == worktrees_root {
            return Ok(CleanupPlan::Failed {
                reason: "recorded path is the worktrees container, not a worktree".into(),
            });
        }
        let catalog_inspection =
            match safety::inspect_repository(Path::new(&repository.repository_path)) {
                Ok(inspection) => inspection,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if let Err(error) = verify_catalog_identity(&repository, &catalog_inspection.repository) {
            return Ok(CleanupPlan::Failed {
                reason: error.to_string(),
            });
        }
        let worktree_inspection = match safety::inspect_repository(&canonical_worktree) {
            Ok(inspection) => inspection,
            Err(error) => {
                return Ok(CleanupPlan::Failed {
                    reason: error.to_string(),
                })
            }
        };
        if worktree_inspection.repository.identity != repository.repository_identity {
            return Ok(CleanupPlan::Failed {
                reason: format!(
                    "worktree repository identity {} does not match catalog identity {}",
                    worktree_inspection.repository.identity, repository.repository_identity
                ),
            });
        }
        let branch =
            match safety::inspect_branch(Path::new(&repository.repository_path), &binding.branch) {
                Ok(branch) => branch,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if !branch.valid
            || !branch.exists
            || branch.owning_worktrees != [canonical_worktree.clone()]
        {
            return Ok(CleanupPlan::Failed {
                reason: format!(
                    "branch {} is missing or has ambiguous worktree ownership: {:?}",
                    binding.branch, branch.owning_worktrees
                ),
            });
        }
        let Some(worktree_state) = catalog_inspection
            .worktrees
            .iter()
            .find(|worktree| worktree.canonical_path == canonical_worktree)
        else {
            return Ok(CleanupPlan::Failed {
                reason: "Git does not register the recorded worktree path".into(),
            });
        };
        if worktree_state.branch.as_deref() != Some(binding.branch.as_str()) {
            return Ok(CleanupPlan::Failed {
                reason: "recorded branch does not match Git worktree ownership".into(),
            });
        }
        if worktree_state.prunable || worktree_state.clean.is_none() {
            return Ok(CleanupPlan::Failed {
                reason: "Git worktree state is missing or ambiguous".into(),
            });
        }

        let mut statement = connection
            .prepare("SELECT last_known_status FROM sessions WHERE owner_task_id = ?1")?;
        let sessions = statement
            .query_map([task_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let persisted_active_session = sessions.into_iter().any(|status| {
            let possibly_active = !matches!(
                status.as_str(),
                "completed" | "failed" | "stopped" | "exited"
            );
            // A task session starts in the task home and may access any of its
            // worktrees. Until a runtime proves it stopped, conservatively defer
            // every cleanup target for that task.
            possibly_active
        });
        let mut runtime_paths = Vec::with_capacity(runtime_active_directories.len());
        for directory in runtime_active_directories {
            match safety::canonicalize_or_resolve_missing(directory) {
                Ok(path) => runtime_paths.push(path),
                Err(error) => {
                    return Ok(CleanupPlan::Deferred {
                        canonical_path: path_to_string(&canonical_worktree)?,
                        reason: format!(
                            "runtime-active directory {} cannot be canonicalized; session activity is uncertain: {error}",
                            directory.display()
                        ),
                    });
                }
            }
        }
        let mut statement = connection.prepare(
            "SELECT worktree_path FROM task_repositories
             WHERE task_id = ?1 AND setup_status = 'ready'",
        )?;
        let registered_worktree_paths = statement
            .query_map([task_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let registered_worktree_paths = registered_worktree_paths
            .iter()
            .filter_map(|path| safety::canonicalize_or_resolve_missing(Path::new(path)).ok())
            .filter(|path| {
                path.starts_with(&canonical_task_home)
                    && path.parent() == Some(worktrees_root.as_path())
            })
            .collect::<Vec<_>>();
        let runtime_task_scope_in_use = runtime_paths.iter().any(|path| {
            path == &canonical_task_home
                || (path.starts_with(&canonical_task_home)
                    && !registered_worktree_paths
                        .iter()
                        .any(|worktree| worktree == path))
        });
        let runtime_worktree_in_use = runtime_paths.iter().any(|path| path == &canonical_worktree);
        let canonical_path = path_to_string(&canonical_worktree)?;
        if persisted_active_session || runtime_task_scope_in_use || runtime_worktree_in_use {
            return Ok(CleanupPlan::Deferred {
                canonical_path,
                reason: "an active or uncertain session uses this task or worktree".into(),
            });
        }
        if worktree_state.clean != Some(true) {
            let details = if worktree_state.status_entries.is_empty() {
                "Git reports the worktree as dirty".to_owned()
            } else {
                format!(
                    "dirty or untracked files: {}",
                    worktree_state.status_entries.join(", ")
                )
            };
            return Ok(CleanupPlan::Retained {
                canonical_path: Some(canonical_path),
                reason: details,
            });
        }
        Ok(CleanupPlan::Removable {
            canonical_path,
            branch_retained: binding.branch,
        })
    }

    pub fn get_setting(&self, key: &str) -> StoreResult<Option<Setting>> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT key, value, updated_at FROM settings WHERE key = ?1",
                [key],
                |row| {
                    Ok(Setting {
                        key: row.get(0)?,
                        value: row.get(1)?,
                        updated_at: row.get(2)?,
                    })
                },
            )
            .optional()
            .map_err(Into::into)
    }

    pub fn set_setting(&self, key: &str, value: &str, updated_at: i64) -> StoreResult<Setting> {
        if key == "project_home_root" {
            // Resolve against the injected canonical home without creating the
            // candidate root. Do this before writing so every API path enforces
            // the same containment rule and rejected values are atomic.
            safety::resolve_project_home_root(value, &self.user_home)?;
        }
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO settings(key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, updated_at],
        )?;
        drop(connection);
        if key == "project_home_root" {
            let connection = self.lock()?;
            Self::sync_quick_requests_home(&connection, &self.user_home)?;
        }
        self.get_setting(key)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("setting {key} after update")))
    }

    /// Returns the validated configured setting verbatim.
    pub fn project_home_root(&self) -> StoreResult<String> {
        let connection = self.lock()?;
        Self::project_home_root_from(&connection)
    }

    pub fn set_project_home_root(&self, value: &str, updated_at: i64) -> StoreResult<String> {
        self.set_setting("project_home_root", value, updated_at)?;
        Ok(value.to_owned())
    }

    fn project_home_root_from(connection: &Connection) -> StoreResult<String> {
        connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'project_home_root'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.unwrap_or_else(|| DEFAULT_PROJECT_HOME_ROOT.to_owned()))
            .map_err(Into::into)
    }

    fn task_home_path_from(
        &self,
        connection: &Connection,
        task: &NewTask,
        is_quick_request: bool,
    ) -> StoreResult<PathBuf> {
        safety::validate_name(&task.name)?;
        safety::validate_slug(&task.slug)?;
        let workspace =
            Self::get_workspace_from(connection, &task.workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {}", task.workspace_id))
            })?;

        if workspace.kind == WorkspaceKind::QuickRequests {
            if !is_quick_request {
                return Err(ManagementStoreError::InvalidTransition(
                    "Quick Requests workspace only accepts Quick Request tasks".into(),
                ));
            }
            let shared = safety::canonicalize_or_resolve_missing(
                &Self::quick_requests_directory_from(connection, &self.user_home)?,
            )?;
            let persisted =
                safety::canonicalize_or_resolve_missing(Path::new(&workspace.home_path))?;
            if shared != persisted {
                return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                    "Quick Requests workspace path is not the shared project directory".into(),
                )));
            }
            Ok(shared)
        } else {
            if is_quick_request {
                return Err(ManagementStoreError::InvalidTransition(
                    "Quick Request tasks must belong to the Quick Requests workspace".into(),
                ));
            }
            let configured_root = Self::project_home_root_from(connection)?;
            let project_root =
                safety::resolve_project_home_root(&configured_root, &self.user_home)?;
            let expected_workspace_home = project_root.join(&workspace.slug);
            let workspace_home =
                safety::canonical_descendant(&project_root, &expected_workspace_home)?;
            if workspace_home != expected_workspace_home {
                return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                    "workspace home resolves through a symlink instead of its owner path".into(),
                )));
            }
            let persisted_workspace_home =
                safety::canonicalize_or_resolve_missing(Path::new(&workspace.home_path))?;
            if workspace_home != persisted_workspace_home {
                return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                    "workspace home is outside the current configured project root".into(),
                )));
            }
            Ok(workspace_home.join("tasks").join(&task.slug))
        }
    }

    fn prepare_task_home(
        &self,
        connection: &Connection,
        task: &NewTask,
        is_quick_request: bool,
    ) -> StoreResult<(PathBuf, Option<ManagedHomeGuard>)> {
        let path = self.task_home_path_from(connection, task, is_quick_request)?;
        let workspace =
            Self::get_workspace_from(connection, &task.workspace_id)?.ok_or_else(|| {
                ManagementStoreError::NotFound(format!("workspace {}", task.workspace_id))
            })?;
        if workspace.kind == WorkspaceKind::QuickRequests {
            return Ok((path, None));
        }
        let configured_root = Self::project_home_root_from(connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let (home, guard) = safety::ensure_regular_task_home(
            &self.user_home,
            &project_root,
            &workspace.slug,
            &task.slug,
            &task.id,
        )?;
        if home != safety::canonicalize_or_resolve_missing(&path)? {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "created task home does not match its resolved owner path".into(),
            )));
        }
        Ok((home, Some(guard)))
    }

    pub fn suggest_workspace_slug(&self, name: &str) -> StoreResult<String> {
        let base = safety::slugify_name(name)?;
        let connection = self.lock()?;
        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let mut statement = connection.prepare("SELECT slug FROM workspaces")?;
        let used = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(safety::unique_slug(&base, |candidate| {
            used.iter().any(|slug| slug == candidate)
                || project_root.join(candidate).exists()
                || fs::symlink_metadata(project_root.join(candidate)).is_ok()
        })?)
    }

    pub fn suggest_task_slug(&self, workspace_id: &str, name: &str) -> StoreResult<String> {
        let base = safety::slugify_name(name)?;
        let connection = self.lock()?;
        let workspace = Self::get_workspace_from(&connection, workspace_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {workspace_id}")))?;
        let mut statement = connection.prepare("SELECT slug FROM tasks WHERE workspace_id = ?1")?;
        let used = statement
            .query_map([workspace_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        if workspace.kind == WorkspaceKind::QuickRequests {
            return Ok(safety::unique_slug(&base, |candidate| {
                used.iter().any(|slug| slug == candidate)
            })?);
        }
        let configured_root = Self::project_home_root_from(&connection)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        let workspace_home = project_root.join(&workspace.slug);
        Ok(safety::unique_slug(&base, |candidate| {
            used.iter().any(|slug| slug == candidate)
                || fs::symlink_metadata(workspace_home.join("tasks").join(candidate)).is_ok()
        })?)
    }
}

/// Resolves and validates the configured project home without creating it.
pub fn resolve_project_home_root(configured_root: &str, user_home: &Path) -> StoreResult<PathBuf> {
    safety::resolve_project_home_root(configured_root, user_home).map_err(Into::into)
}

/// Resolves a regular workspace home without touching the filesystem.
pub fn regular_workspace_home(
    project_home_root: &Path,
    workspace_slug: &str,
) -> StoreResult<PathBuf> {
    safety::validate_slug(workspace_slug)?;
    safety::canonical_descendant(project_home_root, &project_home_root.join(workspace_slug))
        .map_err(Into::into)
}

/// Resolves a regular task home without touching the filesystem.
pub fn regular_task_home(workspace_home: &Path, task_slug: &str) -> StoreResult<PathBuf> {
    safety::validate_slug(task_slug)?;
    safety::canonical_descendant(
        workspace_home,
        &workspace_home.join("tasks").join(task_slug),
    )
    .map_err(Into::into)
}

/// Returns the special shared folder under the configured OpenCode Projects root.
pub fn quick_requests_directory(project_home_root: &Path) -> PathBuf {
    project_home_root.join("Quick Requests")
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    let quick_request_created_at: Option<i64> = row.get(10)?;
    let quick_request = quick_request_created_at
        .map(|created_at| {
            Ok::<_, rusqlite::Error>(QuickRequestLifecycle {
                created_at,
                dismissed_at: row.get(11)?,
                expires_at: row.get(12)?,
                expired_at: row.get(13)?,
                promoted_at: row.get(14)?,
            })
        })
        .transpose()?;
    Ok(Task {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        slug: row.get(3)?,
        description: row.get(4)?,
        home_path: row.get(5)?,
        status: row.get(6)?,
        setup_status: row.get(7)?,
        created_at: row.get(8)?,
        completed_at: row.get(9)?,
        quick_request,
        setup_operation_id: row.get(15)?,
        setup_session_id: row.get(16)?,
        setup_cancelled_at: row.get(17)?,
        setup_cancellation_detail: row.get(18)?,
    })
}

fn repository_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Repository> {
    Ok(Repository {
        id: row.get(0)?,
        name: row.get(1)?,
        repository_path: row.get(2)?,
        repository_identity: row.get(3)?,
        purpose: row.get(4)?,
        purpose_status: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn cleanup_job_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<CleanupJob> {
    Ok(CleanupJob {
        id: row.get(0)?,
        task_id: row.get(1)?,
        repository_id: row.get(2)?,
        worktree_path: row.get(3)?,
        state: row.get(4)?,
        attempts: row.get(5)?,
        last_attempt_at: row.get(6)?,
        next_attempt_at: row.get(7)?,
        deferral_reason: row.get(8)?,
        failure_detail: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn management_now_millis() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn path_to_string(path: &Path) -> StoreResult<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        ManagementStoreError::Safety(SafetyError::InvalidPath(format!(
            "path {} is not valid Unicode and cannot be persisted safely",
            path.display()
        )))
    })
}

fn checked_task_worktrees_root(task_home: &Path) -> StoreResult<PathBuf> {
    checked_managed_child_directory(task_home, "worktrees")
}

fn checked_managed_child_directory(parent: &Path, child: &str) -> StoreResult<PathBuf> {
    safety::validate_slug(child)?;
    let expected = parent.join(child);
    let metadata = fs::symlink_metadata(&expected).map_err(|error| {
        ManagementStoreError::Safety(SafetyError::InvalidPath(format!(
            "managed directory {} is unavailable: {error}",
            expected.display()
        )))
    })?;
    if !metadata.file_type().is_dir() {
        return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
            format!(
                "managed directory {} must be a real directory, not a symlink",
                expected.display()
            ),
        )));
    }
    let canonical = fs::canonicalize(&expected)?;
    if canonical != expected {
        return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
            format!(
                "managed directory {} is not at its canonical owner path",
                expected.display()
            ),
        )));
    }
    Ok(canonical)
}

fn verify_catalog_identity(
    catalog: &Repository,
    actual: &safety::GitRepositoryInfo,
) -> StoreResult<()> {
    let catalog_path =
        safety::canonicalize_or_resolve_missing(Path::new(&catalog.repository_path))?;
    if catalog_path != actual.canonical_root || catalog.repository_identity != actual.identity {
        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
            format!(
                "catalog {} expects path {} and identity {}; Git reports path {} and identity {}",
                catalog.id,
                catalog_path.display(),
                catalog.repository_identity,
                actual.canonical_root.display(),
                actual.identity
            ),
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::{Command, Output};
    use tempfile::tempdir;

    const CREATED: i64 = 1_700_000_000_000;

    fn workspace(id: &str, slug: &str) -> NewWorkspace {
        NewWorkspace {
            id: id.to_owned(),
            name: format!("Workspace {id}"),
            slug: slug.to_owned(),
            description: Some("A test workspace".to_owned()),
            kind: WorkspaceKind::Regular,
            created_at: CREATED,
        }
    }

    fn quick_workspace() -> NewWorkspace {
        NewWorkspace {
            id: "w-quick".into(),
            name: "Quick Requests".into(),
            slug: "quick-requests".into(),
            description: None,
            kind: WorkspaceKind::QuickRequests,
            created_at: CREATED,
        }
    }

    fn task(id: &str, workspace_id: &str, slug: &str) -> NewTask {
        NewTask {
            id: id.to_owned(),
            workspace_id: workspace_id.to_owned(),
            name: format!("Task {id}"),
            slug: slug.to_owned(),
            description: Some("A test task".to_owned()),
            setup_status: TaskSetupStatus::Ready,
            created_at: CREATED + 1,
        }
    }

    #[test]
    fn setup_repository_selection_is_durable_and_immutable() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-selection", "selection"))
            .unwrap();
        let mut new_task = task("t-selection", "w-selection", "selection-task");
        new_task.setup_status = TaskSetupStatus::NotStarted;
        let task_record = store.create_task(&new_task).unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-selection".into(),
                owner: SessionOwner::Task(task_record.id.clone()),
                directory: task_record.home_path,
                last_known_status: "starting".into(),
                created_at: CREATED + 2,
            })
            .unwrap();
        store
            .bind_task_setup_operation("t-selection", "op-selection", "ses-selection")
            .unwrap();

        assert_eq!(
            store
                .task_setup_repository_selection("op-selection")
                .unwrap(),
            None
        );
        let selection = vec!["repo-1".to_owned(), "repo-2".to_owned()];
        store
            .save_task_setup_repository_selection("op-selection", &selection)
            .unwrap();
        assert_eq!(
            store
                .task_setup_repository_selection("op-selection")
                .unwrap(),
            Some(selection.clone())
        );
        store
            .save_task_setup_repository_selection("op-selection", &selection)
            .unwrap();
        store
            .update_session_status("ses-selection", "failed", CREATED + 3)
            .unwrap();
        assert!(store
            .save_task_setup_repository_selection("op-selection", &["repo-3".to_owned()])
            .is_err());
        store.rollback_new_task("t-selection").unwrap();
    }

    #[test]
    fn schema_migration_removes_legacy_starting_prompt_storage() {
        let directory = tempdir().unwrap();
        let user_home = directory.path().join("home");
        let system_temp = directory.path().join("system-temp");
        fs::create_dir_all(&user_home).unwrap();
        fs::create_dir_all(&system_temp).unwrap();
        let database = directory.path().join("management.sqlite");
        drop(ManagementStore::open_with_paths(&database, &user_home, &system_temp).unwrap());
        {
            let legacy = Connection::open(&database).unwrap();
            legacy
                .execute_batch(
                    "ALTER TABLE setup_operation_state ADD COLUMN starting_prompt TEXT;
                     CREATE TABLE workspace_starting_prompts (
                         session_id TEXT PRIMARY KEY NOT NULL,
                         prompt TEXT NOT NULL
                     );
                      INSERT INTO workspace_starting_prompts(session_id, prompt)
                          VALUES ('legacy-session', 'legacy prompt to remove');
                      DROP TABLE quick_request_prompts;
                      DELETE FROM schema_migrations WHERE version >= 10;",
                )
                .unwrap();
        }
        let migrated =
            ManagementStore::open_with_paths(&database, &user_home, &system_temp).unwrap();
        assert_eq!(migrated.migration_versions().unwrap().last(), Some(&13));
        let connection = migrated.lock().unwrap();
        let legacy_table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workspace_starting_prompts'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy_table_count, 0);
        let columns = connection
            .prepare("PRAGMA table_info(setup_operation_state)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!columns.iter().any(|name| name == "starting_prompt"));
    }

    #[test]
    fn quick_request_prompt_is_saved_separately_and_returned_with_list_records() {
        let fixture = tempdir().unwrap();
        let system_temp = fixture.path().join("system-temp");
        let store =
            ManagementStore::in_memory_with_paths(fixture.path().join("home"), system_temp.clone())
                .unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        store
            .create_workspace(&workspace("w-regular", "regular"))
            .unwrap();

        let original_prompt = "  What's 2 + 2?\n ";
        let mut new_task = task("qr-prompt", "w-quick", "quick-prompt");
        new_task.description = Some("must not remain in task description".into());
        let session = NewSession {
            open_code_session_id: "ses-quick-prompt".into(),
            owner: SessionOwner::Task(new_task.id.clone()),
            directory: quick_requests_directory(&fixture.path().join("home/OpenCode Projects"))
                .to_string_lossy()
                .into_owned(),
            last_known_status: "starting".into(),
            created_at: CREATED + 2,
        };
        let created = store
            .create_quick_request_with_session_and_model(
                &new_task,
                &session,
                "openai/gpt-6-luna",
                original_prompt,
            )
            .unwrap();

        assert_eq!(created.prompt.as_deref(), Some(original_prompt));
        assert_eq!(created.task.description, None);
        assert_eq!(
            store.quick_request_prompt("qr-prompt").unwrap().as_deref(),
            Some(original_prompt)
        );
        let listed = store.list_quick_requests(true).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].prompt.as_deref(), Some(original_prompt));

        let regular_task = store
            .create_task(&task("regular-task", "w-regular", "regular-task"))
            .unwrap();
        let connection = store.lock().unwrap();
        assert!(connection
            .execute(
                "INSERT INTO quick_request_prompts(task_id, original_prompt) VALUES (?1, ?2)",
                params![regular_task.id, "not a Quick Request"],
            )
            .is_err());
    }

    #[test]
    fn recent_quick_requests_use_creation_age_while_history_keeps_all_lifecycles() {
        let fixture = tempdir().unwrap();
        let store = ManagementStore::in_memory_with_paths(
            fixture.path().join("home"),
            fixture.path().join("tmp"),
        )
        .unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        let now = now_millis_for_cleanup();
        let mut recent = task("qr-recent", "w-quick", "recent");
        recent.created_at = now;
        let mut old = task("qr-old", "w-quick", "old");
        old.created_at = now - QUICK_REQUEST_LIFETIME_MS - 1;
        store
            .create_quick_request(&recent, "recent prompt")
            .unwrap();
        store.create_quick_request(&old, "old prompt").unwrap();
        assert_eq!(store.list_quick_requests(false).unwrap().len(), 1);
        store.dismiss_quick_request("qr-recent", now + 1).unwrap();

        let recent_list = store.list_quick_requests(false).unwrap();
        assert!(
            recent_list.is_empty(),
            "dismissal removes the item from recent navigation"
        );
        let history = store.list_quick_requests(true).unwrap();
        assert_eq!(history.len(), 2);
        assert!(history.iter().any(|record| record.task.id == "qr-recent"));
        assert!(history.iter().any(|record| record.task.id == "qr-old"));
    }

    #[test]
    fn quick_request_delete_removes_only_its_local_record_and_prompt() {
        let fixture = tempdir().unwrap();
        let store = ManagementStore::in_memory_with_paths(
            fixture.path().join("home"),
            fixture.path().join("tmp"),
        )
        .unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        store
            .create_quick_request(&task("qr-delete", "w-quick", "delete-me"), "original")
            .unwrap();
        store
            .create_workspace(&workspace("w-regular", "regular"))
            .unwrap();
        store
            .create_task(&task("regular-task", "w-regular", "keep-me"))
            .unwrap();

        store.delete_quick_request("qr-delete").unwrap();
        assert!(store.get_task("qr-delete").unwrap().is_none());
        assert!(store.quick_request_prompt("qr-delete").unwrap().is_none());
        assert!(store.list_quick_requests(true).unwrap().is_empty());
        assert_eq!(
            store.get_task("regular-task").unwrap().unwrap().id,
            "regular-task"
        );
        assert!(store.delete_quick_request("regular-task").is_err());
        assert_eq!(
            store.get_task("regular-task").unwrap().unwrap().id,
            "regular-task"
        );
    }

    #[test]
    fn quick_request_directory_resolves_only_registered_repositories_or_shared_default() {
        let fixture = tempdir().unwrap();
        let repository_path = fixture.path().join("registered-repo");
        fs::create_dir_all(&repository_path).unwrap();
        let system_temp = fixture.path().join("system-temp");
        let store =
            ManagementStore::in_memory_with_paths(fixture.path().join("home"), system_temp.clone())
                .unwrap();
        store
            .create_repository(&NewRepository {
                id: "repo-1".into(),
                name: "Registered repository".into(),
                repository_path: repository_path.to_string_lossy().into_owned(),
                repository_identity: "git-identity-1".into(),
                purpose: None,
                purpose_status: PurposeStatus::Available,
                created_at: 1,
            })
            .unwrap();

        assert_eq!(
            store.quick_request_directory(Some("repo-1")).unwrap(),
            std::fs::canonicalize(repository_path).unwrap()
        );
        assert_eq!(
            store.quick_request_directory(None).unwrap(),
            quick_requests_directory(&fixture.path().join("home/OpenCode Projects"))
        );
        assert!(store.quick_request_directory(Some("unregistered")).is_err());
    }

    #[test]
    fn quick_request_prompt_migration_moves_legacy_task_descriptions() {
        let fixture = tempdir().unwrap();
        let user_home = fixture.path().join("home");
        let system_temp = fixture.path().join("system-temp");
        fs::create_dir_all(&user_home).unwrap();
        fs::create_dir_all(&system_temp).unwrap();
        let database = fixture.path().join("management.sqlite");
        let store = ManagementStore::open_with_paths(&database, &user_home, &system_temp).unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        store
            .create_workspace(&workspace("w-regular", "regular"))
            .unwrap();
        store
            .create_quick_request(&task("qr-legacy-prompt", "w-quick", "legacy"), "temporary")
            .unwrap();
        store
            .create_task(&task(
                "regular-with-description",
                "w-regular",
                "regular-task",
            ))
            .unwrap();
        drop(store);

        {
            let legacy = Connection::open(&database).unwrap();
            legacy
                .execute_batch(
                    "UPDATE tasks SET description = 'legacy Quick Request prompt', name = 'Quick Request: legacy Quick Request prompt' WHERE id = 'qr-legacy-prompt';
                     DELETE FROM quick_request_prompts WHERE task_id = 'qr-legacy-prompt';
                     DROP TABLE quick_request_prompts;
                     DELETE FROM schema_migrations WHERE version IN (11, 12, 13);",
                )
                .unwrap();
        }

        let migrated =
            ManagementStore::open_with_paths(&database, &user_home, &system_temp).unwrap();
        assert_eq!(migrated.migration_versions().unwrap().last(), Some(&13));
        assert_eq!(
            migrated
                .quick_request_prompt("qr-legacy-prompt")
                .unwrap()
                .as_deref(),
            Some("legacy Quick Request prompt")
        );
        assert_eq!(
            migrated
                .get_task("qr-legacy-prompt")
                .unwrap()
                .unwrap()
                .description,
            None
        );
        assert_eq!(
            migrated.get_task("qr-legacy-prompt").unwrap().unwrap().name,
            "Quick Request"
        );
        assert_eq!(
            migrated
                .get_task("regular-with-description")
                .unwrap()
                .unwrap()
                .description
                .as_deref(),
            Some("A test task")
        );
    }

    fn repository(id: &str) -> NewRepository {
        NewRepository {
            id: id.to_owned(),
            name: format!("Repository {id}"),
            repository_path: format!("/fixtures/repos/{id}"),
            repository_identity: format!("git-identity-{id}"),
            purpose: Some("Fixture repository".to_owned()),
            purpose_status: PurposeStatus::Available,
            created_at: CREATED,
        }
    }

    fn task_binding(task_id: &str, repository_id: &str) -> TaskRepositoryBinding {
        TaskRepositoryBinding {
            task_id: task_id.to_owned(),
            repository_id: repository_id.to_owned(),
            branch: format!("work/{task_id}"),
            worktree_path: format!("/fixtures/worktrees/{task_id}"),
            setup_status: RepositorySetupStatus::Ready,
            error_code: None,
            error_detail: None,
            created_at: CREATED,
            updated_at: CREATED + 1,
        }
    }

    #[test]
    fn workspace_context_keeps_home_and_verified_main_checkouts_only() {
        let home = PathBuf::from("/projects/alpha");
        let verified = WorkspaceRepositoryBinding {
            workspace_id: "w".into(),
            repository_id: "r1".into(),
            checkout_path: "/src/one".into(),
            checkout_mode: CheckoutMode::Existing,
            branch: "main".into(),
            verification_status: VerificationStatus::Verified,
            created_at: CREATED,
        };
        let failed = WorkspaceRepositoryBinding {
            repository_id: "r2".into(),
            checkout_path: "/tmp/task-worktree".into(),
            verification_status: VerificationStatus::Failed,
            ..verified.clone()
        };
        assert_eq!(
            resolve_workspace_context(&home, &[verified, failed]),
            vec![home, PathBuf::from("/src/one")]
        );
    }

    #[test]
    fn task_context_keeps_home_and_all_verified_worktrees_isolated() {
        let home = PathBuf::from("/projects/alpha/tasks/one");
        let first = task_binding("t", "r1");
        let second = TaskRepositoryBinding {
            worktree_path: "/fixtures/worktrees/t-two".into(),
            ..task_binding("t", "r2")
        };
        let failed = TaskRepositoryBinding {
            setup_status: RepositorySetupStatus::Failed,
            ..first.clone()
        };
        assert_eq!(
            resolve_task_context(&home, &[first, second, failed]),
            vec![
                home,
                PathBuf::from("/fixtures/worktrees/t"),
                PathBuf::from("/fixtures/worktrees/t-two")
            ]
        );
    }

    struct CleanupFixture {
        _directory: tempfile::TempDir,
        store: ManagementStore,
        repository_path: PathBuf,
        task_home: PathBuf,
        worktree_path: PathBuf,
        task_id: String,
    }

    fn git(path: &Path, arguments: &[&str]) -> Output {
        Command::new("git")
            .arg("-C")
            .arg(path)
            .args(arguments)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .output()
            .unwrap_or_else(|error| panic!("could not run git {arguments:?}: {error}"))
    }

    fn git_ok(path: &Path, arguments: &[&str]) -> Output {
        let output = git(path, arguments);
        assert!(
            output.status.success(),
            "git {arguments:?} failed in {}: {}",
            path.display(),
            String::from_utf8_lossy(&output.stderr)
        );
        output
    }

    fn cleanup_fixture(task_id: &str) -> CleanupFixture {
        let directory = tempdir().unwrap();
        let user_home = directory.path().join("user-home");
        let store =
            ManagementStore::in_memory_with_paths(&user_home, directory.path().join("system-temp"))
                .unwrap();
        store
            .create_workspace(&workspace("w-cleanup-fixture", "cleanup-fixture"))
            .unwrap();
        let task = store
            .create_task(&task(task_id, "w-cleanup-fixture", "cleanup-task"))
            .unwrap();

        let repository_path = directory.path().join("external/repository");
        fs::create_dir_all(&repository_path).unwrap();
        git_ok(
            &repository_path,
            &["init", "--quiet", "--initial-branch=main"],
        );
        fs::write(repository_path.join("README.md"), "cleanup fixture\n").unwrap();
        git_ok(&repository_path, &["add", "README.md"]);
        git_ok(
            &repository_path,
            &[
                "-c",
                "user.name=I-02 Fixture",
                "-c",
                "user.email=i02@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture base",
            ],
        );
        store
            .catalog_selected_repository(
                "repo-cleanup-fixture",
                "Cleanup fixture repository",
                &repository_path,
                None,
                CREATED,
            )
            .unwrap();

        let task_home = PathBuf::from(&task.home_path);
        let worktree_path = task_home.join("worktrees/repository");
        let branch = format!("work/{task_id}");
        git_ok(
            &repository_path,
            &[
                "worktree",
                "add",
                "--quiet",
                "-b",
                &branch,
                worktree_path.to_str().unwrap(),
            ],
        );
        store
            .validate_and_save_task_repository_binding(&TaskRepositoryBinding {
                task_id: task_id.to_owned(),
                repository_id: "repo-cleanup-fixture".into(),
                branch: branch.clone(),
                worktree_path: worktree_path.to_string_lossy().into_owned(),
                setup_status: RepositorySetupStatus::Ready,
                error_code: None,
                error_detail: None,
                created_at: CREATED + 2,
                updated_at: CREATED + 2,
            })
            .unwrap();

        CleanupFixture {
            _directory: directory,
            store,
            repository_path,
            task_home,
            worktree_path,
            task_id: task_id.to_owned(),
        }
    }

    #[test]
    fn fresh_database_migrates_and_an_existing_migrated_database_reopens() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("management.sqlite3");
        let user_home = directory.path().join("fixture-home");
        let system_temp = directory.path().join("fixture-temp");
        let configured_project_root = user_home.join("configured-project-home");
        let configured_project_root_text = configured_project_root.to_string_lossy().into_owned();
        let expected_task_home = user_home
            .join("OpenCode Projects")
            .join("first")
            .join("tasks")
            .join("first-task")
            .to_string_lossy()
            .into_owned();

        fs::create_dir_all(&user_home).unwrap();
        {
            let store =
                ManagementStore::open_with_paths(&path, user_home.clone(), system_temp.clone())
                    .unwrap();
            assert_eq!(
                store.migration_versions().unwrap(),
                vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
            );
            assert_eq!(
                store.project_home_root().unwrap(),
                DEFAULT_PROJECT_HOME_ROOT
            );
            store.create_workspace(&workspace("w-1", "first")).unwrap();
            store
                .create_task(&task("t-1", "w-1", "first-task"))
                .unwrap();
            store
                .create_session(&NewSession {
                    open_code_session_id: "ses-reopen-exact".into(),
                    owner: SessionOwner::Task("t-1".into()),
                    directory: expected_task_home.clone(),
                    last_known_status: "ready_for_review".into(),
                    created_at: CREATED + 2,
                })
                .unwrap();
            store
                .set_project_home_root(&configured_project_root_text, CREATED + 3)
                .unwrap();
        }

        let reopened = ManagementStore::open_with_paths(&path, user_home, system_temp).unwrap();
        assert_eq!(
            reopened.migration_versions().unwrap(),
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
        );
        assert_eq!(
            reopened.get_workspace("w-1").unwrap().unwrap().slug,
            "first"
        );
        assert_eq!(
            reopened.get_task("t-1").unwrap().unwrap().workspace_id,
            "w-1"
        );
        assert_eq!(
            reopened.get_session("ses-reopen-exact").unwrap().unwrap(),
            SessionRecord {
                open_code_session_id: "ses-reopen-exact".into(),
                owner: SessionOwner::Task("t-1".into()),
                directory: expected_task_home,
                last_known_status: "ready_for_review".into(),
                created_at: CREATED + 2,
                updated_at: CREATED + 2,
                event_cursor: None,
                reconciliation_status: "unknown".into(),
                reconciliation_uncertain: true,
                pending_input_json: None,
                selected_model: None,
            }
        );
        assert_eq!(
            reopened.project_home_root().unwrap(),
            configured_project_root_text
        );
    }

    #[test]
    fn reconciliation_cursor_status_and_pending_input_are_persisted_atomically() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-reconcile", "reconcile"))
            .unwrap();
        store
            .create_task(&task("t-reconcile", "w-reconcile", "task"))
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-reconcile".into(),
                owner: SessionOwner::Task("t-reconcile".into()),
                directory: "/tmp/reconcile".into(),
                last_known_status: "starting".into(),
                created_at: 1,
            })
            .unwrap();
        let updated = store
            .update_session_reconciliation(
                "ses-reconcile",
                "waiting_for_input",
                Some("cursor-7"),
                false,
                Some(r#"{"forms":[{"id":"form-1"}]}"#),
                2,
            )
            .unwrap();
        assert_eq!(updated.event_cursor.as_deref(), Some("cursor-7"));
        assert_eq!(updated.reconciliation_status, "waiting_for_input");
        assert!(!updated.reconciliation_uncertain);
        assert!(updated.pending_input_json.unwrap().contains("form-1"));
    }

    #[test]
    fn domain_records_bindings_sessions_quick_requests_cleanup_and_settings_round_trip() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-main", "main"))
            .unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        let workspace_update = store
            .update_workspace_details(
                "w-main",
                "Main workspace",
                "main",
                Some("Edited workspace description"),
                &store.get_workspace("w-main").unwrap().unwrap().home_path,
            )
            .unwrap();
        assert_eq!(workspace_update.slug, "main");
        assert_eq!(workspace_update.kind, WorkspaceKind::Regular);
        assert_eq!(store.list_workspaces().unwrap().len(), 2);

        let created_task = store
            .create_task(&task("t-one", "w-main", "first-task"))
            .unwrap();
        assert_eq!(created_task.workspace_id, "w-main");
        assert_eq!(
            store.list_tasks("w-main").unwrap(),
            vec![created_task.clone()]
        );
        let updated_task = store
            .update_task_details(
                "t-one",
                "Renamed",
                "first-task",
                Some("Updated"),
                &created_task.home_path,
            )
            .unwrap();
        assert_eq!(updated_task.name, "Renamed");
        assert_eq!(updated_task.description.as_deref(), Some("Updated"));

        let created_repository = store.create_repository(&repository("repo-1")).unwrap();
        assert_eq!(
            store.get_repository("repo-1").unwrap(),
            Some(created_repository.clone())
        );
        let updated_repository = store
            .update_repository(&Repository {
                purpose: Some("Updated purpose".into()),
                updated_at: CREATED + 1,
                ..created_repository
            })
            .unwrap();
        assert_eq!(
            updated_repository.purpose.as_deref(),
            Some("Updated purpose")
        );
        assert_eq!(store.list_repositories().unwrap(), vec![updated_repository]);
        let workspace_binding = WorkspaceRepositoryBinding {
            workspace_id: "w-main".into(),
            repository_id: "repo-1".into(),
            checkout_path: "/fixtures/main-checkout".into(),
            checkout_mode: CheckoutMode::Managed,
            branch: "main".into(),
            verification_status: VerificationStatus::Verified,
            created_at: CREATED,
        };
        store
            .save_workspace_repository_binding(&workspace_binding)
            .unwrap();
        let changed_binding = WorkspaceRepositoryBinding {
            branch: "trunk".into(),
            verification_status: VerificationStatus::Pending,
            ..workspace_binding
        };
        store
            .save_workspace_repository_binding(&changed_binding)
            .unwrap();
        assert_eq!(
            store
                .list_workspace_repository_bindings("w-main")
                .unwrap()
                .as_slice(),
            &[changed_binding]
        );

        let binding = task_binding("t-one", "repo-1");
        store.save_task_repository_binding(&binding).unwrap();
        assert_eq!(
            store.list_task_repository_bindings("t-one").unwrap(),
            vec![binding.clone()]
        );

        let workspace_session = store
            .create_session(&NewSession {
                open_code_session_id: "ses_Workspace-ExactCase_91".into(),
                owner: SessionOwner::Workspace("w-main".into()),
                directory: "/fixtures/Workspace Context/../inspection".into(),
                last_known_status: "ready_for_review".into(),
                created_at: CREATED,
            })
            .unwrap();
        assert_eq!(
            workspace_session.owner,
            SessionOwner::Workspace("w-main".into())
        );
        assert_eq!(
            workspace_session.open_code_session_id,
            "ses_Workspace-ExactCase_91"
        );
        assert_eq!(
            workspace_session.directory,
            "/fixtures/Workspace Context/../inspection"
        );

        let task_session = store
            .create_session(&NewSession {
                open_code_session_id: "ses_Task-ExactCase_92".into(),
                owner: SessionOwner::Task("t-one".into()),
                directory: "/fixtures/task-home".into(),
                last_known_status: "running".into(),
                created_at: CREATED + 5,
            })
            .unwrap();
        assert_eq!(
            store.get_session("ses_Task-ExactCase_92").unwrap(),
            Some(task_session.clone())
        );
        assert_eq!(
            store
                .list_sessions(&SessionOwner::Task("t-one".into()))
                .unwrap(),
            vec![task_session]
        );
        let updated_session = store
            .update_session_status(
                "ses_Workspace-ExactCase_91",
                "waiting_for_input",
                CREATED + 10,
            )
            .unwrap();
        assert_eq!(updated_session.last_known_status, "waiting_for_input");
        assert_eq!(updated_session.updated_at, CREATED + 10);

        let quick = store
            .create_quick_request(&task("qr-1", "w-quick", "quick-one"), "quick prompt")
            .unwrap();
        let initial_quick_lifecycle = quick.quick_request.unwrap();
        assert_eq!(initial_quick_lifecycle.created_at, CREATED + 1);
        assert_eq!(
            initial_quick_lifecycle.expires_at,
            Some(CREATED + 1 + QUICK_REQUEST_LIFETIME_MS)
        );
        let dismissed = store.dismiss_quick_request("qr-1", CREATED + 20).unwrap();
        assert_eq!(
            dismissed.quick_request.unwrap().dismissed_at,
            Some(CREATED + 20)
        );
        let expired = store
            .expire_quick_request("qr-1", CREATED + 1 + QUICK_REQUEST_LIFETIME_MS + 100)
            .unwrap();
        assert_eq!(
            expired.quick_request.unwrap().expired_at,
            Some(CREATED + 1 + QUICK_REQUEST_LIFETIME_MS + 100)
        );

        let job = store
            .create_cleanup_job(&NewCleanupJob {
                id: "cleanup-1".into(),
                task_id: "t-one".into(),
                repository_id: "repo-1".into(),
                worktree_path: binding.worktree_path.clone(),
                state: CleanupJobState::Queued,
                created_at: CREATED,
            })
            .unwrap();
        let deferred = store
            .update_cleanup_job(&CleanupJob {
                state: CleanupJobState::Deferred,
                attempts: 1,
                last_attempt_at: Some(CREATED + 30),
                next_attempt_at: Some(CREATED + 60),
                deferral_reason: Some("session is using this worktree".into()),
                updated_at: CREATED + 30,
                ..job.clone()
            })
            .unwrap();
        assert_eq!(
            store.get_cleanup_job("cleanup-1").unwrap(),
            Some(deferred.clone())
        );
        assert_eq!(
            store.list_cleanup_jobs("t-one").unwrap(),
            vec![deferred.clone()]
        );
        let failed = store
            .update_cleanup_job(&CleanupJob {
                state: CleanupJobState::Failed,
                failure_detail: Some("fixture cleanup failure".into()),
                updated_at: CREATED + 40,
                ..deferred
            })
            .unwrap();
        assert_eq!(
            failed.failure_detail.as_deref(),
            Some("fixture cleanup failure")
        );
        let duplicate_job = store
            .create_cleanup_job(&NewCleanupJob {
                id: "cleanup-retry".into(),
                task_id: "t-one".into(),
                repository_id: "repo-1".into(),
                worktree_path: binding.worktree_path,
                state: CleanupJobState::Queued,
                created_at: CREATED + 99,
            })
            .unwrap();
        assert_eq!(duplicate_job, failed);

        assert_eq!(
            store.get_setting("default_model").unwrap().unwrap().value,
            DEFAULT_MODEL
        );
        assert_eq!(
            store
                .set_setting("default_model", "fixture/provider-model", CREATED + 100)
                .unwrap()
                .value,
            "fixture/provider-model"
        );
        assert_eq!(
            store
                .get_setting("default_model")
                .unwrap()
                .unwrap()
                .updated_at,
            CREATED + 100
        );
    }

    #[test]
    fn quick_request_promotion_preserves_task_and_session_identity_and_removes_expiry() {
        let fixture = tempdir().unwrap();
        let system_temp = fixture.path().join("system-temp");
        let store =
            ManagementStore::in_memory_with_paths(fixture.path().join("home"), system_temp.clone())
                .unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        store
            .create_workspace(&workspace("w-regular", "regular"))
            .unwrap();
        store
            .create_quick_request(&task("qr-promote", "w-quick", "request"), "promote me")
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-before-promotion".into(),
                owner: SessionOwner::Task("qr-promote".into()),
                directory: quick_requests_directory(&fixture.path().join("home/OpenCode Projects"))
                    .to_string_lossy()
                    .into_owned(),
                last_known_status: "ready_for_review".into(),
                created_at: CREATED,
            })
            .unwrap();

        let promoted = store
            .promote_quick_request("qr-promote", "w-regular", "promoted-task", CREATED + 50)
            .unwrap();
        assert_eq!(promoted.id, "qr-promote");
        assert_eq!(promoted.workspace_id, "w-regular");
        assert_eq!(
            promoted.home_path,
            fixture
                .path()
                .join("home/OpenCode Projects/regular/tasks/promoted-task")
                .to_string_lossy()
        );
        assert_eq!(promoted.quick_request.as_ref().unwrap().expires_at, None);
        assert_eq!(
            promoted.quick_request.unwrap().promoted_at,
            Some(CREATED + 50)
        );
        let historical_session = store.get_session("ses-before-promotion").unwrap().unwrap();
        assert_eq!(
            historical_session.owner,
            SessionOwner::Task("qr-promote".into())
        );
        assert_eq!(
            historical_session.directory,
            quick_requests_directory(&fixture.path().join("home/OpenCode Projects"))
                .to_string_lossy()
                .as_ref()
        );
    }

    #[test]
    fn failed_new_workspace_promotion_rolls_back_workspace_home_and_source_request() {
        let fixture = tempdir().unwrap();
        let system_temp = fixture.path().join("system-temp");
        let quick_directory =
            quick_requests_directory(&fixture.path().join("home/OpenCode Projects"))
                .to_string_lossy()
                .into_owned();
        let store = ManagementStore::in_memory_with_paths(fixture.path().join("home"), system_temp)
            .unwrap();
        store.create_workspace(&quick_workspace()).unwrap();
        store
            .create_quick_request(
                &task("qr-failed-promotion", "w-quick", "request"),
                "failed promotion prompt",
            )
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-failed-promotion".into(),
                owner: SessionOwner::Task("qr-failed-promotion".into()),
                directory: quick_directory,
                last_known_status: "ready_for_review".into(),
                created_at: CREATED,
            })
            .unwrap();

        let workspace = NewWorkspace {
            id: "w-created-by-promotion".into(),
            name: "Created by promotion".into(),
            slug: "created-by-promotion".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: CREATED,
        };
        store.create_workspace(&workspace).unwrap();
        let home = PathBuf::from(
            store
                .get_workspace(&workspace.id)
                .unwrap()
                .unwrap()
                .home_path,
        );
        let before = store.get_task("qr-failed-promotion").unwrap().unwrap();
        let session_before = store.get_session("ses-failed-promotion").unwrap().unwrap();

        // The unsafe slug injects a failure after the new workspace has been
        // created, before any task or Quick Request fields can be changed.
        let result = store.promote_quick_request(
            "qr-failed-promotion",
            &workspace.id,
            "../invalid",
            CREATED + 1,
        );
        assert!(result.is_err());
        store.rollback_new_workspace(&workspace.id).unwrap();

        assert!(store.get_workspace(&workspace.id).unwrap().is_none());
        assert!(!home.exists());
        assert_eq!(
            store.get_task("qr-failed-promotion").unwrap().unwrap(),
            before
        );
        assert_eq!(
            store.get_session("ses-failed-promotion").unwrap().unwrap(),
            session_before
        );
    }

    #[test]
    fn failed_workspace_initialization_removes_session_owner_and_managed_home() {
        let fixture = tempdir().unwrap();
        let store = ManagementStore::in_memory_with_paths(
            fixture.path().join("home"),
            fixture.path().join("system-temp"),
        )
        .unwrap();
        let workspace = NewWorkspace {
            id: "w-init-failed".into(),
            name: "Initialization failed".into(),
            slug: "initialization-failed".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: CREATED,
        };
        let created = store.create_workspace(&workspace).unwrap();
        let session = NewSession {
            open_code_session_id: "ses-init-failed".into(),
            owner: SessionOwner::Workspace(workspace.id.clone()),
            directory: created.home_path.clone(),
            last_known_status: "starting".into(),
            created_at: CREATED,
        };
        store.create_session(&session).unwrap();

        store
            .rollback_workspace_session(&workspace.id, &session.open_code_session_id)
            .unwrap();
        store.rollback_new_workspace(&workspace.id).unwrap();

        assert!(store.get_workspace(&workspace.id).unwrap().is_none());
        assert!(store
            .get_session(&session.open_code_session_id)
            .unwrap()
            .is_none());
        assert!(!PathBuf::from(created.home_path).exists());
    }

    #[test]
    fn failed_task_initialization_rolls_back_task_session_and_managed_home() {
        let fixture = tempdir().unwrap();
        let store = ManagementStore::in_memory_with_paths(
            fixture.path().join("home"),
            fixture.path().join("system-temp"),
        )
        .unwrap();
        store
            .create_workspace(&workspace("w-rollback", "rollback-workspace"))
            .unwrap();
        let created = store
            .create_task(&task("t-rollback", "w-rollback", "failed-setup"))
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-rollback".into(),
                owner: SessionOwner::Task(created.id.clone()),
                directory: created.home_path.clone(),
                last_known_status: "starting".into(),
                created_at: CREATED,
            })
            .unwrap();

        store.rollback_new_task(&created.id).unwrap();

        assert!(store.get_task(&created.id).unwrap().is_none());
        assert!(store.get_session("ses-rollback").unwrap().is_none());
        assert!(!std::path::Path::new(&created.home_path).exists());
    }

    #[test]
    fn foreign_key_and_uniqueness_failures_do_not_create_partial_records() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-1", "same-slug"))
            .unwrap();
        assert!(store
            .create_task(&task("orphan-task", "missing-workspace", "orphan"))
            .is_err());
        assert!(store
            .create_workspace(&workspace("w-duplicate", "same-slug"))
            .is_err());
        assert_eq!(store.list_workspaces().unwrap().len(), 1);
        assert!(store.get_task("orphan-task").unwrap().is_none());

        store.create_workspace(&quick_workspace()).unwrap();
        assert!(store
            .create_workspace(&NewWorkspace {
                id: "w-quick-duplicate".into(),
                slug: "second-quick-requests".into(),
                ..quick_workspace()
            })
            .is_err());
        assert!(store
            .create_task(&task(
                "regular-task-in-quick-space",
                "w-quick",
                "regular-task"
            ))
            .is_err());
        assert!(store
            .create_quick_request(
                &task("quick-request-in-regular-space", "w-1", "quick-request"),
                "not a quick request"
            )
            .is_err());
        assert!(store
            .get_task("regular-task-in-quick-space")
            .unwrap()
            .is_none());
        assert!(store
            .get_task("quick-request-in-regular-space")
            .unwrap()
            .is_none());

        store.create_workspace(&workspace("w-2", "second")).unwrap();
        store
            .create_task(&task("t-existing", "w-2", "existing"))
            .unwrap();
        let first_session = NewSession {
            open_code_session_id: "ses-unique-global".into(),
            owner: SessionOwner::Task("t-existing".into()),
            directory: "/fixtures/existing".into(),
            last_known_status: "unknown".into(),
            created_at: CREATED,
        };
        store.create_session(&first_session).unwrap();

        let new_task = task("t-atomic-failure", "w-2", "atomic-failure");
        let duplicate_session = NewSession {
            open_code_session_id: first_session.open_code_session_id.clone(),
            owner: SessionOwner::Task(new_task.id.clone()),
            directory: "/fixtures/atomic".into(),
            last_known_status: "starting".into(),
            created_at: CREATED,
        };
        assert!(store
            .create_task_with_session(&new_task, &duplicate_session)
            .is_err());
        assert!(store.get_task("t-atomic-failure").unwrap().is_none());
        assert_eq!(store.list_tasks("w-2").unwrap().len(), 1);

        let invalid_session = NewSession {
            open_code_session_id: "ses-no-owner".into(),
            owner: SessionOwner::Workspace("no-workspace".into()),
            directory: "/fixtures/no-owner".into(),
            last_known_status: "unknown".into(),
            created_at: CREATED,
        };
        assert!(store.create_session(&invalid_session).is_err());
        assert!(store.get_session("ses-no-owner").unwrap().is_none());

        let repo = store.create_repository(&repository("repo-unique")).unwrap();
        let mut duplicate_repo = repository("repo-duplicate");
        duplicate_repo.repository_identity = repo.repository_identity;
        assert!(store.create_repository(&duplicate_repo).is_err());
        assert_eq!(store.list_repositories().unwrap().len(), 1);

        let invalid_binding = WorkspaceRepositoryBinding {
            workspace_id: "missing-workspace".into(),
            repository_id: "repo-unique".into(),
            checkout_path: "/fixtures/bad".into(),
            checkout_mode: CheckoutMode::Existing,
            branch: "main".into(),
            verification_status: VerificationStatus::Pending,
            created_at: CREATED,
        };
        assert!(store
            .save_workspace_repository_binding(&invalid_binding)
            .is_err());
        assert!(store
            .list_workspace_repository_bindings("missing-workspace")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn default_and_configured_project_roots_drive_new_paths_and_survive_reopen() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("prefs.sqlite3");
        let user_home = directory.path().join("injected-home");
        let system_temp = directory.path().join("injected-temp");
        let custom_root = user_home.join("Configured Project Home");
        let custom_root_text = custom_root.to_string_lossy().into_owned();
        fs::create_dir_all(&user_home).unwrap();

        {
            let store =
                ManagementStore::open_with_paths(&path, user_home.clone(), system_temp.clone())
                    .unwrap();
            assert_eq!(store.project_home_root().unwrap(), "~/OpenCode Projects/");
            let default_workspace = store
                .create_workspace(&workspace("w-default", "default-space"))
                .unwrap();
            let default_task = store
                .create_task(&task("t-default", "w-default", "default-task"))
                .unwrap();
            assert_eq!(
                default_workspace.home_path,
                user_home
                    .join("OpenCode Projects")
                    .join("default-space")
                    .to_string_lossy()
            );
            assert_eq!(
                default_task.home_path,
                user_home
                    .join("OpenCode Projects/default-space/tasks/default-task")
                    .to_string_lossy()
            );

            store
                .set_project_home_root(&custom_root_text, CREATED)
                .unwrap();
            let custom_workspace = store
                .create_workspace(&workspace("w-custom", "custom-space"))
                .unwrap();
            let custom_task = store
                .create_task(&task("t-custom", "w-custom", "custom-task"))
                .unwrap();
            assert_eq!(
                custom_workspace.home_path,
                custom_root.join("custom-space").to_string_lossy()
            );
            assert_eq!(
                custom_task.home_path,
                custom_root
                    .join("custom-space/tasks/custom-task")
                    .to_string_lossy()
            );
            assert!(Path::new(&default_workspace.home_path)
                .join("notes")
                .is_dir());
            assert!(Path::new(&default_task.home_path)
                .join("worktrees")
                .is_dir());
            assert!(Path::new(&custom_workspace.home_path)
                .join("repos")
                .is_dir());
            assert!(Path::new(&custom_task.home_path).join("notes").is_dir());
        }

        let reopened = ManagementStore::open_with_paths(&path, user_home, system_temp).unwrap();
        assert_eq!(reopened.project_home_root().unwrap(), custom_root_text);
        assert_eq!(
            reopened
                .get_workspace("w-custom")
                .unwrap()
                .unwrap()
                .home_path,
            custom_root.join("custom-space").to_string_lossy()
        );
        assert_eq!(
            reopened.get_task("t-custom").unwrap().unwrap().home_path,
            custom_root
                .join("custom-space/tasks/custom-task")
                .to_string_lossy()
        );
    }

    #[test]
    fn project_home_resolution_expands_only_the_persisted_home_prefix() {
        let fixture = tempdir().unwrap();
        let user_home = fixture.path().join("user-home");
        fs::create_dir(&user_home).unwrap();
        assert_eq!(
            resolve_project_home_root("~/OpenCode Projects/", &user_home).unwrap(),
            user_home.join("OpenCode Projects/")
        );
        assert!(resolve_project_home_root("~/../outside", &user_home).is_err());
        assert!(resolve_project_home_root("/outside/home", &user_home).is_err());
    }

    #[test]
    fn quick_request_task_homes_and_session_directories_are_validated() {
        let fixture = tempdir().unwrap();
        let system_temp = fixture.path().join("system-temp");
        let store = ManagementStore::in_memory_with_paths(
            fixture.path().join("user-home"),
            system_temp.clone(),
        )
        .unwrap();
        let quick_workspace = store.create_workspace(&quick_workspace()).unwrap();
        let shared_directory =
            quick_requests_directory(&fixture.path().join("user-home/OpenCode Projects"))
                .to_string_lossy()
                .into_owned();
        assert_eq!(quick_workspace.home_path, shared_directory);

        let request = store
            .create_quick_request(
                &task("qr-shared", &quick_workspace.id, "request-one"),
                "shared prompt",
            )
            .unwrap();
        assert_eq!(request.home_path, shared_directory);
        assert!(!Path::new(&request.home_path).exists());

        let invalid_session = NewSession {
            open_code_session_id: "ses-quick-wrong-directory".into(),
            owner: SessionOwner::Task(request.id.clone()),
            directory: fixture
                .path()
                .join("arbitrary-request-home")
                .to_string_lossy()
                .into_owned(),
            last_known_status: "starting".into(),
            created_at: CREATED,
        };
        assert!(store.create_session(&invalid_session).is_err());
        assert!(store
            .get_session("ses-quick-wrong-directory")
            .unwrap()
            .is_none());

        let session = store
            .create_session(&NewSession {
                open_code_session_id: "ses-quick-shared-directory".into(),
                owner: SessionOwner::Task(request.id.clone()),
                directory: shared_directory.clone(),
                last_known_status: "starting".into(),
                created_at: CREATED,
            })
            .unwrap();
        assert_eq!(session.directory, shared_directory);
        assert_eq!(session.owner, SessionOwner::Task(request.id));

        let repository_path = fixture.path().join("registered-repository");
        fs::create_dir_all(&repository_path).unwrap();
        store
            .create_repository(&NewRepository {
                id: "repo-quick-request".into(),
                name: "Registered repository".into(),
                repository_path: repository_path.to_string_lossy().into_owned(),
                repository_identity: "quick-request-repository-identity".into(),
                purpose: None,
                purpose_status: PurposeStatus::Available,
                created_at: CREATED,
            })
            .unwrap();
        let repository_directory = store
            .quick_request_directory(Some("repo-quick-request"))
            .unwrap();
        let repository_task = task("qr-repository", &quick_workspace.id, "request-repository");
        let repository_session = NewSession {
            open_code_session_id: "ses-quick-repository-directory".into(),
            owner: SessionOwner::Task(repository_task.id.clone()),
            directory: repository_directory.to_string_lossy().into_owned(),
            last_known_status: "starting".into(),
            created_at: CREATED + 1,
        };
        let repository_request = store
            .create_quick_request_with_session_and_model(
                &repository_task,
                &repository_session,
                "openai/gpt-6-luna",
                "repository-bound prompt",
            )
            .unwrap();
        assert_eq!(
            repository_request.session.unwrap().directory,
            repository_directory.to_string_lossy()
        );

        let configured_root = fixture.path().join("user-home/custom-projects");
        store
            .set_project_home_root(&configured_root.to_string_lossy(), CREATED + 2)
            .unwrap();
        let configured_quick_directory = quick_requests_directory(&configured_root);
        assert_eq!(
            store
                .get_workspace(&quick_workspace.id)
                .unwrap()
                .unwrap()
                .home_path,
            configured_quick_directory.to_string_lossy()
        );
        assert_eq!(
            store.get_task("qr-shared").unwrap().unwrap().home_path,
            configured_quick_directory.to_string_lossy()
        );
        assert_eq!(
            store
                .validate_session_context(
                    "ses-quick-shared-directory",
                    Path::new(&shared_directory)
                )
                .unwrap()
                .directory,
            shared_directory
        );

        let connection = store.lock().unwrap();
        assert!(connection
            .execute(
                "UPDATE tasks SET home_path = '/arbitrary/request/home' WHERE id = 'qr-shared'",
                [],
            )
            .is_err());
        assert!(connection
            .execute(
                "INSERT INTO sessions(open_code_session_id, owner_task_id, directory, last_known_status, created_at, updated_at)
                 VALUES ('ses-sql-wrong-directory', 'qr-shared', '/arbitrary/request/home', 'starting', ?1, ?1)",
                [CREATED],
            )
            .is_err());
    }

    #[test]
    fn completed_tasks_cannot_be_reopened_and_active_tasks_block_workspace_completion() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-lifecycle", "lifecycle"))
            .unwrap();
        store
            .create_task(&task("t-lifecycle", "w-lifecycle", "task"))
            .unwrap();
        let blocked = store
            .complete_workspace("w-lifecycle", CREATED + 10)
            .unwrap_err()
            .to_string();
        assert!(blocked.contains("t-lifecycle"), "{blocked}");
        assert_eq!(
            store.get_workspace("w-lifecycle").unwrap().unwrap().status,
            WorkspaceStatus::Active
        );

        let completed = store.complete_task("t-lifecycle", CREATED + 10).unwrap();
        assert_eq!(completed.status, TaskStatus::Completed);
        assert_eq!(completed.completed_at, Some(CREATED + 10));
        assert!(matches!(
            store.reopen_task("t-lifecycle"),
            Err(ManagementStoreError::InvalidTransition(_))
        ));
        assert_eq!(
            store.get_task("t-lifecycle").unwrap().unwrap().status,
            TaskStatus::Completed
        );
        assert_eq!(
            store
                .complete_workspace("w-lifecycle", CREATED + 20)
                .unwrap()
                .status,
            WorkspaceStatus::Completed
        );
        assert!(store
            .create_task(&task(
                "t-after-workspace-completion",
                "w-lifecycle",
                "later"
            ))
            .is_err());
        assert!(store
            .create_session(&NewSession {
                open_code_session_id: "ses-after-workspace-completion".into(),
                owner: SessionOwner::Workspace("w-lifecycle".into()),
                directory: "/fixtures/closed-workspace".into(),
                last_known_status: "starting".into(),
                created_at: CREATED + 30,
            })
            .is_err());
        assert!(store
            .create_session(&NewSession {
                open_code_session_id: "ses-after-task-completion".into(),
                owner: SessionOwner::Task("t-lifecycle".into()),
                directory: "/fixtures/completed-task".into(),
                last_known_status: "starting".into(),
                created_at: CREATED + 30,
            })
            .is_err());
        assert!(store
            .get_task("t-after-workspace-completion")
            .unwrap()
            .is_none());
        assert!(store
            .get_session("ses-after-task-completion")
            .unwrap()
            .is_none());

        assert_eq!(
            store.reactivate_workspace("w-lifecycle").unwrap().status,
            WorkspaceStatus::Active
        );
        assert_eq!(
            store
                .create_task(&task("t-after-reactivation", "w-lifecycle", "new-work"))
                .unwrap()
                .status,
            TaskStatus::Active
        );

        let connection = store.lock().unwrap();
        assert!(connection
            .execute(
                "UPDATE tasks SET status = 'active', completed_at = NULL WHERE id = 't-lifecycle'",
                []
            )
            .is_err());
    }

    #[test]
    fn initial_prompt_claim_is_single_use_and_context_is_exact() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-route", "route"))
            .unwrap();
        let task = store
            .create_task(&task("t-route", "w-route", "route-task"))
            .unwrap();
        let session = store
            .create_session(&NewSession {
                open_code_session_id: "ses-route".into(),
                owner: SessionOwner::Task(task.id.clone()),
                directory: task.home_path.clone(),
                last_known_status: "starting".into(),
                created_at: CREATED,
            })
            .unwrap();
        assert_eq!(
            store
                .validate_session_context("ses-route", Path::new(&session.directory))
                .unwrap(),
            session
        );
        assert!(store
            .validate_session_context("ses-route", Path::new("/wrong/directory"))
            .is_err());
        assert_eq!(
            store
                .claim_initial_prompt("ses-route")
                .unwrap()
                .last_known_status,
            "prompting"
        );
        assert!(store.claim_initial_prompt("ses-route").is_err());
    }

    #[test]
    fn claimed_prompt_failure_is_uncertain_and_explicitly_retryable() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-prompt-recovery", "recovery"))
            .unwrap();
        store
            .create_task(&task("t-prompt-recovery", "w-prompt-recovery", "request"))
            .unwrap();
        let session = NewSession {
            open_code_session_id: "ses-prompt-recovery".into(),
            owner: SessionOwner::Task("t-prompt-recovery".into()),
            directory: "/fixtures/recovery".into(),
            last_known_status: "starting".into(),
            created_at: CREATED,
        };
        store
            .create_session_with_model(&session, "openai/gpt-6-luna")
            .unwrap();
        store.claim_initial_prompt("ses-prompt-recovery").unwrap();
        let failed = store
            .mark_initial_prompt_failed("ses-prompt-recovery", CREATED + 1)
            .unwrap();
        assert_eq!(failed.last_known_status, "failed");
        assert!(failed.reconciliation_uncertain);
        assert_eq!(
            store
                .retry_initial_prompt("ses-prompt-recovery", CREATED + 2)
                .unwrap()
                .last_known_status,
            "starting"
        );
    }

    #[test]
    fn retry_prompt_claim_is_atomic_and_cannot_duplicate_generation() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-retry-claim", "retry-claim"))
            .unwrap();
        store
            .create_task(&task("t-retry-claim", "w-retry-claim", "request"))
            .unwrap();
        store
            .create_session_with_model(
                &NewSession {
                    open_code_session_id: "ses-retry-claim".into(),
                    owner: SessionOwner::Task("t-retry-claim".into()),
                    directory: "/fixtures/retry-claim".into(),
                    last_known_status: "failed".into(),
                    created_at: CREATED,
                },
                "openai/gpt-6-luna",
            )
            .unwrap();
        assert_eq!(
            store
                .claim_retry_initial_prompt("ses-retry-claim", CREATED + 1)
                .unwrap()
                .last_known_status,
            "prompting"
        );
        assert!(store
            .claim_retry_initial_prompt("ses-retry-claim", CREATED + 2)
            .is_err());
    }

    #[test]
    fn domain_ids_and_session_associations_are_database_immutable() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-immutable", "immutable"))
            .unwrap();
        store
            .create_task(&task("t-immutable", "w-immutable", "immutable-task"))
            .unwrap();
        store
            .create_repository(&repository("repo-immutable"))
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-immutable".into(),
                owner: SessionOwner::Task("t-immutable".into()),
                directory: "/fixtures/immutable".into(),
                last_known_status: "unknown".into(),
                created_at: CREATED,
            })
            .unwrap();

        let connection = store.lock().unwrap();
        assert!(connection
            .execute(
                "UPDATE workspaces SET id = 'changed' WHERE id = 'w-immutable'",
                []
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE tasks SET id = 'changed' WHERE id = 't-immutable'",
                []
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE repository_catalog SET id = 'changed' WHERE id = 'repo-immutable'",
                []
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE sessions SET directory = '/fixtures/changed' WHERE open_code_session_id = 'ses-immutable'",
                []
            )
            .is_err());
        assert!(connection
            .execute(
                "UPDATE sessions SET open_code_session_id = 'ses-changed' WHERE open_code_session_id = 'ses-immutable'",
                []
            )
            .is_err());
    }

    #[test]
    fn rejected_preexisting_workspace_and_task_homes_are_not_recorded_or_adopted() {
        let directory = tempdir().unwrap();
        let user_home = directory.path().join("user-home");
        let store =
            ManagementStore::in_memory_with_paths(&user_home, directory.path().join("system-temp"))
                .unwrap();
        let project_root = user_home.join("OpenCode Projects");
        fs::create_dir_all(&project_root).unwrap();

        let unrelated_home = project_root.join("unrelated");
        fs::create_dir(&unrelated_home).unwrap();
        fs::write(unrelated_home.join("sentinel.txt"), "unrelated sentinel\n").unwrap();
        assert!(store
            .create_workspace(&workspace("w-unrelated-home", "unrelated"))
            .is_err());
        assert!(store.get_workspace("w-unrelated-home").unwrap().is_none());
        assert_eq!(
            fs::read_to_string(unrelated_home.join("sentinel.txt")).unwrap(),
            "unrelated sentinel\n"
        );
        assert!(!unrelated_home
            .join(".opencode-project-manager-owner")
            .exists());
        assert!(!unrelated_home.join("notes").exists());

        let mismatched_home = project_root.join("mismatched");
        fs::create_dir(&mismatched_home).unwrap();
        let mismatched_marker = mismatched_home.join(".opencode-project-manager-owner");
        fs::write(&mismatched_marker, "workspace\nsome-other-workspace\n").unwrap();
        fs::write(
            mismatched_home.join("sentinel.txt"),
            "mismatched sentinel\n",
        )
        .unwrap();
        assert!(store
            .create_workspace(&workspace("w-mismatched-home", "mismatched"))
            .is_err());
        assert!(store.get_workspace("w-mismatched-home").unwrap().is_none());
        assert_eq!(
            fs::read_to_string(&mismatched_marker).unwrap(),
            "workspace\nsome-other-workspace\n"
        );
        assert_eq!(
            fs::read_to_string(mismatched_home.join("sentinel.txt")).unwrap(),
            "mismatched sentinel\n"
        );
        assert!(!mismatched_home.join("notes").exists());

        let owning_workspace = store
            .create_workspace(&workspace("w-task-marker-owner", "task-marker-owner"))
            .unwrap();
        let task_home = Path::new(&owning_workspace.home_path)
            .join("tasks")
            .join("mismatched-task");
        fs::create_dir(&task_home).unwrap();
        let task_marker = task_home.join(".opencode-project-manager-owner");
        fs::write(&task_marker, "task\nsome-other-task\n").unwrap();
        fs::write(task_home.join("sentinel.txt"), "task sentinel\n").unwrap();
        assert!(store
            .create_task(&task(
                "t-mismatched-home",
                &owning_workspace.id,
                "mismatched-task"
            ))
            .is_err());
        assert!(store.get_task("t-mismatched-home").unwrap().is_none());
        assert_eq!(
            fs::read_to_string(&task_marker).unwrap(),
            "task\nsome-other-task\n"
        );
        assert_eq!(
            fs::read_to_string(task_home.join("sentinel.txt")).unwrap(),
            "task sentinel\n"
        );
        assert!(!task_home.join("notes").exists());
    }

    #[test]
    fn failed_workspace_insert_rolls_back_only_its_new_empty_owned_home() {
        let directory = tempdir().unwrap();
        let user_home = directory.path().join("user-home");
        let store =
            ManagementStore::in_memory_with_paths(&user_home, directory.path().join("system-temp"))
                .unwrap();
        let project_root = user_home.join("OpenCode Projects");
        let workspace_home = project_root.join("trigger-failure");

        store
            .lock()
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER fixture_fail_workspace_insert
                 BEFORE INSERT ON workspaces
                 WHEN NEW.id = 'w-trigger-failure'
                 BEGIN
                     SELECT RAISE(ABORT, 'fixture workspace insert failure');
                 END;",
            )
            .unwrap();

        assert!(store
            .create_workspace(&workspace("w-trigger-failure", "trigger-failure"))
            .is_err());
        assert!(store.get_workspace("w-trigger-failure").unwrap().is_none());
        assert!(project_root.is_dir());
        assert!(!workspace_home.exists());
        assert!(!workspace_home
            .join(".opencode-project-manager-owner")
            .exists());
        for child in ["notes", "repos", "tasks"] {
            assert!(!workspace_home.join(child).exists());
        }
        assert!(fs::read_dir(&project_root).unwrap().next().is_none());
    }

    #[cfg(unix)]
    #[test]
    fn task_home_symlink_escape_is_rejected_before_recording_and_preserves_outside_data() {
        let directory = tempdir().unwrap();
        let user_home = directory.path().join("user-home");
        let store =
            ManagementStore::in_memory_with_paths(&user_home, directory.path().join("system-temp"))
                .unwrap();
        let workspace = store
            .create_workspace(&workspace("w-task-symlink", "task-symlink"))
            .unwrap();
        let outside = directory.path().join("outside-task-home");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("sentinel.txt"), "outside data stays intact\n").unwrap();
        let escaped_task_home = Path::new(&workspace.home_path)
            .join("tasks")
            .join("escaped-task");
        std::os::unix::fs::symlink(&outside, &escaped_task_home).unwrap();

        assert!(store
            .create_task(&task("t-task-symlink", &workspace.id, "escaped-task"))
            .is_err());
        assert!(store.get_task("t-task-symlink").unwrap().is_none());
        assert!(fs::symlink_metadata(&escaped_task_home)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(
            fs::read_to_string(outside.join("sentinel.txt")).unwrap(),
            "outside data stays intact\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn uncanonicalizable_runtime_active_directory_defers_cleanup_without_mutation() {
        use std::os::unix::fs::symlink;

        let fixture = cleanup_fixture("t-runtime-uncanonicalizable");
        fixture
            .store
            .create_session(&NewSession {
                open_code_session_id: "ses-runtime-terminal".into(),
                owner: SessionOwner::Task(fixture.task_id.clone()),
                directory: fixture.task_home.to_string_lossy().into_owned(),
                last_known_status: "completed".into(),
                created_at: CREATED + 3,
            })
            .unwrap();
        fixture
            .store
            .complete_task(&fixture.task_id, CREATED + 4)
            .unwrap();

        let runtime_directory = fixture._directory.path().join("runtime-active");
        let missing_target = fixture
            ._directory
            .path()
            .join("runtime-target-does-not-exist");
        symlink(&missing_target, &runtime_directory).unwrap();
        assert!(!missing_target.exists());

        let repository_before = safety::inspect_repository(&fixture.repository_path).unwrap();
        let refs_before = git_ok(&fixture.repository_path, &["show-ref"]).stdout;
        let worktree_status_before = git_ok(
            &fixture.worktree_path,
            &["status", "--porcelain=v1", "--untracked-files=all"],
        )
        .stdout;
        let plan = fixture
            .store
            .plan_completed_task_cleanup(
                &fixture.task_id,
                "repo-cleanup-fixture",
                &[runtime_directory.clone()],
            )
            .unwrap();

        match plan {
            CleanupPlan::Deferred {
                canonical_path,
                reason,
            } => {
                assert_eq!(
                    canonical_path,
                    fs::canonicalize(&fixture.worktree_path)
                        .unwrap()
                        .to_string_lossy()
                );
                assert!(reason.contains("cannot be canonicalized"), "{reason}");
                assert!(reason.contains("activity is uncertain"), "{reason}");
                assert!(reason.contains("runtime-active"), "{reason}");
            }
            other => panic!("uncanonicalizable runtime directory was not deferred: {other:?}"),
        }
        assert!(fixture.worktree_path.is_dir());
        assert!(fs::symlink_metadata(&runtime_directory)
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(!missing_target.exists());
        assert_eq!(
            safety::inspect_repository(&fixture.repository_path).unwrap(),
            repository_before
        );
        assert_eq!(
            git_ok(&fixture.repository_path, &["show-ref"]).stdout,
            refs_before
        );
        assert_eq!(
            git_ok(
                &fixture.worktree_path,
                &["status", "--porcelain=v1", "--untracked-files=all"],
            )
            .stdout,
            worktree_status_before
        );
    }

    #[test]
    fn cleanup_planner_fails_safe_for_missing_worktree_binding_without_git_mutation() {
        let fixture = cleanup_fixture("t-missing-worktree");
        fixture
            .store
            .complete_task(&fixture.task_id, CREATED + 3)
            .unwrap();
        let missing_worktree = fixture
            .task_home
            .join("worktrees/missing-recorded-worktree");
        {
            let connection = fixture.store.lock().unwrap();
            connection
                .execute(
                    "UPDATE task_repositories SET worktree_path = ?1
                     WHERE task_id = ?2 AND repository_id = ?3",
                    params![
                        missing_worktree.to_string_lossy(),
                        fixture.task_id,
                        "repo-cleanup-fixture"
                    ],
                )
                .unwrap();
        }
        assert!(!missing_worktree.exists());

        let repository_before = safety::inspect_repository(&fixture.repository_path).unwrap();
        let refs_before = git_ok(&fixture.repository_path, &["show-ref"]).stdout;
        let plan = fixture
            .store
            .plan_completed_task_cleanup(&fixture.task_id, "repo-cleanup-fixture", &[])
            .unwrap();
        assert!(matches!(
            &plan,
            CleanupPlan::Failed { reason } if reason.contains("missing")
        ));
        assert!(!matches!(plan, CleanupPlan::Removable { .. }));
        assert!(fixture.worktree_path.is_dir());
        assert!(!missing_worktree.exists());
        assert_eq!(
            safety::inspect_repository(&fixture.repository_path).unwrap(),
            repository_before
        );
        assert_eq!(
            git_ok(&fixture.repository_path, &["show-ref"]).stdout,
            refs_before
        );
    }

    #[test]
    fn cleanup_planner_fails_safe_when_git_worktree_owner_is_ambiguous() {
        let fixture = cleanup_fixture("t-ambiguous-worktree");
        fixture
            .store
            .complete_task(&fixture.task_id, CREATED + 3)
            .unwrap();
        {
            // Model stale/ambiguous persisted ownership: main exists, but Git
            // reports the repository's primary checkout—not this task path—as
            // its owner. This changes only this fixture's SQLite row.
            let connection = fixture.store.lock().unwrap();
            connection
                .execute(
                    "UPDATE task_repositories SET branch = 'main'
                     WHERE task_id = ?1 AND repository_id = ?2",
                    params![fixture.task_id, "repo-cleanup-fixture"],
                )
                .unwrap();
        }

        let repository_before = safety::inspect_repository(&fixture.repository_path).unwrap();
        let refs_before = git_ok(&fixture.repository_path, &["show-ref"]).stdout;
        let plan = fixture
            .store
            .plan_completed_task_cleanup(&fixture.task_id, "repo-cleanup-fixture", &[])
            .unwrap();
        assert!(matches!(
            &plan,
            CleanupPlan::Failed { reason } if reason.contains("ambiguous")
        ));
        assert!(!matches!(plan, CleanupPlan::Removable { .. }));
        assert!(fixture.worktree_path.is_dir());
        assert_eq!(
            safety::inspect_repository(&fixture.repository_path).unwrap(),
            repository_before
        );
        assert_eq!(
            git_ok(&fixture.repository_path, &["show-ref"]).stdout,
            refs_before
        );
    }
}
