use std::{fs, path::Path, process::Command};

use opencode_project_manager_lib::{
    management::{
        CheckoutMode, CleanupJobState, ManagementStore, NewWorkspace, VerificationStatus,
        WorkspaceKind, WorkspaceRepositoryBinding,
    },
    opencode::ModelReference,
    task_setup::{create_task_from_confirmation, retry_task_setup, TaskSessionStarter},
    workspace_setup::{
        inspect_repository_preflight, plan_workspace_setup, provision_independent_clone,
    },
};
use tempfile::tempdir;

struct ControlledSessions {
    fail_next_start: bool,
    created: Vec<(String, String)>,
}

impl TaskSessionStarter for ControlledSessions {
    fn is_attached(&self, _session_id: &str) -> bool {
        false
    }

    fn create_session(
        &mut self,
        title: &str,
        directory: &Path,
        _model: &ModelReference,
    ) -> Result<String, String> {
        if self.fail_next_start {
            self.fail_next_start = false;
            return Err("injected OpenCode session startup failure".into());
        }
        let id = format!("session-{}", self.created.len() + 1);
        self.created
            .push((title.to_owned(), directory.to_string_lossy().into_owned()));
        Ok(id)
    }

    fn attach_terminal(&mut self, _session_id: &str, _directory: &Path) -> Result<(), String> {
        Ok(())
    }

    fn cleanup_terminal(&mut self, _session_id: &str) {}
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

#[test]
fn task_setup_uses_real_worktree_and_store_then_retries_session_failure_without_duplicates() {
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("source");
    fs::create_dir_all(&source).unwrap();
    let init = Command::new("git")
        .args(["init", "--quiet", "--initial-branch=main"])
        .arg(&source)
        .output()
        .unwrap();
    assert!(init.status.success());
    fs::write(source.join("README.md"), "source fixture\n").unwrap();
    git(&source, &["add", "README.md"]);
    let commit = Command::new("git")
        .arg("-C")
        .arg(&source)
        .args([
            "-c",
            "user.name=Task fixture",
            "-c",
            "user.email=task@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ])
        .output()
        .unwrap();
    assert!(commit.status.success());
    git(
        &source,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );

    let home = fixture.path().join("home");
    fs::create_dir_all(&home).unwrap();
    let store = ManagementStore::open_with_paths(
        fixture.path().join("management.sqlite"),
        &home,
        fixture.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-task-e2e".into(),
            name: "Task E2E".into(),
            slug: "task-e2e".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    let repository = store
        .catalog_discovered_repository("task-repo", &source, None, 1)
        .unwrap();
    let plan = plan_workspace_setup(
        Path::new(&workspace.home_path),
        vec![inspect_repository_preflight(&repository).unwrap()],
    )
    .unwrap()
    .repositories
    .remove(0);
    let clone = provision_independent_clone(
        &repository,
        &plan,
        &Path::new(&workspace.home_path)
            .join("repos")
            .join(".staging-task-e2e"),
    )
    .unwrap();
    let workspace_binding = WorkspaceRepositoryBinding {
        workspace_id: workspace.id.clone(),
        repository_id: repository.id.clone(),
        checkout_path: clone.checkout_path.to_string_lossy().into_owned(),
        checkout_mode: CheckoutMode::Clone,
        branch: clone.branch.clone(),
        verification_status: VerificationStatus::Verified,
        created_at: 1,
    };
    store
        .validate_and_save_workspace_repository_binding(&workspace_binding)
        .unwrap();

    let model = ModelReference {
        provider_id: "test-provider".into(),
        id: "test-model".into(),
    };
    let mut sessions = ControlledSessions {
        fail_next_start: true,
        created: Vec::new(),
    };

    let repository_ids = std::slice::from_ref(&repository.id);
    let failed = create_task_from_confirmation(
        &store,
        &workspace.id,
        "task-task-e2e".into(),
        " Task E2E task ".into(),
        None,
        repository_ids,
        2,
        "test-provider/test-model",
        &model,
        &mut sessions,
    )
    .unwrap();
    let task_id = failed["task"]["id"].as_str().unwrap();
    let task_home = failed["task"]["homePath"].as_str().unwrap();
    assert_eq!(failed["task"]["setupStatus"], "incomplete");
    assert_eq!(failed["repositories"][0]["setupStatus"], "ready");
    assert_eq!(
        failed["repositories"][0]["sessionError"],
        "injected OpenCode session startup failure"
    );
    assert!(failed["sessions"].as_array().unwrap().is_empty());
    assert_eq!(
        store.list_task_repository_bindings(task_id).unwrap()[0].setup_status,
        opencode_project_manager_lib::management::RepositorySetupStatus::Failed
    );
    let expected_worktree = Path::new(task_home).join("worktrees").join(
        repository
            .id
            .as_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>(),
    );
    assert!(expected_worktree.join(".git").exists());

    let retried = retry_task_setup(
        &store,
        task_id,
        "test-provider/test-model",
        &model,
        &mut sessions,
    )
    .unwrap();
    assert_eq!(retried["task"]["setupStatus"], "ready");
    assert_eq!(retried["repositories"][0]["setupStatus"], "ready");
    assert_eq!(retried["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(sessions.created.len(), 1);
    assert_eq!(sessions.created[0].1, expected_worktree.to_string_lossy());
    let saved_sessions = store.list_task_repository_sessions(task_id).unwrap();
    assert_eq!(saved_sessions.len(), 1);
    assert_eq!(saved_sessions[0].1, repository.id);
    assert_eq!(saved_sessions[0].2, expected_worktree.to_string_lossy());
    let tracked_session = store.get_session("session-1").unwrap().unwrap();
    assert_eq!(
        tracked_session.directory,
        expected_worktree.to_string_lossy()
    );
    assert!(store
        .validate_session_context("session-1", &expected_worktree)
        .is_ok());
    assert_eq!(
        store.list_task_repository_bindings(task_id).unwrap()[0].setup_status,
        opencode_project_manager_lib::management::RepositorySetupStatus::Ready
    );
    assert_eq!(
        store.task_repository_selection(task_id).unwrap(),
        Some(vec![repository.id.clone()])
    );
    assert_eq!(
        store.get_task(task_id).unwrap().unwrap().name,
        "Task E2E task"
    );

    let completed = store.complete_task_and_queue_cleanup(task_id, 10).unwrap();
    assert_eq!(
        completed.status,
        opencode_project_manager_lib::management::TaskStatus::Completed
    );
    let cleanup = store.list_cleanup_jobs(task_id).unwrap().remove(0);
    let deferred = store
        .execute_cleanup_job(&cleanup.id, std::slice::from_ref(&expected_worktree), 11)
        .unwrap();
    assert_eq!(deferred.state, CleanupJobState::Deferred);
    assert!(expected_worktree.exists());

    store
        .update_session_status("session-1", "exited", 12)
        .unwrap();
    store.retry_cleanup_jobs(task_id, 13).unwrap();
    let removed = store.execute_cleanup_job(&cleanup.id, &[], 14).unwrap();
    assert_eq!(removed.state, CleanupJobState::Removed);
    assert!(!expected_worktree.exists());
    let retained_branch = Command::new("git")
        .arg("-C")
        .arg(&clone.checkout_path)
        .args([
            "show-ref",
            "--verify",
            "--quiet",
            "refs/heads/work/task-task-e2e",
        ])
        .status()
        .unwrap();
    assert!(
        retained_branch.success(),
        "task branch should survive worktree cleanup"
    );
    assert_eq!(
        store.list_task_repository_sessions(task_id).unwrap().len(),
        1
    );
}
