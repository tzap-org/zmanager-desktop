use std::collections::HashSet;

#[cfg(test)]
use super::NativeFileDragItemKind;
use super::{NativeFileDragCandidate, NativeFileDragError, NativeFileDragItem};

pub(super) fn prepare_windows_drag_items(
    candidates: &[NativeFileDragCandidate],
    strip_components: usize,
) -> Result<Vec<NativeFileDragItem>, NativeFileDragError> {
    let mut display_path_keys = HashSet::new();
    let mut items = Vec::with_capacity(candidates.len());

    for candidate in candidates {
        let display_path = windows_drag_display_path(&candidate.entry_path, strip_components)?;
        if !display_path_keys.insert(display_path.to_lowercase()) {
            return Err(NativeFileDragError::invalid_request(format!("more than one selected entry would drag out as {display_path}")));
        }
        items.push(NativeFileDragItem {
            entry_path: candidate.entry_path.clone(),
            display_path,
            kind: candidate.kind,
            size: candidate.size,
            modified_unix_seconds: candidate.modified_unix_seconds,
        });
    }

    Ok(items)
}

fn windows_drag_display_path(entry_path: &str, strip_components: usize) -> Result<String, NativeFileDragError> {
    let components = entry_path.split(['/', '\\']).filter(|component| !component.is_empty()).skip(strip_components).collect::<Vec<_>>();

    if components.is_empty() {
        return Err(NativeFileDragError::invalid_request(format!("entry path is empty after stripping components: {entry_path}")));
    }

    for component in &components {
        validate_windows_drag_component(component, entry_path)?;
    }

    let display_path = components.join("\\");
    if display_path.encode_utf16().count() > WINDOWS_FILE_DESCRIPTOR_PATH_MAX_UTF16 {
        return Err(NativeFileDragError::invalid_request(format!("entry path is too long for Windows virtual drag-out: {entry_path}")));
    }

    Ok(display_path)
}

const WINDOWS_FILE_DESCRIPTOR_PATH_MAX_UTF16: usize = 259;
const WINDOWS_RESERVED_FILE_NAMES: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7",
    "LPT8", "LPT9",
];

fn validate_windows_drag_component(component: &str, entry_path: &str) -> Result<(), NativeFileDragError> {
    if component == "." || component == ".." {
        return Err(NativeFileDragError::unsafe_archive(format!("entry path contains unsafe traversal component: {entry_path}")));
    }
    if component.ends_with(' ') || component.ends_with('.') {
        return Err(NativeFileDragError::unsafe_archive(format!("entry path contains a Windows-unsafe component: {entry_path}")));
    }
    if component.chars().any(is_windows_invalid_file_name_char) {
        return Err(NativeFileDragError::unsafe_archive(format!("entry path contains a Windows-unsafe character: {entry_path}")));
    }

    let reserved_probe = component.split_once('.').map_or(component, |(stem, _)| stem).to_ascii_uppercase();
    if WINDOWS_RESERVED_FILE_NAMES.contains(&reserved_probe.as_str()) {
        return Err(NativeFileDragError::unsafe_archive(format!("entry path contains a Windows-reserved file name: {entry_path}")));
    }

    Ok(())
}

fn is_windows_invalid_file_name_char(character: char) -> bool {
    character == '\0' || character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(path: &str) -> NativeFileDragCandidate {
        NativeFileDragCandidate { entry_path: path.to_string(), kind: NativeFileDragItemKind::File, size: Some(1), modified_unix_seconds: None }
    }

    #[test]
    fn prepares_windows_separators_after_stripping_components() {
        let items = prepare_windows_drag_items(&[candidate("docs/nested/readme.txt")], 1).expect("prepare Windows path");

        assert_eq!(items[0].display_path, "nested\\readme.txt");
    }

    #[test]
    fn rejects_windows_unsafe_names() {
        for path in ["docs/../escape.txt", "docs/report?.txt", "docs/CON.txt", "docs/trailing-dot.", "docs/trailing-space "] {
            assert!(prepare_windows_drag_items(&[candidate(path)], 0).is_err(), "{path} should be rejected");
        }
    }

    #[test]
    fn rejects_case_insensitive_collisions_after_stripping() {
        assert!(prepare_windows_drag_items(&[candidate("one/Readme.txt"), candidate("two/README.txt")], 1,).is_err());
    }

    #[test]
    fn enforces_file_descriptor_utf16_path_limit() {
        let maximum_name = "a".repeat(WINDOWS_FILE_DESCRIPTOR_PATH_MAX_UTF16);
        let too_long_name = "a".repeat(WINDOWS_FILE_DESCRIPTOR_PATH_MAX_UTF16 + 1);

        assert!(prepare_windows_drag_items(&[candidate(&maximum_name)], 0).is_ok());
        assert!(prepare_windows_drag_items(&[candidate(&too_long_name)], 0).is_err());
    }

    #[test]
    fn counts_utf16_code_units_instead_of_unicode_scalars_for_the_path_limit() {
        let maximum_name = "📦".repeat(WINDOWS_FILE_DESCRIPTOR_PATH_MAX_UTF16 / 2);
        let too_long_name = "📦".repeat(WINDOWS_FILE_DESCRIPTOR_PATH_MAX_UTF16 / 2 + 1);

        assert_eq!(maximum_name.chars().count(), 129);
        assert_eq!(maximum_name.encode_utf16().count(), 258);
        assert!(prepare_windows_drag_items(&[candidate(&maximum_name)], 0).is_ok());
        assert!(prepare_windows_drag_items(&[candidate(&too_long_name)], 0).is_err());
    }

    #[test]
    fn rejects_every_windows_forbidden_character_and_control_character() {
        for character in ['<', '>', ':', '"', '|', '?', '*', '\0', '\u{001f}'] {
            let path = format!("folder/report{character}.txt");
            assert!(prepare_windows_drag_items(&[candidate(&path)], 0).is_err(), "{character:?} should be rejected");
        }
    }

    #[test]
    fn rejects_reserved_device_names_regardless_of_case_or_extension() {
        for name in ["con", "PrN.txt", "AUX.backup.txt", "nul", "com1.log", "COM9", "lpt1.txt", "LPT9"] {
            assert!(prepare_windows_drag_items(&[candidate(&format!("folder/{name}"))], 0).is_err(), "{name} should be rejected");
        }
    }

    #[test]
    fn accepts_names_that_only_begin_with_windows_device_name_text() {
        for name in ["console.txt", "nulled.txt", "COM10.txt", "LPT10.txt"] {
            assert!(prepare_windows_drag_items(&[candidate(&format!("folder/{name}"))], 0).is_ok(), "{name} should be accepted");
        }
    }

    #[test]
    fn preserves_candidate_metadata_and_original_archive_path() {
        let candidate = NativeFileDragCandidate {
            entry_path: "root/folder/report.txt".to_string(),
            kind: NativeFileDragItemKind::File,
            size: Some(u64::from(u32::MAX) + 42),
            modified_unix_seconds: Some(1_700_000_000),
        };

        let items = prepare_windows_drag_items(&[candidate], 1).expect("prepare Windows item");

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].entry_path, "root/folder/report.txt");
        assert_eq!(items[0].display_path, "folder\\report.txt");
        assert_eq!(items[0].size, Some(u64::from(u32::MAX) + 42));
        assert_eq!(items[0].modified_unix_seconds, Some(1_700_000_000));
    }

    #[test]
    fn rejects_paths_left_empty_after_normalization_or_stripping() {
        for (path, strip_components) in [("///\\\\", 0), ("folder/file.txt", 2)] {
            assert!(prepare_windows_drag_items(&[candidate(path)], strip_components).is_err(), "{path:?} should be empty after normalization");
        }
    }
}
