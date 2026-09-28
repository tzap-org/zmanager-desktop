//! Converts the overwrite prompt's Windows-style button labels (`&` marks the
//! mnemonic, `&&` is a literal ampersand) to other platforms' conventions.

/// AppKit buttons have no mnemonics: `"&Replace"` becomes `"Replace"`, and a
/// CJK-style trailing mnemonic such as `"替换(&R)"` is dropped as `"替换"`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub(super) fn without_mnemonic(label: &str) -> String {
    convert(strip_trailing_mnemonic(label), "")
}

/// GTK marks the mnemonic with `_`, so `"&Replace"` becomes `"_Replace"` and
/// `"替换(&R)"` becomes `"替换(_R)"`. Literal underscores are doubled.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub(super) fn gtk_mnemonic(label: &str) -> String {
    convert(label, "_")
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn convert(label: &str, marker: &str) -> String {
    let mut converted = String::with_capacity(label.len() + 1);
    let mut chars = label.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '&' if chars.peek() == Some(&'&') => {
                chars.next();
                converted.push('&');
            }
            '&' => converted.push_str(marker),
            '_' if !marker.is_empty() => converted.push_str("__"),
            other => converted.push(other),
        }
    }
    converted
}

/// `"替换(&R)"` -> `"替换"`: the parenthesised letter only exists to carry the
/// mnemonic, so it is noise once the mnemonic is gone.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn strip_trailing_mnemonic(label: &str) -> &str {
    let Some(inner) = label.strip_suffix(')') else {
        return label;
    };
    let Some(open) = inner.rfind("(&") else {
        return label;
    };
    let mut key = inner[open + 2..].chars();
    match (key.next(), key.next()) {
        (Some(key), None) if key != '&' => label[..open].trim_end(),
        _ => label,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appkit_labels_drop_the_mnemonic_marker() {
        assert_eq!(without_mnemonic("&Replace"), "Replace");
        assert_eq!(without_mnemonic("Skip a&ll"), "Skip all");
        assert_eq!(without_mnemonic("Re&name all"), "Rename all");
        assert_eq!(without_mnemonic("Save && close"), "Save & close");
        assert_eq!(without_mnemonic("Cancel"), "Cancel");
    }

    #[test]
    fn appkit_labels_drop_a_trailing_parenthesised_mnemonic() {
        assert_eq!(without_mnemonic("替换(&R)"), "替换");
        assert_eq!(without_mnemonic("全部重命名(&N)"), "全部重命名");
        assert_eq!(without_mnemonic("Replace (&R)"), "Replace");
        // Only a single-key "(&X)" suffix is a mnemonic.
        assert_eq!(without_mnemonic("Keep (&&)"), "Keep (&)");
        assert_eq!(without_mnemonic("Keep (&both)"), "Keep (both)");
    }

    #[test]
    fn gtk_labels_use_underscore_mnemonics() {
        assert_eq!(gtk_mnemonic("&Replace"), "_Replace");
        assert_eq!(gtk_mnemonic("Skip a&ll"), "Skip a_ll");
        assert_eq!(gtk_mnemonic("替换(&R)"), "替换(_R)");
        assert_eq!(gtk_mnemonic("Save && close"), "Save & close");
        assert_eq!(gtk_mnemonic("snake_case &file"), "snake__case _file");
    }
}
