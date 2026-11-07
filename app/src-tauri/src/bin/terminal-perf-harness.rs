//! Opt-in development harness: forwards stdin/stdout to an isolated shell PTY.
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pair = native_pty_system().openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    })?;
    let mut command = CommandBuilder::new("/bin/sh");
    command.arg("-i");
    command.cwd(std::env::temp_dir());
    command.env("TERM", "xterm-256color");
    let child = Arc::new(Mutex::new(pair.slave.spawn_command(command)?));
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader()?;
    let mut writer = pair.master.take_writer()?;
    let input_child = Arc::clone(&child);
    thread::spawn(move || {
        let _ = io::copy(&mut io::stdin(), &mut writer);
        if let Ok(mut child) = input_child.lock() {
            let _ = child.kill();
        }
    });
    let mut buffer = [0; 16384];
    let mut stdout = io::stdout().lock();
    while let Ok(n) = reader.read(&mut buffer) {
        if n == 0 || stdout.write_all(&buffer[..n]).is_err() || stdout.flush().is_err() {
            break;
        }
    }
    if let Ok(mut child) = child.lock() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
