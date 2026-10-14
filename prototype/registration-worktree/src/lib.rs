use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::error::Error;
use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemResult {
    Ready,
    Failed,
    NotAttempted,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RegistrationItem {
    pub item_id: String,
    pub repository_id: String,
    pub repository_path: String,
    pub git_identity: String,
    pub branch: Option<String>,
    pub worktree_path: Option<String>,
    pub result: ItemResult,
    pub error_code: Option<String>,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RegistrationReport {
    pub operation_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub items: Vec<RegistrationItem>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RegistrationResult {
    pub operation_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub replayed: bool,
    pub items: Vec<RegistrationItem>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BoundaryError {
    pub code: String,
    pub detail: String,
}

/// Run an OpenCode/tool boundary command. The command receives one JSON request
/// on stdin and must write exactly one `RegistrationReport` JSON value to
/// stdout. Parsing happens before `apply_report`, so malformed child output
/// cannot mutate the boundary.
pub fn exchange_registration_report(
    boundary: &mut RegistrationBoundary,
    command: &[String],
    request: &serde_json::Value,
) -> Result<String, BoundaryError> {
    let (program, args) = command.split_first().ok_or_else(|| {
        BoundaryError::new("child_command_required", "A child command is required.")
    })?;
    let input = serde_json::to_vec(request)
        .map_err(|error| BoundaryError::new("request_serialization_failed", error.to_string()))?;
    let mut child = Command::new(program)
        .args(args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|error| BoundaryError::new("child_spawn_failed", error.to_string()))?;
    child
        .stdin
        .take()
        .expect("child stdin was configured")
        .write_all(&input)
        .map_err(|error| BoundaryError::new("child_stdin_failed", error.to_string()))?;
    let output = child
        .wait_with_output()
        .map_err(|error| BoundaryError::new("child_wait_failed", error.to_string()))?;
    if !output.status.success() {
        return Err(BoundaryError::new(
            "child_command_failed",
            String::from_utf8_lossy(&output.stderr).trim().to_owned(),
        ));
    }
    let report: RegistrationReport = serde_json::from_slice(&output.stdout).map_err(|error| {
        BoundaryError::new(
            "child_report_malformed",
            format!("Child stdout was not a registration report: {error}"),
        )
    })?;
    let result = boundary.apply_report(report)?;
    serde_json::to_string(&result)
        .map_err(|error| BoundaryError::new("result_serialization_failed", error.to_string()))
}

impl BoundaryError {
    pub fn new(code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            detail: detail.into(),
        }
    }
}

impl fmt::Display for BoundaryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.code, self.detail)
    }
}

impl Error for BoundaryError {}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct RepositoryRecord {
    pub repository_id: String,
    pub canonical_path: String,
    pub git_identity: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CleanupClassification {
    CleanUnused,
    DirtyOrNewFile,
    InUse,
    Missing,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct CleanupDecision {
    pub task_id: String,
    pub repository_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub classification: CleanupClassification,
    pub removed: bool,
    pub branch_retained: bool,
    pub detail: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct PersistedRegistration {
    pub operation_id: String,
    pub workspace_id: String,
    pub task_id: String,
    pub session_id: String,
    pub item: RegistrationItem,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BoundarySnapshot {
    pub operation_ids: Vec<String>,
    pub persisted_items: Vec<PersistedRegistration>,
    pub cleanup: Vec<CleanupDecision>,
}

#[derive(Clone, Debug)]
struct WorkspaceRecord {
    active: bool,
}

#[derive(Clone, Debug)]
struct TaskRecord {
    workspace_id: String,
    allowed_worktree_root: PathBuf,
    active: bool,
    completed: bool,
}

#[derive(Clone, Debug)]
struct SessionRecord {
    workspace_id: String,
    task_id: String,
    worktree_path: Option<PathBuf>,
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct AssociationKey {
    repository_id: String,
    branch: String,
    worktree_path: String,
}

#[derive(Clone, Debug)]
struct Association {
    task_id: String,
    repository_id: String,
    branch: String,
    worktree_path: String,
}

#[derive(Clone, Debug)]
struct StoredOperation {
    report: RegistrationReport,
    result: RegistrationResult,
}

#[derive(Default)]
pub struct RegistrationBoundary {
    repositories: BTreeMap<String, RepositoryRecord>,
    workspaces: BTreeMap<String, WorkspaceRecord>,
    tasks: BTreeMap<String, TaskRecord>,
    sessions: BTreeMap<String, SessionRecord>,
    operations: BTreeMap<String, StoredOperation>,
    persisted_items: Vec<PersistedRegistration>,
    associations: BTreeMap<AssociationKey, Association>,
    cleanup: Vec<CleanupDecision>,
}

impl RegistrationBoundary {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register_repository(
        &mut self,
        repository_id: impl Into<String>,
        path: &Path,
    ) -> Result<RepositoryRecord, BoundaryError> {
        let repository_id = repository_id.into();
        if repository_id.trim().is_empty() {
            return Err(BoundaryError::new(
                "repository_id_required",
                "A repository catalog ID is required.",
            ));
        }

        let canonical_path = canonical_directory(path).map_err(|error| {
            BoundaryError::new(
                "repository_path_invalid",
                format!("Could not canonicalize the repository path: {error}"),
            )
        })?;
        let repository_root = git_root(&canonical_path).map_err(|error| {
            BoundaryError::new(
                "repository_not_git",
                format!("The catalog path is not a Git repository: {error}"),
            )
        })?;
        if repository_root != canonical_path {
            return Err(BoundaryError::new(
                "repository_path_not_root",
                "The catalog path must be the repository root.",
            ));
        }
        let git_identity = git_identity(&canonical_path).map_err(|error| {
            BoundaryError::new(
                "repository_identity_unavailable",
                format!("Could not inspect the repository identity: {error}"),
            )
        })?;
        let record = RepositoryRecord {
            repository_id: repository_id.clone(),
            canonical_path: canonical_path.to_string_lossy().into_owned(),
            git_identity,
        };

        if let Some(existing) = self.repositories.get(&repository_id) {
            if existing == &record {
                return Ok(existing.clone());
            }
            return Err(BoundaryError::new(
                "repository_id_conflict",
                format!("Repository ID {repository_id} is already bound to another path."),
            ));
        }
        self.repositories.insert(repository_id, record.clone());
        Ok(record)
    }

    pub fn repository(&self, repository_id: &str) -> Option<RepositoryRecord> {
        self.repositories.get(repository_id).cloned()
    }

    pub fn register_workspace(
        &mut self,
        workspace_id: impl Into<String>,
    ) -> Result<(), BoundaryError> {
        let workspace_id = workspace_id.into();
        if workspace_id.trim().is_empty() {
            return Err(BoundaryError::new(
                "workspace_id_required",
                "A workspace ID is required.",
            ));
        }
        if self.workspaces.contains_key(&workspace_id) {
            return Err(BoundaryError::new(
                "workspace_id_conflict",
                format!("Workspace ID {workspace_id} is already registered."),
            ));
        }
        self.workspaces
            .insert(workspace_id, WorkspaceRecord { active: true });
        Ok(())
    }

    pub fn register_task(
        &mut self,
        workspace_id: impl Into<String>,
        task_id: impl Into<String>,
        allowed_worktree_root: &Path,
    ) -> Result<(), BoundaryError> {
        let workspace_id = workspace_id.into();
        let task_id = task_id.into();
        let workspace = self.workspaces.get(&workspace_id).ok_or_else(|| {
            BoundaryError::new(
                "workspace_not_found",
                format!("Workspace {workspace_id} is not registered."),
            )
        })?;
        if !workspace.active {
            return Err(BoundaryError::new(
                "workspace_inactive",
                format!("Workspace {workspace_id} is not active."),
            ));
        }
        let allowed_worktree_root =
            canonical_directory(allowed_worktree_root).map_err(|error| {
                BoundaryError::new(
                    "task_worktree_root_invalid",
                    format!("Could not canonicalize the task worktree root: {error}"),
                )
            })?;
        if self.tasks.contains_key(&task_id) {
            return Err(BoundaryError::new(
                "task_id_conflict",
                format!("Task ID {task_id} is already registered."),
            ));
        }
        self.tasks.insert(
            task_id,
            TaskRecord {
                workspace_id,
                allowed_worktree_root,
                active: true,
                completed: false,
            },
        );
        Ok(())
    }

    pub fn register_session(
        &mut self,
        workspace_id: impl Into<String>,
        task_id: impl Into<String>,
        session_id: impl Into<String>,
    ) -> Result<(), BoundaryError> {
        let workspace_id = workspace_id.into();
        let task_id = task_id.into();
        let session_id = session_id.into();
        let task = self.tasks.get(&task_id).ok_or_else(|| {
            BoundaryError::new(
                "task_not_found",
                format!("Task {task_id} is not registered."),
            )
        })?;
        if task.workspace_id != workspace_id {
            return Err(BoundaryError::new(
                "task_owner_mismatch",
                format!("Task {task_id} does not belong to workspace {workspace_id}."),
            ));
        }
        if self.sessions.contains_key(&session_id) {
            return Err(BoundaryError::new(
                "session_id_conflict",
                format!("Session ID {session_id} is already registered."),
            ));
        }
        self.sessions.insert(
            session_id,
            SessionRecord {
                workspace_id,
                task_id,
                worktree_path: None,
            },
        );
        Ok(())
    }

    pub fn set_session_worktree(
        &mut self,
        session_id: &str,
        worktree_path: &Path,
    ) -> Result<(), BoundaryError> {
        let worktree_path = canonical_directory(worktree_path).map_err(|error| {
            BoundaryError::new(
                "worktree_not_found",
                format!("Could not canonicalize the session worktree path: {error}"),
            )
        })?;
        let session = self.sessions.get_mut(session_id).ok_or_else(|| {
            BoundaryError::new(
                "caller_session_not_found",
                format!("Session {session_id} is not registered."),
            )
        })?;
        session.worktree_path = Some(worktree_path);
        Ok(())
    }

    pub fn complete_task(&mut self, task_id: &str) -> Result<(), BoundaryError> {
        let task = self.tasks.get_mut(task_id).ok_or_else(|| {
            BoundaryError::new(
                "task_not_found",
                format!("Task {task_id} is not registered."),
            )
        })?;
        if !task.active {
            return Err(BoundaryError::new(
                "task_not_active",
                format!("Task {task_id} has already left active work."),
            ));
        }
        task.active = false;
        task.completed = true;
        Ok(())
    }

    pub fn apply_report(
        &mut self,
        report: RegistrationReport,
    ) -> Result<RegistrationResult, BoundaryError> {
        if report.operation_id.trim().is_empty() {
            return Err(BoundaryError::new(
                "operation_id_required",
                "A caller-supplied operation ID is required.",
            ));
        }

        if let Some(stored) = self.operations.get(&report.operation_id) {
            if stored.report == report {
                let mut result = stored.result.clone();
                result.replayed = true;
                return Ok(result);
            }
            return Err(BoundaryError::new(
                "operation_mismatch",
                format!(
                    "Operation {} was already applied with different content.",
                    report.operation_id
                ),
            ));
        }

        self.validate_report_context(&report)?;
        let mut item_ids = BTreeSet::new();
        for item in &report.items {
            if !item_ids.insert(item.item_id.clone()) {
                return Err(BoundaryError::new(
                    "duplicate_item_id",
                    format!("Report contains item ID {} more than once.", item.item_id),
                ));
            }
        }

        let mut output_items = Vec::with_capacity(report.items.len());
        for item in &report.items {
            let output = self.validate_item(&report, item);
            if output.result == ItemResult::Ready {
                self.store_association(&report, &output);
            }
            self.persisted_items.push(PersistedRegistration {
                operation_id: report.operation_id.clone(),
                workspace_id: report.workspace_id.clone(),
                task_id: report.task_id.clone(),
                session_id: report.session_id.clone(),
                item: output.clone(),
            });
            output_items.push(output);
        }

        let result = RegistrationResult {
            operation_id: report.operation_id.clone(),
            workspace_id: report.workspace_id.clone(),
            task_id: report.task_id.clone(),
            session_id: report.session_id.clone(),
            replayed: false,
            items: output_items,
        };
        self.operations.insert(
            report.operation_id.clone(),
            StoredOperation {
                report,
                result: result.clone(),
            },
        );
        Ok(result)
    }

    pub fn persisted_items(&self, task_id: &str) -> Vec<RegistrationItem> {
        self.persisted_items
            .iter()
            .filter(|entry| entry.task_id == task_id)
            .map(|entry| entry.item.clone())
            .collect()
    }

    pub fn operation_count(&self) -> usize {
        self.operations.len()
    }

    pub fn association_count(&self) -> usize {
        self.associations.len()
    }

    pub fn cleanup_records(&self) -> Vec<CleanupDecision> {
        self.cleanup.clone()
    }

    pub fn snapshot(&self) -> BoundarySnapshot {
        BoundarySnapshot {
            operation_ids: self.operations.keys().cloned().collect(),
            persisted_items: self.persisted_items.clone(),
            cleanup: self.cleanup.clone(),
        }
    }

    pub fn cleanup_worktree(
        &mut self,
        task_id: &str,
        repository_id: &str,
        worktree_path: &Path,
    ) -> Result<CleanupDecision, BoundaryError> {
        let task = self.tasks.get(task_id).ok_or_else(|| {
            BoundaryError::new(
                "task_not_found",
                format!("Task {task_id} is not registered."),
            )
        })?;
        if !task.completed {
            return Err(BoundaryError::new(
                "task_not_completed",
                format!("Task {task_id} is not eligible for cleanup."),
            ));
        }
        let repository = self
            .repositories
            .get(repository_id)
            .cloned()
            .ok_or_else(|| {
                BoundaryError::new(
                    "repository_not_cataloged",
                    format!("Repository {repository_id} is not registered."),
                )
            })?;
        let canonical_worktree = canonical_directory(worktree_path).map_err(|error| {
            BoundaryError::new(
                "worktree_not_found",
                format!("Could not canonicalize the worktree path: {error}"),
            )
        })?;
        let canonical_worktree_string = canonical_worktree.to_string_lossy().into_owned();
        let association = self
            .associations
            .values()
            .find(|association| {
                association.task_id == task_id
                    && association.repository_id == repository_id
                    && association.worktree_path == canonical_worktree_string
            })
            .cloned()
            .ok_or_else(|| {
                BoundaryError::new(
                    "worktree_not_registered",
                    format!("The worktree is not associated with task {task_id}."),
                )
            })?;
        let in_use = self
            .sessions
            .values()
            .any(|session| session.worktree_path.as_ref() == Some(&canonical_worktree));

        let mut decision = if in_use {
            CleanupDecision {
                task_id: task_id.to_owned(),
                repository_id: repository_id.to_owned(),
                branch: association.branch.clone(),
                worktree_path: canonical_worktree_string.clone(),
                classification: CleanupClassification::InUse,
                removed: false,
                branch_retained: true,
                detail: "An active session still uses this worktree.".to_owned(),
            }
        } else {
            let status = git_output(
                &canonical_worktree,
                &[
                    "status".to_owned(),
                    "--porcelain".to_owned(),
                    "--untracked-files=all".to_owned(),
                ],
            )?;
            if !status.trim().is_empty() {
                CleanupDecision {
                    task_id: task_id.to_owned(),
                    repository_id: repository_id.to_owned(),
                    branch: association.branch.clone(),
                    worktree_path: canonical_worktree_string.clone(),
                    classification: CleanupClassification::DirtyOrNewFile,
                    removed: false,
                    branch_retained: true,
                    detail: "Uncommitted changes or new files were found.".to_owned(),
                }
            } else {
                git_output(
                    Path::new(&repository.canonical_path),
                    &[
                        "worktree".to_owned(),
                        "remove".to_owned(),
                        canonical_worktree_string.clone(),
                    ],
                )?;
                CleanupDecision {
                    task_id: task_id.to_owned(),
                    repository_id: repository_id.to_owned(),
                    branch: association.branch.clone(),
                    worktree_path: canonical_worktree_string.clone(),
                    classification: CleanupClassification::CleanUnused,
                    removed: !canonical_worktree.exists(),
                    branch_retained: false,
                    detail: "Clean unused worktree removed; branch was not deleted.".to_owned(),
                }
            }
        };

        decision.branch_retained =
            branch_exists(Path::new(&repository.canonical_path), &decision.branch)?;
        if decision.classification == CleanupClassification::CleanUnused && !decision.removed {
            return Err(BoundaryError::new(
                "worktree_removal_incomplete",
                "Git reported success but the clean worktree still exists.",
            ));
        }
        self.cleanup.push(decision.clone());
        Ok(decision)
    }

    fn validate_report_context(&self, report: &RegistrationReport) -> Result<(), BoundaryError> {
        if report.workspace_id.trim().is_empty()
            || report.task_id.trim().is_empty()
            || report.session_id.trim().is_empty()
        {
            return Err(BoundaryError::new(
                "owner_context_required",
                "Workspace, task, and session IDs are required.",
            ));
        }
        let workspace = self.workspaces.get(&report.workspace_id).ok_or_else(|| {
            BoundaryError::new(
                "workspace_not_found",
                format!("Workspace {} is not registered.", report.workspace_id),
            )
        })?;
        if !workspace.active {
            return Err(BoundaryError::new(
                "workspace_inactive",
                format!("Workspace {} is not active.", report.workspace_id),
            ));
        }
        let task = self.tasks.get(&report.task_id).ok_or_else(|| {
            BoundaryError::new(
                "task_not_found",
                format!("Task {} is not registered.", report.task_id),
            )
        })?;
        if !task.active {
            return Err(BoundaryError::new(
                "task_inactive",
                format!("Task {} is not active.", report.task_id),
            ));
        }
        if task.workspace_id != report.workspace_id {
            return Err(BoundaryError::new(
                "task_owner_mismatch",
                format!(
                    "Task {} belongs to workspace {}, not {}.",
                    report.task_id, task.workspace_id, report.workspace_id
                ),
            ));
        }
        let session = self.sessions.get(&report.session_id).ok_or_else(|| {
            BoundaryError::new(
                "caller_session_not_found",
                format!("Session {} is not registered.", report.session_id),
            )
        })?;
        if session.workspace_id != report.workspace_id || session.task_id != report.task_id {
            return Err(BoundaryError::new(
                "caller_session_mismatch",
                format!(
                    "Session {} belongs to {}/ {}, not {}/{}.",
                    report.session_id,
                    session.workspace_id,
                    session.task_id,
                    report.workspace_id,
                    report.task_id
                ),
            ));
        }
        if report.items.is_empty() {
            return Err(BoundaryError::new(
                "items_required",
                "A registration report must contain at least one item.",
            ));
        }
        Ok(())
    }

    fn validate_item(
        &self,
        report: &RegistrationReport,
        item: &RegistrationItem,
    ) -> RegistrationItem {
        let repository = match self.validate_repository(item) {
            Ok(repository) => repository,
            Err(error) => return failed_item(item.clone(), error),
        };
        let mut normalized = item.clone();
        normalized.repository_path = repository.canonical_path.clone();
        normalized.git_identity = repository.git_identity.clone();

        if item.result != ItemResult::Ready {
            if item
                .error_code
                .as_deref()
                .unwrap_or_default()
                .trim()
                .is_empty()
                || item.detail.as_deref().unwrap_or_default().trim().is_empty()
            {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "error_detail_required",
                        "Failed and not_attempted items need error_code and detail.",
                    ),
                );
            }
            return normalized;
        }

        if item.error_code.is_some() || item.detail.is_some() {
            return failed_item(
                item.clone(),
                BoundaryError::new(
                    "ready_error_fields",
                    "A ready item cannot also contain an error code or detail.",
                ),
            );
        }
        let branch = match item.branch.as_deref() {
            Some(branch) if !branch.trim().is_empty() => branch,
            _ => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new("branch_required", "A ready item must report a branch."),
                )
            }
        };
        let worktree_path = match item.worktree_path.as_deref() {
            Some(path) if !path.trim().is_empty() => path,
            _ => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_path_required",
                        "A ready item must report a worktree path.",
                    ),
                )
            }
        };
        if !branch_name_is_valid(&repository.canonical_path, branch) {
            return failed_item(
                item.clone(),
                BoundaryError::new(
                    "branch_invalid",
                    format!("Branch {branch} is not a valid local branch name."),
                ),
            );
        }
        match branch_exists(Path::new(&repository.canonical_path), branch) {
            Ok(true) => {}
            Ok(false) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "branch_not_found",
                        format!("Branch {branch} does not exist in the repository."),
                    ),
                )
            }
            Err(error) => return failed_item(item.clone(), error),
        }

        let canonical_worktree = match canonical_directory(Path::new(worktree_path)) {
            Ok(path) => path,
            Err(error) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_not_found",
                        format!("Could not canonicalize the worktree path: {error}"),
                    ),
                )
            }
        };
        let task_root = self
            .tasks
            .get(&report.task_id)
            .expect("report context is validated before item validation")
            .allowed_worktree_root
            .clone();
        if !is_within(&task_root, &canonical_worktree) {
            return failed_item(
                item.clone(),
                BoundaryError::new(
                    "task_worktree_boundary",
                    format!(
                        "Worktree {} is outside task root {}.",
                        canonical_worktree.display(),
                        task_root.display()
                    ),
                ),
            );
        }
        let worktree_root = match git_root(&canonical_worktree) {
            Ok(root) => root,
            Err(error) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_not_git",
                        format!("The reported worktree is not a Git checkout: {error}"),
                    ),
                )
            }
        };
        if worktree_root != canonical_worktree {
            return failed_item(
                item.clone(),
                BoundaryError::new(
                    "worktree_path_not_root",
                    "The reported worktree path must be its checkout root.",
                ),
            );
        }
        match git_identity(&canonical_worktree) {
            Ok(identity) if identity == repository.git_identity => {}
            Ok(_) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_repository_mismatch",
                        "The worktree belongs to a different repository identity.",
                    ),
                )
            }
            Err(error) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_identity_unavailable",
                        format!("Could not inspect worktree identity: {error}"),
                    ),
                )
            }
        }
        match git_root_is_registered(&repository.canonical_path, &canonical_worktree) {
            Ok(true) => {}
            Ok(false) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_not_registered",
                        "The path is not registered in the repository's Git worktree list.",
                    ),
                )
            }
            Err(error) => return failed_item(item.clone(), error),
        }
        match git_output(
            &canonical_worktree,
            &["branch".to_owned(), "--show-current".to_owned()],
        ) {
            Ok(current_branch) if current_branch == branch => {}
            Ok(current_branch) => {
                return failed_item(
                    item.clone(),
                    BoundaryError::new(
                        "worktree_branch_mismatch",
                        format!("The worktree is on branch {current_branch}, not {branch}."),
                    ),
                )
            }
            Err(error) => return failed_item(item.clone(), error),
        }
        if let Some(error) = self.ownership_conflict(
            &report.task_id,
            &repository.repository_id,
            branch,
            &canonical_worktree,
        ) {
            return failed_item(item.clone(), error);
        }
        normalized.worktree_path = Some(canonical_worktree.to_string_lossy().into_owned());
        normalized
    }

    fn validate_repository(
        &self,
        item: &RegistrationItem,
    ) -> Result<RepositoryRecord, BoundaryError> {
        let repository = self
            .repositories
            .get(&item.repository_id)
            .cloned()
            .ok_or_else(|| {
                BoundaryError::new(
                    "repository_not_cataloged",
                    format!("Repository {} is not registered.", item.repository_id),
                )
            })?;
        let reported_path =
            canonical_directory(Path::new(&item.repository_path)).map_err(|error| {
                BoundaryError::new(
                    "repository_path_invalid",
                    format!("Could not canonicalize the reported repository path: {error}"),
                )
            })?;
        if reported_path.as_path() != Path::new(&repository.canonical_path) {
            return Err(BoundaryError::new(
                "repository_path_mismatch",
                format!(
                    "Report path {} does not match catalog path {}.",
                    reported_path.display(),
                    repository.canonical_path
                ),
            ));
        }
        let root = git_root(&reported_path).map_err(|error| {
            BoundaryError::new(
                "repository_not_git",
                format!("Could not inspect the reported repository: {error}"),
            )
        })?;
        if root != reported_path {
            return Err(BoundaryError::new(
                "repository_path_not_root",
                "The reported repository path must be its Git root.",
            ));
        }
        let observed_identity = git_identity(&reported_path).map_err(|error| {
            BoundaryError::new(
                "repository_identity_unavailable",
                format!("Could not inspect the reported repository identity: {error}"),
            )
        })?;
        if observed_identity != repository.git_identity {
            return Err(BoundaryError::new(
                "repository_identity_mismatch",
                "The repository identity changed since cataloging.",
            ));
        }
        let reported_identity = canonicalize_identity(&item.git_identity).ok_or_else(|| {
            BoundaryError::new(
                "repository_identity_mismatch",
                "The report did not contain a canonical Git identity.",
            )
        })?;
        if reported_identity.as_path() != Path::new(&repository.git_identity) {
            return Err(BoundaryError::new(
                "repository_identity_mismatch",
                "The report identity does not match the catalog identity.",
            ));
        }
        Ok(repository)
    }

    fn ownership_conflict(
        &self,
        task_id: &str,
        repository_id: &str,
        branch: &str,
        worktree_path: &Path,
    ) -> Option<BoundaryError> {
        let worktree_path = worktree_path.to_string_lossy();
        self.associations.values().find_map(|association| {
            if association.repository_id != repository_id
                || (association.branch != branch
                    && association.worktree_path != worktree_path.as_ref())
            {
                return None;
            }
            if association.task_id != task_id && self.task_is_active(&association.task_id) {
                return Some(BoundaryError::new(
                    "conflicting_active_ownership",
                    format!(
                        "{} is already owned by active task {}.",
                        worktree_path, association.task_id
                    ),
                ));
            }
            None
        })
    }

    fn task_is_active(&self, task_id: &str) -> bool {
        self.tasks
            .get(task_id)
            .map(|task| task.active)
            .unwrap_or(false)
    }

    fn store_association(&mut self, report: &RegistrationReport, item: &RegistrationItem) {
        let branch = item
            .branch
            .as_ref()
            .expect("ready item has a branch after validation")
            .clone();
        let worktree_path = item
            .worktree_path
            .as_ref()
            .expect("ready item has a worktree after validation")
            .clone();
        let key = AssociationKey {
            repository_id: item.repository_id.clone(),
            branch: branch.clone(),
            worktree_path: worktree_path.clone(),
        };
        self.associations.entry(key).or_insert_with(|| Association {
            task_id: report.task_id.clone(),
            repository_id: item.repository_id.clone(),
            branch,
            worktree_path,
        });
    }
}

fn failed_item(mut item: RegistrationItem, error: BoundaryError) -> RegistrationItem {
    item.result = ItemResult::Failed;
    item.error_code = Some(error.code);
    item.detail = Some(error.detail);
    item
}

fn canonical_directory(path: &Path) -> Result<PathBuf, std::io::Error> {
    let canonical = fs::canonicalize(path)?;
    if !canonical.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "path is not a directory",
        ));
    }
    Ok(canonical)
}

fn canonicalize_identity(identity: &str) -> Option<PathBuf> {
    fs::canonicalize(identity).ok()
}

fn git_output(cwd: &Path, args: &[String]) -> Result<String, BoundaryError> {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .map_err(|error| {
            BoundaryError::new("git_unavailable", format!("Could not execute Git: {error}"))
        })?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        return Err(BoundaryError::new(
            "git_command_failed",
            if detail.is_empty() {
                format!("Git exited with status {}.", output.status)
            } else {
                detail
            },
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn git_root(path: &Path) -> Result<PathBuf, BoundaryError> {
    let root = git_output(
        path,
        &["rev-parse".to_owned(), "--show-toplevel".to_owned()],
    )?;
    canonical_directory(Path::new(&root)).map_err(|error| {
        BoundaryError::new(
            "git_root_invalid",
            format!("Git returned an invalid repository root: {error}"),
        )
    })
}

fn git_identity(path: &Path) -> Result<String, BoundaryError> {
    let common_dir = git_output(
        path,
        &["rev-parse".to_owned(), "--git-common-dir".to_owned()],
    )?;
    let common_dir = PathBuf::from(common_dir);
    let common_dir = if common_dir.is_absolute() {
        common_dir
    } else {
        path.join(common_dir)
    };
    let common_dir = fs::canonicalize(&common_dir).map_err(|error| {
        BoundaryError::new(
            "git_identity_invalid",
            format!("Git returned an invalid common directory: {error}"),
        )
    })?;
    Ok(common_dir.to_string_lossy().into_owned())
}

fn branch_name_is_valid(repository_path: &str, branch: &str) -> bool {
    git_output(
        Path::new(repository_path),
        &[
            "check-ref-format".to_owned(),
            "--branch".to_owned(),
            branch.to_owned(),
        ],
    )
    .is_ok()
}

fn branch_exists(repository_path: &Path, branch: &str) -> Result<bool, BoundaryError> {
    let args = vec![
        "show-ref".to_owned(),
        "--verify".to_owned(),
        "--quiet".to_owned(),
        format!("refs/heads/{branch}"),
    ];
    let output = Command::new("git")
        .args(&args)
        .current_dir(repository_path)
        .output()
        .map_err(|error| BoundaryError::new("git_unavailable", error.to_string()))?;
    if output.status.success() {
        return Ok(true);
    }
    if output.status.code() == Some(1) {
        return Ok(false);
    }
    Err(BoundaryError::new(
        "git_command_failed",
        String::from_utf8_lossy(&output.stderr).trim().to_owned(),
    ))
}

fn git_root_is_registered(
    repository_path: &str,
    worktree_path: &Path,
) -> Result<bool, BoundaryError> {
    let listing = git_output(
        Path::new(repository_path),
        &[
            "worktree".to_owned(),
            "list".to_owned(),
            "--porcelain".to_owned(),
        ],
    )?;
    for line in listing.lines() {
        if let Some(path) = line.strip_prefix("worktree ") {
            if let Ok(canonical) = canonical_directory(Path::new(path)) {
                if canonical == worktree_path {
                    return Ok(true);
                }
            }
        }
    }
    Ok(false)
}

fn is_within(root: &Path, child: &Path) -> bool {
    child != root && child.strip_prefix(root).is_ok()
}
