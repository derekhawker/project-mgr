//! I-07 registration tests use real repositories and linked worktrees.  The
//! report boundary is intentionally exercised through the production store,
//! rather than through a fake Git adapter.
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use opencode_project_manager_lib::management::{
    CheckoutMode, ManagementStore, NewSession, NewTask, NewWorkspace, RegistrationItem,
    RegistrationItemResult, RegistrationReport, RepositorySetupStatus, SessionOwner,
    TaskSetupStatus, VerificationStatus, WorkspaceKind, WorkspaceRepositoryBinding,
};
use opencode_project_manager_lib::workspace_setup::{
    inspect_repository_preflight, plan_workspace_setup, provision_independent_clone,
};
use rusqlite::Connection;
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
    fs::write(path.join("README.md"), "fixture\n").unwrap();
    git(path, &["add", "README.md"]);
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args([
            "-c",
            "user.name=I-07",
            "-c",
            "user.email=i07@example.invalid",
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

struct Fixture {
    root: tempfile::TempDir,
    store: ManagementStore,
    repository_id: String,
    repository_path: PathBuf,
    identity: String,
    task_id: String,
    operation_id: String,
    session_id: String,
    task_home: PathBuf,
    database_path: PathBuf,
}

impl Fixture {
    fn new(name: &str) -> Self {
        let root = tempdir().unwrap();
        let repository_path = root.path().join("repository");
        repo(&repository_path);
        fs::create_dir_all(root.path().join("home")).unwrap();
        let database_path = root.path().join("management.sqlite");
        let store = ManagementStore::open_with_paths(
            &database_path,
            root.path().join("home"),
            root.path().join("tmp"),
        )
        .unwrap();
        let workspace = store
            .create_workspace(&NewWorkspace {
                id: format!("workspace-{name}"),
                name: name.into(),
                slug: format!("workspace-{name}"),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        let repository = store
            .catalog_discovered_repository("repository-id", &repository_path, None, 1)
            .unwrap();
        let plan = plan_workspace_setup(
            Path::new(&workspace.home_path),
            vec![inspect_repository_preflight(&repository).unwrap()],
        )
        .unwrap()
        .repositories
        .remove(0);
        let staging = Path::new(&workspace.home_path).join("repos/.staging-test-repository");
        let clone = provision_independent_clone(&repository, &plan, &staging).unwrap();
        store
            .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: workspace.id.clone(),
                repository_id: repository.id.clone(),
                checkout_path: clone.checkout_path.to_string_lossy().into_owned(),
                checkout_mode: CheckoutMode::Clone,
                branch: clone.branch.clone(),
                verification_status: VerificationStatus::Verified,
                created_at: 1,
            })
            .unwrap();
        let task_id = format!("task-{name}");
        let task = store
            .create_task(&NewTask {
                id: task_id.clone(),
                workspace_id: workspace.id,
                name: name.into(),
                slug: format!("task-{name}"),
                description: Some("setup".into()),
                setup_status: TaskSetupStatus::InProgress,
                created_at: 2,
            })
            .unwrap();
        let session_id = format!("session-{name}");
        store
            .create_session(&NewSession {
                open_code_session_id: session_id.clone(),
                owner: SessionOwner::Task(task.id),
                directory: task.home_path.clone(),
                last_known_status: "starting".into(),
                created_at: 3,
            })
            .unwrap();
        let operation_id = format!("operation-{name}");
        store
            .bind_task_setup_operation(&task_id, &operation_id, &session_id)
            .unwrap();
        let identity = clone.checkout_identity;
        let workspace_checkout_path = clone.checkout_path;
        Self {
            root,
            store,
            repository_id: repository.id,
            repository_path: workspace_checkout_path,
            identity,
            task_id,
            operation_id,
            session_id,
            task_home: PathBuf::from(task.home_path),
            database_path,
        }
    }

    fn worktree(&self, branch: &str, name: &str) -> PathBuf {
        let path = self.task_home.join("worktrees").join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        git(
            &self.repository_path,
            &[
                "worktree",
                "add",
                "-b",
                branch,
                path.to_str().unwrap(),
                "main",
            ],
        );
        path
    }

    fn item(
        &self,
        item_id: &str,
        result: RegistrationItemResult,
        branch: Option<&str>,
        path: Option<&Path>,
    ) -> RegistrationItem {
        RegistrationItem {
            item_id: item_id.into(),
            repository_id: self.repository_id.clone(),
            repository_path: self.repository_path.to_string_lossy().into(),
            git_identity: self.identity.clone(),
            branch: branch.map(str::to_owned),
            worktree_path: path.map(|p| p.to_string_lossy().into()),
            result,
            error_code: None,
            detail: None,
        }
    }

    fn report(&self, operation_id: &str, items: Vec<RegistrationItem>) -> RegistrationReport {
        RegistrationReport {
            operation_id: operation_id.into(),
            workspace_id: format!("workspace-{}", self.task_id.trim_start_matches("task-")),
            task_id: self.task_id.clone(),
            session_id: self.session_id.clone(),
            items,
        }
    }

    fn install_failure_trigger(&self, name: &str, table: &str, operation: &str) {
        let connection = Connection::open(&self.database_path).unwrap();
        connection
            .execute_batch(&format!(
                "CREATE TRIGGER {name} BEFORE {operation} ON {table}
                 BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;"
            ))
            .unwrap();
    }

    fn remove_failure_trigger(&self, name: &str) {
        let connection = Connection::open(&self.database_path).unwrap();
        connection
            .execute_batch(&format!("DROP TRIGGER {name}"))
            .unwrap();
    }

    fn scalar_i64(&self, sql: &str) -> i64 {
        let connection = Connection::open(&self.database_path).unwrap();
        connection.query_row(sql, [], |row| row.get(0)).unwrap()
    }
}

#[test]
fn mixed_report_persists_ready_failed_and_not_attempted_items() {
    let fixture = Fixture::new("mixed");
    let path = fixture.worktree("task-mixed", "ready");
    let mut ready = fixture.item(
        "ready",
        RegistrationItemResult::Ready,
        Some("task-mixed"),
        Some(&path),
    );
    let failed = fixture.item("failed", RegistrationItemResult::Failed, None, None);
    let not_attempted = fixture.item("later", RegistrationItemResult::NotAttempted, None, None);
    ready.detail = Some("valid".into());
    let result = fixture
        .store
        .apply_registration_report(
            &fixture.report("operation-mixed", vec![ready, failed, not_attempted]),
        )
        .unwrap();
    assert_eq!(
        result.items.iter().map(|i| &i.result).collect::<Vec<_>>(),
        vec![
            &RegistrationItemResult::Ready,
            &RegistrationItemResult::Failed,
            &RegistrationItemResult::NotAttempted
        ]
    );
    let bindings = fixture
        .store
        .list_registration_results(&fixture.task_id)
        .unwrap();
    assert_eq!(
        bindings.iter().map(|b| b.setup_status).collect::<Vec<_>>(),
        vec![RepositorySetupStatus::NotAttempted]
    );
    assert_eq!(
        fixture
            .store
            .get_task(&fixture.task_id)
            .unwrap()
            .unwrap()
            .setup_status,
        TaskSetupStatus::Incomplete
    );
}

#[test]
fn task_repository_session_is_persisted_at_its_exact_worktree() {
    let fixture = Fixture::new("session-binding");
    let path = fixture.worktree("task-session-binding", "ready");
    let item = fixture.item(
        "ready",
        RegistrationItemResult::Ready,
        Some("task-session-binding"),
        Some(&path),
    );
    fixture
        .store
        .apply_registration_report(&fixture.report("operation-session-binding", vec![item]))
        .unwrap();
    let session_id = "session-repo-root";
    fixture
        .store
        .create_session(&NewSession {
            open_code_session_id: session_id.into(),
            owner: SessionOwner::Task(fixture.task_id.clone()),
            directory: path.to_string_lossy().into_owned(),
            last_known_status: "starting".into(),
            created_at: 4,
        })
        .unwrap();
    fixture
        .store
        .bind_task_session_repository(&fixture.task_id, session_id, &fixture.repository_id)
        .unwrap();
    assert_eq!(
        fixture
            .store
            .list_task_repository_sessions(&fixture.task_id)
            .unwrap(),
        vec![(
            session_id.into(),
            fixture.repository_id.clone(),
            path.to_string_lossy().into_owned()
        )]
    );
}

#[test]
fn task_repository_selection_is_persisted_and_immutable_for_retry() {
    let fixture = Fixture::new("selection-retry");
    let selection = vec![fixture.repository_id.clone()];
    fixture
        .store
        .save_task_repository_selection(&fixture.task_id, &selection, 5)
        .unwrap();
    assert_eq!(
        fixture
            .store
            .task_repository_selection(&fixture.task_id)
            .unwrap(),
        Some(selection.clone())
    );
    assert!(fixture
        .store
        .save_task_repository_selection(&fixture.task_id, &[], 6)
        .is_err());
}

#[test]
fn one_workspace_task_registers_worktrees_from_two_independent_repositories() {
    let fixture = Fixture::new("two-repositories");
    let second_repository_path = fixture.root.path().join("repository-b");
    repo(&second_repository_path);
    let second_repository = fixture
        .store
        .catalog_discovered_repository("repository-id-b", &second_repository_path, None, 1)
        .unwrap();
    let workspace_id = "workspace-two-repositories";
    let workspace = fixture.store.get_workspace(workspace_id).unwrap().unwrap();
    let second_plan = plan_workspace_setup(
        Path::new(&workspace.home_path),
        vec![inspect_repository_preflight(&second_repository).unwrap()],
    )
    .unwrap()
    .repositories
    .remove(0);
    let second_staging = Path::new(&workspace.home_path).join("repos/.staging-second-repository");
    let second_clone =
        provision_independent_clone(&second_repository, &second_plan, &second_staging).unwrap();
    fixture
        .store
        .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
            workspace_id: workspace_id.into(),
            repository_id: second_repository.id.clone(),
            checkout_path: second_clone.checkout_path.to_string_lossy().into_owned(),
            checkout_mode: CheckoutMode::Clone,
            branch: second_clone.branch.clone(),
            verification_status: VerificationStatus::Verified,
            created_at: 1,
        })
        .unwrap();

    let selection = vec![fixture.repository_id.clone(), second_repository.id.clone()];
    fixture
        .store
        .save_task_setup_repository_selection(&fixture.operation_id, &selection)
        .unwrap();
    assert_eq!(
        fixture
            .store
            .task_setup_repository_selection(&fixture.operation_id)
            .unwrap(),
        Some(selection)
    );

    let first_worktree = fixture.worktree("task-two-repos-a", "repository-a");
    let second_worktree = fixture.task_home.join("worktrees/repository-b");
    fs::create_dir_all(second_worktree.parent().unwrap()).unwrap();
    git(
        &second_clone.checkout_path,
        &[
            "worktree",
            "add",
            "-b",
            "task-two-repos-b",
            second_worktree.to_str().unwrap(),
            "main",
        ],
    );

    let second_identity = second_clone.checkout_identity.clone();
    let report = fixture.report(
        &fixture.operation_id,
        vec![
            fixture.item(
                "repository-a",
                RegistrationItemResult::Ready,
                Some("task-two-repos-a"),
                Some(&first_worktree),
            ),
            RegistrationItem {
                item_id: "repository-b".into(),
                repository_id: second_repository.id.clone(),
                repository_path: second_clone.checkout_path.to_string_lossy().into(),
                git_identity: second_identity.clone(),
                branch: Some("task-two-repos-b".into()),
                worktree_path: Some(second_worktree.to_string_lossy().into()),
                result: RegistrationItemResult::Ready,
                error_code: None,
                detail: None,
            },
        ],
    );
    let result = fixture.store.apply_registration_report(&report).unwrap();
    assert_eq!(
        result
            .items
            .iter()
            .map(|item| (&item.repository_id, &item.result))
            .collect::<Vec<_>>(),
        vec![
            (&fixture.repository_id, &RegistrationItemResult::Ready),
            (&second_repository.id, &RegistrationItemResult::Ready),
        ]
    );

    let bindings = fixture
        .store
        .list_task_repository_bindings(&fixture.task_id)
        .unwrap();
    assert_eq!(bindings.len(), 2);
    assert!(bindings.iter().all(|binding| {
        binding.setup_status == RepositorySetupStatus::Ready
            && Path::new(&binding.worktree_path).is_dir()
    }));
    let context = opencode_project_manager_lib::management::resolve_task_context(
        &fixture.task_home,
        &bindings,
    );
    assert_eq!(context.len(), 3);
    assert!(context.contains(&fixture.task_home));
    assert!(context.contains(&first_worktree));
    assert!(context.contains(&second_worktree));

    let first_status =
        opencode_project_manager_lib::safety::inspect_repository(&first_worktree).unwrap();
    let second_status =
        opencode_project_manager_lib::safety::inspect_repository(&second_worktree).unwrap();
    assert_ne!(
        first_status.repository.identity,
        second_status.repository.identity
    );
    assert_eq!(
        first_status.repository.current_branch.as_deref(),
        Some("task-two-repos-a")
    );
    assert_eq!(
        second_status.repository.current_branch.as_deref(),
        Some("task-two-repos-b")
    );
}

#[test]
fn report_rejects_wrong_owners_and_operation_identity() {
    let fixture = Fixture::new("owner");
    let path = fixture.worktree("task-owner", "ready");
    let mut report = fixture.report(
        "operation-owner",
        vec![fixture.item(
            "one",
            RegistrationItemResult::Ready,
            Some("task-owner"),
            Some(&path),
        )],
    );
    report.workspace_id = "wrong-workspace".into();
    assert!(fixture.store.apply_registration_report(&report).is_err());
    report.workspace_id = "workspace-owner".into();
    report.session_id = "wrong-session".into();
    assert!(fixture.store.apply_registration_report(&report).is_err());
    report.session_id = fixture.session_id.clone();
    report.operation_id = "wrong-operation".into();
    assert!(fixture.store.apply_registration_report(&report).is_err());
}

#[test]
fn invalid_repository_path_worktree_and_branch_become_item_failures_without_cleanup() {
    let fixture = Fixture::new("invalid");
    let path = fixture.worktree("task-invalid", "ready");
    let mut wrong_path = fixture.item(
        "wrong-path",
        RegistrationItemResult::Ready,
        Some("task-invalid"),
        Some(&path),
    );
    wrong_path.repository_path = fixture
        .root
        .path()
        .join("not-the-catalog-repository")
        .to_string_lossy()
        .into();
    let unsafe_item = fixture.item(
        "unsafe",
        RegistrationItemResult::Ready,
        Some("task-invalid"),
        Some(fixture.root.path()),
    );
    let missing_branch = fixture.item(
        "missing-branch",
        RegistrationItemResult::Ready,
        Some("no-such-branch"),
        Some(&path),
    );
    let result = fixture
        .store
        .apply_registration_report(&fixture.report(
            "operation-invalid",
            vec![wrong_path, unsafe_item, missing_branch],
        ))
        .unwrap();
    assert!(result
        .items
        .iter()
        .all(|item| item.result == RegistrationItemResult::Failed));
    assert!(
        path.exists(),
        "registration validation must not clean up Git artifacts"
    );
}

#[test]
fn conflicting_active_owner_is_rejected_and_replay_is_idempotent() {
    let first = Fixture::new("first");
    let path = first.worktree("shared-branch", "ready");
    let report = first.report(
        "operation-first",
        vec![first.item(
            "one",
            RegistrationItemResult::Ready,
            Some("shared-branch"),
            Some(&path),
        )],
    );
    first.store.apply_registration_report(&report).unwrap();
    let replay = first.store.apply_registration_report(&report).unwrap();
    assert!(replay.replayed);
    let changed = first.report(
        "operation-first",
        vec![first.item("changed", RegistrationItemResult::Failed, None, None)],
    );
    assert!(first.store.apply_registration_report(&changed).is_err());

    let second = Fixture::new("second");
    let second_report = second.report(
        "operation-second",
        vec![second.item(
            "one",
            RegistrationItemResult::Ready,
            Some("shared-branch"),
            Some(&path),
        )],
    );
    let result = second
        .store
        .apply_registration_report(&second_report)
        .unwrap();
    assert_eq!(result.items[0].result, RegistrationItemResult::Failed);
}

#[test]
fn cancellation_blocks_late_report_and_resume_reuses_identity_and_artifacts() {
    let fixture = Fixture::new("cancel");
    let path = fixture.worktree("task-cancel", "retained");
    let task_before = fixture.store.get_task(&fixture.task_id).unwrap().unwrap();
    let canceled = fixture.store.cancel_task_setup(&fixture.task_id).unwrap();
    assert_eq!(canceled.setup_status, TaskSetupStatus::Incomplete);
    assert!(canceled.setup_cancelled_at.is_some());
    assert_eq!(
        canceled.setup_cancellation_detail.as_deref(),
        Some("setup canceled by user")
    );
    assert_eq!(
        fixture
            .store
            .get_session(&fixture.session_id)
            .unwrap()
            .unwrap()
            .last_known_status,
        "canceled"
    );
    let late = fixture.report(
        "operation-cancel",
        vec![fixture.item("late", RegistrationItemResult::Failed, None, None)],
    );
    let bindings_before = fixture
        .store
        .list_registration_results(&fixture.task_id)
        .unwrap();
    assert!(fixture.store.apply_registration_report(&late).is_err());
    assert_eq!(
        fixture
            .store
            .list_registration_results(&fixture.task_id)
            .unwrap(),
        bindings_before,
        "a late canceled report must not mutate associations"
    );
    let resumed = fixture
        .store
        .resume_task_setup(
            &fixture.task_id,
            Some(&fixture.operation_id),
            Some(&fixture.session_id),
        )
        .unwrap();
    assert_eq!(resumed.id, task_before.id);
    assert_eq!(
        resumed.setup_operation_id.as_deref(),
        Some(fixture.operation_id.as_str())
    );
    assert_eq!(
        resumed.setup_session_id.as_deref(),
        Some(fixture.session_id.as_str())
    );
    assert!(resumed.setup_cancelled_at.is_none());
    assert!(path.exists());
    assert!(fixture
        .store
        .resume_task_setup(&fixture.task_id, Some("other"), Some(&fixture.session_id))
        .is_err());
}

#[test]
fn cancellation_rolls_back_task_session_state_and_event_on_persistence_failure() {
    let fixture = Fixture::new("cancel-rollback");
    fixture.install_failure_trigger("fail_cancel_event", "setup_events", "INSERT");

    assert!(fixture.store.cancel_task_setup(&fixture.task_id).is_err());
    fixture.remove_failure_trigger("fail_cancel_event");

    let task = fixture.store.get_task(&fixture.task_id).unwrap().unwrap();
    assert_eq!(task.setup_status, TaskSetupStatus::InProgress);
    assert!(task.setup_cancelled_at.is_none());
    assert!(task.setup_cancellation_detail.is_none());
    assert_eq!(
        fixture
            .store
            .get_session(&fixture.session_id)
            .unwrap()
            .unwrap()
            .last_known_status,
        "starting"
    );
    assert_eq!(fixture.scalar_i64("SELECT COUNT(*) FROM setup_events"), 0);
    assert_eq!(
        fixture.scalar_i64("SELECT COUNT(*) FROM setup_operation_state WHERE status = 'active'"),
        1
    );
}

#[test]
fn registration_report_rolls_back_items_and_task_on_persistence_failure() {
    let fixture = Fixture::new("report-rollback");
    let path = fixture.worktree("task-report-rollback", "ready");
    let report = fixture.report(
        "operation-report-rollback",
        vec![fixture.item(
            "ready",
            RegistrationItemResult::Ready,
            Some("task-report-rollback"),
            Some(&path),
        )],
    );
    fixture.install_failure_trigger("fail_report_operation", "setup_operations", "INSERT");

    assert!(fixture.store.apply_registration_report(&report).is_err());
    fixture.remove_failure_trigger("fail_report_operation");

    assert!(fixture
        .store
        .list_registration_results(&fixture.task_id)
        .unwrap()
        .is_empty());
    assert_eq!(
        fixture
            .store
            .get_task(&fixture.task_id)
            .unwrap()
            .unwrap()
            .setup_status,
        TaskSetupStatus::InProgress
    );
    assert_eq!(
        fixture.scalar_i64("SELECT COUNT(*) FROM setup_operations"),
        0
    );
}

#[test]
fn resume_is_only_valid_once_for_a_canceled_incomplete_setup() {
    let active = Fixture::new("resume-active");
    assert!(active
        .store
        .resume_task_setup(
            &active.task_id,
            Some(&active.operation_id),
            Some(&active.session_id)
        )
        .is_err());

    let canceled = Fixture::new("resume-once");
    canceled.store.cancel_task_setup(&canceled.task_id).unwrap();
    canceled
        .store
        .resume_task_setup(
            &canceled.task_id,
            Some(&canceled.operation_id),
            Some(&canceled.session_id),
        )
        .unwrap();
    assert!(
        canceled
            .store
            .resume_task_setup(
                &canceled.task_id,
                Some(&canceled.operation_id),
                Some(&canceled.session_id),
            )
            .is_err(),
        "a repeated/concurrent-style resume must lose the state race"
    );
    let ready = Fixture::new("resume-ready");
    let path = ready.worktree("task-resume-ready", "ready");
    ready
        .store
        .apply_registration_report(&ready.report(
            &ready.operation_id,
            vec![ready.item(
                "ready",
                RegistrationItemResult::Ready,
                Some("task-resume-ready"),
                Some(&path),
            )],
        ))
        .unwrap();
    assert!(ready
        .store
        .resume_task_setup(
            &ready.task_id,
            Some(&ready.operation_id),
            Some(&ready.session_id)
        )
        .is_err());
}
