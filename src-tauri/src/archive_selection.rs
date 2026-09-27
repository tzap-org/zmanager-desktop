//! Path-based selection over a complete archive listing.
//!
//! Selecting a folder and excluding a folder follow the same rule: a path
//! covers itself and everything beneath it. Extract Selected, drag-out, and
//! exclusion filtering all resolve against the full listing through
//! [`ArchivePathSet`], so a folder behaves the same way everywhere whether the
//! archive lists it explicitly or only implies it through descendant paths.

/// Canonical comparison key for an archive path: forward slashes, no empty or
/// `.` segments.
pub(crate) fn archive_entry_key(path: &str) -> String {
    path.split(['/', '\\']).filter(|segment| !segment.is_empty() && *segment != ".").collect::<Vec<_>>().join("/")
}

/// A set of archive paths, each covering itself and every entry beneath it.
pub(crate) struct ArchivePathSet<'p> {
    requested: &'p [String],
    keys: Vec<String>,
}

impl<'p> ArchivePathSet<'p> {
    pub(crate) fn new(paths: &'p [String]) -> Self {
        Self { requested: paths, keys: paths.iter().map(|path| archive_entry_key(path)).collect() }
    }

    /// Whether `path` is exactly one of the set's paths.
    pub(crate) fn contains(&self, path: &str) -> bool {
        let key = archive_entry_key(path);
        self.keys.contains(&key)
    }

    /// Whether `path` is one of the set's paths or lies beneath one of them.
    pub(crate) fn covers(&self, path: &str) -> bool {
        let key = archive_entry_key(path);
        self.keys.iter().any(|root| key_is_within(&key, root))
    }

    /// Returns every listed entry the set covers, in listing order and each
    /// at most once, so a folder selects itself plus all of its descendants.
    ///
    /// # Errors
    ///
    /// Returns the first requested path that covers no listed entry.
    pub(crate) fn select<'e, E>(&self, entries: impl IntoIterator<Item = &'e E>, path_of: impl Fn(&E) -> &str) -> Result<Vec<&'e E>, &'p str> {
        let mut matched = vec![false; self.keys.len()];
        let mut selected = Vec::new();
        for entry in entries {
            let key = archive_entry_key(path_of(entry));
            let mut covered = false;
            for (root, matched) in self.keys.iter().zip(matched.iter_mut()) {
                if key_is_within(&key, root) {
                    *matched = true;
                    covered = true;
                }
            }
            if covered {
                selected.push(entry);
            }
        }
        match matched.iter().position(|matched| !matched) {
            Some(index) => Err(self.requested[index].as_str()),
            None => Ok(selected),
        }
    }
}

fn key_is_within(key: &str, root: &str) -> bool {
    !root.is_empty() && key.strip_prefix(root).is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::ArchivePathSet;

    fn paths(values: &[&str]) -> Vec<String> {
        values.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn folder_selects_itself_and_all_descendants_in_listing_order() {
        let listing = paths(&["docs", "docs/a.txt", "docs/nested", "docs/nested/b.txt", "docs-other/c.txt", "root.txt"]);
        let requested = paths(&["docs/"]);

        let selected = ArchivePathSet::new(&requested).select(&listing, String::as_str).unwrap();

        assert_eq!(selected, vec!["docs", "docs/a.txt", "docs/nested", "docs/nested/b.txt"]);
    }

    #[test]
    fn implied_folder_and_overlapping_selection_are_deduplicated() {
        let listing = paths(&["folder/a.txt", "folder/sub/b.txt", "root.txt"]);
        let requested = paths(&["folder", "folder\\sub\\b.txt", "root.txt"]);

        let selected = ArchivePathSet::new(&requested).select(&listing, String::as_str).unwrap();

        assert_eq!(selected, vec!["folder/a.txt", "folder/sub/b.txt", "root.txt"]);
    }

    #[test]
    fn unmatched_request_is_reported() {
        let listing = paths(&["docs/a.txt"]);
        let requested = paths(&["docs", "missing"]);

        assert_eq!(ArchivePathSet::new(&requested).select(&listing, String::as_str), Err("missing"));
    }

    #[test]
    fn covers_matches_whole_segments_only() {
        let excluded = paths(&["docs/nested"]);
        let set = ArchivePathSet::new(&excluded);

        assert!(set.covers("docs/nested"));
        assert!(set.covers("./docs/nested/b.txt"));
        assert!(!set.covers("docs/nested-other/c.txt"));
        assert!(!set.covers("docs"));
    }
}
