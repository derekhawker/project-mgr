//! Non-privileged TCP listener discovery and PID-reuse-safe single-process stop.
use serde::Serialize;
use std::{collections::BTreeMap, process::Command};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listener {
    pub pid: u32,
    /// Kernel process-start identity; opaque to the WebView except on stop.
    pub identity: String,
    pub name: String,
    pub owner: String,
    pub addresses: Vec<String>,
    pub ports: Vec<u16>,
    pub cwd: Option<String>,
    pub command: Option<String>,
    pub start_time: Option<String>,
}

pub fn listeners() -> Result<Vec<Listener>, String> {
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    {
        // Snapshot identities before lsof. If a PID is recycled while lsof is
        // running, the old socket row cannot inherit the new process identity.
        let identities = process_identities();
        let output = match Command::new("lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-Fpcuan"])
            .output()
        {
            Ok(output) => output,
            #[cfg(target_os = "linux")]
            Err(_) => return ss_listeners(),
            #[cfg(target_os = "macos")]
            Err(e) => {
                return Err(format!(
                    "Cannot inspect listening ports (lsof unavailable): {e}"
                ))
            }
        };
        if !output.status.success() {
            // lsof uses exit status 1 when it found no matching files. An empty
            // inventory is a valid result, not an inspection failure.
            if lsof_means_no_matches(output.status.code(), &output.stdout, &output.stderr) {
                return Ok(Vec::new());
            }
            return Err(format!(
                "lsof could not inspect listening ports: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ));
        }
        let mut rows = parse_lsof(&String::from_utf8_lossy(&output.stdout))?;
        for row in &mut rows {
            if let Some(identity) = identities.get(&row.pid) {
                if process_identity(row.pid)
                    .map(|current| current == *identity)
                    .unwrap_or(false)
                {
                    row.identity = identity.clone();
                }
            }
        }
        Ok(rows)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        Err("Port inspection is supported on Linux and macOS only.".into())
    }
}

fn parse_lsof(text: &str) -> Result<Vec<Listener>, String> {
    let mut rows: BTreeMap<u32, Listener> = BTreeMap::new();
    // Keep sockets visible even if lsof omits or corrupts the process ID. PID
    // zero is a display-only sentinel and is rejected by the stop command.
    let mut pid = Some(0);
    let (mut name, mut owner) = (String::new(), String::from("unknown"));
    for line in text.lines() {
        let Some((key, value)) = line.split_at_checked(1) else {
            continue;
        };
        match key {
            "p" => pid = Some(value.parse::<u32>().unwrap_or(0)),
            "c" => name = value.to_owned(),
            "u" => owner = value.to_owned(),
            "n" => {
                let Some(pid) = pid else { continue };
                let Some((host, port)) = value.rsplit_once(':') else {
                    continue;
                };
                let Ok(port) = port.parse::<u16>() else {
                    continue;
                };
                let row = rows.entry(pid).or_insert_with(|| Listener {
                    pid,
                    identity: String::new(),
                    name: name.clone(),
                    owner: owner.clone(),
                    addresses: vec![],
                    ports: vec![],
                    cwd: None,
                    command: None,
                    start_time: None,
                });
                let address = if matches!(host, "*" | "0.0.0.0" | "[::]" | "::") {
                    format!("{host} (all interfaces)")
                } else {
                    host.to_owned()
                };
                if !row.addresses.contains(&address) {
                    row.addresses.push(address);
                }
                if !row.ports.contains(&port) {
                    row.ports.push(port);
                }
            }
            _ => {}
        }
    }
    let mut rows: Vec<_> = rows.into_values().collect();
    for row in &mut rows {
        row.owner = resolve_owner(&row.owner);
        row.cwd = process_cwd(row.pid);
        row.command = process_command(row.pid);
        row.start_time = process_started(row.pid);
    }
    Ok(rows)
}

fn lsof_means_no_matches(code: Option<i32>, stdout: &[u8], stderr: &[u8]) -> bool {
    code == Some(1) && stdout.is_empty() && stderr.iter().all(u8::is_ascii_whitespace)
}

#[cfg(target_os = "linux")]
fn ss_listeners() -> Result<Vec<Listener>, String> {
    // Capture the process generation before `ss` observes sockets. A PID
    // recycled between the socket snapshot and a later process scan must not
    // be paired with the unrelated process now using that PID.
    let before = process_identities();
    let output = Command::new("ss")
        .args(["-H", "-lntp"])
        .output()
        .map_err(|e| format!("Cannot inspect listeners: lsof and ss are unavailable ({e})"))?;
    if !output.status.success() {
        return Err(format!(
            "ss could not inspect listening ports: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let after = process_identities();
    Ok(parse_ss(
        &String::from_utf8_lossy(&output.stdout),
        &before,
        &after,
    ))
}

#[cfg(target_os = "linux")]
fn parse_ss(
    text: &str,
    before: &BTreeMap<u32, String>,
    after: &BTreeMap<u32, String>,
) -> Vec<Listener> {
    let mut rows = Vec::new();
    for line in text.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        let local = fields[3];
        let Some((host, port)) = local.rsplit_once(':') else {
            continue;
        };
        let Ok(port) = port.parse::<u16>() else {
            continue;
        };
        let process = fields.get(5..).unwrap_or(&[]).join(" ");
        let pid = process
            .split("pid=")
            .nth(1)
            .and_then(|s| s.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|s| s.parse::<u32>().ok());
        let pid = pid.unwrap_or(0);
        let name = process
            .split("((\"")
            .nth(1)
            .and_then(|s| s.split('\"').next())
            .unwrap_or("Unknown process")
            .to_owned();
        let identity = before
            .get(&pid)
            .cloned()
            .filter(|saved| after.get(&pid) == Some(saved))
            .unwrap_or_default();
        let shown = if matches!(host, "*" | "0.0.0.0" | "[::]" | "::") {
            format!("{host} (all interfaces)")
        } else {
            host.to_owned()
        };
        // If the PID was recycled or inaccessible, preserve the listener row
        // for inspection but do not expose a stop-capable identity.
        let stable_pid = if identity.is_empty() { 0 } else { pid };
        rows.push(Listener {
            pid: stable_pid,
            identity,
            owner: if stable_pid == 0 {
                "unknown".into()
            } else {
                process_owner(pid)
            },
            name,
            addresses: vec![shown],
            ports: vec![port],
            cwd: (stable_pid != 0).then(|| process_cwd(pid)).flatten(),
            command: (stable_pid != 0).then(|| process_command(pid)).flatten(),
            start_time: (stable_pid != 0).then(|| process_started(pid)).flatten(),
        });
    }
    rows
}

#[cfg(target_os = "linux")]
fn process_owner(pid: u32) -> String {
    std::fs::read_to_string(format!("/proc/{pid}/status"))
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|line| line.starts_with("Uid:"))
                .and_then(|line| line.split_whitespace().nth(1)?.parse::<u32>().ok())
        })
        .map(|uid| resolve_owner(&uid.to_string()))
        .unwrap_or_else(|| "unknown".into())
}

#[cfg(target_os = "linux")]
fn process_cwd(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/cwd"))
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(target_os = "linux")]
fn process_command(pid: u32) -> Option<String> {
    std::fs::read(format!("/proc/{pid}/cmdline"))
        .ok()
        .map(|b| {
            String::from_utf8_lossy(&b)
                .replace('\0', " ")
                .trim()
                .to_owned()
        })
        .filter(|s| !s.is_empty())
}

#[cfg(target_os = "macos")]
fn process_cwd(pid: u32) -> Option<String> {
    let output = Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(str::to_owned))
}

#[cfg(target_os = "macos")]
fn process_command(pid: u32) -> Option<String> {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|command| !command.is_empty())
}

fn resolve_owner(owner: &str) -> String {
    let Ok(uid) = owner.parse::<u32>() else {
        return owner.to_owned();
    };
    #[cfg(target_os = "linux")]
    {
        if let Ok(passwd) = std::fs::read_to_string("/etc/passwd") {
            if let Some(name) = passwd.lines().find_map(|line| {
                let mut fields = line.split(':');
                let name = fields.next()?;
                let _password = fields.next()?;
                (fields.next()?.parse::<u32>().ok() == Some(uid)).then(|| name.to_owned())
            }) {
                return name;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(output) = Command::new("id").args(["-nu", &uid.to_string()]).output() {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_owned();
            if output.status.success() && !name.is_empty() {
                return name;
            }
        }
    }
    format!("UID {uid}")
}

fn process_identities() -> BTreeMap<u32, String> {
    #[cfg(target_os = "linux")]
    {
        let mut result = BTreeMap::new();
        let Ok(entries) = std::fs::read_dir("/proc") else {
            return result;
        };
        for entry in entries.flatten() {
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            if let Ok(identity) = process_identity(pid) {
                result.insert(pid, identity);
            }
        }
        result
    }
    #[cfg(target_os = "macos")]
    {
        let mut result = BTreeMap::new();
        let Ok(output) = Command::new("ps").args(["-axo", "pid=,lstart="]).output() else {
            return result;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some(pid) = line
                .split_whitespace()
                .next()
                .and_then(|p| p.parse::<u32>().ok())
            {
                if let Ok(identity) = process_identity(pid) {
                    result.insert(pid, identity);
                }
            }
        }
        result
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        BTreeMap::new()
    }
}

fn process_identity(pid: u32) -> Result<String, String> {
    #[cfg(target_os = "linux")]
    {
        let stat =
            std::fs::read_to_string(format!("/proc/{pid}/stat")).map_err(|e| e.to_string())?;
        // comm may contain spaces and ')'; fields after the final ')' start at field 3.
        return stat
            .rsplit_once(") ")
            .and_then(|(_, tail)| tail.split_whitespace().nth(19))
            .map(str::to_owned)
            .ok_or_else(|| "Process start identity unavailable".into());
    }
    #[cfg(target_os = "macos")]
    {
        let mut info = std::mem::MaybeUninit::<ProcBsdInfo>::uninit();
        let size = std::mem::size_of::<ProcBsdInfo>() as i32;
        // SAFETY: proc_pidinfo writes exactly the provided C-layout buffer size.
        let written = unsafe { proc_pidinfo(pid as i32, 3, 0, info.as_mut_ptr().cast(), size) };
        if written != size {
            return Err("Process start identity unavailable".into());
        }
        // SAFETY: a full-size successful PROC_PIDTBSDINFO response initialized the struct.
        let info = unsafe { info.assume_init() };
        if info.pid != pid {
            return Err("Process identity changed during inspection".into());
        }
        Ok(format!("{}:{}", info.start_sec, info.start_usec))
    }
}

fn process_started(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let ticks = process_identity(pid).ok()?.parse::<u64>().ok()?;
        let uptime = std::fs::read_to_string("/proc/uptime")
            .ok()?
            .split_whitespace()
            .next()?
            .parse::<f64>()
            .ok()?;
        let ticks_per_second = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as f64;
        if ticks_per_second <= 0.0 {
            return None;
        }
        let seconds = uptime - ticks as f64 / ticks_per_second;
        return Some(format!("{} seconds ago", seconds.max(0.0) as u64));
    }
    #[cfg(target_os = "macos")]
    {
        let identity = process_identity(pid).ok()?;
        let (sec, _) = identity.split_once(':')?;
        let start = sec.parse::<u64>().ok()?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .ok()?
            .as_secs();
        return Some(format!("{} seconds ago", now.saturating_sub(start)));
    }
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct ProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    comm: [libc::c_char; 16],
    name: [libc::c_char; 32],
    nfiles: u32,
    pgid: u32,
    pjobc: u32,
    tty_device: u32,
    tty_pgid: u32,
    nice: i32,
    start_sec: u64,
    start_usec: u64,
}

#[cfg(target_os = "macos")]
#[link(name = "proc")]
unsafe extern "C" {
    fn proc_pidinfo(
        pid: i32,
        flavor: i32,
        arg: u64,
        buffer: *mut libc::c_void,
        buffersize: i32,
    ) -> i32;
}

pub fn stop(pid: u32, identity: String) -> Result<(), String> {
    if pid == 0 || pid == std::process::id() || identity.is_empty() {
        return Err("Cannot safely identify this process; refresh the list and retry.".into());
    }
    #[cfg(target_os = "linux")]
    {
        // pidfd pins the kernel process object, preventing PID reuse races on both signals.
        let fd = unsafe { libc::syscall(libc::SYS_pidfd_open, pid as libc::pid_t, 0) as i32 };
        if fd < 0 {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut ops = LinuxStopOperations {
            pid,
            identity: &identity,
            fd,
        };
        let result = stop_with_operations(&mut ops);
        unsafe {
            libc::close(fd);
        }
        return result;
    }
    #[cfg(target_os = "macos")]
    {
        let mut ops = MacStopOperations {
            pid,
            identity: &identity,
        };
        stop_with_operations(&mut ops)
    }
}

trait StopOperations {
    fn verify(&mut self) -> Result<(), String>;
    fn terminate(&mut self) -> Result<(), String>;
    fn wait_five_seconds(&mut self);
    fn kill(&mut self) -> Result<(), String>;
}

fn stop_with_operations(ops: &mut impl StopOperations) -> Result<(), String> {
    ops.verify()?;
    ops.terminate()?;
    ops.wait_five_seconds();
    // A changed or exited process is already safe to leave alone. Recheck
    // immediately before escalation as macOS has no pidfd-bound signal.
    if ops.verify().is_ok() {
        ops.verify()?;
        ops.kill()?;
    }
    Ok(())
}

#[cfg(target_os = "linux")]
struct LinuxStopOperations<'a> {
    pid: u32,
    identity: &'a str,
    fd: i32,
}
#[cfg(target_os = "linux")]
impl StopOperations for LinuxStopOperations<'_> {
    fn verify(&mut self) -> Result<(), String> {
        verify(self.pid, self.identity)
    }
    fn terminate(&mut self) -> Result<(), String> {
        pidfd_signal(self.fd, libc::SIGTERM)
    }
    fn wait_five_seconds(&mut self) {
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
    fn kill(&mut self) -> Result<(), String> {
        pidfd_signal(self.fd, libc::SIGKILL)
    }
}

#[cfg(target_os = "macos")]
struct MacStopOperations<'a> {
    pid: u32,
    identity: &'a str,
}
#[cfg(target_os = "macos")]
impl MacStopOperations<'_> {
    fn signal(&self, signal: i32) -> Result<(), String> {
        if unsafe { libc::kill(self.pid as i32, signal) } != 0 {
            Err(std::io::Error::last_os_error().to_string())
        } else {
            Ok(())
        }
    }
}
#[cfg(target_os = "macos")]
impl StopOperations for MacStopOperations<'_> {
    fn verify(&mut self) -> Result<(), String> {
        verify(self.pid, self.identity)
    }
    fn terminate(&mut self) -> Result<(), String> {
        self.signal(libc::SIGTERM)
    }
    fn wait_five_seconds(&mut self) {
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
    fn kill(&mut self) -> Result<(), String> {
        self.signal(libc::SIGKILL)
    }
}

#[cfg(target_os = "linux")]
fn pidfd_signal(fd: i32, signal: i32) -> Result<(), String> {
    let rc = unsafe {
        libc::syscall(
            libc::SYS_pidfd_send_signal,
            fd,
            signal,
            std::ptr::null::<libc::siginfo_t>(),
            0,
        )
    };
    if rc < 0 {
        Err(std::io::Error::last_os_error().to_string())
    } else {
        Ok(())
    }
}

fn verify(pid: u32, expected: &str) -> Result<(), String> {
    if process_identity(pid)? != expected {
        Err("Process changed since it was listed; refresh and retry.".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;

    #[derive(Default)]
    struct FakeStop {
        checks: VecDeque<Result<(), String>>,
        events: Vec<String>,
        now: u64,
        term_error: bool,
        kill_error: bool,
    }
    impl StopOperations for FakeStop {
        fn verify(&mut self) -> Result<(), String> {
            self.events.push("verify".into());
            self.checks.pop_front().unwrap_or(Ok(()))
        }
        fn terminate(&mut self) -> Result<(), String> {
            self.events.push("term:4242".into());
            if self.term_error {
                Err("term failed".into())
            } else {
                Ok(())
            }
        }
        fn wait_five_seconds(&mut self) {
            self.events.push("wait:5".into());
            self.now += 5;
        }
        fn kill(&mut self) -> Result<(), String> {
            self.events.push("kill:4242".into());
            if self.kill_error {
                Err("kill failed".into())
            } else {
                Ok(())
            }
        }
    }

    #[test]
    fn stop_orchestration_escalates_after_five_fake_seconds_without_group_kill() {
        let mut fake = FakeStop::default();
        assert_eq!(stop_with_operations(&mut fake), Ok(()));
        assert_eq!(fake.now, 5);
        assert_eq!(
            fake.events,
            [
                "verify",
                "term:4242",
                "wait:5",
                "verify",
                "verify",
                "kill:4242"
            ]
        );
    }

    #[test]
    fn stop_orchestration_does_not_escalate_after_graceful_exit() {
        let mut fake = FakeStop {
            checks: [Ok(()), Err("exited".into())].into(),
            ..Default::default()
        };
        assert_eq!(stop_with_operations(&mut fake), Ok(()));
        assert_eq!(fake.now, 5);
        assert_eq!(fake.events, ["verify", "term:4242", "wait:5", "verify"]);
    }

    #[test]
    fn stop_orchestration_rejects_identity_mismatch_before_signals() {
        let mut fake = FakeStop {
            checks: [Err("identity changed".into())].into(),
            ..Default::default()
        };
        assert_eq!(
            stop_with_operations(&mut fake),
            Err("identity changed".into())
        );
        assert_eq!(fake.events, ["verify"]);
    }

    #[test]
    fn stop_orchestration_rejects_identity_mismatch_before_escalation() {
        let mut fake = FakeStop {
            checks: [Ok(()), Ok(()), Err("identity changed".into())].into(),
            ..Default::default()
        };
        assert_eq!(
            stop_with_operations(&mut fake),
            Err("identity changed".into())
        );
        assert_eq!(
            fake.events,
            ["verify", "term:4242", "wait:5", "verify", "verify"]
        );
    }

    #[test]
    fn stop_orchestration_propagates_signal_failures() {
        let mut term_failure = FakeStop {
            term_error: true,
            ..Default::default()
        };
        assert_eq!(
            stop_with_operations(&mut term_failure),
            Err("term failed".into())
        );
        assert!(!term_failure
            .events
            .iter()
            .any(|event| event.starts_with("wait")));

        let mut kill_failure = FakeStop {
            kill_error: true,
            ..Default::default()
        };
        assert_eq!(
            stop_with_operations(&mut kill_failure),
            Err("kill failed".into())
        );
    }

    #[test]
    fn parses_multiple_sockets_and_marks_wildcard_bind() {
        let rows = parse_lsof("p456\ncnode\nualice\nn*:3000\nn127.0.0.1:5173\n").unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].ports, [3000, 5173]);
        assert!(rows[0].addresses[0].contains("all interfaces"));
    }

    #[test]
    fn lsof_exit_one_with_empty_output_means_no_listeners() {
        assert!(lsof_means_no_matches(Some(1), b"", b""));
        assert!(parse_lsof("").unwrap().is_empty());
        assert!(!lsof_means_no_matches(Some(1), b"listener", b""));
        assert!(!lsof_means_no_matches(Some(1), b"", b"permission denied"));
    }

    #[test]
    fn lsof_keeps_listener_rows_when_pid_is_unavailable() {
        let rows = parse_lsof("n*:4321\npnot-a-pid\nn127.0.0.1:5000\n").unwrap();
        assert_eq!(
            rows.len(),
            1,
            "unknown-PID sockets remain grouped for display"
        );
        assert!(rows.iter().all(|row| row.pid == 0));
        assert!(rows.iter().all(|row| row.identity.is_empty()));
        assert_eq!(rows[0].ports, [4321, 5000]);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn ss_fallback_keeps_unknown_process_visible_and_disables_stop() {
        let rows = parse_ss(
            "LISTEN 0 128 0.0.0.0:8080 0.0.0.0:*\n",
            &BTreeMap::new(),
            &BTreeMap::new(),
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].pid, 0);
        assert_eq!(rows[0].name, "Unknown process");
        assert!(rows[0].identity.is_empty());
        assert!(rows[0].addresses[0].contains("all interfaces"));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn ss_pid_reuse_between_socket_and_process_snapshots_is_not_stop_capable() {
        let pid = 4242;
        let before = BTreeMap::from([(pid, "old-process-start".to_owned())]);
        let after = BTreeMap::from([(pid, "recycled-process-start".to_owned())]);
        let rows = parse_ss(
            "LISTEN 0 128 127.0.0.1:8080 0.0.0.0:* users:((\"old-server\",pid=4242,fd=4))\n",
            &before,
            &after,
        );
        assert_eq!(rows.len(), 1, "keep the socket visible");
        assert_eq!(rows[0].pid, 0, "do not offer stop for the recycled PID");
        assert!(rows[0].identity.is_empty());
    }
}
