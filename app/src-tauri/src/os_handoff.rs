use crate::management::{ManagementStore, WorkspaceKind, WorkspaceStatus};
use std::path::{Path, PathBuf};

pub fn owner_home(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
) -> Result<PathBuf, String> {
    let raw_path = match owner_type {
        "workspace" => {
            let workspace = store
                .get_workspace(owner_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| "Workspace was not found.".to_owned())?;
            if workspace.kind != WorkspaceKind::Regular
                || workspace.status != WorkspaceStatus::Active
            {
                return Err("OS handoff requires an active regular Workspace.".into());
            }
            workspace.home_path
        }
        _ => return Err("OS handoff owner type must be workspace.".into()),
    };
    let path = Path::new(&raw_path)
        .canonicalize()
        .map_err(|error| format!("Owner home is unavailable: {error}"))?;
    if !path.is_dir() {
        return Err("Owner home is not a directory.".into());
    }
    Ok(path)
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Launch {
    pub executable: String,
    pub args: Vec<String>,
}

pub fn external_launch(action: &str, directory: &Path, platform: &str) -> Result<Launch, String> {
    let path = directory.to_string_lossy().into_owned();
    match (platform, action) {
        ("linux", "idea") => Ok(Launch {
            executable: "idea".into(),
            args: vec![path],
        }),
        ("linux", "folder") => Ok(Launch {
            executable: "xdg-open".into(),
            args: vec![path],
        }),
        ("macos", "idea") => Ok(Launch {
            executable: "open".into(),
            args: vec!["-a".into(), "IntelliJ IDEA".into(), path],
        }),
        ("macos", "folder") => Ok(Launch {
            executable: "open".into(),
            args: vec![path],
        }),
        (_, "idea" | "folder") => Err("OS handoff is supported on Linux and macOS only.".into()),
        _ => Err("Unknown OS handoff action.".into()),
    }
}

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unsupported"
    }
}

pub fn spawn_external(launch: &Launch) -> Result<std::process::Child, String> {
    std::process::Command::new(&launch.executable)
        .args(&launch.args)
        .spawn()
        .map_err(|error| format!("Could not launch {}: {error}", launch.executable))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::management::NewWorkspace;
    use tempfile::tempdir;

    fn store(root: &Path) -> ManagementStore {
        let user_home = root.join("user-home");
        std::fs::create_dir_all(&user_home).unwrap();
        ManagementStore::open_with_paths(
            root.join("management.sqlite"),
            &user_home,
            root.join("tmp"),
        )
        .unwrap()
    }

    #[test]
    fn platform_launches_receive_exact_path_as_an_argument() {
        let path = Path::new("/tmp/a path/project");
        assert_eq!(
            external_launch("idea", path, "linux").unwrap(),
            Launch {
                executable: "idea".into(),
                args: vec!["/tmp/a path/project".into()],
            }
        );
        assert_eq!(
            external_launch("folder", path, "linux").unwrap(),
            Launch {
                executable: "xdg-open".into(),
                args: vec!["/tmp/a path/project".into()],
            }
        );
        assert_eq!(
            external_launch("idea", path, "macos").unwrap(),
            Launch {
                executable: "open".into(),
                args: vec![
                    "-a".into(),
                    "IntelliJ IDEA".into(),
                    "/tmp/a path/project".into()
                ],
            }
        );
        assert_eq!(
            external_launch("folder", path, "macos").unwrap(),
            Launch {
                executable: "open".into(),
                args: vec!["/tmp/a path/project".into()],
            }
        );
    }

    #[test]
    fn unsupported_platform_and_action_are_rejected() {
        assert!(external_launch("idea", Path::new("/tmp"), "windows").is_err());
        assert!(external_launch("shell", Path::new("/tmp"), "linux").is_err());
    }

    #[test]
    fn missing_external_application_returns_an_actionable_launch_error() {
        let launch = Launch {
            executable: "/definitely/missing/opencode-project-manager-app".into(),
            args: vec!["/tmp/project".into()],
        };
        assert!(spawn_external(&launch)
            .unwrap_err()
            .starts_with("Could not launch /definitely/missing/opencode-project-manager-app:"));
    }

    #[test]
    fn owner_home_uses_workspace_home_and_rejects_legacy_task_owners() {
        let root = tempdir().unwrap();
        let store = store(root.path());
        let workspace = store
            .create_workspace(&NewWorkspace {
                id: "workspace-handoff".into(),
                name: "Handoff".into(),
                slug: "handoff".into(),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        assert_eq!(
            owner_home(&store, "workspace", &workspace.id).unwrap(),
            PathBuf::from(workspace.home_path).canonicalize().unwrap()
        );
        assert!(owner_home(&store, "task", "legacy-task").is_err());
        let quick = store
            .create_workspace(&NewWorkspace {
                id: "quick-workspace".into(),
                name: "Quick Requests".into(),
                slug: "quick-requests".into(),
                description: None,
                kind: WorkspaceKind::QuickRequests,
                created_at: 3,
            })
            .unwrap();
        assert!(owner_home(&store, "workspace", &quick.id).is_err());
    }
}
