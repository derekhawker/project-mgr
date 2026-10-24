//! Generates the Workspace-local OpenCode plugin configuration for multi-repo
//! coordination. The worker IDs here are application associations, not prompts.

use crate::management::{
    ManagementStore, SessionOwner, Workspace, WorkspaceSessionRole, WorkspaceWorktreeStatus,
};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};

const PLUGIN_SOURCE: &str = include_str!("../plugins/workspace-coordinator/index.ts");
const TOOL_SOURCE: &[u8] = include_bytes!("../plugins/workspace-coordinator/coordinator.mjs");
const PLUGIN_DIRECTORY: &str = ".opencode/plugins/opencode-project-manager-workspace";

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceWorker {
    pub repository_id: String,
    pub repository_name: String,
    pub session_id: String,
}

/// Resolve the worker allowlist from production persistence, verify that each
/// worker still uses its ready Workspace worktree, then install the plugin.
pub fn install_for_workspace(store: &ManagementStore, workspace: &Workspace) -> Result<(), String> {
    let worktrees = store
        .list_workspace_repository_worktrees(&workspace.id)
        .map_err(|error| error.to_string())?;
    if worktrees.len() < 2
        || worktrees
            .iter()
            .any(|worktree| worktree.setup_status != WorkspaceWorktreeStatus::Ready)
    {
        return Err(
            "multi-repository coordination requires at least two ready Workspace worktrees".into(),
        );
    }

    let contexts = store
        .list_workspace_session_context(&workspace.id)
        .map_err(|error| error.to_string())?;
    let sessions = store
        .list_sessions(&SessionOwner::Workspace(workspace.id.clone()))
        .map_err(|error| error.to_string())?;
    let worker_contexts = contexts
        .iter()
        .filter(|context| context.role == WorkspaceSessionRole::Worker)
        .count();
    if worker_contexts != worktrees.len() {
        return Err(
            "tracked worker-session count does not match the Workspace worktree count".into(),
        );
    }
    let mut workers = Vec::with_capacity(worktrees.len());
    for worktree in &worktrees {
        let context = contexts
            .iter()
            .find(|context| {
                context.role == WorkspaceSessionRole::Worker
                    && context.repository_id.as_deref() == Some(worktree.repository_id.as_str())
            })
            .ok_or_else(|| {
                format!(
                    "repository {} has no tracked worker session",
                    worktree.repository_id
                )
            })?;
        let session = sessions
            .iter()
            .find(|session| session.open_code_session_id == context.open_code_session_id)
            .ok_or_else(|| {
                format!(
                    "worker session {} is not tracked by the Workspace",
                    context.open_code_session_id
                )
            })?;
        if session.directory != worktree.worktree_path {
            return Err(format!(
                "worker session {} is not rooted at its recorded worktree",
                session.open_code_session_id
            ));
        }
        let repository = store
            .get_repository(&worktree.repository_id)
            .map_err(|error| error.to_string())?
            .ok_or_else(|| format!("worker repository {} is missing", worktree.repository_id))?;
        workers.push(WorkspaceWorker {
            repository_id: worktree.repository_id.clone(),
            repository_name: repository.name,
            session_id: context.open_code_session_id.clone(),
        });
    }
    install(Path::new(&workspace.home_path), &workspace.id, &workers)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkerManifest<'a> {
    schema_version: u8,
    workspace_id: &'a str,
    workers: &'a [WorkspaceWorker],
}

/// Install the app-owned coordinator plugin without replacing user files.
/// Existing generated files must exactly match the current tracked worker map.
pub fn install(
    workspace_home: &Path,
    workspace_id: &str,
    workers: &[WorkspaceWorker],
) -> Result<(), String> {
    if workspace_id.trim().is_empty() || workers.len() < 2 {
        return Err(
            "the Workspace coordinator requires an ID and at least two repository workers".into(),
        );
    }
    let mut repository_ids = workers
        .iter()
        .map(|worker| worker.repository_id.as_str())
        .collect::<Vec<_>>();
    repository_ids.sort_unstable();
    if repository_ids.iter().any(|id| id.trim().is_empty())
        || repository_ids.windows(2).any(|pair| pair[0] == pair[1])
        || workers.iter().any(|worker| {
            worker.repository_name.trim().is_empty() || worker.session_id.trim().is_empty()
        })
    {
        return Err(
            "the Workspace coordinator worker map is incomplete or contains duplicate repositories"
                .into(),
        );
    }

    let plugin_dir = workspace_home.join(PLUGIN_DIRECTORY);
    ensure_owned_directory(workspace_home, &plugin_dir)?;
    let source_path = plugin_dir.join("index.ts");
    let tool_path = plugin_dir.join("coordinator.mjs");
    let manifest_path = plugin_dir.join("workers.json");
    let manifest = serde_json::to_vec_pretty(&WorkerManifest {
        schema_version: 1,
        workspace_id,
        workers,
    })
    .map_err(|error| format!("could not encode Workspace worker manifest: {error}"))?;

    write_generated_file(&source_path, PLUGIN_SOURCE.as_bytes())?;
    write_generated_file(&tool_path, TOOL_SOURCE)?;
    write_generated_file(&manifest_path, &manifest)?;
    Ok(())
}

fn ensure_owned_directory(home: &Path, directory: &Path) -> Result<(), String> {
    let relative = directory
        .strip_prefix(home)
        .map_err(|_| "Workspace coordinator path escaped its home".to_owned())?;
    let mut cursor = PathBuf::from(home);
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err("Workspace coordinator path contains an unsafe component".into());
        };
        cursor.push(name);
        match fs::symlink_metadata(&cursor) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!(
                    "Workspace coordinator directory is not a real directory: {}",
                    cursor.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&cursor).map_err(|error| {
                    format!(
                        "could not create Workspace coordinator directory {}: {error}",
                        cursor.display()
                    )
                })?;
            }
            Err(error) => {
                return Err(format!(
                    "could not inspect Workspace coordinator directory: {error}"
                ))
            }
        }
    }
    Ok(())
}

fn write_generated_file(path: &Path, expected: &[u8]) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            return Err(format!(
                "refusing to replace non-regular Workspace coordinator file {}",
                path.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "could not inspect Workspace coordinator file {}: {error}",
                path.display()
            ));
        }
    }
    match fs::read(path) {
        Ok(existing) if existing == expected => return Ok(()),
        Ok(_) => {
            return Err(format!(
                "refusing to replace existing Workspace coordinator file {}",
                path.display()
            ))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "could not read Workspace coordinator file {}: {error}",
                path.display()
            ))
        }
    }
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    use std::io::Write;
    let mut file = options.open(path).map_err(|error| {
        format!(
            "could not create Workspace coordinator file {}: {error}",
            path.display()
        )
    })?;
    file.write_all(expected)
        .and_then(|()| file.sync_all())
        .map_err(|error| {
            format!(
                "could not write Workspace coordinator file {}: {error}",
                path.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::management::{
        NewRepository, NewSession, PurposeStatus, WorkspaceKind, WorkspaceRepositoryWorktree,
        WorkspaceWorktreeStatus,
    };
    use std::fs;
    use tempfile::tempdir;

    fn workers() -> Vec<WorkspaceWorker> {
        vec![
            WorkspaceWorker {
                repository_id: "repo-a".into(),
                repository_name: "Alpha".into(),
                session_id: "ses-a".into(),
            },
            WorkspaceWorker {
                repository_id: "repo-b".into(),
                repository_name: "Beta".into(),
                session_id: "ses-b".into(),
            },
        ]
    }

    #[test]
    fn installs_a_stable_plugin_and_exact_worker_manifest_without_prompt_data() {
        let home = tempdir().unwrap();
        let workers = workers();
        install(home.path(), "ws-1", &workers).unwrap();
        install(home.path(), "ws-1", &workers).unwrap();

        let plugin_dir = home.path().join(PLUGIN_DIRECTORY);
        let source = fs::read_to_string(plugin_dir.join("index.ts")).unwrap();
        let tool = fs::read_to_string(plugin_dir.join("coordinator.mjs")).unwrap();
        let manifest = fs::read_to_string(plugin_dir.join("workers.json")).unwrap();
        assert!(source.contains("ctx.session.prompt"));
        assert!(tool.contains("delivery: \"queue\""));
        assert!(!source.contains("ses-a"));
        assert!(!tool.contains("ses-a"));
        assert!(!manifest.contains("prompt"));
        let parsed: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(parsed["workspaceId"], "ws-1");
        assert_eq!(parsed["workers"][0]["sessionId"], "ses-a");
    }

    #[test]
    fn refuses_user_files_symlinked_directories_and_invalid_worker_maps() {
        let home = tempdir().unwrap();
        assert!(install(home.path(), "ws-1", &workers()[..1]).is_err());

        let plugin_dir = home.path().join(PLUGIN_DIRECTORY);
        fs::create_dir_all(&plugin_dir).unwrap();
        fs::write(plugin_dir.join("index.ts"), "user content").unwrap();
        assert!(install(home.path(), "ws-1", &workers())
            .unwrap_err()
            .contains("refusing to replace"));

        let another_home = tempdir().unwrap();
        let opencode_dir = another_home.path().join(".opencode");
        #[cfg(unix)]
        std::os::unix::fs::symlink(another_home.path(), &opencode_dir).unwrap();
        #[cfg(unix)]
        assert!(install(another_home.path(), "ws-1", &workers())
            .unwrap_err()
            .contains("real directory"));
    }

    #[test]
    fn production_store_selects_only_worker_sessions_at_ready_workspace_worktrees() {
        let temp = tempdir().unwrap();
        let home = temp.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let store = ManagementStore::open_with_paths(
            temp.path().join("management.sqlite"),
            &home,
            temp.path(),
        )
        .unwrap();
        let workspace = store
            .create_workspace(&crate::management::NewWorkspace {
                id: "ws-tools".into(),
                name: "Coordinator test".into(),
                slug: "coordinator-test".into(),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        for (index, (repository_id, repository_name)) in [("repo-a", "Alpha"), ("repo-b", "Beta")]
            .into_iter()
            .enumerate()
        {
            store
                .create_repository(&NewRepository {
                    id: repository_id.into(),
                    name: repository_name.into(),
                    repository_path: format!("/sources/{repository_id}"),
                    repository_identity: format!("identity-{repository_id}"),
                    purpose: None,
                    purpose_status: PurposeStatus::Unavailable,
                    created_at: 1,
                })
                .unwrap();
            let worktree_path = temp.path().join(format!("{repository_id}-worktree"));
            fs::create_dir_all(&worktree_path).unwrap();
            store
                .save_workspace_repository_worktree(&WorkspaceRepositoryWorktree {
                    workspace_id: workspace.id.clone(),
                    repository_id: repository_id.into(),
                    source_identity: format!("identity-{repository_id}"),
                    checkout_identity: Some(format!("checkout-{repository_id}")),
                    branch: format!("workspace/{}", workspace.id),
                    base_checkout_path: format!("/library/{repository_id}"),
                    worktree_path: worktree_path.to_string_lossy().into_owned(),
                    workspace_link: format!("/workspace/repos/{repository_id}"),
                    setup_status: WorkspaceWorktreeStatus::Ready,
                    error_code: None,
                    error_detail: None,
                    created_at: 1,
                    updated_at: 1,
                })
                .unwrap();
            let session_id = format!("ses-worker-{index}");
            let session = store
                .create_session(&NewSession {
                    open_code_session_id: session_id.clone(),
                    owner: SessionOwner::Workspace(workspace.id.clone()),
                    directory: worktree_path.to_string_lossy().into_owned(),
                    last_known_status: "starting".into(),
                    created_at: 2 + index as i64,
                })
                .unwrap();
            store
                .save_workspace_session_context(&crate::management::WorkspaceSessionContext {
                    open_code_session_id: session.open_code_session_id,
                    workspace_id: workspace.id.clone(),
                    role: WorkspaceSessionRole::Worker,
                    repository_id: Some(repository_id.into()),
                })
                .unwrap();
        }

        install_for_workspace(&store, &workspace).unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(
            &fs::read(
                temp.path()
                    .join(&workspace.home_path)
                    .join(PLUGIN_DIRECTORY)
                    .join("workers.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(manifest["workers"].as_array().unwrap().len(), 2);
        assert_eq!(manifest["workers"][0]["repositoryId"], "repo-a");
        assert_eq!(manifest["workers"][0]["sessionId"], "ses-worker-0");
    }
}
