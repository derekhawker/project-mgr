const RUN_ID_ENV: &str = "PROJECT_MGR_LIVE_RUN_ID";

fn is_run_id(value: &str) -> bool {
    value.len() == 36
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() || byte == b'-')
}

fn process_marker(pid: u32, run_id: &str) -> Option<String> {
    is_run_id(run_id).then(|| format!("PROJECT_MGR_LIVE_PROCESS pid={pid} run_id={run_id}"))
}

pub fn announce_process() {
    let Some(run_id) = std::env::var(RUN_ID_ENV).ok() else {
        return;
    };
    let Some(marker) = process_marker(std::process::id(), &run_id) else {
        eprintln!("Ignoring invalid {RUN_ID_ENV} value");
        return;
    };
    eprintln!("{marker}");
}

#[cfg(test)]
mod tests {
    use super::{is_run_id, process_marker};

    #[test]
    fn process_marker_identifies_native_pid_and_live_run() {
        assert_eq!(
            process_marker(1782997, "a1234567-b123-c123-d123-a123456789ab"),
            Some(
                "PROJECT_MGR_LIVE_PROCESS pid=1782997 run_id=a1234567-b123-c123-d123-a123456789ab"
                    .to_owned()
            )
        );
    }

    #[test]
    fn process_marker_rejects_untrusted_run_id_text() {
        assert!(!is_run_id("bad\nrun_id=another"));
        assert_eq!(process_marker(42, "bad\nrun_id=another"), None);
    }
}
