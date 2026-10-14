//! Cross-test-binary coordination for resources that are executed as files.
//!
//! Cargo can run the library unit-test binary and integration-test binaries at
//! the same time. A process-local mutex cannot protect an executable (or an
//! installed CLI's shared runtime/configuration) across that boundary, so
//! these tests use one atomic lock file instead.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

const WAIT_LIMIT: Duration = Duration::from_secs(30);
const RETRY_DELAY: Duration = Duration::from_millis(25);

pub struct ResourceLock {
    path: PathBuf,
}

impl ResourceLock {
    pub fn acquire(resource: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "opencode-project-manager-test-resource-{resource}.lock"
        ));
        let started = Instant::now();

        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let _ = writeln!(file, "pid={}", std::process::id());
                    return Self { path };
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    if started.elapsed() >= WAIT_LIMIT {
                        panic!(
                            "timed out after {} seconds waiting for cross-process test resource lock {}; a previous test process may have exited without cleanup",
                            WAIT_LIMIT.as_secs(),
                            path.display()
                        );
                    }
                    thread::sleep(RETRY_DELAY);
                }
                Err(error) => panic!(
                    "could not create cross-process test resource lock {}: {error}",
                    path.display()
                ),
            }
        }
    }
}

impl Drop for ResourceLock {
    fn drop(&mut self) {
        match fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {}
        }
    }
}
