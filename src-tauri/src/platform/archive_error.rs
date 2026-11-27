use zmanager_core::archive_browser::ArchiveBrowserError;
use zmanager_core::engine::{ArchiveError, ErrorKind};

use crate::error::CommandErrorDto;

pub(crate) fn map_engine_error(error: ArchiveError) -> CommandErrorDto {
    match error.kind {
        ErrorKind::InvalidFormat => CommandErrorDto::unsupported_format(error.message),
        ErrorKind::PasswordRequired => {
            CommandErrorDto::password_required(error.message, Some("Enter the archive password to view or extract its contents.".to_string()))
        }
        ErrorKind::WrongPassword => CommandErrorDto::invalid_password(error.message),
        ErrorKind::CorruptData => CommandErrorDto::operation_failed(error.message),
        ErrorKind::ResourceLimitExceeded => CommandErrorDto::invalid_request(error.message),
        ErrorKind::SafetyViolation => CommandErrorDto::unsafe_archive(error.message),
        ErrorKind::Io => CommandErrorDto::io_error(error.message, false),
        ErrorKind::SourceChanged => CommandErrorDto::invalid_request(error.message),
        ErrorKind::UnsupportedOperation => CommandErrorDto::unsupported_format(error.message),
        ErrorKind::Cancelled => CommandErrorDto::cancelled("Archive operation was cancelled."),
    }
}

pub(crate) fn map_archive_browser_error(error: ArchiveBrowserError) -> CommandErrorDto {
    match error {
        ArchiveBrowserError::Cancelled => CommandErrorDto::cancelled("Archive enumeration was cancelled."),
        ArchiveBrowserError::Engine { source, .. } => map_engine_error(source),
        ArchiveBrowserError::Io { path, source } => crate::commands::map_io_error(path.to_string_lossy().to_string(), source),
        ArchiveBrowserError::Safety(source) => CommandErrorDto::unsafe_archive(format!("entry blocked by safety policy: {source}")),
        ArchiveBrowserError::EntryNotFound { path } => CommandErrorDto::not_found(
            format!("archive entry not found: {path}"),
            Some("Open a different archive or confirm the selected entry path.".to_string()),
        ),
        ArchiveBrowserError::UnsupportedEntry { path, .. } => {
            CommandErrorDto::unsupported_format(format!("entry cannot be extracted or previewed here: {path}"))
        }
        ArchiveBrowserError::EntrySkipped { path } => {
            CommandErrorDto::invalid_request(format!("archive entry was skipped because strip-components leaves no output path: {path}"))
        }
        ArchiveBrowserError::UnsupportedOperation(msg) => CommandErrorDto::operation_failed(format!("Unsupported operation: {msg}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::COMMAND_ERROR_INVALID_REQUEST;
    use zmanager_core::archive_browser::ArchiveBrowserError;
    use zmanager_core::engine::{ArchiveError, ErrorKind};

    #[test]
    fn maps_engine_browser_errors_to_invalid_request() {
        let error = map_archive_browser_error(ArchiveBrowserError::Engine {
            format: None,
            source: ArchiveError::usable(ErrorKind::ResourceLimitExceeded, "RAR dictionary is too large for archive/data.bin: 536870912 bytes"),
        });

        assert_eq!(error.code, COMMAND_ERROR_INVALID_REQUEST);
        assert_eq!(error.message, "RAR dictionary is too large for archive/data.bin: 536870912 bytes");
    }
}
