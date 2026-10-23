use opencode_project_manager_lib::{
    docs_reader::{list_for_owner, read_for_owner},
    management::{
        CheckoutMode, ManagementStore, NewWorkspace, VerificationStatus, WorkspaceKind,
        WorkspaceRepositoryBinding,
    },
};
use std::fs;
use std::process::Command;
use tempfile::tempdir;

#[test]
fn production_reader_loads_workspace_home_document_relative_to_workspace() {
    let fixture = tempdir().unwrap();
    let project_home = fixture.path().join("projects");
    fs::create_dir_all(&project_home).unwrap();
    let store = ManagementStore::open_with_paths(
        fixture.path().join("management.sqlite"),
        &project_home,
        fixture.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-docs".into(),
            name: "Docs".into(),
            slug: "docs".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    let readme = std::path::Path::new(&workspace.home_path).join("README.md");
    fs::write(&readme, "# Workspace guide\n").unwrap();

    let files = list_for_owner(&store, "workspace", &workspace.id).unwrap();

    assert_eq!(files.len(), 1);
    assert_eq!(files[0].path, "README.md");
    assert_eq!(files[0].repository_id, None);
    let document =
        read_for_owner(&store, "workspace", &workspace.id, &files[0].path, None).unwrap();
    assert_eq!(document.contents, "# Workspace guide\n");
}

#[test]
fn production_reader_resolves_verified_repository_paths_from_workspace_bindings() {
    let fixture = tempdir().unwrap();
    let project_home = fixture.path().join("projects");
    fs::create_dir_all(&project_home).unwrap();
    let repository_path = fixture.path().join("repo");
    fs::create_dir_all(&repository_path).unwrap();
    let output = Command::new("git")
        .args(["init", "--quiet", "-b", "main"])
        .current_dir(&repository_path)
        .output()
        .unwrap();
    assert!(output.status.success());
    fs::write(repository_path.join("guide.TXT"), "Repository guide\n").unwrap();
    fs::create_dir_all(repository_path.join("node_modules/dependency")).unwrap();
    fs::write(
        repository_path.join("node_modules/dependency/README.md"),
        "dependency docs",
    )
    .unwrap();
    fs::create_dir_all(repository_path.join("vendor/lib")).unwrap();
    fs::write(repository_path.join("vendor/lib/manual.txt"), "vendor docs").unwrap();
    let output = Command::new("git")
        .args([
            "-c",
            "user.name=README Test",
            "-c",
            "user.email=readme@example.invalid",
            "add",
            ".",
        ])
        .current_dir(&repository_path)
        .output()
        .unwrap();
    assert!(output.status.success());
    let output = Command::new("git")
        .args([
            "-c",
            "user.name=README Test",
            "-c",
            "user.email=readme@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "base",
        ])
        .current_dir(&repository_path)
        .output()
        .unwrap();
    assert!(output.status.success());
    let output = Command::new("git")
        .args([
            "-C",
            repository_path.to_str().unwrap(),
            "update-ref",
            "refs/remotes/origin/main",
            "HEAD",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    let output = Command::new("git")
        .args([
            "-C",
            repository_path.to_str().unwrap(),
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ])
        .output()
        .unwrap();
    assert!(output.status.success());
    let store = ManagementStore::open_with_paths(
        fixture.path().join("management.sqlite"),
        &project_home,
        fixture.path().join("tmp"),
    )
    .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-repository-docs".into(),
            name: "Repository Docs".into(),
            slug: "repository-docs".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: 1,
        })
        .unwrap();
    let repository = store
        .catalog_discovered_repository("readme-repo", &repository_path, None, 1)
        .unwrap();
    let repository_id = repository.id.clone();
    store
        .validate_and_save_workspace_repository_binding(&WorkspaceRepositoryBinding {
            workspace_id: workspace.id.clone(),
            repository_id: repository.id,
            checkout_path: repository_path.display().to_string(),
            checkout_mode: CheckoutMode::Existing,
            branch: "main".into(),
            verification_status: VerificationStatus::Verified,
            created_at: 1,
        })
        .unwrap();

    let files = list_for_owner(&store, "workspace", &workspace.id).unwrap();

    assert!(files.iter().any(|file| {
        file.path == "guide.TXT" && file.repository_id.as_deref() == Some(repository_id.as_str())
    }));
    assert!(!files
        .iter()
        .any(|file| { file.path.contains("node_modules") || file.path.contains("vendor") }));
    let document = read_for_owner(
        &store,
        "workspace",
        &workspace.id,
        "guide.TXT",
        Some(&repository_id),
    )
    .unwrap();
    assert_eq!(document.contents, "Repository guide\n");
    assert!(read_for_owner(&store, "workspace", &workspace.id, "/etc/passwd", None).is_err());
}
