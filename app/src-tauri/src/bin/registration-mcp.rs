//! Production stdio MCP adapter for the app-owned registration boundary.
//! It owns no conversation state; every mutation goes through SQLite/Rust.
use opencode_project_manager_lib::management::{ManagementStore, RegistrationReport};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

fn reply(id: &Value, result: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"result":result})
}
fn error(id: &Value, message: impl Into<String>) -> Value {
    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":message.into()}})
}
fn schema() -> Value {
    json!({
        "name":"register_task_setup",
        "description":"Report validated task repository setup to the app-owned Rust boundary. The operation_id and session_id must be the explicit identities supplied when task setup started. Replaying an identical operation is safe; changing its content is an error.",
        "inputSchema":{
            "type":"object", "additionalProperties":false,
            "required":["operation_id","workspace_id","task_id","session_id","items"],
            "properties":{
                "operation_id":{"type":"string","minLength":1},
                "workspace_id":{"type":"string","minLength":1},
                "task_id":{"type":"string","minLength":1},
                "session_id":{"type":"string","minLength":1},
                "items":{"type":"array","minItems":1,"items":{
                    "type":"object","additionalProperties":false,
                    "required":["item_id","repository_id","repository_path","git_identity","result"],
                    "properties":{
                        "item_id":{"type":"string","minLength":1},
                        "repository_id":{"type":"string","minLength":1},
                        "repository_path":{"type":"string","minLength":1},
                        "git_identity":{"type":"string","minLength":1},
                        "branch":{"type":["string","null"]},
                        "worktree_path":{"type":["string","null"]},
                        "result":{"type":"string","enum":["ready","failed","not_attempted"]},
                        "error_code":{"type":["string","null"]},
                        "detail":{"type":["string","null"]}
                    },
                    "allOf":[{"if":{"properties":{"result":{"enum":["failed","not_attempted"]}}},"then":{"required":["error_code","detail"]}},{"if":{"properties":{"result":{"const":"ready"}}},"then":{"required":["branch","worktree_path"]}}]
                }}
            }
        },
        "resultSchema":{"type":"object","required":["operation_id","workspace_id","task_id","session_id","replayed","items"],"properties":{"operation_id":{"type":"string"},"workspace_id":{"type":"string"},"task_id":{"type":"string"},"session_id":{"type":"string"},"replayed":{"type":"boolean"},"items":{"type":"array","items":{"type":"object","required":["item_id","repository_id","repository_path","git_identity","result"],"properties":{"item_id":{"type":"string"},"repository_id":{"type":"string"},"repository_path":{"type":"string"},"git_identity":{"type":"string"},"branch":{"type":["string","null"]},"worktree_path":{"type":["string","null"]},"result":{"type":"string","enum":["ready","failed","not_attempted"]},"error_code":{"type":["string","null"]},"detail":{"type":["string","null"]}}}}}}
    })
}
fn main() {
    let mut args = std::env::args().skip(1);
    let Some(database) = args.next() else {
        eprintln!("usage: registration-mcp DATABASE USER_HOME TEMP_DIR");
        return;
    };
    let user_home = args
        .next()
        .unwrap_or_else(|| std::env::var("HOME").unwrap_or_default());
    let temp = args
        .next()
        .unwrap_or_else(|| std::env::temp_dir().display().to_string());
    let store = match ManagementStore::open_with_paths(database, user_home, temp) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("{error}");
            return;
        }
    };
    let stdout = io::stdout();
    let mut output = stdout.lock();
    for line in io::stdin().lock().lines().flatten() {
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(parse_error) => {
                let _ = writeln!(output, "{}", error(&Value::Null, parse_error.to_string()));
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let response = match request.get("method").and_then(Value::as_str) {
            Some("initialize") => reply(
                &id,
                json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"project-mgr-registration","version":"0.1.0"}}),
            ),
            Some("notifications/initialized") => continue,
            Some("tools/list") => reply(&id, json!({"tools":[schema()]})),
            Some("tools/call") => {
                let params = request.get("params").and_then(Value::as_object);
                if params.and_then(|p| p.get("name")).and_then(Value::as_str)
                    != Some("register_task_setup")
                {
                    error(&id, "unknown tool")
                } else {
                    match params
                        .and_then(|p| p.get("arguments"))
                        .cloned()
                        .and_then(|v| serde_json::from_value::<RegistrationReport>(v).ok())
                    {
                        Some(report) => match store.apply_registration_report(&report) {
                            Ok(result) => reply(
                                &id,
                                json!({"isError":false,"content":[{"type":"text","text":serde_json::to_string(&result).unwrap()}]}),
                            ),
                            Err(error) => reply(
                                &id,
                                json!({"isError":true,"content":[{"type":"text","text":error.to_string()}]}),
                            ),
                        },
                        None => error(&id, "malformed registration arguments"),
                    }
                }
            }
            Some(method) => error(&id, format!("method not found: {method}")),
            None => error(&id, "request method is required"),
        };
        let _ = writeln!(output, "{}", response);
        let _ = output.flush();
    }
}
