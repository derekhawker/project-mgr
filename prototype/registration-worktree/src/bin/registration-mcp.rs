//! A small newline-delimited JSON-RPC MCP server for OpenCode.
//!
//! The server owns no OpenCode process or history.  It only adapts MCP calls
//! to the existing RegistrationBoundary.  A context file supplies the
//! application-owned records for this disposable prototype.

use registration_worktree_prototype::{BoundaryError, RegistrationBoundary, RegistrationReport};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::{self, BufRead, Write};
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Context {
    workspace_id: String,
    task_id: String,
    session_id: String,
    task_root: String,
    repositories: Vec<ContextRepository>,
}

#[derive(Debug, Deserialize)]
struct ContextRepository {
    repository_id: String,
    path: String,
}

fn error(code: i64, message: impl Into<String>, id: Option<&Value>) -> Value {
    json!({"jsonrpc":"2.0", "id":id.cloned().unwrap_or(Value::Null),
        "error":{"code":code,"message":message.into()}})
}

fn tool_error(error: BoundaryError) -> Value {
    json!({"isError":true,"content":[{"type":"text",
        "text":serde_json::to_string(&json!({"error":error})).unwrap()}]})
}

fn tool_schema() -> Value {
    json!({
        "name":"register_task_setup",
        "description":"Report OpenCode task repository/branch/worktree setup to the Rust ownership boundary. Rust validates every item before accepting associations.",
        "inputSchema":{"type":"object","additionalProperties":false,"required":["operation_id","workspace_id","task_id","session_id","items"],"properties":{
            "operation_id":{"type":"string","description":"Idempotent caller-supplied operation ID"},
            "workspace_id":{"type":"string"}, "task_id":{"type":"string"}, "session_id":{"type":"string"},
            "items":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["item_id","repository_id","repository_path","git_identity","result"],"properties":{
                "item_id":{"type":"string"},"repository_id":{"type":"string"},"repository_path":{"type":"string"},"git_identity":{"type":"string"},
                "branch":{"type":["string","null"]},"worktree_path":{"type":["string","null"]},
                "result":{"type":"string","enum":["ready","failed","not_attempted"]},"error_code":{"type":["string","null"]},"detail":{"type":["string","null"]}
            }}}
        }}
    })
}

fn log_live_event(event: &Value) {
    let Some(path) = std::env::var_os("MCP_INVOCATION_LOG") else {
        return;
    };
    let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let _ = writeln!(file, "{}", event);
}

fn handle(request: Value, boundary: &mut RegistrationBoundary) -> Option<Value> {
    let id = request.get("id");
    let method = match request.get("method").and_then(Value::as_str) {
        Some(method) => method,
        None => return Some(error(-32600, "Request must contain a method.", id)),
    };
    match method {
        "notifications/initialized" => None,
        "initialize" => Some(
            json!({"jsonrpc":"2.0","id":id.cloned().unwrap_or(Value::Null),
            "result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},
            "serverInfo":{"name":"project-mgr-registration","version":"0.1.0"}}}),
        ),
        "tools/list" => Some(
            json!({"jsonrpc":"2.0","id":id.cloned().unwrap_or(Value::Null),"result":{"tools":[tool_schema()]}}),
        ),
        "tools/call" => {
            let params = match request.get("params").and_then(Value::as_object) {
                Some(params) => params,
                None => return Some(error(-32602, "tools/call params must be an object.", id)),
            };
            if params.get("name").and_then(Value::as_str) != Some("register_task_setup") {
                return Some(error(-32602, "Unknown tool.", id));
            }
            let arguments = match params.get("arguments") {
                Some(Value::Object(arguments)) => Value::Object(arguments.clone()),
                _ => return Some(error(-32602, "Tool arguments must be an object.", id)),
            };
            let report: RegistrationReport = match serde_json::from_value(arguments) {
                Ok(report) => report,
                Err(parse) => {
                    return Some(
                        json!({"jsonrpc":"2.0","id":id.cloned().unwrap_or(Value::Null),"result":tool_error(BoundaryError::new("malformed_arguments", parse.to_string()))}),
                    )
                }
            };
            let operation_id = report.operation_id.clone();
            log_live_event(&json!({"event":"tool_call","name":"register_task_setup"}));
            let result = match boundary.apply_report(report) {
                Ok(result) => {
                    json!({"isError":false,"content":[{"type":"text","text":serde_json::to_string(&result).unwrap()}]})
                }
                Err(error) => tool_error(error),
            };
            log_live_event(
                &json!({"event":"tool_result","name":"register_task_setup","operation_id":operation_id,"result":result.clone()}),
            );
            Some(json!({"jsonrpc":"2.0","id":id.cloned().unwrap_or(Value::Null),"result":result}))
        }
        _ => Some(error(-32601, format!("Method not found: {method}"), id)),
    }
}

fn load_boundary(path: &str) -> Result<RegistrationBoundary, String> {
    let context: Context =
        serde_json::from_str(&fs::read_to_string(path).map_err(|e| e.to_string())?)
            .map_err(|e| format!("invalid context: {e}"))?;
    let mut boundary = RegistrationBoundary::new();
    for repository in context.repositories {
        boundary
            .register_repository(repository.repository_id, Path::new(&repository.path))
            .map_err(|e| e.to_string())?;
    }
    boundary
        .register_workspace(context.workspace_id.clone())
        .map_err(|e| e.to_string())?;
    boundary
        .register_task(
            context.workspace_id.clone(),
            context.task_id.clone(),
            Path::new(&context.task_root),
        )
        .map_err(|e| e.to_string())?;
    boundary
        .register_session(context.workspace_id, context.task_id, context.session_id)
        .map_err(|e| e.to_string())?;
    Ok(boundary)
}

fn main() {
    let mut args = std::env::args().skip(1);
    let context = match (args.next().as_deref(), args.next()) {
        (Some("--context"), Some(path)) => path,
        _ => {
            eprintln!("usage: registration-mcp --context CONTEXT_JSON");
            std::process::exit(2);
        }
    };
    let mut boundary = match load_boundary(&context) {
        Ok(boundary) => boundary,
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    };
    let stdout = io::stdout();
    let mut output = stdout.lock();
    for line in io::stdin().lock().lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => break,
        };
        if line.trim().is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(&line) {
            Ok(request) => handle(request, &mut boundary),
            Err(parse) => Some(error(-32700, format!("Invalid JSON: {parse}"), None)),
        };
        if let Some(response) = response {
            writeln!(output, "{}", response).expect("write MCP response");
            output.flush().expect("flush MCP response");
        }
    }
}
