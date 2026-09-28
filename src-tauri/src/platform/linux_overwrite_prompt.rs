//! Single-dialog extraction overwrite prompt: one GTK message dialog holding
//! every per-item and "apply to all" choice.

use std::time::Duration;

use gtk::prelude::*;
use zmanager_core::jobs::CancellationToken;

use super::overwrite_prompt_labels::gtk_mnemonic;
use super::{OverwritePrompt, OverwritePromptChoice};

const CHOICES: [OverwritePromptChoice; 5] = [
    OverwritePromptChoice::Replace,
    OverwritePromptChoice::ReplaceAll,
    OverwritePromptChoice::Skip,
    OverwritePromptChoice::SkipAll,
    OverwritePromptChoice::RenameAll,
];
const CANCELLATION_POLL: Duration = Duration::from_millis(100);

pub(super) fn show(
    prompt: &OverwritePrompt<'_>,
    app: &tauri::AppHandle,
    owner: Option<&tauri::WebviewWindow>,
    cancellation: &CancellationToken,
) -> Option<OverwritePromptChoice> {
    let title = prompt.title.to_owned();
    let instruction = prompt.instruction.to_owned();
    let content = prompt.content.to_owned();
    let labels = [prompt.replace, prompt.replace_all, prompt.skip, prompt.skip_all, prompt.rename_all].map(gtk_mnemonic);
    let cancel = gtk_mnemonic(prompt.cancel);
    let owner = owner.cloned();
    let cancellation = cancellation.clone();
    super::run_prompt_on_main_thread(app, move || {
        if cancellation.is_cancelled() {
            return Some(OverwritePromptChoice::Cancel);
        }
        let parent = owner.and_then(|window| window.gtk_window().ok()).filter(|window| is_shown(window.upcast_ref()));
        let dialog = gtk::MessageDialog::new(
            parent.as_ref(),
            gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
            gtk::MessageType::Warning,
            gtk::ButtonsType::None,
            &instruction,
        );
        dialog.set_title(&title);
        dialog.set_secondary_text(Some(&content));
        for (label, response) in labels.iter().zip(1_u16..) {
            dialog.add_button(label, gtk::ResponseType::Other(response));
        }
        dialog.add_button(&cancel, gtk::ResponseType::Cancel);
        dialog.set_default_response(gtk::ResponseType::Other(1));
        if parent.is_none() {
            // Nothing to stack above: centre it and make sure it is not lost
            // behind other windows while the job waits for an answer.
            dialog.set_position(gtk::WindowPosition::Center);
            dialog.set_keep_above(true);
        }

        let poll = glib::timeout_add_local(CANCELLATION_POLL, {
            let dialog = dialog.downgrade();
            move || {
                if cancellation.is_cancelled()
                    && let Some(dialog) = dialog.upgrade()
                {
                    dialog.response(gtk::ResponseType::Cancel);
                }
                glib::ControlFlow::Continue
            }
        });
        dialog.present();
        let response = dialog.run();
        poll.remove();
        // SAFETY: the dialog is ours alone and no reference to it is used
        // after this point.
        unsafe { dialog.destroy() };
        Some(choice_from_response(response))
    })
}

/// A hidden or minimized parent would take its transient dialog with it and
/// leave the job waiting on a prompt nobody can see.
fn is_shown(window: &gtk::Window) -> bool {
    window.is_visible() && !window.window().is_some_and(|window| window.state().contains(gdk::WindowState::ICONIFIED))
}

/// Esc and the window's close button arrive as `DeleteEvent`, which cancels
/// like every other response outside the five choices.
fn choice_from_response(response: gtk::ResponseType) -> OverwritePromptChoice {
    match response {
        gtk::ResponseType::Other(id) => CHOICES.get(usize::from(id).wrapping_sub(1)).copied().unwrap_or(OverwritePromptChoice::Cancel),
        _ => OverwritePromptChoice::Cancel,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_map_to_the_button_choices() {
        assert_eq!(choice_from_response(gtk::ResponseType::Other(1)), OverwritePromptChoice::Replace);
        assert_eq!(choice_from_response(gtk::ResponseType::Other(2)), OverwritePromptChoice::ReplaceAll);
        assert_eq!(choice_from_response(gtk::ResponseType::Other(3)), OverwritePromptChoice::Skip);
        assert_eq!(choice_from_response(gtk::ResponseType::Other(4)), OverwritePromptChoice::SkipAll);
        assert_eq!(choice_from_response(gtk::ResponseType::Other(5)), OverwritePromptChoice::RenameAll);
        assert_eq!(choice_from_response(gtk::ResponseType::Other(0)), OverwritePromptChoice::Cancel);
        assert_eq!(choice_from_response(gtk::ResponseType::Other(6)), OverwritePromptChoice::Cancel);
        assert_eq!(choice_from_response(gtk::ResponseType::Cancel), OverwritePromptChoice::Cancel);
        assert_eq!(choice_from_response(gtk::ResponseType::DeleteEvent), OverwritePromptChoice::Cancel);
    }
}
