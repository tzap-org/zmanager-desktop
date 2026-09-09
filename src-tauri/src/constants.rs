pub const DESKTOP_SHELL_NAME: &str = "ZManager";
pub const CORE_DEPENDENCY: &str = "zmanager-core";
pub const PLATFORM_STRATEGY: &str = "One shared Windows/Linux shell with isolated platform integration modules.";

/// The hosted service origin is compiled into staging builds. Runtime
/// preferences and callback metadata must never be able to retarget those
/// builds to another hosted service.
pub const TZAP_SERVER_BASE_URL: &str = match option_env!("ZMANAGER_TZAP_SERVER_BASE_URL") {
    Some(value) if !value.is_empty() => value,
    // Unconfigured local/test builds retain the historical staging default.
    // Production builds are always compiled through the build entry points,
    // which set ZMANAGER_TZAP_BUILD_ENV=prod and therefore cannot use this
    // value for a staging request.
    None => "https://staging.tzap.org",
    Some(_) => "https://staging.tzap.org",
};

pub const COMMAND_HEALTHCHECK: &str = "healthcheck";
pub const COMMAND_PROJECT_CONTRACT: &str = "project_contract";
pub const COMMAND_START_ARCHIVE_INDEX: &str = "start_archive_index";
pub const COMMAND_WAIT_ARCHIVE_INDEX: &str = "wait_archive_index";
pub const COMMAND_GET_ARCHIVE_CHILDREN: &str = "get_archive_children";
pub const COMMAND_SEARCH_ARCHIVE_INDEX: &str = "search_archive_index";
pub const COMMAND_CLOSE_ARCHIVE_INDEX: &str = "close_archive_index";
pub const COMMAND_TEST_ARCHIVE: &str = "test_archive";
pub const COMMAND_PLAN_CREATE: &str = "plan_create";
pub const COMMAND_START_CREATE: &str = "start_create";
pub const COMMAND_START_EXTRACT: &str = "start_extract";
pub const COMMAND_PREVIEW_ENTRY: &str = "preview_entry";
pub const COMMAND_START_NATIVE_FILE_DRAG: &str = "start_native_file_drag";
pub const COMMAND_CLEANUP_PREVIEW_ROOTS: &str = "cleanup_preview_roots";
pub const COMMAND_DETECT_ARCHIVE_FORMAT: &str = "detect_archive_format";
pub const COMMAND_CANCEL_JOB: &str = "cancel_job";
pub const COMMAND_PAUSE_JOB: &str = "pause_job";
pub const COMMAND_RESUME_JOB: &str = "resume_job";
pub const COMMAND_DISMISS_JOB: &str = "dismiss_job";

pub const COMMAND_ERROR_INVALID_REQUEST: &str = "invalid_request";
pub const COMMAND_ERROR_NOT_FOUND: &str = "not_found";
pub const COMMAND_ERROR_PASSWORD_REQUIRED: &str = "password_required";
pub const COMMAND_ERROR_INVALID_PASSWORD: &str = "invalid_password";
pub const COMMAND_ERROR_UNSAFE_ARCHIVE: &str = "unsafe_archive";
pub const COMMAND_ERROR_IO_ERROR: &str = "io_error";
pub const COMMAND_ERROR_UNSUPPORTED_FORMAT: &str = "unsupported_format";
pub const COMMAND_ERROR_CANCELLED: &str = "cancelled";
pub const COMMAND_ERROR_OPERATION_FAILED: &str = "operation_failed";
pub const COMMAND_ERROR_UNAUTHORIZED: &str = "unauthorized";

pub const PLANNED_COMMANDS: &[&str] = &[
    COMMAND_HEALTHCHECK,
    COMMAND_PROJECT_CONTRACT,
    COMMAND_START_ARCHIVE_INDEX,
    COMMAND_WAIT_ARCHIVE_INDEX,
    COMMAND_GET_ARCHIVE_CHILDREN,
    COMMAND_SEARCH_ARCHIVE_INDEX,
    COMMAND_CLOSE_ARCHIVE_INDEX,
    COMMAND_TEST_ARCHIVE,
    COMMAND_DETECT_ARCHIVE_FORMAT,
    COMMAND_PLAN_CREATE,
    COMMAND_START_CREATE,
    COMMAND_START_EXTRACT,
    COMMAND_PREVIEW_ENTRY,
    COMMAND_START_NATIVE_FILE_DRAG,
    COMMAND_CLEANUP_PREVIEW_ROOTS,
    COMMAND_CANCEL_JOB,
    COMMAND_PAUSE_JOB,
    COMMAND_RESUME_JOB,
    COMMAND_DISMISS_JOB,
];
