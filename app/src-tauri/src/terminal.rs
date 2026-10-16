//! The session-neutral PTY bridge.  This module deliberately knows nothing
//! about workspaces or Quick Requests: its routing key is always the exact
//! OpenCode session id supplied by the caller.
use base64::{engine::general_purpose::STANDARD, Engine as _};
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter};

/// The complete child-process contract, kept separate from PTY allocation so
/// it can be checked without starting a GUI or an OpenCode process.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TerminalLaunchSpec {
    pub executable: String,
    pub args: Vec<String>,
    pub directory: String,
    pub env: Vec<(String, String)>,
}

pub fn launch_spec(
    executable: &Path,
    server_url: &str,
    password: &str,
    session_id: &str,
    directory: &Path,
) -> TerminalLaunchSpec {
    TerminalLaunchSpec {
        executable: executable.display().to_string(),
        args: vec![
            "--server".into(),
            server_url.into(),
            "--session".into(),
            session_id.into(),
            directory.display().to_string(),
        ],
        directory: directory.display().to_string(),
        env: vec![
            ("TERM".into(), "xterm-256color".into()),
            ("COLORTERM".into(), "truecolor".into()),
            ("OPENCODE_SERVER_PASSWORD".into(), password.into()),
        ],
    }
}

/// Session-keyed event ordering is intentionally boring: the reader emits in
/// arrival order and never lets one session consume another's events.
#[derive(Default)]
pub struct TerminalEventRouter {
    events: HashMap<String, Vec<TerminalEvent>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TerminalEvent {
    Output(Vec<u8>),
    Exit,
}

impl TerminalEventRouter {
    pub fn push(&mut self, session_id: &str, event: TerminalEvent) {
        self.events
            .entry(session_id.into())
            .or_default()
            .push(event);
    }
    pub fn drain(&mut self, session_id: &str) -> Vec<TerminalEvent> {
        self.events.remove(session_id).unwrap_or_default()
    }
}

#[derive(Default)]
pub struct TerminalAttachments(HashMap<String, ()>);

impl TerminalAttachments {
    pub fn reserve(&mut self, session_id: &str) -> Result<(), String> {
        if self.0.insert(session_id.into(), ()).is_some() {
            return Err(format!(
                "An OpenCode terminal is already registered for session {session_id}."
            ));
        }
        Ok(())
    }
    pub fn release(&mut self, session_id: &str) {
        self.0.remove(session_id);
    }
    pub fn contains(&self, session_id: &str) -> bool {
        self.0.contains_key(session_id)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub session_id: String,
    pub data_base64: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExit {
    pub session_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalError {
    pub session_id: String,
    pub operation: String,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReplayEvent {
    pub kind: String,
    pub session_id: String,
    pub data_base64: Option<String>,
    pub operation: Option<String>,
    pub message: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalAttachResult {
    pub replay: Vec<TerminalReplayEvent>,
}

struct Terminal {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    child: Mutex<Box<dyn PtyChild + Send + Sync>>,
    exited: AtomicBool,
}

#[derive(Default)]
pub struct TerminalManager {
    terminals: Mutex<HashMap<String, Arc<Terminal>>>,
    cleanup_errors: Mutex<Vec<String>>,
    // Keep PTY startup output until the renderer explicitly completes the
    // attach handshake. This covers restore, where Rust may start the PTY
    // before the WebView has mounted listeners.
    startup_events: Arc<Mutex<HashMap<String, Vec<TerminalReplayEvent>>>>,
}

const STARTUP_REPLAY_LIMIT: usize = 256;

fn cleanup_child_errors<K, E, W>(
    context: &str,
    kill: Result<(), K>,
    wait: Result<W, E>,
) -> Vec<String>
where
    K: std::fmt::Display,
    E: std::fmt::Display,
{
    let mut errors = Vec::new();
    if let Err(error) = kill {
        errors.push(format!("{context}: kill failed: {error}"));
    }
    if let Err(error) = wait {
        errors.push(format!("{context}: wait failed: {error}"));
    }
    errors
}

fn record_startup_event(
    startup_events: &Arc<Mutex<HashMap<String, Vec<TerminalReplayEvent>>>>,
    session_id: &str,
    event: TerminalReplayEvent,
) {
    if let Ok(mut events) = startup_events.lock() {
        let queue = events.entry(session_id.to_owned()).or_default();
        if queue.len() >= STARTUP_REPLAY_LIMIT {
            queue.remove(0);
            if !queue
                .iter()
                .any(|event| event.operation.as_deref() == Some("replay-buffer"))
            {
                queue.push(TerminalReplayEvent {
                    kind: "error".into(),
                    session_id: session_id.to_owned(),
                    data_base64: None,
                    operation: Some("replay-buffer".into()),
                    message: Some(
                        "Terminal startup replay buffer overflowed; older output was dropped."
                            .into(),
                    ),
                });
                if queue.len() >= STARTUP_REPLAY_LIMIT {
                    queue.remove(0);
                }
            }
        }
        queue.push(event);
    }
}

impl TerminalManager {
    pub fn active_session_ids(&self) -> Vec<String> {
        self.terminals
            .lock()
            .map(|terminals| terminals.keys().cloned().collect())
            .unwrap_or_default()
    }
    pub fn is_attached(&self, session_id: &str) -> bool {
        self.terminals
            .lock()
            .map(|terminals| terminals.contains_key(session_id))
            .unwrap_or(false)
    }
    /// Give the child a short window to connect its TUI before a caller is
    /// allowed to issue the first prompt. This is intentionally Rust-owned;
    /// the WebView must not race session generation against PTY startup.
    pub fn wait_until_ready(&self, session_id: &str) -> Result<(), String> {
        thread::sleep(std::time::Duration::from_millis(900));
        let terminal = self.get(session_id)?;
        let mut child = terminal
            .child
            .lock()
            .map_err(|_| "The OpenCode terminal process is unavailable.".to_owned())?;
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("Could not check the OpenCode terminal: {e}"))?
        {
            return Err(format!("OpenCode's TUI exited before opening ({status})."));
        }
        Ok(())
    }

    pub fn attach(
        &self,
        app: AppHandle,
        executable: &Path,
        server_url: &str,
        password: &str,
        session_id: &str,
        directory: &Path,
    ) -> Result<(), String> {
        if session_id.is_empty()
            || session_id
                .chars()
                .any(|c| matches!(c, '/' | '?' | '#' | '%'))
        {
            return Err("invalid OpenCode session ID".to_owned());
        }
        if !directory.is_absolute() {
            return Err("OpenCode terminal directory must be absolute".to_owned());
        }
        {
            let terminals = self
                .terminals
                .lock()
                .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
            if terminals.contains_key(session_id) {
                return Err(format!(
                    "An OpenCode terminal is already registered for session {session_id}."
                ));
            }
        }
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 28,
                cols: 112,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Could not open a terminal for OpenCode: {e}"))?;
        let spec = launch_spec(executable, server_url, password, session_id, directory);
        let mut command = CommandBuilder::new(executable);
        command.args(&spec.args);
        command.cwd(directory);
        for (key, value) in &spec.env {
            command.env(key, value);
        }
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("Could not open OpenCode's terminal: {e}"))?;
        drop(pair.slave);
        let reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(e) => {
                let mut c = child;
                let cleanup = cleanup_child_errors("terminal reader rollback", c.kill(), c.wait());
                return Err(format!(
                    "Could not read the OpenCode terminal: {e}{}",
                    if cleanup.is_empty() {
                        String::new()
                    } else {
                        format!("; {}", cleanup.join("; "))
                    }
                ));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(e) => {
                let mut c = child;
                let cleanup = cleanup_child_errors("terminal writer rollback", c.kill(), c.wait());
                return Err(format!(
                    "Could not write to the OpenCode terminal: {e}{}",
                    if cleanup.is_empty() {
                        String::new()
                    } else {
                        format!("; {}", cleanup.join("; "))
                    }
                ));
            }
        };
        let terminal = Arc::new(Terminal {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(child),
            exited: AtomicBool::new(false),
        });
        let mut terminals = self
            .terminals
            .lock()
            .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
        if terminals.contains_key(session_id) {
            if let Ok(mut child) = terminal.child.lock() {
                for error in
                    cleanup_child_errors("duplicate terminal rollback", child.kill(), child.wait())
                {
                    eprintln!(
                        "{{\"event\":\"child-cleanup-error\",\"message\":{}}}",
                        serde_json::to_string(&error)
                            .unwrap_or_else(|_| "\"unserializable\"".into())
                    );
                }
            } else {
                eprintln!("{{\"event\":\"child-cleanup-error\",\"message\":\"duplicate terminal rollback: child lock unavailable\"}}");
            }
            return Err(format!(
                "An OpenCode terminal is already registered for session {session_id}."
            ));
        }
        terminals.insert(session_id.to_owned(), Arc::clone(&terminal));
        drop(terminals);
        let id = session_id.to_owned();
        let terminal_for_thread = Arc::clone(&terminal);
        let startup_events = Arc::clone(&self.startup_events);
        thread::Builder::new()
            .name(format!("opencode-terminal-{id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 16 * 1024];
                let mut reader = reader;
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Err(error) => {
                            let event = TerminalReplayEvent {
                                kind: "error".into(),
                                session_id: id.clone(),
                                data_base64: None,
                                operation: Some("read".into()),
                                message: Some(format!(
                                    "Could not read the OpenCode terminal: {error}"
                                )),
                            };
                            if let Err(delivery) = app.emit(
                                "terminal-error",
                                TerminalError {
                                    session_id: id.clone(),
                                    operation: "read".into(),
                                    message: event.message.clone().unwrap_or_default(),
                                },
                            ) {
                                record_startup_event(&startup_events, &id, event);
                                eprintln!("terminal-error delivery failed for {id}: {delivery}");
                            }
                            break;
                        }
                        Ok(count) => {
                            let payload = TerminalOutput {
                                session_id: id.clone(),
                                data_base64: STANDARD.encode(&buffer[..count]),
                            };
                            let event = TerminalReplayEvent {
                                kind: "output".into(),
                                session_id: id.clone(),
                                data_base64: Some(payload.data_base64.clone()),
                                operation: None,
                                message: None,
                            };
                            record_startup_event(&startup_events, &id, event);
                            if let Err(delivery) = app.emit("terminal-output", payload) {
                                eprintln!("terminal-output delivery failed for {id}: {delivery}");
                            }
                        }
                    }
                }
                if let Ok(mut child) = terminal_for_thread.child.lock() {
                    if let Err(error) = child.wait() {
                        eprintln!("{{\"event\":\"child-cleanup-error\",\"message\":\"terminal reader wait failed: {error}\"}}");
                    }
                }
                terminal_for_thread.exited.store(true, Ordering::Release);
                if let Err(delivery) = app.emit(
                    "terminal-exit",
                    TerminalExit {
                        session_id: id.clone(),
                    },
                ) {
                    record_startup_event(&startup_events, &id, TerminalReplayEvent {
                                kind: "exit".into(),
                                session_id: id.clone(),
                                data_base64: None,
                                operation: Some("exit".into()),
                                message: Some(delivery.to_string()),
                            });
                    eprintln!("terminal-exit delivery failed for {id}: {delivery}");
                }
            })
            .map_err(|e| {
                if let Ok(mut terminals) = self.terminals.lock() {
                    terminals.remove(session_id);
                }
                if let Ok(mut child) = terminal.child.lock() {
                    for error in cleanup_child_errors("terminal reader thread rollback", child.kill(), child.wait()) {
                        eprintln!("{{\"event\":\"child-cleanup-error\",\"message\":{}}}", serde_json::to_string(&error).unwrap_or_else(|_| "\"unserializable\"".into()));
                    }
                }
                format!("Could not register terminal output reader: {e}")
            })?;
        Ok(())
    }

    pub fn replay(&self, session_id: &str) -> TerminalAttachResult {
        let replay = self
            .startup_events
            .lock()
            .ok()
            .and_then(|mut events| events.remove(session_id))
            .unwrap_or_default();
        TerminalAttachResult { replay }
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let terminal = self.get(session_id)?;
        let mut writer = terminal
            .writer
            .lock()
            .map_err(|_| "The terminal input stream is unavailable.".to_owned())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| format!("Could not write to the OpenCode terminal: {e}"))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let terminal = self.get(session_id)?;
        let result = terminal
            .master
            .lock()
            .map_err(|_| "The terminal resize handle is unavailable.".to_owned())?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Could not resize the OpenCode terminal: {e}"));
        result
    }

    fn get(&self, id: &str) -> Result<Arc<Terminal>, String> {
        self.terminals
            .lock()
            .map_err(|_| "The terminal manager is unavailable.".to_owned())?
            .get(id)
            .cloned()
            .ok_or_else(|| "This OpenCode terminal is no longer available.".to_owned())
    }

    pub fn shutdown(&self) {
        // Remove the registrations before waiting.  This makes shutdown a
        // real ownership boundary: no command can observe a half-shut down
        // terminal and a second shutdown is harmless.
        let mut cleanup_errors = Vec::new();
        if let Ok(mut terminals) = self.terminals.lock() {
            let owned = std::mem::take(&mut *terminals);
            for terminal in owned.values() {
                if let Ok(mut child) = terminal.child.lock() {
                    for error in
                        cleanup_child_errors("terminal shutdown", child.kill(), child.wait())
                    {
                        cleanup_errors.push(error);
                    }
                }
            }
        }
        if let Ok(mut recorded) = self.cleanup_errors.lock() {
            recorded.extend(cleanup_errors.iter().cloned());
        }
        for error in cleanup_errors {
            eprintln!(
                "{{\"event\":\"child-cleanup-error\",\"message\":{}}}",
                serde_json::to_string(&error).unwrap_or_else(|_| "\"unserializable\"".into())
            );
        }
    }

    /// Returns cleanup failures recorded during the most recent shutdown.
    /// Shutdown remains best-effort: all registered children are attempted even
    /// when an earlier child reports a kill or wait failure.
    pub fn shutdown_errors(&self) -> Vec<String> {
        self.cleanup_errors
            .lock()
            .map(|errors| errors.clone())
            .unwrap_or_default()
    }

    pub fn cleanup(&self, session_id: &str) -> Result<(), String> {
        let terminal = self
            .terminals
            .lock()
            .map_err(|_| "The terminal manager is unavailable.".to_owned())?
            .remove(session_id)
            .ok_or_else(|| "This OpenCode terminal is no longer available.".to_owned())?;
        let mut child = terminal
            .child
            .lock()
            .map_err(|_| "The OpenCode terminal process is unavailable.".to_owned())?;
        let errors = cleanup_child_errors("terminal cleanup", child.kill(), child.wait());
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("; "))
        }
    }

    pub fn is_exited(&self, session_id: &str) -> bool {
        self.terminals
            .lock()
            .ok()
            .and_then(|terminals| terminals.get(session_id).cloned())
            .is_some_and(|terminal| terminal.exited.load(Ordering::Acquire))
    }

    /// Releases only a process known to have exited and been waited by its
    /// reader thread. Live terminals cannot be replaced through this path.
    pub fn prepare_restart(&self, session_id: &str) -> Result<(), String> {
        let mut terminals = self
            .terminals
            .lock()
            .map_err(|_| "The terminal manager is unavailable.".to_owned())?;
        let terminal = terminals
            .get(session_id)
            .ok_or_else(|| "This OpenCode terminal is not available to restart.".to_owned())?;
        if !terminal.exited.load(Ordering::Acquire) {
            return Err("The OpenCode terminal is still running.".to_owned());
        }
        terminals.remove(session_id);
        if let Ok(mut events) = self.startup_events.lock() {
            events.remove(session_id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::path::Path;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[derive(Debug)]
    struct CleanupTestChild {
        kill_failed: bool,
        wait_failed: bool,
        killed: Arc<AtomicBool>,
        waited: Arc<AtomicBool>,
    }

    impl portable_pty::ChildKiller for CleanupTestChild {
        fn kill(&mut self) -> io::Result<()> {
            self.killed.store(true, Ordering::SeqCst);
            if self.kill_failed {
                Err(io::Error::new(io::ErrorKind::Other, "kill denied"))
            } else {
                Ok(())
            }
        }

        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(CleanupTestKiller)
        }
    }

    #[derive(Debug)]
    struct CleanupTestKiller;

    impl portable_pty::ChildKiller for CleanupTestKiller {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }

        fn clone_killer(&self) -> Box<dyn portable_pty::ChildKiller + Send + Sync> {
            Box::new(CleanupTestKiller)
        }
    }

    impl portable_pty::Child for CleanupTestChild {
        fn try_wait(&mut self) -> io::Result<Option<portable_pty::ExitStatus>> {
            Ok(None)
        }

        fn wait(&mut self) -> io::Result<portable_pty::ExitStatus> {
            self.waited.store(true, Ordering::SeqCst);
            if self.wait_failed {
                Err(io::Error::new(io::ErrorKind::Other, "wait denied"))
            } else {
                Ok(portable_pty::ExitStatus::with_exit_code(0))
            }
        }

        fn process_id(&self) -> Option<u32> {
            None
        }
    }

    #[test]
    fn launch_spec_is_exact_and_keeps_password_process_only() {
        let spec = launch_spec(
            Path::new("/bin/opencode"),
            "http://127.0.0.1:4101",
            "secret",
            "ses_a",
            Path::new("/tmp/task"),
        );
        assert_eq!(spec.executable, "/bin/opencode");
        assert_eq!(
            spec.args,
            [
                "--server",
                "http://127.0.0.1:4101",
                "--session",
                "ses_a",
                "/tmp/task"
            ]
        );
        assert_eq!(spec.directory, "/tmp/task");
        assert_eq!(
            spec.env,
            [
                ("TERM".into(), "xterm-256color".into()),
                ("COLORTERM".into(), "truecolor".into()),
                ("OPENCODE_SERVER_PASSWORD".into(), "secret".into())
            ]
        );
    }

    #[test]
    fn router_preserves_order_and_isolates_sessions() {
        let mut router = TerminalEventRouter::default();
        router.push("a", TerminalEvent::Output(b"one".into()));
        router.push("b", TerminalEvent::Output(b"other".into()));
        router.push("a", TerminalEvent::Exit);
        assert_eq!(
            router.drain("a"),
            vec![TerminalEvent::Output(b"one".into()), TerminalEvent::Exit]
        );
        assert_eq!(
            router.drain("b"),
            vec![TerminalEvent::Output(b"other".into())]
        );
    }

    #[test]
    fn child_cleanup_records_kill_and_wait_failures() {
        let errors = cleanup_child_errors(
            "test rollback",
            Err::<(), _>("kill denied"),
            Err::<(), _>("wait denied"),
        );
        assert_eq!(
            errors,
            [
                "test rollback: kill failed: kill denied",
                "test rollback: wait failed: wait denied",
            ]
        );
    }

    #[test]
    fn cleanup_attempts_wait_and_surfaces_both_production_errors() {
        let pair = native_pty_system()
            .openpty(PtySize::default())
            .expect("test PTY");
        let writer = pair.master.take_writer().expect("test PTY writer");
        let waited = Arc::new(AtomicBool::new(false));
        let terminal = Arc::new(Terminal {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(Box::new(CleanupTestChild {
                kill_failed: true,
                wait_failed: true,
                killed: Arc::new(AtomicBool::new(false)),
                waited: Arc::clone(&waited),
            })),
            exited: AtomicBool::new(false),
        });
        let manager = TerminalManager::default();
        manager
            .terminals
            .lock()
            .unwrap()
            .insert("session".into(), terminal);

        let error = manager
            .cleanup("session")
            .expect_err("cleanup should report errors");

        assert!(
            waited.load(Ordering::SeqCst),
            "wait must be attempted after kill fails"
        );
        assert!(error.contains("terminal cleanup: kill failed: kill denied"));
        assert!(error.contains("terminal cleanup: wait failed: wait denied"));
        assert!(!manager.is_attached("session"));
    }

    #[test]
    fn restart_releases_only_a_terminal_marked_exited() {
        let pair = native_pty_system()
            .openpty(PtySize::default())
            .expect("test PTY");
        let writer = pair.master.take_writer().expect("test PTY writer");
        let terminal = Arc::new(Terminal {
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            child: Mutex::new(Box::new(CleanupTestChild {
                kill_failed: false,
                wait_failed: false,
                killed: Arc::new(AtomicBool::new(false)),
                waited: Arc::new(AtomicBool::new(false)),
            })),
            exited: AtomicBool::new(false),
        });
        let manager = TerminalManager::default();
        manager
            .terminals
            .lock()
            .unwrap()
            .insert("session".into(), terminal.clone());

        assert!(manager.prepare_restart("session").is_err());
        assert!(manager.is_attached("session"));

        terminal.exited.store(true, Ordering::Release);
        manager.prepare_restart("session").unwrap();
        assert!(!manager.is_attached("session"));
    }

    #[test]
    fn shutdown_attempts_all_children_after_one_cleanup_failure() {
        fn terminal(child: CleanupTestChild) -> Arc<Terminal> {
            let pair = native_pty_system()
                .openpty(PtySize::default())
                .expect("test PTY");
            let writer = pair.master.take_writer().expect("test PTY writer");
            Arc::new(Terminal {
                master: Mutex::new(pair.master),
                writer: Mutex::new(writer),
                child: Mutex::new(Box::new(child)),
                exited: AtomicBool::new(false),
            })
        }

        let first_killed = Arc::new(AtomicBool::new(false));
        let first_waited = Arc::new(AtomicBool::new(false));
        let second_killed = Arc::new(AtomicBool::new(false));
        let second_waited = Arc::new(AtomicBool::new(false));
        let manager = TerminalManager::default();
        manager.terminals.lock().unwrap().extend([
            (
                "first".into(),
                terminal(CleanupTestChild {
                    kill_failed: true,
                    wait_failed: true,
                    killed: Arc::clone(&first_killed),
                    waited: Arc::clone(&first_waited),
                }),
            ),
            (
                "second".into(),
                terminal(CleanupTestChild {
                    kill_failed: false,
                    wait_failed: false,
                    killed: Arc::clone(&second_killed),
                    waited: Arc::clone(&second_waited),
                }),
            ),
        ]);

        manager.shutdown();

        assert!(first_killed.load(Ordering::SeqCst));
        assert!(first_waited.load(Ordering::SeqCst));
        assert!(second_killed.load(Ordering::SeqCst));
        assert!(second_waited.load(Ordering::SeqCst));
        assert!(manager.active_session_ids().is_empty());
        let errors = manager.shutdown_errors();
        assert!(errors
            .iter()
            .any(|error| { error == "terminal shutdown: kill failed: kill denied" }));
        assert!(errors
            .iter()
            .any(|error| { error == "terminal shutdown: wait failed: wait denied" }));
    }

    #[test]
    fn startup_replay_overflow_is_bounded_and_recorded() {
        let events = Arc::new(Mutex::new(HashMap::new()));
        for index in 0..(STARTUP_REPLAY_LIMIT + 1) {
            record_startup_event(
                &events,
                "session",
                TerminalReplayEvent {
                    kind: "output".into(),
                    session_id: "session".into(),
                    data_base64: Some(index.to_string()),
                    operation: None,
                    message: None,
                },
            );
        }
        let queue = events.lock().unwrap().remove("session").unwrap();
        assert_eq!(queue.len(), STARTUP_REPLAY_LIMIT);
        assert!(queue
            .iter()
            .any(|event| event.operation.as_deref() == Some("replay-buffer")));
    }

    #[test]
    fn attachments_reject_duplicates_and_failed_registration_can_release() {
        let mut attachments = TerminalAttachments::default();
        attachments.reserve("a").unwrap();
        assert!(attachments.reserve("a").is_err());
        assert!(attachments.contains("a"));
        attachments.release("a");
        assert!(!attachments.contains("a"));
        attachments.reserve("a").unwrap();
    }
}
