//! Task repository worktree/session provisioning orchestration.

use std::{collections::HashSet, path::Path, time::SystemTime};

use serde_json::{json, Value};

use crate::{
    management::{self, ManagementStore, RepositorySetupStatus, Task, TaskSetupStatus},
    opencode::ModelReference,
    workspace_setup,
};

/// The narrow external session boundary used by task setup. SQLite and Git stay
/// real in production and integration tests; only OpenCode/terminal operations
/// need a controlled implementation in tests.
pub trait TaskSessionStarter {
    fn is_attached(&self, session_id: &str) -> bool;
    fn create_session(
        &mut self,
        title: &str,
        directory: &Path,
        model: &ModelReference,
    ) -> Result<String, String>;
    fn attach_terminal(&mut self, session_id: &str, directory: &Path) -> Result<(), String>;
    fn cleanup_terminal(&mut self, session_id: &str);
}

/// Applies confirmed Task metadata, persists its immutable repository selection,
/// and provisions real Task worktrees plus empty tracked sessions.
#[allow(clippy::too_many_arguments)]
pub fn create_task_from_confirmation<S: TaskSessionStarter>(
    store: &ManagementStore,
    workspace_id: &str,
    id: String,
    name: String,
    description: Option<String>,
    repository_ids: &[String],
    created_at: i64,
    selected_model: &str,
    model: &ModelReference,
    sessions_runtime: &mut S,
) -> Result<Value, String> {
    let workspace = store
        .get_workspace(workspace_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Workspace not found".to_owned())?;
    if workspace.kind != management::WorkspaceKind::Regular
        || workspace.status != management::WorkspaceStatus::Active
    {
        return Err("Tasks can only be created in an active regular workspace.".into());
    }
    let workspace_bindings = store
        .list_workspace_repository_bindings(&workspace.id)
        .map_err(|error| error.to_string())?;
    validate_repository_selection(&workspace_bindings, repository_ids)?;
    let name = name.trim().to_owned();
    if name.is_empty() {
        return Err("Task name must not be empty.".into());
    }
    let slug = id.strip_prefix("task-").unwrap_or(&id).to_owned();
    let task = store
        .create_task(&management::NewTask {
            id,
            workspace_id: workspace.id.clone(),
            name,
            slug,
            description: description.filter(|value| !value.trim().is_empty()),
            setup_status: TaskSetupStatus::NotStarted,
            created_at,
        })
        .map_err(|error| error.to_string())?;
    store
        .save_task_repository_selection(&task.id, repository_ids, task.created_at)
        .map_err(|error| error.to_string())?;
    provision_task_repositories(
        store,
        &task,
        &workspace_bindings,
        repository_ids,
        selected_model,
        model,
        sessions_runtime,
    )
}

/// Retries only the exact repository selection persisted at Task confirmation.
pub fn retry_task_setup<S: TaskSessionStarter>(
    store: &ManagementStore,
    task_id: &str,
    selected_model: &str,
    model: &ModelReference,
    sessions_runtime: &mut S,
) -> Result<Value, String> {
    let task = store
        .get_task(task_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Task not found.".to_owned())?;
    if task.status != management::TaskStatus::Active || task.quick_request.is_some() {
        return Err("Only active regular tasks can retry repository setup.".into());
    }
    let repository_ids = store
        .task_repository_selection(&task.id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "The confirmed repository selection is unavailable.".to_owned())?;
    let bindings = store
        .list_workspace_repository_bindings(&task.workspace_id)
        .map_err(|error| error.to_string())?;
    validate_repository_selection(&bindings, &repository_ids)?;
    provision_task_repositories(
        store,
        &task,
        &bindings,
        &repository_ids,
        selected_model,
        model,
        sessions_runtime,
    )
}

/// Provisions each confirmed repository's real Git worktree and tracked empty
/// session, returning the same per-repository result shape used by the command.
pub fn provision_task_repositories<S: TaskSessionStarter>(
    store: &ManagementStore,
    task: &Task,
    workspace_bindings: &[management::WorkspaceRepositoryBinding],
    repository_ids: &[String],
    selected_model: &str,
    model: &ModelReference,
    sessions_runtime: &mut S,
) -> Result<Value, String> {
    let mut outcomes = Vec::new();
    let mut sessions = Vec::new();
    for repository_id in repository_ids {
        let Some(binding) = workspace_bindings
            .iter()
            .find(|binding| binding.repository_id == *repository_id)
        else {
            continue;
        };
        let metadata = store
            .workspace_repository_checkout_metadata(&task.workspace_id, repository_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| {
                format!("Workspace checkout metadata for {repository_id} is missing.")
            })?;
        let worktree = workspace_setup::provision_task_worktree(
            Path::new(&binding.checkout_path),
            Path::new(&task.home_path),
            &task.id,
            repository_id,
            &metadata.default_branch,
            &metadata.checkout_identity,
        );
        let worktree = match worktree {
            Ok(worktree) => worktree,
            Err(error) => {
                let token = repository_id
                    .as_bytes()
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>();
                let expected_path = Path::new(&task.home_path).join("worktrees").join(token);
                let failed_path = expected_path
                    .exists()
                    .then(|| expected_path.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let _ = store.save_task_repository_binding(&management::TaskRepositoryBinding {
                    task_id: task.id.clone(),
                    repository_id: repository_id.clone(),
                    branch: format!("work/{}", task.id),
                    worktree_path: failed_path,
                    setup_status: RepositorySetupStatus::Failed,
                    error_code: Some("worktree_setup_failed".into()),
                    error_detail: Some(error.clone()),
                    created_at: task.created_at,
                    updated_at: now_millis(),
                });
                outcomes.push(json!({"repositoryId": repository_id, "setupStatus":"failed", "errorDetail":error}));
                continue;
            }
        };
        let task_binding = management::TaskRepositoryBinding {
            task_id: task.id.clone(),
            repository_id: repository_id.clone(),
            branch: worktree.branch.clone(),
            worktree_path: worktree.path.to_string_lossy().into_owned(),
            setup_status: RepositorySetupStatus::Ready,
            error_code: None,
            error_detail: None,
            created_at: task.created_at,
            updated_at: now_millis(),
        };
        if let Err(error) = store.validate_and_save_task_repository_binding(&task_binding) {
            let detail = error.to_string();
            let _ = store.save_task_repository_binding(&management::TaskRepositoryBinding {
                setup_status: RepositorySetupStatus::Failed,
                error_code: Some("worktree_verification_failed".into()),
                error_detail: Some(detail.clone()),
                ..task_binding
            });
            outcomes.push(json!({"repositoryId": repository_id, "setupStatus":"failed", "errorDetail":detail}));
            continue;
        }
        outcomes.push(json!({"repositoryId": repository_id, "setupStatus":"ready", "worktreePath":worktree.path}));
        let existing_sessions = store
            .list_task_repository_sessions(&task.id)
            .map_err(|error| error.to_string())?;
        if let Some((session_id, _, directory)) = existing_sessions
            .iter()
            .find(|(_, existing_repository_id, _)| existing_repository_id == repository_id)
        {
            if !sessions_runtime.is_attached(session_id) {
                if let Err(error) =
                    sessions_runtime.attach_terminal(session_id, Path::new(directory))
                {
                    record_task_session_setup_failure(
                        store,
                        task,
                        repository_id,
                        "terminal_attach_failed",
                        &error,
                    );
                    outcomes.last_mut().unwrap()["sessionError"] = json!(error);
                    continue;
                }
            }
            if let Some(session) = store
                .get_session(session_id)
                .map_err(|error| error.to_string())?
            {
                sessions.push(session);
            }
            continue;
        }
        let title = format!("{} — {}", task.name, repository_id);
        let session_id = match sessions_runtime.create_session(&title, &worktree.path, model) {
            Ok(id) => id,
            Err(error) => {
                record_task_session_setup_failure(
                    store,
                    task,
                    repository_id,
                    "session_start_failed",
                    &error,
                );
                outcomes.last_mut().unwrap()["sessionError"] = json!(error);
                continue;
            }
        };
        let session = match store.create_session_with_model(
            &management::NewSession {
                open_code_session_id: session_id.clone(),
                owner: management::SessionOwner::Task(task.id.clone()),
                directory: worktree.path.to_string_lossy().into_owned(),
                last_known_status: "starting".into(),
                created_at: now_millis(),
            },
            selected_model,
        ) {
            Ok(session) => session,
            Err(error) => {
                sessions_runtime.cleanup_terminal(&session_id);
                record_task_session_setup_failure(
                    store,
                    task,
                    repository_id,
                    "session_persistence_failed",
                    &error.to_string(),
                );
                outcomes.last_mut().unwrap()["sessionError"] = json!(error.to_string());
                continue;
            }
        };
        if let Err(error) = store.bind_task_session_repository(&task.id, &session_id, repository_id)
        {
            sessions_runtime.cleanup_terminal(&session_id);
            record_task_session_setup_failure(
                store,
                task,
                repository_id,
                "session_binding_failed",
                &error.to_string(),
            );
            outcomes.last_mut().unwrap()["sessionError"] = json!(error.to_string());
            continue;
        }
        if let Err(error) = sessions_runtime.attach_terminal(&session_id, &worktree.path) {
            record_task_session_setup_failure(
                store,
                task,
                repository_id,
                "terminal_attach_failed",
                &error,
            );
            outcomes.last_mut().unwrap()["sessionError"] = json!(error);
            continue;
        }
        sessions.push(session);
    }
    let incomplete = outcomes
        .iter()
        .any(|item| item["setupStatus"] != "ready" || !item.get("sessionError").is_none());
    store
        .update_task_setup_status(
            &task.id,
            if incomplete {
                TaskSetupStatus::Incomplete
            } else {
                TaskSetupStatus::Ready
            },
        )
        .map_err(|error| error.to_string())?;
    let task = store
        .get_task(&task.id)
        .map_err(|error| error.to_string())?
        .unwrap_or_else(|| task.clone());
    Ok(json!({
        "task": task,
        "sessions": sessions,
        "repositories": outcomes,
    }))
}

fn record_task_session_setup_failure(
    store: &ManagementStore,
    task: &Task,
    repository_id: &str,
    error_code: &str,
    error_detail: &str,
) {
    if let Ok(bindings) = store.list_task_repository_bindings(&task.id) {
        if let Some(binding) = bindings
            .iter()
            .find(|binding| binding.repository_id == repository_id)
        {
            let _ = store.save_task_repository_binding(&management::TaskRepositoryBinding {
                setup_status: RepositorySetupStatus::Failed,
                error_code: Some(error_code.to_owned()),
                error_detail: Some(error_detail.to_owned()),
                updated_at: now_millis(),
                ..binding.clone()
            });
        }
    }
}

pub(crate) fn validate_repository_selection(
    bindings: &[management::WorkspaceRepositoryBinding],
    repository_ids: &[String],
) -> Result<(), String> {
    let mut unique_repository_ids = HashSet::new();
    for repository_id in repository_ids {
        if !unique_repository_ids.insert(repository_id) {
            return Err(format!(
                "Repository {repository_id} was selected more than once."
            ));
        }
        let binding = bindings
            .iter()
            .find(|binding| binding.repository_id == *repository_id)
            .ok_or_else(|| {
                format!("Repository {repository_id} is not associated with the task's workspace.")
            })?;
        if binding.verification_status != management::VerificationStatus::Verified {
            return Err(format!(
                "Repository {repository_id} is not verified in the task's workspace."
            ));
        }
    }
    Ok(())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
