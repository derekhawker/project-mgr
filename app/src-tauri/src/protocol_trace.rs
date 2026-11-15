//! Opt-in, privacy-safe tracing of Wry's WebKit custom-protocol callback spans.

use std::{
    collections::HashMap,
    env,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};

use tracing::{
    span::{Attributes, Id, Record},
    subscriber::Interest,
    Event, Metadata, Subscriber,
};

const ENABLE_ENV: &str = "PROJECT_MGR_TRACE_WEBKIT_PROTOCOL";

struct SpanInfo {
    name: &'static str,
    started: Instant,
}

struct ProtocolTraceSubscriber {
    next_id: AtomicU64,
    spans: Arc<Mutex<HashMap<u64, SpanInfo>>>,
}

impl ProtocolTraceSubscriber {
    fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            spans: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl Subscriber for ProtocolTraceSubscriber {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target().starts_with("wry::")
    }

    fn register_callsite(&self, metadata: &'static Metadata<'static>) -> Interest {
        if metadata.target().starts_with("wry::") {
            Interest::always()
        } else {
            Interest::never()
        }
    }

    fn new_span(&self, attributes: &Attributes<'_>) -> Id {
        let metadata = attributes.metadata();
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.spans.lock().unwrap().insert(
            id,
            SpanInfo {
                name: metadata.name(),
                started: Instant::now(),
            },
        );

        // Deliberately do not visit or record span fields. Wry records the full
        // request URI on its custom-protocol span; it can contain sensitive data.
        eprintln!(
            "{{\"event\":\"webkit-protocol-span-start\",\"span_id\":{id},\"span\":{:?},\"thread\":{:?}}}",
            metadata.name(),
            std::thread::current().id(),
        );
        Id::from_u64(id)
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {
        // Intentionally discard all fields, including the URI field.
    }

    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}

    fn event(&self, _event: &Event<'_>) {}

    fn enter(&self, _span: &Id) {}

    fn exit(&self, _span: &Id) {}

    fn try_close(&self, id: Id) -> bool {
        let id = id.into_u64();
        if let Some(info) = self.spans.lock().unwrap().remove(&id) {
            eprintln!(
                "{{\"event\":\"webkit-protocol-span-end\",\"span_id\":{id},\"span\":{:?},\"elapsed_ms\":{},\"thread\":{:?}}}",
                info.name,
                info.started.elapsed().as_millis(),
                std::thread::current().id(),
            );
            true
        } else {
            false
        }
    }
}

/// Enable Wry callback-span logging when explicitly requested by the user.
///
/// Wry's URI-scheme span records the complete URI. This subscriber never visits
/// span fields, so that value and all other request data are discarded.
pub fn enable_if_requested() {
    if env::var_os(ENABLE_ENV).as_deref() != Some(std::ffi::OsStr::new("1")) {
        return;
    }

    if tracing::subscriber::set_global_default(ProtocolTraceSubscriber::new()).is_err() {
        eprintln!("{{\"event\":\"webkit-protocol-trace-unavailable\"}}");
    } else {
        eprintln!("{{\"event\":\"webkit-protocol-trace-enabled\"}}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorded_uri_is_not_retained_by_the_subscriber() {
        let subscriber = ProtocolTraceSubscriber::new();
        let spans = Arc::clone(&subscriber.spans);
        let dispatch = tracing::Dispatch::new(subscriber);

        tracing::dispatcher::with_default(&dispatch, || {
            let span = tracing::info_span!(
                target: "wry::webkitgtk::web_context",
                "wry::custom_protocol::handle",
                uri = tracing::field::Empty,
            );
            span.record("uri", "tauri://localhost/private?token=must-not-be-kept");
        });

        assert!(spans.lock().unwrap().is_empty());
    }
}
