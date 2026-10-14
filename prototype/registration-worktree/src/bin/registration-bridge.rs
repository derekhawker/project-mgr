use registration_worktree_prototype::{exchange_registration_report, RegistrationBoundary};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(path)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn main() {
    let command: Vec<String> = std::env::args().skip(1).collect();
    if command.is_empty() {
        eprintln!("usage: registration-bridge <child-command> [args...]");
        std::process::exit(2);
    }
    let root = std::env::temp_dir().join(format!(
        "registration-bridge-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let alpha = root.join("alpha");
    let beta = root.join("beta");
    let task_root = root.join("task");
    let alpha_worktree = task_root.join("alpha");
    let beta_worktree = task_root.join("beta");
    fs::create_dir_all(&task_root).unwrap();
    for (repo, name) in [(&alpha, "alpha"), (&beta, "beta")] {
        fs::create_dir_all(repo).unwrap();
        git(repo, &["init", "-q", "-b", "main"]);
        git(repo, &["config", "user.name", "registration fixture"]);
        git(repo, &["config", "user.email", "fixture@example.invalid"]);
        fs::write(repo.join("README"), name).unwrap();
        git(repo, &["add", "README"]);
        git(repo, &["commit", "-qm", "initial"]);
    }
    fs::create_dir_all(&alpha_worktree).unwrap();
    fs::create_dir_all(&beta_worktree).unwrap();
    git(
        &alpha,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "task-alpha",
            alpha_worktree.to_str().unwrap(),
            "main",
        ],
    );
    git(
        &beta,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "task-beta",
            beta_worktree.to_str().unwrap(),
            "main",
        ],
    );

    let mut boundary = RegistrationBoundary::new();
    let alpha_record = boundary.register_repository("repo-alpha", &alpha).unwrap();
    let beta_record = boundary.register_repository("repo-beta", &beta).unwrap();
    boundary.register_workspace("workspace-1").unwrap();
    boundary
        .register_task("workspace-1", "task-1", &task_root)
        .unwrap();
    boundary
        .register_session("workspace-1", "task-1", "session-1")
        .unwrap();
    let request = json!({"workspace_id":"workspace-1", "task_id":"task-1", "session_id":"session-1", "repositories":[alpha_record,beta_record], "worktrees":[alpha_worktree,beta_worktree]});
    match exchange_registration_report(&mut boundary, &command, &request) {
        Ok(result) => println!("{result}"),
        Err(error) => {
            eprintln!("{}", serde_json::to_string(&error).unwrap());
            std::process::exit(1);
        }
    }
    let _ = fs::remove_dir_all(root);
}
