//! I-07 registration tests use real repositories and linked worktrees.  The
//! report boundary is intentionally exercised through the production store,
//! rather than through a fake Git adapter.
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use opencode_project_manager_lib::management::{
    ManagementStore, NewSession, NewTask, NewWorkspace, RegistrationItem, RegistrationItemResult,
    RegistrationReport, RepositorySetupStatus, SessionOwner, TaskSetupStatus, WorkspaceKind,
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
        let identity = opencode_project_manager_lib::safety::inspect_repository(&repository_path)
            .unwrap()
            .repository
            .identity;
        Self {
            root,
            store,
            repository_id: repository.id,
            repository_path,
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
