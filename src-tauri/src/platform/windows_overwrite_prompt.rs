//! Single-dialog extraction overwrite prompt, modelled on 7-Zip's
//! `COverwriteDialog`: every per-item and "apply to all" choice is a button in
//! one Task Dialog instead of a chain of three-button message boxes.

use std::{mem::size_of, ptr::null_mut};

use windows_sys::Win32::{
    Foundation::{FILETIME, HWND, LPARAM, S_OK, SYSTEMTIME, WPARAM},
    System::Time::{FileTimeToSystemTime, SystemTimeToTzSpecificLocalTime},
    UI::{
        Controls::{
            TASKDIALOG_BUTTON, TASKDIALOGCONFIG, TD_WARNING_ICON, TDCBF_CANCEL_BUTTON, TDF_ALLOW_DIALOG_CANCELLATION, TDF_CALLBACK_TIMER,
            TDF_POSITION_RELATIVE_TO_WINDOW, TDM_CLICK_BUTTON, TDN_TIMER, TaskDialogIndirect,
        },
        WindowsAndMessaging::{IDCANCEL, IsIconic, IsWindowVisible, SendMessageW},
    },
};
use zmanager_core::jobs::CancellationToken;

use super::{OverwritePrompt, OverwritePromptChoice};

const REPLACE_ID: i32 = 1001;
const REPLACE_ALL_ID: i32 = 1002;
const SKIP_ID: i32 = 1003;
const SKIP_ALL_ID: i32 = 1004;
const RENAME_ALL_ID: i32 = 1005;

pub(super) fn show(prompt: &OverwritePrompt<'_>, owner: Option<&tauri::WebviewWindow>, cancellation: &CancellationToken) -> Option<OverwritePromptChoice> {
    let title = wide(prompt.title);
    let instruction = wide(prompt.instruction);
    let content = wide(prompt.content);
    let labels = [
        (REPLACE_ID, wide(prompt.replace)),
        (REPLACE_ALL_ID, wide(prompt.replace_all)),
        (SKIP_ID, wide(prompt.skip)),
        (SKIP_ALL_ID, wide(prompt.skip_all)),
        (RENAME_ALL_ID, wide(prompt.rename_all)),
    ];
    let buttons: Vec<TASKDIALOG_BUTTON> = labels.iter().map(|(id, label)| TASKDIALOG_BUTTON { nButtonID: *id, pszButtonText: label.as_ptr() }).collect();
    let owner = owner_hwnd(owner);

    // SAFETY: TASKDIALOGCONFIG is a plain C struct for which all-zero is the
    // documented "unset" value of every field.
    let mut config: TASKDIALOGCONFIG = unsafe { std::mem::zeroed() };
    config.cbSize = size_of::<TASKDIALOGCONFIG>() as u32;
    config.hwndParent = owner;
    config.dwFlags = TDF_ALLOW_DIALOG_CANCELLATION | TDF_CALLBACK_TIMER | if owner.is_null() { 0 } else { TDF_POSITION_RELATIVE_TO_WINDOW };
    config.dwCommonButtons = TDCBF_CANCEL_BUTTON;
    config.pszWindowTitle = title.as_ptr();
    config.Anonymous1.pszMainIcon = TD_WARNING_ICON;
    config.pszMainInstruction = instruction.as_ptr();
    config.pszContent = content.as_ptr();
    config.cButtons = buttons.len() as u32;
    config.pButtons = buttons.as_ptr();
    config.nDefaultButton = REPLACE_ID;
    config.pfCallback = Some(cancel_on_timer);
    config.lpCallbackData = cancellation as *const CancellationToken as isize;

    let mut pressed = 0_i32;
    // SAFETY: every pointer in `config` borrows a buffer that outlives this
    // modal call, and the callback only reads the cancellation token.
    let result = unsafe { TaskDialogIndirect(&config, &mut pressed, null_mut(), null_mut()) };
    // A dialog that could not be created is not a user "Cancel": let the
    // caller fall back to the chained prompts instead of aborting extraction.
    if result != S_OK {
        return None;
    }
    Some(match pressed {
        REPLACE_ID => OverwritePromptChoice::Replace,
        REPLACE_ALL_ID => OverwritePromptChoice::ReplaceAll,
        SKIP_ID => OverwritePromptChoice::Skip,
        SKIP_ALL_ID => OverwritePromptChoice::SkipAll,
        RENAME_ALL_ID => OverwritePromptChoice::RenameAll,
        _ => OverwritePromptChoice::Cancel,
    })
}

/// Owning a hidden or minimized task window would hide the dialog with it
/// (the job keeps running in the background), so only a visible window owns it.
fn owner_hwnd(owner: Option<&tauri::WebviewWindow>) -> HWND {
    let Some(hwnd) = owner.and_then(|window| window.hwnd().ok()).map(|hwnd| hwnd.0 as HWND) else {
        return null_mut();
    };
    // SAFETY: both calls only query window state and tolerate stale handles.
    if unsafe { IsWindowVisible(hwnd) != 0 && IsIconic(hwnd) == 0 } { hwnd } else { null_mut() }
}

/// Closes the dialog when the job is cancelled from its task window, so a
/// cancelled extraction does not leave a prompt waiting for an answer.
unsafe extern "system" fn cancel_on_timer(hwnd: HWND, message: u32, _wparam: WPARAM, _lparam: LPARAM, data: isize) -> i32 {
    if message == TDN_TIMER as u32 {
        // SAFETY: `data` is the token borrowed by `show` for the dialog's lifetime.
        let cancellation = unsafe { &*(data as *const CancellationToken) };
        if cancellation.is_cancelled() {
            // SAFETY: `hwnd` is the live task dialog delivering this notification.
            unsafe { SendMessageW(hwnd, TDM_CLICK_BUTTON as u32, IDCANCEL as WPARAM, 0) };
        }
    }
    S_OK
}

/// Formats `time` in the user's local time zone as `YYYY-MM-DD HH:MM:SS`.
pub(super) fn format_local_time(time: std::time::SystemTime) -> Option<String> {
    // FILETIME counts 100 ns intervals since 1601-01-01 UTC.
    const EPOCH_1601_TO_1970_SECONDS: i128 = 11_644_473_600;
    let unix_nanos = match time.duration_since(std::time::UNIX_EPOCH) {
        Ok(after) => i128::try_from(after.as_nanos()).ok()?,
        Err(before) => -i128::try_from(before.duration().as_nanos()).ok()?,
    };
    let intervals = u64::try_from(unix_nanos / 100 + EPOCH_1601_TO_1970_SECONDS * 10_000_000).ok()?;
    let file_time = FILETIME { dwLowDateTime: intervals as u32, dwHighDateTime: (intervals >> 32) as u32 };
    let mut utc = SYSTEMTIME::default();
    let mut local = SYSTEMTIME::default();
    // SAFETY: plain conversions between caller-owned in/out parameters.
    let converted = unsafe { FileTimeToSystemTime(&file_time, &mut utc) != 0 && SystemTimeToTzSpecificLocalTime(null_mut(), &utc, &mut local) != 0 };
    converted.then(|| format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", local.wYear, local.wMonth, local.wDay, local.wHour, local.wMinute, local.wSecond))
}

fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}
