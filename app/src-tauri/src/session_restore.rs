//! Production orchestration for restoring or replacing owner-tracked sessions.

use std::{path::Path, time::SystemTime};

use crate::{
    management::{self, ManagementStore, SessionOwner, SessionRecord},
    opencode::ModelReference,
};

/// Only the external OpenCode and terminal effects are substituted in tests.
/// The production store, validation, ownership, and recovery ordering stay real.
pub trait SessionRestoreRuntime {
    fn session_exists(&mut self, session_id: &str) -> Result<bool, String>;
    fn create_session(
        &mut self,
        title: &str,
        directory: &Path,
        model: &ModelReference,
    ) -> Result<String, String>;
    fn attach_terminal(&mut self, session_id: &str, directory: &Path) -> Result<(), String>;
}

pub fn restore_or_replace<
    R: SessionRestoreRuntime,
    M: FnOnce() -> Result<ModelReference, String>,
>(
    store: &ManagementStore,
    session_id: &str,
    default_model: M,
    runtime: &mut R,
) -> Result<SessionRecord, String> {
    let session = store
        .get_session(session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Persisted OpenCode session not found".to_owned())?;
    if session.last_known_status == "missing" {
        return Err("This session was replaced because OpenCode no longer has it. Select its current owner session instead.".into());
    }
    store
        .validate_session_context(session_id, Path::new(&session.directory))
        .map_err(|error| error.to_string())?;
    if runtime.session_exists(session_id)? {
        runtime.attach_terminal(session_id, Path::new(&session.directory))?;
        return Ok(session);
    }

    let default_model = default_model()?;

    let title = match &session.owner {
        SessionOwner::Workspace(id) => {
            let workspace = store
                .get_workspace(id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Workspace not found".to_owned())?;
            if workspace.status != management::WorkspaceStatus::Active {
                return Err("Cannot replace a missing session for a completed Workspace.".into());
            }
            workspace.name
        }
        SessionOwner::Task(id) => {
            let task = store
                .get_task(id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Task not found".to_owned())?;
            if task.status != management::TaskStatus::Active {
                return Err("Cannot replace a missing session for a completed Task.".into());
            }
            let repository_id = store
                .list_task_repository_sessions(id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .find_map(|(candidate, repository_id, _)| {
                    (candidate == session_id).then_some(repository_id)
                })
                .ok_or_else(|| {
                    "The missing Task session has no repository association.".to_owned()
                })?;
            format!("{} — {}", task.name, repository_id)
        }
    };

    let replacement_id =
        runtime.create_session(&title, Path::new(&session.directory), &default_model)?;
    let replacement = store
        .replace_missing_session(
            session_id,
            &management::NewSession {
                open_code_session_id: replacement_id.clone(),
                owner: session.owner.clone(),
                directory: session.directory.clone(),
                last_known_status: "starting".into(),
                created_at: now_millis(),
            },
            &format!("{}/{}", default_model.provider_id, default_model.id),
            now_millis(),
        )
        .map_err(|error| error.to_string())?;
    // The replacement and its repository binding are durable before attaching.
    // If terminal startup fails, the next selection retries this saved ID.
    runtime.attach_terminal(&replacement_id, Path::new(&replacement.directory))?;
    Ok(replacement)
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
