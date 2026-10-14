//! Small production-I-06 fixtures.  These deliberately use real Git
//! repositories so catalog and attachment tests cannot pass on path strings
//! alone.
use std::fs;
use std::path::Path;
use std::process::Command;

use opencode_project_manager_lib::management::{
    CheckoutMode, ManagementStore, NewWorkspace, PurposeStatus, VerificationStatus, WorkspaceKind,
    WorkspaceRepositoryBinding,
};
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

fn fixture_repo(path: &Path) {
    fs::create_dir_all(path).unwrap();
    let output = Command::new("git")
        .args(["init", "--quiet", "--initial-branch=main"])
        .arg(path)
        .output()
        .unwrap();
    assert!(output.status.success());
    fs::write(path.join("README.md"), "fixture\n").unwrap();
    git(path, &["add", "README.md"]);
    git(
        path,
        &[
            "-c",
            "user.name=I-06",
            "-c",
            "user.email=i06@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture",
        ],
    );
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
fn i06_scan_deduplicates_git_identity_and_keeps_purpose_proposals_independent() {
    let fixture = tempdir().unwrap();
    let repo = fixture.path().join("repo");
    fixture_repo(&repo);
    let store = ManagementStore::in_memory_with_paths(
        &fixture.path().join("home"),
        &fixture.path().join("tmp"),
    )
    .unwrap();

    let first = store
        .catalog_discovered_repository("repo-one", &repo, Some("first purpose"), 1)
        .unwrap();
    let duplicate = store
        .catalog_discovered_repository("repo-two", &repo, Some("second purpose"), 2)
        .unwrap();
    assert_eq!(first.id, duplicate.id);
    assert_eq!(store.list_repositories().unwrap().len(), 1);
    assert_eq!(duplicate.purpose_status, PurposeStatus::Available);
    assert_eq!(duplicate.purpose.as_deref(), Some("second purpose"));
}

#[test]
fn i06_external_attach_failure_is_recorded_without_verified_binding() {
    let fixture = tempdir().unwrap();
    let repo = fixture.path().join("repo");
    fixture_repo(&repo);
    let store = ManagementStore::in_memory_with_paths(
        &fixture.path().join("home"),
        &fixture.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-i06".into(),
            name: "I-06".into(),
            slug: "i06".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    let repository = store
        .catalog_discovered_repository("repo-i06", &repo, None, 1)
        .unwrap();
    let binding = WorkspaceRepositoryBinding {
        workspace_id: workspace.id,
        repository_id: repository.id,
        checkout_path: fixture.path().join("not-a-repo").to_string_lossy().into(),
        checkout_mode: CheckoutMode::Existing,
        branch: "main".into(),
        verification_status: VerificationStatus::Verified,
        created_at: 1,
    };
    assert!(store
        .validate_and_save_workspace_repository_binding(&binding)
        .is_err());
    store.record_workspace_repository_failure(&binding).unwrap();
    assert_eq!(
        store
            .list_workspace_repository_bindings("workspace-i06")
            .unwrap()[0]
            .verification_status,
        VerificationStatus::Failed
    );
}
