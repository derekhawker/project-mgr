//! SQLite-backed management records. Conversation history remains in OpenCode;
//! Quick Requests separately retain only their original prompt for the list.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, Value as SqlValue, ValueRef};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};

use crate::safety::{self, GitInspection, ManagedHomeGuard, SafetyError};

pub const DEFAULT_PROJECT_HOME_ROOT: &str = "~/OpenCode Projects/";
pub const DEFAULT_REPOSITORY_LIBRARY_ROOT: &str = "~/OpenCode Projects/Repositories/";
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
const MIGRATION_14: &str = include_str!("migrations/0014_repository_directories.sql");
const MIGRATION_15: &str = include_str!("migrations/0015_workspace_repository_setup.sql");
const MIGRATION_16: &str = include_str!("migrations/0016_task_session_repositories.sql");
const MIGRATION_17: &str = include_str!("migrations/0017_task_repository_selection.sql");
const MIGRATION_18: &str = include_str!("migrations/0018_workspace_work_contexts.sql");
const MIGRATION_19: &str = include_str!("migrations/0019_legacy_task_archive.sql");
const MIGRATION_20: &str = include_str!("migrations/0020_workspace_worktree_base_compat.sql");
const MIGRATION_21: &str = include_str!("migrations/0021_workspace_link_compat.sql");

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

fn rows_as_json(
    connection: &Connection,
    table: &str,
    key_column: &str,
    key: &str,
) -> StoreResult<serde_json::Value> {
    let mut columns_statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = columns_statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;
    if columns.is_empty() {
        return Err(ManagementStoreError::InvalidTransition(format!(
            "archive table {table} is unavailable"
        )));
    }
    let fields = columns
        .iter()
        .map(|column| format!("'{}', \"{}\"", column.replace('\'', "''"), column))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT COALESCE(json_group_array(json_object({fields})), '[]') FROM {table} WHERE {key_column} = ?1"
    );
    let json: String = connection.query_row(&sql, [key], |row| row.get(0))?;
    serde_json::from_str(&json).map_err(|error| {
        ManagementStoreError::InvalidTransition(format!(
            "could not serialize {table} archive rows: {error}"
        ))
    })
}

fn json_value_to_sql(value: &serde_json::Value) -> SqlValue {
    match value {
        serde_json::Value::Null => SqlValue::Null,
        serde_json::Value::Bool(value) => SqlValue::Integer(i64::from(*value)),
        serde_json::Value::Number(value) => value
            .as_i64()
            .map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .unwrap_or(SqlValue::Null),
        serde_json::Value::String(value) => SqlValue::Text(value.clone()),
        serde_json::Value::Array(_) | serde_json::Value::Object(_) => {
            SqlValue::Text(value.to_string())
        }
    }
}

fn restore_json_rows(
    connection: &Connection,
    table: &str,
    rows: &serde_json::Value,
) -> StoreResult<()> {
    let rows = rows.as_array().ok_or_else(|| {
        ManagementStoreError::InvalidTransition(format!("archive {table} rows are malformed"))
    })?;
    for row in rows {
        let object = row.as_object().ok_or_else(|| {
            ManagementStoreError::InvalidTransition(format!("archive {table} row is malformed"))
        })?;
        let columns = object.keys().collect::<Vec<_>>();
        let placeholders = std::iter::repeat_n("?", columns.len())
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "INSERT INTO {table} ({}) VALUES ({placeholders})",
            columns
                .iter()
                .map(|column| format!("\"{column}\""))
                .collect::<Vec<_>>()
                .join(", ")
        );
        let values = columns
            .iter()
            .map(|column| json_value_to_sql(&object[*column]))
            .collect::<Vec<_>>();
        connection.execute(&sql, params_from_iter(values))?;
    }
    Ok(())
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
    Clone,
}
sqlite_enum!(CheckoutMode { Existing => "existing", Managed => "managed", Clone => "clone" });

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
pub struct LegacyTaskArchiveSummary {
    pub task_id: String,
    pub workspace_id: String,
    pub archived_at: i64,
    pub restored_at: Option<i64>,
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
pub struct RepositoryScanDirectory {
    pub path: String,
    pub repositories: Vec<RepositoryDirectoryEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDirectoryEntry {
    pub repository: Repository,
    pub enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryDirectoryPage {
    pub directories: Vec<RepositoryScanDirectory>,
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

pub fn workspace_session_directories(
    workspace_home: &Path,
    bindings: &[WorkspaceRepositoryBinding],
) -> StoreResult<Vec<(Option<String>, PathBuf)>> {
    if bindings
        .iter()
        .any(|binding| binding.verification_status != VerificationStatus::Verified)
    {
        return Err(ManagementStoreError::InvalidTransition(
            "workspace sessions require every selected repository checkout to be verified".into(),
        ));
    }
    if bindings.is_empty() {
        return Ok(vec![(None, workspace_home.to_path_buf())]);
    }
    let mut directories = bindings
        .iter()
        .map(|binding| {
            (
                Some(binding.repository_id.clone()),
                PathBuf::from(&binding.checkout_path),
            )
        })
        .collect::<Vec<_>>();
    if bindings.len() > 1 {
        // Start all repo workers before the orchestrator so its local plugin
        // can be configured with their exact persisted session IDs.
        directories.push((None, workspace_home.to_path_buf()));
    }
    Ok(directories)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepositoryCheckoutMetadata {
    pub workspace_id: String,
    pub repository_id: String,
    pub checkout_path: String,
    pub source_identity: String,
    pub checkout_identity: String,
    pub default_branch: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceRepositorySetupStatus {
    Pending,
    Ready,
    Failed,
}
sqlite_enum!(WorkspaceRepositorySetupStatus {
    Pending => "pending",
    Ready => "ready",
    Failed => "failed"
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepositorySetupRecord {
    pub workspace_id: String,
    pub repository_id: String,
    pub setup_status: WorkspaceRepositorySetupStatus,
    pub plan_json: String,
    pub checkout_identity: Option<String>,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceWorktreeStatus {
    Pending,
    Ready,
    Failed,
}
sqlite_enum!(WorkspaceWorktreeStatus {
    Pending => "pending",
    Ready => "ready",
    Failed => "failed"
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRepositoryWorktree {
    pub workspace_id: String,
    pub repository_id: String,
    pub source_identity: String,
    pub checkout_identity: Option<String>,
    pub branch: String,
    pub base_checkout_path: String,
    pub worktree_path: String,
    pub workspace_link: String,
    pub setup_status: WorkspaceWorktreeStatus,
    pub error_code: Option<String>,
    pub error_detail: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceSessionRole {
    Workspace,
    Orchestrator,
    Worker,
}
sqlite_enum!(WorkspaceSessionRole {
    Workspace => "workspace",
    Orchestrator => "orchestrator",
    Worker => "worker"
});

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSessionContext {
    pub open_code_session_id: String,
    pub workspace_id: String,
    pub role: WorkspaceSessionRole,
    pub repository_id: Option<String>,
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

/// Adds verified repository checkout paths to a workspace's first or follow-up prompt.
/// The workspace home remains the terminal working directory; bound repositories stay
/// at their existing locations and are supplied as explicit context.
pub fn workspace_prompt_with_repository_context(
    prompt: &str,
    workspace_home: &Path,
    bindings: &[WorkspaceRepositoryBinding],
) -> String {
    let context_paths = resolve_workspace_context(workspace_home, bindings);
    let repository_paths = context_paths
        .iter()
        .skip(1)
        .map(|path| path.display().to_string())
        .collect::<Vec<_>>();
    if repository_paths.is_empty() {
        prompt.to_owned()
    } else {
        format!(
            "{prompt}\n\nVerified workspace repository checkouts:\n{}",
            repository_paths.join("\n")
        )
    }
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
        if current_version > 21 {
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
        if current_version < 14 {
            transaction.execute_batch(MIGRATION_14)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (14, 0)",
                [],
            )?;
        }
        if current_version < 15 {
            transaction.execute_batch(MIGRATION_15)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (15, 0)",
                [],
            )?;
        }
        if current_version < 16 {
            transaction.execute_batch(MIGRATION_16)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (16, 0)",
                [],
            )?;
        }
        if current_version < 17 {
            transaction.execute_batch(MIGRATION_17)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (17, 0)",
                [],
            )?;
        }
        if current_version < 18 {
            transaction.execute_batch(MIGRATION_18)?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (18, 0)",
                [],
            )?;
        }
        if current_version < 19 {
            transaction.execute_batch(MIGRATION_19)?;
            Self::archive_legacy_regular_tasks(&transaction, now_millis_for_cleanup())?;
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (19, 0)",
                [],
            )?;
        }
        if current_version < 20 {
            transaction.execute_batch(MIGRATION_20)?;
            let (has_base_checkout_path, has_workspace_link) = {
                let mut columns =
                    transaction.prepare("PRAGMA table_info(workspace_repository_worktrees)")?;
                let names = columns
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                (
                    names.iter().any(|column| column == "base_checkout_path"),
                    names.iter().any(|column| column == "workspace_link"),
                )
            };
            if !has_base_checkout_path {
                transaction.execute(
                    "ALTER TABLE workspace_repository_worktrees
                     ADD COLUMN base_checkout_path TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            if !has_workspace_link {
                transaction.execute(
                    "ALTER TABLE workspace_repository_worktrees
                     ADD COLUMN workspace_link TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (20, 0)",
                [],
            )?;
        }
        if current_version < 21 {
            transaction.execute_batch(MIGRATION_21)?;
            let (has_base_checkout_path, has_workspace_link) = {
                let mut columns =
                    transaction.prepare("PRAGMA table_info(workspace_repository_worktrees)")?;
                let names = columns
                    .query_map([], |row| row.get::<_, String>(1))?
                    .collect::<Result<Vec<_>, _>>()?;
                (
                    names.iter().any(|column| column == "base_checkout_path"),
                    names.iter().any(|column| column == "workspace_link"),
                )
            };
            if !has_base_checkout_path {
                transaction.execute(
                    "ALTER TABLE workspace_repository_worktrees
                     ADD COLUMN base_checkout_path TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            if !has_workspace_link {
                transaction.execute(
                    "ALTER TABLE workspace_repository_worktrees
                     ADD COLUMN workspace_link TEXT NOT NULL DEFAULT ''",
                    [],
                )?;
            }
            transaction.execute(
                "INSERT INTO schema_migrations(version, applied_at) VALUES (21, 0)",
                [],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn archive_legacy_regular_tasks(
        transaction: &rusqlite::Transaction<'_>,
        archived_at: i64,
    ) -> StoreResult<()> {
        let task_ids = transaction
            .prepare(
                "SELECT t.id FROM tasks t
                 JOIN workspaces w ON w.id = t.workspace_id
                 WHERE w.kind = 'regular' AND t.quick_request_created_at IS NULL
                 ORDER BY t.id",
            )?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        for task_id in task_ids {
            let task = Self::get_task_from(transaction, &task_id)?
                .ok_or_else(|| ManagementStoreError::NotFound(format!("task {task_id}")))?;
            let workspace =
                Self::get_workspace_from(transaction, &task.workspace_id)?.ok_or_else(|| {
                    ManagementStoreError::NotFound(format!("workspace {}", task.workspace_id))
                })?;
            let mut snapshot = serde_json::Map::new();
            snapshot.insert("archiveVersion".into(), serde_json::json!(1));
            snapshot.insert(
                "workspace".into(),
                serde_json::to_value(workspace).map_err(|error| {
                    ManagementStoreError::InvalidTransition(format!(
                        "could not serialize workspace archive: {error}"
                    ))
                })?,
            );
            for (table, key_column) in [
                ("tasks", "id"),
                ("task_repositories", "task_id"),
                ("task_repository_selection", "task_id"),
                ("sessions", "owner_task_id"),
                ("task_session_repositories", "task_id"),
                ("cleanup_jobs", "task_id"),
                ("setup_operations", "task_id"),
                ("setup_operation_state", "task_id"),
                ("setup_events", "task_id"),
            ] {
                snapshot.insert(
                    table.into(),
                    rows_as_json(transaction, table, key_column, &task_id)?,
                );
            }
            let snapshot_json = serde_json::Value::Object(snapshot).to_string();
            let verified: serde_json::Value =
                serde_json::from_str(&snapshot_json).map_err(|error| {
                    ManagementStoreError::InvalidTransition(format!(
                        "legacy archive verification failed: {error}"
                    ))
                })?;
            if verified["tasks"]
                .as_array()
                .is_none_or(|rows| rows.len() != 1)
                || verified["tasks"][0]["id"].as_str() != Some(task_id.as_str())
            {
                return Err(ManagementStoreError::InvalidTransition(format!(
                    "legacy archive verification failed for task {task_id}"
                )));
            }
            transaction.execute(
                "INSERT INTO legacy_task_archives(task_id, workspace_id, archived_at, snapshot_json)
                 VALUES (?1, ?2, ?3, ?4)",
                params![task_id, task.workspace_id, archived_at, snapshot_json],
            )?;
            let stored_snapshot: String = transaction.query_row(
                "SELECT snapshot_json FROM legacy_task_archives WHERE task_id = ?1",
                [&task_id],
                |row| row.get(0),
            )?;
            let stored: serde_json::Value =
                serde_json::from_str(&stored_snapshot).map_err(|error| {
                    ManagementStoreError::InvalidTransition(format!(
                        "stored legacy archive is invalid: {error}"
                    ))
                })?;
            if stored != verified {
                return Err(ManagementStoreError::InvalidTransition(format!(
                    "stored legacy archive did not verify for task {task_id}"
                )));
            }
            for (table, key_column) in [
                ("cleanup_jobs", "task_id"),
                ("setup_events", "task_id"),
                ("setup_operation_state", "task_id"),
                ("setup_operations", "task_id"),
                ("task_session_repositories", "task_id"),
                ("task_repository_selection", "task_id"),
            ] {
                transaction.execute(
                    &format!("DELETE FROM {table} WHERE {key_column} = ?1"),
                    [&task_id],
                )?;
            }
            transaction.execute("DELETE FROM sessions WHERE owner_task_id = ?1", [&task_id])?;
            transaction.execute(
                "DELETE FROM task_repositories WHERE task_id = ?1",
                [&task_id],
            )?;
            transaction.execute("DELETE FROM tasks WHERE id = ?1", [&task_id])?;
        }
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

    /// Deletes a user-confirmed empty regular workspace while retaining its
    /// OpenCode-owned conversation. Its local session association is removed;
    /// the OpenCode session itself is never deleted or stopped here.
    pub fn delete_empty_regular_workspace(&self, id: &str) -> StoreResult<()> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let workspace = Self::get_workspace_from(&transaction, id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?;
        if workspace.kind != WorkspaceKind::Regular {
            return Err(ManagementStoreError::InvalidTransition(
                "only regular workspaces can be deleted".into(),
            ));
        }
        let task_count: i64 = transaction.query_row(
            "SELECT COUNT(*) FROM tasks WHERE workspace_id = ?1",
            [id],
            |row| row.get(0),
        )?;
        if task_count != 0 {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace has tasks and cannot be deleted".into(),
            ));
        }
        let configured_root = Self::project_home_root_from(&transaction)?;
        let project_root = safety::resolve_project_home_root(&configured_root, &self.user_home)?;
        safety::remove_empty_managed_home(
            &project_root,
            Path::new(&workspace.home_path),
            "workspace",
            id,
            &["notes", "repos", "tasks"],
        )?;
        transaction.execute(
            "DELETE FROM workspace_repositories WHERE workspace_id = ?1",
            [id],
        )?;
        transaction.execute(
            "DELETE FROM workspace_repository_setup WHERE workspace_id = ?1",
            [id],
        )?;
        transaction.execute("DELETE FROM sessions WHERE owner_workspace_id = ?1", [id])?;
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

    pub fn list_legacy_task_archives(&self) -> StoreResult<Vec<LegacyTaskArchiveSummary>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT task_id, workspace_id, archived_at, restored_at
             FROM legacy_task_archives ORDER BY archived_at, task_id",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(LegacyTaskArchiveSummary {
                task_id: row.get(0)?,
                workspace_id: row.get(1)?,
                archived_at: row.get(2)?,
                restored_at: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn restore_legacy_task_archive(&self, task_id: &str) -> StoreResult<Task> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let archive: Option<(String, Option<i64>)> = transaction
            .query_row(
                "SELECT snapshot_json, restored_at FROM legacy_task_archives WHERE task_id = ?1",
                [task_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (snapshot_json, restored_at) = archive.ok_or_else(|| {
            ManagementStoreError::NotFound(format!("legacy task archive {task_id}"))
        })?;
        if restored_at.is_some() {
            let restored = Self::get_task_from(&transaction, task_id)?.ok_or_else(|| {
                ManagementStoreError::InvalidTransition(
                    "archive is marked restored but its Task is missing".into(),
                )
            })?;
            transaction.commit()?;
            return Ok(restored);
        }
        let snapshot: serde_json::Value =
            serde_json::from_str(&snapshot_json).map_err(|error| {
                ManagementStoreError::InvalidTransition(format!(
                    "legacy task archive is malformed: {error}"
                ))
            })?;
        if snapshot["archiveVersion"].as_i64() != Some(1)
            || snapshot["tasks"][0]["id"].as_str() != Some(task_id)
        {
            return Err(ManagementStoreError::InvalidTransition(
                "legacy task archive has an unsupported or mismatched version".into(),
            ));
        }
        let workspace_id = transaction.query_row(
            "SELECT workspace_id FROM legacy_task_archives WHERE task_id = ?1",
            [task_id],
            |row| row.get::<_, String>(0),
        )?;
        if Self::get_workspace_from(&transaction, &workspace_id)?.is_none() {
            return Err(ManagementStoreError::InvalidTransition(
                "the archived Task's Workspace is unavailable; source data remains in the archive"
                    .into(),
            ));
        }
        if Self::get_task_from(&transaction, task_id)?.is_some() {
            return Err(ManagementStoreError::InvalidTransition(
                "a Task with this ID already exists".into(),
            ));
        }
        for table in [
            "tasks",
            "task_repositories",
            "sessions",
            "task_session_repositories",
            "task_repository_selection",
            "setup_operations",
            "setup_events",
            "setup_operation_state",
            "cleanup_jobs",
        ] {
            restore_json_rows(&transaction, table, &snapshot[table])?;
        }
        transaction.execute(
            "UPDATE legacy_task_archives SET restored_at = ?2 WHERE task_id = ?1",
            params![task_id, now_millis_for_cleanup()],
        )?;
        let restored = Self::get_task_from(&transaction, task_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("restored Task {task_id}")))?;
        transaction.commit()?;
        Ok(restored)
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
        let repositories = Self::list_all_repositories_from(&connection)?;
        let mut allowed = Vec::new();
        for repository in repositories {
            let disallowed: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM repository_disallowed WHERE repository_id = ?1)",
                [&repository.id],
                |row| row.get(0),
            )?;
            if !disallowed {
                allowed.push(repository);
            }
        }
        Ok(allowed)
    }

    fn list_all_repositories_from(connection: &Connection) -> StoreResult<Vec<Repository>> {
        let mut statement = connection.prepare(
            "SELECT id, name, repository_path, repository_identity, purpose, purpose_status,
                    created_at, updated_at FROM repository_catalog ORDER BY name, id",
        )?;
        let rows = statement.query_map([], repository_from_row)?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    fn list_repository_scan_directories_from(
        connection: &Connection,
    ) -> StoreResult<Vec<RepositoryScanDirectory>> {
        let mut statement =
            connection.prepare("SELECT path FROM repository_scan_directories ORDER BY path")?;
        let rows = statement.query_map([], |row| {
            Ok(RepositoryScanDirectory {
                path: row.get(0)?,
                repositories: Vec::new(),
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn repository_directory_page(&self) -> StoreResult<RepositoryDirectoryPage> {
        let connection = self.lock()?;
        let mut directories = Self::list_repository_scan_directories_from(&connection)?;
        let all_repositories = Self::list_all_repositories_from(&connection)?;
        let roots = directories
            .iter()
            .enumerate()
            .map(|(index, directory)| (index, PathBuf::from(&directory.path)))
            .collect::<Vec<_>>();
        for repository in all_repositories {
            let disallowed: bool = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM repository_disallowed WHERE repository_id = ?1)",
                [&repository.id],
                |row| row.get(0),
            )?;
            let repository_path = Path::new(&repository.repository_path);
            if let Some((index, _)) = roots
                .iter()
                .filter(|(_, root)| repository_path.starts_with(root))
                .max_by_key(|(_, root)| root.components().count())
            {
                directories[*index]
                    .repositories
                    .push(RepositoryDirectoryEntry {
                        repository,
                        enabled: !disallowed,
                    });
            }
        }
        Ok(RepositoryDirectoryPage { directories })
    }

    pub fn add_repository_scan_directory(
        &self,
        path: &Path,
        updated_at: i64,
    ) -> StoreResult<RepositoryScanDirectory> {
        let canonical_path = fs::canonicalize(path)?;
        if !canonical_path.is_dir() {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                "repository scan directory is not a directory".into(),
            )));
        }
        let project_home = self.resolved_project_home_root()?;
        if canonical_path.starts_with(&project_home) {
            return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                format!(
                    "cannot add a scan directory inside OpenCode Projects ({})",
                    project_home.display()
                ),
            )));
        }
        let path = path_to_string(&canonical_path)?;
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO repository_scan_directories(path, created_at, updated_at)
             VALUES (?1, ?2, ?2)
             ON CONFLICT(path) DO UPDATE SET updated_at = excluded.updated_at",
            params![path, updated_at],
        )?;
        Ok(RepositoryScanDirectory {
            path,
            repositories: Vec::new(),
        })
    }

    pub fn set_repository_enabled(
        &self,
        repository_id: &str,
        enabled: bool,
        updated_at: i64,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        let repository = Self::get_repository_from(&connection, repository_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("repository {repository_id}")))?;
        if enabled {
            connection.execute(
                "DELETE FROM repository_disallowed WHERE repository_id = ?1",
                [repository_id],
            )?;
        } else {
            connection.execute(
                "INSERT INTO repository_disallowed(repository_id, created_at) VALUES (?1, ?2)
                 ON CONFLICT(repository_id) DO NOTHING",
                params![repository.id, updated_at],
            )?;
        }
        Ok(())
    }

    pub fn repository_is_disallowed(&self, repository_identity: &str) -> StoreResult<bool> {
        let connection = self.lock()?;
        Ok(connection.query_row(
            "SELECT EXISTS(
                 SELECT 1 FROM repository_disallowed d
                 JOIN repository_catalog r ON r.id = d.repository_id
                 WHERE r.repository_identity = ?1
             )",
            [repository_identity],
            |row| row.get(0),
        )?)
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
        let recorded_worktree = if binding.checkout_mode == CheckoutMode::Clone {
            connection
                .query_row(
                    "SELECT workspace_id, repository_id, source_identity, checkout_identity,
                            branch, base_checkout_path, worktree_path, workspace_link,
                            setup_status, error_code, error_detail, created_at, updated_at
                     FROM workspace_repository_worktrees
                     WHERE workspace_id = ?1 AND repository_id = ?2",
                    params![binding.workspace_id, binding.repository_id],
                    |row| {
                        Ok(WorkspaceRepositoryWorktree {
                            workspace_id: row.get(0)?,
                            repository_id: row.get(1)?,
                            source_identity: row.get(2)?,
                            checkout_identity: row.get(3)?,
                            branch: row.get(4)?,
                            base_checkout_path: row.get(5)?,
                            worktree_path: row.get(6)?,
                            workspace_link: row.get(7)?,
                            setup_status: row.get(8)?,
                            error_code: row.get(9)?,
                            error_detail: row.get(10)?,
                            created_at: row.get(11)?,
                            updated_at: row.get(12)?,
                        })
                    },
                )
                .optional()?
        } else {
            None
        };
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
            CheckoutMode::Clone if checkout.repository.identity == catalog.repository_identity => {
                return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                    "independent workspace clone shares the source Git identity".into(),
                )));
            }
            CheckoutMode::Clone => {}
        }
        let persisted_default_branch;
        let default_branch = if binding.checkout_mode == CheckoutMode::Clone {
            persisted_default_branch = binding.branch.clone();
            Some(persisted_default_branch.as_str())
        } else {
            checkout.repository.default_branch.as_deref()
        };
        let Some(default_branch) = default_branch else {
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
        let branch = safety::inspect_branch(Path::new(&binding.checkout_path), &binding.branch)?;
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
            CheckoutMode::Managed | CheckoutMode::Clone => {
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
                let canonical_checkout = if let Some(record) = recorded_worktree.as_ref() {
                    verify_workspace_library_worktree_binding(
                        &workspace,
                        &catalog,
                        binding,
                        &checkout,
                        &branch,
                        &repos_root,
                        record,
                    )?
                } else {
                    let canonical = safety::canonical_descendant(
                        &repos_root,
                        &checkout.repository.canonical_root,
                    )?;
                    if canonical == repos_root || canonical != checkout.repository.canonical_root {
                        return Err(ManagementStoreError::Safety(SafetyError::InvalidPath(
                            "managed checkout must be a canonical child of workspace repos/".into(),
                        )));
                    }
                    canonical
                };
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
        self.save_workspace_repository_binding(&canonical_binding)?;
        self.save_workspace_repository_checkout_metadata(&WorkspaceRepositoryCheckoutMetadata {
            workspace_id: binding.workspace_id.clone(),
            repository_id: binding.repository_id.clone(),
            checkout_path: path_to_string(&checkout.repository.canonical_root)?,
            source_identity: catalog.repository_identity,
            checkout_identity: checkout.repository.identity.clone(),
            default_branch: default_branch.to_owned(),
        })
    }

    pub(crate) fn save_workspace_repository_binding(
        &self,
        binding: &WorkspaceRepositoryBinding,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO workspace_repositories(
                workspace_id, repository_id, checkout_path, checkout_mode, branch, verification_status,
                source_identity, checkout_identity, default_branch, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6,
                (SELECT repository_identity FROM repository_catalog WHERE id = ?2),
                (SELECT repository_identity FROM repository_catalog WHERE id = ?2), ?5, ?7)
             ON CONFLICT(workspace_id, repository_id) DO UPDATE SET
                checkout_path = excluded.checkout_path,
                checkout_mode = excluded.checkout_mode,
                branch = excluded.branch,
                verification_status = excluded.verification_status,
                source_identity = excluded.source_identity,
                checkout_identity = excluded.checkout_identity,
                default_branch = excluded.default_branch",
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

    pub fn workspace_repository_checkout_metadata(
        &self,
        workspace_id: &str,
        repository_id: &str,
    ) -> StoreResult<Option<WorkspaceRepositoryCheckoutMetadata>> {
        let connection = self.lock()?;
        Ok(connection
            .query_row(
                "SELECT workspace_id, repository_id, checkout_path, source_identity, checkout_identity, default_branch
                 FROM workspace_repositories WHERE workspace_id = ?1 AND repository_id = ?2",
                params![workspace_id, repository_id],
                |row| {
                    Ok(WorkspaceRepositoryCheckoutMetadata {
                        workspace_id: row.get(0)?,
                        repository_id: row.get(1)?,
                        checkout_path: row.get(2)?,
                        source_identity: row.get(3)?,
                        checkout_identity: row.get(4)?,
                        default_branch: row.get(5)?,
                    })
                },
            )
            .optional()?)
    }

    pub fn save_workspace_repository_checkout_metadata(
        &self,
        metadata: &WorkspaceRepositoryCheckoutMetadata,
    ) -> StoreResult<()> {
        if metadata.source_identity.is_empty()
            || metadata.checkout_identity.is_empty()
            || metadata.default_branch.is_empty()
        {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace checkout metadata must include both Git identities and its default branch".into(),
            ));
        }
        let connection = self.lock()?;
        let changed = connection.execute(
            "UPDATE workspace_repositories
             SET source_identity = ?3, checkout_identity = ?4, default_branch = ?5
             WHERE workspace_id = ?1 AND repository_id = ?2",
            params![
                metadata.workspace_id,
                metadata.repository_id,
                metadata.source_identity,
                metadata.checkout_identity,
                metadata.default_branch,
            ],
        )?;
        if changed != 1 {
            return Err(ManagementStoreError::NotFound(format!(
                "workspace repository binding {} / {}",
                metadata.workspace_id, metadata.repository_id
            )));
        }
        Ok(())
    }

    pub fn save_workspace_repository_setup(
        &self,
        record: &WorkspaceRepositorySetupRecord,
    ) -> StoreResult<()> {
        if record.setup_status == WorkspaceRepositorySetupStatus::Failed
            && record.error_detail.as_deref().is_none_or(str::is_empty)
        {
            return Err(ManagementStoreError::InvalidTransition(
                "failed repository setup requires error detail".into(),
            ));
        }
        if record.setup_status == WorkspaceRepositorySetupStatus::Ready
            && record
                .checkout_identity
                .as_deref()
                .is_none_or(str::is_empty)
        {
            return Err(ManagementStoreError::InvalidTransition(
                "ready repository setup requires a verified checkout identity".into(),
            ));
        }
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO workspace_repository_setup(
                workspace_id, repository_id, setup_status, plan_json, checkout_identity,
                error_code, error_detail, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(workspace_id, repository_id) DO UPDATE SET
                setup_status = excluded.setup_status,
                plan_json = excluded.plan_json,
                checkout_identity = excluded.checkout_identity,
                error_code = excluded.error_code,
                error_detail = excluded.error_detail,
                updated_at = excluded.updated_at",
            params![
                record.workspace_id,
                record.repository_id,
                record.setup_status.as_str(),
                record.plan_json,
                record.checkout_identity,
                record.error_code,
                record.error_detail,
                record.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_workspace_repository_setups(
        &self,
        workspace_id: &str,
    ) -> StoreResult<Vec<WorkspaceRepositorySetupRecord>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT workspace_id, repository_id, setup_status, plan_json, checkout_identity,
                    error_code, error_detail, updated_at
             FROM workspace_repository_setup WHERE workspace_id = ?1 ORDER BY repository_id",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(WorkspaceRepositorySetupRecord {
                workspace_id: row.get(0)?,
                repository_id: row.get(1)?,
                setup_status: row.get(2)?,
                plan_json: row.get(3)?,
                checkout_identity: row.get(4)?,
                error_code: row.get(5)?,
                error_detail: row.get(6)?,
                updated_at: row.get(7)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn save_workspace_repository_worktree(
        &self,
        worktree: &WorkspaceRepositoryWorktree,
    ) -> StoreResult<()> {
        let paths_are_safe = [
            worktree.base_checkout_path.as_str(),
            worktree.worktree_path.as_str(),
            worktree.workspace_link.as_str(),
        ]
        .iter()
        .all(|path| {
            let path = Path::new(path);
            path.is_absolute()
                && !path.as_os_str().is_empty()
                && path.components().all(|component| {
                    !matches!(
                        component,
                        std::path::Component::ParentDir | std::path::Component::CurDir
                    )
                })
        });
        if worktree.workspace_id.is_empty()
            || worktree.repository_id.is_empty()
            || worktree.source_identity.is_empty()
            || worktree.branch.is_empty()
            || worktree.base_checkout_path.is_empty()
            || worktree.worktree_path.is_empty()
            || worktree.workspace_link.is_empty()
            || !paths_are_safe
            || worktree.base_checkout_path == worktree.worktree_path
            || worktree.worktree_path == worktree.workspace_link
            || (worktree.setup_status == WorkspaceWorktreeStatus::Ready
                && worktree
                    .checkout_identity
                    .as_deref()
                    .is_none_or(str::is_empty))
            || (worktree.setup_status == WorkspaceWorktreeStatus::Failed
                && worktree.error_detail.as_deref().is_none_or(str::is_empty))
        {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace worktree state is incomplete".into(),
            ));
        }
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO workspace_repository_worktrees(
                workspace_id, repository_id, source_identity, checkout_identity,
                branch, base_checkout_path, worktree_path, workspace_link,
                setup_status, error_code, error_detail, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
             ON CONFLICT(workspace_id, repository_id) DO UPDATE SET
                source_identity = excluded.source_identity,
                checkout_identity = excluded.checkout_identity,
                branch = excluded.branch, base_checkout_path = excluded.base_checkout_path,
                worktree_path = excluded.worktree_path, workspace_link = excluded.workspace_link,
                setup_status = excluded.setup_status, error_code = excluded.error_code,
                error_detail = excluded.error_detail, updated_at = excluded.updated_at",
            params![
                worktree.workspace_id,
                worktree.repository_id,
                worktree.source_identity,
                worktree.checkout_identity,
                worktree.branch,
                worktree.base_checkout_path,
                worktree.worktree_path,
                worktree.workspace_link,
                worktree.setup_status.as_str(),
                worktree.error_code,
                worktree.error_detail,
                worktree.created_at,
                worktree.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn list_workspace_repository_worktrees(
        &self,
        workspace_id: &str,
    ) -> StoreResult<Vec<WorkspaceRepositoryWorktree>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT workspace_id, repository_id, source_identity, checkout_identity,
                    branch, base_checkout_path, worktree_path, workspace_link,
                    setup_status, error_code, error_detail, created_at, updated_at
             FROM workspace_repository_worktrees WHERE workspace_id = ?1 ORDER BY repository_id",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(WorkspaceRepositoryWorktree {
                workspace_id: row.get(0)?,
                repository_id: row.get(1)?,
                source_identity: row.get(2)?,
                checkout_identity: row.get(3)?,
                branch: row.get(4)?,
                base_checkout_path: row.get(5)?,
                worktree_path: row.get(6)?,
                workspace_link: row.get(7)?,
                setup_status: row.get(8)?,
                error_code: row.get(9)?,
                error_detail: row.get(10)?,
                created_at: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn save_workspace_session_context(
        &self,
        context: &WorkspaceSessionContext,
    ) -> StoreResult<()> {
        let repository_is_valid = match context.role {
            WorkspaceSessionRole::Workspace | WorkspaceSessionRole::Orchestrator => {
                context.repository_id.is_none()
            }
            WorkspaceSessionRole::Worker => context
                .repository_id
                .as_deref()
                .is_some_and(|repository_id| !repository_id.is_empty()),
        };
        if !repository_is_valid {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace/orchestrator sessions have no repository; worker sessions require one"
                    .into(),
            ));
        }
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO workspace_session_context(open_code_session_id, workspace_id, role, repository_id)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                context.open_code_session_id,
                context.workspace_id,
                context.role.as_str(),
                context.repository_id,
            ],
        )?;
        Ok(())
    }

    pub fn list_workspace_session_context(
        &self,
        workspace_id: &str,
    ) -> StoreResult<Vec<WorkspaceSessionContext>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT open_code_session_id, workspace_id, role, repository_id
             FROM workspace_session_context WHERE workspace_id = ?1
             ORDER BY CASE role WHEN 'workspace' THEN 0 WHEN 'orchestrator' THEN 1 ELSE 2 END, repository_id",
        )?;
        let rows = statement.query_map([workspace_id], |row| {
            Ok(WorkspaceSessionContext {
                open_code_session_id: row.get(0)?,
                workspace_id: row.get(1)?,
                role: row.get(2)?,
                repository_id: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    pub fn replace_workspace_tags(
        &self,
        workspace_id: &str,
        tags: &[String],
        created_at: i64,
    ) -> StoreResult<Vec<String>> {
        let mut normalized = tags
            .iter()
            .map(|tag| tag.trim().to_owned())
            .filter(|tag| !tag.is_empty())
            .collect::<Vec<_>>();
        normalized.sort_by_key(|tag| tag.to_lowercase());
        normalized.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        if normalized.iter().any(|tag| tag.chars().count() > 80) {
            return Err(ManagementStoreError::InvalidTransition(
                "workspace tags must be 80 characters or fewer".into(),
            ));
        }
        let mut connection = self.lock()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?1 AND kind = 'regular')",
            [workspace_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(ManagementStoreError::NotFound(format!(
                "workspace {workspace_id}"
            )));
        }
        transaction.execute(
            "DELETE FROM workspace_tags WHERE workspace_id = ?1",
            [workspace_id],
        )?;
        for tag in &normalized {
            transaction.execute(
                "INSERT INTO workspace_tags(workspace_id, tag, created_at) VALUES (?1, ?2, ?3)",
                params![workspace_id, tag, created_at],
            )?;
        }
        transaction.commit()?;
        Ok(normalized)
    }

    pub fn list_workspace_tags(&self, workspace_id: &str) -> StoreResult<Vec<String>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT tag FROM workspace_tags WHERE workspace_id = ?1 ORDER BY tag COLLATE NOCASE",
        )?;
        let rows = statement.query_map([workspace_id], |row| row.get(0))?;
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
            "INSERT INTO workspace_repositories(
                workspace_id, repository_id, checkout_path, checkout_mode, branch, verification_status,
                source_identity, checkout_identity, default_branch, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'failed',
                (SELECT repository_identity FROM repository_catalog WHERE id = ?2),
                (SELECT repository_identity FROM repository_catalog WHERE id = ?2), ?5, ?6)
             ON CONFLICT(workspace_id, repository_id) DO UPDATE SET
                checkout_path=excluded.checkout_path, checkout_mode=excluded.checkout_mode,
                branch=excluded.branch, verification_status='failed',
                source_identity=excluded.source_identity, checkout_identity=excluded.checkout_identity,
                default_branch=excluded.default_branch",
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
        let _catalog =
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

        let (workspace_checkout_path, workspace_checkout_identity): (String, String) = connection
            .query_row(
                "SELECT checkout_path, checkout_identity FROM workspace_repositories
                 WHERE workspace_id = ?1 AND repository_id = ?2 AND verification_status = 'verified'",
                params![task.workspace_id, binding.repository_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| ManagementStoreError::InvalidTransition(
                "task repository is not bound to a verified workspace checkout".into(),
            ))?;
        let workspace_checkout = safety::inspect_repository(Path::new(&workspace_checkout_path))?;
        if workspace_checkout.repository.identity != workspace_checkout_identity {
            return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                "workspace checkout identity differs from its persisted binding".into(),
            )));
        }
        let worktree_inspection = safety::inspect_repository(&canonical_worktree)?;
        if worktree_inspection.repository.identity != workspace_checkout_identity {
            return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                format!(
                    "worktree {} belongs to {}, expected {}",
                    canonical_worktree.display(),
                    worktree_inspection.repository.identity,
                    workspace_checkout_identity
                ),
            )));
        }
        let branch = safety::inspect_branch(Path::new(&workspace_checkout_path), &binding.branch)?;
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
                    AND t.workspace_id = (SELECT workspace_id FROM tasks WHERE id = ?3)
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
                    let _catalog = Self::get_repository_from(&transaction, &item.repository_id)?
                        .ok_or_else(|| {
                            ManagementStoreError::NotFound(format!(
                                "repository {}",
                                item.repository_id
                            ))
                        })?;
                    let reported =
                        safety::canonicalize_or_resolve_missing(Path::new(&item.repository_path))?;
                    let (workspace_checkout_path, workspace_checkout_identity): (String, String) = transaction
                        .query_row(
                            "SELECT checkout_path, checkout_identity FROM workspace_repositories
                             WHERE workspace_id = ?1 AND repository_id = ?2 AND verification_status = 'verified'",
                            params![task.workspace_id, item.repository_id],
                            |row| Ok((row.get(0)?, row.get(1)?)),
                        )
                        .optional()?
                        .ok_or_else(|| ManagementStoreError::InvalidTransition(
                            "task repository is not bound to a verified workspace checkout".into(),
                        ))?;
                    let expected = safety::canonicalize_or_resolve_missing(Path::new(
                        &workspace_checkout_path,
                    ))?;
                    if reported != expected {
                        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                            "reported repository path does not match the workspace checkout".into(),
                        )));
                    }
                    let inspection = safety::inspect_repository(Path::new(&item.repository_path))?;
                    if inspection.repository.identity != item.git_identity
                        || inspection.repository.identity != workspace_checkout_identity
                    {
                        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
                            "reported Git identity does not match the workspace checkout".into(),
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

    /// Atomically records a replacement session, transfers a Task repository
    /// binding when present, and retires the stale session association.
    pub fn replace_missing_session(
        &self,
        old_session_id: &str,
        replacement: &NewSession,
        selected_model: &str,
        updated_at: i64,
    ) -> StoreResult<SessionRecord> {
        let mut connection = self.lock()?;
        let transaction = connection.transaction()?;
        let old = Self::get_session_from(&transaction, old_session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("session {old_session_id}")))?;
        if old.last_known_status == "missing"
            || old.owner != replacement.owner
            || old.directory != replacement.directory
        {
            return Err(ManagementStoreError::InvalidTransition(
                "replacement must retain the active owner and exact directory of a non-missing session".into(),
            ));
        }
        Self::insert_session_with_model(&transaction, replacement, Some(selected_model))?;

        if let SessionOwner::Task(task_id) = &replacement.owner {
            let changed = transaction.execute(
                "UPDATE task_session_repositories
                 SET open_code_session_id = ?3
                 WHERE task_id = ?1 AND open_code_session_id = ?2",
                params![task_id, old_session_id, replacement.open_code_session_id],
            )?;
            if changed != 1 {
                return Err(ManagementStoreError::InvalidTransition(
                    "missing Task session has no current repository association".into(),
                ));
            }
            let new = Self::get_session_from(&transaction, &replacement.open_code_session_id)?
                .expect("replacement session was inserted");
            let association_matches: bool = transaction.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM task_session_repositories tsr
                    JOIN task_repositories tr USING(task_id, repository_id)
                    WHERE tsr.open_code_session_id = ?1 AND tr.setup_status = 'ready'
                      AND tr.worktree_path = ?2
                )",
                params![replacement.open_code_session_id, new.directory],
                |row| row.get(0),
            )?;
            if !association_matches {
                return Err(ManagementStoreError::InvalidTransition(
                    "replacement session directory does not match its ready Task worktree".into(),
                ));
            }
        }
        transaction.execute(
            "UPDATE sessions SET last_known_status = 'missing',
                 reconciliation_status = 'missing', reconciliation_uncertain = 0,
                 pending_input_json = NULL, updated_at = ?2
             WHERE open_code_session_id = ?1",
            params![old_session_id, updated_at],
        )?;
        let result = Self::get_session_from(&transaction, &replacement.open_code_session_id)?
            .ok_or_else(|| {
                ManagementStoreError::NotFound(format!(
                    "replacement session {}",
                    replacement.open_code_session_id
                ))
            })?;
        transaction.commit()?;
        Ok(result)
    }

    pub fn bind_task_session_repository(
        &self,
        task_id: &str,
        session_id: &str,
        repository_id: &str,
    ) -> StoreResult<()> {
        let connection = self.lock()?;
        let task = Self::get_task_from(&connection, task_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("task {task_id}")))?;
        let session = Self::get_session_from(&connection, session_id)?
            .ok_or_else(|| ManagementStoreError::NotFound(format!("session {session_id}")))?;
        if session.owner != SessionOwner::Task(task_id.to_owned()) {
            return Err(ManagementStoreError::InvalidTransition(
                "repository session must be owned by the selected task".into(),
            ));
        }
        let binding_exists: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM task_repositories WHERE task_id = ?1 AND repository_id = ?2 AND setup_status = 'ready')",
            params![task_id, repository_id],
            |row| row.get(0),
        )?;
        if !binding_exists || session.directory != connection.query_row::<String, _, _>(
            "SELECT worktree_path FROM task_repositories WHERE task_id = ?1 AND repository_id = ?2",
            params![task_id, repository_id],
            |row| row.get(0),
        )? {
            return Err(ManagementStoreError::InvalidTransition(
                "session directory does not match the ready task repository worktree".into(),
            ));
        }
        connection.execute(
            "INSERT INTO task_session_repositories(open_code_session_id, task_id, repository_id) VALUES (?1, ?2, ?3)",
            params![session_id, task.id, repository_id],
        )?;
        Ok(())
    }

    pub fn save_task_repository_selection(
        &self,
        task_id: &str,
        repository_ids: &[String],
        created_at: i64,
    ) -> StoreResult<()> {
        let encoded = serde_json::to_string(repository_ids)
            .map_err(|error| ManagementStoreError::InvalidTransition(error.to_string()))?;
        let connection = self.lock()?;
        connection.execute(
            "INSERT INTO task_repository_selection(task_id, repository_ids_json, created_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(task_id) DO NOTHING",
            params![task_id, encoded, created_at],
        )?;
        let stored: String = connection.query_row(
            "SELECT repository_ids_json FROM task_repository_selection WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )?;
        if stored != encoded {
            return Err(ManagementStoreError::InvalidTransition(
                "confirmed task repository selection cannot be changed".into(),
            ));
        }
        Ok(())
    }

    pub fn task_repository_selection(&self, task_id: &str) -> StoreResult<Option<Vec<String>>> {
        let connection = self.lock()?;
        let encoded: Option<String> = connection
            .query_row(
                "SELECT repository_ids_json FROM task_repository_selection WHERE task_id = ?1",
                [task_id],
                |row| row.get(0),
            )
            .optional()?;
        encoded
            .map(|value| {
                serde_json::from_str(&value)
                    .map_err(|error| ManagementStoreError::InvalidTransition(error.to_string()))
            })
            .transpose()
    }

    pub fn list_task_repository_sessions(
        &self,
        task_id: &str,
    ) -> StoreResult<Vec<(String, String, String)>> {
        let connection = self.lock()?;
        let mut statement = connection.prepare(
            "SELECT open_code_session_id, repository_id, directory FROM task_session_repositories
             JOIN sessions USING(open_code_session_id) WHERE task_id = ?1 ORDER BY repository_id",
        )?;
        let rows =
            statement.query_map([task_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
        let owner_context_matches = match &session.owner {
            SessionOwner::Workspace(id) => {
                let workspace = self
                    .get_workspace(id)?
                    .ok_or_else(|| ManagementStoreError::NotFound(format!("workspace {id}")))?;
                let home =
                    safety::canonicalize_or_resolve_missing(Path::new(&workspace.home_path))?;
                let mut allowed = vec![home];
                allowed.extend(
                    self.list_workspace_repository_bindings(id)?
                        .into_iter()
                        .filter(|binding| {
                            binding.verification_status == VerificationStatus::Verified
                        })
                        .map(|binding| {
                            safety::canonicalize_or_resolve_missing(Path::new(
                                &binding.checkout_path,
                            ))
                            .map_err(Into::into)
                        })
                        .collect::<StoreResult<Vec<_>>>()?,
                );
                allowed.contains(&actual)
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
                    let owner_path = self
                        .get_workspace(&task.workspace_id)?
                        .ok_or_else(|| {
                            ManagementStoreError::NotFound(format!(
                                "workspace {}",
                                task.workspace_id
                            ))
                        })?
                        .home_path;
                    actual == safety::canonicalize_or_resolve_missing(Path::new(&owner_path))?
                } else {
                    let task_home =
                        safety::canonicalize_or_resolve_missing(Path::new(&task.home_path))?;
                    let bindings = self.list_task_repository_bindings(id)?;
                    let repository_sessions = self.list_task_repository_sessions(id)?;
                    let mut registered_session_worktrees = Vec::new();
                    for (bound_session_id, repository_id, session_directory) in repository_sessions
                    {
                        if bound_session_id != session_id {
                            continue;
                        }
                        let Some(binding) = bindings.iter().find(|binding| {
                            binding.repository_id == repository_id
                                && binding.setup_status == RepositorySetupStatus::Ready
                        }) else {
                            continue;
                        };
                        let session_path =
                            safety::canonicalize_or_resolve_missing(Path::new(&session_directory))?;
                        let worktree_path = safety::canonicalize_or_resolve_missing(Path::new(
                            &binding.worktree_path,
                        ))?;
                        if session_path == worktree_path {
                            registered_session_worktrees.push(worktree_path);
                        }
                    }
                    actual == task_home || registered_session_worktrees.contains(&actual)
                }
            }
        };
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
        if !owner_context_matches && !historical_quick && !historical_quick_request_session {
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
             WHERE reconciliation_status NOT IN ('failed', 'missing')
               AND last_known_status != 'missing'",
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
                        let task = self
                            .get_task(&job.task_id)
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "task record is missing".to_owned())?;
                        let checkout = self
                            .workspace_repository_checkout_metadata(
                                &task.workspace_id,
                                &job.repository_id,
                            )
                            .map_err(|error| error.to_string())?
                            .ok_or_else(|| "workspace repository checkout is missing".to_owned())?;
                        safety::remove_clean_worktree(
                            Path::new(&checkout.checkout_path),
                            Path::new(&canonical_path),
                            &branch_retained,
                        )
                        .map_err(|e| format!("{}: {e}", repo.name))
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
        let Some(_repository) = Self::get_repository_from(&connection, repository_id)? else {
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
        let (workspace_checkout_path, workspace_checkout_identity): (String, String) =
            match connection
                .query_row(
                    "SELECT checkout_path, checkout_identity FROM workspace_repositories
             WHERE workspace_id = ?1 AND repository_id = ?2 AND verification_status = 'verified'",
                    params![task.workspace_id, repository_id],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
            {
                Some(metadata) => metadata,
                None => {
                    return Ok(CleanupPlan::Failed {
                        reason: "verified workspace checkout is missing".into(),
                    })
                }
            };
        let checkout_inspection =
            match safety::inspect_repository(Path::new(&workspace_checkout_path)) {
                Ok(inspection) => inspection,
                Err(error) => {
                    return Ok(CleanupPlan::Failed {
                        reason: error.to_string(),
                    })
                }
            };
        if checkout_inspection.repository.identity != workspace_checkout_identity {
            return Ok(CleanupPlan::Failed {
                reason: "workspace checkout identity differs from its persisted binding".into(),
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
        if worktree_inspection.repository.identity != workspace_checkout_identity {
            return Ok(CleanupPlan::Failed {
                reason: format!(
                    "worktree repository identity {} does not match workspace checkout identity {}",
                    worktree_inspection.repository.identity, workspace_checkout_identity
                ),
            });
        }
        let branch =
            match safety::inspect_branch(Path::new(&workspace_checkout_path), &binding.branch) {
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
        let Some(worktree_state) = checkout_inspection
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
        } else if key == "repository_library_root" {
            safety::resolve_repository_library_root(value, &self.user_home)?;
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

    /// Canonical location reserved for managed workspaces and task worktrees.
    pub fn resolved_project_home_root(&self) -> StoreResult<PathBuf> {
        let connection = self.lock()?;
        let configured = Self::project_home_root_from(&connection)?;
        Ok(safety::resolve_project_home_root(
            &configured,
            &self.user_home,
        )?)
    }

    pub fn set_project_home_root(&self, value: &str, updated_at: i64) -> StoreResult<String> {
        self.set_setting("project_home_root", value, updated_at)?;
        Ok(value.to_owned())
    }

    pub fn repository_library_root(&self) -> StoreResult<String> {
        let connection = self.lock()?;
        connection
            .query_row(
                "SELECT value FROM settings WHERE key = 'repository_library_root'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map(|value| value.unwrap_or_else(|| DEFAULT_REPOSITORY_LIBRARY_ROOT.to_owned()))
            .map_err(Into::into)
    }

    pub fn resolved_repository_library_root(&self) -> StoreResult<PathBuf> {
        Ok(safety::resolve_repository_library_root(
            &self.repository_library_root()?,
            &self.user_home,
        )?)
    }

    pub fn set_repository_library_root(&self, value: &str, updated_at: i64) -> StoreResult<String> {
        self.set_setting("repository_library_root", value, updated_at)?;
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

fn verify_workspace_library_worktree_binding(
    workspace: &Workspace,
    catalog: &Repository,
    binding: &WorkspaceRepositoryBinding,
    checkout: &GitInspection,
    branch: &safety::GitBranchInfo,
    repos_root: &Path,
    record: &WorkspaceRepositoryWorktree,
) -> StoreResult<PathBuf> {
    let invalid =
        |message: &str| ManagementStoreError::Safety(SafetyError::InvalidPath(message.to_owned()));
    if record.workspace_id != workspace.id
        || record.repository_id != catalog.id
        || record.source_identity != catalog.repository_identity
        || record.setup_status != WorkspaceWorktreeStatus::Ready
        || record.branch != binding.branch
        || record.checkout_identity.as_deref() != Some(checkout.repository.identity.as_str())
    {
        return Err(invalid(
            "Workspace worktree record does not match its verified repository binding",
        ));
    }

    let base_path = Path::new(&record.base_checkout_path);
    let worktree_path = Path::new(&record.worktree_path);
    let link_path = Path::new(&record.workspace_link);
    for path in [base_path, worktree_path, link_path] {
        if !path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir | std::path::Component::CurDir
                )
            })
        {
            return Err(invalid("Workspace repository path is not normalized"));
        }
    }
    let base_name = base_path
        .file_name()
        .ok_or_else(|| invalid("Managed repository base has no name"))?;
    let base_parent = base_path
        .parent()
        .ok_or_else(|| invalid("Managed repository base has no parent"))?;
    let expected_worktree = base_parent
        .join(format!("{}.worktrees", base_name.to_string_lossy()))
        .join(&workspace.id);
    if worktree_path != expected_worktree
        || base_path.starts_with(&workspace.home_path)
        || worktree_path.starts_with(&workspace.home_path)
    {
        return Err(invalid(
            "Managed Workspace worktree is not beside its shared repository base",
        ));
    }
    let canonical_base = fs::canonicalize(base_path)?;
    let canonical_worktree = fs::canonicalize(worktree_path)?;
    if canonical_base != base_path
        || canonical_worktree != worktree_path
        || checkout.repository.canonical_root != worktree_path
    {
        return Err(invalid(
            "Managed base and Workspace worktree must use their canonical paths",
        ));
    }
    let base = safety::inspect_repository(&canonical_base)?;
    if base.repository.canonical_root != canonical_base
        || base.repository.identity != checkout.repository.identity
        || !base.worktrees.iter().any(|worktree| {
            worktree.canonical_path == canonical_worktree
                && worktree.branch.as_deref() == Some(binding.branch.as_str())
        })
    {
        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
            "Workspace worktree is not owned by its recorded shared repository base".into(),
        )));
    }

    let relative_link = link_path
        .strip_prefix(repos_root)
        .map_err(|_| invalid("Workspace repository symlink must be inside workspace repos/"))?;
    if relative_link.as_os_str().is_empty()
        || relative_link
            .components()
            .any(|component| !matches!(component, std::path::Component::Normal(_)))
        || link_path.file_name() != Some(base_name)
    {
        return Err(invalid(
            "Workspace repository symlink path is not a valid managed alias",
        ));
    }
    let link_parent = link_path
        .parent()
        .ok_or_else(|| invalid("Workspace repository symlink has no parent"))?;
    let canonical_link_parent = safety::canonical_descendant(repos_root, link_parent)?;
    if canonical_link_parent != link_parent {
        return Err(invalid(
            "Workspace repository symlink parent resolves outside its managed path",
        ));
    }
    let link_metadata = fs::symlink_metadata(link_path)?;
    if !link_metadata.file_type().is_symlink() || fs::canonicalize(link_path)? != canonical_worktree
    {
        return Err(invalid(
            "Workspace repository symlink does not target its recorded worktree",
        ));
    }
    if branch.owning_worktrees != [canonical_worktree.clone()] {
        return Err(ManagementStoreError::Safety(SafetyError::IdentityMismatch(
            "Workspace worktree branch ownership is missing or ambiguous".into(),
        )));
    }
    Ok(canonical_worktree)
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

    fn database_through_version(connection: &Connection, version: usize) {
        connection
            .execute_batch(
                "PRAGMA foreign_keys = ON;
                 CREATE TABLE schema_migrations (
                     version INTEGER PRIMARY KEY NOT NULL,
                     applied_at INTEGER NOT NULL
                 );",
            )
            .unwrap();
        let migrations = [
            MIGRATION_1,
            MIGRATION_2,
            MIGRATION_3,
            MIGRATION_4,
            MIGRATION_5,
            MIGRATION_6,
            MIGRATION_7,
            MIGRATION_8,
            MIGRATION_9,
            MIGRATION_10,
            MIGRATION_11,
            MIGRATION_12,
            MIGRATION_13,
            MIGRATION_14,
            MIGRATION_15,
            MIGRATION_16,
            MIGRATION_17,
            MIGRATION_18,
        ];
        for (index, migration) in migrations.iter().take(version).enumerate() {
            connection.execute_batch(migration).unwrap();
            connection
                .execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?1, 0)",
                    [index as i64 + 1],
                )
                .unwrap();
        }
    }

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
        {
            let legacy = Connection::open(&database).unwrap();
            database_through_version(&legacy, 9);
            legacy.execute(
                "INSERT INTO workspaces(id, name, slug, description, home_path, kind, status, created_at)
                 VALUES ('w-legacy', 'Legacy', 'legacy', NULL, ?1, 'regular', 'active', ?2)",
                params![user_home.join("legacy").to_string_lossy(), CREATED],
            ).unwrap();
            legacy.execute(
                "INSERT INTO sessions(open_code_session_id, owner_workspace_id, owner_task_id, directory,
                     last_known_status, created_at, updated_at)
                 VALUES ('ses-legacy', 'w-legacy', NULL, ?1, 'unknown', ?2, ?2)",
                params![user_home.join("legacy").to_string_lossy(), CREATED],
            ).unwrap();
            legacy.execute(
                "INSERT INTO workspace_starting_prompts(session_id, prompt) VALUES ('ses-legacy', 'legacy prompt to remove')",
                [],
            ).unwrap();
        }
        let migrated =
            ManagementStore::open_with_paths(&database, &user_home, &system_temp).unwrap();
        assert_eq!(migrated.migration_versions().unwrap().last(), Some(&21));
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
        {
            let legacy = Connection::open(&database).unwrap();
            database_through_version(&legacy, 10);
            legacy.execute_batch(
                "INSERT INTO workspaces(id, name, slug, description, home_path, kind, status, created_at)
                   VALUES ('w-quick', 'Quick Requests', 'quick-requests', NULL, '/tmp/quick-requests', 'quick_requests', 'active', 1700000000000),
                          ('w-regular', 'Regular', 'regular', NULL, '/tmp/regular', 'regular', 'active', 1700000000000);
                 INSERT INTO tasks(id, workspace_id, name, slug, description, home_path, status, setup_status, created_at,
                     quick_request_created_at, quick_request_expires_at)
                   VALUES ('qr-legacy-prompt', 'w-quick', 'Quick Request: legacy Quick Request prompt', 'legacy',
                     'legacy Quick Request prompt', '/tmp/quick-requests', 'active', 'ready', 1700000000000,
                     1700000000000, 1700000001000);
                 INSERT INTO tasks(id, workspace_id, name, slug, description, home_path, status, setup_status, created_at)
                   VALUES ('regular-with-description', 'w-regular', 'Regular task', 'regular-task',
                     'A test task', '/tmp/regular/tasks/regular-task', 'active', 'not_started', 1700000000000);",
            ).unwrap();
        }

        let migrated =
            ManagementStore::open_with_paths(&database, &user_home, &system_temp).unwrap();
        assert_eq!(migrated.migration_versions().unwrap().last(), Some(&21));
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
        assert!(migrated
            .get_task("regular-with-description")
            .unwrap()
            .is_none());
        let archive = migrated
            .list_legacy_task_archives()
            .unwrap()
            .into_iter()
            .find(|archive| archive.task_id == "regular-with-description")
            .unwrap();
        assert_eq!(archive.workspace_id, "w-regular");
        assert_eq!(
            migrated
                .restore_legacy_task_archive("regular-with-description")
                .unwrap()
                .description
                .as_deref(),
            Some("A test task")
        );
    }

    #[test]
    fn historical_task_rows_are_archived_before_conversion_and_can_be_restored_exactly() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let workspace_home = fixture.path().join("project");
        let task_home = workspace_home.join("tasks/legacy-task");
        let worktree = task_home.join("worktrees/repo-legacy");
        fs::create_dir_all(&worktree).unwrap();
        fs::write(worktree.join("user-data.txt"), "preserve me").unwrap();
        let database = fixture.path().join("management.sqlite");
        {
            let legacy = Connection::open(&database).unwrap();
            database_through_version(&legacy, 18);
            legacy.execute(
                "INSERT INTO workspaces(id, name, slug, description, home_path, kind, status, created_at)
                 VALUES ('w-legacy', 'Legacy Workspace', 'legacy-workspace', NULL, ?1, 'regular', 'active', ?2)",
                params![workspace_home.to_string_lossy(), CREATED],
            ).unwrap();
            legacy.execute(
                "INSERT INTO repository_catalog(id, name, repository_path, repository_identity,
                    purpose, purpose_status, created_at, updated_at)
                 VALUES ('repo-legacy', 'Legacy Repo', '/source/repo-legacy', 'identity-legacy', NULL,
                    'unavailable', ?1, ?1)",
                [CREATED],
            ).unwrap();
            legacy.execute(
                "INSERT INTO tasks(id, workspace_id, name, slug, description, home_path, status,
                    setup_status, created_at)
                 VALUES ('t-legacy', 'w-legacy', 'Legacy Task', 'legacy-task', 'metadata only', ?1,
                    'active', 'ready', ?2)",
                params![task_home.to_string_lossy(), CREATED],
            ).unwrap();
            legacy
                .execute(
                    "INSERT INTO task_repositories(task_id, repository_id, branch, worktree_path,
                    setup_status, created_at, updated_at)
                 VALUES ('t-legacy', 'repo-legacy', 'work/legacy-task', ?1, 'ready', ?2, ?2)",
                    params![worktree.to_string_lossy(), CREATED],
                )
                .unwrap();
            legacy
                .execute(
                    "INSERT INTO sessions(open_code_session_id, owner_workspace_id, owner_task_id,
                    directory, last_known_status, created_at, updated_at)
                 VALUES ('ses-legacy', NULL, 't-legacy', ?1, 'idle', ?2, ?2)",
                    params![worktree.to_string_lossy(), CREATED],
                )
                .unwrap();
            legacy.execute(
                "INSERT INTO task_session_repositories(open_code_session_id, task_id, repository_id)
                 VALUES ('ses-legacy', 't-legacy', 'repo-legacy')",
                [],
            ).unwrap();
            legacy
                .execute(
                    "INSERT INTO cleanup_jobs(id, task_id, repository_id, worktree_path, state,
                    created_at, updated_at)
                 VALUES ('cleanup-legacy', 't-legacy', 'repo-legacy', ?1, 'deferred', ?2, ?2)",
                    params![worktree.to_string_lossy(), CREATED],
                )
                .unwrap();
        }

        let migrated = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        assert!(migrated.get_task("t-legacy").unwrap().is_none());
        assert!(migrated.list_tasks("w-legacy").unwrap().is_empty());
        assert_eq!(
            fs::read_to_string(worktree.join("user-data.txt")).unwrap(),
            "preserve me"
        );
        let archive = migrated
            .list_legacy_task_archives()
            .unwrap()
            .into_iter()
            .find(|archive| archive.task_id == "t-legacy")
            .unwrap();
        assert!(archive.restored_at.is_none());

        let restored = migrated.restore_legacy_task_archive("t-legacy").unwrap();
        assert_eq!(restored.home_path, task_home.to_string_lossy());
        assert_eq!(
            migrated.list_task_repository_bindings("t-legacy").unwrap()[0].worktree_path,
            worktree.to_string_lossy()
        );
        assert_eq!(
            migrated
                .list_sessions(&SessionOwner::Task("t-legacy".into()))
                .unwrap()[0]
                .directory,
            worktree.to_string_lossy()
        );
        assert_eq!(
            migrated.list_cleanup_jobs("t-legacy").unwrap()[0].state,
            CleanupJobState::Deferred
        );
        assert_eq!(
            migrated.restore_legacy_task_archive("t-legacy").unwrap(),
            restored,
            "repeated undelete is idempotent"
        );
        assert!(migrated
            .list_legacy_task_archives()
            .unwrap()
            .iter()
            .find(|archive| archive.task_id == "t-legacy")
            .unwrap()
            .restored_at
            .is_some());
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

    #[test]
    fn repository_directories_group_repositories_and_persist_enabled_state() {
        let fixture = tempdir().unwrap();
        let user_home = fixture.path().join("home");
        fs::create_dir_all(&user_home).unwrap();
        let scan_root = fixture.path().join("source");
        let first_path = scan_root.join("first");
        let bound_path = scan_root.join("bound");
        fs::create_dir_all(&first_path).unwrap();
        fs::create_dir_all(&bound_path).unwrap();
        let db_path = fixture.path().join("management.sqlite");
        let store = ManagementStore::open_with_paths(&db_path, &user_home, fixture.path()).unwrap();
        store
            .add_repository_scan_directory(&scan_root, CREATED)
            .unwrap();
        store
            .add_repository_scan_directory(&first_path, CREATED)
            .unwrap();

        for (id, path) in [("repo-first", &first_path), ("repo-bound", &bound_path)] {
            let mut record = repository(id);
            record.repository_path = path.to_string_lossy().into();
            store.create_repository(&record).unwrap();
        }
        store
            .set_repository_enabled("repo-first", false, CREATED + 1)
            .unwrap();
        store
            .create_workspace(&workspace("w-directory", "directory"))
            .unwrap();
        store
            .save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: "w-directory".into(),
                repository_id: "repo-bound".into(),
                checkout_path: bound_path.to_string_lossy().into(),
                checkout_mode: CheckoutMode::Existing,
                branch: "main".into(),
                verification_status: VerificationStatus::Verified,
                created_at: CREATED,
            })
            .unwrap();
        let checkout_metadata = store
            .workspace_repository_checkout_metadata("w-directory", "repo-bound")
            .unwrap()
            .unwrap();
        assert_eq!(checkout_metadata.source_identity, "git-identity-repo-bound");
        assert_eq!(
            checkout_metadata.checkout_identity,
            "git-identity-repo-bound"
        );
        assert_eq!(checkout_metadata.default_branch, "main");

        let before = store.repository_directory_page().unwrap();
        assert_eq!(before.directories.len(), 2);
        let first_dir = before
            .directories
            .iter()
            .find(|directory| directory.path == first_path.to_string_lossy())
            .unwrap();
        assert_eq!(first_dir.repositories.len(), 1);
        assert_eq!(first_dir.repositories[0].repository.id, "repo-first");
        assert!(!first_dir.repositories[0].enabled);
        let source_dir = before
            .directories
            .iter()
            .find(|directory| directory.path == scan_root.to_string_lossy())
            .unwrap();
        assert_eq!(source_dir.repositories.len(), 1);
        assert_eq!(source_dir.repositories[0].repository.id, "repo-bound");
        assert!(source_dir.repositories[0].enabled);
        let serialized = serde_json::to_value(&before).unwrap();
        assert_eq!(
            serialized["directories"][0]["repositories"][0]["enabled"],
            true
        );
        assert!(
            serialized["directories"][0]["repositories"][0]["repository"]
                .get("repositoryPath")
                .is_some()
        );
        assert_eq!(store.list_repositories().unwrap().len(), 1);
        assert!(store.quick_request_directory(Some("repo-first")).is_err());
        assert_eq!(
            store.quick_request_directory(Some("repo-bound")).unwrap(),
            bound_path
        );
        assert!(store.get_repository("repo-first").unwrap().is_some());
        assert!(store.get_repository("repo-bound").unwrap().is_some());

        drop(store);
        let reopened =
            ManagementStore::open_with_paths(&db_path, &user_home, fixture.path()).unwrap();
        let persisted = reopened.repository_directory_page().unwrap();
        assert_eq!(persisted.directories, before.directories);
    }

    #[test]
    fn workspace_repository_setup_outcomes_survive_reopen_and_enforce_status_data() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let database = fixture.path().join("management.sqlite");
        let store = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        store
            .create_workspace(&workspace("w-setup-record", "setup-record"))
            .unwrap();
        store
            .create_repository(&repository("repo-setup-record"))
            .unwrap();
        let pending = WorkspaceRepositorySetupRecord {
            workspace_id: "w-setup-record".into(),
            repository_id: "repo-setup-record".into(),
            setup_status: WorkspaceRepositorySetupStatus::Pending,
            plan_json: r#"{"destinationPath":"/projects/w/repos/repo-id"}"#.into(),
            checkout_identity: None,
            error_code: None,
            error_detail: None,
            updated_at: CREATED,
        };
        store.save_workspace_repository_setup(&pending).unwrap();
        let mut failed = pending.clone();
        failed.setup_status = WorkspaceRepositorySetupStatus::Failed;
        failed.error_code = Some("source_changed".into());
        failed.error_detail = Some("Source HEAD changed after review".into());
        failed.updated_at += 1;
        store.save_workspace_repository_setup(&failed).unwrap();
        assert_eq!(
            store
                .list_workspace_repository_setups("w-setup-record")
                .unwrap(),
            vec![failed.clone()]
        );
        assert!(store
            .save_workspace_repository_setup(&WorkspaceRepositorySetupRecord {
                error_detail: None,
                ..failed.clone()
            })
            .is_err());
        drop(store);
        let reopened = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        assert_eq!(
            reopened
                .list_workspace_repository_setups("w-setup-record")
                .unwrap(),
            vec![failed]
        );
        assert_eq!(reopened.migration_versions().unwrap().last(), Some(&21));
    }

    #[test]
    fn deleting_workspace_forgets_local_session_but_preserves_repositories() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let store = ManagementStore::in_memory_with_paths(&home, fixture.path()).unwrap();
        let workspace = store
            .create_workspace(&workspace("w-delete", "delete-me"))
            .unwrap();
        let repository_path = fixture.path().join("repo");
        fs::create_dir_all(&repository_path).unwrap();
        let mut repository = repository("repo-preserved");
        repository.repository_path = repository_path.to_string_lossy().into();
        store.create_repository(&repository).unwrap();
        store
            .save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: workspace.id.clone(),
                repository_id: repository.id.clone(),
                checkout_path: repository.repository_path.clone(),
                checkout_mode: CheckoutMode::Existing,
                branch: "main".into(),
                verification_status: VerificationStatus::Verified,
                created_at: CREATED,
            })
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-preserved-in-opencode".into(),
                owner: SessionOwner::Workspace(workspace.id.clone()),
                directory: workspace.home_path.clone(),
                last_known_status: "running".into(),
                created_at: CREATED,
            })
            .unwrap();

        store.delete_empty_regular_workspace(&workspace.id).unwrap();

        assert!(store.get_workspace(&workspace.id).unwrap().is_none());
        assert!(store
            .get_session("ses-preserved-in-opencode")
            .unwrap()
            .is_none());
        assert!(store.get_repository(&repository.id).unwrap().is_some());
        assert!(!Path::new(&workspace.home_path).exists());
    }

    #[test]
    fn overlapping_directories_display_a_repository_only_once() {
        let fixture = tempdir().unwrap();
        let user_home = fixture.path().join("home");
        fs::create_dir_all(&user_home).unwrap();
        let broad = fixture.path().join("source");
        let repo_path = broad.join("repo");
        fs::create_dir_all(&repo_path).unwrap();
        let store = ManagementStore::in_memory_with_paths(&user_home, fixture.path()).unwrap();
        store
            .add_repository_scan_directory(&broad, CREATED)
            .unwrap();
        store
            .add_repository_scan_directory(&repo_path, CREATED)
            .unwrap();
        let mut record = repository("repo-nested");
        record.repository_path = repo_path.to_string_lossy().into();
        store.create_repository(&record).unwrap();

        let page = store.repository_directory_page().unwrap();
        assert_eq!(page.directories.len(), 2);
        assert_eq!(
            page.directories
                .iter()
                .map(|directory| directory.repositories.len())
                .sum::<usize>(),
            1
        );
        assert_eq!(
            page.directories
                .iter()
                .find(|directory| directory.path == repo_path.to_string_lossy())
                .unwrap()
                .repositories[0]
                .repository
                .id,
            "repo-nested"
        );
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
    fn workspace_session_directories_follow_repository_cardinality() {
        let home = Path::new("/projects/alpha");
        let one = WorkspaceRepositoryBinding {
            workspace_id: "w".into(),
            repository_id: "r1".into(),
            checkout_path: "/projects/alpha/repos/one".into(),
            checkout_mode: CheckoutMode::Clone,
            branch: "main".into(),
            verification_status: VerificationStatus::Verified,
            created_at: CREATED,
        };
        assert_eq!(
            workspace_session_directories(home, &[]).unwrap(),
            vec![(None, home.to_path_buf())]
        );
        assert_eq!(
            workspace_session_directories(home, std::slice::from_ref(&one)).unwrap(),
            vec![(Some("r1".into()), PathBuf::from(&one.checkout_path))]
        );
        let two = WorkspaceRepositoryBinding {
            repository_id: "r2".into(),
            checkout_path: "/projects/alpha/repos/two".into(),
            ..one.clone()
        };
        assert_eq!(
            workspace_session_directories(home, &[one, two]).unwrap(),
            vec![
                (
                    Some("r1".into()),
                    PathBuf::from("/projects/alpha/repos/one")
                ),
                (
                    Some("r2".into()),
                    PathBuf::from("/projects/alpha/repos/two")
                ),
                (None, home.to_path_buf()),
            ]
        );
    }

    #[test]
    fn workspace_initial_prompt_includes_every_verified_repository_checkout() {
        let home = Path::new("/managed/workspace");
        let bindings =
            ["/tmp/repo-a", "/tmp/repo-b"].map(|checkout_path| WorkspaceRepositoryBinding {
                workspace_id: "workspace-1".into(),
                repository_id: checkout_path.rsplit('/').next().unwrap().into(),
                checkout_path: checkout_path.into(),
                checkout_mode: CheckoutMode::Existing,
                branch: "main".into(),
                verification_status: VerificationStatus::Verified,
                created_at: 1,
            });

        assert_eq!(
            workspace_prompt_with_repository_context(
                "Coordinate work across the selected repositories.",
                home,
                &bindings,
            ),
            "Coordinate work across the selected repositories.\n\nVerified workspace repository checkouts:\n/tmp/repo-a\n/tmp/repo-b"
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
        workspace_checkout_path: PathBuf,
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
        git_ok(
            &repository_path,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        );
        store
            .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: "w-cleanup-fixture".into(),
                repository_id: "repo-cleanup-fixture".into(),
                checkout_path: {
                    let repository = store
                        .get_repository("repo-cleanup-fixture")
                        .unwrap()
                        .unwrap();
                    let workspace = store.get_workspace("w-cleanup-fixture").unwrap().unwrap();
                    let plan = crate::workspace_setup::plan_workspace_setup(
                        Path::new(&workspace.home_path),
                        vec![
                            crate::workspace_setup::inspect_repository_preflight(&repository)
                                .unwrap(),
                        ],
                    )
                    .unwrap()
                    .repositories
                    .remove(0);
                    let staging = Path::new(&workspace.home_path).join("repos/.staging-cleanup");
                    crate::workspace_setup::provision_independent_clone(
                        &repository,
                        &plan,
                        &staging,
                    )
                    .unwrap()
                    .checkout_path
                    .to_string_lossy()
                    .into_owned()
                },
                checkout_mode: CheckoutMode::Clone,
                branch: "main".into(),
                verification_status: VerificationStatus::Verified,
                created_at: CREATED,
            })
            .unwrap();

        let workspace_checkout_path = PathBuf::from(
            store
                .workspace_repository_checkout_metadata("w-cleanup-fixture", "repo-cleanup-fixture")
                .unwrap()
                .unwrap()
                .checkout_path,
        );

        let task_home = PathBuf::from(&task.home_path);
        let worktree_path = task_home.join("worktrees/repository");
        let branch = format!("work/{task_id}");
        git_ok(
            &workspace_checkout_path,
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
            workspace_checkout_path,
            task_home,
            worktree_path,
            task_id: task_id.to_owned(),
        }
    }

    #[test]
    fn task_cleanup_removes_only_the_worktree_from_its_workspace_clone() {
        let fixture = cleanup_fixture("t-clean-clone");
        let source_head = git_ok(&fixture.repository_path, &["rev-parse", "HEAD"]).stdout;
        let source_refs = git_ok(&fixture.repository_path, &["show-ref"]).stdout;
        fixture
            .store
            .complete_task_and_queue_cleanup(&fixture.task_id, CREATED + 10)
            .unwrap();
        let job = fixture
            .store
            .list_cleanup_jobs(&fixture.task_id)
            .unwrap()
            .remove(0);
        let removed = fixture
            .store
            .execute_cleanup_job(&job.id, &[], CREATED + 11)
            .unwrap();
        assert_eq!(removed.state, CleanupJobState::Removed);
        assert!(!fixture.worktree_path.exists());
        assert!(fixture.workspace_checkout_path.exists());
        assert_eq!(
            git_ok(&fixture.repository_path, &["rev-parse", "HEAD"]).stdout,
            source_head
        );
        assert_eq!(
            git_ok(&fixture.repository_path, &["show-ref"]).stdout,
            source_refs
        );
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
                vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
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
            vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
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
    fn migration_18_records_workspace_sessions_worktrees_and_non_lifecycle_tags() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let store = ManagementStore::open_with_paths(
            fixture.path().join("management.sqlite"),
            &home,
            fixture.path(),
        )
        .unwrap();
        store
            .create_workspace(&workspace("w-context", "context"))
            .unwrap();
        store
            .create_repository(&repository("repo-context"))
            .unwrap();
        assert!(store
            .save_workspace_repository_worktree(&WorkspaceRepositoryWorktree {
                workspace_id: "w-context".into(),
                repository_id: "repo-context".into(),
                source_identity: "source-id".into(),
                checkout_identity: None,
                branch: "work/refactor".into(),
                base_checkout_path: "/tmp/base".into(),
                worktree_path: "/tmp/../outside".into(),
                workspace_link: "/tmp/alias".into(),
                setup_status: WorkspaceWorktreeStatus::Pending,
                error_code: None,
                error_detail: None,
                created_at: CREATED,
                updated_at: CREATED,
            })
            .is_err());
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-workspace".into(),
                owner: SessionOwner::Workspace("w-context".into()),
                directory: store.get_workspace("w-context").unwrap().unwrap().home_path,
                last_known_status: "ready_for_review".into(),
                created_at: CREATED,
            })
            .unwrap();
        store
            .create_session(&NewSession {
                open_code_session_id: "ses-invalid-worker".into(),
                owner: SessionOwner::Workspace("w-context".into()),
                directory: store.get_workspace("w-context").unwrap().unwrap().home_path,
                last_known_status: "ready_for_review".into(),
                created_at: CREATED + 1,
            })
            .unwrap();

        let connection = store.connection.lock().unwrap();
        connection
            .execute(
                "INSERT INTO workspace_session_context(open_code_session_id, workspace_id, role, repository_id)
                 VALUES ('ses-workspace', 'w-context', 'workspace', NULL)",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspace_tags(workspace_id, tag, created_at) VALUES ('w-context', 'Milestone 1', ?1)",
                [CREATED],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO workspace_repository_worktrees(
                     workspace_id, repository_id, source_identity, checkout_identity,
                     branch, base_checkout_path, worktree_path, workspace_link,
                     setup_status, error_code, error_detail, created_at, updated_at
                  ) VALUES ('w-context', 'repo-context', 'source-id', NULL, 'work/refactor',
                     '/tmp/base', '/tmp/worktree', '/tmp/alias', 'pending', NULL, NULL, ?1, ?1)",
                [CREATED],
            )
            .unwrap();
        assert!(connection
            .execute(
                "INSERT INTO workspace_session_context(open_code_session_id, workspace_id, role, repository_id)
                 VALUES ('ses-invalid-worker', 'w-context', 'worker', 'repo-context')",
                [],
            )
            .is_err());
        assert_eq!(
            connection
                .query_row(
                    "SELECT tag FROM workspace_tags WHERE workspace_id = 'w-context'",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "Milestone 1"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT setup_status FROM workspace_repository_worktrees",
                    [],
                    |row| row.get::<_, String>(0)
                )
                .unwrap(),
            "pending"
        );
    }

    #[test]
    fn migration_20_repairs_shipped_v18_worktree_table_without_base_checkout_column() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let database = fixture.path().join("management.sqlite");
        {
            let legacy = Connection::open(&database).unwrap();
            database_through_version(&legacy, 17);
            let old_v18 = MIGRATION_18
                .replace("    base_checkout_path TEXT NOT NULL,\n", "")
                .replace("    workspace_link TEXT NOT NULL,\n", "");
            legacy.execute_batch(&old_v18).unwrap();
            legacy
                .execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (18, 0)",
                    [],
                )
                .unwrap();
            let columns = legacy
                .prepare("PRAGMA table_info(workspace_repository_worktrees)")
                .unwrap()
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert!(!columns.iter().any(|column| column == "base_checkout_path"));
            assert!(!columns.iter().any(|column| column == "workspace_link"));
        }

        let migrated = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        assert_eq!(migrated.migration_versions().unwrap().last(), Some(&21));
        assert!(migrated
            .list_workspace_repository_worktrees("workspace-with-no-worktrees")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn workspace_tags_are_normalized_labels_and_do_not_change_lifecycle() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let store = ManagementStore::open_with_paths(
            fixture.path().join("management.sqlite"),
            &home,
            fixture.path(),
        )
        .unwrap();
        store
            .create_workspace(&workspace("w-tags", "tags"))
            .unwrap();

        let tags = store
            .replace_workspace_tags(
                "w-tags",
                &[
                    " Milestone 2 ".into(),
                    "Milestone 1".into(),
                    "milestone 1".into(),
                    "  ".into(),
                ],
                CREATED,
            )
            .unwrap();
        assert_eq!(tags, vec!["Milestone 1", "Milestone 2"]);
        assert_eq!(store.list_workspace_tags("w-tags").unwrap(), tags);
        assert_eq!(
            store.get_workspace("w-tags").unwrap().unwrap().status,
            WorkspaceStatus::Active
        );
        assert!(store
            .replace_workspace_tags("w-tags", &["x".repeat(81)], CREATED + 1)
            .is_err());
        assert_eq!(store.list_workspace_tags("w-tags").unwrap(), tags);
    }

    #[test]
    fn repository_library_setting_is_configurable_persistent_and_validated_before_write() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let database = fixture.path().join("management.sqlite");
        let store = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        assert_eq!(
            store.repository_library_root().unwrap(),
            DEFAULT_REPOSITORY_LIBRARY_ROOT
        );
        let external = fixture.path().join("library");
        store
            .set_repository_library_root(external.to_str().unwrap(), CREATED)
            .unwrap();
        assert_eq!(store.resolved_repository_library_root().unwrap(), external);
        assert!(store
            .set_repository_library_root("relative/path", CREATED + 1)
            .is_err());
        assert_eq!(
            store.repository_library_root().unwrap(),
            external.to_string_lossy()
        );
        drop(store);
        let reopened = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        assert_eq!(
            reopened.resolved_repository_library_root().unwrap(),
            external
        );
    }

    #[test]
    fn migration_15_preserves_existing_workspace_binding_path_and_mode() {
        let fixture = tempdir().unwrap();
        let home = fixture.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let database = fixture.path().join("management.sqlite");
        let legacy = WorkspaceRepositoryBinding {
            workspace_id: "w-migration".into(),
            repository_id: "repo-migration".into(),
            checkout_path: "/original/checkout".into(),
            checkout_mode: CheckoutMode::Managed,
            branch: "main".into(),
            verification_status: VerificationStatus::Verified,
            created_at: CREATED,
        };
        {
            let connection = Connection::open(&database).unwrap();
            database_through_version(&connection, 14);
            connection.execute(
                "INSERT INTO workspaces(id, name, slug, description, home_path, kind, status, created_at)
                 VALUES ('w-migration', 'Workspace w-migration', 'migration', 'A test workspace', ?1,
                    'regular', 'active', ?2)",
                params![home.join("migration").to_string_lossy(), CREATED],
            ).unwrap();
            connection.execute(
                "INSERT INTO repository_catalog(id, name, repository_path, repository_identity,
                    purpose, purpose_status, created_at, updated_at)
                 VALUES ('repo-migration', 'Repository repo-migration', '/fixtures/repos/repo-migration',
                    'git-identity-repo-migration', 'Fixture repository', 'available', ?1, ?1)",
                [CREATED],
            ).unwrap();
            connection
                .execute(
                    "INSERT INTO workspace_repositories(workspace_id, repository_id, checkout_path,
                    checkout_mode, branch, verification_status, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        legacy.workspace_id,
                        legacy.repository_id,
                        legacy.checkout_path,
                        "managed",
                        legacy.branch,
                        "verified",
                        legacy.created_at
                    ],
                )
                .unwrap();
        }

        let reopened = ManagementStore::open_with_paths(&database, &home, fixture.path()).unwrap();
        assert_eq!(
            reopened
                .list_workspace_repository_bindings("w-migration")
                .unwrap(),
            vec![legacy]
        );
        let metadata = reopened
            .workspace_repository_checkout_metadata("w-migration", "repo-migration")
            .unwrap()
            .unwrap();
        assert_eq!(metadata.source_identity, "git-identity-repo-migration");
        assert_eq!(metadata.checkout_identity, "git-identity-repo-migration");
        assert_eq!(metadata.default_branch, "main");
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
    fn workspace_completion_is_independent_of_retained_legacy_task_lifecycle() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-lifecycle", "lifecycle"))
            .unwrap();
        store
            .create_task(&task("t-lifecycle", "w-lifecycle", "task"))
            .unwrap();
        let completed_workspace = store
            .complete_workspace("w-lifecycle", CREATED + 10)
            .unwrap();
        assert_eq!(completed_workspace.status, WorkspaceStatus::Completed);
        assert_eq!(
            store.get_task("t-lifecycle").unwrap().unwrap().status,
            TaskStatus::Active
        );
        store.reactivate_workspace("w-lifecycle").unwrap();

        let completed = store.complete_task("t-lifecycle", CREATED + 20).unwrap();
        assert_eq!(completed.status, TaskStatus::Completed);
        assert_eq!(completed.completed_at, Some(CREATED + 20));
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
                .complete_workspace("w-lifecycle", CREATED + 30)
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
    fn workspace_repository_session_is_valid_in_its_verified_checkout_context() {
        let store = ManagementStore::in_memory().unwrap();
        store
            .create_workspace(&workspace("w-repo-session", "repo-session"))
            .unwrap();
        store
            .create_repository(&repository("repo-session"))
            .unwrap();
        store
            .save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: "w-repo-session".into(),
                repository_id: "repo-session".into(),
                checkout_path: "/fixtures/workspace/repos/repo-session".into(),
                checkout_mode: CheckoutMode::Clone,
                branch: "main".into(),
                verification_status: VerificationStatus::Verified,
                created_at: CREATED,
            })
            .unwrap();
        let session = store
            .create_session(&NewSession {
                open_code_session_id: "ses-repo-session".into(),
                owner: SessionOwner::Workspace("w-repo-session".into()),
                directory: "/fixtures/workspace/repos/repo-session".into(),
                last_known_status: "starting".into(),
                created_at: CREATED,
            })
            .unwrap();

        assert_eq!(
            store
                .validate_session_context("ses-repo-session", Path::new(&session.directory))
                .unwrap(),
            session,
        );
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
