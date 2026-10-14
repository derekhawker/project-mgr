use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, RwLock, RwLockReadGuard};
use std::thread;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

pub mod session_state;

const DEFAULT_MODEL: &str = "openai/gpt-6-luna";
const SETTINGS_FILE: &str = "quick-request-settings.json";
// The v2.0.27 catalog marks this model active even though its prompt endpoint
// rejects it as deprecated, so it must not be offered as a selectable model.
const KNOWN_DEPRECATED_MODELS: &[&str] = &["opencode/exo-free"];

struct ServerProcess {
    child: ChildGuard<Child>,
    base_url: String,
    version: String,
    password: String,
}

struct SessionTerminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<ChildGuard<Box<dyn PtyChild + Send + Sync>>>,
}

trait ChildCleanup {
    fn kill_and_wait(&mut self) -> Result<(), String>;
}

impl ChildCleanup for Child {
    fn kill_and_wait(&mut self) -> Result<(), String> {
        let kill_error = self.kill().err();
        self.wait()
            .map(|_| ())
            .map_err(|wait_error| match kill_error {
                Some(kill_error) => {
                    format!("kill failed ({kill_error}) and wait failed ({wait_error})")
                }
                None => format!("wait failed ({wait_error})"),
            })
    }
}

impl ChildCleanup for Box<dyn PtyChild + Send + Sync> {
    fn kill_and_wait(&mut self) -> Result<(), String> {
        let kill_error = self.kill().err();
        self.wait()
            .map(|_| ())
            .map_err(|wait_error| match kill_error {
                Some(kill_error) => {
                    format!("kill failed ({kill_error}) and wait failed ({wait_error})")
                }
                None => format!("wait failed ({wait_error})"),
            })
    }
}

struct ChildGuard<T: ChildCleanup> {
    child: Option<T>,
    cleanup_on_drop: bool,
}

impl<T: ChildCleanup> ChildGuard<T> {
    fn new(child: T) -> Self {
        Self {
            child: Some(child),
            cleanup_on_drop: true,
        }
    }

    fn child_mut(&mut self) -> &mut T {
        self.child.as_mut().expect("guard owns its child")
    }

    fn disarm_after_registration(&mut self) {
        self.cleanup_on_drop = false;
    }
}

impl<T: ChildCleanup> Drop for ChildGuard<T> {
    fn drop(&mut self) {
        if self.cleanup_on_drop {
            if let Some(child) = self.child.as_mut() {
                if let Err(error) = child.kill_and_wait() {
                    eprintln!("Could not clean up an unregistered child process: {error}");
                }
            }
        }
    }
}

struct AppState {
    quick_requests_dir: PathBuf,
    server: Mutex<Option<ServerProcess>>,
    terminals: Mutex<HashMap<String, Arc<SessionTerminal>>>,
    lifecycle: RwLock<Lifecycle>,
}

#[derive(PartialEq, Eq)]
enum Lifecycle {
    Running,
    ShuttingDown,
    Shutdown,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrototypeInfo {
    version: String,
    directory: String,
    default_model: String,
    models: Vec<ModelOption>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelOption {
    reference: String,
    name: String,
}

#[derive(Clone, Debug, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelSettings {
    #[serde(default = "default_model")]
    default_model: String,
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            default_model: default_model(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QuickRequestInfo {
    session_id: String,
    title: String,
    directory: String,
    server_version: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data_base64: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
}

#[derive(serde::Deserialize)]
struct InfoResponse {
    version: String,
}

impl AppState {
    fn new() -> Self {
        let quick_requests_dir = std::env::temp_dir()
            .join("opencode-project-mgr-prototype")
            .join("quick-requests");

        Self {
            quick_requests_dir,
            server: Mutex::new(None),
            terminals: Mutex::new(HashMap::new()),
            lifecycle: RwLock::new(Lifecycle::Running),
        }
    }

    fn begin_child_operation(&self) -> Result<RwLockReadGuard<'_, Lifecycle>, String> {
        let lifecycle = self
            .lifecycle
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if *lifecycle != Lifecycle::Running {
            return Err("The application is shutting down.".to_owned());
        }
        Ok(lifecycle)
    }

    fn shutdown(&self) -> Result<(), String> {
        let mut lifecycle = self
            .lifecycle
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if *lifecycle == Lifecycle::Shutdown {
            return Ok(());
        }

        // Holding the write lock prevents a concurrent session command from
        // registering a new PTY or starting the server during teardown.
        *lifecycle = Lifecycle::ShuttingDown;
        shutdown_children(&self.terminals, &self.server)?;
        *lifecycle = Lifecycle::Shutdown;
        Ok(())
    }
}

impl Drop for AppState {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            eprintln!("Could not fully shut down Quick Request children: {error}");
        }
    }
}

fn shutdown_children(
    terminals: &Mutex<HashMap<String, Arc<SessionTerminal>>>,
    server: &Mutex<Option<ServerProcess>>,
) -> Result<(), String> {
    let mut errors = Vec::new();

    let terminals = terminals
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    for (session_id, terminal) in terminals.iter() {
        let mut child = terminal
            .child
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let child = child.child_mut();
        let _ = child.kill();
        if let Err(error) = child.wait() {
            errors.push(format!(
                "Could not wait for TUI child {session_id}: {error}"
            ));
        }
    }
    drop(terminals);

    let mut server = server
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(server) = server.as_mut() {
        let child = server.child.child_mut();
        let _ = child.kill();
        if let Err(error) = child.wait() {
            errors.push(format!(
                "Could not wait for the OpenCode server child: {error}"
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[tauri::command]
fn prototype_info(app: AppHandle, state: State<'_, AppState>) -> Result<PrototypeInfo, String> {
    let settings = load_model_settings(
        &app.path()
            .app_config_dir()
            .map_err(|error| format!("Could not locate Quick Request settings: {error}"))?,
    )?;
    let (base_url, version) = ensure_server(&state)?;
    let client = api_client(&server_password(&state)?)?;
    let models = available_models(&client, &base_url)?;

    Ok(PrototypeInfo {
        version,
        directory: state.quick_requests_dir.to_string_lossy().into_owned(),
        default_model: settings.default_model,
        models,
    })
}

#[tauri::command]
fn start_quick_request(
    app: AppHandle,
    state: State<'_, AppState>,
    prompt: String,
    model: String,
) -> Result<QuickRequestInfo, String> {
    let prompt = prompt.trim().to_owned();
    if prompt.is_empty() {
        return Err("Enter a prompt first.".to_owned());
    }
    let _lifecycle = state.begin_child_operation()?;

    fs::create_dir_all(&state.quick_requests_dir).map_err(|error| {
        format!("Could not create the shared Quick Requests directory: {error}")
    })?;

    let (base_url, server_version) = ensure_server(&state)?;
    let password = server_password(&state)?;
    let client = api_client(&password)?;
    let models = available_models(&client, &base_url)?;
    let model = require_available_model(&model, &models)?;
    let title = request_title(&prompt);

    let session_response = client
        .post(format!("{base_url}/api/session"))
        .json(&create_session_payload(
            &title,
            &state.quick_requests_dir.to_string_lossy(),
            &model,
        )?)
        .send()
        .map_err(|error| format!("Could not create an OpenCode session: {error}"))?;
    let session_response = ensure_success(session_response)?;
    let session: Value = session_response
        .json()
        .map_err(|error| format!("OpenCode returned an invalid session response: {error}"))?;
    let session = unwrap_data_value(session)?;
    let session_id = session
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenCode's session response did not include an ID.".to_owned())?
        .to_owned();

    open_session_terminal(app, &state, &base_url, &session_id, &password)?;
    wait_for_terminal(&state, &session_id)?;

    Ok(QuickRequestInfo {
        session_id,
        title,
        directory: state.quick_requests_dir.to_string_lossy().into_owned(),
        server_version,
    })
}

#[tauri::command]
fn restore_latest_quick_request(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<QuickRequestInfo, String> {
    let _lifecycle = state.begin_child_operation()?;
    fs::create_dir_all(&state.quick_requests_dir).map_err(|error| {
        format!("Could not create the shared Quick Requests directory: {error}")
    })?;

    let (base_url, server_version) = ensure_server(&state)?;
    let directory = state.quick_requests_dir.to_string_lossy().into_owned();
    let password = server_password(&state)?;
    let client = api_client(&password)?;
    let response = client
        .get(format!("{base_url}/api/session"))
        .query(&[
            ("directory", directory.as_str()),
            ("order", "desc"),
            ("limit", "50"),
        ])
        .send()
        .map_err(|error| format!("Could not list Quick Request sessions: {error}"))?;
    let sessions: Vec<Value> = unwrap_data_array(
        ensure_success(response)?
            .json()
            .map_err(|error| format!("OpenCode returned an invalid session list: {error}"))?,
    )?;
    let session = latest_populated_session(sessions, &directory, |session| {
        let session_id = session
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| "OpenCode's session record did not include an ID.".to_owned())?
            .to_owned();
        let response = client
            .get(format!("{base_url}/api/session/{session_id}/message"))
            .send()
            .map_err(|error| format!("Could not inspect a Quick Request session: {error}"))?;
        let messages: Vec<Value> = unwrap_data_array(
            ensure_success(response)?
                .json()
                .map_err(|error| format!("OpenCode returned an invalid message list: {error}"))?,
        )?;
        Ok(has_user_message(&messages))
    })?
    .ok_or_else(|| "There are no previous Quick Requests with a prompt to reopen.".to_owned())?;
    let session_id = session
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| "OpenCode's session record did not include an ID.".to_owned())?
        .to_owned();
    let title = session
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Quick Request")
        .to_owned();

    let already_attached = state
        .terminals
        .lock()
        .map_err(|_| "The terminal manager is unavailable.".to_owned())?
        .contains_key(&session_id);
    if !already_attached {
        open_session_terminal(app, &state, &base_url, &session_id, &password)?;
        wait_for_terminal(&state, &session_id)?;
    }

    Ok(QuickRequestInfo {
        session_id,
        title,
        directory,
        server_version,
    })
}

fn latest_populated_session(
    sessions: Vec<Value>,
    directory: &str,
    mut has_prompt: impl FnMut(&Value) -> Result<bool, String>,
) -> Result<Option<Value>, String> {
    let mut sessions: Vec<Value> = sessions
        .into_iter()
        .filter(|session| {
            session
                .get("location")
                .and_then(|location| location.get("directory"))
                .and_then(Value::as_str)
                == Some(directory)
        })
        .collect();
    sessions.sort_by_key(|session| {
        session
            .get("time")
            .and_then(|time| time.get("updated"))
            .and_then(Value::as_u64)
            .unwrap_or_default()
    });

    for session in sessions.into_iter().rev() {
        if has_prompt(&session)? {
            return Ok(Some(session));
        }
    }

    Ok(None)
}

fn has_user_message(messages: &[Value]) -> bool {
    messages.iter().any(|message| {
        message
            .get("info")
            .and_then(|info| info.get("role"))
            .and_then(Value::as_str)
            == Some("user")
    })
}

fn opencode_is_executable(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn opencode_home_directory() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var_os("HOME").map(PathBuf::from)
    }
}

/// Resolve the exact executable used by every OpenCode child process.
///
/// This takes its environment as arguments so tests can exercise PATH-free
/// launches without changing process-global environment variables.
fn resolve_opencode_from(
    override_path: Option<&OsStr>,
    path: Option<&OsStr>,
    home: Option<&Path>,
) -> Result<PathBuf, String> {
    let mut attempted = Vec::new();
    let mut candidates = Vec::new();
    let mut add_candidate = |candidate: PathBuf| {
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    };

    if let Some(override_path) = override_path {
        add_candidate(PathBuf::from(override_path));
    }
    if let Some(path) = path {
        for directory in std::env::split_paths(path) {
            // Empty PATH components mean the current directory. Do not
            // silently run an unrelated executable from the launch cwd.
            if !directory.as_os_str().is_empty() {
                add_candidate(directory.join("opencode"));
                #[cfg(windows)]
                add_candidate(directory.join("opencode.exe"));
            }
        }
    }
    if let Some(home) = home {
        add_candidate(home.join(".opencode").join("bin").join("opencode"));
        add_candidate(home.join(".local").join("bin").join("opencode"));
        #[cfg(windows)]
        {
            add_candidate(home.join(".opencode").join("bin").join("opencode.exe"));
            add_candidate(home.join(".local").join("bin").join("opencode.exe"));
        }
    }

    for candidate in candidates {
        attempted.push(candidate.display().to_string());
        if opencode_is_executable(&candidate) {
            return Ok(candidate);
        }
    }

    let attempted = if attempted.is_empty() {
        "(no candidate paths were available)".to_owned()
    } else {
        attempted.join(", ")
    };
    Err(format!(
        "Could not find an executable OpenCode binary. Attempted: {attempted}. Set OPENCODE_BIN to the full path of the executable (for example, OPENCODE_BIN=/path/to/opencode) and restart the app."
    ))
}

fn resolve_opencode() -> Result<PathBuf, String> {
    resolve_opencode_from(
        std::env::var_os("OPENCODE_BIN").as_deref(),
        std::env::var_os("PATH").as_deref(),
        opencode_home_directory().as_deref(),
    )
}

fn open_session_terminal(
    app: AppHandle,
    state: &AppState,
    base_url: &str,
    session_id: &str,
    password: &str,
) -> Result<(), String> {
    let opencode = resolve_opencode()?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 28,
            cols: 112,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("Could not open a terminal for OpenCode: {error}"))?;

    let mut command = CommandBuilder::new(opencode);
    command.arg("--server");
    command.arg(base_url);
    command.arg("--session");
    command.arg(session_id);
    command.arg(&state.quick_requests_dir);
    command.cwd(&state.quick_requests_dir);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("OPENCODE_SERVER_PASSWORD", password);

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("Could not open OpenCode's terminal: {error}"))?;
    let child = ChildGuard::new(child);
    drop(pair.slave);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("Could not read the OpenCode terminal: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("Could not write to the OpenCode terminal: {error}"))?;

    // Keep the cleanup guard armed until the terminal is registered.
    let mut terminals = state
        .terminals
        .lock()
        .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
    let terminal = Arc::new(SessionTerminal {
        master: Mutex::new(pair.master),
        writer: Mutex::new(writer),
        child: Mutex::new(child),
    });
    register_terminal(&mut terminals, session_id, Arc::clone(&terminal))?;
    terminal
        .child
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .disarm_after_registration();
    drop(terminals);
    forward_terminal_output(app, session_id.to_owned(), reader);
    Ok(())
}

fn register_terminal(
    terminals: &mut HashMap<String, Arc<SessionTerminal>>,
    session_id: &str,
    terminal: Arc<SessionTerminal>,
) -> Result<(), String> {
    match terminals.entry(session_id.to_owned()) {
        std::collections::hash_map::Entry::Vacant(entry) => {
            entry.insert(terminal);
            Ok(())
        }
        std::collections::hash_map::Entry::Occupied(_) => Err(format!(
            "An OpenCode terminal is already registered for session {session_id}."
        )),
    }
}

fn wait_for_terminal(state: &AppState, session_id: &str) -> Result<(), String> {
    // Let the TUI connect before showing its view or sending an initial turn.
    thread::sleep(Duration::from_millis(900));
    let terminals = state
        .terminals
        .lock()
        .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
    let terminal = terminals
        .get(session_id)
        .ok_or_else(|| "The OpenCode terminal was not registered.".to_owned())?;
    let status = terminal
        .child
        .lock()
        .map_err(|_| "The OpenCode terminal process is unavailable.".to_owned())?
        .child_mut()
        .try_wait()
        .map_err(|error| format!("Could not check the OpenCode terminal: {error}"))?;
    if let Some(status) = status {
        return Err(format!("OpenCode's TUI exited before opening ({status})."));
    }
    Ok(())
}

#[tauri::command]
fn send_initial_prompt(
    state: State<'_, AppState>,
    session_id: String,
    prompt: String,
    model: String,
) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("Enter a prompt first.".to_owned());
    }
    let _lifecycle = state.begin_child_operation()?;
    if !state
        .terminals
        .lock()
        .map_err(|_| "The terminal manager is unavailable.".to_owned())?
        .contains_key(&session_id)
    {
        return Err("The OpenCode terminal was not opened for this request.".to_owned());
    }

    let (base_url, _) = ensure_server(&state)?;
    let client = api_client(&server_password(&state)?)?;
    let models = available_models(&client, &base_url)?;
    let model = require_available_model(&model, &models)?;
    let model_response = client
        .post(format!("{base_url}/api/session/{session_id}/model"))
        .json(&json!({ "model": model_reference_payload(&model)? }))
        .send()
        .map_err(|error| format!("Could not set the selected model for this session: {error}"))?;
    ensure_success(model_response)?;

    let response = client
        .post(format!("{base_url}/api/session/{session_id}/prompt"))
        .json(&initial_prompt_payload(&prompt))
        .send()
        .map_err(|error| format!("Could not send the first prompt to OpenCode: {error}"))?;
    ensure_success(response)?;
    Ok(())
}

#[tauri::command]
fn write_terminal(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
    let terminal = terminals
        .get(&session_id)
        .ok_or_else(|| "This OpenCode terminal is no longer available.".to_owned())?;
    let mut writer = terminal
        .writer
        .lock()
        .map_err(|_| "The terminal input stream is unavailable.".to_owned())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| format!("Could not write to the OpenCode terminal: {error}"))
}

#[tauri::command]
fn resize_terminal(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let terminals = state
        .terminals
        .lock()
        .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
    let terminal = terminals
        .get(&session_id)
        .ok_or_else(|| "This OpenCode terminal is no longer available.".to_owned())?;
    let resize_result = terminal
        .master
        .lock()
        .map_err(|_| "The terminal resize handle is unavailable.".to_owned())?
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    resize_result.map_err(|error| format!("Could not resize the OpenCode terminal: {error}"))
}

fn opencode_version(opencode: &Path) -> Result<String, String> {
    let output = Command::new(opencode)
        .arg("--version")
        .output()
        .map_err(|error| format!("Could not run the installed OpenCode command: {error}"))?;
    if !output.status.success() {
        return Err("The installed OpenCode command could not report its version.".to_owned());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn opencode_cli_compatibility(opencode: &Path) -> Result<String, String> {
    let version = opencode_version(opencode)?;
    let root_help = Command::new(opencode)
        .arg("--help")
        .output()
        .map_err(|error| format!("Could not check the OpenCode root command: {error}"))?;
    if !root_help.status.success() {
        return Err("This OpenCode installation could not show its root help.".to_owned());
    }
    validate_root_help(&root_help.stdout, &root_help.stderr)?;
    Ok(version)
}

fn validate_root_help(stdout: &[u8], stderr: &[u8]) -> Result<(), String> {
    let help = format!(
        "{}\n{}",
        String::from_utf8_lossy(stdout),
        String::from_utf8_lossy(stderr)
    );
    if !help.contains("--server") || !help.contains("--session") {
        return Err("This OpenCode root command does not support the required `--server` and `--session` options.".to_owned());
    }
    Ok(())
}

fn default_model() -> String {
    DEFAULT_MODEL.to_owned()
}

fn load_model_settings(config_dir: &Path) -> Result<ModelSettings, String> {
    fs::create_dir_all(config_dir).map_err(|error| {
        format!("Could not create the Quick Request settings directory: {error}")
    })?;
    let path = config_dir.join(SETTINGS_FILE);

    match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(mut file) => {
            let initial = serde_json::to_vec_pretty(&ModelSettings::default())
                .map_err(|error| format!("Could not encode the default model setting: {error}"))?;
            if let Err(error) = file.write_all(&initial) {
                let _ = fs::remove_file(&path);
                return Err(format!(
                    "Could not write the default model setting: {error}"
                ));
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => {
            return Err(format!("Could not create Quick Request settings: {error}"));
        }
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read Quick Request settings: {error}"))?;
    let mut settings: ModelSettings = serde_json::from_str(&contents)
        .map_err(|error| format!("Quick Request settings are not valid JSON: {error}"))?;
    let default_model = settings.default_model.trim().to_owned();
    model_reference_payload(&default_model).map_err(|_| {
        format!(
            "Quick Request setting `defaultModel` must be a provider/model ID; got {:?}.",
            settings.default_model
        )
    })?;
    settings.default_model = default_model;
    Ok(settings)
}

fn available_models(client: &Client, base_url: &str) -> Result<Vec<ModelOption>, String> {
    let response = client
        .get(format!("{base_url}/api/model"))
        .send()
        .map_err(|error| format!("Could not load models from OpenCode: {error}"))?;
    let response: Value = ensure_success(response)?
        .json()
        .map_err(|error| format!("OpenCode returned an invalid model list: {error}"))?;
    parse_model_options(response)
}

fn parse_model_options(response: Value) -> Result<Vec<ModelOption>, String> {
    let models: Vec<Value> = unwrap_data_array(response)?;
    let mut options: Vec<ModelOption> = models
        .into_iter()
        .filter_map(|model| {
            let provider_id = model.get("providerID")?.as_str()?;
            let model_id = model.get("id")?.as_str()?;
            let status = model.get("status")?.as_str()?;
            if status == "deprecated" || !model.get("enabled")?.as_bool()? {
                return None;
            }

            let reference = format!("{provider_id}/{model_id}");
            if KNOWN_DEPRECATED_MODELS.contains(&reference.as_str()) {
                return None;
            }

            Some(ModelOption {
                name: model
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or(&reference)
                    .to_owned(),
                reference,
            })
        })
        .collect();
    options.sort_by(|left, right| {
        left.name
            .cmp(&right.name)
            .then_with(|| left.reference.cmp(&right.reference))
    });
    options.dedup_by(|left, right| left.reference == right.reference);
    Ok(options)
}

fn require_available_model(reference: &str, models: &[ModelOption]) -> Result<String, String> {
    let reference = reference.trim();
    model_reference_payload(reference)?;
    if models.iter().any(|model| model.reference == reference) {
        Ok(reference.to_owned())
    } else {
        Err(format!(
            "The selected model `{reference}` is not available. Choose an enabled model from the list; OpenCode's default will not be used."
        ))
    }
}

fn model_reference_payload(reference: &str) -> Result<Value, String> {
    let (provider_id, model_id) = reference
        .split_once('/')
        .ok_or_else(|| format!("Invalid model ID `{reference}`; expected provider/model."))?;
    if provider_id.trim().is_empty() || model_id.trim().is_empty() || model_id.contains('#') {
        return Err(format!(
            "Invalid model ID `{reference}`; expected provider/model without a variant."
        ));
    }
    Ok(json!({ "providerID": provider_id, "id": model_id }))
}

fn create_session_payload(title: &str, directory: &str, model: &str) -> Result<Value, String> {
    Ok(json!({
        "title": title,
        "location": { "directory": directory },
        "model": model_reference_payload(model)?
    }))
}

fn initial_prompt_payload(prompt: &str) -> Value {
    json!({ "text": prompt })
}

fn ensure_server(state: &AppState) -> Result<(String, String), String> {
    let mut server_guard = state
        .server
        .lock()
        .map_err(|_| "The OpenCode server manager is unavailable.".to_owned())?;

    if let Some(server) = server_guard.as_mut() {
        if server
            .child
            .child_mut()
            .try_wait()
            .map_err(|error| format!("Could not check the OpenCode server: {error}"))?
            .is_none()
        {
            return Ok((server.base_url.clone(), server.version.clone()));
        }
        *server_guard = None;
    }

    let opencode = resolve_opencode()?;
    let cli_version = opencode_cli_compatibility(&opencode)?;
    let password = generate_server_password()?;

    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|error| format!("Could not reserve a local OpenCode port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not determine a local OpenCode port: {error}"))?
        .port();
    drop(listener);

    let child = Command::new(&opencode)
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(&state.quick_requests_dir)
        .env("OPENCODE_SERVER_PASSWORD", &password)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("Could not start the OpenCode server: {error}"))?;
    let mut child = ChildGuard::new(child);

    let base_url = format!("http://127.0.0.1:{port}");
    let client = api_client(&password)?;
    let mut api_version = None;
    for _ in 0..80 {
        if let Some(status) = child
            .child_mut()
            .try_wait()
            .map_err(|error| format!("Could not check the OpenCode server: {error}"))?
        {
            return Err(format!(
                "The OpenCode server exited during startup ({status})."
            ));
        }

        if let Ok(response) = client.get(format!("{base_url}/api/info")).send() {
            if let Ok(response) = response.error_for_status() {
                if let Ok(info) = response.json::<InfoResponse>() {
                    api_version = Some(info.version);
                    break;
                }
            }
        }
        thread::sleep(Duration::from_millis(200));
    }

    let Some(api_version) = api_version else {
        return Err("OpenCode's local server did not become ready within 16 seconds.".to_owned());
    };

    let version = format!("{cli_version} · server {api_version}");
    *server_guard = Some(ServerProcess {
        child,
        base_url: base_url.clone(),
        version: version.clone(),
        password,
    });
    server_guard
        .as_mut()
        .expect("server was just registered")
        .child
        .disarm_after_registration();
    Ok((base_url, version))
}

fn api_client(password: &str) -> Result<Client, String> {
    let mut builder = Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(30));

    let credentials = BASE64.encode(format!("opencode:{password}"));
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Basic {credentials}"))
            .map_err(|error| format!("Invalid OpenCode server credentials: {error}"))?,
    );
    builder = builder.default_headers(headers);

    builder
        .build()
        .map_err(|error| format!("Could not configure the OpenCode API client: {error}"))
}

fn server_password(state: &AppState) -> Result<String, String> {
    state
        .server
        .lock()
        .map_err(|_| "The OpenCode server manager is unavailable.".to_owned())?
        .as_ref()
        .map(|server| server.password.clone())
        .ok_or_else(|| "The OpenCode server is not running.".to_owned())
}

fn generate_server_password() -> Result<String, String> {
    let mut bytes = [0_u8; 24];
    let mut source = fs::File::open("/dev/urandom")
        .map_err(|error| format!("Could not create an OpenCode server password: {error}"))?;
    source
        .read_exact(&mut bytes)
        .map_err(|error| format!("Could not create an OpenCode server password: {error}"))?;
    Ok(BASE64.encode(bytes))
}

fn unwrap_data_value(value: Value) -> Result<Value, String> {
    value
        .get("data")
        .cloned()
        .ok_or_else(|| "OpenCode returned a response without a data value.".to_owned())
}

fn unwrap_data_array(value: Value) -> Result<Vec<Value>, String> {
    value
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| "OpenCode returned a response without a data array.".to_owned())
}

fn ensure_success(response: Response) -> Result<Response, String> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response.text().unwrap_or_default();
    Err(format!("OpenCode returned HTTP {status}: {body}"))
}

fn request_title(prompt: &str) -> String {
    let short_prompt: String = prompt
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(48)
        .collect();
    format!("Quick Request: {short_prompt}")
}

fn forward_terminal_output(app: AppHandle, session_id: String, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let event = TerminalOutput {
                        session_id: session_id.clone(),
                        data_base64: BASE64.encode(&buffer[..count]),
                    };
                    let _ = app.emit("terminal-output", event);
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        let _ = app.emit("terminal-exit", TerminalExit { session_id });
    });
}

fn tray_icon() -> Image<'static> {
    let mut rgba = vec![0_u8; 32 * 32 * 4];
    for y in 0..32 {
        for x in 0..32 {
            let dx = x as i32 - 15;
            let dy = y as i32 - 15;
            let distance = dx * dx + dy * dy;
            let color = if (distance > 52 && distance < 180) || (distance < 28) {
                [130, 226, 180, 255]
            } else if distance < 235 {
                [24, 38, 34, 255]
            } else {
                [0, 0, 0, 0]
            };
            let offset = ((y * 32 + x) * 4) as usize;
            rgba[offset..offset + 4].copy_from_slice(&color);
        }
    }
    Image::new_owned(rgba, 32, 32)
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .setup(|app| {
            let show_item =
                MenuItem::with_id(app, "show", "Show Quick Requests", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Prototype", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let tray = TrayIconBuilder::new()
                .icon(tray_icon())
                .tooltip("Quick Request Prototype")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let state = app.state::<AppState>();
                        match state.shutdown() {
                            Ok(()) => app.exit(0),
                            Err(error) => eprintln!(
                                "Quick Request shutdown did not complete; keeping the app running: {error}"
                            ),
                        }
                    }
                    _ => {}
                })
                .build(app)?;
            app.manage(tray);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            prototype_info,
            start_quick_request,
            restore_latest_quick_request,
            send_initial_prompt,
            write_terminal,
            resize_terminal
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Quick Request Prototype");
}

#[cfg(test)]
mod tests {
    use super::{
        create_session_payload, default_model, has_user_message, initial_prompt_payload,
        latest_populated_session, load_model_settings, model_reference_payload,
        parse_model_options, register_terminal, require_available_model, resolve_opencode_from,
        unwrap_data_array, unwrap_data_value, validate_root_help, AppState, ChildGuard,
        ModelOption, PrototypeInfo, QuickRequestInfo, ServerProcess, SessionTerminal,
        DEFAULT_MODEL, SETTINGS_FILE,
    };
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    fn unique_settings_dir() -> PathBuf {
        static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "quick-request-settings-test-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn unique_resolver_dir() -> PathBuf {
        static NEXT_ID: AtomicUsize = AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "quick-request-opencode-resolver-test-{}-{}",
            std::process::id(),
            NEXT_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn executable_fixture(directory: &PathBuf) -> PathBuf {
        fs::create_dir_all(directory).expect("create resolver fixture directory");
        let executable = directory.join("opencode");
        fs::write(&executable, b"#!/bin/sh\nexit 0\n").expect("write resolver fixture");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&executable, fs::Permissions::from_mode(0o755))
                .expect("make resolver fixture executable");
        }
        executable
    }

    #[test]
    fn resolves_a_temporary_executable_without_mutating_process_path() {
        let directory = unique_resolver_dir();
        let executable = executable_fixture(&directory);

        let resolved = resolve_opencode_from(None, Some(directory.as_os_str()), None)
            .expect("resolve fixture from supplied PATH");
        assert_eq!(resolved, executable);
        fs::remove_dir_all(directory).expect("remove resolver fixture");
    }

    #[test]
    fn resolves_user_local_binary_when_path_is_unavailable() {
        let home = unique_resolver_dir();
        let executable = executable_fixture(&home.join(".opencode").join("bin"));

        let resolved = resolve_opencode_from(None, None, Some(&home))
            .expect("resolve fixture from user-local candidate");
        assert_eq!(resolved, executable);
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn resolver_failure_lists_attempts_and_override_instructions() {
        let home = unique_resolver_dir();
        let override_path = home.join("configured-opencode");
        let path_directory = home.join("path");
        let error = resolve_opencode_from(
            Some(override_path.as_os_str()),
            Some(path_directory.as_os_str()),
            Some(&home),
        )
        .expect_err("missing resolver candidates must fail");

        assert!(error.contains(&override_path.display().to_string()));
        assert!(error.contains(&path_directory.join("opencode").display().to_string()));
        assert!(error.contains(&home.join(".opencode/bin/opencode").display().to_string()));
        assert!(error.contains("OPENCODE_BIN"));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn creates_per_user_settings_with_the_luna_default() {
        let config_dir = unique_settings_dir();
        let settings = load_model_settings(&config_dir).expect("create default settings");

        assert_eq!(settings.default_model, DEFAULT_MODEL);
        assert_eq!(default_model(), "openai/gpt-6-luna");
        let saved: serde_json::Value = serde_json::from_slice(
            &fs::read(config_dir.join(SETTINGS_FILE)).expect("read seeded settings file"),
        )
        .expect("settings are valid JSON");
        assert_eq!(saved["defaultModel"], "openai/gpt-6-luna");

        fs::remove_dir_all(config_dir).expect("remove test settings");
    }

    #[test]
    fn preserves_a_user_configured_default_model() {
        let config_dir = unique_settings_dir();
        fs::create_dir_all(&config_dir).expect("create test config directory");
        fs::write(
            config_dir.join(SETTINGS_FILE),
            r#"{"defaultModel":"anthropic/claude-sonnet-4-5"}"#,
        )
        .expect("write custom settings");

        let settings = load_model_settings(&config_dir).expect("load custom settings");
        assert_eq!(settings.default_model, "anthropic/claude-sonnet-4-5");

        fs::remove_dir_all(config_dir).expect("remove test settings");
    }

    #[test]
    fn rejects_a_default_model_setting_that_is_not_a_model_reference() {
        let config_dir = unique_settings_dir();
        fs::create_dir_all(&config_dir).expect("create test config directory");
        fs::write(config_dir.join(SETTINGS_FILE), r#"{"defaultModel":""}"#)
            .expect("write invalid settings");

        let error = load_model_settings(&config_dir).expect_err("reject invalid model setting");
        assert!(error.contains("defaultModel"));

        fs::remove_dir_all(config_dir).expect("remove test settings");
    }

    #[test]
    fn model_catalog_excludes_deprecated_disabled_and_known_stale_models() {
        let models = parse_model_options(json!({ "data": [
            {
                "providerID": "openai", "id": "gpt-6-luna", "name": "GPT-6 Luna",
                "status": "active", "enabled": true
            },
            {
                "providerID": "openai", "id": "retired", "name": "Retired",
                "status": "deprecated", "enabled": true
            },
            {
                "providerID": "openai", "id": "disabled", "name": "Disabled",
                "status": "active", "enabled": false
            },
            {
                "providerID": "opencode", "id": "exo-free", "name": "Exo Free",
                "status": "active", "enabled": true
            }
        ]}))
        .expect("parse model catalog");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].reference, "openai/gpt-6-luna");
        assert_eq!(models[0].name, "GPT-6 Luna");
    }

    #[test]
    fn chosen_model_is_required_and_encoded_in_v2_session_and_prompt_payloads() {
        let models = vec![ModelOption {
            reference: "openai/gpt-6-luna".to_owned(),
            name: "GPT-6 Luna".to_owned(),
        }];
        assert_eq!(
            require_available_model("openai/gpt-6-luna", &models).unwrap(),
            "openai/gpt-6-luna"
        );
        assert!(require_available_model("opencode/exo-free", &models).is_err());
        assert_eq!(
            model_reference_payload("openai/gpt-6-luna").unwrap(),
            json!({ "providerID": "openai", "id": "gpt-6-luna" })
        );
        assert_eq!(
            create_session_payload(
                "Quick Request: test",
                "/tmp/quick-requests",
                "openai/gpt-6-luna"
            )
            .unwrap(),
            json!({
                "title": "Quick Request: test",
                "location": { "directory": "/tmp/quick-requests" },
                "model": { "providerID": "openai", "id": "gpt-6-luna" }
            })
        );
        assert_eq!(
            initial_prompt_payload("Run the request"),
            json!({ "text": "Run the request" })
        );
    }

    #[test]
    fn tauri_command_results_serialize_selected_model_options_and_session_info() {
        let prototype_info = PrototypeInfo {
            version: "2.0.27".to_owned(),
            directory: "/tmp/quick-requests".to_owned(),
            default_model: DEFAULT_MODEL.to_owned(),
            models: vec![ModelOption {
                reference: DEFAULT_MODEL.to_owned(),
                name: "GPT-6 Luna".to_owned(),
            }],
        };
        assert_eq!(
            serde_json::to_value(prototype_info).unwrap(),
            json!({
                "version": "2.0.27",
                "directory": "/tmp/quick-requests",
                "defaultModel": "openai/gpt-6-luna",
                "models": [{ "reference": "openai/gpt-6-luna", "name": "GPT-6 Luna" }]
            })
        );

        let quick_request_info = QuickRequestInfo {
            session_id: "ses_123".to_owned(),
            title: "Quick Request".to_owned(),
            directory: "/tmp/quick-requests".to_owned(),
            server_version: "2.0.27".to_owned(),
        };
        assert_eq!(
            serde_json::to_value(quick_request_info).unwrap(),
            json!({
                "sessionId": "ses_123",
                "title": "Quick Request",
                "directory": "/tmp/quick-requests",
                "serverVersion": "2.0.27"
            })
        );
    }

    #[cfg(target_os = "linux")]
    fn sleeping_pty_terminal() -> (Arc<SessionTerminal>, u32) {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open test PTY");
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("exec sleep 5");
        let child = pair.slave.spawn_command(command).expect("spawn PTY child");
        let pid = child.process_id().expect("test PTY child has a pid");
        let writer = pair.master.take_writer().expect("take PTY writer");

        (
            Arc::new(SessionTerminal {
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                child: Mutex::new({
                    let mut child = ChildGuard::new(child);
                    child.disarm_after_registration();
                    child
                }),
            }),
            pid,
        )
    }

    #[cfg(target_os = "linux")]
    fn assert_reaped(pid: u32) {
        assert!(
            !std::path::Path::new(&format!("/proc/{pid}")).exists(),
            "child {pid} should have exited and been reaped"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unregistered_child_guard_kills_and_reaps_server_and_pty_children() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open test PTY");
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("exec sleep 30");
        let child = pair.slave.spawn_command(command).expect("spawn PTY child");
        let pty_pid = child.process_id().expect("test PTY child has a pid");
        let mut pty_guard = ChildGuard::new(child);
        assert!(pty_guard
            .child_mut()
            .try_wait()
            .expect("check PTY child")
            .is_none());
        drop(pty_guard);
        assert_reaped(pty_pid);
        drop(pair);

        let mut server_child = Command::new("/bin/sh")
            .args(["-c", "exec sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test server child");
        let server_pid = server_child.id();
        assert!(server_child
            .try_wait()
            .expect("check server child")
            .is_none());
        drop(ChildGuard::new(server_child));
        assert_reaped(server_pid);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn duplicate_terminal_registration_rejects_and_reaps_the_second_child() {
        let state = AppState::new();
        let (existing_terminal, existing_pid) = sleeping_pty_terminal();
        state
            .terminals
            .lock()
            .expect("lock test terminals")
            .insert("test-session".to_owned(), Arc::clone(&existing_terminal));

        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("open duplicate test PTY");
        let mut command = CommandBuilder::new("/bin/sh");
        command.arg("-c");
        command.arg("exec sleep 30");
        let mut child = pair
            .slave
            .spawn_command(command)
            .expect("spawn duplicate PTY child");
        let duplicate_pid = child.process_id().expect("duplicate child has a pid");
        assert!(child
            .try_wait()
            .expect("check duplicate PTY child")
            .is_none());
        let writer = pair
            .master
            .take_writer()
            .expect("take duplicate PTY writer");
        let duplicate_terminal = Arc::new(SessionTerminal {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(ChildGuard::new(child)),
        });

        let result = register_terminal(
            &mut state.terminals.lock().expect("lock test terminals"),
            "test-session",
            duplicate_terminal,
        );

        assert_eq!(
            result.expect_err("duplicate terminal registration must fail"),
            "An OpenCode terminal is already registered for session test-session."
        );
        assert_reaped(duplicate_pid);
        assert!(Arc::ptr_eq(
            state
                .terminals
                .lock()
                .expect("lock test terminals")
                .get("test-session")
                .expect("original terminal remains registered"),
            &existing_terminal
        ));

        state.shutdown().expect("shutdown the original terminal");
        assert_reaped(existing_pid);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn shutdown_waits_for_pty_and_server_children_and_is_idempotent() {
        let state = AppState::new();
        let (terminal, terminal_pid) = sleeping_pty_terminal();
        state
            .terminals
            .lock()
            .expect("lock test terminals")
            .insert("test-session".to_owned(), terminal);

        let server_child = Command::new("/bin/sh")
            .args(["-c", "exec sleep 5"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test server child");
        let server_pid = server_child.id();
        let mut server_child = ChildGuard::new(server_child);
        server_child.disarm_after_registration();
        *state.server.lock().expect("lock test server") = Some(ServerProcess {
            child: server_child,
            base_url: String::new(),
            version: String::new(),
            password: String::new(),
        });

        state.shutdown().expect("shutdown waits for all children");
        assert_reaped(terminal_pid);
        assert_reaped(server_pid);

        // AppState::drop also invokes shutdown, so a second call must be safe.
        state.shutdown().expect("repeated shutdown is safe");
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn drop_fallback_waits_for_pty_children() {
        let state = AppState::new();
        let (terminal, terminal_pid) = sleeping_pty_terminal();
        state
            .terminals
            .lock()
            .expect("lock test terminals")
            .insert("test-session".to_owned(), Arc::clone(&terminal));

        drop(state);

        assert_reaped(terminal_pid);
    }

    #[test]
    fn accepts_v2_root_options_when_help_is_written_to_stderr() {
        let stderr = b"Usage: opencode [OPTIONS] [DIRECTORY]\n  --server <url>\n  --session <id>\n";
        assert!(validate_root_help(b"", stderr).is_ok());
    }

    #[test]
    fn rejects_root_help_without_v2_session_flags() {
        assert!(validate_root_help(b"Usage: opencode\n  --standalone\n", b"").is_err());
    }

    #[test]
    fn unwraps_v2_create_and_collection_responses() {
        let session = unwrap_data_value(json!({"data": {"id": "ses_123"}})).unwrap();
        assert_eq!(session["id"], "ses_123");
        let records =
            unwrap_data_array(json!({"data": [{"id": "ses_123"}], "cursor": {}})).unwrap();
        assert_eq!(records.len(), 1);
    }

    #[test]
    fn does_not_restore_a_quick_request_without_a_user_prompt() {
        assert!(!has_user_message(&[]));
        assert!(!has_user_message(&[json!({"info": {"role": "assistant"}})]));
        assert!(has_user_message(&[json!({"info": {"role": "user"}})]));
    }

    #[test]
    fn restores_latest_populated_v2_session_from_the_exact_location_directory() {
        let directory = "/tmp/opencode-project-mgr-prototype/quick-requests";
        let sessions = vec![
            json!({
                "id": "ses_same_directory_earlier_populated",
                "slug": "same-directory-earlier-populated",
                "projectID": "global",
                "title": "Quick Request: earlier prompt",
                "version": "2.0.27",
                "location": {"directory": directory},
                "time": {"created": 100, "updated": 200}
            }),
            json!({
                "id": "ses_same_directory_latest_populated",
                "slug": "same-directory-latest-populated",
                "projectID": "global",
                "title": "Quick Request: latest prompt",
                "version": "2.0.27",
                "location": {"directory": directory},
                "time": {"created": 250, "updated": 300}
            }),
            json!({
                "id": "ses_same_directory_empty",
                "slug": "same-directory-empty",
                "projectID": "global",
                "title": "Quick Request: newer empty session",
                "version": "2.0.27",
                "location": {"directory": directory},
                "time": {"created": 350, "updated": 400}
            }),
            json!({
                "id": "ses_different_directory_populated",
                "slug": "different-directory-populated",
                "projectID": "global",
                "title": "Other session",
                "version": "2.0.27",
                "location": {"directory": "/tmp/another-workspace"},
                "time": {"created": 500, "updated": 600}
            }),
        ];
        let messages_by_session = HashMap::from([
            (
                "ses_same_directory_earlier_populated",
                json!({"data": [{
                    "id": "msg_earlier_user",
                    "sessionID": "ses_same_directory_earlier_populated",
                    "time": {"created": 100},
                    "info": {"role": "user"},
                    "parts": [{"type": "text", "text": "Earlier prompt"}]
                }]}),
            ),
            (
                "ses_same_directory_latest_populated",
                json!({"data": [{
                    "id": "msg_latest_user",
                    "sessionID": "ses_same_directory_latest_populated",
                    "time": {"created": 250},
                    "info": {"role": "user"},
                    "parts": [{"type": "text", "text": "Latest prompt"}]
                }]}),
            ),
            ("ses_same_directory_empty", json!({"data": []})),
            (
                "ses_different_directory_populated",
                json!({"data": [{
                    "id": "msg_other_user",
                    "sessionID": "ses_different_directory_populated",
                    "time": {"created": 500},
                    "info": {"role": "user"},
                    "parts": [{"type": "text", "text": "Other prompt"}]
                }]}),
            ),
        ]);

        let selected = latest_populated_session(sessions, directory, |session| {
            let session_id = session
                .get("id")
                .and_then(serde_json::Value::as_str)
                .expect("v2 session has an ID");
            let messages = unwrap_data_array(messages_by_session[session_id].clone())?;
            Ok(has_user_message(&messages))
        })
        .unwrap()
        .expect("the populated same-directory session should be restorable");

        assert_eq!(selected["id"], "ses_same_directory_latest_populated");
        assert_ne!(selected["id"], "ses_same_directory_earlier_populated");
        assert_ne!(selected["id"], "ses_different_directory_populated");
        assert_eq!(selected["location"]["directory"], directory);
        assert!(selected.get("directory").is_none());
    }
}
