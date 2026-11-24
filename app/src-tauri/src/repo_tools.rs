use crate::management::{
    ManagementStore, RepositorySetupStatus, TaskStatus, VerificationStatus, WorkspaceStatus,
};
use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryToolGroup {
    pub repository_id: String,
    pub name: String,
    pub path: String,
    pub package_scripts: Vec<String>,
    pub make_targets: Vec<String>,
    pub package_script_entries: Vec<RepositoryToolEntry>,
    pub make_target_entries: Vec<RepositoryToolEntry>,
    pub npm_install_needed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepositoryToolEntry {
    pub name: String,
    /// Repository-relative directory containing the package.json or Makefile.
    pub directory: String,
}

#[derive(Clone, Debug)]
pub struct ToolLaunch {
    pub directory: PathBuf,
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub label: String,
}

fn workspace_paths(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
) -> Result<Vec<(String, String, PathBuf)>, String> {
    if owner_type != "workspace" {
        return Err("Repository tools are available only for a Workspace.".into());
    }
    let (workspace_id, task) = match owner_type {
        "workspace" => {
            let workspace = store
                .get_workspace(owner_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Workspace was not found.".to_owned())?;
            if workspace.kind != crate::management::WorkspaceKind::Regular
                || workspace.status != WorkspaceStatus::Active
            {
                return Err("Repository tools require an active regular Workspace.".into());
            }
            (workspace.id, None)
        }
        "task" => {
            let task = store
                .get_task(owner_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Task was not found.".to_owned())?;
            if task.status != TaskStatus::Active || task.quick_request.is_some() {
                return Err("Repository tools require an active regular Task.".into());
            }
            let workspace = store
                .get_workspace(&task.workspace_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Task Workspace was not found.".to_owned())?;
            if workspace.kind != crate::management::WorkspaceKind::Regular {
                return Err("Repository tools require a regular Workspace.".into());
            }
            (task.workspace_id.clone(), Some(task))
        }
        _ => return Err("Owner type must be workspace or task.".into()),
    };
    if let Some(task) = task {
        let task_home = PathBuf::from(&task.home_path)
            .canonicalize()
            .map_err(|e| format!("Task home is unavailable: {e}"))?;
        let worktrees_root = task_home
            .join("worktrees")
            .canonicalize()
            .map_err(|e| format!("Task worktrees directory is unavailable: {e}"))?;
        return store
            .list_task_repository_bindings(&task.id)
            .map_err(|e| e.to_string())?
            .into_iter()
            .filter(|binding| binding.setup_status == RepositorySetupStatus::Ready)
            .map(|binding| {
                let metadata = store
                    .workspace_repository_checkout_metadata(&workspace_id, &binding.repository_id)
                    .map_err(|e| e.to_string())?
                    .ok_or_else(|| {
                        "Task repository has no verified Workspace checkout.".to_owned()
                    })?;
                let checkout =
                    crate::change_review::validate_repo_root(Path::new(&metadata.checkout_path))?;
                let checkout_facts =
                    crate::safety::inspect_repository(&checkout).map_err(|e| e.to_string())?;
                if checkout_facts.repository.identity != metadata.checkout_identity {
                    return Err(
                        "Workspace checkout identity no longer matches its verified binding."
                            .into(),
                    );
                }
                let path =
                    crate::change_review::validate_repo_root(Path::new(&binding.worktree_path))?;
                if !path.starts_with(&worktrees_root) {
                    return Err("Task worktree escapes its managed worktrees directory.".into());
                }
                let worktree_facts =
                    crate::safety::inspect_repository(&path).map_err(|e| e.to_string())?;
                if worktree_facts.repository.identity != metadata.checkout_identity {
                    return Err(
                        "Task worktree identity no longer matches its Workspace checkout.".into(),
                    );
                }
                let name = store
                    .get_repository(&binding.repository_id)
                    .map_err(|e| e.to_string())?
                    .map(|repo| repo.name)
                    .unwrap_or_else(|| binding.repository_id.clone());
                Ok((binding.repository_id, name, path))
            })
            .collect();
    }
    store
        .list_workspace_repository_bindings(&workspace_id)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|binding| binding.verification_status == VerificationStatus::Verified)
        .map(|binding| {
            let metadata = store
                .workspace_repository_checkout_metadata(&workspace_id, &binding.repository_id)
                .map_err(|e| e.to_string())?
                .ok_or_else(|| "Repository has no verified Workspace checkout.".to_owned())?;
            let path = crate::change_review::validate_repo_root(Path::new(&binding.checkout_path))?;
            let recorded = Path::new(&metadata.checkout_path)
                .canonicalize()
                .map_err(|e| format!("Recorded Workspace checkout is unavailable: {e}"))?;
            if path != recorded {
                return Err(
                    "Workspace checkout path no longer matches its verified binding.".into(),
                );
            }
            let facts = crate::safety::inspect_repository(&path).map_err(|e| e.to_string())?;
            if facts.repository.identity != metadata.checkout_identity {
                return Err(
                    "Workspace checkout identity no longer matches its verified binding.".into(),
                );
            }
            let name = store
                .get_repository(&binding.repository_id)
                .map_err(|e| e.to_string())?
                .map(|repo| repo.name)
                .unwrap_or_else(|| binding.repository_id.clone());
            Ok((binding.repository_id, name, path))
        })
        .collect()
}

fn discover_package_scripts(path: &Path) -> Vec<String> {
    let Ok(contents) = fs::read(path.join("package.json")) else {
        return vec![];
    };
    let Ok(json) = serde_json::from_slice::<Value>(&contents) else {
        return vec![];
    };
    json.get("scripts")
        .and_then(Value::as_object)
        .map(|scripts| {
            let mut names = scripts.keys().cloned().collect::<Vec<_>>();
            names.sort();
            names
        })
        .unwrap_or_default()
}

fn discover_make_targets(path: &Path) -> Vec<String> {
    let makefile = ["GNUmakefile", "makefile", "Makefile"]
        .into_iter()
        .map(|name| path.join(name))
        .find(|candidate| candidate.is_file());
    let Some(makefile) = makefile else {
        return vec![];
    };
    let Ok(contents) = fs::read_to_string(makefile) else {
        return vec![];
    };
    let mut targets = contents
        .lines()
        .filter(|line| !line.starts_with([' ', '\t', '#']))
        .filter_map(|line| line.split_once(':').map(|(names, _)| names))
        .flat_map(|names| names.split_whitespace())
        .filter(|name| {
            !name.starts_with('.')
                && !name.contains('%')
                && name
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_@./-".contains(c))
        })
        .map(str::to_owned)
        .collect::<Vec<_>>();
    targets.sort();
    targets.dedup();
    targets
}

fn project_directories(root: &Path) -> Vec<(String, PathBuf)> {
    const SKIP: &[&str] = &[
        ".git",
        "node_modules",
        "vendor",
        "bower_components",
        "third_party",
        "pods",
        "carthage",
        "venv",
        "virtualenv",
        "site-packages",
        "target",
        "dist",
        "build",
        "release",
    ];
    fn visit(root: &Path, directory: &Path, depth: usize, found: &mut Vec<(String, PathBuf)>) {
        if depth > 12 {
            return;
        }
        found.push((
            directory
                .strip_prefix(root)
                .unwrap_or(directory)
                .to_string_lossy()
                .replace('\\', "/"),
            directory.to_path_buf(),
        ));
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if kind.is_dir()
                && !kind.is_symlink()
                && path.file_name().is_some_and(|name| {
                    !name.to_string_lossy().starts_with('.')
                        && !SKIP.iter().any(|skip| name == *skip)
                })
            {
                visit(root, &path, depth + 1, found);
            }
        }
    }
    let mut found = Vec::new();
    visit(root, root, 0, &mut found);
    found
}

fn discover_package_script_entries(root: &Path) -> Vec<RepositoryToolEntry> {
    let mut entries = project_directories(root)
        .into_iter()
        .flat_map(|(directory, path)| {
            discover_package_scripts(&path)
                .into_iter()
                .map(move |name| RepositoryToolEntry {
                    name,
                    directory: directory.clone(),
                })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        a.directory
            .cmp(&b.directory)
            .then_with(|| a.name.cmp(&b.name))
    });
    entries
}

fn discover_make_target_entries(root: &Path) -> Vec<RepositoryToolEntry> {
    let mut entries = project_directories(root)
        .into_iter()
        .flat_map(|(directory, path)| {
            discover_make_targets(&path)
                .into_iter()
                .map(move |name| RepositoryToolEntry {
                    name,
                    directory: directory.clone(),
                })
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| {
        a.directory
            .cmp(&b.directory)
            .then_with(|| a.name.cmp(&b.name))
    });
    entries
}

pub fn list_for_owner(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
) -> Result<Vec<RepositoryToolGroup>, String> {
    workspace_paths(store, owner_type, owner_id)?
        .into_iter()
        .map(|(repository_id, name, path)| {
            let canonical = crate::change_review::validate_repo_root(&path)
                .map_err(|error| format!("Repository {name} is unavailable: {error}"))?;
            let package_script_entries = discover_package_script_entries(&canonical);
            let make_target_entries = discover_make_target_entries(&canonical);
            let package_scripts = discover_package_scripts(&canonical);
            let make_targets = discover_make_targets(&canonical);
            Ok(RepositoryToolGroup {
                repository_id,
                name,
                path: canonical.display().to_string(),
                npm_install_needed: canonical.join("package.json").is_file()
                    && !canonical.join("node_modules").is_dir(),
                package_scripts,
                make_targets,
                package_script_entries,
                make_target_entries,
            })
        })
        .collect()
}

pub fn list_for_repository_path(
    repository_id: &str,
    name: &str,
    path: &Path,
) -> Result<Vec<RepositoryToolGroup>, String> {
    let canonical = crate::change_review::validate_repo_root(path)
        .map_err(|error| format!("Repository {name} is unavailable: {error}"))?;
    Ok(vec![RepositoryToolGroup {
        repository_id: repository_id.to_owned(),
        name: name.to_owned(),
        path: canonical.display().to_string(),
        npm_install_needed: canonical.join("package.json").is_file()
            && !canonical.join("node_modules").is_dir(),
        package_scripts: discover_package_script_entries(&canonical)
            .into_iter()
            .map(|entry| entry.name)
            .collect(),
        make_targets: discover_make_target_entries(&canonical)
            .into_iter()
            .map(|entry| entry.name)
            .collect(),
        package_script_entries: discover_package_script_entries(&canonical),
        make_target_entries: discover_make_target_entries(&canonical),
    }])
}

pub fn launch_for_owner(
    store: &ManagementStore,
    owner_type: &str,
    owner_id: &str,
    repository_id: &str,
    kind: &str,
    name: &str,
) -> Result<ToolLaunch, String> {
    let groups = workspace_paths(store, owner_type, owner_id)?;
    let (_, _, path) = groups
        .into_iter()
        .find(|(id, _, _)| id == repository_id)
        .ok_or_else(|| {
            "Repository is not associated with the selected Workspace or Task.".to_owned()
        })?;
    launch_for_directory(&path, kind, name)
}

pub fn launch_for_directory(
    directory: &Path,
    kind: &str,
    name: &str,
) -> Result<ToolLaunch, String> {
    launch_for_subdirectory(directory, "", kind, name)
}

pub fn launch_for_subdirectory(
    repository: &Path,
    source_directory: &str,
    kind: &str,
    name: &str,
) -> Result<ToolLaunch, String> {
    let root = crate::change_review::validate_repo_root(repository)?;
    let path = if source_directory.is_empty() {
        root.clone()
    } else {
        if Path::new(source_directory).is_absolute()
            || Path::new(source_directory)
                .components()
                .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err("Invalid repository tool source directory.".into());
        }
        let path = root
            .join(source_directory)
            .canonicalize()
            .map_err(|e| format!("Tool source directory is unavailable: {e}"))?;
        if !path.starts_with(&root) || !path.is_dir() {
            return Err("Tool source directory must be inside the repository.".into());
        }
        path
    };
    let scripts = discover_package_scripts(&path);
    let targets = discover_make_targets(&path);
    let (executable, args, label) = match kind {
        "npm_install"
            if path.join("package.json").is_file() && !path.join("node_modules").is_dir() =>
        {
            ("npm", vec!["install".into()], "npm install".into())
        }
        "npm_script" if scripts.iter().any(|script| script == name) => (
            "npm",
            vec!["run".into(), "--".into(), name.into()],
            format!("npm run {name}"),
        ),
        "make_target" if targets.iter().any(|target| target == name) => (
            "make",
            vec!["--".into(), name.into()],
            format!("make {name}"),
        ),
        _ => return Err("The selected repository tool is no longer available.".into()),
    };
    Ok(ToolLaunch {
        directory: path,
        executable: executable.into(),
        args,
        label,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::management::{
        CheckoutMode, NewTask, NewWorkspace, RepositorySetupStatus, TaskRepositoryBinding,
        TaskSetupStatus, VerificationStatus, WorkspaceKind, WorkspaceRepositoryBinding,
    };
    use std::fs;
    use std::process::Command;
    use tempfile::tempdir;

    fn git(path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn discovers_all_package_scripts_and_named_make_targets_without_shell_evaluation() {
        let root = tempdir().unwrap();
        fs::write(
            root.path().join("package.json"),
            r#"{"scripts":{"test":"node test.js","build":"vite build"}}"#,
        )
        .unwrap();
        fs::write(
            root.path().join("Makefile"),
            "all: build test\nbuild test: ;\n.PHONY: all\n%.o: %.c\n",
        )
        .unwrap();
        assert_eq!(discover_package_scripts(root.path()), ["build", "test"]);
        assert_eq!(discover_make_targets(root.path()), ["all", "build", "test"]);
    }

    #[test]
    fn invalid_package_json_produces_no_scripts() {
        let root = tempdir().unwrap();
        fs::write(root.path().join("package.json"), "not json").unwrap();
        assert!(discover_package_scripts(root.path()).is_empty());
    }

    #[test]
    fn nested_project_tools_include_their_source_directory_and_run_there() {
        let root = tempdir().unwrap();
        git(root.path(), &["init", "--quiet", "--initial-branch=main"]);
        fs::create_dir_all(root.path().join("app")).unwrap();
        fs::create_dir_all(root.path().join("node_modules/ignored")).unwrap();
        fs::write(
            root.path().join("app/package.json"),
            r#"{"scripts":{"test":"node test.js"}}"#,
        )
        .unwrap();
        fs::write(root.path().join("app/Makefile"), "check:\n\ttrue\n").unwrap();
        fs::write(
            root.path().join("node_modules/ignored/package.json"),
            r#"{"scripts":{"bad":"false"}}"#,
        )
        .unwrap();
        let groups = list_for_repository_path("repo", "Example", root.path()).unwrap();
        assert_eq!(groups.len(), 1);
        assert!(groups[0]
            .package_script_entries
            .iter()
            .any(|entry| { entry.name == "test" && entry.directory == "app" }));
        assert!(!groups[0]
            .package_script_entries
            .iter()
            .any(|entry| entry.name == "bad"));
        assert!(groups[0]
            .make_target_entries
            .iter()
            .any(|entry| { entry.name == "check" && entry.directory == "app" }));
        let launch = launch_for_subdirectory(root.path(), "app", "npm_script", "test").unwrap();
        assert_eq!(
            launch.directory,
            root.path().join("app").canonicalize().unwrap()
        );
        assert_eq!(launch.args, ["run", "--", "test"]);
        assert!(launch_for_subdirectory(root.path(), "../", "npm_script", "test").is_err());
    }

    #[test]
    fn production_store_routes_workspace_tools_and_rejects_legacy_task_owners() {
        let root = tempdir().unwrap();
        let source = root.path().join("source");
        fs::create_dir_all(&source).unwrap();
        let init = Command::new("git")
            .args(["init", "--quiet", "--initial-branch=main"])
            .arg(&source)
            .output()
            .unwrap();
        assert!(init.status.success());
        fs::write(
            source.join("package.json"),
            r#"{"scripts":{"test":"node test.js"}}"#,
        )
        .unwrap();
        fs::write(source.join("Makefile"), "check:\n\ttrue\n").unwrap();
        git(&source, &["add", "."]);
        let commit = Command::new("git")
            .arg("-C")
            .arg(&source)
            .args([
                "-c",
                "user.name=Repo tools",
                "-c",
                "user.email=tools@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ])
            .output()
            .unwrap();
        assert!(
            commit.status.success(),
            "{}",
            String::from_utf8_lossy(&commit.stderr)
        );
        git(&source, &["update-ref", "refs/remotes/origin/main", "HEAD"]);
        git(
            &source,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/main",
            ],
        );

        let user_home = root.path().join("user-home");
        fs::create_dir_all(&user_home).unwrap();
        let store = ManagementStore::open_with_paths(
            root.path().join("management.sqlite"),
            &user_home,
            root.path().join("tmp"),
        )
        .unwrap();
        let workspace = store
            .create_workspace(&NewWorkspace {
                id: "workspace-tools".into(),
                name: "Tools".into(),
                slug: "tools".into(),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        let repository = store
            .catalog_discovered_repository("repo-tools", &source, None, 1)
            .unwrap();
        store
            .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: workspace.id.clone(),
                repository_id: repository.id.clone(),
                checkout_path: source.to_string_lossy().into_owned(),
                checkout_mode: CheckoutMode::Existing,
                branch: "main".into(),
                verification_status: VerificationStatus::Verified,
                created_at: 1,
            })
            .unwrap();

        let task = store
            .create_task(&NewTask {
                id: "task-tools".into(),
                workspace_id: workspace.id.clone(),
                name: "Tools task".into(),
                slug: "tools-task".into(),
                description: None,
                setup_status: TaskSetupStatus::InProgress,
                created_at: 2,
            })
            .unwrap();
        let worktree = Path::new(&task.home_path)
            .join("worktrees")
            .join("repo-tools");
        let worktree_parent = worktree.parent().unwrap();
        fs::create_dir_all(worktree_parent).unwrap();
        git(
            &source,
            &[
                "worktree",
                "add",
                "--quiet",
                "-b",
                "work/task-tools",
                worktree.to_str().unwrap(),
                "HEAD",
            ],
        );
        store
            .validate_and_save_task_repository_binding(&TaskRepositoryBinding {
                task_id: task.id.clone(),
                repository_id: repository.id.clone(),
                branch: "work/task-tools".into(),
                worktree_path: worktree.to_string_lossy().into_owned(),
                setup_status: RepositorySetupStatus::Ready,
                error_code: None,
                error_detail: None,
                created_at: 2,
                updated_at: 2,
            })
            .unwrap();

        let workspace_tools = list_for_owner(&store, "workspace", &workspace.id).unwrap();
        assert_eq!(workspace_tools.len(), 1);
        assert_eq!(workspace_tools[0].package_scripts, ["test"]);
        assert_eq!(workspace_tools[0].make_targets, ["check"]);
        assert!(workspace_tools[0].npm_install_needed);
        assert!(list_for_owner(&store, "task", &task.id).is_err());
        assert!(launch_for_owner(
            &store,
            "task",
            &task.id,
            "unbound-repo",
            "make_target",
            "check"
        )
        .is_err());
    }
}
