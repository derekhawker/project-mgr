//! The application's ownership boundary for the OpenCode v2 server.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::Read;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use crate::terminal::{self, TerminalManager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub executable: String,
    pub version: String,
    pub base_url: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Info {
    pub version: String,
    #[serde(default)]
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ModelReference {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    pub id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ModelCatalogEntry {
    #[serde(rename = "providerID")]
    pub provider_id: String,
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub status: Option<String>,
}

const KNOWN_STALE_MODELS: &[&str] = &["opencode/exo-free"];

pub fn parse_model_catalog(value: Value) -> Result<Vec<ModelCatalogEntry>, String> {
    let data = value
        .get("data")
        .cloned()
        .ok_or_else(|| "invalid OpenCode response: missing data wrapper".to_owned())?;
    let entries: Vec<ModelCatalogEntry> =
        serde_json::from_value(data).map_err(|e| format!("invalid OpenCode model catalog: {e}"))?;
    Ok(entries
        .into_iter()
        .filter(|entry| {
            entry.enabled
                && entry.status.as_deref() != Some("deprecated")
                && !KNOWN_STALE_MODELS
                    .contains(&format!("{}/{}", entry.provider_id, entry.id).as_str())
        })
        .collect())
}

pub fn validate_model(catalog: &[ModelCatalogEntry], model: &ModelReference) -> Result<(), String> {
    if catalog
        .iter()
        .any(|entry| entry.provider_id == model.provider_id && entry.id == model.id)
    {
        Ok(())
    } else {
        Err(format!("The selected model `{}/{}` is not available. Choose an enabled model from the OpenCode catalog; OpenCode's default will not be used.", model.provider_id, model.id))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateSessionRequest {
    pub title: String,
    pub location: Location,
    pub model: ModelReference,
}
#[derive(Debug, Clone, Serialize)]
pub struct Location {
    pub directory: String,
}
#[derive(Debug, Clone, Serialize)]
pub struct PromptRequest {
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PermissionReplyRequest {
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FormReplyRequest {
    pub answer: Value,
}

/// The cursors returned by the v2 paginated APIs.  They are deliberately
/// opaque: the server currently returns sequence-like values, but the client
/// must not interpret or manufacture them.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct Cursors {
    pub previous: Option<String>,
    pub next: Option<String>,
}

/// Opaque durable-log position supplied by the server.  The runtime carries
/// it across reconnects but never turns it into an application status.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
pub struct EventCursor {
    pub after: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionHistory {
    pub session_id: String,
    pub data: Vec<Value>,
    pub cursor: Cursors,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct ActiveSession {
    #[serde(rename(serialize = "kind", deserialize = "type"))]
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub session_id: String,
    pub active: Option<ActiveSession>,
    #[serde(default)]
    pub outcome: Option<String>,
    pub application_status: SessionApplicationStatus,
}

/// Application status is intentionally derived from several independent v2
/// signals. In particular, an absent entry in `/session/active` is not proof
/// that a turn completed.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SessionApplicationStatus {
    Starting,
    Running,
    WaitingForInput,
    ReadyForReview,
    Reconnecting,
    Unknown,
    Failed,
}

#[derive(Debug, Clone, Default)]
pub struct SessionEvidence<'a> {
    pub starting: bool,
    pub reconnecting: bool,
    pub active: Option<&'a ActiveSession>,
    pub outcome: Option<&'a str>,
    pub permissions: &'a [Value],
    pub forms: &'a [Value],
    pub history: &'a [Value],
    pub events: &'a [Value],
}

pub fn classify_session_status(evidence: SessionEvidence<'_>) -> SessionApplicationStatus {
    if evidence.starting {
        return SessionApplicationStatus::Starting;
    }
    if matches!(evidence.outcome, Some("failed" | "error" | "interrupted")) {
        return SessionApplicationStatus::Failed;
    }
    if !evidence.permissions.is_empty()
        || !evidence.forms.is_empty()
        || evidence.events.iter().any(|event| {
            let text = event.to_string().to_ascii_lowercase();
            text.contains("permission")
                || text.contains("question")
                || text.contains("input")
                || text.contains("form")
        })
    {
        return SessionApplicationStatus::WaitingForInput;
    }
    if evidence.active.is_some()
        || evidence.events.iter().any(|event| {
            event
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| {
                    matches!(
                        kind,
                        "session.status" | "session.updated" | "running" | "step.start"
                    )
                })
        })
    {
        return SessionApplicationStatus::Running;
    }
    if evidence.reconnecting {
        return SessionApplicationStatus::Reconnecting;
    }
    if matches!(
        evidence.outcome,
        Some("succeeded" | "success" | "completed")
    ) && !evidence.history.is_empty()
    {
        return SessionApplicationStatus::ReadyForReview;
    }
    // An inactive session with no completion evidence is deliberately not
    // promoted to ReadyForReview.
    SessionApplicationStatus::Unknown
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionReconciliation {
    pub session_id: String,
    pub cursor: Option<String>,
    pub history: SessionHistory,
    pub active: Option<ActiveSession>,
    pub permissions: Vec<Value>,
    pub forms: Vec<Value>,
    pub durable_events: Vec<Value>,
    pub status: SessionApplicationStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingInputs {
    pub session_id: String,
    pub permissions: Vec<Value>,
    pub forms: Vec<Value>,
}

struct Server {
    child: Child,
    info: RuntimeInfo,
    _password: String,
    client: Client,
}
pub struct Runtime {
    server: Mutex<Option<Server>>,
    pub(crate) terminals: TerminalManager,
    // 0 is running, 1 is shutting down.  This is intentionally independent
    // of the server mutex: commands must be rejected while shutdown waits for
    // children, rather than racing a newly-created server into existence.
    lifecycle: AtomicU8,
    // Serializes the lifecycle decision with every operation which can create
    // a server or PTY.  The atomic flag alone still allowed shutdown to slip
    // between the check and child registration.
    lifecycle_gate: Mutex<()>,
}

impl Default for Runtime {
    fn default() -> Self {
        Self::new()
    }
}
impl Runtime {
    pub fn new() -> Self {
        Self {
            server: Mutex::new(None),
            terminals: TerminalManager::default(),
            lifecycle: AtomicU8::new(0),
            lifecycle_gate: Mutex::new(()),
        }
    }

    pub fn is_shutting_down(&self) -> bool {
        self.lifecycle.load(Ordering::Acquire) != 0
    }

    fn ensure_running(&self) -> Result<(), String> {
        if self.is_shutting_down() {
            Err("OpenCode runtime is shutting down; command rejected".to_owned())
        } else {
            Ok(())
        }
    }

    pub fn ensure_started(&self) -> Result<RuntimeInfo, String> {
        let _gate = self
            .lifecycle_gate
            .lock()
            .map_err(|_| "OpenCode lifecycle lock is poisoned".to_owned())?;
        self.ensure_started_locked()
    }

    fn ensure_started_locked(&self) -> Result<RuntimeInfo, String> {
        self.ensure_running()?;
        let mut slot = self
            .server
            .lock()
            .map_err(|_| "OpenCode runtime lock is poisoned".to_owned())?;
        if let Some(server) = slot.as_mut() {
            if server
                .child
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_none()
            {
                return Ok(server.info.clone());
            }
            *slot = None;
        }
        let executable = resolve_opencode()?;
        let cli_version = validate_help(&executable)?;
        let password = generate_password()?;
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|e| format!("could not reserve OpenCode port: {e}"))?;
        let port = listener.local_addr().map_err(|e| e.to_string())?.port();
        drop(listener);
        let mut child = Command::new(&executable)
            .args([
                "serve",
                "--hostname",
                "127.0.0.1",
                "--port",
                &port.to_string(),
            ])
            .env("OPENCODE_SERVER_PASSWORD", &password)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("could not start OpenCode server: {e}"))?;
        let base_url = format!("http://127.0.0.1:{port}");
        let client = match api_client(&password) {
            Ok(client) => client,
            Err(error) => {
                return Err(with_cleanup_errors(error, stop_child(&mut child)));
            }
        };
        let info = wait_for_health(&mut child, &client, &base_url, HEALTH_TIMEOUT)?;
        let result = RuntimeInfo {
            executable: executable.display().to_string(),
            version: format!("{cli_version} · server {}", info.version),
            base_url,
        };
        *slot = Some(Server {
            child,
            info: result.clone(),
            _password: password,
            client,
        });
        Ok(result)
    }

    pub fn info(&self) -> Result<Info, String> {
        let (client, url) = self.client_url()?;
        get_json(&client, &format!("{url}/api/info"))
    }
    pub fn models(&self) -> Result<Value, String> {
        let (client, url) = self.client_url()?;
        // Keep the server response intact at this boundary.  The catalog
        // parser owns the API envelope and filtering rules used by callers
        // that select a model.
        get_value(&client, &format!("{url}/api/model"))
    }
    fn catalog(&self) -> Result<Vec<ModelCatalogEntry>, String> {
        parse_model_catalog(self.models()?)
    }
    pub fn enabled_models(&self) -> Result<Vec<ModelCatalogEntry>, String> {
        self.catalog()
    }
    pub fn create_session(
        &self,
        title: &str,
        directory: &Path,
        model: ModelReference,
    ) -> Result<Value, String> {
        if !directory.is_absolute() {
            return Err(format!(
                "OpenCode session directory must be absolute: {}",
                directory.display()
            ));
        }
        validate_model(&self.catalog()?, &model)?;
        let (client, url) = self.client_url()?;
        let body = CreateSessionRequest {
            title: title.to_owned(),
            location: Location {
                directory: directory.to_string_lossy().into_owned(),
            },
            model,
        };
        post_data_value(&client, &format!("{url}/api/session"), &body)
    }
    pub fn set_session_model(&self, id: &str, model: ModelReference) -> Result<(), String> {
        validate_model(&self.catalog()?, &model)?;
        let (client, url) = self.client_url()?;
        post_empty(
            &client,
            &format!("{url}/api/session/{id}/model"),
            &json!({"model": model}),
        )
    }
    pub fn prompt(&self, id: &str, text: &str) -> Result<(), String> {
        let (client, url) = self.client_url()?;
        post_empty(
            &client,
            &format!("{url}/api/session/{id}/prompt"),
            &PromptRequest {
                text: text.to_owned(),
            },
        )
    }
    pub fn generate_session_text(&self, id: &str, prompt: &str) -> Result<String, String> {
        let (client, url) = self.client_url()?;
        let response = post_data_value(
            &client,
            &format!("{url}/api/session/{id}/generate"),
            &json!({"prompt": prompt}),
        )?;
        response
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| "OpenCode returned an invalid session generation response.".to_owned())
    }
    pub fn reply_permission(
        &self,
        session_id: &str,
        request_id: &str,
        decision: &str,
        message: Option<&str>,
    ) -> Result<(), String> {
        let id = validate_session_id(session_id)?;
        let request_id = validate_request_id(request_id)?;
        let (client, url) = self.client_url()?;
        post_empty(
            &client,
            &format!("{url}/api/session/{id}/permission/{request_id}/reply"),
            &PermissionReplyRequest {
                decision: decision.to_owned(),
                message: message.map(str::to_owned),
            },
        )
    }
    pub fn reply_form(&self, session_id: &str, form_id: &str, answer: Value) -> Result<(), String> {
        let id = validate_session_id(session_id)?;
        let form_id = validate_request_id(form_id)?;
        let (client, url) = self.client_url()?;
        post_empty(
            &client,
            &format!("{url}/api/session/{id}/form/{form_id}/reply"),
            &FormReplyRequest { answer },
        )
    }
    pub fn cancel_form(&self, session_id: &str, form_id: &str) -> Result<(), String> {
        let id = validate_session_id(session_id)?;
        let form_id = validate_request_id(form_id)?;
        let (client, url) = self.client_url()?;
        delete_empty(&client, &format!("{url}/api/session/{id}/form/{form_id}"))
    }
    pub fn session_history(
        &self,
        id: &str,
        order: &str,
        limit: u32,
    ) -> Result<SessionHistory, String> {
        let id = validate_session_id(id)?;
        let (client, url) = self.client_url()?;
        let value = get_data_with_cursor(
            &client,
            &format!("{url}/api/session/{id}/message"),
            &["order", order, "limit", &limit.to_string()],
        )?;
        Ok(SessionHistory {
            session_id: id,
            data: value.0,
            cursor: value.1,
        })
    }
    pub fn active_sessions(&self) -> Result<HashMap<String, ActiveSession>, String> {
        let (client, url) = self.client_url()?;
        get_data_value(&client, &format!("{url}/api/session/active")).and_then(|value| {
            serde_json::from_value(value).map_err(|e| format!("invalid OpenCode response: {e}"))
        })
    }
    pub fn session_status(&self, id: &str) -> Result<SessionStatus, String> {
        let id = validate_session_id(id)?;
        let active = self.active_sessions()?.remove(&id);
        let application_status = if active.is_some() {
            SessionApplicationStatus::Running
        } else {
            SessionApplicationStatus::Unknown
        };
        Ok(SessionStatus {
            session_id: id,
            active,
            outcome: None,
            application_status,
        })
    }
    pub fn permissions(&self, id: &str) -> Result<Vec<Value>, String> {
        self.session_pending(id, "permission")
    }
    pub fn forms(&self, id: &str) -> Result<Vec<Value>, String> {
        self.session_pending(id, "form")
    }
    pub fn pending_inputs(&self, id: &str) -> Result<PendingInputs, String> {
        let id = validate_session_id(id)?;
        Ok(PendingInputs {
            session_id: id.clone(),
            permissions: self.permissions(&id)?,
            forms: self.forms(&id)?,
        })
    }
    pub fn durable_session_events(
        &self,
        id: &str,
        cursor: Option<&str>,
        follow: bool,
    ) -> Result<Vec<Value>, String> {
        let id = validate_session_id(id)?;
        let (client, url) = self.client_url()?;
        let mut query = vec![("follow", follow.to_string())];
        if let Some(cursor) = cursor {
            query.push(("after", cursor.to_owned()));
        }
        let response = checked(
            client
                .get(format!("{url}/api/experimental/session/{id}/log"))
                .query(&query)
                .send()
                .map_err(|e| e.to_string())?,
        )?;
        parse_sse(response)
    }

    fn durable_session_events_with_cursor(
        &self,
        id: &str,
        cursor: Option<&str>,
        follow: bool,
    ) -> Result<(Vec<Value>, Option<String>), String> {
        let id = validate_session_id(id)?;
        let (client, url) = self.client_url()?;
        let mut query = vec![("follow", follow.to_string())];
        if let Some(cursor) = cursor {
            query.push(("after", cursor.to_owned()));
        }
        let response = checked(
            client
                .get(format!("{url}/api/experimental/session/{id}/log"))
                .query(&query)
                .send()
                .map_err(|e| e.to_string())?,
        )?;
        parse_sse_with_cursor(response)
    }
    pub fn reconcile_session(
        &self,
        id: &str,
        cursor: Option<&str>,
    ) -> Result<SessionReconciliation, String> {
        let id = validate_session_id(id)?;
        let history = self.session_history(&id, "asc", 500)?;
        let active = self.session_status(&id)?.active;
        let permissions = self.permissions(&id)?;
        let forms = self.forms(&id)?;
        let (durable_events, next_cursor) =
            self.durable_session_events_with_cursor(&id, cursor, false)?;
        let status = classify_session_status(SessionEvidence {
            active: active.as_ref(),
            permissions: &permissions,
            forms: &forms,
            history: &history.data,
            events: &durable_events,
            ..Default::default()
        });
        Ok(SessionReconciliation {
            session_id: id,
            cursor: next_cursor.or_else(|| cursor.map(str::to_owned)),
            history,
            active,
            permissions,
            forms,
            durable_events,
            status,
        })
    }
    fn session_pending(&self, id: &str, route: &str) -> Result<Vec<Value>, String> {
        let (client, url) = self.client_url()?;
        let id = validate_session_id(id)?;
        let value = get_data_value(&client, &format!("{url}/api/session/{id}/{route}"))?;
        serde_json::from_value(value).map_err(|e| format!("invalid OpenCode response: {e}"))
    }
    pub fn shutdown(&self) {
        let Ok(_gate) = self.lifecycle_gate.lock() else {
            return;
        };
        if self
            .lifecycle
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        self.terminals.shutdown();
        if let Ok(mut slot) = self.server.lock() {
            if let Some(mut server) = slot.take() {
                if let Err(error) = stop_child(&mut server.child) {
                    eprintln!("{{\"event\":\"child-cleanup-error\",\"context\":\"runtime shutdown\",\"message\":{}}}", serde_json::to_string(&error).unwrap_or_else(|_| "\"unserializable\"".into()));
                }
            }
        }
    }

    pub fn attach_terminal(
        &self,
        app: tauri::AppHandle,
        session_id: &str,
        directory: &Path,
    ) -> Result<(), String> {
        let _gate = self
            .lifecycle_gate
            .lock()
            .map_err(|_| "OpenCode lifecycle lock is poisoned".to_owned())?;
        let _ = self.ensure_started_locked()?;
        self.ensure_running()?;
        let (executable, base_url, password) = {
            let slot = self
                .server
                .lock()
                .map_err(|_| "OpenCode runtime lock is poisoned".to_owned())?;
            let server = slot
                .as_ref()
                .ok_or_else(|| "OpenCode server is unavailable".to_owned())?;
            (
                server.info.executable.clone(),
                server.info.base_url.clone(),
                server._password.clone(),
            )
        };
        self.terminals.attach(
            app,
            Path::new(&executable),
            &base_url,
            &password,
            session_id,
            directory,
        )
    }

    pub fn restore_terminal(
        &self,
        app: tauri::AppHandle,
        session_id: &str,
        directory: &Path,
    ) -> Result<(), String> {
        if self.terminal_attached(session_id) {
            return Ok(());
        }
        self.attach_terminal(app, session_id, directory)?;
        self.wait_for_terminal_ready(session_id)
    }

    pub fn write_terminal(&self, session_id: &str, data: &str) -> Result<(), String> {
        self.ensure_running()?;
        self.terminals.write(session_id, data)
    }

    pub fn resize_terminal(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        self.ensure_running()?;
        self.terminals.resize(session_id, cols, rows)
    }

    pub fn cleanup_terminal(&self, session_id: &str) -> Result<(), String> {
        self.ensure_running()?;
        self.terminals.cleanup(session_id)
    }

    pub fn replay_terminal(&self, session_id: &str) -> terminal::TerminalAttachResult {
        self.terminals.replay(session_id)
    }

    pub fn wait_for_terminal_ready(&self, session_id: &str) -> Result<(), String> {
        self.ensure_running()?;
        self.terminals.wait_until_ready(session_id)
    }

    pub fn terminal_attached(&self, session_id: &str) -> bool {
        self.terminals.is_attached(session_id)
    }
    fn client_url(&self) -> Result<(Client, String), String> {
        let info = self.ensure_started()?;
        let slot = self
            .server
            .lock()
            .map_err(|_| "OpenCode runtime lock is poisoned".to_owned())?;
        Ok((
            slot.as_ref().expect("server just started").client.clone(),
            info.base_url,
        ))
    }
}
impl Drop for Runtime {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn get_json<T: for<'de> Deserialize<'de>>(client: &Client, url: &str) -> Result<T, String> {
    get_value(client, url).and_then(|v| {
        serde_json::from_value(v).map_err(|e| format!("invalid OpenCode response: {e}"))
    })
}
fn get_value(client: &Client, url: &str) -> Result<Value, String> {
    checked(client.get(url).send().map_err(|e| e.to_string())?)?
        .json()
        .map_err(|e| format!("invalid OpenCode JSON: {e}"))
}
fn get_data_value(client: &Client, url: &str) -> Result<Value, String> {
    let value = get_value(client, url)?;
    value
        .get("data")
        .cloned()
        .ok_or_else(|| "invalid OpenCode response: missing data wrapper".to_owned())
}
fn get_data_with_cursor(
    client: &Client,
    url: &str,
    params: &[&str],
) -> Result<(Vec<Value>, Cursors), String> {
    let query = params
        .chunks_exact(2)
        .map(|p| (p[0], p[1]))
        .collect::<Vec<_>>();
    let value = checked(
        client
            .get(url)
            .query(&query)
            .send()
            .map_err(|e| e.to_string())?,
    )?
    .json::<Value>()
    .map_err(|e| format!("invalid OpenCode JSON: {e}"))?;
    let data = value
        .get("data")
        .cloned()
        .ok_or_else(|| "invalid OpenCode response: missing data wrapper".to_owned())?;
    let cursor = value.get("cursor").cloned().unwrap_or_else(|| json!({}));
    Ok((
        serde_json::from_value(data).map_err(|e| format!("invalid OpenCode response: {e}"))?,
        serde_json::from_value(cursor).map_err(|e| format!("invalid OpenCode cursor: {e}"))?,
    ))
}
fn parse_sse(response: Response) -> Result<Vec<Value>, String> {
    let body = response.text().map_err(|e| e.to_string())?;
    body.lines()
        .filter_map(|line| line.strip_prefix("data:"))
        .map(|line| {
            serde_json::from_str(line.trim())
                .map_err(|e| format!("invalid OpenCode event JSON: {e}"))
        })
        .collect()
}

fn parse_sse_with_cursor(response: Response) -> Result<(Vec<Value>, Option<String>), String> {
    let body = response.text().map_err(|e| e.to_string())?;
    let mut events = Vec::new();
    let mut cursor = None;
    for line in body.lines() {
        if let Some(id) = line.strip_prefix("id:") {
            cursor = Some(id.trim().to_owned());
        }
        if let Some(data) = line.strip_prefix("data:") {
            let value: Value = serde_json::from_str(data.trim())
                .map_err(|e| format!("invalid OpenCode event JSON: {e}"))?;
            if let Some(value_cursor) = value
                .get("cursor")
                .and_then(Value::as_str)
                .or_else(|| value.get("seq").and_then(Value::as_str))
            {
                cursor = Some(value_cursor.to_owned());
            }
            events.push(value);
        }
    }
    Ok((events, cursor))
}
fn validate_session_id(id: &str) -> Result<String, String> {
    if id.is_empty() || id.chars().any(|c| matches!(c, '/' | '?' | '#' | '%')) {
        return Err("invalid OpenCode session ID".to_owned());
    }
    Ok(id.to_owned())
}
fn validate_request_id(id: &str) -> Result<String, String> {
    if id.is_empty() || id.chars().any(|c| matches!(c, '/' | '?' | '#' | '%')) {
        return Err("invalid OpenCode request ID".to_owned());
    }
    Ok(id.to_owned())
}
fn post_value<T: Serialize>(client: &Client, url: &str, body: &T) -> Result<Value, String> {
    checked(
        client
            .post(url)
            .json(body)
            .send()
            .map_err(|e| e.to_string())?,
    )?
    .json()
    .map_err(|e| format!("invalid OpenCode JSON: {e}"))
}
fn post_data_value<T: Serialize>(client: &Client, url: &str, body: &T) -> Result<Value, String> {
    let value = post_value(client, url, body)?;
    value
        .get("data")
        .cloned()
        .ok_or_else(|| "invalid OpenCode response: missing data wrapper".to_owned())
}
fn post_empty<T: Serialize>(client: &Client, url: &str, body: &T) -> Result<(), String> {
    checked(
        client
            .post(url)
            .json(body)
            .send()
            .map_err(|e| e.to_string())?,
    )
    .map(|_| ())
}
fn delete_empty(client: &Client, url: &str) -> Result<(), String> {
    checked(client.delete(url).send().map_err(|e| e.to_string())?).map(|_| ())
}
fn checked(response: Response) -> Result<Response, String> {
    if response.status().is_success() {
        Ok(response)
    } else {
        let status = response.status();
        // Never return the server body: it is untrusted and may echo the
        // configured password (or contain other sensitive provider data).
        let _ = response.text();
        Err(format!("OpenCode API returned HTTP {status}"))
    }
}
fn api_client(password: &str) -> Result<Client, String> {
    let mut headers = HeaderMap::new();
    let token = STANDARD.encode(format!("opencode:{password}"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Basic {token}")).map_err(|e| e.to_string())?,
    );
    Client::builder()
        .default_headers(headers)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn wait_for_health(
    child: &mut Child,
    client: &Client,
    base_url: &str,
    timeout: Duration,
) -> Result<Info, String> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("could not check OpenCode server: {e}"))?
        {
            return Err(with_cleanup_errors(
                format!("OpenCode server exited during startup ({status})"),
                stop_child(child),
            ));
        }
        if let Ok(response) = client.get(format!("{base_url}/api/info")).send() {
            if response.status().is_success() {
                if let Ok(info) = response.json::<Info>() {
                    if let Err(error) = require_v2(&info.version) {
                        return Err(with_cleanup_errors(
                            format!("OpenCode server is incompatible: {error}"),
                            stop_child(child),
                        ));
                    }
                    return Ok(info);
                }
            }
        }
        if Instant::now() >= deadline {
            return Err(with_cleanup_errors(
                format!(
                    "OpenCode server did not become healthy before the {} second timeout",
                    timeout.as_secs()
                ),
                stop_child(child),
            ));
        }
        thread::sleep(Duration::from_millis(100));
    }
}

fn stop_child(child: &mut Child) -> Result<(), String> {
    let kill = child
        .kill()
        .map_err(|error| format!("kill failed: {error}"));
    let wait = child
        .wait()
        .map(|_| ())
        .map_err(|error| format!("wait failed: {error}"));
    let mut errors = Vec::new();
    if let Err(error) = kill {
        errors.push(error);
    }
    if let Err(error) = wait {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn with_cleanup_errors(error: String, cleanup: Result<(), String>) -> String {
    match cleanup {
        Ok(()) => error,
        Err(cleanup) => format!("{error}; cleanup: {cleanup}"),
    }
}
fn generate_password() -> Result<String, String> {
    let mut bytes = [0u8; 24];
    std::fs::File::open("/dev/urandom")
        .map_err(|e| e.to_string())?
        .read_exact(&mut bytes)
        .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

pub fn resolve_opencode() -> Result<PathBuf, String> {
    resolve_opencode_from(
        std::env::var_os("OPENCODE_BIN").as_deref(),
        std::env::var_os("PATH").as_deref(),
        home_dir().as_deref(),
    )
}
pub fn resolve_opencode_from(
    override_path: Option<&OsStr>,
    path: Option<&OsStr>,
    home: Option<&Path>,
) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    let mut add = |p: PathBuf| {
        if !candidates.contains(&p) {
            candidates.push(p);
        }
    };
    if let Some(p) = override_path {
        add(PathBuf::from(p));
    }
    if let Some(p) = path {
        for dir in std::env::split_paths(p) {
            if !dir.as_os_str().is_empty() {
                add(dir.join("opencode"));
            }
        }
    }
    if let Some(h) = home {
        add(h.join(".opencode/bin/opencode"));
        add(h.join(".local/bin/opencode"));
    }
    let attempts = candidates
        .iter()
        .map(|p| p.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    candidates.into_iter().find(|p| is_executable(p)).ok_or_else(|| format!("Could not find an executable OpenCode binary. Attempted: {attempts}. Set OPENCODE_BIN to the full path of the executable."))
}
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
}
fn is_executable(path: &Path) -> bool {
    path.is_file() && {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            path.metadata()
                .map(|m| m.permissions().mode() & 0o111 != 0)
                .unwrap_or(false)
        }
        #[cfg(not(unix))]
        {
            true
        }
    }
}
pub fn validate_help(executable: &Path) -> Result<String, String> {
    // Validation must describe the binary itself, not shell startup files or
    // ambient environment inherited from another test/process.
    let output = Command::new(executable)
        .env_clear()
        .arg("--help")
        .output()
        .map_err(|e| format!("Incompatible OpenCode CLI: could not run help: {e}"))?;
    let text = String::from_utf8_lossy(&output.stdout).to_string()
        + &String::from_utf8_lossy(&output.stderr);
    if !text.contains("--server") || !text.contains("--session") {
        return Err(
            "Incompatible OpenCode CLI: root --help must advertise both --server and --session"
                .to_owned(),
        );
    }
    if !output.status.success() {
        return Err(format!(
            "Incompatible OpenCode CLI: --help exited with {output_status}",
            output_status = output.status
        ));
    }
    let version = Command::new(executable)
        .env_clear()
        .arg("--version")
        .output()
        .map_err(|e| e.to_string())?;
    if !version.status.success() {
        return Err(format!(
            "Could not determine OpenCode version: --version exited with {}",
            version.status
        ));
    }
    let version = String::from_utf8_lossy(&version.stdout).trim().to_owned();
    require_v2(&version)?;
    Ok(version)
}

const HEALTH_TIMEOUT: Duration = Duration::from_secs(16);

fn require_v2(version: &str) -> Result<(), String> {
    // `opencode --version` includes the command name and prefixes the
    // version with `v` (for example, `opencode v2.0.27`).  Keep accepting
    // the bare forms as well, since the API's version field and older CLI
    // builds may omit either of those decorations.
    let tokens: Vec<_> = version.split_whitespace().collect();
    let token = match tokens.as_slice() {
        [token] | ["opencode", token] => *token,
        _ => "",
    };
    let normalized = token.strip_prefix('v').unwrap_or(token);
    let components: Vec<_> = normalized.split('.').collect();
    let valid = components.len() == 3
        && components.iter().all(|component| {
            !component.is_empty() && component.chars().all(|c| c.is_ascii_digit())
        });
    let major = valid
        .then(|| components[0].parse::<u64>().ok())
        .flatten()
        .ok_or_else(|| format!("could not parse OpenCode version '{version}'"))?;
    if major != 2 {
        return Err(format!("unsupported OpenCode major version {major}; this app requires v2 (installed: {version})"));
    }
    Ok(())
}

#[cfg(test)]
#[path = "../test_support/resource_lock.rs"]
mod test_resource_lock;

#[cfg(test)]
mod tests {
    use super::test_resource_lock::ResourceLock;
    use super::*;
    use std::fs;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::thread;
    use tempfile::tempdir;

    #[test]
    fn shutdown_is_idempotent_and_rejects_new_commands() {
        let runtime = Runtime::new();
        assert!(!runtime.is_shutting_down());
        runtime.shutdown();
        runtime.shutdown();
        assert!(runtime.is_shutting_down());
        let error = runtime
            .ensure_started()
            .expect_err("shutdown must be a hard gate");
        assert!(error.contains("shutting down"));
        assert!(runtime.write_terminal("ses_1", "x").is_err());
    }

    #[test]
    fn tauri_session_results_serialize_with_frontend_casing() {
        let history = SessionHistory {
            session_id: "ses_wire".into(),
            data: vec![json!({"type":"user"})],
            cursor: Cursors {
                previous: None,
                next: Some("cursor-2".into()),
            },
        };
        assert_eq!(
            serde_json::to_value(&history).unwrap(),
            json!({
                "sessionId":"ses_wire",
                "data":[{"type":"user"}],
                "cursor":{"previous":null,"next":"cursor-2"}
            })
        );

        let active: ActiveSession = serde_json::from_value(json!({"type":"running"})).unwrap();
        let status = SessionStatus {
            session_id: "ses_wire".into(),
            active: Some(active.clone()),
            outcome: None,
            application_status: SessionApplicationStatus::Running,
        };
        let status_wire = serde_json::to_value(&status).unwrap();
        assert_eq!(status_wire["sessionId"], "ses_wire");
        assert_eq!(status_wire["active"], json!({"kind":"running"}));
        assert_eq!(status_wire["applicationStatus"], "running");
        assert!(status_wire.get("session_id").is_none());

        let reconciliation = SessionReconciliation {
            session_id: "ses_wire".into(),
            cursor: Some("cursor-3".into()),
            history,
            active: Some(active),
            permissions: Vec::new(),
            forms: Vec::new(),
            durable_events: Vec::new(),
            status: SessionApplicationStatus::WaitingForInput,
        };
        let wire = serde_json::to_value(reconciliation).unwrap();
        assert_eq!(wire["durableEvents"], json!([]));
        assert_eq!(wire["status"], "waitingForInput");
        assert!(wire.get("durable_events").is_none());
    }

    #[test]
    fn classifier_never_calls_inactive_session_complete() {
        assert_eq!(
            classify_session_status(SessionEvidence::default()),
            SessionApplicationStatus::Unknown
        );
        assert_eq!(
            classify_session_status(SessionEvidence {
                outcome: Some("succeeded"),
                history: &[json!({"type":"user"})],
                ..Default::default()
            }),
            SessionApplicationStatus::ReadyForReview
        );
    }

    #[test]
    fn classifier_prioritizes_pending_input_and_failure() {
        let permission = [json!({"id":"p1"})];
        assert_eq!(
            classify_session_status(SessionEvidence {
                active: Some(&ActiveSession {
                    kind: "running".into()
                }),
                permissions: &permission,
                ..Default::default()
            }),
            SessionApplicationStatus::WaitingForInput
        );
        assert_eq!(
            classify_session_status(SessionEvidence {
                outcome: Some("failed"),
                ..Default::default()
            }),
            SessionApplicationStatus::Failed
        );
    }
    #[test]
    fn path_free_fallback_resolves_home() {
        let d = tempdir().unwrap();
        let p = d.path().join(".local/bin/opencode");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, "x").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert_eq!(
            resolve_opencode_from(None, None, Some(d.path())).unwrap(),
            p
        );
    }
    #[test]
    fn resolver_diagnostics_list_attempts() {
        let e = resolve_opencode_from(Some(OsStr::new("/missing")), None, None).unwrap_err();
        assert!(e.contains("/missing") && e.contains("OPENCODE_BIN"));
    }
    #[test]
    fn resolver_prefers_override_and_resolves_path_without_environment_mutation() {
        let d = tempdir().unwrap();
        let path_dir = d.path().join("path");
        let override_dir = d.path().join("override");
        fs::create_dir_all(&path_dir).unwrap();
        fs::create_dir_all(&override_dir).unwrap();
        let path_binary = path_dir.join("opencode");
        let override_binary = override_dir.join("opencode");
        for binary in [&path_binary, &override_binary] {
            fs::write(binary, "x").unwrap();
            make_executable(binary);
        }
        let path = std::env::join_paths([path_dir.as_path()]).unwrap();
        assert_eq!(
            resolve_opencode_from(None, Some(&path), None).unwrap(),
            path_binary
        );
        assert_eq!(
            resolve_opencode_from(Some(override_binary.as_os_str()), Some(&path), None).unwrap(),
            override_binary
        );
    }

    #[test]
    fn resolver_reports_non_executable_override_and_path_candidates() {
        let d = tempdir().unwrap();
        let override_binary = d.path().join("override");
        let path_dir = d.path().join("path");
        fs::create_dir_all(&path_dir).unwrap();
        fs::write(&override_binary, "not executable").unwrap();
        let path = std::env::join_paths([path_dir.as_path()]).unwrap();
        let error = resolve_opencode_from(Some(override_binary.as_os_str()), Some(&path), None)
            .unwrap_err();
        assert!(
            error.contains("OPENCODE_BIN")
                && error.contains("override")
                && error.contains("path/opencode")
        );
    }
    #[test]
    fn payload_is_exact_and_modelled() {
        let body = CreateSessionRequest {
            title: "t".into(),
            location: Location {
                directory: "/x".into(),
            },
            model: ModelReference {
                provider_id: "p".into(),
                id: "m".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(body).unwrap(),
            json!({"title":"t","location":{"directory":"/x"},"model":{"providerID":"p","id":"m"}})
        );
    }

    #[test]
    fn model_catalog_accepts_only_enabled_current_models() {
        let catalog = parse_model_catalog(json!({"data":[
            {"providerID":"openai","id":"good","enabled":true,"status":"active"},
            {"providerID":"openai","id":"disabled","enabled":false,"status":"active"},
            {"providerID":"openai","id":"old","enabled":true,"status":"deprecated"},
            {"providerID":"opencode","id":"exo-free","enabled":true,"status":"active"}
        ]}))
        .unwrap();
        assert!(validate_model(
            &catalog,
            &ModelReference {
                provider_id: "openai".into(),
                id: "good".into()
            }
        )
        .is_ok());
        for id in ["disabled", "old"] {
            assert!(validate_model(
                &catalog,
                &ModelReference {
                    provider_id: "openai".into(),
                    id: id.into()
                }
            )
            .is_err());
        }
        assert!(validate_model(
            &catalog,
            &ModelReference {
                provider_id: "opencode".into(),
                id: "exo-free".into()
            }
        )
        .is_err());
        assert!(validate_model(
            &catalog,
            &ModelReference {
                provider_id: "missing".into(),
                id: "unknown".into()
            }
        )
        .is_err());
    }

    #[test]
    fn runtime_uses_wrapped_model_response_for_session_model_validation() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            for request_number in 0..7 {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let path = request_line.split_whitespace().nth(1).unwrap();
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line);
                }
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|value| value.trim().parse().ok())
                    })
                    .unwrap_or(0);
                let mut body = vec![0; length];
                reader.read_exact(&mut body).unwrap();

                if request_number == 0 {
                    assert_eq!(path, "/api/model");
                }
                let response_body = if path == "/api/model" {
                    r#"{"data":[{"providerID":"openai","id":"good","enabled":true,"status":"active"},{"providerID":"openai","id":"disabled","enabled":false,"status":"active"},{"providerID":"openai","id":"old","enabled":true,"status":"deprecated"},{"providerID":"opencode","id":"exo-free","enabled":true,"status":"active"}]}"#
                } else if path == "/api/session" {
                    assert_eq!(
                        String::from_utf8(body).unwrap(),
                        r#"{"title":"title","location":{"directory":"/tmp/project"},"model":{"providerID":"openai","id":"good"}}"#
                    );
                    r#"{"data":{"id":"ses_1"}}"#
                } else {
                    assert_eq!(path, "/api/session/ses_1/model");
                    assert_eq!(
                        String::from_utf8(body).unwrap(),
                        r#"{"model":{"id":"good","providerID":"openai"}}"#
                    );
                    ""
                };
                let status = if response_body.is_empty() {
                    "204 No Content"
                } else {
                    "200 OK"
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}",
                    response_body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });

        let child = Command::new("sh").args(["-c", "sleep 30"]).spawn().unwrap();
        let runtime = Runtime {
            server: Mutex::new(Some(Server {
                child,
                info: RuntimeInfo {
                    executable: "test".into(),
                    version: "test".into(),
                    base_url: format!("http://{address}"),
                },
                _password: "secret".into(),
                client: api_client("secret").unwrap(),
            })),
            terminals: TerminalManager::default(),
            lifecycle: AtomicU8::new(0),
            lifecycle_gate: Mutex::new(()),
        };

        assert_eq!(runtime.models().unwrap()["data"][0]["id"], json!("good"));
        let good = ModelReference {
            provider_id: "openai".into(),
            id: "good".into(),
        };
        assert!(runtime
            .create_session("title", Path::new("/tmp/project"), good.clone())
            .is_ok());
        let invalid = ModelReference {
            provider_id: "openai".into(),
            id: "disabled".into(),
        };
        assert!(runtime
            .create_session("title", Path::new("/tmp/project"), invalid.clone())
            .is_err());
        assert!(runtime.set_session_model("ses_1", good).is_ok());
        assert!(runtime.set_session_model("ses_1", invalid).is_err());
        runtime.shutdown();
        server.join().unwrap();
    }

    #[test]
    fn help_rejects_incompatible_binary() {
        let _resource_guard = ResourceLock::acquire("opencode-cli-runtime");
        let d = tempdir().unwrap();
        let p = d.path().join("fake");
        fs::write(&p, "#!/bin/sh\necho bad").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&p, fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(validate_help(&p).unwrap_err().contains("Incompatible"));
    }

    #[test]
    fn version_parsing_accepts_real_output_and_reasonable_variants() {
        for version in [
            "opencode v2.0.27",
            "v2.0.27",
            "2.0.27",
            "\n  opencode v2.0.27  \n",
        ] {
            assert!(require_v2(version).is_ok(), "expected {version:?} to parse");
        }
    }

    #[test]
    fn version_parsing_rejects_malformed_and_unsupported_versions() {
        for version in [
            "",
            "opencode",
            "opencode version",
            "opencode v2",
            "opencode vtwo.0.27",
        ] {
            assert!(
                require_v2(version)
                    .unwrap_err()
                    .contains("could not parse OpenCode version"),
                "expected {version:?} to be rejected as malformed"
            );
        }
        assert!(require_v2("opencode v3.0.0")
            .unwrap_err()
            .contains("unsupported OpenCode major version 3"));
    }

    #[test]
    fn help_accepts_real_v2027_output_and_rejects_unsupported_major() {
        let _resource_guard = ResourceLock::acquire("opencode-cli-runtime");
        let d = tempdir().unwrap();
        let p = d.path().join("fake");
        fs::write(&p, "#!/bin/sh\ncase \"$1\" in --help) echo '--server --session';; --version) echo 'opencode v2.0.27';; esac\n").unwrap();
        make_executable(&p);
        assert_eq!(validate_help(&p).unwrap(), "opencode v2.0.27");
        let major_three = d.path().join("major-three");
        fs::write(&major_three, "#!/bin/sh\ncase \"$1\" in --help) echo '--server --session';; --version) echo 'opencode v3.0.0';; esac\n").unwrap();
        make_executable(&major_three);
        assert!(validate_help(&major_three)
            .unwrap_err()
            .contains("unsupported OpenCode major version 3"));
    }

    #[test]
    fn api_routes_send_authenticated_exact_requests_and_unwrap_data() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let expected = [
                ("GET", "/api/info", ""),
                ("GET", "/api/model", ""),
                (
                    "POST",
                    "/api/session",
                    r#"{"title":"title","location":{"directory":"/tmp/project"},"model":{"providerID":"openai","id":"gpt-6-luna"}}"#,
                ),
                (
                    "POST",
                    "/api/session/ses_1/model",
                    r#"{"model":{"id":"gpt-6-luna","providerID":"openai"}}"#,
                ),
                ("POST", "/api/session/ses_1/prompt", r#"{"text":"hello"}"#),
                (
                    "POST",
                    "/api/session/ses_1/permission/p1/reply",
                    r#"{"decision":"once","message":"approved for this turn"}"#,
                ),
                (
                    "POST",
                    "/api/session/ses_1/form/f1/reply",
                    r#"{"answer":{"name":"Ada"}}"#,
                ),
                ("DELETE", "/api/session/ses_1/form/f1", ""),
            ];
            for (method, path, body) in expected {
                let (stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line);
                }
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.to_ascii_lowercase()
                            .strip_prefix("content-length:")
                            .and_then(|n| n.trim().parse().ok())
                    })
                    .unwrap_or(0);
                let mut actual_body = vec![0; length];
                std::io::Read::read_exact(&mut reader, &mut actual_body).unwrap();
                assert_eq!(
                    request_line.split_whitespace().collect::<Vec<_>>(),
                    vec![method, path, "HTTP/1.1"]
                );
                assert!(headers.to_ascii_lowercase().contains(&format!(
                    "authorization: basic {}",
                    STANDARD.encode("opencode:secret").to_ascii_lowercase()
                )));
                assert_eq!(String::from_utf8(actual_body).unwrap(), body);
                let response_body = if path == "/api/info" {
                    r#"{"version":"2.0.27","pid":1}"#
                } else if path == "/api/model" {
                    r#"{"data":{"providers":[]}}"#
                } else if path == "/api/session" {
                    r#"{"data":{"id":"ses_1"}}"#
                } else {
                    ""
                };
                let status = if response_body.is_empty() {
                    "204 No Content"
                } else {
                    "200 OK"
                };
                let response = format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}", response_body.len());
                (&stream).write_all(response.as_bytes()).unwrap();
            }
        });
        let client = api_client("secret").unwrap();
        let base = format!("http://{address}");
        assert_eq!(
            get_json::<Info>(&client, &format!("{base}/api/info"))
                .unwrap()
                .version,
            "2.0.27"
        );
        assert_eq!(
            get_data_value(&client, &format!("{base}/api/model")).unwrap(),
            json!({"providers":[]})
        );
        let body = CreateSessionRequest {
            title: "title".into(),
            location: Location {
                directory: "/tmp/project".into(),
            },
            model: ModelReference {
                provider_id: "openai".into(),
                id: "gpt-6-luna".into(),
            },
        };
        assert_eq!(
            post_data_value(&client, &format!("{base}/api/session"), &body).unwrap(),
            json!({"id":"ses_1"})
        );
        post_empty(
            &client,
            &format!("{base}/api/session/ses_1/model"),
            &json!({"model":{"providerID":"openai","id":"gpt-6-luna"}}),
        )
        .unwrap();
        post_empty(
            &client,
            &format!("{base}/api/session/ses_1/prompt"),
            &PromptRequest {
                text: "hello".into(),
            },
        )
        .unwrap();
        post_empty(
            &client,
            &format!("{base}/api/session/ses_1/permission/p1/reply"),
            &PermissionReplyRequest {
                decision: "once".into(),
                message: Some("approved for this turn".into()),
            },
        )
        .unwrap();
        post_empty(
            &client,
            &format!("{base}/api/session/ses_1/form/f1/reply"),
            &FormReplyRequest {
                answer: json!({"name":"Ada"}),
            },
        )
        .unwrap();
        delete_empty(&client, &format!("{base}/api/session/ses_1/form/f1")).unwrap();
        server.join().unwrap();
    }

    #[test]
    fn proposal_generation_uses_the_transient_generate_contract() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut request_line = String::new();
            reader.read_line(&mut request_line).unwrap();
            let mut headers = String::new();
            let mut content_length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if let Some(length) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    content_length = length.trim().parse::<usize>().unwrap();
                }
                headers.push_str(&line);
            }
            let mut body = vec![0; content_length];
            std::io::Read::read_exact(&mut reader, &mut body).unwrap();
            assert_eq!(
                request_line.split_whitespace().collect::<Vec<_>>(),
                vec!["POST", "/api/session/ses_proposal/generate", "HTTP/1.1"]
            );
            assert!(headers.to_ascii_lowercase().contains(&format!(
                "authorization: basic {}",
                STANDARD.encode("opencode:secret").to_ascii_lowercase()
            )));
            assert_eq!(
                serde_json::from_slice::<Value>(&body).unwrap(),
                json!({"prompt":"Prepare a proposal"})
            );
            let response_body =
                r#"{"data":{"text":"{\"schemaVersion\":1,\"workType\":\"workspace\"}"}}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            );
            (&stream).write_all(response.as_bytes()).unwrap();
        });
        let runtime = Runtime {
            server: Mutex::new(Some(Server {
                child: Command::new("sh").args(["-c", "sleep 2"]).spawn().unwrap(),
                info: RuntimeInfo {
                    executable: "fake".into(),
                    version: "2.0.27".into(),
                    base_url: format!("http://{address}"),
                },
                _password: "secret".into(),
                client: api_client("secret").unwrap(),
            })),
            terminals: TerminalManager::default(),
            lifecycle: AtomicU8::new(0),
            lifecycle_gate: Mutex::new(()),
        };
        let result = runtime
            .generate_session_text("ses_proposal", "Prepare a proposal")
            .unwrap();
        assert_eq!(result, r#"{"schemaVersion":1,"workType":"workspace"}"#);
        server.join().unwrap();
        runtime.shutdown();
    }

    #[test]
    fn non_success_responses_include_status_without_credentials() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            // Keep this fixture entirely local to the test.  Reading the
            // request before replying also removes timing dependence when
            // this test runs beside the other socket fixtures.
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("GET /api/info HTTP/1.1"));
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
            }
            stream.write_all(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 7\r\nConnection: close\r\n\r\nprivate").unwrap();
        });
        let error = get_value(
            &api_client("secret").unwrap(),
            &format!("http://{address}/api/info"),
        )
        .unwrap_err();
        assert!(error.contains("HTTP 401"));
        assert!(!error.contains("secret"));
        server.join().unwrap();
    }

    #[test]
    fn server_error_body_cannot_echo_configured_password() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let secret = "configured-password";
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let body = format!("HTTP/1.1 500 Internal Server Error\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", secret.len(), secret);
            stream.write_all(body.as_bytes()).unwrap();
        });
        let error = get_value(
            &api_client(secret).unwrap(),
            &format!("http://{address}/api/info"),
        )
        .unwrap_err();
        assert!(!error.contains(secret));
        server.join().unwrap();
    }

    #[test]
    fn health_timeout_and_child_exit_are_reported_and_reaped() {
        let client = api_client("secret").unwrap();
        let mut child = Command::new("sh").args(["-c", "sleep 2"]).spawn().unwrap();
        let error = wait_for_health(
            &mut child,
            &client,
            "http://127.0.0.1:1",
            Duration::from_millis(10),
        )
        .unwrap_err();
        assert!(error.contains("timeout"));
        assert!(child.try_wait().unwrap().is_some());

        let mut child = Command::new("sh").args(["-c", "exit 23"]).spawn().unwrap();
        let error = wait_for_health(
            &mut child,
            &client,
            "http://127.0.0.1:1",
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert!(error.contains("exited during startup"));
        assert!(child.try_wait().unwrap().is_some());
    }

    #[test]
    fn deliberate_child_kill_wait_cleanup_is_idempotent() {
        let mut child = Command::new("sh").args(["-c", "sleep 2"]).spawn().unwrap();
        assert!(stop_child(&mut child).is_ok());
        assert!(child.try_wait().unwrap().is_some());
        assert!(stop_child(&mut child).is_ok());
    }

    #[test]
    fn session_runtime_routes_preserve_ids_queries_auth_wrappers_and_cursors() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let expected = [
                "/api/session/ses_exact/message?order=asc&limit=2",
                "/api/session/active",
                "/api/session/ses_exact/permission",
                "/api/session/ses_exact/form",
                "/api/experimental/session/ses_exact/log?follow=false&after=17",
            ];
            for path in expected {
                let (mut stream, _) = listener.accept().unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request_line = String::new();
                reader.read_line(&mut request_line).unwrap();
                let mut headers = String::new();
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    headers.push_str(&line);
                }
                assert_eq!(
                    request_line.split_whitespace().collect::<Vec<_>>(),
                    vec!["GET", path, "HTTP/1.1"]
                );
                assert!(headers.to_ascii_lowercase().contains(&format!(
                    "authorization: basic {}",
                    STANDARD.encode("opencode:secret").to_ascii_lowercase()
                )));
                let body = if path.ends_with("message?order=asc&limit=2") {
                    r#"{"data":[{"id":"m1"}],"cursor":{"previous":null,"next":"3"}}"#
                } else if path.ends_with("/active") {
                    r#"{"data":{"ses_exact":{"type":"running"}}}"#
                } else if path.ends_with("/permission") {
                    r#"{"data":[{"id":"p1"}]}"#
                } else if path.ends_with("/form") {
                    r#"{"data":[{"id":"f1"}]}"#
                } else {
                    "data: {\"seq\":18}\n\n"
                };
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        let runtime = Runtime {
            server: Mutex::new(Some(Server {
                child: Command::new("sh").args(["-c", "sleep 2"]).spawn().unwrap(),
                info: RuntimeInfo {
                    executable: "fake".into(),
                    version: "2.0.27".into(),
                    base_url: format!("http://{address}"),
                },
                _password: "secret".into(),
                client: api_client("secret").unwrap(),
            })),
            terminals: TerminalManager::default(),
            lifecycle: AtomicU8::new(0),
            lifecycle_gate: Mutex::new(()),
        };
        let history = runtime.session_history("ses_exact", "asc", 2).unwrap();
        assert_eq!(history.session_id, "ses_exact");
        assert_eq!(history.cursor.next.as_deref(), Some("3"));
        assert_eq!(
            runtime
                .session_status("ses_exact")
                .unwrap()
                .active
                .unwrap()
                .kind,
            "running"
        );
        assert_eq!(
            runtime.permissions("ses_exact").unwrap(),
            vec![json!({"id":"p1"})]
        );
        assert_eq!(
            runtime.forms("ses_exact").unwrap(),
            vec![json!({"id":"f1"})]
        );
        assert_eq!(
            runtime
                .durable_session_events("ses_exact", Some("17"), false)
                .unwrap(),
            vec![json!({"seq":18})]
        );
        server.join().unwrap();
        runtime.shutdown();
    }

    fn make_executable(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
}
