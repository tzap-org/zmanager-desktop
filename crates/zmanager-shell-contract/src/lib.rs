use std::fmt;

use serde::{Deserialize, Serialize};

mod generated;
pub use generated::{
    MIN_SUPPORTED_SHELL_ACTION_REQUEST_VERSION, SHELL_ACTION_POLICIES, SHELL_ACTION_REQUEST_VERSION, ShellActionKind, ShellActionPolicy,
    ShellActionWindowDisposition,
};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ShellActionRequest {
    pub version: u32,
    pub action: ShellActionKind,
    pub paths: Vec<String>,
}

impl ShellActionRequest {
    pub fn new(action: ShellActionKind, paths: Vec<String>) -> Self {
        Self { version: SHELL_ACTION_REQUEST_VERSION, action, paths }
    }

    pub fn from_json(json: &str) -> Result<Self, ShellActionContractError> {
        let request = serde_json::from_str::<Self>(json).map_err(|error| ShellActionContractError::InvalidJson(error.to_string()))?;
        if request.version < MIN_SUPPORTED_SHELL_ACTION_REQUEST_VERSION || request.version > SHELL_ACTION_REQUEST_VERSION {
            return Err(ShellActionContractError::UnsupportedVersion(request.version));
        }
        Ok(request)
    }

    pub fn to_json(&self) -> Result<String, ShellActionContractError> {
        serde_json::to_string(self).map_err(|error| ShellActionContractError::InvalidJson(error.to_string()))
    }
}

impl ShellActionKind {
    pub fn window_disposition(self) -> ShellActionWindowDisposition {
        SHELL_ACTION_POLICIES.iter().find(|policy| policy.kind == self).expect("every generated shell action must have a policy").window_disposition
    }
}

impl ShellActionWindowDisposition {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MainWindow => "mainWindow",
            Self::DisposableTask => "disposableTask",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ShellActionContractError {
    InvalidJson(String),
    UnsupportedVersion(u32),
}

impl fmt::Display for ShellActionContractError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidJson(message) => {
                write!(formatter, "invalid shell-action request JSON: {message}")
            }
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported shell-action request version: {version}")
            }
        }
    }
}

impl std::error::Error for ShellActionContractError {}

pub const SUPPORTED_ARCHIVE_SUFFIXES: &[&str] = &[
    ".vol000.tzap",
    ".cpio.lzma",
    ".cpio.bz2",
    ".cpio.zst",
    ".tar.lzma",
    ".cpio.gz",
    ".cpio.xz",
    ".tar.b64",
    ".tar.bz2",
    ".tar.lrz",
    ".tar.lz4",
    ".tar.lzo",
    ".tar.zst",
    ".7z.001",
    ".sevenz",
    ".tar.br",
    ".tar.gz",
    ".tar.lz",
    ".tar.uu",
    ".tar.xz",
    ".mtree",
    ".tar.z",
    ".tlzma",
    ".ustar",
    ".appx",
    ".cpgz",
    ".cpio",
    ".epub",
    ".lzma",
    ".tbz2",
    ".tzap",
    ".tzst",
    ".vmdk",
    ".zipx",
    ".aar",
    ".aea",
    ".apk",
    ".b64",
    ".bz2",
    ".cab",
    ".cb7",
    ".cbr",
    ".cbt",
    ".cbz",
    ".deb",
    ".ipa",
    ".iso",
    ".jar",
    ".lha",
    ".lz4",
    ".lzh",
    ".lzo",
    ".msi",
    ".pax",
    ".rar",
    ".rpm",
    ".tar",
    ".taz",
    ".tbz",
    ".tgz",
    ".txz",
    ".udf",
    ".vhd",
    ".war",
    ".xar",
    ".xpi",
    ".zip",
    ".zst",
    ".7z",
    ".ar",
    ".br",
    ".gz",
    ".lz",
    ".uu",
    ".xz",
    ".a",
    ".z",
];

pub fn base_name_without_archive_extension(path: &str) -> &str {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let lower = name.to_lowercase();
    for suffix in SUPPORTED_ARCHIVE_SUFFIXES {
        if lower.ends_with(suffix) && name.len() > suffix.len() {
            return &name[..name.len() - suffix.len()];
        }
    }
    if let Some(dot_idx) = name.rfind('.')
        && dot_idx > 0
    {
        return &name[..dot_idx];
    }
    name
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versioned_request_round_trips_all_selected_paths() {
        let request = ShellActionRequest::new(ShellActionKind::CompressZip, vec!["C:/work/folder1".to_string(), "C:/work/folder2".to_string()]);

        let json = request.to_json().expect("request should serialize");
        let parsed = ShellActionRequest::from_json(&json).expect("request should parse");

        assert_eq!(parsed, request);
    }

    #[test]
    fn unknown_contract_versions_are_rejected() {
        let error = ShellActionRequest::from_json(r#"{"version":2,"action":"compressZip","paths":["C:/work"]}"#).expect_err("unknown version should fail");

        assert_eq!(error, ShellActionContractError::UnsupportedVersion(2));
    }

    #[test]
    fn generated_actions_match_the_shared_conformance_fixture() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/contracts/native-contracts.conformance.json")).expect("conformance fixture should parse");
        let expected = fixture["actionOrder"]
            .as_array()
            .expect("actionOrder should be an array")
            .iter()
            .map(|value| value.as_str().expect("action id should be text"))
            .collect::<Vec<_>>();
        let actual = SHELL_ACTION_POLICIES.iter().map(|policy| policy.id).collect::<Vec<_>>();
        assert_eq!(actual, expected);
        assert!(SHELL_ACTION_POLICIES.windows(2).all(|pair| pair[0].order < pair[1].order));
    }

    #[test]
    fn generated_window_dispositions_separate_main_and_disposable_actions() {
        for kind in [ShellActionKind::Open, ShellActionKind::Compress, ShellActionKind::Extract] {
            assert_eq!(kind.window_disposition(), ShellActionWindowDisposition::MainWindow);
        }
        for kind in [
            ShellActionKind::CompressZip,
            ShellActionKind::CompressTzap,
            ShellActionKind::CompressSevenZ,
            ShellActionKind::CompressTarZst,
            ShellActionKind::CompressTarGz,
            ShellActionKind::CompressCleanSource,
            ShellActionKind::ExtractHere,
            ShellActionKind::ExtractToFolder,
        ] {
            assert_eq!(kind.window_disposition(), ShellActionWindowDisposition::DisposableTask);
        }
    }

    #[test]
    fn base_name_without_archive_extension_strips_extensions_correctly() {
        assert_eq!(base_name_without_archive_extension("C:\\path\\to\\archive.zip"), "archive");
        assert_eq!(base_name_without_archive_extension("C:/path/to/MPC-BE.1.9.1.x64-installer.zip"), "MPC-BE.1.9.1.x64-installer");
        assert_eq!(base_name_without_archive_extension("/home/user/archive.tar.gz"), "archive");
        assert_eq!(base_name_without_archive_extension("/home/user/archive.tar.zst"), "archive");
        assert_eq!(base_name_without_archive_extension("split.7z.001"), "split");
        assert_eq!(base_name_without_archive_extension("backup.vol000.tzap"), "backup");
        assert_eq!(base_name_without_archive_extension("plain_file"), "plain_file");
    }
}
