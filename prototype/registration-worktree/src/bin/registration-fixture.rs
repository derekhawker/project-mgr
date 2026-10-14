use serde_json::{json, Value};
use std::io::{self, Read};

fn main() {
    let mut input = String::new();
    io::stdin()
        .read_to_string(&mut input)
        .expect("read request");
    let request: Value = serde_json::from_str(&input).expect("request is JSON");
    let item = |id: &str,
                repo: &Value,
                branch: Option<&str>,
                worktree: Option<&str>,
                result: &str,
                code: Option<&str>,
                detail: Option<&str>| {
        json!({
            "item_id": id, "repository_id": repo["repository_id"],
            "repository_path": repo["canonical_path"], "git_identity": repo["git_identity"],
            "branch": branch, "worktree_path": worktree, "result": result,
            "error_code": code, "detail": detail
        })
    };
    let alpha = &request["repositories"][0];
    let beta = &request["repositories"][1];
    let report = json!({
        "operation_id": "child-fixture-operation",
        "workspace_id": request["workspace_id"], "task_id": request["task_id"],
        "session_id": request["session_id"],
        "items": [
            item("alpha-ready", alpha, Some("task-alpha"), Some(request["worktrees"][0].as_str().unwrap()), "ready", None, None),
            item("beta-invalid", beta, Some("missing-branch"), Some(request["worktrees"][1].as_str().unwrap()), "ready", None, None),
            item("beta-failed", beta, None, None, "failed", Some("branch_creation_failed"), Some("The setup command could not create the branch.")),
            item("beta-not-attempted", beta, None, None, "not_attempted", Some("not_attempted"), Some("Setup stopped after the preceding failure."))
        ]
    });
    println!("{}", serde_json::to_string(&report).unwrap());
}
