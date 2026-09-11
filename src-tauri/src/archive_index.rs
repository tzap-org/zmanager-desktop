use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use tokio::sync::watch;
use zmanager_core::archive_browser::{self, BrowserEntry, BrowserListOptions};

use crate::dto::{
    ArchiveChildrenPageDto, ArchiveChildrenRequest, ArchiveEntryDto, ArchiveEntryKindDto, ArchiveIndexSnapshotDto, ArchiveIndexStartResponseDto,
    ArchiveIndexStatusDto, ArchiveSearchRequest, StartArchiveIndexRequest,
};
use crate::error::CommandErrorDto;
use crate::{diagnostics, diagnostics::DiagnosticLog};

const MAX_ACTIVE_ARCHIVE_SESSIONS: usize = 4;
const MAX_ARCHIVE_INDEX_ENTRIES: usize = 500_000;
const MAX_ARCHIVE_INDEX_METADATA_BYTES: usize = 256 * 1024 * 1024;
const DEFAULT_ARCHIVE_PAGE_SIZE: usize = 200;
const MAX_ARCHIVE_PAGE_SIZE: usize = 512;
const ARCHIVE_INDEX_PUBLICATION_BATCH: usize = 256;
const ARCHIVE_INDEX_PUBLICATION_INTERVAL: Duration = Duration::from_millis(50);

#[derive(Clone)]
pub struct ArchiveIndexRegistry {
    state: Arc<Mutex<RegistryState>>,
    diagnostics: Option<DiagnosticLog>,
}

struct RegistryState {
    next_session_id: u64,
    sessions: HashMap<String, SessionRecord>,
}

struct SessionRecord {
    snapshot: Arc<ArchiveIndexSnapshotDto>,
    sender: watch::Sender<Arc<ArchiveIndexSnapshotDto>>,
    index: Arc<Mutex<ArchiveIndex>>,
    cancelled: Arc<AtomicBool>,
    password: Option<String>,
}

struct ArchiveIndex {
    entries: HashMap<String, ArchiveEntryDto>,
    children: HashMap<String, BTreeSet<String>>,
    loaded_directories: std::collections::HashSet<String>,
    entry_count: usize,
    total_bytes: u64,
    has_total: bool,
    estimated_metadata_bytes: usize,
}

impl ArchiveIndexRegistry {
    pub fn new() -> Self {
        Self { state: Arc::new(Mutex::new(RegistryState { next_session_id: 0, sessions: HashMap::new() })), diagnostics: None }
    }

    pub fn with_diagnostics(diagnostics: DiagnosticLog) -> Self {
        Self { diagnostics: Some(diagnostics), ..Self::new() }
    }

    pub fn start(&self, request: StartArchiveIndexRequest) -> Result<ArchiveIndexStartResponseDto, CommandErrorDto> {
        let archive_path = request.archive_path.trim().to_string();
        if archive_path.is_empty() {
            return Err(CommandErrorDto::invalid_request("archivePath cannot be empty"));
        }
        // Detecting a format is intentionally tolerant and maps a missing
        // path to `Unknown`; that would otherwise make an absent archive look
        // like a generic asynchronous I/O failure. Establish the command
        // contract at the boundary while preserving the worker's handling of
        // existing but unreadable paths.
        if let Err(error) = std::fs::metadata(&archive_path)
            && error.kind() == std::io::ErrorKind::NotFound
        {
            return Err(CommandErrorDto::not_found(
                format!("could not find archive: {archive_path}"),
                Some("Check that the archive path exists and is accessible.".to_string()),
            ));
        }
        let password = request.password.map(|value| value.trim().to_string()).filter(|value| !value.is_empty());

        let (session_id, snapshot, cancelled, index) = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            if state.sessions.len() >= MAX_ACTIVE_ARCHIVE_SESSIONS {
                return Err(CommandErrorDto::operation_failed("Too many archives are currently opening. Close an archive and try again."));
            }
            state.next_session_id = state.next_session_id.checked_add(1).ok_or_else(|| CommandErrorDto::operation_failed("Archive session IDs exhausted."))?;
            let session_id = format!("archive-{}", state.next_session_id);
            let format = Some(crate::dto::ArchiveFormatKindDto::from(zmanager_core::archive_format::detect_archive_format(&archive_path)));
            let snapshot = Arc::new(ArchiveIndexSnapshotDto {
                revision: "1".to_string(),
                session_id: session_id.clone(),
                archive_path: archive_path.clone(),
                status: ArchiveIndexStatusDto::Indexing,
                discovered_entries: 0,
                discovered_bytes: None,
                final_entry_count: None,
                final_total_bytes: None,
                latest_failure: None,
                format,
            });
            let (sender, _) = watch::channel(snapshot.clone());
            let cancelled = Arc::new(AtomicBool::new(false));
            let index = Arc::new(Mutex::new(ArchiveIndex::new()));
            state.sessions.insert(
                session_id.clone(),
                SessionRecord { snapshot: snapshot.clone(), sender, index: index.clone(), cancelled: cancelled.clone(), password: password.clone() },
            );
            (session_id, snapshot, cancelled, index)
        };
        let archive_bytes = std::fs::metadata(&archive_path).ok().map(|metadata| metadata.len());
        self.record(
            "started",
            diagnostics::fields([
                ("archiveBytes", archive_bytes.map(serde_json::Value::from).unwrap_or(serde_json::Value::Null)),
                ("format", serde_json::Value::String(archive_format_label(&archive_path))),
                ("sessionId", serde_json::Value::String(session_id.clone())),
            ]),
        );

        let registry = self.clone();
        let spawn_failure_registry = self.clone();
        let worker_session_id = session_id.clone();
        let spawn_failure_session_id = session_id.clone();
        let worker_started = Instant::now();
        if let Err(error) = thread::Builder::new().name("archive-index".to_string()).spawn(move || {
            if archive_browser::supports_on_demand_directories(&archive_path) {
                registry.finish(&worker_session_id, Ok(ArchiveIndexStatistics { entry_count: 0, total_bytes: Some(0) }), worker_started.elapsed());
                return;
            }

            let mut last_publication = Instant::now();
            let mut unpublished_entries = 0;
            let mut index_error = None;
            let result = archive_browser::visit_entries_with_options(
                Path::new(&archive_path),
                BrowserListOptions { password: password.as_deref(), ..Default::default() },
                |entry| {
                    if cancelled.load(AtomicOrdering::Acquire) {
                        return false;
                    }
                    let insertion = index.lock().unwrap_or_else(|error| error.into_inner()).insert(entry);
                    if let Err(error) = insertion {
                        index_error = Some(error);
                        return false;
                    }
                    unpublished_entries += 1;
                    if unpublished_entries >= ARCHIVE_INDEX_PUBLICATION_BATCH || last_publication.elapsed() >= ARCHIVE_INDEX_PUBLICATION_INTERVAL {
                        let statistics = index.lock().unwrap_or_else(|error| error.into_inner()).statistics();
                        registry.publish_progress(&worker_session_id, statistics);
                        unpublished_entries = 0;
                        last_publication = Instant::now();
                    }
                    true
                },
            )
            .map(|_| index.lock().unwrap_or_else(|error| error.into_inner()).statistics())
            .map_err(crate::platform::map_archive_browser_error);
            if cancelled.load(AtomicOrdering::Acquire) {
                return;
            }
            registry.finish(&worker_session_id, index_error.map_or(result, Err), worker_started.elapsed());
        }) {
            spawn_failure_registry.finish(
                &spawn_failure_session_id,
                Err(CommandErrorDto::operation_failed(format!("Archive indexing worker could not start: {error}"))),
                worker_started.elapsed(),
            );
        }

        Ok(ArchiveIndexStartResponseDto { session_id, snapshot: (*snapshot).clone() })
    }

    pub async fn wait_for_change(&self, session_id: &str, after_revision: Option<&str>) -> Result<ArchiveIndexSnapshotDto, CommandErrorDto> {
        let mut receiver = {
            let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.sessions.get(session_id).map(|record| record.sender.subscribe()).ok_or_else(|| archive_session_not_found(session_id))?
        };
        loop {
            let snapshot = receiver.borrow().clone();
            if after_revision.is_none_or(|revision| revision != snapshot.revision) || snapshot.status != ArchiveIndexStatusDto::Indexing {
                return Ok((*snapshot).clone());
            }
            receiver.changed().await.map_err(|_| archive_session_not_found(session_id))?;
        }
    }

    pub async fn children(&self, request: ArchiveChildrenRequest) -> Result<ArchiveChildrenPageDto, CommandErrorDto> {
        let parent_path = normalize_archive_path(&request.parent_path);

        let (archive_path, password, index_mutex, revision) = {
            let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            let record = state.sessions.get(&request.session_id).ok_or_else(|| archive_session_not_found(&request.session_id))?;
            if record.snapshot.status == ArchiveIndexStatusDto::Failed {
                return Err(record.snapshot.latest_failure.clone().unwrap_or_else(|| CommandErrorDto::operation_failed("Archive indexing failed.")));
            }
            (record.snapshot.archive_path.clone(), record.password.clone(), record.index.clone(), record.snapshot.revision.clone())
        };

        if archive_browser::supports_on_demand_directories(&archive_path) {
            let needs_load = {
                let index = index_mutex.lock().unwrap_or_else(|e| e.into_inner());
                !index.loaded_directories.contains(&parent_path)
            };
            if needs_load {
                let archive_path_clone = archive_path.clone();
                let parent_path_clone = parent_path.clone();
                let password_clone = password.clone();

                let listing = tokio::task::spawn_blocking(move || {
                    archive_browser::list_directory_with_options(
                        &archive_path_clone,
                        &parent_path_clone,
                        BrowserListOptions { password: password_clone.as_deref(), ..Default::default() },
                    )
                })
                .await
                .map_err(|e| CommandErrorDto::operation_failed(format!("Task panic: {}", e)))?
                .map_err(crate::platform::map_archive_browser_error)?;

                let mut index = index_mutex.lock().unwrap_or_else(|e| e.into_inner());
                // Double-checked locking to prevent TOCTOU race condition
                if !index.loaded_directories.contains(&parent_path) {
                    for entry in listing.entries {
                        let _ = index.insert(entry);
                    }
                    index.loaded_directories.insert(parent_path.clone());
                    // For an empty root directory that has no entries, we might not get any entries, but we still marked it loaded.
                    // However, we must ensure it exists in `children` map so we don't get an empty set incorrectly.
                    index.children.entry(parent_path.clone()).or_default();
                }
            }
        }

        let index = index_mutex.lock().unwrap_or_else(|error| error.into_inner());
        let sort_key = request.sort_key.as_deref().unwrap_or("name");
        let ascending = request.sort_ascending.unwrap_or(true);
        let mut child_entries: Vec<&ArchiveEntryDto> =
            index.children.get(&parent_path).map(|paths| paths.iter().filter_map(|path| index.entries.get(path)).collect()).unwrap_or_default();
        child_entries.sort_by(|left, right| compare_entries_by_sort(left, right, sort_key, ascending));
        let total_count = child_entries.len();
        let cursor_scope = format!("{parent_path}\0{sort_key}\0{ascending}");
        let limit = request.limit.unwrap_or(DEFAULT_ARCHIVE_PAGE_SIZE).clamp(1, MAX_ARCHIVE_PAGE_SIZE);
        let offset = decode_cursor(request.cursor.as_deref(), &request.session_id, &cursor_scope, &revision)?;
        if offset > total_count {
            return Err(CommandErrorDto::invalid_request("Archive page cursor is out of range."));
        }
        let end = offset.saturating_add(limit).min(total_count);
        let entries = child_entries[offset..end].iter().map(|&entry| entry.clone()).collect();
        let next_cursor = (end < total_count).then(|| encode_cursor(&request.session_id, &cursor_scope, &revision, end));
        Ok(ArchiveChildrenPageDto {
            session_id: request.session_id,
            revision,
            parent_path,
            entries,
            next_cursor,
            complete: end == total_count,
            child_count: total_count,
        })
    }

    pub fn close(&self, session_id: &str) -> Result<(), CommandErrorDto> {
        let record =
            self.state.lock().unwrap_or_else(|error| error.into_inner()).sessions.remove(session_id).ok_or_else(|| archive_session_not_found(session_id))?;
        record.cancelled.store(true, AtomicOrdering::Release);
        let cancelled = Arc::new(ArchiveIndexSnapshotDto {
            revision: next_revision(&record.snapshot.revision),
            session_id: session_id.to_string(),
            archive_path: record.snapshot.archive_path.clone(),
            status: ArchiveIndexStatusDto::Cancelled,
            discovered_entries: record.snapshot.discovered_entries,
            discovered_bytes: record.snapshot.discovered_bytes,
            final_entry_count: None,
            final_total_bytes: None,
            latest_failure: None,
            format: record.snapshot.format,
        });
        record.sender.send_replace(cancelled);
        Ok(())
    }

    pub fn search(&self, request: ArchiveSearchRequest) -> Result<ArchiveChildrenPageDto, CommandErrorDto> {
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let record = state.sessions.get(&request.session_id).ok_or_else(|| archive_session_not_found(&request.session_id))?;
        if record.snapshot.status == ArchiveIndexStatusDto::Indexing {
            return Err(CommandErrorDto::operation_failed("Archive search becomes available when indexing is complete."));
        }
        if archive_browser::supports_on_demand_directories(&record.snapshot.archive_path) {
            return Err(CommandErrorDto::operation_failed("Search is not currently supported for on-demand archives."));
        }
        let index = record.index.lock().unwrap_or_else(|error| error.into_inner());
        let normalized_query = request.query.trim().to_lowercase();
        let mut matching_entries: Vec<&ArchiveEntryDto> =
            index.entries.values().filter(|entry| normalized_query.is_empty() || case_insensitive_contains(&entry.path, &normalized_query)).collect();
        let sort_key = request.sort_key.as_deref().unwrap_or("name");
        let ascending = request.sort_ascending.unwrap_or(true);
        matching_entries.sort_by(|left, right| compare_entries_by_sort(left, right, sort_key, ascending));
        let total_count = matching_entries.len();
        let cursor_scope = format!("?search={normalized_query}\0{sort_key}\0{ascending}");
        let limit = request.limit.unwrap_or(DEFAULT_ARCHIVE_PAGE_SIZE).clamp(1, MAX_ARCHIVE_PAGE_SIZE);
        let offset = decode_cursor(request.cursor.as_deref(), &request.session_id, &cursor_scope, &record.snapshot.revision)?;
        if offset > total_count {
            return Err(CommandErrorDto::invalid_request("Archive search cursor is out of range."));
        }
        let end = offset.saturating_add(limit).min(total_count);
        let entries = matching_entries[offset..end].iter().map(|&entry| entry.clone()).collect();
        let next_cursor = (end < total_count).then(|| encode_cursor(&request.session_id, &cursor_scope, &record.snapshot.revision, end));
        Ok(ArchiveChildrenPageDto {
            session_id: request.session_id,
            revision: record.snapshot.revision.clone(),
            parent_path: String::new(),
            entries,
            next_cursor,
            complete: end == total_count,
            child_count: total_count,
        })
    }

    /// Returns the password retained by the newest live session for an archive.
    ///
    /// The password stays backend-only and is used to continue operations such
    /// as preview after the archive was opened with a password. Failed and
    /// cancelled sessions are excluded so a superseded attempt cannot provide
    /// stale credentials to a later command.
    pub fn password_for_archive(&self, archive_path: &str) -> Option<String> {
        let normalized_archive_path = archive_path.trim();
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state
            .sessions
            .values()
            .filter(|record| {
                record.snapshot.archive_path == normalized_archive_path
                    && record.snapshot.status != ArchiveIndexStatusDto::Failed
                    && record.snapshot.status != ArchiveIndexStatusDto::Cancelled
            })
            .max_by_key(|record| archive_session_sequence(&record.snapshot.session_id))
            .and_then(|record| record.password.clone())
    }

    pub fn drag_entries(&self, archive_path: &str, entry_paths: &[String]) -> Result<Option<Vec<ArchiveEntryDto>>, CommandErrorDto> {
        let normalized_archive_path = archive_path.trim();
        let state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some(record) = state
            .sessions
            .values()
            .filter(|record| {
                record.snapshot.archive_path == normalized_archive_path
                    && record.snapshot.status != ArchiveIndexStatusDto::Failed
                    && record.snapshot.status != ArchiveIndexStatusDto::Cancelled
            })
            .max_by_key(|record| archive_session_sequence(&record.snapshot.session_id))
        else {
            return Ok(None);
        };
        let index = record.index.lock().unwrap_or_else(|error| error.into_inner());
        let mut selected_paths = BTreeSet::new();
        let mut selected_entries = Vec::new();
        for requested in entry_paths {
            let requested = normalize_archive_path(requested);
            let direct = index.entries.get(&requested);
            if let Some(entry) = direct
                && entry.kind == ArchiveEntryKindDto::File
            {
                if selected_paths.insert(entry.path.clone()) {
                    selected_entries.push(entry.clone());
                }
                continue;
            }
            if direct.is_some_and(|entry| entry.kind != ArchiveEntryKindDto::Directory) {
                return Err(CommandErrorDto::unsupported_format(format!("entry cannot be dragged out as a virtual file: {requested}")));
            }

            if record.snapshot.status == ArchiveIndexStatusDto::Indexing {
                return Ok(None);
            }
            let prefix = format!("{requested}/");
            let mut descendants =
                index.entries.values().filter(|entry| entry.kind == ArchiveEntryKindDto::File && entry.path.starts_with(&prefix)).cloned().collect::<Vec<_>>();
            descendants.sort_by(|left, right| left.path.cmp(&right.path));
            if descendants.is_empty() {
                return Err(CommandErrorDto::not_found(
                    format!("archive entry not found: {requested}"),
                    Some("Open the archive again or choose a visible entry.".to_string()),
                ));
            }
            for entry in descendants {
                if selected_paths.insert(entry.path.clone()) {
                    selected_entries.push(entry);
                }
            }
        }
        Ok(Some(selected_entries))
    }

    fn publish_progress(&self, session_id: &str, statistics: ArchiveIndexStatistics) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some(record) = state.sessions.get_mut(session_id) else {
            return;
        };
        if record.cancelled.load(AtomicOrdering::Acquire) {
            return;
        }
        let is_first_content = record.snapshot.discovered_entries == 0 && statistics.entry_count > 0;
        let revision = next_revision(&record.snapshot.revision);
        let snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision,
            session_id: session_id.to_string(),
            archive_path: record.snapshot.archive_path.clone(),
            status: ArchiveIndexStatusDto::Indexing,
            discovered_entries: statistics.entry_count,
            discovered_bytes: statistics.total_bytes,
            final_entry_count: None,
            final_total_bytes: None,
            latest_failure: None,
            format: record.snapshot.format,
        });
        record.snapshot = snapshot.clone();
        record.sender.send_replace(snapshot);
        drop(state);
        if is_first_content {
            self.record(
                "firstContentIndexed",
                diagnostics::fields([
                    ("discoveredEntries", serde_json::Value::from(statistics.entry_count)),
                    ("sessionId", serde_json::Value::String(session_id.to_string())),
                ]),
            );
        }
    }

    fn finish(&self, session_id: &str, result: Result<ArchiveIndexStatistics, CommandErrorDto>, elapsed: Duration) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let Some(record) = state.sessions.get_mut(session_id) else {
            return;
        };
        if record.cancelled.load(AtomicOrdering::Acquire) {
            return;
        }
        let snapshot = match result {
            Ok(statistics) => {
                let status = if statistics.entry_count == 0 { ArchiveIndexStatusDto::Empty } else { ArchiveIndexStatusDto::Ready };
                ArchiveIndexSnapshotDto {
                    revision: next_revision(&record.snapshot.revision),
                    session_id: session_id.to_string(),
                    archive_path: record.snapshot.archive_path.clone(),
                    status,
                    discovered_entries: statistics.entry_count,
                    discovered_bytes: statistics.total_bytes,
                    final_entry_count: Some(statistics.entry_count),
                    final_total_bytes: statistics.total_bytes,
                    latest_failure: None,
                    format: record.snapshot.format,
                }
            }
            Err(error) => ArchiveIndexSnapshotDto {
                revision: next_revision(&record.snapshot.revision),
                session_id: session_id.to_string(),
                archive_path: record.snapshot.archive_path.clone(),
                status: ArchiveIndexStatusDto::Failed,
                discovered_entries: 0,
                discovered_bytes: None,
                final_entry_count: None,
                final_total_bytes: None,
                latest_failure: Some(error),
                format: record.snapshot.format,
            },
        };
        let snapshot = Arc::new(snapshot);
        let discovered_entries = snapshot.discovered_entries;
        let status = format!("{:?}", snapshot.status).to_lowercase();
        record.snapshot = snapshot.clone();
        record.sender.send_replace(snapshot);
        drop(state);
        self.record(
            "finished",
            diagnostics::fields([
                ("discoveredEntries", serde_json::Value::from(discovered_entries)),
                ("elapsedMs", serde_json::Value::from(u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))),
                ("sessionId", serde_json::Value::String(session_id.to_string())),
                ("status", serde_json::Value::String(status)),
            ]),
        );
    }

    fn record(&self, name: &str, fields: std::collections::BTreeMap<String, serde_json::Value>) {
        if let Some(diagnostics) = &self.diagnostics {
            let _ = diagnostics.record("archiveIndex", name, fields);
        }
    }
}

fn archive_format_label(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".tar.zst") || lower.ends_with(".tzst") {
        return "tarZst".to_string();
    }
    std::path::Path::new(path).extension().and_then(|extension| extension.to_str()).unwrap_or("unknown").to_ascii_lowercase()
}

fn archive_session_sequence(session_id: &str) -> u64 {
    session_id.strip_prefix("archive-").and_then(|sequence| sequence.parse().ok()).unwrap_or(0)
}

#[cfg(test)]
struct ArchiveIndexBuild {
    index: ArchiveIndex,
    entry_count: usize,
    total_bytes: Option<u64>,
}

#[derive(Clone, Copy)]
struct ArchiveIndexStatistics {
    entry_count: usize,
    total_bytes: Option<u64>,
}

impl ArchiveIndex {
    fn new() -> Self {
        let mut children = HashMap::new();
        children.insert(String::new(), BTreeSet::new());
        Self {
            entries: HashMap::new(),
            children,
            loaded_directories: std::collections::HashSet::new(),
            entry_count: 0,
            total_bytes: 0,
            has_total: false,
            estimated_metadata_bytes: 0,
        }
    }

    fn insert(&mut self, browser_entry: BrowserEntry) -> Result<(), CommandErrorDto> {
        self.entry_count = self.entry_count.saturating_add(1);
        if self.entry_count > MAX_ARCHIVE_INDEX_ENTRIES {
            return Err(CommandErrorDto::operation_failed(format!(
                "Archive contains more than {MAX_ARCHIVE_INDEX_ENTRIES} entries, exceeding the browse limit. Extract All and Test remain available."
            )));
        }
        if let Some(size) = browser_entry.size {
            self.total_bytes = self.total_bytes.saturating_add(size);
            self.has_total = true;
        }
        let path = normalize_archive_path(&browser_entry.path);
        if path.is_empty() {
            return Ok(());
        }
        let entry_growth = path.len().saturating_add(128).saturating_add(browser_entry.metadata_diagnostics.iter().map(String::len).sum::<usize>());
        let ancestor_growth = ensure_ancestors(&path, browser_entry.kind, &mut self.entries, &mut self.children);
        self.estimated_metadata_bytes = self.estimated_metadata_bytes.saturating_add(entry_growth).saturating_add(ancestor_growth);
        if self.estimated_metadata_bytes > MAX_ARCHIVE_INDEX_METADATA_BYTES {
            return Err(CommandErrorDto::operation_failed("Archive metadata exceeds the bounded browse index limit. Extract All and Test remain available."));
        }
        self.entries.insert(path.clone(), browser_entry_to_dto(browser_entry, path));
        Ok(())
    }

    fn statistics(&self) -> ArchiveIndexStatistics {
        ArchiveIndexStatistics { entry_count: self.entry_count, total_bytes: self.has_total.then_some(self.total_bytes) }
    }
}

#[cfg(test)]
fn build_index(listing: zmanager_core::archive_browser::BrowserListing) -> Result<ArchiveIndexBuild, CommandErrorDto> {
    let mut index = ArchiveIndex::new();
    for browser_entry in listing.entries {
        index.insert(browser_entry)?;
    }
    let statistics = index.statistics();
    Ok(ArchiveIndexBuild { index, entry_count: statistics.entry_count, total_bytes: statistics.total_bytes })
}

fn ensure_ancestors(
    path: &str,
    kind: zmanager_core::archive_browser::BrowserEntryKind,
    entries: &mut HashMap<String, ArchiveEntryDto>,
    children: &mut HashMap<String, BTreeSet<String>>,
) -> usize {
    let segments = path.split('/').collect::<Vec<_>>();
    let directory_depth =
        if matches!(kind, zmanager_core::archive_browser::BrowserEntryKind::Directory) { segments.len() } else { segments.len().saturating_sub(1) };
    let mut parent = String::new();
    let mut growth = 0_usize;
    for (index, segment) in segments.iter().enumerate() {
        let current = if parent.is_empty() { (*segment).to_string() } else { format!("{parent}/{segment}") };
        let inserted_child = match children.get_mut(&parent) {
            Some(set) => {
                if !set.contains(&current) {
                    set.insert(current.clone());
                    true
                } else {
                    false
                }
            }
            None => {
                let mut set = BTreeSet::new();
                set.insert(current.clone());
                children.insert(parent.clone(), set);
                true
            }
        };
        if inserted_child {
            growth = growth.saturating_add(current.len()).saturating_add(32);
        }
        if index < directory_depth && !entries.contains_key(&current) {
            growth = growth.saturating_add(current.len()).saturating_add(128);
            entries.insert(
                current.clone(),
                ArchiveEntryDto {
                    path: current.clone(),
                    kind: ArchiveEntryKindDto::Directory,
                    size: None,
                    compressed_size: None,
                    modified: None,
                    mode: None,
                    metadata_diagnostics: Vec::new(),
                    encrypted: None,
                    method: None,
                    crc: None,
                    comment: None,
                    created: None,
                    accessed: None,
                    solid: None,
                    link_target: None,
                    attributes: None,
                    uid: None,
                    gid: None,
                    owner: None,
                    group: None,
                },
            );
        }
        parent = current;
    }
    growth
}

fn browser_entry_to_dto(entry: BrowserEntry, path: String) -> ArchiveEntryDto {
    ArchiveEntryDto {
        path,
        kind: crate::commands::map_browser_entry_kind(entry.kind),
        size: entry.size,
        compressed_size: entry.compressed_size,
        modified: entry.modified,
        mode: entry.mode,
        metadata_diagnostics: entry.metadata_diagnostics,
        encrypted: entry.encrypted,
        method: entry.method,
        crc: entry.crc.map(|c| format!("{:08X}", c)),
        comment: entry.comment,
        created: entry.created,
        accessed: entry.accessed,
        solid: entry.solid,
        link_target: entry.link_target,
        attributes: entry.attributes,
        uid: entry.uid,
        gid: entry.gid,
        owner: entry.owner,
        group: entry.group,
    }
}

fn case_insensitive_contains(haystack: &str, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    if haystack.len() < needle_lower.len() {
        return false;
    }
    if haystack.is_ascii() && needle_lower.is_ascii() {
        let needle_bytes = needle_lower.as_bytes();
        return haystack.as_bytes().windows(needle_bytes.len()).any(|window| window.iter().zip(needle_bytes).all(|(h, n)| h.to_ascii_lowercase() == *n));
    }
    haystack.to_lowercase().contains(needle_lower)
}

#[cfg(test)]
fn compare_paths(left: &str, right: &str, entries: &HashMap<String, ArchiveEntryDto>) -> Ordering {
    compare_paths_by_sort(left, right, entries, "name", true)
}

#[cfg(test)]
fn compare_paths_by_sort(left: &str, right: &str, entries: &HashMap<String, ArchiveEntryDto>, sort_key: &str, ascending: bool) -> Ordering {
    match (entries.get(left), entries.get(right)) {
        (Some(left_entry), Some(right_entry)) => compare_entries_by_sort(left_entry, right_entry, sort_key, ascending),
        _ => Ordering::Equal,
    }
}

fn compare_entries_by_sort(left_entry: &ArchiveEntryDto, right_entry: &ArchiveEntryDto, sort_key: &str, ascending: bool) -> Ordering {
    let left_directory = left_entry.kind == ArchiveEntryKindDto::Directory;
    let right_directory = right_entry.kind == ArchiveEntryKindDto::Directory;
    let value_ordering = match sort_key {
        "size" => compare_optional(&left_entry.size, &right_entry.size),
        "compressedSize" => compare_optional(&left_entry.compressed_size, &right_entry.compressed_size),
        "modified" => compare_optional_timestamps(&left_entry.modified, &right_entry.modified),
        "created" => compare_optional_timestamps(&left_entry.created, &right_entry.created),
        "accessed" => compare_optional_timestamps(&left_entry.accessed, &right_entry.accessed),
        "mode" => compare_optional(&left_entry.mode, &right_entry.mode),
        "uid" => compare_optional(&left_entry.uid, &right_entry.uid),
        "gid" => compare_optional(&left_entry.gid, &right_entry.gid),
        "kind" => archive_kind_rank(left_entry.kind).cmp(&archive_kind_rank(right_entry.kind)),
        "ratio" => compression_ratio_order(left_entry, right_entry),
        "encrypted" => compare_optional(&left_entry.encrypted, &right_entry.encrypted),
        "solid" => compare_optional(&left_entry.solid, &right_entry.solid),
        "method" => compare_optional_text(&left_entry.method, &right_entry.method),
        "crc" => compare_optional_text(&left_entry.crc, &right_entry.crc),
        "comment" => compare_optional_text(&left_entry.comment, &right_entry.comment),
        "linkTarget" => compare_optional_text(&left_entry.link_target, &right_entry.link_target),
        "attributes" => compare_optional_text(&left_entry.attributes, &right_entry.attributes),
        "owner" => compare_optional_text(&left_entry.owner, &right_entry.owner),
        "group" => compare_optional_text(&left_entry.group, &right_entry.group),
        "metadataDiagnostics" => compare_optional(
            &(!left_entry.metadata_diagnostics.is_empty()).then_some(left_entry.metadata_diagnostics.len()),
            &(!right_entry.metadata_diagnostics.is_empty()).then_some(right_entry.metadata_diagnostics.len()),
        ),
        _ => natural_cmp(archive_name(&left_entry.path), archive_name(&right_entry.path)),
    };
    let value_ordering = if ascending { value_ordering } else { value_ordering.reverse() };
    right_directory
        .cmp(&left_directory)
        .then(value_ordering)
        .then_with(|| natural_cmp(archive_name(&left_entry.path), archive_name(&right_entry.path)))
        .then_with(|| left_entry.path.as_bytes().cmp(right_entry.path.as_bytes()))
}

fn archive_kind_rank(kind: ArchiveEntryKindDto) -> u8 {
    match kind {
        ArchiveEntryKindDto::Directory => 0,
        ArchiveEntryKindDto::File => 1,
        ArchiveEntryKindDto::Symlink => 2,
        ArchiveEntryKindDto::Hardlink => 3,
        ArchiveEntryKindDto::Special => 4,
    }
}

fn compression_ratio_order(left: &ArchiveEntryDto, right: &ArchiveEntryDto) -> Ordering {
    match (left.size.zip(left.compressed_size), right.size.zip(right.compressed_size)) {
        (Some((left_size, left_packed)), Some((right_size, right_packed))) => {
            left_packed.saturating_mul(right_size).cmp(&right_packed.saturating_mul(left_size))
        }
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
    }
}

fn compare_optional<T: Ord>(left: &Option<T>, right: &Option<T>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => left.cmp(right),
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
    }
}

fn compare_optional_text(left: &Option<String>, right: &Option<String>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => natural_cmp(left, right),
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
    }
}

fn compare_optional_timestamps(left: &Option<String>, right: &Option<String>) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => compare_timestamp_text(left, right),
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
    }
}

fn compare_timestamp_text(left: &str, right: &str) -> Ordering {
    match (parse_epoch_timestamp(left), parse_epoch_timestamp(right)) {
        (Some(left), Some(right)) => left.cmp(&right),
        _ => left.cmp(right),
    }
}

fn parse_epoch_timestamp(value: &str) -> Option<i128> {
    let (seconds, fraction) = value.split_once('.').unwrap_or((value, ""));
    let negative = seconds.starts_with('-');
    let seconds = seconds.parse::<i128>().ok()?;
    if fraction.len() > 9 || !fraction.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let mut nanoseconds = fraction.parse::<i128>().ok().unwrap_or_default();
    for _ in fraction.len()..9 {
        nanoseconds = nanoseconds.checked_mul(10)?;
    }
    seconds.checked_mul(1_000_000_000)?.checked_add(if negative { -nanoseconds } else { nanoseconds })
}

fn natural_cmp(left: &str, right: &str) -> Ordering {
    if left.is_ascii() && right.is_ascii() {
        return natural_cmp_ascii(left.as_bytes(), right.as_bytes());
    }
    let mut left_chars = left.chars().flat_map(char::to_lowercase).peekable();
    let mut right_chars = right.chars().flat_map(char::to_lowercase).peekable();
    loop {
        match (left_chars.peek(), right_chars.peek()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(a), Some(b)) if a.is_ascii_digit() && b.is_ascii_digit() => {
                let mut left_zeros = 0usize;
                while left_chars.peek() == Some(&'0') {
                    left_zeros += 1;
                    left_chars.next();
                }
                let mut right_zeros = 0usize;
                while right_chars.peek() == Some(&'0') {
                    right_zeros += 1;
                    right_chars.next();
                }

                let mut first_diff = Ordering::Equal;
                let mut left_len = 0usize;
                let mut right_len = 0usize;

                while let (Some(&c1), Some(&c2)) = (left_chars.peek(), right_chars.peek()) {
                    if !c1.is_ascii_digit() || !c2.is_ascii_digit() {
                        break;
                    }
                    if first_diff == Ordering::Equal && c1 != c2 {
                        first_diff = c1.cmp(&c2);
                    }
                    left_len += 1;
                    right_len += 1;
                    left_chars.next();
                    right_chars.next();
                }
                while left_chars.peek().is_some_and(|c| c.is_ascii_digit()) {
                    left_len += 1;
                    left_chars.next();
                }
                while right_chars.peek().is_some_and(|c| c.is_ascii_digit()) {
                    right_len += 1;
                    right_chars.next();
                }

                let ordering = left_len.cmp(&right_len).then(first_diff).then_with(|| (left_len + left_zeros).cmp(&(right_len + right_zeros)));
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            _ => {
                let ordering = left_chars.next().cmp(&right_chars.next());
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
        }
    }
}

fn natural_cmp_ascii(left: &[u8], right: &[u8]) -> Ordering {
    let mut i = 0;
    let mut j = 0;
    while i < left.len() && j < right.len() {
        let b1 = left[i];
        let b2 = right[j];
        if b1.is_ascii_digit() && b2.is_ascii_digit() {
            let mut left_zeros = 0usize;
            while i < left.len() && left[i] == b'0' {
                left_zeros += 1;
                i += 1;
            }
            let mut right_zeros = 0usize;
            while j < right.len() && right[j] == b'0' {
                right_zeros += 1;
                j += 1;
            }
            let mut first_diff = Ordering::Equal;
            let mut left_len = 0usize;
            let mut right_len = 0usize;
            while i < left.len() && j < right.len() && left[i].is_ascii_digit() && right[j].is_ascii_digit() {
                if first_diff == Ordering::Equal && left[i] != right[j] {
                    first_diff = left[i].cmp(&right[j]);
                }
                left_len += 1;
                right_len += 1;
                i += 1;
                j += 1;
            }
            while i < left.len() && left[i].is_ascii_digit() {
                left_len += 1;
                i += 1;
            }
            while j < right.len() && right[j].is_ascii_digit() {
                right_len += 1;
                j += 1;
            }
            let ordering = left_len.cmp(&right_len).then(first_diff).then_with(|| (left_len + left_zeros).cmp(&(right_len + right_zeros)));
            if ordering != Ordering::Equal {
                return ordering;
            }
        } else {
            let ordering = b1.to_ascii_lowercase().cmp(&b2.to_ascii_lowercase());
            if ordering != Ordering::Equal {
                return ordering;
            }
            i += 1;
            j += 1;
        }
    }
    left.len().cmp(&right.len())
}

fn archive_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn normalize_archive_path(path: &str) -> String {
    path.replace('\\', "/").split('/').filter(|segment| !segment.is_empty() && *segment != ".").collect::<Vec<_>>().join("/")
}

fn cursor_signature(session_id: &str, parent: &str, revision: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    session_id.hash(&mut hasher);
    parent.hash(&mut hasher);
    revision.hash(&mut hasher);
    hasher.finish()
}

fn encode_cursor(session_id: &str, parent: &str, revision: &str, offset: usize) -> String {
    format!("v1:{:016x}:{offset}", cursor_signature(session_id, parent, revision))
}

fn decode_cursor(cursor: Option<&str>, session_id: &str, parent: &str, revision: &str) -> Result<usize, CommandErrorDto> {
    let Some(cursor) = cursor else {
        return Ok(0);
    };
    let mut parts = cursor.split(':');
    let valid = parts.next() == Some("v1")
        && parts.next() == Some(format!("{:016x}", cursor_signature(session_id, parent, revision)).as_str())
        && parts.clone().count() == 1;
    let offset = parts.next().and_then(|value| value.parse::<usize>().ok());
    if !valid || offset.is_none() {
        return Err(CommandErrorDto::invalid_request("Archive page cursor is invalid or stale."));
    }
    Ok(offset.expect("validated cursor offset"))
}

fn archive_session_not_found(session_id: &str) -> CommandErrorDto {
    CommandErrorDto::not_found(format!("Archive session {session_id} was not found."), Some("Open the archive again.".to_string()))
}

fn next_revision(revision: &str) -> String {
    revision.parse::<u64>().unwrap_or_default().saturating_add(1).to_string()
}

impl Default for ArchiveIndexRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Instant;
    use zmanager_core::archive_browser::{BrowserEntryKind, BrowserListing};

    fn entry(path: impl Into<String>, kind: BrowserEntryKind) -> BrowserEntry {
        BrowserEntry {
            path: path.into(),
            kind,
            size: Some(1),
            compressed_size: None,
            modified: None,
            mode: None,
            metadata_diagnostics: Vec::new(),
            encrypted: None,
            method: None,
            crc: None,
            comment: None,
            created: None,
            accessed: None,
            solid: None,
            link_target: None,
            attributes: None,
            uid: None,
            gid: None,
            owner: None,
            group: None,
        }
    }

    fn dto_entry(path: &str) -> ArchiveEntryDto {
        ArchiveEntryDto {
            path: path.to_string(),
            kind: ArchiveEntryKindDto::File,
            size: None,
            compressed_size: None,
            modified: None,
            mode: None,
            metadata_diagnostics: Vec::new(),
            encrypted: None,
            method: None,
            crc: None,
            comment: None,
            created: None,
            accessed: None,
            solid: None,
            link_target: None,
            attributes: None,
            uid: None,
            gid: None,
            owner: None,
            group: None,
        }
    }

    #[test]
    fn every_extract_column_has_backend_sort_semantics() {
        macro_rules! assert_field_sort {
            ($key:literal, $field:ident, $low:expr, $high:expr) => {{
                let mut low = dto_entry("z-low");
                let mut high = dto_entry("a-high");
                low.$field = $low;
                high.$field = $high;
                let entries = HashMap::from([(low.path.clone(), low), (high.path.clone(), high)]);
                assert_eq!(
                    compare_paths_by_sort("z-low", "a-high", &entries, $key, true),
                    Ordering::Less,
                    "{} must sort by its value instead of falling back to name",
                    $key,
                );
            }};
        }

        assert_field_sort!("size", size, Some(1), Some(2));
        assert_field_sort!("compressedSize", compressed_size, Some(1), Some(2));
        assert_field_sort!("modified", modified, Some("9".into()), Some("10".into()));
        assert_field_sort!("created", created, Some("-1.5".into()), Some("-0.5".into()));
        assert_field_sort!("accessed", accessed, Some("9".into()), Some("10".into()));
        assert_field_sort!("mode", mode, Some(0o600), Some(0o700));
        assert_field_sort!("kind", kind, ArchiveEntryKindDto::File, ArchiveEntryKindDto::Symlink);
        assert_field_sort!("uid", uid, Some(1), Some(2));
        assert_field_sort!("gid", gid, Some(1), Some(2));
        assert_field_sort!("encrypted", encrypted, Some(false), Some(true));
        assert_field_sort!("solid", solid, Some(false), Some(true));
        assert_field_sort!("method", method, Some("Deflate2".into()), Some("Deflate10".into()));
        assert_field_sort!("crc", crc, Some("00000001".into()), Some("00000002".into()));
        assert_field_sort!("comment", comment, Some("Alpha2".into()), Some("Alpha10".into()));
        assert_field_sort!("linkTarget", link_target, Some("target2".into()), Some("target10".into()));
        assert_field_sort!("attributes", attributes, Some("0x1".into()), Some("0x2".into()));
        assert_field_sort!("owner", owner, Some("owner2".into()), Some("owner10".into()));
        assert_field_sort!("group", group, Some("group2".into()), Some("group10".into()));

        let mut low = dto_entry("z-low");
        let mut high = dto_entry("a-high");
        low.metadata_diagnostics = vec!["one".into()];
        high.metadata_diagnostics = vec!["one".into(), "two".into()];
        let entries = HashMap::from([(low.path.clone(), low), (high.path.clone(), high)]);
        assert_eq!(compare_paths_by_sort("z-low", "a-high", &entries, "metadataDiagnostics", true,), Ordering::Less,);

        let mut low = dto_entry("z-low");
        let mut high = dto_entry("a-high");
        low.size = Some(100);
        low.compressed_size = Some(10);
        high.size = Some(100);
        high.compressed_size = Some(20);
        let entries = HashMap::from([(low.path.clone(), low), (high.path.clone(), high)]);
        assert_eq!(compare_paths_by_sort("z-low", "a-high", &entries, "ratio", true), Ordering::Less,);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn real_tzap_listing_populates_desktop_dto_metadata() {
        use std::fs;
        use std::os::unix::fs::{MetadataExt as _, PermissionsExt as _};
        use std::time::{SystemTime, UNIX_EPOCH};
        use zmanager_core::backend_test_support::tzap::{TzapCreateOptions, TzapKeySource, create_tzap_from_manifest_with_context};
        use zmanager_core::jobs::{CancellationToken, JobContext};
        use zmanager_core::manifest::{ArchiveManifest, ManifestEntry, ManifestFileType, PermissionSnapshot};

        let root = std::env::temp_dir().join(format!(
            "zmanager-desktop-real-tzap-dto-{}-{}",
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("metadata.txt");
        let archive = root.join("metadata.tzap");
        fs::write(&source, b"desktop metadata").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o640)).unwrap();
        assert!(std::process::Command::new("/usr/bin/chflags").arg("hidden").arg(&source).status().unwrap().success());
        let source_metadata = fs::symlink_metadata(&source).unwrap();
        let manifest = ArchiveManifest {
            root: root.clone(),
            entries: vec![ManifestEntry {
                archive_path: "metadata.txt".into(),
                source_path: source,
                file_type: ManifestFileType::File,
                size: b"desktop metadata".len() as u64,
                modified: source_metadata.modified().ok(),
                permissions: PermissionSnapshot { readonly: false, unix_mode: Some(source_metadata.permissions().mode() & 0o7777) },
                symlink_target: None,
            }],
            total_bytes: b"desktop metadata".len() as u64,
            excluded_entries: Vec::new(),
            excluded_bytes: 0,
            warnings: Vec::new(),
        };
        let token = CancellationToken::new();
        let mut events = |_| {};
        let mut context = JobContext::new(&token, &mut events);
        create_tzap_from_manifest_with_context(
            &manifest,
            &archive,
            &TzapCreateOptions {
                level: 1,
                volume_size: None,
                volume_count: None,
                recovery_percentage: 0,
                volume_loss_tolerance: 0,
                preserve_metadata: true,
                replace_existing: true,
                key_source: TzapKeySource::NoPassword,
                x509_signing: None,
                emit_bootstrap_sidecar: false,
            },
            &mut context,
        )
        .unwrap();

        let build = build_index(zmanager_core::archive_browser::list_entries(&archive).unwrap()).unwrap();
        let dto = build.index.entries.get("metadata.txt").unwrap();
        assert_eq!(dto.kind, ArchiveEntryKindDto::File);
        assert_eq!(dto.size, Some(b"desktop metadata".len() as u64));
        assert_eq!(dto.mode, Some(0o640));
        assert!(dto.modified.is_some());
        assert!(dto.created.is_some());
        assert!(dto.accessed.is_some());
        assert_eq!(dto.encrypted, Some(false));
        assert_eq!(dto.method.as_deref(), Some("Zstd"));
        assert_eq!(dto.solid, Some(true));
        assert_eq!(dto.uid, Some(source_metadata.uid()));
        assert_eq!(dto.gid, Some(source_metadata.gid()));
        assert!(dto.owner.is_some());
        assert!(dto.group.is_some());
        // With the migration to fast index listing (tzap-core directory hints),
        // full tar metadata like TZAP.macos.st-flags are no longer extracted during browsing.
        // The portable attributes field models Windows semantics and is intentionally absent on macOS.
        assert_eq!(dto.attributes, None);
        // The fast index now provides the compressed size.
        assert!(dto.compressed_size.is_some());
        assert_eq!(dto.crc, None);
        assert_eq!(dto.comment, None);
        assert_eq!(dto.link_target, None);
        assert!(dto.metadata_diagnostics.is_empty());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn index_synthesizes_missing_folders_and_orders_names_naturally() {
        let build = build_index(BrowserListing {
            entries: vec![
                entry("folder/file10.txt", BrowserEntryKind::File),
                entry("folder/file2.txt", BrowserEntryKind::File),
                entry("root.txt", BrowserEntryKind::File),
            ],
        })
        .expect("index should build");

        assert_eq!(build.entry_count, 3);
        let mut root = build.index.children[""].iter().cloned().collect::<Vec<_>>();
        root.sort_by(|left, right| compare_paths(left, right, &build.index.entries));
        let mut folder = build.index.children["folder"].iter().cloned().collect::<Vec<_>>();
        folder.sort_by(|left, right| compare_paths(left, right, &build.index.entries));
        assert_eq!(root, vec!["folder", "root.txt"]);
        assert_eq!(folder, vec!["folder/file2.txt", "folder/file10.txt"]);
        assert_eq!(build.index.entries["folder"].kind, ArchiveEntryKindDto::Directory);
    }

    #[test]
    fn ready_index_resolves_file_and_folder_drag_entries_without_relisting_archive() {
        let stale_build = build_index(BrowserListing { entries: vec![entry("stale.txt", BrowserEntryKind::File)] }).expect("stale index should build");
        let build = build_index(BrowserListing {
            entries: vec![
                entry("docs/a.txt", BrowserEntryKind::File),
                entry("docs/nested/b.txt", BrowserEntryKind::File),
                entry("other.txt", BrowserEntryKind::File),
            ],
        })
        .expect("index should build");
        let registry = ArchiveIndexRegistry::new();
        let stale_snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision: "2".to_string(),
            session_id: "archive-1".to_string(),
            archive_path: "C:/archives/demo.tzap".to_string(),
            status: ArchiveIndexStatusDto::Ready,
            discovered_entries: stale_build.entry_count,
            discovered_bytes: stale_build.total_bytes,
            final_entry_count: Some(stale_build.entry_count),
            final_total_bytes: stale_build.total_bytes,
            latest_failure: None,
            format: Some(crate::dto::ArchiveFormatKindDto::Tzap),
        });
        let (stale_sender, _) = watch::channel(stale_snapshot.clone());
        let snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision: "2".to_string(),
            session_id: "archive-2".to_string(),
            archive_path: "C:/archives/demo.tzap".to_string(),
            status: ArchiveIndexStatusDto::Ready,
            discovered_entries: build.entry_count,
            discovered_bytes: build.total_bytes,
            final_entry_count: Some(build.entry_count),
            final_total_bytes: build.total_bytes,
            latest_failure: None,
            format: Some(crate::dto::ArchiveFormatKindDto::Tzap),
        });
        let (sender, _) = watch::channel(snapshot.clone());
        registry.state.lock().expect("registry lock").sessions.insert(
            "archive-1".to_string(),
            SessionRecord {
                password: None,
                snapshot: stale_snapshot,
                sender: stale_sender,
                index: Arc::new(Mutex::new(stale_build.index)),
                cancelled: Arc::new(AtomicBool::new(false)),
            },
        );
        registry.state.lock().expect("registry lock").sessions.insert(
            "archive-2".to_string(),
            SessionRecord { password: None, snapshot, sender, index: Arc::new(Mutex::new(build.index)), cancelled: Arc::new(AtomicBool::new(false)) },
        );

        let files = registry
            .drag_entries("C:/archives/demo.tzap", &["docs".to_string(), "other.txt".to_string()])
            .expect("cached drag selection")
            .expect("ready session should answer");
        assert_eq!(files.iter().map(|entry| entry.path.as_str()).collect::<Vec<_>>(), ["docs/a.txt", "docs/nested/b.txt", "other.txt"]);
    }

    #[test]
    fn password_for_archive_uses_the_newest_live_session() {
        let registry = ArchiveIndexRegistry::new();
        let stale_snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision: "2".to_string(),
            session_id: "archive-1".to_string(),
            archive_path: "C:/archives/passworded.rar".to_string(),
            status: ArchiveIndexStatusDto::Failed,
            discovered_entries: 0,
            discovered_bytes: None,
            final_entry_count: None,
            final_total_bytes: None,
            latest_failure: Some(CommandErrorDto::operation_failed("listing failed")),
            format: Some(crate::dto::ArchiveFormatKindDto::Rar),
        });
        let (stale_sender, _) = watch::channel(stale_snapshot.clone());
        registry.state.lock().expect("registry lock").sessions.insert(
            "archive-1".to_string(),
            SessionRecord {
                password: Some("stale-password".to_string()),
                snapshot: stale_snapshot,
                sender: stale_sender,
                index: Arc::new(Mutex::new(ArchiveIndex::new())),
                cancelled: Arc::new(AtomicBool::new(false)),
            },
        );

        let live_snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision: "2".to_string(),
            session_id: "archive-2".to_string(),
            archive_path: "C:/archives/passworded.rar".to_string(),
            status: ArchiveIndexStatusDto::Ready,
            discovered_entries: 1,
            discovered_bytes: Some(1),
            final_entry_count: Some(1),
            final_total_bytes: Some(1),
            latest_failure: None,
            format: Some(crate::dto::ArchiveFormatKindDto::Rar),
        });
        let (live_sender, _) = watch::channel(live_snapshot.clone());
        registry.state.lock().expect("registry lock").sessions.insert(
            "archive-2".to_string(),
            SessionRecord {
                password: Some("live-password".to_string()),
                snapshot: live_snapshot,
                sender: live_sender,
                index: Arc::new(Mutex::new(ArchiveIndex::new())),
                cancelled: Arc::new(AtomicBool::new(false)),
            },
        );

        assert_eq!(registry.password_for_archive(" C:/archives/passworded.rar ").as_deref(), Some("live-password"));
        assert_eq!(registry.password_for_archive("C:/archives/other.rar"), None);
    }

    #[tokio::test]
    async fn pages_are_bounded_and_cursors_are_scoped_to_the_parent_and_revision() {
        let listing = BrowserListing { entries: (0..600).map(|index| entry(format!("file{index}.txt"), BrowserEntryKind::File)).collect() };
        let build = build_index(listing).expect("index should build");
        let registry = ArchiveIndexRegistry::new();
        let session_id = "archive-test".to_string();
        let snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision: "2".to_string(),
            session_id: session_id.clone(),
            archive_path: "test.zip".to_string(),
            status: ArchiveIndexStatusDto::Ready,
            discovered_entries: build.entry_count,
            discovered_bytes: build.total_bytes,
            final_entry_count: Some(build.entry_count),
            final_total_bytes: build.total_bytes,
            latest_failure: None,
            format: Some(crate::dto::ArchiveFormatKindDto::Zip),
        });
        let (sender, _) = watch::channel(snapshot.clone());
        registry.state.lock().expect("registry lock").sessions.insert(
            session_id.clone(),
            SessionRecord { password: None, snapshot, sender, index: Arc::new(Mutex::new(build.index)), cancelled: Arc::new(AtomicBool::new(false)) },
        );

        let first = registry
            .children(ArchiveChildrenRequest {
                session_id: session_id.clone(),
                parent_path: String::new(),
                cursor: None,
                limit: Some(10_000),
                sort_key: None,
                sort_ascending: None,
            })
            .await
            .expect("first page");
        assert_eq!(first.entries.len(), MAX_ARCHIVE_PAGE_SIZE);
        assert!(!first.complete);

        let stale = registry
            .children(ArchiveChildrenRequest {
                session_id,
                parent_path: "different".to_string(),
                cursor: first.next_cursor,
                limit: Some(1),
                sort_key: None,
                sort_ascending: None,
            })
            .await;
        assert_eq!(stale.expect_err("cursor must be parent-scoped").code, "invalid_request");

        // Cursors carry their own revision signature so stale-revision
        // mismatches are tolerated without an explicit expected_revision field.
        let older_revision = registry
            .children(ArchiveChildrenRequest {
                session_id: "archive-test".to_string(),
                parent_path: String::new(),
                cursor: None,
                limit: Some(1),
                sort_key: None,
                sort_ascending: None,
            })
            .await;
        assert!(older_revision.is_ok(), "mismatched revision should be tolerated");

        registry.close("archive-test").expect("session should close");
        let after_close = registry
            .children(ArchiveChildrenRequest {
                session_id: "archive-test".to_string(),
                parent_path: String::new(),
                cursor: None,
                limit: Some(1),
                sort_key: None,
                sort_ascending: None,
            })
            .await;
        assert_eq!(after_close.expect_err("closed session is gone").code, "not_found");
    }

    #[test]
    fn retained_progress_uses_latest_value_without_a_notification_queue() {
        let registry = ArchiveIndexRegistry::new();
        let session_id = "archive-watch".to_string();
        let snapshot = Arc::new(ArchiveIndexSnapshotDto {
            revision: "1".to_string(),
            session_id: session_id.clone(),
            archive_path: "test.zip".to_string(),
            status: ArchiveIndexStatusDto::Indexing,
            discovered_entries: 0,
            discovered_bytes: None,
            final_entry_count: None,
            final_total_bytes: None,
            latest_failure: None,
            format: Some(crate::dto::ArchiveFormatKindDto::Zip),
        });
        let (sender, receiver) = watch::channel(snapshot.clone());
        registry.state.lock().expect("registry lock").sessions.insert(
            session_id.clone(),
            SessionRecord { password: None, snapshot, sender, index: Arc::new(Mutex::new(ArchiveIndex::new())), cancelled: Arc::new(AtomicBool::new(false)) },
        );

        for count in 1..=10 {
            registry.publish_progress(&session_id, ArchiveIndexStatistics { entry_count: count, total_bytes: Some(count as u64) });
        }

        let latest = receiver.borrow().clone();
        assert_eq!(latest.revision, "11");
        assert_eq!(latest.discovered_entries, 10);
    }

    #[test]
    fn entry_and_metadata_admission_limits_fail_closed() {
        let mut entry_limited = ArchiveIndex::new();
        entry_limited.entry_count = MAX_ARCHIVE_INDEX_ENTRIES;
        let entry_error = entry_limited.insert(entry("overflow.txt", BrowserEntryKind::File)).expect_err("entry limit should reject the next entry");
        assert_eq!(entry_error.code, "operation_failed");

        let mut metadata_limited = ArchiveIndex::new();
        metadata_limited.estimated_metadata_bytes = MAX_ARCHIVE_INDEX_METADATA_BYTES - 1;
        let metadata_error = metadata_limited.insert(entry("metadata.txt", BrowserEntryKind::File)).expect_err("metadata limit should reject the next entry");
        assert_eq!(metadata_error.code, "operation_failed");
    }

    #[tokio::test]
    async fn unicode_archive_path_indexes_archive_without_panicking() {
        let source = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../zmanager/fixtures/archives/basic.zip");
        assert!(source.is_file(), "archive fixture should exist: {}", source.display());
        let archive = std::env::temp_dir().join(format!("zmanager-desktop-游戏存档管理器-{}.zip", std::process::id()));
        let _ = std::fs::remove_file(&archive);
        std::fs::copy(&source, &archive).expect("Unicode archive fixture should be copied");

        let registry = ArchiveIndexRegistry::new();
        let started = registry
            .start(StartArchiveIndexRequest { archive_path: archive.to_string_lossy().into_owned(), password: None })
            .expect("index request should be accepted");
        let terminal = tokio::time::timeout(Duration::from_secs(3), async {
            let mut revision = started.snapshot.revision;
            loop {
                let snapshot = registry.wait_for_change(&started.session_id, Some(&revision)).await.expect("index state should remain available");
                revision = snapshot.revision.clone();
                if snapshot.status != ArchiveIndexStatusDto::Indexing {
                    break snapshot;
                }
            }
        })
        .await
        .expect("index worker should publish a terminal state");
        assert_eq!(terminal.status, ArchiveIndexStatusDto::Ready);
        assert!(terminal.final_entry_count.is_some_and(|count| count > 0));
        registry.close(&started.session_id).expect("index session should close");
        std::fs::remove_file(archive).expect("Unicode archive fixture should be cleaned up");
    }

    #[test]
    #[ignore = "performance characterization harness; run explicitly on release hardware"]
    fn characterize_one_hundred_thousand_entry_index() {
        let listing = BrowserListing {
            entries: (0..100_000)
                .map(|index| {
                    let path = if index < 50_000 { format!("wide/file{index}.txt") } else { format!("deep/{}/{}/file{index}.txt", index % 100, index % 1_000) };
                    entry(path, BrowserEntryKind::File)
                })
                .collect(),
        };
        let started = Instant::now();
        let build = build_index(listing).expect("large index should remain within limits");
        let elapsed = started.elapsed();

        assert_eq!(build.entry_count, 100_000);
        assert!(build.index.children["wide"].len() >= 50_000);
        eprintln!(
            "archive-index-baseline entries={} elapsed_ms={} metadata_limit_bytes={} page_limit={}",
            build.entry_count,
            elapsed.as_millis(),
            MAX_ARCHIVE_INDEX_METADATA_BYTES,
            MAX_ARCHIVE_PAGE_SIZE,
        );
    }
}
