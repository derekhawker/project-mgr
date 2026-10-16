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
use opencode_project_manager_lib::workspace_setup::{
    inspect_repository_preflight, plan_workspace_setup, provision_independent_clone,
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

fn git_text(path: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
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

#[test]
fn i06_selected_repository_gets_independent_clones_in_two_workspaces() {
    let fixture = tempdir().unwrap();
    let source = fixture.path().join("source");
    fixture_repo(&source);
    let store = ManagementStore::in_memory_with_paths(
        &fixture.path().join("home"),
        &fixture.path().join("tmp"),
    )
    .unwrap();
    let catalog = store
        .catalog_discovered_repository("repo-cloned", &source, None, 1)
        .unwrap();
    let mut results = Vec::new();
    for (id, slug) in [
        ("workspace-clone-a", "clone-a"),
        ("workspace-clone-b", "clone-b"),
    ] {
        let workspace = store
            .create_workspace(&NewWorkspace {
                id: id.into(),
                name: slug.into(),
                slug: slug.into(),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 2,
            })
            .unwrap();
        let plan = plan_workspace_setup(
            Path::new(&workspace.home_path),
            vec![inspect_repository_preflight(&catalog).unwrap()],
        )
        .unwrap()
        .repositories
        .remove(0);
        let staging = Path::new(&workspace.home_path).join("repos/.staging-repository");
        let clone = provision_independent_clone(&catalog, &plan, &staging).unwrap();
        store
            .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
                workspace_id: workspace.id.clone(),
                repository_id: catalog.id.clone(),
                checkout_path: clone.checkout_path.to_string_lossy().into_owned(),
                checkout_mode: CheckoutMode::Clone,
                branch: clone.branch.clone(),
                verification_status: VerificationStatus::Verified,
                created_at: 3,
            })
            .unwrap();
        let metadata = store
            .workspace_repository_checkout_metadata(&workspace.id, &catalog.id)
            .unwrap()
            .unwrap();
        assert_eq!(metadata.source_identity, catalog.repository_identity);
        assert_eq!(metadata.checkout_identity, clone.checkout_identity);
        results.push(clone);
    }
    assert_ne!(results[0].checkout_identity, results[1].checkout_identity);
    assert_eq!(results[0].head, results[1].head);
    assert_eq!(git_text(&source, &["rev-parse", "HEAD"]), results[0].head);
    assert_eq!(git_text(&source, &["status", "--porcelain"]), "");
}
