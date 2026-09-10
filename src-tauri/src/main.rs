#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod account;
mod archive_file_types;
mod archive_index;
mod commands;
mod constants;
mod default_handlers;
mod destination_reservation;
mod diagnostics;
mod dto;
mod error;
mod hosted_transport;
mod job_dto;
mod job_registry;
mod localsend;
mod native_drag_session;
mod native_integration;
mod native_launch_inbox;
mod platform;
mod quick_action;
mod secure_store;
mod share_queue;

use tauri::{Emitter, Manager};

fn main() {
    platform::prepare_process();

    let diagnostics = diagnostics::DiagnosticLog::new();
    let _ = diagnostics.record("process", "entry", diagnostics::fields([]));
    let native_launch_inbox = native_launch_inbox::NativeLaunchInbox::new();
    let startup_args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if let Some(event) = quick_action::hosted_auth_callback_event_from_args(startup_args.clone()) {
        let _ = diagnostics.record(
            "launch",
            "hostedAuthCallbackObserved",
            diagnostics::fields([
                ("source", serde_json::Value::String("primaryProcess".to_owned())),
                ("callbackKind", serde_json::Value::String("tzap".to_owned())),
            ]),
        );
        native_launch_inbox.ingest(event).expect("failed to queue hosted auth deep-link callback");
    }
    let launch_instance_mode = quick_action::LaunchInstanceMode::from_startup_env();
    let startup_window_state = quick_action::QuickActionStartupState::from_startup_env();
    record_launch_classification(&diagnostics, "primaryProcess", &startup_window_state);
    let forwarded_startup_state = startup_window_state.forward_requested_to_native_inbox(&native_launch_inbox);
    platform::initialize_native_host(native_launch_inbox.clone(), diagnostics.clone()).expect("failed to initialize native host before Tauri startup");
    let job_registry = job_registry::JobRegistry::new();
    let archive_index_registry = archive_index::ArchiveIndexRegistry::with_diagnostics(diagnostics.clone());
    let account_runtime = account::AccountRuntime::new();
    let initial_account_auth_status = account_runtime.initial_auth_status();
    let native_drag_sessions = native_drag_session::NativeDragSessionRegistry::new();
    let quick_action_launch_coordinator = quick_action::QuickActionLaunchCoordinator::from_startup_state(forwarded_startup_state);
    let single_instance_coordinator = quick_action_launch_coordinator.clone();
    let single_instance_inbox = native_launch_inbox.clone();
    let setup_inbox = native_launch_inbox.clone();
    let exit_inbox = native_launch_inbox.clone();
    let single_instance_diagnostics = diagnostics.clone();
    let setup_diagnostics = diagnostics.clone();
    let exit_diagnostics = diagnostics.clone();

    let _ = diagnostics.record("process", "builderCreationStarted", diagnostics::fields([]));
    let builder = tauri::Builder::default();
    let builder = platform::register_platform_services(builder);
    let builder = builder
        .manage(job_registry)
        .manage(archive_index_registry)
        .manage(account_runtime)
        .manage(native_drag_sessions.clone())
        .manage(diagnostics.clone())
        .manage(quick_action_launch_coordinator)
        .manage(native_launch_inbox.clone())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init());
    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_wdio::init()).plugin(tauri_plugin_wdio_webdriver::init());
    let builder = if launch_instance_mode.registers_single_instance() {
        builder.plugin(tauri_plugin_single_instance::init(move |_app, argv, _cwd| {
            record_secondary_arguments(&single_instance_diagnostics, &argv);
            if quick_action::hosted_auth_callback_event_from_args(argv.iter().cloned().map(std::ffi::OsString::from)).is_some() {
                let _ = single_instance_diagnostics.record(
                    "launch",
                    "hostedAuthCallbackObserved",
                    diagnostics::fields([
                        ("source", serde_json::Value::String("secondaryProcess".to_owned())),
                        ("callbackKind", serde_json::Value::String("tzap".to_owned())),
                    ]),
                );
            }
            let state =
                single_instance_coordinator.ingest_secondary_process_args(argv.into_iter().map(std::ffi::OsString::from).collect(), &single_instance_inbox);
            record_launch_classification(&single_instance_diagnostics, "secondaryProcess", &state);
        }))
    } else {
        builder
    };
    let app = builder
        .setup(move |app| {
            let _ = setup_diagnostics.record("process", "setupEntered", diagnostics::fields([]));
            let _ = setup_diagnostics.initialize(app.path().app_log_dir().ok(), platform::prefer_user_diagnostic_log_directory());
            let _ = setup_diagnostics.record(
                "account",
                "accountSessionRestored",
                diagnostics::fields([("authStatus", serde_json::Value::String(initial_account_auth_status.clone()))]),
            );
            let emitter_app = app.handle().clone();
            setup_inbox
                .attach_emitter(std::sync::Arc::new(move |window, event| {
                    emitter_app.emit_to(window, native_launch_inbox::NATIVE_INBOUND_EVENT_NAME, event).map_err(|error| error.to_string())
                }))
                .map_err(|error| std::io::Error::other(format!("failed to attach native inbox emitter: {error:?}")))?;
            let app_data_dir = app.path().app_data_dir().map_err(|error| std::io::Error::other(format!("failed to resolve app data dir: {error}")))?;
            let local_send = localsend::LocalSendState::new(app_data_dir);
            let share_queue = share_queue::ShareRegistry::new(
                app.state::<job_registry::JobRegistry>().inner().clone(),
                local_send.clone(),
                app.state::<account::AccountRuntime>().inner().clone(),
                app.handle().clone(),
                setup_diagnostics.clone(),
            );
            let share_queue_for_events = share_queue.clone();
            app.manage(local_send.clone());
            app.manage(share_queue.clone());
            local_send.register_outgoing_event_sink(std::sync::Arc::new(move |event| share_queue_for_events.on_localsend_event(event)));
            local_send.start_event_pump(app.handle().clone(), app.state::<job_registry::JobRegistry>().inner().clone());
            if let Some(window) = app.get_webview_window("main") {
                platform::configure_main_window(&window)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let window_class = if window.label() == "main" {
                    "main"
                } else if window.label().starts_with("task-") {
                    "disposableTask"
                } else {
                    "other"
                };
                let _ = window.state::<diagnostics::DiagnosticLog>().record(
                    "window",
                    "destroyed",
                    diagnostics::fields([("windowClass", serde_json::Value::String(window_class.to_string()))]),
                );
                window.state::<job_registry::JobRegistry>().cleanup_owner_subscriptions(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::healthcheck,
            commands::project_contract,
            commands::system_file_icons,
            default_handlers::default_handler_status,
            default_handlers::default_handler_set,
            default_handlers::default_handler_restore,
            commands::validate_directory,
            diagnostics::record_diagnostic_event,
            diagnostics::diagnostic_log_info,
            commands::quick_action_startup_state,
            commands::native_frontend_ready,
            commands::acknowledge_native_event,
            account::account_snapshot,
            account::account_begin_hosted_auth,
            account::account_apply_hosted_callback,
            account::account_complete_hosted_auth,
            account::account_enroll_certificate,
            account::account_renew_certificate,
            account::account_retire_device,
            account::account_fetch_current_user,
            account::account_forget,
            account::account_generate_recipient_key,
            account::account_generate_signing_identity,
            account::account_import_signing_identity,
            account::account_install_signing_certificate,
            account::account_remove_signing_identity,
            account::account_remove_recipient_key,
            account::account_set_default_signing_identity,
            account::account_remove_contact,
            account::account_inspect_contact_card,
            account::account_accept_contact_card,
            account::account_sync_contacts,
            commands::start_archive_index,
            commands::wait_archive_index,
            commands::get_archive_children,
            commands::search_archive_index,
            commands::close_archive_index,
            commands::plan_create,
            commands::start_create,
            commands::start_extract,
            commands::verify_tzap_certificate,
            commands::validate_tzap_signing_identity,
            commands::preview_entry,
            commands::start_native_file_drag,
            commands::cleanup_preview_roots,
            commands::test_archive,
            commands::detect_archive_format,
            commands::subscribe_job,
            commands::get_job_snapshot,
            commands::subscribe_job_catalog,
            commands::ack_subscription,
            commands::unsubscribe_job,
            commands::cancel_job,
            commands::pause_job,
            commands::resume_job,
            commands::dismiss_job,
            localsend::localsend_discover,
            share_queue::enqueue_share,
            share_queue::set_share_receiver,
            share_queue::start_share,
            share_queue::get_share_queue,
            share_queue::skip_share,
            share_queue::cancel_share,
            share_queue::remove_share,
            localsend::localsend_respond_to_transfer,
            localsend::localsend_start_receiver,
            localsend::localsend_stop_receiver,
            localsend::localsend_list_trusted_devices,
            localsend::localsend_trust_device,
            localsend::localsend_untrust_device
        ])
        .build(tauri::generate_context!())
        .expect("failed to build ZManager desktop");
    let _ = diagnostics.record("process", "builderCompleted", diagnostics::fields([]));
    app.run(move |app_handle, event| {
        platform::handle_run_event(&event, &native_launch_inbox);
        if let tauri::RunEvent::Exit = event {
            let _ = exit_diagnostics.record("process", "exit", diagnostics::fields([]));
            exit_inbox.shutdown();
            native_drag_sessions.shutdown();
            let share_queue = app_handle.state::<share_queue::ShareRegistry>();
            share_queue.request_shutdown();
            app_handle.state::<localsend::LocalSendState>().shutdown();
            share_queue.join_workers();
            platform::shutdown();
        }
    });
}

fn record_launch_classification(diagnostics: &diagnostics::DiagnosticLog, source: &str, state: &quick_action::QuickActionStartupState) {
    let (classification, action, path_count) = match state {
        quick_action::QuickActionStartupState::NotRequested => ("normal", None, 0),
        quick_action::QuickActionStartupState::Requested(request) => {
            ("quickAction", serde_json::to_value(request.kind).ok().and_then(|value| value.as_str().map(str::to_owned)), request.paths.len())
        }
        quick_action::QuickActionStartupState::ForwardedToNativeInbox(kind) => {
            ("quickActionForwarded", serde_json::to_value(kind).ok().and_then(|value| value.as_str().map(str::to_owned)), 0)
        }
        quick_action::QuickActionStartupState::Invalid(_) => ("invalid", None, 0),
        quick_action::QuickActionStartupState::PendingMacOsQuickAction => ("pendingMacOsQuickAction", None, 0),
    };
    let _ = diagnostics.record(
        "launch",
        "classified",
        diagnostics::fields([
            ("source", serde_json::Value::String(source.to_string())),
            ("classification", serde_json::Value::String(classification.to_string())),
            ("action", action.map(serde_json::Value::String).unwrap_or(serde_json::Value::Null)),
            ("pathCount", serde_json::json!(path_count)),
        ]),
    );
}

fn record_secondary_arguments(diagnostics: &diagnostics::DiagnosticLog, args: &[String]) {
    let _ = diagnostics.record(
        "launch",
        "secondaryArgumentsObserved",
        diagnostics::fields([
            ("argumentCount", serde_json::json!(args.len())),
            (
                "hasQuickActionArgument",
                serde_json::json!(
                    args.iter()
                        .any(|arg| { arg == "--quick-action" || arg == "--action" || arg.starts_with("--quick-action=") || arg.starts_with("--action=") })
                ),
            ),
            (
                "hasRequestArgument",
                serde_json::json!(args.iter().any(|arg| {
                    arg == "--quick-action-request"
                        || arg == "--shell-action-request"
                        || arg.starts_with("--quick-action-request=")
                        || arg.starts_with("--shell-action-request=")
                })),
            ),
            ("hasPathArgument", serde_json::json!(args.iter().any(|arg| arg == "--path" || arg.starts_with("--path=")))),
        ]),
    );
}
