#![allow(dead_code)]

use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use super::{NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem, NativeFileDragStreamProvider};

pub(super) struct PosixDragPathPolicy {
    pub platform_label: &'static str,
    pub collision_case_sensitive: bool,
    pub max_component_bytes: Option<usize>,
}

pub(super) fn prepare_posix_drag_items(
    candidates: &[NativeFileDragCandidate],
    strip_components: usize,
    policy: PosixDragPathPolicy,
) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
    let mut display_path_keys = HashSet::new();
    let mut items = Vec::with_capacity(candidates.len());

    for candidate in candidates {
        let components = candidate.entry_path.split(['/', '\\']).filter(|component| !component.is_empty()).skip(strip_components).collect::<Vec<_>>();
        if components.is_empty() {
            return Err(NativeFileDragError::invalid_request(format!("entry path is empty after stripping components: {}", candidate.entry_path)));
        }

        for component in &components {
            validate_posix_drag_component(component, &candidate.entry_path, &policy)?;
        }

        let display_path = components.join("/");
        let collision_key = if policy.collision_case_sensitive { display_path.clone() } else { display_path.to_lowercase() };
        if !display_path_keys.insert(collision_key) {
            return Err(NativeFileDragError::invalid_request(format!("more than one selected entry would drag out as {display_path}")));
        }

        items.push(NativeFileDragItem {
            entry_path: candidate.entry_path.clone(),
            display_path,
            size: candidate.size,
            modified_unix_seconds: candidate.modified_unix_seconds,
        });
    }

    Ok(items)
}

fn validate_posix_drag_component(component: &str, entry_path: &str, policy: &PosixDragPathPolicy) -> Result<(), NativeFileDragError> {
    if component == "." || component == ".." || component.contains('\0') {
        return Err(NativeFileDragError::unsafe_archive(format!("entry path contains an unsafe {} drag-out component: {entry_path}", policy.platform_label)));
    }
    if policy.max_component_bytes.is_some_and(|maximum| component.len() > maximum) {
        return Err(NativeFileDragError::invalid_request(format!(
            "entry path contains a file name that is too long for {} drag-out: {entry_path}",
            policy.platform_label
        )));
    }

    Ok(())
}

pub(super) struct StagedFileDrag {
    root: Option<PathBuf>,
    drag_paths: Vec<PathBuf>,
}

impl StagedFileDrag {
    pub(super) fn create(
        platform_label: &str,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
    ) -> Result<Self, NativeFileDragError> {
        let mut staged = Self::prepare(platform_label, items)?;
        staged.stage_items(items, stream_provider)?;
        Ok(staged)
    }

    pub(super) fn prepare(platform_label: &str, items: &[NativeFileDragItem]) -> Result<Self, NativeFileDragError> {
        Self::prepare_at_root(unique_drag_root(), platform_label, items)
    }

    fn create_at_root(
        root: PathBuf,
        platform_label: &str,
        items: &[NativeFileDragItem],
        stream_provider: NativeFileDragStreamProvider,
    ) -> Result<Self, NativeFileDragError> {
        let mut staged = Self::prepare_at_root(root, platform_label, items)?;
        staged.stage_items(items, stream_provider)?;
        Ok(staged)
    }

    fn prepare_at_root(root: PathBuf, platform_label: &str, items: &[NativeFileDragItem]) -> Result<Self, NativeFileDragError> {
        fs::create_dir_all(&root).map_err(|error| {
            NativeFileDragError::new(
                format!("Unable to prepare {platform_label} drag-out folder: {error}"),
                Some("Try extracting normally while the drag-out folder is checked."),
            )
        })?;

        let mut staged = Self { root: Some(root), drag_paths: Vec::new() };
        let mut drag_path_keys = HashSet::new();
        for item in items {
            let relative_path = staged_relative_path(&item.display_path)?;
            let root = staged.root.as_ref().expect("staged drag root missing");
            let output_path = root.join(relative_path);
            record_drag_path(root, &output_path, &mut drag_path_keys, &mut staged.drag_paths)?;
        }

        Ok(staged)
    }

    pub(super) fn stage_items(&mut self, items: &[NativeFileDragItem], stream_provider: NativeFileDragStreamProvider) -> Result<(), NativeFileDragError> {
        let root = self.root.as_ref().expect("staged drag root missing");
        for item in items {
            let relative_path = staged_relative_path(&item.display_path)?;
            let output_path = root.join(relative_path);
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    NativeFileDragError::new(
                        format!("Unable to create drag-out folder: {error}"),
                        Some("Try extracting normally while the drag-out folder is checked."),
                    )
                })?;
            }

            let mut output = fs::File::create(&output_path).map_err(|error| {
                NativeFileDragError::new(
                    format!("Unable to stage drag-out file: {error}"),
                    Some("Try extracting normally while the temporary folder is checked."),
                )
            })?;
            stream_provider(&item.entry_path, &mut output)?;
        }
        Ok(())
    }

    #[cfg(test)]
    pub(super) fn root(&self) -> Option<&Path> {
        self.root.as_deref()
    }

    pub(super) fn drag_paths(&self) -> &[PathBuf] {
        &self.drag_paths
    }

    pub(super) fn root_path(&self) -> &Path {
        self.root.as_deref().expect("staged drag root missing")
    }

    pub(super) fn keep_for_file_manager_copy(mut self) {
        let Some(root) = self.root.take() else {
            return;
        };

        let mut roots = RETAINED_DRAG_ROOTS.lock().unwrap_or_else(|e| e.into_inner());
        while roots.len() > 1 {
            if let Some(old_root) = roots.pop() {
                let _ = fs::remove_dir_all(old_root);
            }
        }
        roots.push(root);
    }
}

static RETAINED_DRAG_ROOTS: std::sync::Mutex<Vec<PathBuf>> = std::sync::Mutex::new(Vec::new());

pub(super) fn cleanup_retained_drag_roots() {
    let mut roots = RETAINED_DRAG_ROOTS.lock().unwrap_or_else(|e| e.into_inner());
    for root in roots.drain(..) {
        let _ = fs::remove_dir_all(root);
    }
}

impl Drop for StagedFileDrag {
    fn drop(&mut self) {
        if let Some(root) = self.root.take() {
            let _ = fs::remove_dir_all(root);
        }
    }
}

fn unique_drag_root() -> PathBuf {
    let nonce = SystemTime::now().duration_since(UNIX_EPOCH).map(|duration| duration.as_nanos()).unwrap_or_default();
    std::env::temp_dir().join(format!("zmanager-drag-out-{}-{nonce}", std::process::id()))
}

fn staged_relative_path(display_path: &str) -> Result<PathBuf, NativeFileDragError> {
    let components = display_path.split(['/', '\\']).filter(|component| !component.is_empty()).collect::<Vec<_>>();
    if components.is_empty() {
        return Err(NativeFileDragError::invalid_request("Archive entry has no file name for drag-out."));
    }

    let mut relative_path = PathBuf::new();
    for component in components {
        if component == "." || component == ".." || component.contains('\0') {
            return Err(NativeFileDragError::unsafe_archive(format!("Archive entry has an unsafe drag-out path: {display_path}")));
        }
        relative_path.push(component);
    }
    Ok(relative_path)
}

fn record_drag_path(root: &Path, output_path: &Path, drag_path_keys: &mut HashSet<PathBuf>, drag_paths: &mut Vec<PathBuf>) -> Result<(), NativeFileDragError> {
    let relative_path = output_path.strip_prefix(root).map_err(|error| {
        NativeFileDragError::new(
            format!("Unable to prepare native drag-out path: {error}"),
            Some("Try extracting normally while native drag-out is being checked."),
        )
    })?;
    let Some(top_component) = relative_path.components().next() else {
        return Err(NativeFileDragError::invalid_request("Archive entry has no file name for drag-out."));
    };
    let drag_path = root.join(top_component.as_os_str());
    if drag_path_keys.insert(drag_path.clone()) {
        drag_paths.push(drag_path);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, fs, sync::Arc};

    use super::*;

    #[test]
    fn staged_drag_writes_nested_files_and_cleans_up() {
        let payloads = Arc::new(HashMap::from([("docs/readme.txt".to_string(), b"drag payload".to_vec()), ("root.txt".to_string(), b"root payload".to_vec())]));
        let provider_payloads = Arc::clone(&payloads);
        let provider: NativeFileDragStreamProvider = Arc::new(move |entry_path, writer| {
            let bytes =
                provider_payloads.get(entry_path).ok_or_else(|| NativeFileDragError::new(format!("missing test payload for {entry_path}"), None::<String>))?;
            writer.write_all(bytes).map_err(|error| NativeFileDragError::new(format!("unable to write test payload: {error}"), None::<String>))?;
            Ok(bytes.len() as u64)
        });

        let staged = StagedFileDrag::create(
            "test",
            &[
                NativeFileDragItem {
                    entry_path: "docs/readme.txt".to_string(),
                    display_path: "docs/readme.txt".to_string(),
                    size: Some(12),
                    modified_unix_seconds: None,
                },
                NativeFileDragItem { entry_path: "root.txt".to_string(), display_path: "root.txt".to_string(), size: Some(12), modified_unix_seconds: None },
            ],
            provider,
        )
        .expect("stage drag files");
        let root = staged.root().expect("test staged root").to_path_buf();

        assert_eq!(fs::read(root.join("docs/readme.txt")).unwrap(), b"drag payload");
        assert_eq!(fs::read(root.join("root.txt")).unwrap(), b"root payload");
        assert_eq!(staged.drag_paths(), [root.join("docs"), root.join("root.txt")]);

        drop(staged);
        assert!(!root.exists(), "staged drag root should be cleaned up");
    }

    #[test]
    fn staged_drag_cleans_up_when_streaming_fails() {
        let root = unique_drag_root();
        let provider: NativeFileDragStreamProvider = Arc::new(|_, _| Err(NativeFileDragError::new("intentional stream failure", None::<String>)));

        let result = StagedFileDrag::create_at_root(
            root.clone(),
            "test",
            &[NativeFileDragItem {
                entry_path: "failure.txt".to_string(),
                display_path: "failure.txt".to_string(),
                size: Some(1),
                modified_unix_seconds: None,
            }],
            provider,
        );

        assert!(result.is_err());
        assert!(!root.exists(), "failed staging leaked its temporary drag root: {root:?}");
    }

    #[test]
    fn staged_drag_retains_for_file_manager_copy_and_cleans_up() {
        let payloads = Arc::new(HashMap::from([("root.txt".to_string(), b"root payload".to_vec())]));
        let provider_payloads = Arc::clone(&payloads);
        let provider: NativeFileDragStreamProvider = Arc::new(move |entry_path, writer| {
            let bytes =
                provider_payloads.get(entry_path).ok_or_else(|| NativeFileDragError::new(format!("missing test payload for {entry_path}"), None::<String>))?;
            writer.write_all(bytes).map_err(|error| NativeFileDragError::new(format!("unable to write test payload: {error}"), None::<String>))?;
            Ok(bytes.len() as u64)
        });

        let staged1 = StagedFileDrag::create(
            "test",
            &[NativeFileDragItem { entry_path: "root.txt".to_string(), display_path: "root.txt".to_string(), size: Some(12), modified_unix_seconds: None }],
            Arc::clone(&provider),
        )
        .expect("stage drag files");
        let root1 = staged1.root().expect("root1").to_path_buf();
        assert!(root1.exists());
        staged1.keep_for_file_manager_copy();
        assert!(root1.exists(), "root1 should still exist after keep_for_file_manager_copy");

        let staged2 = StagedFileDrag::create(
            "test",
            &[NativeFileDragItem { entry_path: "root.txt".to_string(), display_path: "root.txt".to_string(), size: Some(12), modified_unix_seconds: None }],
            Arc::clone(&provider),
        )
        .expect("stage drag files");
        let root2 = staged2.root().expect("root2").to_path_buf();
        staged2.keep_for_file_manager_copy();
        assert!(root2.exists());

        cleanup_retained_drag_roots();
        assert!(!root1.exists(), "root1 should be removed by cleanup_retained_drag_roots");
        assert!(!root2.exists(), "root2 should be removed by cleanup_retained_drag_roots");
    }
}
