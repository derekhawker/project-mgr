use registration_worktree_prototype::{
    CleanupClassification, ItemResult, RegistrationBoundary, RegistrationItem, RegistrationReport,
    RepositoryRecord,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

struct TempDirectory {
    path: PathBuf,
}

impl TempDirectory {
    fn new() -> Self {
        let counter = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "project-mgr-registration-{}-{timestamp}-{counter}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("create isolated fixture directory");
        Self { path }
    }
}

impl Drop for TempDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

struct RepositoryFixture {
    path: PathBuf,
}

struct Fixture {
    temp: TempDirectory,
    alpha: RepositoryFixture,
    beta: RepositoryFixture,
    task_root: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDirectory::new();
        let alpha = RepositoryFixture {
            path: temp.path.join("repositories").join("alpha"),
        };
        let beta = RepositoryFixture {
            path: temp.path.join("repositories").join("beta"),
        };
        fs::create_dir_all(alpha.path.parent().expect("repository parent"))
            .expect("create repository parent");
        init_repository(&alpha.path, "alpha");
        init_repository(&beta.path, "beta");
        let task_root = temp.path.join("workspace").join("tasks").join("task-1");
        fs::create_dir_all(&task_root).expect("create task worktree root");
        Self {
            temp,
            alpha,
            beta,
            task_root,
        }
    }

    fn boundary(&self) -> RegistrationBoundary {
        let mut boundary = RegistrationBoundary::new();
        boundary
            .register_repository("repo-alpha", &self.alpha.path)
            .expect("register alpha");
        boundary
            .register_repository("repo-beta", &self.beta.path)
            .expect("register beta");
        boundary
            .register_workspace("workspace-1")
            .expect("register workspace");
        boundary
            .register_task("workspace-1", "task-1", &self.task_root)
            .expect("register task");
        boundary
            .register_session("workspace-1", "task-1", "session-1")
            .expect("register session");
        boundary
    }

    fn add_worktree(
        &self,
        repository: &RepositoryFixture,
        branch: &str,
        directory_name: &str,
    ) -> PathBuf {
        let path = self.task_root.join(directory_name);
        fs::create_dir_all(&path).expect("create worktree parent");
        git(
            &repository.path,
            vec![
                "worktree".to_owned(),
                "add".to_owned(),
                "-q".to_owned(),
                "-b".to_owned(),
                branch.to_owned(),
                path.to_string_lossy().into_owned(),
                "main".to_owned(),
            ],
        );
        path
    }

    fn add_outside_worktree(&self, branch: &str) -> PathBuf {
        let path = self.temp.path.join("outside-task-worktree");
        fs::create_dir_all(&path).expect("create outside worktree parent");
        git(
            &self.alpha.path,
            vec![
                "worktree".to_owned(),
                "add".to_owned(),
                "-q".to_owned(),
                "-b".to_owned(),
                branch.to_owned(),
                path.to_string_lossy().into_owned(),
                "main".to_owned(),
            ],
        );
        path
    }
}

fn init_repository(path: &Path, name: &str) {
    fs::create_dir_all(path).expect("create repository");
    git(
        path,
        vec![
            "init".to_owned(),
            "-q".to_owned(),
            "-b".to_owned(),
            "main".to_owned(),
        ],
    );
    git(
        path,
        vec![
            "config".to_owned(),
            "user.name".to_owned(),
            "P-00 fixture".to_owned(),
        ],
    );
    git(
        path,
        vec![
            "config".to_owned(),
            "user.email".to_owned(),
            "p00@example.invalid".to_owned(),
        ],
    );
    fs::write(path.join("README.txt"), format!("fixture {name}\n")).expect("write fixture file");
    git(path, vec!["add".to_owned(), "README.txt".to_owned()]);
    git(
        path,
        vec![
            "commit".to_owned(),
            "-qm".to_owned(),
            "initial fixture".to_owned(),
        ],
    );
}

fn git(cwd: &Path, args: Vec<String>) -> String {
    let output = Command::new("git")
        .args(args.iter().map(OsString::from))
        .current_dir(cwd)
        .output()
        .expect("execute Git fixture command");
    assert!(
        output.status.success(),
        "Git command failed in {}: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

fn git_succeeds(cwd: &Path, args: Vec<String>) -> bool {
    Command::new("git")
        .args(args.iter().map(OsString::from))
        .current_dir(cwd)
        .output()
        .expect("execute Git inspection command")
        .status
        .success()
}

fn repo_record(boundary: &RegistrationBoundary, id: &str) -> RepositoryRecord {
    boundary.repository(id).expect("catalog repository")
}

fn ready_item(
    item_id: &str,
    repository: &RepositoryRecord,
    branch: &str,
    worktree_path: &Path,
) -> RegistrationItem {
    RegistrationItem {
        item_id: item_id.to_owned(),
        repository_id: repository.repository_id.clone(),
        repository_path: repository.canonical_path.clone(),
        git_identity: repository.git_identity.clone(),
        branch: Some(branch.to_owned()),
        worktree_path: Some(worktree_path.to_string_lossy().into_owned()),
        result: ItemResult::Ready,
        error_code: None,
        detail: None,
    }
}

fn outcome_item(
    item_id: &str,
    repository: &RepositoryRecord,
    result: ItemResult,
    error_code: &str,
    detail: &str,
) -> RegistrationItem {
    RegistrationItem {
        item_id: item_id.to_owned(),
        repository_id: repository.repository_id.clone(),
        repository_path: repository.canonical_path.clone(),
        git_identity: repository.git_identity.clone(),
        branch: None,
        worktree_path: None,
        result,
        error_code: Some(error_code.to_owned()),
        detail: Some(detail.to_owned()),
    }
}

fn report(operation_id: &str, items: Vec<RegistrationItem>) -> RegistrationReport {
    RegistrationReport {
        operation_id: operation_id.to_owned(),
        workspace_id: "workspace-1".to_owned(),
        task_id: "task-1".to_owned(),
        session_id: "session-1".to_owned(),
        items,
    }
}

fn error_code(
    result: &Result<impl std::fmt::Debug, registration_worktree_prototype::BoundaryError>,
) -> &str {
    result
        .as_ref()
        .expect_err("expected boundary rejection")
        .code
        .as_str()
}

#[test]
fn structured_multi_repository_report_preserves_mixed_item_outcomes() {
    let fixture = Fixture::new();
    let mut boundary = fixture.boundary();
    let alpha_worktree = fixture.add_worktree(&fixture.alpha, "task-alpha", "alpha");
    let beta_worktree = fixture.add_worktree(&fixture.beta, "task-beta", "beta");
    let alpha = repo_record(&boundary, "repo-alpha");
    let beta = repo_record(&boundary, "repo-beta");
    let input = report(
        "operation-mixed",
        vec![
            ready_item("alpha-ready", &alpha, "task-alpha", &alpha_worktree),
            ready_item("beta-ready", &beta, "task-beta", &beta_worktree),
            outcome_item(
                "beta-failed",
                &beta,
                ItemResult::Failed,
                "branch_creation_failed",
                "The setup command could not create the requested branch.",
            ),
            outcome_item(
                "beta-not-attempted",
                &beta,
                ItemResult::NotAttempted,
                "not_attempted",
                "Setup stopped after the preceding repository failure.",
            ),
        ],
    );

    let payload: Value = serde_json::to_value(&input).expect("serialize report payload");
    assert_eq!(payload["operation_id"], "operation-mixed");
    assert_eq!(payload["workspace_id"], "workspace-1");
    assert_eq!(payload["task_id"], "task-1");
    assert_eq!(payload["session_id"], "session-1");
    assert_eq!(payload["items"][0]["repository_id"], "repo-alpha");
    assert_eq!(payload["items"][0]["result"], "ready");
    assert_eq!(payload["items"][1]["repository_id"], "repo-beta");
    assert_eq!(payload["items"][1]["result"], "ready");
    assert_eq!(payload["items"][2]["result"], "failed");
    assert_eq!(payload["items"][2]["error_code"], "branch_creation_failed");
    assert_eq!(payload["items"][3]["result"], "not_attempted");

    let returned = boundary.apply_report(input).expect("apply mixed report");
    assert_eq!(returned.items.len(), 4);
    assert!(!returned.replayed);
    assert_eq!(
        returned
            .items
            .iter()
            .map(|item| &item.result)
            .collect::<Vec<_>>(),
        vec![
            &ItemResult::Ready,
            &ItemResult::Ready,
            &ItemResult::Failed,
            &ItemResult::NotAttempted,
        ]
    );
    assert_eq!(boundary.persisted_items("task-1").len(), 4);
    assert_eq!(boundary.association_count(), 2);
    assert!(alpha_worktree.exists());
    assert!(beta_worktree.exists());
    assert!(git_succeeds(
        &fixture.alpha.path,
        vec![
            "show-ref".to_owned(),
            "--verify".to_owned(),
            "--quiet".to_owned(),
            "refs/heads/task-alpha".to_owned(),
        ]
    ));
}

#[test]
fn caller_session_and_owner_validation_rejects_before_item_processing() {
    let fixture = Fixture::new();
    let mut boundary = fixture.boundary();
    let alpha = repo_record(&boundary, "repo-alpha");
    let worktree = fixture.add_worktree(&fixture.alpha, "task-owner", "owner");
    let valid = report(
        "operation-owner",
        vec![ready_item("owner-item", &alpha, "task-owner", &worktree)],
    );
    let before = boundary.snapshot();

    let mut unknown_session = valid.clone();
    unknown_session.session_id = "session-unknown".to_owned();
    assert_eq!(
        error_code(&boundary.apply_report(unknown_session)),
        "caller_session_not_found"
    );

    let mut wrong_task_owner = valid.clone();
    wrong_task_owner.workspace_id = "workspace-other".to_owned();
    assert_eq!(
        error_code(&boundary.apply_report(wrong_task_owner)),
        "workspace_not_found"
    );

    boundary
        .register_workspace("workspace-other")
        .expect("register second workspace");
    let other_root = fixture.temp.path.join("workspace-other").join("worktrees");
    fs::create_dir_all(&other_root).expect("create other task root");
    boundary
        .register_task("workspace-other", "task-other", &other_root)
        .expect("register other task");
    boundary
        .register_session("workspace-other", "task-other", "session-other")
        .expect("register other session");

    let mut mismatched_session_owner = valid.clone();
    mismatched_session_owner.session_id = "session-other".to_owned();
    assert_eq!(
        error_code(&boundary.apply_report(mismatched_session_owner)),
        "caller_session_mismatch"
    );

    let mut mismatched_task_owner = valid.clone();
    mismatched_task_owner.task_id = "task-other".to_owned();
    mismatched_task_owner.workspace_id = "workspace-1".to_owned();
    mismatched_task_owner.session_id = "session-1".to_owned();
    assert_eq!(
        error_code(&boundary.apply_report(mismatched_task_owner)),
        "task_owner_mismatch"
    );

    let mut unknown_task = valid.clone();
    unknown_task.task_id = "task-unknown".to_owned();
    assert_eq!(
        error_code(&boundary.apply_report(unknown_task)),
        "task_not_found"
    );
    assert_eq!(boundary.snapshot(), before);
    assert!(worktree.exists());
}

#[test]
fn repository_identity_path_branch_and_worktree_validation_is_itemized_and_read_only() {
    let fixture = Fixture::new();
    let mut boundary = fixture.boundary();
    let alpha = repo_record(&boundary, "repo-alpha");
    let beta = repo_record(&boundary, "repo-beta");
    let good_worktree = fixture.add_worktree(&fixture.alpha, "task-good", "good");
    let outside_worktree = fixture.add_outside_worktree("task-outside");
    git(
        &fixture.alpha.path,
        vec![
            "branch".to_owned(),
            "task-no-worktree".to_owned(),
            "main".to_owned(),
        ],
    );
    let input = report(
        "operation-validation",
        vec![
            {
                let mut item = ready_item("wrong-identity", &alpha, "task-good", &good_worktree);
                item.git_identity = beta.git_identity.clone();
                item
            },
            {
                let mut item = ready_item("wrong-path", &alpha, "task-good", &good_worktree);
                item.repository_path = beta.canonical_path.clone();
                item
            },
            ready_item(
                "missing-branch",
                &alpha,
                "branch-does-not-exist",
                &good_worktree,
            ),
            ready_item(
                "missing-worktree",
                &alpha,
                "task-no-worktree",
                &fixture.task_root.join("does-not-exist"),
            ),
            ready_item("outside-task", &alpha, "task-outside", &outside_worktree),
            ready_item("branch-mismatch", &alpha, "main", &good_worktree),
        ],
    );
    let paths_before = vec![good_worktree.clone(), outside_worktree.clone()];
    let returned = boundary
        .apply_report(input)
        .expect("item failures are persisted");
    assert_eq!(returned.items.len(), 6);
    assert!(returned
        .items
        .iter()
        .all(|item| item.result == ItemResult::Failed));
    let codes: BTreeMap<_, _> = returned
        .items
        .iter()
        .map(|item| (item.item_id.as_str(), item.error_code.as_deref().unwrap()))
        .collect();
    assert_eq!(codes["wrong-identity"], "repository_identity_mismatch");
    assert_eq!(codes["wrong-path"], "repository_path_mismatch");
    assert_eq!(codes["missing-branch"], "branch_not_found");
    assert_eq!(codes["missing-worktree"], "worktree_not_found");
    assert_eq!(codes["outside-task"], "task_worktree_boundary");
    assert_eq!(codes["branch-mismatch"], "worktree_branch_mismatch");
    assert_eq!(boundary.association_count(), 0);
    for path in paths_before {
        assert!(
            path.exists(),
            "report validation deleted {}",
            path.display()
        );
    }
    assert!(git_succeeds(
        &fixture.alpha.path,
        vec![
            "show-ref".to_owned(),
            "--verify".to_owned(),
            "--quiet".to_owned(),
            "refs/heads/task-good".to_owned(),
        ]
    ));
    assert!(git_succeeds(
        &fixture.alpha.path,
        vec![
            "show-ref".to_owned(),
            "--verify".to_owned(),
            "--quiet".to_owned(),
            "refs/heads/task-outside".to_owned(),
        ]
    ));
}

#[test]
fn active_ownership_idempotent_replay_and_mismatched_operation_are_distinct() {
    let fixture = Fixture::new();
    let mut boundary = fixture.boundary();
    let alpha = repo_record(&boundary, "repo-alpha");
    let worktree = fixture.add_worktree(&fixture.alpha, "task-shared", "shared");
    let original = report(
        "operation-replay",
        vec![ready_item("shared-item", &alpha, "task-shared", &worktree)],
    );
    let first = boundary
        .apply_report(original.clone())
        .expect("apply original report");
    let replay = boundary
        .apply_report(original.clone())
        .expect("replay identical report");
    assert!(!first.replayed);
    assert!(replay.replayed);
    assert_eq!(replay.items, first.items);
    assert_eq!(boundary.operation_count(), 1);
    assert_eq!(boundary.association_count(), 1);
    let mut changed = original.clone();
    changed.items[0].detail = Some("different content".to_owned());
    assert_eq!(
        error_code(&boundary.apply_report(changed)),
        "operation_mismatch"
    );
    assert_eq!(boundary.operation_count(), 1);
    assert_eq!(boundary.association_count(), 1);

    boundary
        .register_workspace("workspace-2")
        .expect("register conflict workspace");
    boundary
        .register_task(
            "workspace-2",
            "task-2",
            &fixture.temp.path.join("workspace"),
        )
        .expect("register conflict task");
    boundary
        .register_session("workspace-2", "task-2", "session-2")
        .expect("register conflict session");
    let conflict = RegistrationReport {
        operation_id: "operation-conflict".to_owned(),
        workspace_id: "workspace-2".to_owned(),
        task_id: "task-2".to_owned(),
        session_id: "session-2".to_owned(),
        items: vec![ready_item(
            "conflict-item",
            &alpha,
            "task-shared",
            &worktree,
        )],
    };
    let conflict_result = boundary
        .apply_report(conflict)
        .expect("conflict is persisted as an item failure");
    assert_eq!(conflict_result.items[0].result, ItemResult::Failed);
    assert_eq!(
        conflict_result.items[0].error_code.as_deref(),
        Some("conflicting_active_ownership")
    );
    assert!(worktree.exists());
}

#[test]
fn cleanup_removes_only_clean_unused_and_retains_every_branch() {
    let fixture = Fixture::new();
    let mut boundary = fixture.boundary();
    let alpha = repo_record(&boundary, "repo-alpha");
    let clean_path = fixture.add_worktree(&fixture.alpha, "task-clean", "clean");
    let dirty_path = fixture.add_worktree(&fixture.alpha, "task-dirty", "dirty");
    let in_use_path = fixture.add_worktree(&fixture.alpha, "task-in-use", "in-use");
    let setup = report(
        "operation-cleanup",
        vec![
            ready_item("clean", &alpha, "task-clean", &clean_path),
            ready_item("dirty", &alpha, "task-dirty", &dirty_path),
            ready_item("in-use", &alpha, "task-in-use", &in_use_path),
        ],
    );
    boundary
        .apply_report(setup)
        .expect("register cleanup worktrees");
    fs::write(dirty_path.join("new-file.txt"), "untracked\n").expect("create new file");
    fs::write(dirty_path.join("README.txt"), "modified\n").expect("modify tracked file");
    boundary
        .set_session_worktree("session-1", &in_use_path)
        .expect("record active session worktree");
    boundary
        .complete_task("task-1")
        .expect("complete task for cleanup");

    let clean = boundary
        .cleanup_worktree("task-1", "repo-alpha", &clean_path)
        .expect("clean worktree cleanup");
    assert_eq!(clean.classification, CleanupClassification::CleanUnused);
    assert!(clean.removed);
    assert!(!clean_path.exists());
    assert!(clean.branch_retained);

    let dirty = boundary
        .cleanup_worktree("task-1", "repo-alpha", &dirty_path)
        .expect("dirty worktree classification");
    assert_eq!(dirty.classification, CleanupClassification::DirtyOrNewFile);
    assert!(!dirty.removed);
    assert!(dirty_path.exists());
    assert!(dirty.branch_retained);

    let in_use = boundary
        .cleanup_worktree("task-1", "repo-alpha", &in_use_path)
        .expect("in-use worktree classification");
    assert_eq!(in_use.classification, CleanupClassification::InUse);
    assert!(!in_use.removed);
    assert!(in_use_path.exists());
    assert!(in_use.branch_retained);
    assert_eq!(boundary.cleanup_records().len(), 3);

    for branch in ["task-clean", "task-dirty", "task-in-use"] {
        assert!(git_succeeds(
            &fixture.alpha.path,
            vec![
                "show-ref".to_owned(),
                "--verify".to_owned(),
                "--quiet".to_owned(),
                format!("refs/heads/{branch}"),
            ]
        ));
    }
    let worktree_listing = git(
        &fixture.alpha.path,
        vec![
            "worktree".to_owned(),
            "list".to_owned(),
            "--porcelain".to_owned(),
        ],
    );
    assert!(!worktree_listing.contains(clean_path.to_string_lossy().as_ref()));
    assert!(worktree_listing.contains(dirty_path.to_string_lossy().as_ref()));
    assert!(worktree_listing.contains(in_use_path.to_string_lossy().as_ref()));
}

#[test]
fn registration_does_not_duplicate_history_or_start_a_second_service() {
    let fixture = Fixture::new();
    let mut boundary = fixture.boundary();
    let alpha = repo_record(&boundary, "repo-alpha");
    let worktree = fixture.add_worktree(&fixture.alpha, "task-history", "history");
    let input = report(
        "operation-history",
        vec![ready_item(
            "history-item",
            &alpha,
            "task-history",
            &worktree,
        )],
    );

    let mut existing_opencode_state = BTreeMap::from([(
        "session-1".to_owned(),
        vec!["user prompt".to_owned(), "assistant answer".to_owned()],
    )]);
    let history_before = existing_opencode_state.clone();
    let topology_before = (1_u8, existing_opencode_state.len());
    boundary
        .apply_report(input)
        .expect("apply registration report");
    assert_eq!(existing_opencode_state, history_before);
    assert_eq!((1_u8, existing_opencode_state.len()), topology_before);

    let snapshot = serde_json::to_value(boundary.snapshot()).expect("serialize boundary snapshot");
    assert!(snapshot.get("conversation_history").is_none());
    assert!(snapshot.get("messages").is_none());
    assert!(snapshot.get("service").is_none());
    assert!(snapshot.get("service_instances").is_none());
    assert_eq!(boundary.operation_count(), 1);
    assert_eq!(boundary.association_count(), 1);
    existing_opencode_state
        .get_mut("session-1")
        .expect("existing session history")
        .push("unchanged outside boundary".to_owned());
    assert_eq!(
        existing_opencode_state["session-1"].len(),
        history_before["session-1"].len() + 1
    );
}
