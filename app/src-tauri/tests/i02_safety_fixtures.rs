use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use opencode_project_manager_lib::management::{
    CheckoutMode, CleanupJobState, CleanupPlan, ManagementStore, NewCleanupJob, NewSession,
    NewTask, NewWorkspace, RepositorySetupStatus, SessionOwner, TaskRepositoryBinding,
    TaskSetupStatus, VerificationStatus, WorkspaceKind, WorkspaceRepositoryBinding,
};
use opencode_project_manager_lib::safety::{inspect_branch, inspect_repository};
use tempfile::tempdir;

const CREATED: i64 = 1_800_000_000_000;

fn git(cwd: &Path, arguments: &[&str]) -> Output {
    Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(arguments)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .unwrap_or_else(|error| panic!("could not run git {arguments:?}: {error}"))
}

fn git_ok(cwd: &Path, arguments: &[&str]) -> Output {
    let output = git(cwd, arguments);
    assert!(
        output.status.success(),
        "git {arguments:?} failed in {}: {}",
        cwd.display(),
        String::from_utf8_lossy(&output.stderr)
    );
    output
}

fn init_repository(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let output = Command::new("git")
        .args(["init", "--quiet", "--initial-branch=main"])
        .arg(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    fs::write(path.join("README.md"), "fixture base\n").unwrap();
    fs::write(path.join(".gitignore"), "ignored-file.txt\n").unwrap();
    git_ok(path, &["add", "README.md", ".gitignore"]);
    git_ok(
        path,
        &[
            "-c",
            "user.name=I-02 Fixture",
            "-c",
            "user.email=i02@example.invalid",
            "commit",
            "--quiet",
            "-m",
            "fixture base",
        ],
    );
    git_ok(
        path,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );
}

fn task(
    store: &ManagementStore,
    workspace_id: &str,
    id: &str,
    name: &str,
) -> opencode_project_manager_lib::management::Task {
    let slug = store.suggest_task_slug(workspace_id, name).unwrap();
    store
        .create_task(&NewTask {
            id: id.into(),
            workspace_id: workspace_id.into(),
            name: name.into(),
            slug,
            description: None,
            setup_status: TaskSetupStatus::Ready,
            created_at: CREATED + 1,
        })
        .unwrap()
}

fn add_worktree(repo: &Path, target: &Path, branch: &str) {
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    git_ok(
        repo,
        &[
            "worktree",
            "add",
            "--quiet",
            "-b",
            branch,
            target.to_str().unwrap(),
        ],
    );
}

fn add_existing_branch_worktree(repo: &Path, target: &Path, branch: &str) {
    fs::create_dir_all(target.parent().unwrap()).unwrap();
    git_ok(
        repo,
        &[
            "worktree",
            "add",
            "--quiet",
            target.to_str().unwrap(),
            branch,
        ],
    );
}

fn workspace_binding(
    workspace_id: &str,
    repository_id: &str,
    checkout_path: &Path,
    checkout_mode: CheckoutMode,
    branch: &str,
) -> WorkspaceRepositoryBinding {
    WorkspaceRepositoryBinding {
        workspace_id: workspace_id.into(),
        repository_id: repository_id.into(),
        checkout_path: checkout_path.to_string_lossy().into_owned(),
        checkout_mode,
        branch: branch.into(),
        verification_status: VerificationStatus::Verified,
        created_at: CREATED,
    }
}

fn bind(store: &ManagementStore, task_id: &str, repo_id: &str, branch: &str, path: &Path) {
    store
        .validate_and_save_task_repository_binding(&TaskRepositoryBinding {
            task_id: task_id.into(),
            repository_id: repo_id.into(),
            branch: branch.into(),
            worktree_path: path.to_string_lossy().into_owned(),
            setup_status: RepositorySetupStatus::Ready,
            error_code: None,
            error_detail: None,
            created_at: CREATED + 2,
            updated_at: CREATED + 2,
        })
        .unwrap();
}

#[test]
fn i02_git_path_fixture_reports_canonical_ownership_and_non_destructive_cleanup() {
    let fixture = tempdir().unwrap();
    let user_home = fixture.path().join("user-home");
    fs::create_dir(&user_home).unwrap();
    let temp_root = fixture.path().join("system-temp");
    let store = ManagementStore::in_memory_with_paths(&user_home, &temp_root).unwrap();
    let project_root = user_home.join("Projects with spaces");
    assert!(!project_root.exists());
    store
        .set_project_home_root(project_root.to_str().unwrap(), CREATED)
        .unwrap();
    assert!(!project_root.exists());

    let workspace_slug = store
        .suggest_workspace_slug("I-02 Fixture Workspace")
        .unwrap();
    let workspace = store
        .create_workspace(&NewWorkspace {
            id: "workspace-i02".into(),
            name: "I-02 Fixture Workspace".into(),
            slug: workspace_slug,
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: CREATED,
        })
        .unwrap();
    assert_eq!(
        store
            .create_workspace(&NewWorkspace {
                id: workspace.id.clone(),
                name: workspace.name.clone(),
                slug: workspace.slug.clone(),
                description: workspace.description.clone(),
                kind: WorkspaceKind::Regular,
                created_at: workspace.created_at,
            })
            .unwrap(),
        workspace
    );
    let canonical_project_root = fs::canonicalize(&project_root).unwrap();
    assert!(Path::new(&workspace.home_path).starts_with(&canonical_project_root));
    for folder in ["notes", "repos", "tasks"] {
        assert!(Path::new(&workspace.home_path).join(folder).is_dir());
    }

    // Both root-setting APIs reject outside-home and traversal paths before
    // persisting a value or creating a candidate directory.
    let configured_root = store.project_home_root().unwrap();
    let configured_setting = store.get_setting("project_home_root").unwrap().unwrap();
    let workspace_count = store.list_workspaces().unwrap().len();
    let outside_root = fixture.path().join("outside-project-home");
    assert!(store
        .set_project_home_root(outside_root.to_str().unwrap(), CREATED + 1)
        .is_err());
    assert!(store
        .set_setting(
            "project_home_root",
            outside_root.to_str().unwrap(),
            CREATED + 1
        )
        .is_err());
    let traversal_root = format!("{}/../traversal-project-home", user_home.display());
    assert!(store
        .set_setting("project_home_root", &traversal_root, CREATED + 1)
        .is_err());
    assert!(!outside_root.exists());
    assert!(!fixture.path().join("traversal-project-home").exists());
    assert_eq!(store.project_home_root().unwrap(), configured_root);
    assert_eq!(
        store.get_setting("project_home_root").unwrap(),
        Some(configured_setting)
    );
    assert_eq!(store.list_workspaces().unwrap().len(), workspace_count);
    println!(
        "outside/traversal configured roots: REJECTED path_exists={} prior_setting_preserved={}",
        outside_root.exists(),
        store.project_home_root().unwrap() == configured_root
    );

    let traversal = store.create_workspace(&NewWorkspace {
        id: "workspace-traversal".into(),
        name: "Traversal must fail".into(),
        slug: "../escape".into(),
        description: None,
        kind: WorkspaceKind::Regular,
        created_at: CREATED + 2,
    });
    assert!(traversal.is_err());
    assert!(store
        .get_workspace("workspace-traversal")
        .unwrap()
        .is_none());
    println!("traversal slug: REJECTED workspace_record_exists=false");

    let repo_a = fixture.path().join("external/repos/repository-a");
    let repo_b = fixture.path().join("external/repos/repository-b");
    init_repository(&repo_a);
    init_repository(&repo_b);
    let repo_a_record = store
        .catalog_selected_repository(
            "repo-a",
            "Repository A",
            &repo_a,
            Some("first fixture"),
            CREATED,
        )
        .unwrap();
    let repo_b_record = store
        .catalog_selected_repository("repo-b", "Repository B", &repo_b, None, CREATED)
        .unwrap();
    assert_eq!(
        inspect_repository(&repo_a)
            .unwrap()
            .repository
            .default_branch
            .as_deref(),
        Some("main")
    );

    // Bind an existing main checkout and a managed main worktree. Feature
    // branches are current and valid Git branches, but not workspace roots.
    git_ok(&repo_b, &["branch", "feature"]);
    git_ok(&repo_b, &["checkout", "--quiet", "feature"]);
    let managed_main = Path::new(&workspace.home_path).join("repos/repository-b");
    add_existing_branch_worktree(&repo_b, &managed_main, "main");
    git_ok(&repo_b, &["branch", "feature-managed"]);
    let managed_feature = Path::new(&workspace.home_path).join("repos/repository-b-feature");
    add_existing_branch_worktree(&repo_b, &managed_feature, "feature-managed");

    store
        .validate_and_save_workspace_repository_binding(&workspace_binding(
            &workspace.id,
            "repo-a",
            &repo_a,
            CheckoutMode::Existing,
            "main",
        ))
        .unwrap();
    store
        .validate_and_save_workspace_repository_binding(&workspace_binding(
            &workspace.id,
            "repo-b",
            &managed_main,
            CheckoutMode::Managed,
            "main",
        ))
        .unwrap();
    let rejected_existing_feature =
        store.validate_and_save_workspace_repository_binding(&workspace_binding(
            &workspace.id,
            "repo-b",
            &repo_b,
            CheckoutMode::Existing,
            "feature",
        ));
    assert!(rejected_existing_feature.is_err());
    let rejected_managed_feature =
        store.validate_and_save_workspace_repository_binding(&workspace_binding(
            &workspace.id,
            "repo-b",
            &managed_feature,
            CheckoutMode::Managed,
            "feature-managed",
        ));
    assert!(rejected_managed_feature.is_err());
    assert_eq!(
        store
            .list_workspace_repository_bindings(&workspace.id)
            .unwrap()
            .iter()
            .map(|binding| binding.repository_id.as_str())
            .collect::<Vec<_>>(),
        vec!["repo-a", "repo-b"]
    );
    println!("workspace bindings: existing_main=ACCEPTED managed_main=ACCEPTED existing_feature=REJECTED managed_feature=REJECTED");

    // Without a symbolic canonical default, even a current `main` branch is
    // insufficient evidence to create a workspace binding.
    let repo_without_default = fixture.path().join("external/repos/no-default");
    init_repository(&repo_without_default);
    git_ok(
        &repo_without_default,
        &["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"],
    );
    let no_default_record = store
        .catalog_selected_repository(
            "repo-no-default",
            "Repository without default metadata",
            &repo_without_default,
            None,
            CREATED,
        )
        .unwrap();
    assert_eq!(
        inspect_repository(&repo_without_default)
            .unwrap()
            .repository
            .default_branch,
        None
    );
    assert!(store
        .validate_and_save_workspace_repository_binding(&workspace_binding(
            &workspace.id,
            &no_default_record.id,
            &repo_without_default,
            CheckoutMode::Existing,
            "main",
        ))
        .is_err());
    assert_eq!(
        store
            .list_workspace_repository_bindings(&workspace.id)
            .unwrap()
            .len(),
        2
    );
    assert!(store.inspect_repository_for_use(&repo_a, None).is_err());
    let selected_external = store
        .inspect_repository_for_use(&repo_a, Some("repo-a"))
        .unwrap();
    assert_eq!(
        selected_external.repository.canonical_root,
        fs::canonicalize(&repo_a).unwrap()
    );
    assert!(store
        .inspect_repository_for_use(&repo_b, Some("repo-a"))
        .is_err());
    println!(
        "repository ownership: selected_external=ACCEPTED path={} identity={} unselected_external=REJECTED catalog_path_mismatch=REJECTED",
        selected_external.repository.canonical_root.display(),
        selected_external.repository.identity
    );

    // A project-home symlink cannot redirect a generated workspace outside the
    // configured root.
    #[cfg(unix)]
    {
        let escape_link = project_root.join("symlink-escape");
        std::os::unix::fs::symlink(&repo_a, &escape_link).unwrap();
        let escaped = store.create_workspace(&NewWorkspace {
            id: "workspace-symlink-escape".into(),
            name: "Symlink escape must fail".into(),
            slug: "symlink-escape".into(),
            description: None,
            kind: WorkspaceKind::Regular,
            created_at: CREATED + 3,
        });
        assert!(escaped.is_err());
        assert!(store
            .get_workspace("workspace-symlink-escape")
            .unwrap()
            .is_none());
        println!("workspace symlink escape: REJECTED workspace_record_exists=false");
    }

    // Name-derived slugs are stable and collisions use deterministic numeric
    // suffixes while retaining the original display names.
    let clean_task = task(&store, &workspace.id, "task-clean", "Sync API");
    let dirty_task = task(&store, &workspace.id, "task-dirty", "Keep dirty changes");
    let in_use_task = task(&store, &workspace.id, "task-in-use", "Defer while active");
    let multi_task = task(&store, &workspace.id, "task-multi", "Multiple repositories");
    let repeated_name_slug = store.suggest_task_slug(&workspace.id, "Sync API").unwrap();
    assert_eq!(
        store
            .create_task(&NewTask {
                id: clean_task.id.clone(),
                workspace_id: clean_task.workspace_id.clone(),
                name: clean_task.name.clone(),
                slug: clean_task.slug.clone(),
                description: clean_task.description.clone(),
                setup_status: clean_task.setup_status,
                created_at: clean_task.created_at,
            })
            .unwrap(),
        clean_task
    );
    assert_eq!(clean_task.slug, "sync-api");
    assert_eq!(repeated_name_slug, "sync-api-2");
    assert_eq!(clean_task.name, "Sync API");
    for task_record in [&clean_task, &dirty_task, &in_use_task, &multi_task] {
        assert!(Path::new(&task_record.home_path).starts_with(&canonical_project_root));
        assert!(Path::new(&task_record.home_path).join("notes").is_dir());
        assert!(Path::new(&task_record.home_path).join("worktrees").is_dir());
    }

    let clean_worktree = Path::new(&clean_task.home_path).join("worktrees/repository-a");
    let dirty_worktree = Path::new(&dirty_task.home_path).join("worktrees/repository-a");
    let in_use_worktree = Path::new(&in_use_task.home_path).join("worktrees/repository-a");
    add_worktree(&repo_a, &clean_worktree, "task/clean");
    add_worktree(&repo_a, &dirty_worktree, "task/dirty");
    add_worktree(&repo_a, &in_use_worktree, "task/in-use");
    bind(
        &store,
        &clean_task.id,
        "repo-a",
        "task/clean",
        &clean_worktree,
    );
    bind(
        &store,
        &dirty_task.id,
        "repo-a",
        "task/dirty",
        &dirty_worktree,
    );
    bind(
        &store,
        &in_use_task.id,
        "repo-a",
        "task/in-use",
        &in_use_worktree,
    );
    fs::write(
        dirty_worktree.join("README.md"),
        "modified tracked content\n",
    )
    .unwrap();
    fs::write(dirty_worktree.join("new-untracked.txt"), "keep this file\n").unwrap();
    fs::write(
        dirty_worktree.join("ignored-file.txt"),
        "also keep this file\n",
    )
    .unwrap();
    store
        .create_session(&NewSession {
            open_code_session_id: "session-active-in-use".into(),
            owner: SessionOwner::Task(in_use_task.id.clone()),
            directory: in_use_worktree.to_string_lossy().into_owned(),
            last_known_status: "running".into(),
            created_at: CREATED + 3,
        })
        .unwrap();
    store.complete_task(&clean_task.id, CREATED + 20).unwrap();
    store.complete_task(&dirty_task.id, CREATED + 20).unwrap();
    store.complete_task(&in_use_task.id, CREATED + 20).unwrap();

    // Simulate a worker crash after claiming the clean job. Startup recovery
    // requeues the claim and leaves the worktree untouched until the worker
    // runs the guarded removal path.
    let clean_job = store
        .create_cleanup_job(&NewCleanupJob {
            id: "cleanup-clean".into(),
            task_id: clean_task.id.clone(),
            repository_id: "repo-a".into(),
            worktree_path: clean_worktree.to_string_lossy().into_owned(),
            state: CleanupJobState::Queued,
            created_at: CREATED + 20,
        })
        .unwrap();
    let mut claimed = clean_job.clone();
    claimed.state = CleanupJobState::Running;
    claimed.attempts = 1;
    claimed.last_attempt_at = Some(CREATED + 21);
    claimed.updated_at = CREATED + 21;
    store.update_cleanup_job(&claimed).unwrap();
    assert_eq!(
        store.recover_stale_cleanup_jobs(CREATED + 30_000).unwrap(),
        1
    );
    let recovered = store.get_cleanup_job(&clean_job.id).unwrap().unwrap();
    assert_eq!(recovered.state, CleanupJobState::Queued);
    assert_eq!(recovered.attempts, 2);
    assert!(recovered
        .deferral_reason
        .as_deref()
        .unwrap()
        .contains("worker restart"));

    // The second catalog repository is attached to the same task, proving the
    // model supports multiple repositories in one task.
    let multi_a = Path::new(&multi_task.home_path).join("worktrees/repository-a");
    let multi_b = Path::new(&multi_task.home_path).join("worktrees/repository-b");
    add_worktree(&repo_a, &multi_a, "task/multi-a");
    add_worktree(&repo_b, &multi_b, "task/multi-b");
    bind(&store, &multi_task.id, "repo-a", "task/multi-a", &multi_a);
    bind(&store, &multi_task.id, "repo-b", "task/multi-b", &multi_b);
    assert_eq!(
        store
            .list_task_repository_bindings(&multi_task.id)
            .unwrap()
            .len(),
        2
    );
    store
        .create_session(&NewSession {
            open_code_session_id: "session-terminal-task-home".into(),
            owner: SessionOwner::Task(multi_task.id.clone()),
            directory: multi_task.home_path.clone(),
            last_known_status: "completed".into(),
            created_at: CREATED + 4,
        })
        .unwrap();
    store.complete_task(&multi_task.id, CREATED + 20).unwrap();

    // Git refuses to check the same branch out in another worktree; branch
    // inspection reports its one current owner without changing repository state.
    let collision_path = Path::new(&multi_task.home_path).join("worktrees/branch-collision");
    fs::create_dir_all(collision_path.parent().unwrap()).unwrap();
    let collision = git(
        &repo_a,
        &[
            "worktree",
            "add",
            "--quiet",
            collision_path.to_str().unwrap(),
            "task/clean",
        ],
    );
    assert!(!collision.status.success());
    let branch_info = inspect_branch(&repo_a, "task/clean").unwrap();
    assert!(branch_info.valid && branch_info.exists);
    assert_eq!(
        branch_info.owning_worktrees,
        vec![fs::canonicalize(&clean_worktree).unwrap()]
    );
    assert!(!inspect_branch(&repo_a, "bad branch").unwrap().valid);
    println!(
        "branch task/clean: valid={} exists={} owner={} duplicate_checkout=REJECTED invalid_branch=REJECTED",
        branch_info.valid,
        branch_info.exists,
        branch_info.owning_worktrees[0].display()
    );

    // A Git worktree from another repository cannot be claimed under repo A,
    // and a repo-A worktree outside this task's worktrees/ directory is rejected.
    let wrong_identity_task = task(
        &store,
        &workspace.id,
        "task-wrong-identity",
        "Wrong identity",
    );
    let wrong_identity_path = Path::new(&wrong_identity_task.home_path).join("worktrees/wrong");
    add_worktree(&repo_b, &wrong_identity_path, "task/wrong-identity");
    let wrong_identity = store.validate_and_save_task_repository_binding(&TaskRepositoryBinding {
        task_id: wrong_identity_task.id.clone(),
        repository_id: "repo-a".into(),
        branch: "task/wrong-identity".into(),
        worktree_path: wrong_identity_path.to_string_lossy().into_owned(),
        setup_status: RepositorySetupStatus::Ready,
        error_code: None,
        error_detail: None,
        created_at: CREATED + 5,
        updated_at: CREATED + 5,
    });
    assert!(wrong_identity.is_err());
    assert!(store
        .list_task_repository_bindings(&wrong_identity_task.id)
        .unwrap()
        .is_empty());
    println!("wrong repository identity: REJECTED binding_record_exists=false");

    let outside_worktree = fixture.path().join("outside-worktree");
    add_worktree(&repo_a, &outside_worktree, "task/outside");
    let outside_task = task(
        &store,
        &workspace.id,
        "task-outside-worktree",
        "Outside worktree",
    );
    let outside_binding = store.validate_and_save_task_repository_binding(&TaskRepositoryBinding {
        task_id: outside_task.id.clone(),
        repository_id: "repo-a".into(),
        branch: "task/outside".into(),
        worktree_path: outside_worktree.to_string_lossy().into_owned(),
        setup_status: RepositorySetupStatus::Ready,
        error_code: None,
        error_detail: None,
        created_at: CREATED + 6,
        updated_at: CREATED + 6,
    });
    assert!(outside_binding.is_err());
    assert!(store
        .list_task_repository_bindings(&outside_task.id)
        .unwrap()
        .is_empty());
    println!("worktree outside task worktrees/: REJECTED binding_record_exists=false");

    let clean_plan = store
        .plan_completed_task_cleanup(&clean_task.id, "repo-a", &[])
        .unwrap();
    let dirty_plan = store
        .plan_completed_task_cleanup(&dirty_task.id, "repo-a", &[])
        .unwrap();
    let in_use_plan = store
        .plan_completed_task_cleanup(&in_use_task.id, "repo-a", &[])
        .unwrap();
    let removed = store
        .execute_cleanup_job(&clean_job.id, &[], CREATED + 40_000)
        .unwrap();
    assert_eq!(removed.state, CleanupJobState::Removed);
    assert!(!clean_worktree.exists());
    assert!(git(
        &repo_a,
        &["show-ref", "--verify", "--quiet", "refs/heads/task/clean"]
    )
    .status
    .success());
    assert_eq!(
        store
            .execute_cleanup_job(&clean_job.id, &[], CREATED + 40_001)
            .unwrap()
            .state,
        CleanupJobState::Removed
    );
    let dirty_job = store
        .create_cleanup_job(&NewCleanupJob {
            id: "cleanup-dirty".into(),
            task_id: dirty_task.id.clone(),
            repository_id: "repo-a".into(),
            worktree_path: dirty_worktree.to_string_lossy().into_owned(),
            state: CleanupJobState::Queued,
            created_at: CREATED + 20,
        })
        .unwrap();
    assert_eq!(
        store
            .execute_cleanup_job(&dirty_job.id, &[], CREATED + 40_002)
            .unwrap()
            .state,
        CleanupJobState::Retained
    );
    let in_use_job = store
        .create_cleanup_job(&NewCleanupJob {
            id: "cleanup-in-use".into(),
            task_id: in_use_task.id.clone(),
            repository_id: "repo-a".into(),
            worktree_path: in_use_worktree.to_string_lossy().into_owned(),
            state: CleanupJobState::Queued,
            created_at: CREATED + 20,
        })
        .unwrap();
    assert_eq!(
        store
            .execute_cleanup_job(
                &in_use_job.id,
                std::slice::from_ref(&in_use_worktree),
                CREATED + 40_003
            )
            .unwrap()
            .state,
        CleanupJobState::Deferred
    );
    let task_home_runtime = Path::new(&multi_task.home_path).to_path_buf();
    let task_home_plan_a = store
        .plan_completed_task_cleanup(&multi_task.id, "repo-a", &[task_home_runtime.clone()])
        .unwrap();
    let task_home_plan_b = store
        .plan_completed_task_cleanup(&multi_task.id, "repo-b", &[task_home_runtime])
        .unwrap();
    let exact_worktree_plan_a = store
        .plan_completed_task_cleanup(&multi_task.id, "repo-a", &[multi_a.clone()])
        .unwrap();
    let exact_worktree_plan_b = store
        .plan_completed_task_cleanup(&multi_task.id, "repo-b", &[multi_a.clone()])
        .unwrap();
    assert!(matches!(clean_plan, CleanupPlan::Removable { .. }));
    assert!(matches!(dirty_plan, CleanupPlan::Retained { .. }));
    assert!(matches!(in_use_plan, CleanupPlan::Deferred { .. }));
    assert!(matches!(task_home_plan_a, CleanupPlan::Deferred { .. }));
    assert!(matches!(task_home_plan_b, CleanupPlan::Deferred { .. }));
    assert!(matches!(
        exact_worktree_plan_a,
        CleanupPlan::Deferred { .. }
    ));
    assert!(matches!(
        exact_worktree_plan_b,
        CleanupPlan::Removable { .. }
    ));
    assert_eq!(
        dirty_plan,
        store
            .plan_completed_task_cleanup(&dirty_task.id, "repo-a", &[])
            .unwrap()
    );
    assert_eq!(
        in_use_plan,
        store
            .plan_completed_task_cleanup(&in_use_task.id, "repo-a", &[])
            .unwrap()
    );
    println!("cleanup clean-unused: {clean_plan:?}");
    println!("cleanup dirty-and-untracked: {dirty_plan:?}");
    println!("cleanup in-use: {in_use_plan:?}");
    println!("terminal session at task home defers every worktree: repo-a={task_home_plan_a:?} repo-b={task_home_plan_b:?}");
    println!("exact worktree runtime defers only its worktree: repo-a={exact_worktree_plan_a:?} repo-b={exact_worktree_plan_b:?}");

    // Planner/inspection calls are read-only: branch refs, registrations,
    // status records, and the dirty/untracked file survive repeated calls.
    let before = inspect_repository(&repo_a).unwrap();
    let before_status = git_ok(
        &dirty_worktree,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )
    .stdout;
    for _ in 0..2 {
        let _ = store
            .plan_completed_task_cleanup(&clean_task.id, "repo-a", &[])
            .unwrap();
        let _ = store
            .plan_completed_task_cleanup(&dirty_task.id, "repo-a", &[])
            .unwrap();
        let _ = store
            .plan_completed_task_cleanup(&in_use_task.id, "repo-a", &[])
            .unwrap();
        let _ = store
            .plan_completed_task_cleanup(
                &multi_task.id,
                "repo-a",
                &[Path::new(&multi_task.home_path).to_path_buf()],
            )
            .unwrap();
        let _ = store
            .plan_completed_task_cleanup(
                &multi_task.id,
                "repo-b",
                &[Path::new(&multi_task.home_path).to_path_buf()],
            )
            .unwrap();
    }
    let after = inspect_repository(&repo_a).unwrap();
    let after_status = git_ok(
        &dirty_worktree,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )
    .stdout;
    assert_eq!(before, after);
    assert_eq!(before_status, after_status);
    assert!(dirty_worktree.join("new-untracked.txt").is_file());
    assert!(dirty_worktree.join("ignored-file.txt").is_file());
    assert!(after
        .worktrees
        .iter()
        .find(|worktree| worktree.canonical_path == fs::canonicalize(&dirty_worktree).unwrap())
        .unwrap()
        .status_entries
        .iter()
        .any(|entry| entry.starts_with("!! ignored-file.txt")));
    assert!(git(
        &repo_a,
        &["show-ref", "--verify", "--quiet", "refs/heads/task/clean"]
    )
    .status
    .success());
    assert!(git(
        &repo_a,
        &["show-ref", "--verify", "--quiet", "refs/heads/task/dirty"]
    )
    .status
    .success());
    assert!(git(
        &repo_a,
        &["show-ref", "--verify", "--quiet", "refs/heads/task/in-use"]
    )
    .status
    .success());
    println!(
        "inspected repository: canonical_root={} identity={} worktrees={} (before == after: {})",
        after.repository.canonical_root.display(),
        after.repository.identity,
        after.worktrees.len(),
        before == after
    );
    println!(
        "workspace/task roots: project={} workspace={} clean_task={} dirty_task={} in_use_task={}",
        canonical_project_root.display(),
        workspace.home_path,
        clean_task.home_path,
        dirty_task.home_path,
        in_use_task.home_path
    );
    for workspace_record in store.list_workspaces().unwrap() {
        if workspace_record.kind == WorkspaceKind::Regular {
            let canonical = fs::canonicalize(&workspace_record.home_path).unwrap();
            println!(
                "workspace path: id={} canonical={}",
                workspace_record.id,
                canonical.display()
            );
            assert!(canonical.starts_with(&canonical_project_root));
            for task_record in store.list_tasks(&workspace_record.id).unwrap() {
                let canonical_task = fs::canonicalize(&task_record.home_path).unwrap();
                println!(
                    "task path: id={} canonical={}",
                    task_record.id,
                    canonical_task.display()
                );
                assert!(canonical_task.starts_with(&canonical_project_root));
            }
        }
    }
    assert_eq!(
        repo_a_record.repository_identity,
        selected_external.repository.identity
    );
    assert_ne!(
        repo_a_record.repository_identity,
        repo_b_record.repository_identity
    );
}
