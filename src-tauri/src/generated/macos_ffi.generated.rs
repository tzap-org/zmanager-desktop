// GENERATED FILE - DO NOT EDIT

#[allow(dead_code)]
unsafe extern "C" {
    pub fn zmanager_macos_host_start(
        callback: Option<extern "C" fn(*const u8, usize, *mut c_void)>,
        context: *mut c_void,
    ) -> i32;
    pub fn zmanager_macos_host_shutdown();
    pub fn zmanager_macos_host_is_running() -> i32;
    pub fn zmanager_macos_system_file_icons(
        bytes: *const u8,
        length: usize,
        callback: Option<extern "C" fn(*const u8, usize, *mut c_void)>,
        context: *mut c_void,
    ) -> i32;
    pub fn zmanager_macos_default_handlers(
        bytes: *const u8,
        length: usize,
        callback: Option<extern "C" fn(*const u8, usize, *mut c_void)>,
        context: *mut c_void,
    ) -> i32;
    pub fn zmanager_macos_consume_shell_action_request(
        bytes: *const u8,
        length: usize,
        callback: Option<extern "C" fn(*const u8, usize, *mut c_void)>,
        context: *mut c_void,
    ) -> i32;
    pub fn zmanager_macos_start_promise_drag(
        view: *mut c_void,
        session_bytes: *const u8,
        session_length: usize,
        item_bytes: *const u8,
        item_length: usize,
        write: Option<extern "C" fn(*const u8, usize, *const u8, usize, *mut c_void) -> i32>,
        outcome: Option<extern "C" fn(i32, *mut c_void)>,
        release: Option<extern "C" fn(*mut c_void)>,
        context: *mut c_void,
    ) -> i32;
    pub fn zmanager_macos_show_overwrite_prompt(
        window: *mut c_void,
        bytes: *const u8,
        length: usize,
        is_cancelled: Option<extern "C" fn(*mut c_void) -> i32>,
        context: *mut c_void,
        choice: *mut i32,
    ) -> i32;
}


#[allow(dead_code)]
pub const MAX_REQUEST_BYTES: usize = 1048576;
#[allow(dead_code)]
pub const MAX_RESPONSE_BYTES: usize = 8388608;
#[allow(dead_code)]
pub const MAX_DRAG_ITEMS: usize = 1000;
