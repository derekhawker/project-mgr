use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

static NEXT: AtomicU64 = AtomicU64::new(0);

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .args(args)
        .current_dir(cwd)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn fixture() -> (PathBuf, PathBuf, PathBuf, String) {
    let root = std::env::temp_dir().join(format!(
        "mcp-protocol-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    let repo = root.join("repo");
    let task_root = root.join("task");
    let worktree = task_root.join("repo");
    fs::create_dir_all(&repo).unwrap();
    fs::create_dir_all(&task_root).unwrap();
    git(&repo, &["init", "-q", "-b", "main"]);
    git(&repo, &["config", "user.name", "MCP test"]);
    git(&repo, &["config", "user.email", "mcp@example.invalid"]);
    fs::write(repo.join("README"), "fixture").unwrap();
    git(&repo, &["add", "README"]);
    git(&repo, &["commit", "-qm", "initial"]);
    git(
        &repo,
        &[
            "worktree",
            "add",
            "-q",
            "-b",
            "task-branch",
            worktree.to_str().unwrap(),
            "main",
        ],
    );
    let context = root.join("context.json");
    let identity = repo.join(".git").to_string_lossy().into_owned();
    fs::write(
        &context,
        serde_json::to_vec(&json!({
            "workspace_id":"workspace-1", "task_id":"task-1", "session_id":"session-1",
            "task_root":task_root, "repositories":[{"repository_id":"repo-1", "path":repo}]
        }))
        .unwrap(),
    )
    .unwrap();
    (root, worktree, context, identity)
}

fn call(id: i64, args: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":"register_task_setup","arguments":args}})
}

#[test]
fn mcp_discovery_call_and_validation_are_json_rpc_compatible() {
    let (root, worktree, context, identity) = fixture();
    let binary = env!("CARGO_BIN_EXE_registration-mcp");
    let mut child = Command::new(binary)
        .args(["--context", context.to_str().unwrap()])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let ready = json!({"item_id":"ready","repository_id":"repo-1","repository_path":root.join("repo"),"git_identity":identity,"branch":"task-branch","worktree_path":worktree,"result":"ready","error_code":null,"detail":null});
    let failed = json!({"item_id":"failed","repository_id":"repo-1","repository_path":root.join("repo"),"git_identity":identity,"branch":null,"worktree_path":null,"result":"failed","error_code":"branch_creation_failed","detail":"setup stopped"});
    let requests = vec![
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
        call(
            3,
            // A parse failure must not reserve the operation ID or mutate the boundary.
            json!({"operation_id":"setup-1","workspace_id":"workspace-1"}),
        ),
        call(
            4,
            json!({"operation_id":"wrong-owner","workspace_id":"workspace-1","task_id":"task-1","session_id":"other-session","items":[]}),
        ),
        call(
            5,
            json!({"operation_id":"setup-1","workspace_id":"workspace-1","task_id":"task-1","session_id":"session-1","items":[ready,failed]}),
        ),
    ];
    let stdin = child.stdin.as_mut().unwrap();
    for request in requests {
        writeln!(stdin, "{}", request).unwrap();
    }
    drop(child.stdin.take());
    let mut stdout = String::new();
    child
        .stdout
        .take()
        .unwrap()
        .read_to_string(&mut stdout)
        .unwrap();
    assert!(child.wait().unwrap().success());
    let responses: Vec<Value> = stdout
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(responses.len(), 5);
    assert_eq!(
        responses[0]["result"]["serverInfo"]["name"],
        "project-mgr-registration"
    );
    assert_eq!(
        responses[1]["result"]["tools"][0]["name"],
        "register_task_setup"
    );
    assert_eq!(responses[2]["result"]["isError"], true);
    assert_eq!(
        responses[2]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("malformed_arguments"),
        true
    );
    assert_eq!(responses[3]["result"]["isError"], true);
    assert_eq!(
        responses[3]["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("caller_session_not_found"),
        true
    );
    assert_eq!(responses[4]["result"]["isError"], false);
    let result: Value = serde_json::from_str(
        responses[4]["result"]["content"][0]["text"]
            .as_str()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(result["items"].as_array().unwrap().len(), 2);
    assert_eq!(result["items"][0]["result"], "ready");
    assert_eq!(result["items"][1]["result"], "failed");
    fs::remove_dir_all(root).unwrap();
}
