use std::collections::{BTreeSet, HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::dto::QuickActionRequestDto;

pub const NATIVE_INBOUND_EVENT_VERSION: u32 = 1;
pub const NATIVE_INBOUND_EVENT_NAME: &str = "zmanager-native-inbound-event";
const DEFAULT_QUEUE_LIMIT: usize = 256;
const MAX_SERIALIZED_EVENT_BYTES: usize = 1_048_576;
const MAX_PATHS: usize = 1024;
const MAX_PATH_BYTES: usize = 4096;
const MAX_DELIVERY_ATTEMPTS: u8 = 3;
const DEDUPE_LIMIT: usize = 2048;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NativeInboundEvent {
    pub version: u32,
    pub event_id: String,
    pub kind: NativeInboundEventKind,
    pub timestamp_unix_ms: u64,
    pub idempotency_key: Option<String>,
    pub payload: NativeInboundPayload,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum NativeInboundEventKind {
    OpenPaths,
    ShellActionRequest,
    HostedAuthCallback,
    ReopenApplication,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(untagged)]
pub enum NativeInboundPayload {
    OpenPaths(OpenPathsPayload),
    ShellActionRequest(ShellActionRequestPayload),
    ShellActionToken(ShellActionTokenPayload),
    HostedAuthCallback(HostedAuthCallbackPayload),
    ReopenApplication(ReopenApplicationPayload),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenPathsPayload {
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellActionRequestPayload {
    pub request: QuickActionRequestDto,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellActionTokenPayload {
    pub request_token: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HostedAuthCallbackPayload {
    pub state: String,
    pub result: HostedAuthResult,
    pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub handoff_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub callback_url: Option<String>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum HostedAuthResult {
    Completed,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReopenApplicationPayload {}

pub type InboxEmitter = Arc<dyn Fn(&str, &NativeInboundEvent) -> Result<(), String> + Send + Sync + 'static>;

#[derive(Clone)]
pub struct NativeLaunchInbox {
    inner: Arc<Mutex<InboxState>>,
}

struct InboxState {
    queue: VecDeque<QueuedEvent>,
    ready_windows: BTreeSet<String>,
    seen_ids: VecDeque<String>,
    seen_id_set: HashSet<String>,
    idempotency_keys: VecDeque<String>,
    idempotency_set: HashSet<String>,
    emitter: Option<InboxEmitter>,
    queue_limit: usize,
    shutdown: bool,
}

impl InboxState {
    fn remember_event_id(&mut self, value: String) {
        if self.seen_ids.len() == DEDUPE_LIMIT
            && let Some(expired) = self.seen_ids.pop_front()
        {
            self.seen_id_set.remove(&expired);
        }
        self.seen_id_set.insert(value.clone());
        self.seen_ids.push_back(value);
    }

    fn remember_idempotency_key(&mut self, value: String) {
        if self.idempotency_keys.len() == DEDUPE_LIMIT
            && let Some(expired) = self.idempotency_keys.pop_front()
        {
            self.idempotency_set.remove(&expired);
        }
        self.idempotency_set.insert(value.clone());
        self.idempotency_keys.push_back(value);
    }
}

struct QueuedEvent {
    event: NativeInboundEvent,
    assigned_window: Option<String>,
    delivery_attempts: u8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeLaunchInboxError {
    Shutdown,
    UnsupportedVersion(u32),
    InvalidEvent(String),
    Oversized,
    Duplicate,
    QueueFull,
    UnknownEvent,
    WrongWindow,
}

impl NativeLaunchInbox {
    pub fn new() -> Self {
        Self::with_queue_limit(DEFAULT_QUEUE_LIMIT)
    }

    pub fn with_queue_limit(queue_limit: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(InboxState {
                queue: VecDeque::new(),
                ready_windows: BTreeSet::new(),
                seen_ids: VecDeque::new(),
                seen_id_set: HashSet::new(),
                idempotency_keys: VecDeque::new(),
                idempotency_set: HashSet::new(),
                emitter: None,
                queue_limit,
                shutdown: false,
            })),
        }
    }

    pub fn ingest(&self, event: NativeInboundEvent) -> Result<(), NativeLaunchInboxError> {
        validate_event(&event)?;
        {
            let mut state = self.inner.lock().expect("native inbox lock poisoned");
            if state.shutdown {
                return Err(NativeLaunchInboxError::Shutdown);
            }
            if state.seen_id_set.contains(&event.event_id) || event.idempotency_key.as_ref().is_some_and(|key| state.idempotency_set.contains(key)) {
                return Err(NativeLaunchInboxError::Duplicate);
            }
            if state.queue.len() >= state.queue_limit {
                return Err(NativeLaunchInboxError::QueueFull);
            }
            state.remember_event_id(event.event_id.clone());
            if let Some(key) = &event.idempotency_key {
                state.remember_idempotency_key(key.clone());
            }
            state.queue.push_back(QueuedEvent { event, assigned_window: None, delivery_attempts: 0 });
        }
        self.deliver_pending();
        Ok(())
    }

    pub fn attach_emitter(&self, emitter: InboxEmitter) -> Result<(), NativeLaunchInboxError> {
        let mut state = self.inner.lock().expect("native inbox lock poisoned");
        if state.shutdown {
            return Err(NativeLaunchInboxError::Shutdown);
        }
        state.emitter = Some(emitter);
        drop(state);
        self.deliver_pending();
        Ok(())
    }

    pub fn frontend_ready(&self, window_label: &str) -> Result<usize, NativeLaunchInboxError> {
        if window_label.trim().is_empty() || window_label.len() > 128 {
            return Err(NativeLaunchInboxError::InvalidEvent("window label is invalid".to_string()));
        }
        let before = {
            let mut state = self.inner.lock().expect("native inbox lock poisoned");
            if state.shutdown {
                return Err(NativeLaunchInboxError::Shutdown);
            }
            state.ready_windows.insert(window_label.to_string());
            state.queue.iter().map(|queued| usize::from(queued.delivery_attempts)).sum::<usize>()
        };
        self.deliver_pending();
        let after = self.inner.lock().expect("native inbox lock poisoned").queue.iter().map(|queued| usize::from(queued.delivery_attempts)).sum::<usize>();
        Ok(after.saturating_sub(before))
    }

    #[cfg(test)]
    pub fn pending_events(&self, window_label: &str) -> Vec<NativeInboundEvent> {
        self.inner
            .lock()
            .expect("native inbox lock poisoned")
            .queue
            .iter()
            .filter(|queued| queued.assigned_window.as_deref() == Some(window_label))
            .map(|queued| queued.event.clone())
            .collect()
    }

    pub fn acknowledge(&self, window_label: &str, event_id: &str) -> Result<(), NativeLaunchInboxError> {
        let mut state = self.inner.lock().expect("native inbox lock poisoned");
        let Some(index) = state.queue.iter().position(|queued| queued.event.event_id == event_id) else {
            return Err(NativeLaunchInboxError::UnknownEvent);
        };
        if state.queue[index].assigned_window.as_deref() != Some(window_label) {
            return Err(NativeLaunchInboxError::WrongWindow);
        }
        state.queue.remove(index);
        Ok(())
    }

    pub fn shutdown(&self) {
        let mut state = self.inner.lock().expect("native inbox lock poisoned");
        state.shutdown = true;
        state.queue.clear();
        state.ready_windows.clear();
        state.emitter = None;
    }

    pub fn from_quick_action(request: QuickActionRequestDto) -> NativeInboundEvent {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let timestamp_unix_ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis().min(u128::from(u64::MAX)) as u64;
        let counter = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        NativeInboundEvent {
            version: NATIVE_INBOUND_EVENT_VERSION,
            event_id: format!("native-{}-{timestamp_unix_ms}-{counter}", std::process::id()),
            kind: NativeInboundEventKind::ShellActionRequest,
            timestamp_unix_ms,
            idempotency_key: None,
            payload: NativeInboundPayload::ShellActionRequest(ShellActionRequestPayload { request }),
        }
    }

    fn deliver_pending(&self) {
        let deliveries = {
            let mut state = self.inner.lock().expect("native inbox lock poisoned");
            if state.shutdown {
                return;
            }
            let Some(emitter) = state.emitter.clone() else {
                return;
            };
            let default_window = state.ready_windows.iter().next().cloned();
            let mut deliveries = Vec::new();
            for queued in &mut state.queue {
                if queued.assigned_window.is_none() {
                    queued.assigned_window = default_window.clone();
                }
                if let Some(window) = &queued.assigned_window
                    && queued.delivery_attempts < MAX_DELIVERY_ATTEMPTS
                {
                    queued.delivery_attempts += 1;
                    deliveries.push((emitter.clone(), window.clone(), queued.event.clone()));
                }
            }
            deliveries
        };
        for (emitter, window, event) in deliveries {
            let _ = emitter(&window, &event);
        }
    }
}

fn validate_event(event: &NativeInboundEvent) -> Result<(), NativeLaunchInboxError> {
    if event.version != NATIVE_INBOUND_EVENT_VERSION {
        return Err(NativeLaunchInboxError::UnsupportedVersion(event.version));
    }
    if !(16..=128).contains(&event.event_id.len()) || !event.event_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')) {
        return Err(NativeLaunchInboxError::InvalidEvent("event id is invalid".to_string()));
    }
    if event.idempotency_key.as_ref().is_some_and(|key| key.len() > 256 || key.bytes().any(|byte| byte.is_ascii_control())) {
        return Err(NativeLaunchInboxError::InvalidEvent("idempotency key is invalid".to_string()));
    }
    if serde_json::to_vec(event).map_or(true, |bytes| bytes.len() > MAX_SERIALIZED_EVENT_BYTES) {
        return Err(NativeLaunchInboxError::Oversized);
    }
    match (&event.kind, &event.payload) {
        (NativeInboundEventKind::OpenPaths, NativeInboundPayload::OpenPaths(payload)) => {
            if payload.paths.is_empty()
                || payload.paths.len() > MAX_PATHS
                || payload.paths.iter().any(|path| path.is_empty() || path.len() > MAX_PATH_BYTES || path.contains('\0') || path.contains("://"))
            {
                return Err(NativeLaunchInboxError::InvalidEvent("open paths are invalid".to_string()));
            }
        }
        (NativeInboundEventKind::ShellActionRequest, NativeInboundPayload::ShellActionRequest(payload)) => {
            if payload.request.paths.is_empty()
                || payload.request.paths.len() > MAX_PATHS
                || payload.request.paths.iter().any(|path| path.is_empty() || path.len() > MAX_PATH_BYTES || path.contains('\0'))
            {
                return Err(NativeLaunchInboxError::InvalidEvent("shell action paths are invalid".to_string()));
            }
        }
        (NativeInboundEventKind::ShellActionRequest, NativeInboundPayload::ShellActionToken(_)) => {
            return Err(NativeLaunchInboxError::InvalidEvent("shell action tokens must be consumed before inbox ingestion".to_string()));
        }
        (NativeInboundEventKind::HostedAuthCallback, NativeInboundPayload::HostedAuthCallback(payload)) => {
            let callback_url_is_sanitized =
                payload.callback_url.as_deref().is_some_and(|url| matches!(url, "tzap://auth/callback" | "zmanager://auth-callback"));
            if !(16..=256).contains(&payload.state.len())
                || !payload.state.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
                || payload.error_code.as_ref().is_some_and(|code| code.len() > 128)
                || (matches!(payload.result, HostedAuthResult::Completed)
                    && (!callback_url_is_sanitized
                        || payload.handoff_code.as_deref().is_none_or(|code| {
                            !(16..=2048).contains(&code.len())
                                || !code.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b'~'))
                        })))
                || (!matches!(payload.result, HostedAuthResult::Completed) && payload.handoff_code.is_some())
                || (payload.callback_url.is_some() && !callback_url_is_sanitized)
            {
                return Err(NativeLaunchInboxError::InvalidEvent("hosted authentication callback is invalid".to_string()));
            }
        }
        (NativeInboundEventKind::ReopenApplication, NativeInboundPayload::ReopenApplication(_)) => {}
        _ => {
            return Err(NativeLaunchInboxError::InvalidEvent("event kind does not match payload".to_string()));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dto::QuickActionKindDto;

    fn event(id: &str) -> NativeInboundEvent {
        NativeInboundEvent {
            version: 1,
            event_id: format!("event-{id}-1234567890"),
            kind: NativeInboundEventKind::ReopenApplication,
            timestamp_unix_ms: 1,
            idempotency_key: None,
            payload: NativeInboundPayload::ReopenApplication(ReopenApplicationPayload {}),
        }
    }

    #[allow(clippy::type_complexity)]
    fn recording_emitter() -> (InboxEmitter, Arc<Mutex<Vec<(String, String)>>>) {
        let records = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&records);
        let emitter: InboxEmitter = Arc::new(move |window, event| {
            captured.lock().unwrap().push((window.to_string(), event.event_id.clone()));
            Ok(())
        });
        (emitter, records)
    }

    #[test]
    fn events_before_setup_and_webview_drain_in_order_after_ready() {
        let inbox = NativeLaunchInbox::new();
        inbox.ingest(event("one")).unwrap();
        inbox.ingest(event("two")).unwrap();
        let (emitter, records) = recording_emitter();
        inbox.attach_emitter(emitter).unwrap();
        assert!(records.lock().unwrap().is_empty());
        assert_eq!(inbox.frontend_ready("main").unwrap(), 2);
        assert_eq!(
            records.lock().unwrap().clone(),
            vec![("main".to_string(), "event-one-1234567890".to_string()), ("main".to_string(), "event-two-1234567890".to_string())]
        );
    }

    #[test]
    fn event_after_ready_is_delivered_immediately() {
        let inbox = NativeLaunchInbox::new();
        let (emitter, records) = recording_emitter();
        inbox.attach_emitter(emitter).unwrap();
        inbox.frontend_ready("main").unwrap();
        inbox.ingest(event("warm")).unwrap();
        assert_eq!(records.lock().unwrap().len(), 1);
    }

    #[test]
    fn acknowledgement_removes_event_and_replay_is_bounded() {
        let inbox = NativeLaunchInbox::new();
        let (emitter, records) = recording_emitter();
        inbox.attach_emitter(emitter).unwrap();
        inbox.frontend_ready("main").unwrap();
        let item = event("replay");
        inbox.ingest(item.clone()).unwrap();
        inbox.frontend_ready("main").unwrap();
        inbox.frontend_ready("main").unwrap();
        inbox.frontend_ready("main").unwrap();
        assert_eq!(records.lock().unwrap().len(), 3);
        assert_eq!(inbox.pending_events("main"), vec![item.clone()]);
        inbox.acknowledge("main", &item.event_id).unwrap();
        assert!(inbox.pending_events("main").is_empty());
    }

    #[test]
    fn duplicate_ids_and_idempotency_keys_are_suppressed() {
        let inbox = NativeLaunchInbox::new();
        let mut first = event("duplicate");
        first.idempotency_key = Some("same-operation".to_string());
        inbox.ingest(first.clone()).unwrap();
        assert_eq!(inbox.ingest(first), Err(NativeLaunchInboxError::Duplicate));
        let mut second = event("different");
        second.idempotency_key = Some("same-operation".to_string());
        assert_eq!(inbox.ingest(second), Err(NativeLaunchInboxError::Duplicate));
    }

    #[test]
    fn unknown_versions_oversized_payloads_and_queue_overflow_fail_closed() {
        let inbox = NativeLaunchInbox::with_queue_limit(1);
        let mut unknown = event("unknown");
        unknown.version = 2;
        assert_eq!(inbox.ingest(unknown), Err(NativeLaunchInboxError::UnsupportedVersion(2)));
        inbox.ingest(event("first")).unwrap();
        assert_eq!(inbox.ingest(event("overflow")), Err(NativeLaunchInboxError::QueueFull));

        let oversized = NativeInboundEvent {
            version: 1,
            event_id: "event-oversized-1234567890".to_string(),
            kind: NativeInboundEventKind::OpenPaths,
            timestamp_unix_ms: 1,
            idempotency_key: None,
            payload: NativeInboundPayload::OpenPaths(OpenPathsPayload { paths: vec!["x".repeat(MAX_SERIALIZED_EVENT_BYTES)] }),
        };
        assert_eq!(inbox.ingest(oversized), Err(NativeLaunchInboxError::Oversized));
    }

    #[test]
    fn simultaneous_producers_preserve_every_accepted_event() {
        let inbox = NativeLaunchInbox::new();
        let mut threads = Vec::new();
        for index in 0..32 {
            let inbox = inbox.clone();
            threads.push(std::thread::spawn(move || inbox.ingest(event(&index.to_string()))));
        }
        for thread in threads {
            thread.join().unwrap().unwrap();
        }
        let (emitter, records) = recording_emitter();
        inbox.attach_emitter(emitter).unwrap();
        inbox.frontend_ready("main").unwrap();
        assert_eq!(records.lock().unwrap().len(), 32);
    }

    #[test]
    fn first_ready_window_owns_event_and_other_windows_cannot_acknowledge() {
        let inbox = NativeLaunchInbox::new();
        let (emitter, _) = recording_emitter();
        inbox.attach_emitter(emitter).unwrap();
        inbox.frontend_ready("main").unwrap();
        inbox.frontend_ready("task-1").unwrap();
        let item = event("window");
        inbox.ingest(item.clone()).unwrap();
        assert_eq!(inbox.pending_events("main"), vec![item.clone()]);
        assert!(inbox.pending_events("task-1").is_empty());
        assert_eq!(inbox.acknowledge("task-1", &item.event_id), Err(NativeLaunchInboxError::WrongWindow));
    }

    #[test]
    fn shutdown_clears_events_and_rejects_late_callbacks() {
        let inbox = NativeLaunchInbox::new();
        inbox.ingest(event("queued")).unwrap();
        inbox.shutdown();
        assert!(inbox.pending_events("main").is_empty());
        assert_eq!(inbox.ingest(event("late")), Err(NativeLaunchInboxError::Shutdown));
    }

    #[test]
    fn quick_action_payload_remains_typed_and_secret_free() {
        let event =
            NativeLaunchInbox::from_quick_action(QuickActionRequestDto { kind: QuickActionKindDto::CompressZip, paths: vec!["/tmp/source".to_string()] });
        assert!(matches!(event.payload, NativeInboundPayload::ShellActionRequest(ShellActionRequestPayload { .. })));
        assert!(!serde_json::to_string(&event).unwrap().contains("password"));
    }

    #[test]
    fn hosted_auth_callback_preserves_native_handoff_fields() {
        let value = serde_json::json!({
            "version": 1,
            "eventId": "event-hosted-auth-1234567890",
            "kind": "hostedAuthCallback",
            "timestampUnixMs": 1,
            "idempotencyKey": "state-1234567890",
            "payload": {
                "state": "state-1234567890",
                "result": "completed",
                "handoffCode": "handoff-code-1234567890",
                "callbackUrl": "tzap://auth/callback"
            }
        });
        let event: NativeInboundEvent = serde_json::from_value(value).expect("native callback contract should deserialize");
        let NativeInboundPayload::HostedAuthCallback(payload) = &event.payload else {
            panic!("expected hosted auth callback payload");
        };
        assert_eq!(payload.handoff_code.as_deref(), Some("handoff-code-1234567890"));
        assert_eq!(payload.callback_url.as_deref(), Some("tzap://auth/callback"));
        assert_eq!(serde_json::to_value(&event).unwrap()["payload"]["handoffCode"], "handoff-code-1234567890");
        assert_eq!(serde_json::to_value(&event).unwrap()["payload"]["callbackUrl"], "tzap://auth/callback");
        NativeLaunchInbox::new().ingest(event).expect("valid hosted callback should enter the inbox");

        let cancelled: NativeInboundEvent = serde_json::from_value(serde_json::json!({
            "version": 1,
            "eventId": "event-hosted-cancelled-1234567890",
            "kind": "hostedAuthCallback",
            "timestampUnixMs": 1,
            "payload": {
                "state": "state-1234567890",
                "result": "cancelled",
                "callbackUrl": "tzap://auth/callback"
            }
        }))
        .expect("cancelled callback should deserialize");
        let cancelled_payload = serde_json::to_value(cancelled).unwrap()["payload"].clone();
        assert!(cancelled_payload.get("handoffCode").is_none());
    }

    #[test]
    fn hosted_auth_callback_rejects_missing_handoff_or_unsanitized_callback_url() {
        let base = serde_json::json!({
            "version": 1,
            "eventId": "event-hosted-auth-1234567890",
            "kind": "hostedAuthCallback",
            "timestampUnixMs": 1,
            "payload": {
                "state": "state-1234567890",
                "result": "completed",
                "callbackUrl": "tzap://auth/callback"
            }
        });
        let missing_handoff: NativeInboundEvent = serde_json::from_value(base.clone()).expect("payload should deserialize");
        assert!(matches!(NativeLaunchInbox::new().ingest(missing_handoff), Err(NativeLaunchInboxError::InvalidEvent(_))));

        let mut missing_callback_url = base.clone();
        missing_callback_url["payload"]["handoffCode"] = serde_json::Value::String("handoff-code-1234567890".to_owned());
        missing_callback_url["payload"].as_object_mut().unwrap().remove("callbackUrl");
        let missing_callback_url: NativeInboundEvent = serde_json::from_value(missing_callback_url).expect("payload should deserialize");
        assert!(matches!(NativeLaunchInbox::new().ingest(missing_callback_url), Err(NativeLaunchInboxError::InvalidEvent(_))));

        let mut unexpected_handoff = base.clone();
        unexpected_handoff["payload"]["result"] = serde_json::Value::String("cancelled".to_owned());
        unexpected_handoff["payload"]["handoffCode"] = serde_json::Value::String("handoff-code-1234567890".to_owned());
        let unexpected_handoff: NativeInboundEvent = serde_json::from_value(unexpected_handoff).expect("payload should deserialize");
        assert!(matches!(NativeLaunchInbox::new().ingest(unexpected_handoff), Err(NativeLaunchInboxError::InvalidEvent(_))));

        let mut unsanitized = base;
        unsanitized["payload"]["handoffCode"] = serde_json::Value::String("handoff-code-1234567890".to_owned());
        unsanitized["payload"]["callbackUrl"] = serde_json::Value::String("tzap://auth/callback?handoff_code=secret".to_owned());
        let unsanitized: NativeInboundEvent = serde_json::from_value(unsanitized).expect("payload should deserialize");
        assert!(matches!(NativeLaunchInbox::new().ingest(unsanitized), Err(NativeLaunchInboxError::InvalidEvent(_))));
    }

    #[test]
    fn shell_action_tokens_cannot_enter_the_executable_inbox() {
        let mut token_event = event("opaque-token");
        token_event.kind = NativeInboundEventKind::ShellActionRequest;
        token_event.payload = NativeInboundPayload::ShellActionToken(ShellActionTokenPayload { request_token: "opaque-request-token".to_string() });

        assert!(matches!(
            NativeLaunchInbox::new().ingest(token_event),
            Err(NativeLaunchInboxError::InvalidEvent(message))
                if message == "shell action tokens must be consumed before inbox ingestion"
        ));
    }
}
