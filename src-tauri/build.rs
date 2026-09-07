use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_macos_host();
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
        "healthcheck",
        "project_contract",
        "system_file_icons",
        "default_handler_status",
        "default_handler_set",
        "default_handler_restore",
        "validate_directory",
        "record_diagnostic_event",
        "diagnostic_log_info",
        "quick_action_startup_state",
        "native_frontend_ready",
        "acknowledge_native_event",
        "account_snapshot",
        "account_begin_hosted_auth",
        "account_apply_hosted_callback",
        "account_complete_hosted_auth",
        "account_enroll_certificate",
        "account_renew_certificate",
        "account_retire_device",
        "account_fetch_current_user",
        "account_forget",
        "account_generate_recipient_key",
        "account_generate_signing_identity",
        "account_import_signing_identity",
        "account_install_signing_certificate",
        "account_remove_signing_identity",
        "account_remove_recipient_key",
        "account_set_default_signing_identity",
        "account_remove_contact",
        "account_inspect_contact_card",
        "account_accept_contact_card",
        "account_sync_contacts",
        "start_archive_index",
        "wait_archive_index",
        "get_archive_children",
        "search_archive_index",
        "close_archive_index",
        "plan_create",
        "start_create",
        "start_extract",
        "verify_tzap_certificate",
        "validate_tzap_signing_identity",
        "preview_entry",
        "start_native_file_drag",
        "cleanup_preview_roots",
        "test_archive",
        "detect_archive_format",
        "subscribe_job",
        "get_job_snapshot",
        "subscribe_job_catalog",
        "ack_subscription",
        "unsubscribe_job",
        "cancel_job",
        "pause_job",
        "resume_job",
        "dismiss_job",
        "localsend_discover",
        "enqueue_share",
        "set_share_receiver",
        "start_share",
        "get_share_queue",
        "skip_share",
        "cancel_share",
        "remove_share",
        "localsend_respond_to_transfer",
        "localsend_start_receiver",
        "localsend_stop_receiver",
        "localsend_list_trusted_devices",
        "localsend_trust_device",
        "localsend_untrust_device",
    ])))
    .expect("failed to run Tauri build script");
}

fn link_macos_host() {
    let manifest_dir = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let package = manifest_dir.join("../native/macos");
    let scratch = PathBuf::from(env::var_os("OUT_DIR").expect("out dir")).join("swift-host");
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("target architecture");
    let swift_triple = match target_arch.as_str() {
        "aarch64" => "arm64-apple-macosx14.0",
        "x86_64" => "x86_64-apple-macosx14.0",
        other => panic!("unsupported macOS target architecture: {other}"),
    };
    let status = Command::new("swift")
        .args(["build", "--package-path"])
        .arg(&package)
        .args(["--scratch-path"])
        .arg(&scratch)
        .args(["--configuration", "release", "--triple", swift_triple, "--product", "ZManagerMacOSHost"])
        .status()
        .expect("failed to run swift build for ZManagerMacOSHost");
    assert!(status.success(), "Swift host static library build failed");
    let library = find_file(&scratch, "libZManagerMacOSHost.a").expect("Swift host static library was not produced");
    println!("cargo:rustc-link-search=native={}", library.parent().unwrap().display());
    println!("cargo:rustc-link-lib=static=ZManagerMacOSHost");
    // hyper-util's macOS system-proxy support declares SystemConfiguration
    // symbols without emitting the framework link directive itself.
    println!("cargo:rustc-link-lib=framework=SystemConfiguration");
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    println!("cargo:rerun-if-changed={}", package.join("Package.swift").display());
    println!("cargo:rerun-if-changed={}", package.join("Sources/ZManagerMacOSHost").display());
}

fn find_file(root: &Path, name: &str) -> Option<PathBuf> {
    for entry in fs::read_dir(root).ok()? {
        let path = entry.ok()?.path();
        if path.file_name().and_then(|value| value.to_str()) == Some(name) {
            return Some(path);
        }
        if path.is_dir()
            && let Some(found) = find_file(&path, name)
        {
            return Some(found);
        }
    }
    None
}
