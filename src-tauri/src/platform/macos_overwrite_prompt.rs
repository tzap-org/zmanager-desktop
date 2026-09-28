//! Single-dialog extraction overwrite prompt: one NSAlert, presented by the
//! Native Host, holding every per-item and "apply to all" choice.

use std::ffi::c_void;

use serde::Serialize;
use zmanager_core::jobs::CancellationToken;

use super::macos::zmanager_macos_show_overwrite_prompt;
use super::overwrite_prompt_labels::without_mnemonic;
use super::{OverwritePrompt, OverwritePromptChoice};

/// Button titles in the Native Host's choice-code order.
#[derive(Serialize)]
struct PromptRequest {
    title: String,
    instruction: String,
    content: String,
    buttons: [String; 6],
}

pub(super) fn show(
    prompt: &OverwritePrompt<'_>,
    app: &tauri::AppHandle,
    owner: Option<&tauri::WebviewWindow>,
    cancellation: &CancellationToken,
) -> Option<OverwritePromptChoice> {
    let request = serde_json::to_vec(&PromptRequest {
        title: prompt.title.to_owned(),
        instruction: prompt.instruction.to_owned(),
        content: prompt.content.to_owned(),
        buttons: [prompt.replace, prompt.replace_all, prompt.skip, prompt.skip_all, prompt.rename_all, prompt.cancel].map(without_mnemonic),
    })
    .ok()?;
    let owner = owner.cloned();
    let cancellation = cancellation.clone();
    super::run_prompt_on_main_thread(app, move || {
        let window = owner.and_then(|window| window.ns_window().ok()).unwrap_or(std::ptr::null_mut());
        let mut choice = -1;
        // SAFETY: the request buffer, the token behind `context` and `choice`
        // all outlive this call, which returns only once the alert is closed.
        let status = unsafe {
            zmanager_macos_show_overwrite_prompt(
                window,
                request.as_ptr(),
                request.len(),
                Some(is_cancelled),
                (&cancellation as *const CancellationToken).cast_mut().cast(),
                &mut choice,
            )
        };
        (status == 0).then(|| choice_from_code(choice))
    })
}

extern "C" fn is_cancelled(context: *mut c_void) -> i32 {
    // SAFETY: `context` is the token `show` borrows for the alert's lifetime.
    let cancellation = unsafe { &*(context as *const CancellationToken) };
    i32::from(cancellation.is_cancelled())
}

fn choice_from_code(code: i32) -> OverwritePromptChoice {
    match code {
        0 => OverwritePromptChoice::Replace,
        1 => OverwritePromptChoice::ReplaceAll,
        2 => OverwritePromptChoice::Skip,
        3 => OverwritePromptChoice::SkipAll,
        4 => OverwritePromptChoice::RenameAll,
        _ => OverwritePromptChoice::Cancel,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choice_codes_follow_the_button_order() {
        assert_eq!(choice_from_code(0), OverwritePromptChoice::Replace);
        assert_eq!(choice_from_code(1), OverwritePromptChoice::ReplaceAll);
        assert_eq!(choice_from_code(2), OverwritePromptChoice::Skip);
        assert_eq!(choice_from_code(3), OverwritePromptChoice::SkipAll);
        assert_eq!(choice_from_code(4), OverwritePromptChoice::RenameAll);
        assert_eq!(choice_from_code(5), OverwritePromptChoice::Cancel);
        assert_eq!(choice_from_code(-1), OverwritePromptChoice::Cancel);
    }

    #[test]
    fn cancellation_callback_reports_the_token_state() {
        let token = CancellationToken::new();
        let context = (&token as *const CancellationToken).cast_mut().cast();
        assert_eq!(is_cancelled(context), 0);
        token.cancel();
        assert_eq!(is_cancelled(context), 1);
    }
}
