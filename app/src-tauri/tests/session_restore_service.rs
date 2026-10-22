use std::{fs, path::Path, process::Command};

use opencode_project_manager_lib::{
    management::{
        CheckoutMode, ManagementStore, NewSession, NewTask, NewWorkspace, RepositorySetupStatus,
        SessionOwner, TaskRepositoryBinding, TaskSetupStatus, VerificationStatus, WorkspaceKind,
        WorkspaceRepositoryBinding,
    },
    opencode::ModelReference,
    session_restore::{restore_or_replace, SessionRestoreRuntime},
    workspace_setup::{
        inspect_repository_preflight, plan_workspace_setup, provision_independent_clone,
        provision_task_worktree,
    },
};
use tempfile::tempdir;

struct FakeRuntime {
    exists: bool,
    fail_attach: bool,
    created: Vec<(String, String, ModelReference)>,
    attached: Vec<String>,
}

impl SessionRestoreRuntime for FakeRuntime {
    fn session_exists(&mut self, _session_id: &str) -> Result<bool, String> {
        Ok(self.exists)
    }

    fn create_session(
        &mut self,
        title: &str,
        directory: &Path,
        model: &ModelReference,
    ) -> Result<String, String> {
        self.created.push((
            title.into(),
            directory.to_string_lossy().into_owned(),
            model.clone(),
        ));
        Ok(format!("replacement-{}", self.created.len()))
    }

    fn attach_terminal(&mut self, session_id: &str, _directory: &Path) -> Result<(), String> {
        if self.fail_attach {
            return Err("injected terminal attach failure".into());
        }
        self.attached.push(session_id.into());
        Ok(())
    }
}

fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repo(path: &Path) {
    fs::create_dir_all(path).unwrap();
    let output = Command::new("git")
        .args(["init", "--quiet", "--initial-branch=main"])
        .arg(path)
        .output()
        .unwrap();
    assert!(output.status.success());
    fs::write(path.join("README.md"), "restore fixture\n").unwrap();
    git(path, &["add", "README.md"]);
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args([
            "-c",
            "user.name=Restore fixture",
            "-c",
            "user.email=restore@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    git(
        path,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
}

#[test]
fn missing_task_session_replacement_keeps_worktree_binding_and_recovers_attach_failure() {
    let temp = tempdir().unwrap();
    repo(&temp.path().join("source"));
    fs::create_dir_all(temp.path().join("home")).unwrap();
    let store = ManagementStore::open_with_paths(
        temp.path().join("db.sqlite"),
        temp.path().join("home"),
        temp.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-restore".into(),
            name: "Restore fixture".into(),
            slug: "restore-fixture".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    let source = store
        .catalog_discovered_repository("repo-restore", &temp.path().join("source"), None, 1)
        .unwrap();
    let plan = plan_workspace_setup(
        Path::new(&workspace.home_path),
        vec![inspect_repository_preflight(&source).unwrap()],
    )
    .unwrap()
    .repositories
    .remove(0);
    let clone = provision_independent_clone(
        &source,
        &plan,
        &Path::new(&workspace.home_path).join("repos/.staging-restore"),
    )
    .unwrap();
    store
        .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
            workspace_id: workspace.id.clone(),
            repository_id: source.id.clone(),
            checkout_path: clone.checkout_path.to_string_lossy().into_owned(),
            checkout_mode: CheckoutMode::Clone,
            branch: clone.branch.clone(),
            verification_status: VerificationStatus::Verified,
            created_at: 1,
        })
        .unwrap();
    let task = store
        .create_task(&NewTask {
            id: "task-restore".into(),
            workspace_id: workspace.id,
            name: "Restore task".into(),
            slug: "restore-task".into(),
            description: None,
            setup_status: TaskSetupStatus::Ready,
            created_at: 2,
        })
        .unwrap();
    let worktree = provision_task_worktree(
        &clone.checkout_path,
        Path::new(&task.home_path),
        &task.id,
        &source.id,
        &clone.branch,
        &clone.checkout_identity,
    )
    .unwrap();
    store
        .validate_and_save_task_repository_binding(&TaskRepositoryBinding {
            task_id: task.id.clone(),
            repository_id: source.id.clone(),
            branch: worktree.branch,
            worktree_path: worktree.path.to_string_lossy().into_owned(),
            setup_status: RepositorySetupStatus::Ready,
            error_code: None,
            error_detail: None,
            created_at: 2,
            updated_at: 2,
        })
        .unwrap();
    store
        .create_session(&NewSession {
            open_code_session_id: "stale-task-session".into(),
            owner: SessionOwner::Task(task.id.clone()),
            directory: worktree.path.to_string_lossy().into_owned(),
            last_known_status: "ready".into(),
            created_at: 3,
        })
        .unwrap();
    store
        .bind_task_session_repository(&task.id, "stale-task-session", &source.id)
        .unwrap();

    let model = ModelReference {
        provider_id: "provider".into(),
        id: "default".into(),
    };
    let mut runtime = FakeRuntime {
        exists: false,
        fail_attach: true,
        created: vec![],
        attached: vec![],
    };
    let error = restore_or_replace(
        &store,
        "stale-task-session",
        || Ok(model.clone()),
        &mut runtime,
    )
    .unwrap_err();
    assert_eq!(error, "injected terminal attach failure");
    assert_eq!(runtime.created.len(), 1);
    assert_eq!(runtime.created[0].1, worktree.path.to_string_lossy());
    assert_eq!(runtime.created[0].2.provider_id, model.provider_id);
    assert_eq!(runtime.created[0].2.id, model.id);
    assert_eq!(
        store
            .get_session("stale-task-session")
            .unwrap()
            .unwrap()
            .last_known_status,
        "missing"
    );
    let replacement = store.get_session("replacement-1").unwrap().unwrap();
    assert_eq!(replacement.directory, worktree.path.to_string_lossy());
    assert_eq!(
        store
            .list_task_repository_sessions(&task.id)
            .unwrap()
            .iter()
            .find(|row| row.0 == "replacement-1")
            .unwrap()
            .1,
        source.id
    );

    runtime.fail_attach = false;
    runtime.exists = true;
    let restored = restore_or_replace(
        &store,
        "replacement-1",
        || panic!("existing session must not resolve a default model"),
        &mut runtime,
    )
    .unwrap();
    assert_eq!(restored.open_code_session_id, "replacement-1");
    assert_eq!(
        runtime.created.len(),
        1,
        "retry attaches the durable replacement instead of duplicating it"
    );
    assert_eq!(runtime.attached, ["replacement-1"]);
    assert!(
        restore_or_replace(&store, "stale-task-session", || Ok(model), &mut runtime)
            .unwrap_err()
            .contains("was replaced")
    );
}

#[test]
fn missing_workspace_session_replacement_uses_the_same_home_and_keeps_history_associated() {
    let temp = tempdir().unwrap();
    fs::create_dir_all(temp.path().join("home")).unwrap();
    let store = ManagementStore::open_with_paths(
        temp.path().join("db.sqlite"),
        temp.path().join("home"),
        temp.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-restore-only".into(),
            name: "Workspace restore".into(),
            slug: "workspace-restore".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    store
        .create_session(&NewSession {
            open_code_session_id: "stale-workspace-session".into(),
            owner: SessionOwner::Workspace(workspace.id.clone()),
            directory: workspace.home_path.clone(),
            last_known_status: "ready".into(),
            created_at: 2,
        })
        .unwrap();
    let model = ModelReference {
        provider_id: "provider".into(),
        id: "default".into(),
    };
    let mut runtime = FakeRuntime {
        exists: false,
        fail_attach: false,
        created: vec![],
        attached: vec![],
    };
    let replacement = restore_or_replace(
        &store,
        "stale-workspace-session",
        || Ok(model),
        &mut runtime,
    )
    .unwrap();
    assert_eq!(replacement.open_code_session_id, "replacement-1");
    assert_eq!(replacement.owner, SessionOwner::Workspace(workspace.id));
    assert_eq!(replacement.directory, workspace.home_path);
    assert_eq!(
        store
            .get_session("stale-workspace-session")
            .unwrap()
            .unwrap()
            .last_known_status,
        "missing"
    );
    assert_eq!(runtime.attached, ["replacement-1"]);
}

#[test]
fn completed_task_with_missing_session_is_rejected_before_creating_any_replacement() {
    let temp = tempdir().unwrap();
    fs::create_dir_all(temp.path().join("home")).unwrap();
    let store = ManagementStore::open_with_paths(
        temp.path().join("db.sqlite"),
        temp.path().join("home"),
        temp.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-completed-restore".into(),
            name: "Completed restore".into(),
            slug: "completed-restore".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    let task = store
        .create_task(&NewTask {
            id: "task-completed-restore".into(),
            workspace_id: workspace.id,
            name: "Completed".into(),
            slug: "completed".into(),
            description: None,
            setup_status: TaskSetupStatus::Ready,
            created_at: 2,
        })
        .unwrap();
    store
        .create_session(&NewSession {
            open_code_session_id: "stale-completed-session".into(),
            owner: SessionOwner::Task(task.id.clone()),
            directory: task.home_path,
            last_known_status: "ready".into(),
            created_at: 3,
        })
        .unwrap();
    store.complete_task_and_queue_cleanup(&task.id, 4).unwrap();
    let model = ModelReference {
        provider_id: "provider".into(),
        id: "default".into(),
    };
    let mut runtime = FakeRuntime {
        exists: false,
        fail_attach: false,
        created: vec![],
        attached: vec![],
    };
    let error = restore_or_replace(
        &store,
        "stale-completed-session",
        || Ok(model),
        &mut runtime,
    )
    .unwrap_err();
    assert!(error.contains("completed Task"));
    assert!(runtime.created.is_empty());
    assert_eq!(
        store
            .list_sessions(&SessionOwner::Task(task.id))
            .unwrap()
            .len(),
        1
    );
}
