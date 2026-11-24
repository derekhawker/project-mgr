use crate::management::{ManagementStore, WorkspaceKind, WorkspaceStatus};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

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

fn find_executable_in_path(program: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|directory| directory.join(program))
        .find(|path| {
            let Ok(metadata) = std::fs::metadata(path) else {
                return false;
            };
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            }
            #[cfg(not(unix))]
            {
                metadata.is_file()
            }
        })
}

fn linux_external_terminal_launch(
    directory: &Path,
    mut find: impl FnMut(&str) -> Option<PathBuf>,
) -> Result<Launch, String> {
    let path = directory.to_string_lossy().into_owned();
    const SHELL: [&str; 4] = [
        "sh",
        "-lc",
        "cd -- \"$1\" && exec \"${SHELL:-/bin/sh}\"",
        "project-manager",
    ];
    if let Some(executable) = find("x-terminal-emulator") {
        let mut args = vec!["-e".to_owned()];
        args.extend(SHELL.iter().map(|arg| (*arg).to_owned()));
        args.push(path);
        return Ok(Launch {
            executable: executable.display().to_string(),
            args,
        });
    }
    if let Some(executable) = find("konsole") {
        return Ok(Launch {
            executable: executable.display().to_string(),
            args: vec![
                "--workdir".into(),
                path,
                "-e".into(),
                "sh".into(),
                "-lc".into(),
                "exec \"${SHELL:-/bin/sh}\"".into(),
            ],
        });
    }
    Err("No supported external terminal was found (tried x-terminal-emulator and konsole).".into())
}

pub fn external_launch(action: &str, directory: &Path, platform: &str) -> Result<Launch, String> {
    let path = directory.to_string_lossy().into_owned();
    match (platform, action) {
        ("linux", "external_terminal") => {
            linux_external_terminal_launch(directory, find_executable_in_path)
        }
        ("macos", "external_terminal") => {
            let quoted = path.replace('\'', "'\\''");
            let command = format!("cd -- '{quoted}' && exec \"${{SHELL:-/bin/sh}}\"");
            let applescript = format!(
                "tell application \"Terminal\" to do script \"{}\"",
                command.replace('\\', "\\\\").replace('"', "\\\"")
            );
            Ok(Launch {
                executable: "osascript".into(),
                args: vec![
                    "-e".into(),
                    applescript,
                    "-e".into(),
                    "tell application \"Terminal\" to activate".into(),
                ],
            })
        }
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

pub fn spawn_external(launch: &Launch) -> Result<(), String> {
    let mut child = std::process::Command::new(&launch.executable)
        .args(&launch.args)
        .spawn()
        .map_err(|error| format!("Could not launch {}: {error}", launch.executable))?;
    let deadline = Instant::now() + Duration::from_millis(300);
    loop {
        match child
            .try_wait()
            .map_err(|error| format!("Could not check {}: {error}", launch.executable))?
        {
            Some(status) if !status.success() => {
                return Err(format!(
                    "{} exited with status {}",
                    launch.executable,
                    status
                        .code()
                        .map_or_else(|| "after a signal".to_owned(), |code| code.to_string())
                ));
            }
            Some(_) => return Ok(()),
            None if Instant::now() >= deadline => {
                std::thread::spawn(move || {
                    let _ = child.wait();
                });
                return Ok(());
            }
            None => std::thread::sleep(Duration::from_millis(20)),
        }
    }
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
        let mac_terminal = external_launch("external_terminal", path, "macos").unwrap();
        assert_eq!(mac_terminal.executable, "osascript");
        assert!(mac_terminal.args[1].contains("/tmp/a path/project"));
    }

    #[test]
    fn linux_external_terminal_uses_an_installed_launcher_when_default_is_missing() {
        let launch = linux_external_terminal_launch(Path::new("/tmp/a project"), |name| {
            (name == "konsole").then(|| PathBuf::from("/usr/bin/konsole"))
        })
        .unwrap();
        assert_eq!(launch.executable, "/usr/bin/konsole");
        assert_eq!(launch.args[0..2], ["--workdir", "/tmp/a project"]);
    }

    #[cfg(unix)]
    #[test]
    fn quickly_failing_handoff_launcher_is_reported_as_an_error() {
        use std::os::unix::fs::PermissionsExt;

        let root = tempdir().unwrap();
        let executable = root.path().join("failing-launcher");
        std::fs::write(&executable, "#!/bin/sh\nexit 23\n").unwrap();
        let mut permissions = std::fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&executable, permissions).unwrap();
        let error = spawn_external(&Launch {
            executable: executable.display().to_string(),
            args: vec![],
        })
        .unwrap_err();
        assert!(error.contains("exited with status 23"), "{error}");
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
