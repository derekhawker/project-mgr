use std::{fs, path::Path, process::Command};

use opencode_project_manager_lib::{
    change_review::{full_diff_for_owner, load_for_owner},
    management::{
        CheckoutMode, ManagementStore, NewWorkspace, VerificationStatus, WorkspaceKind,
        WorkspaceRepositoryBinding,
    },
    opencode::ModelReference,
    task_setup::{create_task_from_confirmation, TaskSessionStarter},
    workspace_setup::{
        inspect_repository_preflight, plan_workspace_setup, provision_independent_clone,
    },
};
use tempfile::tempdir;

struct NoopSessions;

impl TaskSessionStarter for NoopSessions {
    fn is_attached(&self, _session_id: &str) -> bool {
        false
    }

    fn create_session(
        &mut self,
        _title: &str,
        _directory: &Path,
        _model: &ModelReference,
    ) -> Result<String, String> {
        Ok("change-review-session".into())
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
        "Git {:?} failed: {}",
        args,
        String::from_utf8_lossy(&output.stderr)
    );
}

fn commit(path: &Path, message: &str) {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args([
            "-c",
            "user.name=Change Review",
            "-c",
            "user.email=review@example.invalid",
            "commit",
            "--quiet",
            "-m",
            message,
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "Git commit failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn full_context_is_bounded_and_scoped_to_verified_workspace_repositories() {
    for base_branch in ["main", "master"] {
        let fixture = tempdir().unwrap();
        let source = fixture.path().join("source");
        fs::create_dir_all(&source).unwrap();
        let init = Command::new("git")
            .args([
                "init",
                "--quiet",
                &format!("--initial-branch={base_branch}"),
            ])
            .arg(&source)
            .output()
            .unwrap();
        assert!(
            init.status.success(),
            "{}",
            String::from_utf8_lossy(&init.stderr)
        );
        fs::write(source.join("tracked.txt"), "base\n").unwrap();
        git(&source, &["add", "."]);
        commit(&source, "base");
        git(
            &source,
            &[
                "update-ref",
                &format!("refs/remotes/origin/{base_branch}"),
                "HEAD",
            ],
        );
        git(
            &source,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                &format!("refs/remotes/origin/{base_branch}"),
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
                id: format!("workspace-review-{base_branch}"),
                name: format!("Review {base_branch}"),
                slug: format!("review-{base_branch}"),
                description: None,
                kind: WorkspaceKind::Regular,
                created_at: 1,
            })
            .unwrap();
        let repository = store
            .catalog_discovered_repository("review-repo", &source, None, 1)
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
                .join(".staging-review"),
        )
        .unwrap();
        assert_eq!(clone.branch, base_branch);
        git(
            &clone.checkout_path,
            &[
                "update-ref",
                "-d",
                &format!("refs/remotes/origin/{base_branch}"),
            ],
        );
        let origin_url = Command::new("git")
            .arg("-C")
            .arg(&clone.checkout_path)
            .args(["remote", "get-url", "origin"])
            .output()
            .unwrap();
        assert!(
            !origin_url.status.success(),
            "fixture should have no origin remote"
        );
        let binding = WorkspaceRepositoryBinding {
            workspace_id: workspace.id.clone(),
            repository_id: repository.id.clone(),
            checkout_path: clone.checkout_path.to_string_lossy().into_owned(),
            checkout_mode: CheckoutMode::Clone,
            branch: clone.branch,
            verification_status: VerificationStatus::Verified,
            created_at: 1,
        };
        store
            .validate_and_save_workspace_repository_binding(&binding)
            .unwrap();
        let long_file = (0..40).map(|n| format!("line {n}\n")).collect::<String>();
        fs::write(clone.checkout_path.join("tracked.txt"), &long_file).unwrap();
        git(&clone.checkout_path, &["add", "tracked.txt"]);
        commit(&clone.checkout_path, "long file");
        git(
            &clone.checkout_path,
            &["update-ref", &format!("refs/heads/{base_branch}"), "HEAD"],
        );
        // The selected comparison ref must continue to point to the baseline.
        git(
            &clone.checkout_path,
            &[
                "update-ref",
                &format!("refs/remotes/origin/{base_branch}"),
                "HEAD",
            ],
        );
        fs::write(
            clone.checkout_path.join("tracked.txt"),
            long_file.replace("line 20\n", "changed\n"),
        )
        .unwrap();
        let full = full_diff_for_owner(
            &store,
            "workspace",
            &workspace.id,
            &repository.id,
            "tracked.txt",
        )
        .unwrap();
        assert!(full.contains(" line 0") && full.contains(" line 39") && full.contains("+changed"));
        assert!(
            full_diff_for_owner(&store, "task", &workspace.id, &repository.id, "tracked.txt")
                .is_err()
        );
        assert!(full_diff_for_owner(
            &store,
            "workspace",
            &workspace.id,
            "other-repository",
            "tracked.txt"
        )
        .is_err());
        assert!(full_diff_for_owner(
            &store,
            "workspace",
            &workspace.id,
            &repository.id,
            "../tracked.txt"
        )
        .is_err());
        fs::write(
            clone.checkout_path.join("tracked.txt"),
            format!("changed\n{}", "x".repeat(1_100_000)),
        )
        .unwrap();
        assert!(full_diff_for_owner(
            &store,
            "workspace",
            &workspace.id,
            &repository.id,
            "tracked.txt"
        )
        .unwrap_err()
        .contains("limit"));
        fs::write(
            clone.checkout_path.join("tracked.txt"),
            "many\n".repeat(20_100),
        )
        .unwrap();
        assert!(full_diff_for_owner(
            &store,
            "workspace",
            &workspace.id,
            &repository.id,
            "tracked.txt"
        )
        .unwrap_err()
        .contains("limit"));
        let model = ModelReference {
            provider_id: "test-provider".into(),
            id: "test-model".into(),
        };
        let mut sessions = NoopSessions;
        let created = create_task_from_confirmation(
            &store,
            &workspace.id,
            format!("task-review-{base_branch}"),
            "Review committed changes".into(),
            None,
            std::slice::from_ref(&repository.id),
            2,
            "test-provider/test-model",
            &model,
            &mut sessions,
        )
        .unwrap();
        let task_id = created["task"]["id"].as_str().unwrap();
        let task_repository = store
            .list_task_repository_bindings(task_id)
            .unwrap()
            .remove(0);
        let worktree = Path::new(&task_repository.worktree_path);

        fs::write(worktree.join("committed.txt"), "committed on task branch\n").unwrap();
        git(worktree, &["add", "committed.txt"]);
        commit(worktree, "task branch change");
        fs::write(worktree.join("tracked.txt"), "working tree edit\n").unwrap();
        fs::write(worktree.join("untracked.txt"), "new working file\n").unwrap();

        assert!(load_for_owner(&store, "task", task_id).is_err());
    }
}
