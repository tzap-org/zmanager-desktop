#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::collections::{HashMap, HashSet};
use std::fs::{self, OpenOptions};
use std::io::{self, Write as _};
use std::path::{Component, Path};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use unicode_normalization::UnicodeNormalization;

use crate::dto::NativeFileDragRequest;
use crate::job_dto::JobKindDto;
use crate::platform::{NativeFileDragError, NativeFileDragItem, NativeFileDragStreamProvider};
use zmanager_core::jobs::CancellationToken;

const MAX_SESSIONS: usize = 16;
const SESSION_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const OPERATION_TIMEOUT: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
pub struct NativeDragSessionRegistry(Arc<Mutex<RegistryState>>);

#[derive(Clone)]
pub struct NativeDragOperationRegistry(Arc<Mutex<OperationRegistryState>>);

struct OperationRegistryState {
    next_id: u64,
    operations: HashMap<String, NativeDragOperation>,
}

#[derive(Clone)]
pub struct NativeDragOperation {
    pub job_id: String,
    pub kind: JobKindDto,
    pub request: NativeDragOperationRequest,
    created: Instant,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeDragOperationRequest {
    pub archive_path: String,
    pub entry_paths: Vec<String>,
    pub select_all: bool,
    pub excluded_entry_paths: Vec<String>,
    pub strip_components: usize,
}

impl From<&NativeFileDragRequest> for NativeDragOperationRequest {
    fn from(request: &NativeFileDragRequest) -> Self {
        Self {
            archive_path: request.archive_path.clone(),
            entry_paths: request.entry_paths.clone(),
            select_all: request.select_all,
            excluded_entry_paths: request.excluded_entry_paths.clone(),
            strip_components: request.strip_components,
        }
    }
}

impl NativeDragOperationRegistry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(OperationRegistryState { next_id: 0, operations: HashMap::new() })))
    }

    pub fn accept(&self, job_id: String, kind: JobKindDto, request: &NativeFileDragRequest) -> Result<String, NativeFileDragError> {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        if state.operations.len() >= MAX_SESSIONS {
            return Err(NativeFileDragError::new("Native drag operation capacity is unavailable", None::<String>));
        }
        state.next_id = state.next_id.checked_add(1).ok_or_else(|| NativeFileDragError::new("Native drag operation ID space is exhausted", None::<String>))?;
        let id = format!("native-drag-{}-{}", std::process::id(), state.next_id);
        state.operations.insert(id.clone(), NativeDragOperation { job_id, kind, request: request.into(), created: Instant::now() });
        Ok(id)
    }

    pub fn take(&self, operation_id: &str, request: &NativeFileDragRequest) -> Result<NativeDragOperation, NativeFileDragError> {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let Some(operation) = state.operations.get(operation_id.trim()).cloned() else {
            return Err(NativeFileDragError::invalid_request("Native drag operation is unavailable or expired"));
        };
        if operation.request != NativeDragOperationRequest::from(request) {
            return Err(NativeFileDragError::invalid_request("Native drag request does not match its accepted operation"));
        }
        state.operations.remove(operation_id.trim());
        Ok(operation)
    }

    pub fn reap_expired(&self) -> Vec<NativeDragOperation> {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let expired =
            state.operations.iter().filter(|(_, operation)| operation.created.elapsed() > OPERATION_TIMEOUT).map(|(id, _)| id.clone()).collect::<Vec<_>>();
        expired.into_iter().filter_map(|id| state.operations.remove(&id)).collect()
    }
}

struct RegistryState {
    next_id: u64,
    sessions: HashMap<String, DragSession>,
    shutdown: bool,
}

struct DragSession {
    job_id: String,
    promises: HashMap<String, Vec<NativeFileDragItem>>,
    stream_provider: NativeFileDragStreamProvider,
    created: Instant,
    completed: HashSet<String>,
    active: HashSet<String>,
    written_entries: usize,
    written_bytes: u64,
    cancellation: CancellationToken,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NativeFilePromiseDescriptor {
    pub promise_path: String,
    pub promised_name: String,
    pub is_directory: bool,
}

impl NativeDragSessionRegistry {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(RegistryState { next_id: 1, sessions: HashMap::new(), shutdown: false })))
    }

    #[cfg(test)]
    pub fn create(&self, items: &[NativeFileDragItem], stream_provider: NativeFileDragStreamProvider) -> Result<String, NativeFileDragError> {
        self.create_with_token(items, stream_provider, CancellationToken::new())
    }

    #[cfg(test)]
    pub fn create_with_token(
        &self,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        cancellation: CancellationToken,
    ) -> Result<String, NativeFileDragError> {
        self.create_with_job_token("test-native-drag", items, stream_provider, cancellation)
    }

    pub fn create_with_job_token(
        &self,
        job_id: &str,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
        cancellation: CancellationToken,
    ) -> Result<String, NativeFileDragError> {
        if items.is_empty() {
            return Err(NativeFileDragError::invalid_request("Native drag has no items"));
        }
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if state.shutdown || state.sessions.len() >= MAX_SESSIONS {
            return Err(NativeFileDragError::new("Native drag session capacity is unavailable", None::<String>));
        }
        let id = format!("drag-{}-{}", std::process::id(), state.next_id);
        state.next_id = state.next_id.saturating_add(1);
        let promises = group_promises(items)?;
        state.sessions.insert(
            id.clone(),
            DragSession {
                job_id: job_id.to_owned(),
                promises,
                stream_provider,
                created: Instant::now(),
                completed: HashSet::new(),
                active: HashSet::new(),
                written_entries: 0,
                written_bytes: 0,
                cancellation,
            },
        );
        Ok(id)
    }

    pub fn reap_expired(&self) -> Vec<String> {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let mut expired = Vec::new();
        state.sessions.retain(|_, session| {
            if session.created.elapsed() > SESSION_TIMEOUT {
                session.cancellation.cancel();
                expired.push(session.job_id.clone());
                false
            } else {
                true
            }
        });
        expired
    }

    pub fn descriptors(items: &[NativeFileDragItem]) -> Result<Vec<NativeFilePromiseDescriptor>, NativeFileDragError> {
        let promises = group_promises(items)?;
        let mut descriptors = promises
            .into_iter()
            .map(|(promise_path, members)| NativeFilePromiseDescriptor {
                promised_name: promise_path.clone(),
                is_directory: members.iter().any(|member| member.display_path != promise_path),
                promise_path,
            })
            .collect::<Vec<_>>();
        descriptors.sort_by(|left, right| left.promise_path.cmp(&right.promise_path));
        Ok(descriptors)
    }

    pub fn write_promise(&self, session_id: &str, promise_path: &str, destination: &Path) -> Result<u64, NativeFileDragError> {
        validate_destination(destination)?;
        let (members, provider, cancellation) = {
            let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
            let session = state.sessions.get_mut(session_id).ok_or_else(|| NativeFileDragError::invalid_request("Native drag session expired"))?;
            let Some(members) = session.promises.get(promise_path) else {
                return Err(NativeFileDragError::invalid_request("Native drag item is unavailable"));
            };
            if session.completed.contains(promise_path) || session.active.contains(promise_path) {
                return Err(NativeFileDragError::invalid_request("Native drag item is already being written or was completed"));
            }
            session.active.insert(promise_path.to_string());
            (members.clone(), Arc::clone(&session.stream_provider), session.cancellation.clone())
        };

        let is_directory = members.iter().any(|member| member.display_path != promise_path);
        let result = if is_directory {
            write_directory_promise(destination, promise_path, &members, &provider, &cancellation)
        } else {
            write_file_promise(destination, &members[0].entry_path, &provider, &cancellation)
        };

        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(session) = state.sessions.get_mut(session_id) {
            session.active.remove(promise_path);
            if result.is_ok() {
                session.completed.insert(promise_path.to_string());
                session.written_entries = session.written_entries.saturating_add(members.len());
                session.written_bytes = session.written_bytes.saturating_add(result.as_ref().copied().unwrap_or_default());
            }
        }
        result
    }

    pub fn cancel(&self, session_id: &str) {
        if let Some(session) = self.0.lock().unwrap_or_else(|e| e.into_inner()).sessions.remove(session_id) {
            session.cancellation.cancel();
        }
    }

    pub fn take_completed_summary(&self, session_id: &str) -> Option<(usize, u64)> {
        let mut state = self.0.lock().unwrap_or_else(|error| error.into_inner());
        let session = state.sessions.get(session_id)?;
        if session.completed.len() < session.promises.len() || !session.active.is_empty() {
            return None;
        }
        let session = state.sessions.remove(session_id)?;
        Some((session.written_entries, session.written_bytes))
    }

    pub fn shutdown(&self) {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        state.shutdown = true;
        for session in state.sessions.values() {
            session.cancellation.cancel();
        }
        state.sessions.clear();
    }

    #[cfg(test)]
    fn count(&self) -> usize {
        self.0.lock().unwrap().sessions.len()
    }
}

fn group_promises(items: &[NativeFileDragItem]) -> Result<HashMap<String, Vec<NativeFileDragItem>>, NativeFileDragError> {
    let mut normalized_promises = HashMap::<String, (String, Vec<NativeFileDragItem>)>::new();
    for item in items {
        validate_promised_path(&item.display_path)?;
        let mut components = item.display_path.split('/').filter(|part| !part.is_empty());
        let Some(root) = components.next() else {
            return Err(NativeFileDragError::invalid_request("Native drag item has no promised name"));
        };
        if root == "." || root == ".." || root.len() > 255 {
            return Err(NativeFileDragError::invalid_request("Native drag item has an invalid promised name"));
        }
        let collision_key = root.nfd().flat_map(char::to_lowercase).collect::<String>();
        let promise = normalized_promises.entry(collision_key).or_insert_with(|| (root.to_string(), Vec::new()));
        if promise.0 != root {
            return Err(NativeFileDragError::invalid_request(format!("promised top-level names collide on macOS: {} and {root}", promise.0)));
        }
        promise.1.push(item.clone());
    }
    reject_normalized_path_collisions(items)?;
    if normalized_promises.is_empty() {
        return Err(NativeFileDragError::invalid_request("Native drag has no promises"));
    }
    let mut promises = HashMap::new();
    for (_, (root, members)) in normalized_promises {
        if members.len() > 1 && members.iter().any(|member| member.display_path == root) {
            return Err(NativeFileDragError::invalid_request(format!("promised name is both a file and directory: {root}")));
        }
        promises.insert(root, members);
    }
    Ok(promises)
}

fn validate_promised_path(path: &str) -> Result<(), NativeFileDragError> {
    let components = path.split('/').collect::<Vec<_>>();
    if components.is_empty() || components.iter().any(|part| part.is_empty() || *part == "." || *part == ".." || part.len() > 255) {
        return Err(NativeFileDragError::invalid_request("Native drag item has an invalid or overlong path component"));
    }
    Ok(())
}

fn reject_normalized_path_collisions(items: &[NativeFileDragItem]) -> Result<(), NativeFileDragError> {
    let mut paths = HashMap::<String, &str>::new();
    for item in items {
        let key = item.display_path.split('/').map(|component| component.nfd().flat_map(char::to_lowercase).collect::<String>()).collect::<Vec<_>>().join("/");
        if let Some(previous) = paths.insert(key, &item.display_path) {
            return Err(NativeFileDragError::invalid_request(format!("promised paths collide on macOS: {previous} and {}", item.display_path)));
        }
    }
    Ok(())
}

fn write_directory_promise(
    destination: &Path,
    promise_path: &str,
    members: &[NativeFileDragItem],
    provider: &NativeFileDragStreamProvider,
    cancellation: &CancellationToken,
) -> Result<u64, NativeFileDragError> {
    fs::create_dir(destination).map_err(io_drag_error)?;
    let result = (|| {
        let mut total = 0_u64;
        for member in members {
            let relative = member
                .display_path
                .strip_prefix(promise_path)
                .and_then(|path| path.strip_prefix('/'))
                .ok_or_else(|| NativeFileDragError::invalid_request("Invalid promised directory member"))?;
            let relative_path = Path::new(relative);
            if relative_path.as_os_str().is_empty()
                || relative_path.is_absolute()
                || relative_path.components().any(|part| matches!(part, Component::ParentDir))
            {
                return Err(NativeFileDragError::invalid_request("Invalid promised directory member"));
            }
            total = total.saturating_add(write_file_promise(&destination.join(relative_path), &member.entry_path, provider, cancellation)?);
        }
        Ok(total)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(destination);
    }
    result
}

fn write_file_promise(
    destination: &Path,
    entry_path: &str,
    provider: &NativeFileDragStreamProvider,
    cancellation: &CancellationToken,
) -> Result<u64, NativeFileDragError> {
    if cancellation.is_cancelled() {
        return Err(cancelled_drag_error());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(io_drag_error)?;
    }
    let mut file = OpenOptions::new().write(true).create_new(true).open(destination).map_err(io_drag_error)?;
    let mut writer = CancellationWriter { inner: &mut file, cancellation };
    let streamed = provider(entry_path, &mut writer);
    let result = streamed.and_then(|written| {
        if cancellation.is_cancelled() {
            return Err(cancelled_drag_error());
        }
        file.flush().map_err(io_drag_error)?;
        Ok(written)
    });
    if result.is_err() {
        let _ = fs::remove_file(destination);
    }
    result
}

struct CancellationWriter<'a> {
    inner: &'a mut fs::File,
    cancellation: &'a CancellationToken,
}

impl io::Write for CancellationWriter<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if self.cancellation.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::ConnectionAborted, "native drag cancelled"));
        }
        self.inner.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn cancelled_drag_error() -> NativeFileDragError {
    NativeFileDragError::new("Native drag was cancelled", None::<String>)
}

fn validate_destination(path: &Path) -> Result<(), NativeFileDragError> {
    if !path.is_absolute() || path.components().any(|component| matches!(component, Component::ParentDir)) {
        return Err(NativeFileDragError::invalid_request("Finder destination is invalid"));
    }
    Ok(())
}

fn io_drag_error(error: std::io::Error) -> NativeFileDragError {
    NativeFileDragError::new(format!("Unable to write promised Finder item: {error}"), Some("Remove a conflicting item or choose another Finder destination."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Barrier;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn item(path: &str) -> NativeFileDragItem {
        NativeFileDragItem { entry_path: path.to_string(), display_path: path.to_string(), size: Some(7), modified_unix_seconds: None }
    }

    #[test]
    fn creates_descriptors_without_streaming_until_destination_arrives() {
        let calls = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&calls);
        let provider: NativeFileDragStreamProvider = Arc::new(move |_, writer| {
            observed.fetch_add(1, Ordering::SeqCst);
            writer.write_all(b"payload").unwrap();
            Ok(7)
        });
        let registry = NativeDragSessionRegistry::new();
        let id = registry.create(&[item("demo.txt")], provider).unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        let root = std::env::temp_dir().join(format!("zmanager-promise-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let destination = root.join("demo.txt");
        assert_eq!(registry.write_promise(&id, "demo.txt", &destination).unwrap(), 7);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(fs::read(&destination).unwrap(), b"payload");
        assert_eq!(registry.take_completed_summary(&id), Some((1, 7)));
        assert_eq!(registry.count(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn treats_a_nested_single_file_after_path_stripping_as_a_file_promise() {
        let descriptors = NativeDragSessionRegistry::descriptors(&[NativeFileDragItem {
            entry_path: "docs/readme.txt".to_string(),
            display_path: "readme.txt".to_string(),
            size: Some(7),
            modified_unix_seconds: None,
        }])
        .unwrap();

        assert_eq!(
            descriptors,
            vec![NativeFilePromiseDescriptor { promise_path: "readme.txt".to_string(), promised_name: "readme.txt".to_string(), is_directory: false }]
        );
    }

    #[test]
    fn failure_cleans_partial_output_and_cancel_shutdown_are_idempotent() {
        let provider: NativeFileDragStreamProvider = Arc::new(move |_, writer| {
            writer.write_all(b"partial").unwrap();
            Err(NativeFileDragError::new("stream failed", None::<String>))
        });
        let registry = NativeDragSessionRegistry::new();
        let id = registry.create(&[item("bad.txt")], provider).unwrap();
        let destination = std::env::temp_dir().join(format!("zmanager-bad-{}", std::process::id()));
        let _ = fs::remove_file(&destination);
        assert!(registry.write_promise(&id, "bad.txt", &destination).is_err());
        assert!(!destination.exists());
        registry.cancel(&id);
        registry.cancel(&id);
        registry.shutdown();
        registry.shutdown();
        assert_eq!(registry.count(), 0);
    }

    #[test]
    fn groups_nested_members_into_one_top_level_directory_promise() {
        let calls = Arc::new(Mutex::new(Vec::<String>::new()));
        let observed = Arc::clone(&calls);
        let provider: NativeFileDragStreamProvider = Arc::new(move |entry, writer| {
            observed.lock().unwrap().push(entry.to_string());
            writer.write_all(entry.as_bytes()).unwrap();
            Ok(entry.len() as u64)
        });
        let items = vec![item("docs/a.txt"), item("docs/nested/b.txt")];
        let descriptors = NativeDragSessionRegistry::descriptors(&items).unwrap();
        assert_eq!(descriptors, vec![NativeFilePromiseDescriptor { promise_path: "docs".to_string(), promised_name: "docs".to_string(), is_directory: true }]);
        let registry = NativeDragSessionRegistry::new();
        let id = registry.create(&items, provider).unwrap();
        let root = std::env::temp_dir().join(format!("zmanager-promise-dir-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        assert!(registry.write_promise(&id, "docs", &root).is_ok());
        assert_eq!(fs::read(root.join("a.txt")).unwrap(), b"docs/a.txt");
        assert_eq!(fs::read(root.join("nested/b.txt")).unwrap(), b"docs/nested/b.txt");
        assert_eq!(calls.lock().unwrap().len(), 2);
        assert_eq!(registry.take_completed_summary(&id), Some((2, 27)));
        assert_eq!(registry.count(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_case_and_unicode_equivalent_top_level_names() {
        let provider: NativeFileDragStreamProvider = Arc::new(|_, _| Ok(0));
        let registry = NativeDragSessionRegistry::new();
        assert!(registry.create(&[item("Docs/a.txt"), item("docs/b.txt")], Arc::clone(&provider)).is_err());
        assert!(registry.create(&[item("Café/a.txt"), item("Cafe\u{301}/b.txt")], provider).is_err());
    }

    #[test]
    fn destination_conflicts_are_not_overwritten_or_deleted() {
        let provider: NativeFileDragStreamProvider = Arc::new(|_, writer| {
            writer.write_all(b"replacement").unwrap();
            Ok(11)
        });
        let registry = NativeDragSessionRegistry::new();
        let root = std::env::temp_dir().join(format!("zmanager-promise-conflict-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let destination = root.join("existing.txt");
        fs::write(&destination, b"original").unwrap();
        let id = registry.create(&[item("existing.txt")], provider).unwrap();
        assert!(registry.write_promise(&id, "existing.txt", &destination).is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        registry.cancel(&id);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn writes_multiple_top_level_promises_concurrently_and_claims_each_only_once() {
        let provider: NativeFileDragStreamProvider = Arc::new(|entry, writer| {
            writer.write_all(entry.as_bytes()).map_err(io_drag_error)?;
            Ok(entry.len() as u64)
        });
        let registry = NativeDragSessionRegistry::new();
        let id = registry.create(&[item("one.txt"), item("two.txt")], provider).unwrap();
        let root = std::env::temp_dir().join(format!("zmanager-promise-concurrent-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let first_registry = registry.clone();
        let first_id = id.clone();
        let first_destination = root.join("one.txt");
        let first = std::thread::spawn(move || first_registry.write_promise(&first_id, "one.txt", &first_destination));
        let second_registry = registry.clone();
        let second_id = id.clone();
        let second_destination = root.join("two.txt");
        let second = std::thread::spawn(move || second_registry.write_promise(&second_id, "two.txt", &second_destination));
        assert!(first.join().unwrap().is_ok());
        assert!(second.join().unwrap().is_ok());
        assert_eq!(fs::read(root.join("one.txt")).unwrap(), b"one.txt");
        assert_eq!(fs::read(root.join("two.txt")).unwrap(), b"two.txt");
        assert_eq!(registry.take_completed_summary(&id), Some((2, 14)));
        assert_eq!(registry.count(), 0);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_duplicate_callback_while_the_same_promise_is_active() {
        let started = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let provider_started = Arc::clone(&started);
        let provider_release = Arc::clone(&release);
        let provider: NativeFileDragStreamProvider = Arc::new(move |_, writer| {
            provider_started.wait();
            provider_release.wait();
            writer.write_all(b"payload").map_err(io_drag_error)?;
            Ok(7)
        });
        let registry = NativeDragSessionRegistry::new();
        let id = registry.create(&[item("once.txt")], provider).unwrap();
        let root = std::env::temp_dir().join(format!("zmanager-promise-claim-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let thread_registry = registry.clone();
        let thread_id = id.clone();
        let first_destination = root.join("once.txt");
        let first = std::thread::spawn(move || thread_registry.write_promise(&thread_id, "once.txt", &first_destination));
        started.wait();
        assert!(registry.write_promise(&id, "once.txt", &root.join("duplicate.txt")).is_err());
        release.wait();
        assert!(first.join().unwrap().is_ok());
        assert!(!root.join("duplicate.txt").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cancellation_interrupts_an_active_stream_and_removes_partial_output() {
        let (started, started_receiver) = std::sync::mpsc::channel();
        let release = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
        let provider_release = Arc::clone(&release);
        let provider: NativeFileDragStreamProvider = Arc::new(move |_, writer| {
            writer.write_all(b"partial").map_err(io_drag_error)?;
            started.send(()).unwrap();
            let (lock, condition) = &*provider_release;
            let released = lock.lock().unwrap();
            drop(condition.wait_while(released, |released| !*released).unwrap());
            writer.write_all(b"after-cancel").map_err(io_drag_error)?;
            Ok(19)
        });
        let registry = NativeDragSessionRegistry::new();
        let id = registry.create(&[item("cancel.txt")], provider).unwrap();
        let destination = std::env::temp_dir().join(format!("zmanager-promise-active-cancel-{}", std::process::id()));
        let _ = fs::remove_file(&destination);
        let thread_registry = registry.clone();
        let thread_id = id.clone();
        let thread_destination = destination.clone();
        let write = std::thread::spawn(move || thread_registry.write_promise(&thread_id, "cancel.txt", &thread_destination));
        started_receiver.recv_timeout(Duration::from_secs(5)).expect("stream should start");
        registry.cancel(&id);
        let (lock, condition) = &*release;
        *lock.lock().unwrap() = true;
        condition.notify_all();
        assert!(write.join().unwrap().is_err());
        assert!(!destination.exists());
        assert_eq!(registry.count(), 0);
    }

    #[test]
    fn rejects_nested_normalization_collisions_and_overlong_components() {
        let provider: NativeFileDragStreamProvider = Arc::new(|_, _| Ok(0));
        let registry = NativeDragSessionRegistry::new();
        assert!(registry.create(&[item("docs/Café.txt"), item("docs/Cafe\u{301}.txt")], Arc::clone(&provider),).is_err());
        let overlong = format!("docs/{}.txt", "x".repeat(252));
        assert!(registry.create(&[item(&overlong)], provider).is_err());
    }

    #[test]
    fn rejects_exact_duplicate_promised_paths_instead_of_dropping_an_item() {
        let provider: NativeFileDragStreamProvider = Arc::new(|_, _| Ok(0));
        let registry = NativeDragSessionRegistry::new();
        assert!(registry.create(&[item("duplicate.txt"), item("duplicate.txt")], provider).is_err());
    }
}
