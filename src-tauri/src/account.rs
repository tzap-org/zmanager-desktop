use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use openssl::asn1::{Asn1Integer, Asn1Time};
use openssl::bn::{BigNum, MsbOption};
use openssl::hash::MessageDigest;
use openssl::nid::Nid;
use openssl::pkcs12::Pkcs12;
use openssl::pkey::PKey;
use openssl::x509::{X509, X509NameBuilder};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use zmanager_core::contact_snapshot::{CONTACT_SNAPSHOT_FORMAT_PLAIN, TOMBSTONE_RETENTION_SECONDS, TzapContactSnapshot, TzapContactTombstone};
use zmanager_core::device_identity::generate_recipient_encryption_key;
use zmanager_core::identity_catalog::{
    FileTzapIdentityCatalogStore, TzapIdentityCatalog, TzapIdentityCatalogStore, TzapPublicContactRecord, TzapPublicRecipientKeyRecord,
    TzapPublicSigningIdentityRecord, TzapSecretMaterialStore, TzapSecretPurpose, TzapSecretRef, TzapSecretStoreError,
};
use zmanager_tzap_hosted::auth_client::{
    AUTH_HANDOFF_LIFETIME_SECONDS, TzapCurrentUser, TzapHostedAuthCallback, TzapHostedAuthEnvironment, TzapHostedAuthLaunchConfig, TzapOAuthStateTracker,
    TzapPendingAuthState, TzapSessionRecord, TzapSessionStore, complete_hosted_auth_handoff,
};
use zmanager_tzap_hosted::backup_client::{TzapBackupClient, TzapBackupError};
use zmanager_tzap_hosted::intermediate_client::TzapOnlineIntermediateResolver;

use crate::error::{CommandErrorDto, ErrorSeverityDto};
use crate::secure_store::NativeTzapSecretStore;

const ACCOUNT_KEY: &str = "default";
const CLIENT_ID: &str = "zmanager-desktop";
const REDIRECT_URI: &str = "zmanager://auth-callback";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountSnapshotDto {
    pub auth_status: String,
    pub pending_state: Option<String>,
    pub default_signing_identity_id: Option<String>,
    pub capabilities: AccountCapabilitiesDto,
    pub certificates: Vec<AccountCertificateDto>,
    pub recipient_keys: Vec<AccountRecipientKeyDto>,
    pub contacts: Vec<AccountContactDto>,
    pub display_name: Option<String>,
    pub public_signer_id: Option<String>,
    pub assurance_level: Option<String>,
    pub session_expires_at_unix_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCapabilitiesDto {
    pub auth: String,
    pub enrollment: String,
    pub status: String,
    pub account_management: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCertificateDto {
    pub identity_id: String,
    pub certificate_id: String,
    pub certificate_sha256: String,
    pub label: Option<String>,
    pub state: String,
    pub assurance_level: String,
    pub not_after_unix_seconds: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountRecipientKeyDto {
    pub key_id: String,
    pub algorithm: String,
    pub public_key_fingerprint: String,
    pub created_at_unix_seconds: u64,
    pub label: Option<String>,
    pub lifecycle: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountContactDto {
    pub contact_id: String,
    pub display_name: String,
    pub signing_certificate_sha256: String,
    pub recipient_public_key_fingerprint: String,
    pub verification_state: String,
    pub missing_status_caveat: bool,
    pub phone_sourced: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountHostedAuthLaunchDto {
    pub launch_url: String,
    pub state: String,
    pub expires_at_unix_seconds: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountBeginHostedAuthRequest {
    pub environment: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountCompleteHostedAuthRequest {
    pub state: String,
    pub relay_body: String,
    pub callback_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCurrentUserDto {
    pub display_name: String,
    pub public_signer_id: Option<String>,
    pub assurance_level: String,
    pub selected_org_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountHostedAuthCallbackRequest {
    pub state: String,
    pub result: String,
    pub error_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountGenerateRecipientKeyRequest {
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountGenerateSigningIdentityRequest {
    pub common_name: String,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountImportSigningIdentityRequest {
    pub identity_path: String,
    pub password: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountInstallSigningCertificateRequest {
    pub identity_id: String,
    pub certificate_id: String,
    pub certificate_chain_der: Vec<Vec<u8>>,
    pub issuer_certificate_sha256: String,
    pub issuer_key_identifier: String,
    pub serial_number: String,
    pub not_before_unix_seconds: u64,
    pub not_after_unix_seconds: u64,
    pub public_signer_id: Option<String>,
    pub public_org_id: Option<String>,
    pub public_device_id: Option<String>,
    pub assurance_level: Option<String>,
    pub sign_device_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountIdRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountContactCardRequest {
    pub contact_card: Value,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountContactCardPreviewDto {
    pub display_name: String,
    pub signing_certificate_sha256: String,
    pub recipient_public_key_fingerprint: String,
    pub trust_source: String,
    pub verification_state: String,
    pub missing_status_caveat: bool,
}

struct AccountRuntimeState {
    pending: Option<TzapPendingAuthState>,
    auth_status: String,
    session: Option<TzapSessionRecord>,
    cached_user: Option<TzapCurrentUser>,
    environment: String,
}

#[derive(Clone)]
pub struct AccountRuntime(Arc<Mutex<AccountRuntimeState>>, Arc<Mutex<NativeTzapSecretStore>>);

impl AccountRuntime {
    pub fn new() -> Self {
        let store = NativeTzapSecretStore::new(ACCOUNT_KEY).expect("default account secure-store scope is valid");
        let session = store.load_session(ACCOUNT_KEY);
        let auth_status = if session.is_some() { "signedIn".to_string() } else { "signedOut".to_string() };
        Self(
            Arc::new(Mutex::new(AccountRuntimeState { pending: None, auth_status, session, cached_user: None, environment: "prod".to_string() })),
            Arc::new(Mutex::new(store)),
        )
    }
}

#[tauri::command]
pub fn account_snapshot(
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
    diagnostics: State<'_, crate::diagnostics::DiagnosticLog>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let start = std::time::Instant::now();
    let result = snapshot_at(&account_state_dir(&app)?, &runtime);
    let elapsed_ms = start.elapsed().as_millis() as u64;
    let _ = diagnostics.record("account", "snapshot_fetched", crate::diagnostics::fields([("elapsedMs", serde_json::json!(elapsed_ms))]));
    result
}

#[tauri::command]
pub fn account_begin_hosted_auth(
    request: AccountBeginHostedAuthRequest,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountHostedAuthLaunchDto, CommandErrorDto> {
    let now = current_unix_seconds();
    let mut tracker = TzapOAuthStateTracker::new();
    let pending = tracker.begin("hosted", REDIRECT_URI, now);
    let environment_str = request.environment.as_deref().unwrap_or("prod");
    let environment = match environment_str {
        "local" => TzapHostedAuthEnvironment::Local,
        "staging" => TzapHostedAuthEnvironment::Staging,
        _ => TzapHostedAuthEnvironment::Prod,
    };
    let config = TzapHostedAuthLaunchConfig::for_environment(environment, CLIENT_ID, REDIRECT_URI);
    let launch_url = config.launch_url(&pending).map_err(|error| account_error("account_auth_launch_failed", error))?;
    let response =
        AccountHostedAuthLaunchDto { launch_url, state: pending.state.clone(), expires_at_unix_seconds: now.saturating_add(AUTH_HANDOFF_LIFETIME_SECONDS) };
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.pending = Some(pending);
    state.auth_status = "pending".to_string();
    state.environment = environment_str.to_string();
    Ok(response)
}

#[tauri::command]
pub fn account_complete_hosted_auth(
    app: AppHandle,
    request: AccountCompleteHostedAuthRequest,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let now = current_unix_seconds();
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    let mut store = runtime.1.lock().expect("account store lock poisoned");

    let pending = state.pending.take().ok_or_else(|| CommandErrorDto::invalid_request("No hosted sign-in is pending"))?;

    if pending.state != request.state {
        return Err(CommandErrorDto::invalid_request("Hosted sign-in state did not match"));
    }

    let mut tracker = TzapOAuthStateTracker::new();
    tracker.insert_pending(pending.clone()).map_err(|e| account_error("account_auth_callback_failed", e))?;

    let callback = TzapHostedAuthCallback {
        state: request.state,
        redirect_uri: REDIRECT_URI.to_string(),
        pkce_verifier: pending.pkce.verifier.clone(),
        callback_url: request.callback_url,
        relay_body: request.relay_body.into_bytes(),
    };

    let session =
        complete_hosted_auth_handoff(&mut tracker, &mut *store, ACCOUNT_KEY, &callback, now).map_err(|e| account_error("account_auth_callback_failed", e))?;

    state.session = Some(session);
    state.auth_status = "signedIn".to_string();
    drop(store);
    drop(state);

    let root = account_state_dir(&app)?;
    let catalog = ensure_catalog(&root, &runtime)?;
    snapshot_from_catalog(&runtime, catalog)
}

#[tauri::command]
pub fn account_fetch_current_user(app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountCurrentUserDto, CommandErrorDto> {
    let (session, environment_str) = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        let session = state.session.clone().ok_or_else(|| CommandErrorDto::invalid_request("No active session"))?;
        let environment_str = state.environment.clone();
        (session, environment_str)
    };

    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|e| account_error("account_http_client_failed", e))?;

    let environment = match environment_str.as_str() {
        "local" => TzapHostedAuthEnvironment::Local,
        "staging" => TzapHostedAuthEnvironment::Staging,
        _ => TzapHostedAuthEnvironment::Prod,
    };
    let config = TzapHostedAuthLaunchConfig::for_environment(environment, CLIENT_ID, REDIRECT_URI);

    let user_result = zmanager_tzap_hosted::auth_client::fetch_current_user(&transport, &config.hosted_account_base_url, &session);

    match user_result {
        Ok(user) => {
            {
                let mut state = runtime.0.lock().expect("account runtime lock poisoned");
                state.cached_user = Some(user.clone());
            }
            if let Ok(root) = account_state_dir(&app) {
                let _ = sync_contact_snapshot(&root, &runtime);
            }
            Ok(AccountCurrentUserDto {
                display_name: user.display_name,
                public_signer_id: user.public_signer_id,
                assurance_level: user.assurance_level.as_str().to_string(),
                selected_org_id: user.selected_org_id,
            })
        }
        Err(e) => {
            if matches!(e, zmanager_tzap_hosted::auth_client::TzapAuthError::HttpStatus { status_code: 401 }) {
                {
                    let mut store = runtime.1.lock().expect("account store lock poisoned");
                    let _ = store.clear_session(ACCOUNT_KEY);
                }
                let mut state = runtime.0.lock().expect("account runtime lock poisoned");
                state.session = None;
                state.auth_status = "expired".to_string();
                Err(CommandErrorDto::unauthorized(format!("Session expired: {}", e)))
            } else {
                Err(account_error("account_fetch_user_failed", e))
            }
        }
    }
}

#[tauri::command]
pub fn account_apply_hosted_callback(request: AccountHostedAuthCallbackRequest, runtime: State<'_, AccountRuntime>) -> Result<(), CommandErrorDto> {
    validate_callback(&request)?;
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    let Some(pending) = state.pending.as_ref() else {
        return Err(CommandErrorDto::invalid_request("No hosted sign-in is pending"));
    };
    if pending.state != request.state {
        return Err(CommandErrorDto::invalid_request("Hosted sign-in state did not match"));
    }
    state.pending = None;
    state.auth_status = match request.result.as_str() {
        "completed" => "launchOnlyCallbackCompleted",
        "cancelled" => "cancelled",
        "failed" => "failed",
        _ => unreachable!(),
    }
    .to_string();
    Ok(())
}

#[tauri::command]
pub fn account_forget(app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    // Forgetting the hosted-account association must not discard local signing
    // or recipient material. Destructive secret wiping is a separate action.
    let catalog = ensure_catalog(&root, &runtime)?;
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.pending = None;
    state.auth_status = "signedOut".to_string();
    drop(state);
    snapshot_from_catalog(&runtime, catalog)
}

#[tauri::command]
pub fn account_generate_recipient_key(
    request: AccountGenerateRecipientKeyRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let material = generate_recipient_encryption_key().map_err(|error| account_error("account_key_generation_failed", error))?;
    let now = current_unix_seconds();
    let private_key_ref = with_secret_store(&runtime, |secret_store| secret_store.put(TzapSecretPurpose::RecipientKey, material.private_key_der))
        .map_err(|error| account_error("account_secure_store_failed", error))?;
    let key_id = format!("recipient_{}", TzapSecretRef::generate().as_str());
    for existing in catalog.recipient_keys.iter_mut() {
        if existing.lifecycle == "active" {
            existing.lifecycle = "retired".to_owned();
            existing.retired_at_unix_seconds = Some(now);
        }
    }
    catalog.recipient_keys.push(TzapPublicRecipientKeyRecord {
        id: key_id,
        local_label: request.label.filter(|label| !label.trim().is_empty()),
        algorithm: material.algorithm.to_string(),
        public_key_der: material.public_key_spki_der,
        fingerprint: material.public_key_fingerprint,
        private_key_ref: private_key_ref.clone(),
        lifecycle: "active".to_owned(),
        created_at_unix_seconds: now,
        retired_at_unix_seconds: None,
    });
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    if let Err(error) = catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog) {
        let _ = with_secret_store(&runtime, |secret_store| secret_store.delete(TzapSecretPurpose::RecipientKey, &private_key_ref));
        return Err(account_error("account_catalog_save_failed", error));
    }
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_generate_signing_identity(
    request: AccountGenerateSigningIdentityRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
    diagnostics: State<'_, crate::diagnostics::DiagnosticLog>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let common_name = request.common_name.trim();
    if common_name.is_empty() || common_name.len() > 128 {
        return Err(CommandErrorDto::invalid_request("commonName must be between 1 and 128 characters"));
    }
    let _ = diagnostics.record(
        "account",
        "signing_identity_generation_started",
        crate::diagnostics::fields([("commonNameLength", serde_json::json!(common_name.len()))]),
    );
    let material = zmanager_core::device_identity::generate_device_signing_key_and_csr(&zmanager_core::device_identity::TzapDeviceCsrOptions {
        common_name: common_name.to_owned(),
    })
    .map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let private_key = PKey::private_key_from_der(material.private_key_der.expose_secret())
        .map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let mut name = X509NameBuilder::new().map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    name.append_entry_by_text("CN", common_name).map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let name = name.build();
    let mut serial = BigNum::new().map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    serial.rand(128, MsbOption::MAYBE_ZERO, false).map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let serial = Asn1Integer::from_bn(&serial).map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let mut certificate = X509::builder().map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    certificate
        .set_version(2)
        .and_then(|_| certificate.set_serial_number(&serial))
        .and_then(|_| certificate.set_subject_name(&name))
        .and_then(|_| certificate.set_issuer_name(&name))
        .and_then(|_| certificate.set_pubkey(&private_key))
        .and_then(|_| {
            let not_before = Asn1Time::days_from_now(0)?;
            certificate.set_not_before(not_before.as_ref())
        })
        .and_then(|_| {
            let not_after = Asn1Time::days_from_now(3650)?;
            certificate.set_not_after(not_after.as_ref())
        })
        .and_then(|_| certificate.sign(&private_key, MessageDigest::sha256()))
        .map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let certificate = certificate.build();
    let certificate_der = certificate.to_der().map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let certificate_digest = certificate.digest(MessageDigest::sha256()).map_err(|error| account_error("account_signing_identity_generation_failed", error))?;
    let certificate_sha256 = format!("sha256:{}", hex_bytes(certificate_digest.as_ref()));
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let now = current_unix_seconds();
    let signing_key_ref = with_secret_store(&runtime, |secret_store| secret_store.put(TzapSecretPurpose::SigningKey, material.private_key_der))
        .map_err(|error| account_error("account_secure_store_failed", error))?;
    let _ = diagnostics.record("account", "signing_identity_secret_stored", crate::diagnostics::fields([]));
    let identity_id = format!("signing_{}", TzapSecretRef::generate().as_str());
    catalog.signing_identities.push(TzapPublicSigningIdentityRecord {
        id: identity_id.clone(),
        local_alias: request.label.filter(|label| !label.trim().is_empty()),
        certificate_id: Some(certificate_sha256.clone()),
        certificate_sha256: Some(certificate_sha256),
        issuer_certificate_sha256: None,
        issuer_key_identifier: None,
        serial_number: None,
        certificate_chain_der: vec![certificate_der],
        not_before_unix_seconds: Some(now),
        not_after_unix_seconds: Some(now.saturating_add(3650 * 24 * 60 * 60)),
        renewal_grace_period_days: None,
        renewal_recommended_within_days: None,
        public_signer_id: None,
        public_org_id: None,
        public_device_id: None,
        assurance_level: Some("local_self_signed".to_owned()),
        sign_device_id: None,
        sign_device_routing: None,
        signing_key_created_at_unix_seconds: Some(now),
        legacy_key_id: None,
        metadata_version: None,
        policy_oid: None,
        signing_key_ref: signing_key_ref.clone(),
        lifecycle: "active".to_owned(),
    });
    if catalog.default_signing_identity_id.is_none() {
        catalog.default_signing_identity_id = Some(identity_id);
    }
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    if let Err(error) = catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog) {
        let _ = with_secret_store(&runtime, |secret_store| secret_store.delete(TzapSecretPurpose::SigningKey, &signing_key_ref));
        return Err(account_error("account_catalog_save_failed", error));
    }
    let _ = diagnostics.record("account", "signing_identity_generation_completed", crate::diagnostics::fields([]));

    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_import_signing_identity(
    request: AccountImportSigningIdentityRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let identity_path = request.identity_path.trim();
    if identity_path.is_empty() {
        return Err(CommandErrorDto::invalid_request("identityPath must not be empty"));
    }
    let identity_bytes = std::fs::read(identity_path)
        .map_err(|error| account_error("account_signing_identity_import_failed", format!("unable to read {identity_path}: {error}")))?;
    let identity = Pkcs12::from_der(&identity_bytes).map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    let parsed =
        identity.parse2(request.password.as_deref().unwrap_or_default()).map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    let private_key = parsed.pkey.ok_or_else(|| account_error("account_signing_identity_import_failed", "P12/PFX bundle does not contain a private key"))?;
    let certificate =
        parsed.cert.ok_or_else(|| account_error("account_signing_identity_import_failed", "P12/PFX bundle does not contain a signing certificate"))?;
    let now_asn1 = Asn1Time::days_from_now(0).map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    if certificate.not_before() > now_asn1.as_ref() || certificate.not_after() < now_asn1.as_ref() {
        return Err(account_error("account_signing_identity_import_failed", "P12/PFX signing certificate is outside its validity period"));
    }
    let certificate_key = certificate.public_key().map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    if !private_key.public_eq(&certificate_key) {
        return Err(account_error("account_signing_identity_import_failed", "P12/PFX private key does not match its signing certificate"));
    }
    let certificate_der = certificate.to_der().map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    let certificate_digest = certificate.digest(MessageDigest::sha256()).map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    let mut certificate_chain_der = vec![certificate_der];
    if let Some(chain) = parsed.ca {
        for certificate in chain.iter() {
            certificate_chain_der.push(certificate.to_der().map_err(|error| account_error("account_signing_identity_import_failed", error))?);
        }
    }
    let default_label = certificate
        .subject_name()
        .entries_by_nid(Nid::COMMONNAME)
        .next()
        .and_then(|entry| entry.data().to_string().ok())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Imported signing identity".to_owned());
    let private_key_der = private_key.private_key_to_der().map_err(|error| account_error("account_signing_identity_import_failed", error))?;
    let certificate_sha256 = format!("sha256:{}", hex_bytes(certificate_digest.as_ref()));
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let now = current_unix_seconds();
    let signing_key_ref = with_secret_store(&runtime, |secret_store| secret_store.put(TzapSecretPurpose::SigningKey, private_key_der.into()))
        .map_err(|error| account_error("account_secure_store_failed", error))?;
    let identity_id = format!("signing_{}", TzapSecretRef::generate().as_str());
    catalog.signing_identities.push(TzapPublicSigningIdentityRecord {
        id: identity_id.clone(),
        local_alias: request.label.filter(|label| !label.trim().is_empty()).or(Some(default_label)),
        certificate_id: Some(certificate_sha256.clone()),
        certificate_sha256: Some(certificate_sha256),
        issuer_certificate_sha256: None,
        issuer_key_identifier: None,
        serial_number: None,
        certificate_chain_der,
        not_before_unix_seconds: None,
        not_after_unix_seconds: None,
        renewal_grace_period_days: None,
        renewal_recommended_within_days: None,
        public_signer_id: None,
        public_org_id: None,
        public_device_id: None,
        assurance_level: Some("imported_p12".to_owned()),
        sign_device_id: None,
        sign_device_routing: None,
        signing_key_created_at_unix_seconds: Some(now),
        legacy_key_id: None,
        metadata_version: None,
        policy_oid: None,
        signing_key_ref: signing_key_ref.clone(),
        lifecycle: "active".to_owned(),
    });
    if catalog.default_signing_identity_id.is_none() {
        catalog.default_signing_identity_id = Some(identity_id);
    }
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    if let Err(error) = catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog) {
        let _ = with_secret_store(&runtime, |secret_store| secret_store.delete(TzapSecretPurpose::SigningKey, &signing_key_ref));
        return Err(account_error("account_catalog_save_failed", error));
    }
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_install_signing_certificate(
    request: AccountInstallSigningCertificateRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    if request.identity_id.trim().is_empty()
        || request.certificate_id.trim().is_empty()
        || request.certificate_chain_der.is_empty()
        || request.not_before_unix_seconds >= request.not_after_unix_seconds
    {
        return Err(CommandErrorDto::invalid_request("certificate identity, chain, and validity are required"));
    }
    let leaf = X509::from_der(&request.certificate_chain_der[0]).map_err(|error| account_error("account_signing_certificate_install_failed", error))?;
    for certificate_der in request.certificate_chain_der.iter().skip(1) {
        X509::from_der(certificate_der).map_err(|error| account_error("account_signing_certificate_install_failed", error))?;
    }
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let identity_index = catalog
        .signing_identities
        .iter()
        .position(|identity| identity.id == request.identity_id)
        .ok_or_else(|| account_error("account_signing_identity_not_found", "Signing identity was not found"))?;
    let signing_key_ref = catalog.signing_identities[identity_index].signing_key_ref.clone();
    let private_key_der = with_secret_store(&runtime, |secret_store| secret_store.resolve(TzapSecretPurpose::SigningKey, &signing_key_ref))
        .map_err(|error| account_error("account_secure_store_failed", error))?;
    let private_key =
        PKey::private_key_from_der(private_key_der.expose_secret()).map_err(|error| account_error("account_signing_certificate_install_failed", error))?;
    let certificate_key = leaf.public_key().map_err(|error| account_error("account_signing_certificate_install_failed", error))?;
    if !private_key.public_eq(&certificate_key) {
        return Err(account_error("account_signing_certificate_install_failed", "Downloaded certificate does not match the identity private key"));
    }
    let certificate_sha256 = leaf.digest(MessageDigest::sha256()).map_err(|error| account_error("account_signing_certificate_install_failed", error))?;
    let identity = &mut catalog.signing_identities[identity_index];
    identity.certificate_id = Some(request.certificate_id);
    identity.certificate_sha256 = Some(format!("sha256:{}", hex_bytes(certificate_sha256.as_ref())));
    identity.issuer_certificate_sha256 = Some(request.issuer_certificate_sha256);
    identity.issuer_key_identifier = Some(request.issuer_key_identifier);
    identity.serial_number = Some(request.serial_number);
    identity.certificate_chain_der = request.certificate_chain_der;
    identity.not_before_unix_seconds = Some(request.not_before_unix_seconds);
    identity.not_after_unix_seconds = Some(request.not_after_unix_seconds);
    identity.public_signer_id = request.public_signer_id;
    identity.public_org_id = request.public_org_id;
    identity.public_device_id = request.public_device_id;
    identity.assurance_level = request.assurance_level.or(Some("enrolled".to_owned()));
    identity.sign_device_id = request.sign_device_id;
    identity.lifecycle = "active".to_owned();
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_remove_signing_identity(
    request: AccountIdRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let identity_index = catalog
        .signing_identities
        .iter()
        .position(|identity| identity.id == request.id)
        .ok_or_else(|| account_error("account_signing_identity_not_found", "Signing identity was not found"))?;
    let identity = catalog.signing_identities.remove(identity_index);
    if catalog.default_signing_identity_id.as_deref() == Some(request.id.as_str()) {
        catalog.default_signing_identity_id = None;
    }
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;

    let _ = with_secret_store(&runtime, |secret_store| secret_store.delete(TzapSecretPurpose::SigningKey, &identity.signing_key_ref));

    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_remove_recipient_key(
    request: AccountIdRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    if let Some(pos) = catalog.recipient_keys.iter().position(|key| key.id == request.id) {
        if catalog.recipient_keys[pos].lifecycle == "retired" {
            let private_key_ref = catalog.recipient_keys[pos].private_key_ref.clone();
            let _ = with_secret_store(&runtime, |secret_store| secret_store.delete(TzapSecretPurpose::RecipientKey, &private_key_ref));
            catalog.recipient_keys.remove(pos);
        } else {
            catalog.recipient_keys[pos].lifecycle = "retired".to_owned();
            catalog.recipient_keys[pos].retired_at_unix_seconds = Some(current_unix_seconds());
        }
        let expected_revision = catalog.revision;
        catalog.revision = catalog.revision.saturating_add(1);
        catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;
    }
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_set_default_signing_identity(
    request: AccountIdRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let identity = catalog
        .signing_identities
        .iter()
        .find(|identity| identity.id == request.id && identity.lifecycle == "active")
        .ok_or_else(|| account_error("account_signing_identity_unavailable", "Only an active signing identity can be selected as the default"))?;
    catalog.default_signing_identity_id = Some(identity.id.clone());
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_remove_contact(request: AccountIdRequest, app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let now = current_unix_seconds();
    catalog.contacts.retain(|contact| contact.contact_id != request.id);
    catalog.removed_contacts.retain(|tombstone| tombstone.contact_id != request.id);
    catalog.removed_contacts.push(TzapContactTombstone { contact_id: request.id, removed_at: now });
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_inspect_contact_card(request: AccountContactCardRequest) -> Result<AccountContactCardPreviewDto, CommandErrorDto> {
    let verified = verify_contact_card(&request.contact_card).map_err(|error| account_error("account_contact_card_invalid", error))?;
    Ok(contact_card_preview(&verified))
}

#[tauri::command]
pub fn account_accept_contact_card(
    request: AccountContactCardRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let verified = verify_contact_card(&request.contact_card).map_err(|error| account_error("account_contact_card_invalid", error))?;
    let recipient_public_key_der = verified
        .payload
        .get("recipient_public_key")
        .and_then(Value::as_str)
        .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
        .ok_or_else(|| account_error("account_contact_card_invalid", "Contact card recipient public key is invalid"))?;
    let root = account_state_dir(&app)?;
    let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
    let mut catalog = ensure_catalog(&root, &runtime)?;
    let contact_id = verified.recipient_public_key_fingerprint.clone();
    catalog.contacts.retain(|contact| contact.contact_id != contact_id);
    catalog.contacts.push(TzapPublicContactRecord {
        contact_id,
        display_name: verified.display_name,
        signing_certificate_sha256: verified.signing_certificate_sha256,
        recipient_public_key_fingerprint: verified.recipient_public_key_fingerprint,
        recipient_public_key_der,
        trust_source: verified.trust_anchor_type.as_str().to_owned(),
        verification_state: verified.verification_state.as_str().to_owned(),
        missing_status_caveat: verified.missing_status_caveat,
        contact_card_payload: verified.payload,
        accepted_at_unix_seconds: current_unix_seconds(),
        local_alias: None,
        card: Some(request.contact_card),
    });
    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;
    snapshot_at(&root, &runtime)
}

#[tauri::command]
pub fn account_sync_contacts(app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    sync_contact_snapshot(&root, &runtime)?;
    snapshot_at(&root, &runtime)
}

pub fn sync_contact_snapshot(root: &Path, runtime: &AccountRuntime) -> Result<(), CommandErrorDto> {
    let (session, environment_str) = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        let Some(session) = state.session.clone() else {
            return Ok(());
        };
        let environment_str = state.environment.clone();
        (session, environment_str)
    };

    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|e| account_error("account_http_client_failed", e))?;

    let environment = match environment_str.as_str() {
        "local" => TzapHostedAuthEnvironment::Local,
        "staging" => TzapHostedAuthEnvironment::Staging,
        _ => TzapHostedAuthEnvironment::Prod,
    };
    let config = TzapHostedAuthLaunchConfig::for_environment(environment, CLIENT_ID, REDIRECT_URI);
    let backup_client = TzapBackupClient::new(&config.hosted_account_base_url, &transport);

    let backup_record = match backup_client.fetch_contact_backup(&session) {
        Ok(record) => record,
        Err(TzapBackupError::NotFound) => {
            let mut catalog_store = FileTzapIdentityCatalogStore::new(root);
            let mut catalog = ensure_catalog(root, runtime)?;
            let had_phone_contacts = catalog.contacts.iter().any(|c| c.trust_source == "phone_sync");
            if had_phone_contacts {
                catalog.contacts.retain(|c| c.trust_source != "phone_sync");
                let expected_revision = catalog.revision;
                catalog.revision = catalog.revision.saturating_add(1);
                catalog_store
                    .save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog)
                    .map_err(|error| account_error("account_catalog_save_failed", error))?;
            }
            return Ok(());
        }
        Err(TzapBackupError::Auth(zmanager_tzap_hosted::auth_client::TzapAuthError::HttpStatus { status_code: 401 })) => {
            return Ok(());
        }
        Err(e) => {
            return Err(account_error("account_contact_sync_failed", e));
        }
    };

    let snapshot: TzapContactSnapshot = serde_json::from_value(backup_record.payload).map_err(|e| account_error("account_contact_snapshot_invalid", e))?;
    if snapshot.format != CONTACT_SNAPSHOT_FORMAT_PLAIN {
        return Err(account_error("account_contact_snapshot_invalid", format!("Unsupported snapshot format: {}", snapshot.format)));
    }

    let now = current_unix_seconds();
    let mut catalog_store = FileTzapIdentityCatalogStore::new(root);
    let mut catalog = ensure_catalog(root, runtime)?;

    let intermediate_cache = zmanager_core::trust::TzapIntermediateCache::new(root.join("intermediates"));
    let intermediate_resolver = TzapOnlineIntermediateResolver::with_reqwest(intermediate_cache, Some(config.hosted_account_base_url.clone()));
    apply_contact_snapshot_to_catalog(&mut catalog, &snapshot, now, Some(&intermediate_resolver));

    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;

    Ok(())
}

fn apply_contact_snapshot_to_catalog(
    catalog: &mut TzapIdentityCatalog,
    snapshot: &zmanager_core::contact_snapshot::TzapContactSnapshot,
    now: u64,
    intermediate_resolver: Option<&dyn zmanager_core::trust::TzapIntermediateResolver>,
) {
    // 1. Merge and prune tombstones (365 days retention)
    let mut tombstone_map = std::collections::BTreeMap::<String, u64>::new();
    for t in catalog.removed_contacts.iter().chain(snapshot.removed.iter()) {
        if now.saturating_sub(t.removed_at) <= TOMBSTONE_RETENTION_SECONDS {
            tombstone_map.entry(t.contact_id.clone()).and_modify(|existing| *existing = (*existing).max(t.removed_at)).or_insert(t.removed_at);
        }
    }
    catalog.removed_contacts = tombstone_map.iter().map(|(id, &removed_at)| TzapContactTombstone { contact_id: id.clone(), removed_at }).collect();

    // Remove any local contact whose accepted_at <= removed_at
    catalog.contacts.retain(|c| if let Some(&removed_at) = tombstone_map.get(&c.contact_id) { c.accepted_at_unix_seconds > removed_at } else { true });

    // 2. Process snapshot contacts: re-verify and merge
    let options = zmanager_core::contact_card::TzapContactCardImportOptions {
        verifier_time_unix_seconds: i64::try_from(now).unwrap_or(i64::MAX),
        official_root_pins: &zmanager_core::trust::OFFICIAL_TZAP_ROOT_PINS,
        official_root_certificates_der: Vec::new(),
        custom_trust_root_sha256: Vec::new(),
        custom_trust_root_certificates_der: Vec::new(),
        certificate_profile_options: zmanager_core::trust::TzapCertificateProfileOptions::default(),
        intermediate_resolver,
    };

    let mut incoming_ids = std::collections::HashSet::new();
    for entry in &snapshot.contacts {
        let contact_id = match entry.resolved_contact_id() {
            Ok(id) => id,
            Err(_) => continue,
        };
        incoming_ids.insert(contact_id.clone());

        if tombstone_map.get(&contact_id).is_some_and(|&removed_at| removed_at >= entry.accepted_at) {
            continue;
        }

        let Ok(verified) = zmanager_core::contact_card::verify_tzap_contact_card(&entry.card, &options) else {
            continue;
        };
        let recipient_public_key_der =
            match verified.payload.get("recipient_public_key").and_then(Value::as_str).and_then(|value| URL_SAFE_NO_PAD.decode(value).ok()) {
                Some(der) => der,
                None => continue,
            };

        let record = TzapPublicContactRecord {
            contact_id: contact_id.clone(),
            display_name: verified.display_name,
            signing_certificate_sha256: verified.signing_certificate_sha256,
            recipient_public_key_fingerprint: verified.recipient_public_key_fingerprint,
            recipient_public_key_der,
            trust_source: "phone_sync".to_owned(),
            verification_state: verified.verification_state.as_str().to_owned(),
            missing_status_caveat: verified.missing_status_caveat,
            contact_card_payload: verified.payload,
            accepted_at_unix_seconds: entry.accepted_at,
            local_alias: entry.local_alias.clone(),
            card: Some(entry.card.clone()),
        };

        catalog.contacts.retain(|c| c.contact_id != contact_id);
        catalog.contacts.push(record);
    }

    // 3. Previously-synced phone contacts that disappeared from the snapshot are removed
    catalog.contacts.retain(|c| if c.trust_source == "phone_sync" { incoming_ids.contains(&c.contact_id) } else { true });
}

#[derive(Debug)]
pub struct ResolvedTzapCreateInputs {
    pub recipient_public_keys: Option<Vec<Vec<u8>>>,
    pub one_time_recipient_certificate_paths: Option<Vec<PathBuf>>,
    pub signing: Option<zmanager_core::engine::TzapX509SigningOptions>,
    pub signing_selection_provided: bool,
    pub recipient_selection_provided: bool,
}

/// Resolves persistent Create selections at job handoff. The returned value
/// contains only the public recipient keys and the short-lived signer needed
/// by `zmanager-core`; it is never placed in a React snapshot.
pub fn resolve_tzap_create_inputs(
    app: &AppHandle,
    runtime: &AccountRuntime,
    options: Option<&crate::dto::TzapCertificateOptionsDto>,
) -> Result<ResolvedTzapCreateInputs, CommandErrorDto> {
    let Some(options) = options else {
        return Ok(ResolvedTzapCreateInputs {
            recipient_public_keys: None,
            one_time_recipient_certificate_paths: None,
            signing: None,
            signing_selection_provided: false,
            recipient_selection_provided: false,
        });
    };
    let root = account_state_dir(app)?;
    let catalog = ensure_catalog(&root, runtime)?;
    let secret_store = runtime.1.lock().expect("account secure-store lock poisoned");

    let has_recipient_selection = options.recipient_selection.as_ref().is_some_and(|selection| {
        !selection.recipient_key_ids.is_empty() || !selection.contact_recipient_ids.is_empty() || !selection.one_time_certificate_paths.is_empty()
    });
    let (recipient_public_keys, one_time_recipient_certificate_paths) = if has_recipient_selection {
        let selection = options.recipient_selection.as_ref().expect("selection presence was checked above");
        let mut public_keys = Vec::new();
        for id in &selection.recipient_key_ids {
            let key = catalog
                .recipient_keys
                .iter()
                .find(|key| &key.id == id)
                .ok_or_else(|| account_error("account_recipient_not_found", "Recipient key was not found"))?;
            if key.lifecycle != "active" {
                return Err(account_error("account_recipient_unavailable", "Retired recipient keys cannot be selected for new archives"));
            }
            public_keys.push(key.public_key_der.clone());
        }
        for id in &selection.contact_recipient_ids {
            let contact = catalog
                .contacts
                .iter()
                .find(|contact| &contact.contact_id == id)
                .ok_or_else(|| account_error("account_contact_not_found", "Trusted contact was not found"))?;
            if !matches!(contact.verification_state.as_str(), "valid_now" | "valid_at_trusted_time" | "cryptographically_intact_offline") {
                return Err(account_error("account_contact_unavailable", "Only verified trusted contacts can receive new archives"));
            }
            let verified = verify_contact_card(&contact.contact_card_payload)
                .map_err(|error| account_error("account_contact_unavailable", format!("Trusted contact verification failed: {error}")))?;
            let verified_recipient_public_key_der = verified
                .payload
                .get("recipient_public_key")
                .and_then(Value::as_str)
                .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
                .ok_or_else(|| account_error("account_contact_unavailable", "Trusted contact recipient key is invalid"))?;
            if !matches!(verified.verification_state.as_str(), "valid_now" | "valid_at_trusted_time" | "cryptographically_intact_offline")
                || verified.recipient_public_key_fingerprint != contact.recipient_public_key_fingerprint
                || verified_recipient_public_key_der != contact.recipient_public_key_der
                || verified.signing_certificate_sha256 != contact.signing_certificate_sha256
                || verified.payload != contact.contact_card_payload
            {
                return Err(account_error("account_contact_unavailable", "Trusted contact metadata no longer matches its signed contact card"));
            }
            public_keys.push(contact.recipient_public_key_der.clone());
        }
        let one_time = selection.one_time_certificate_paths.iter().map(PathBuf::from).collect::<Vec<_>>();
        (Some(public_keys), Some(one_time))
    } else {
        (None, None)
    };

    let (signing, signing_selection_provided) = match &options.signing_selection {
        None => (None, false),
        Some(crate::dto::TzapSigningSelectionDto::None) => (None, true),
        Some(crate::dto::TzapSigningSelectionDto::EnrolledIdentity { signing_identity_id }) => {
            let identity = catalog
                .signing_identities
                .iter()
                .find(|identity| &identity.id == signing_identity_id)
                .ok_or_else(|| account_error("account_signing_identity_not_found", "Signing identity was not found"))?;
            if identity.lifecycle != "active" || identity.not_after_unix_seconds.is_some_and(|expires| expires <= current_unix_seconds()) {
                return Err(account_error("account_signing_identity_unavailable", "Signing identity is not currently usable"));
            }
            let Some(leaf) = identity.certificate_chain_der.first().cloned() else {
                return Err(account_error("account_signing_identity_invalid", "Signing identity certificate chain is incomplete"));
            };
            let private_key = secret_store
                .resolve(TzapSecretPurpose::SigningKey, &identity.signing_key_ref)
                .map_err(|error| account_error("account_secure_store_failed", error))?;
            (
                Some(zmanager_core::engine::TzapX509SigningOptions::InMemory {
                    signing_certificate: leaf,
                    signing_private_key: private_key,
                    signing_chain: identity.certificate_chain_der.iter().skip(1).cloned().collect(),
                }),
                true,
            )
        }
        Some(crate::dto::TzapSigningSelectionDto::OneTimePkcs12 { path, password }) => (
            Some(zmanager_core::engine::TzapX509SigningOptions::Pkcs12 {
                identity: PathBuf::from(path),
                password: zmanager_core::secrets::SecretString::from(password.as_str()),
            }),
            true,
        ),
        Some(crate::dto::TzapSigningSelectionDto::OneTimeCertificateAndKey { certificate_path, private_key_path, chain_paths, password }) => {
            if certificate_path.trim().is_empty() || private_key_path.trim().is_empty() {
                return Err(account_error("account_signing_identity_invalid", "TZAP signing requires both a certificate and a matching private key"));
            }
            if password.as_ref().is_some_and(|value| !value.is_empty()) {
                return Err(account_error("account_signing_password_unsupported", "Encrypted one-time private-key files are not supported by this handoff"));
            }
            (
                Some(zmanager_core::engine::TzapX509SigningOptions::CertificateAndKey {
                    signing_certificate: PathBuf::from(certificate_path),
                    signing_private_key: PathBuf::from(private_key_path),
                    signing_chain: chain_paths.iter().map(PathBuf::from).collect(),
                }),
                true,
            )
        }
    };

    Ok(ResolvedTzapCreateInputs {
        recipient_public_keys,
        one_time_recipient_certificate_paths,
        signing,
        signing_selection_provided,
        recipient_selection_provided: has_recipient_selection,
    })
}

/// Resolves a local recipient key immediately before extraction. The returned
/// bytes are operation-scoped and never enter a snapshot or a temporary file.
pub fn resolve_tzap_recipient_private_key(
    app: &AppHandle,
    runtime: &AccountRuntime,
    key_id: &str,
) -> Result<zmanager_core::secrets::SecretBytes, CommandErrorDto> {
    let root = account_state_dir(app)?;
    let catalog = ensure_catalog(&root, runtime)?;
    let key = catalog
        .recipient_keys
        .iter()
        .find(|key| key.id == key_id && matches!(key.lifecycle.as_str(), "active" | "retired"))
        .ok_or_else(|| account_error("account_recipient_not_found", "Recipient key was not found"))?;
    let secret_store = runtime.1.lock().expect("account secure-store lock poisoned");
    secret_store.resolve(TzapSecretPurpose::RecipientKey, &key.private_key_ref).map_err(|error| account_error("account_secure_store_failed", error))
}

fn account_state_dir(app: &AppHandle) -> Result<PathBuf, CommandErrorDto> {
    app.path().app_data_dir().map(|path| path.join("tzap-state")).map_err(|error| account_error("account_state_path_failed", error))
}

fn verify_contact_card(card: &Value) -> Result<zmanager_core::contact_card::TzapVerifiedContactCard, zmanager_core::contact_card::TzapContactCardError> {
    let options = zmanager_core::contact_card::TzapContactCardImportOptions {
        verifier_time_unix_seconds: i64::try_from(current_unix_seconds()).unwrap_or(i64::MAX),
        official_root_pins: &zmanager_core::trust::OFFICIAL_TZAP_ROOT_PINS,
        official_root_certificates_der: Vec::new(),
        custom_trust_root_sha256: Vec::new(),
        custom_trust_root_certificates_der: Vec::new(),
        certificate_profile_options: zmanager_core::trust::TzapCertificateProfileOptions::default(),
        intermediate_resolver: None,
    };
    zmanager_core::contact_card::verify_tzap_contact_card(card, &options)
}

fn contact_card_preview(verified: &zmanager_core::contact_card::TzapVerifiedContactCard) -> AccountContactCardPreviewDto {
    AccountContactCardPreviewDto {
        display_name: verified.display_name.clone(),
        signing_certificate_sha256: verified.signing_certificate_sha256.clone(),
        recipient_public_key_fingerprint: verified.recipient_public_key_fingerprint.clone(),
        trust_source: verified.trust_anchor_type.as_str().to_owned(),
        verification_state: verified.verification_state.as_str().to_owned(),
        missing_status_caveat: verified.missing_status_caveat,
    }
}

fn snapshot_at(root: &Path, runtime: &AccountRuntime) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let catalog = ensure_catalog(root, runtime)?;
    snapshot_from_catalog(runtime, catalog)
}

fn with_secret_store<T>(
    runtime: &AccountRuntime,
    operation: impl FnOnce(&mut NativeTzapSecretStore) -> Result<T, TzapSecretStoreError>,
) -> Result<T, TzapSecretStoreError> {
    let mut secret_store = runtime.1.lock().expect("account secure-store lock poisoned");
    operation(&mut secret_store)
}

fn snapshot_from_catalog(runtime: &AccountRuntime, catalog: TzapIdentityCatalog) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let state = runtime.0.lock().expect("account runtime lock poisoned");
    let (auth_cap, enroll_cap, status_cap) =
        if state.session.is_some() { ("handoff_exchange", "available", "online") } else { ("launch_only", "unavailable", "offline_cache_only") };

    let assurance_level = state.session.as_ref().map(|s| s.identity_assurance.as_str().to_owned());
    let session_expires_at_unix_seconds = state.session.as_ref().map(|s| s.expires_at_unix_seconds);
    let display_name = state.cached_user.as_ref().map(|u| u.display_name.clone());
    let public_signer_id = state.cached_user.as_ref().and_then(|u| u.public_signer_id.clone());

    Ok(AccountSnapshotDto {
        auth_status: state.auth_status.clone(),
        pending_state: state.pending.as_ref().map(|pending| pending.state.clone()),
        default_signing_identity_id: catalog.default_signing_identity_id.clone(),
        capabilities: AccountCapabilitiesDto {
            auth: auth_cap.to_owned(),
            enrollment: enroll_cap.to_owned(),
            status: status_cap.to_owned(),
            account_management: "external_browser".to_owned(),
        },
        display_name,
        public_signer_id,
        assurance_level,
        session_expires_at_unix_seconds,
        certificates: catalog
            .signing_identities
            .into_iter()
            .filter_map(|identity| {
                Some(AccountCertificateDto {
                    identity_id: identity.id,
                    certificate_id: identity.certificate_id?,
                    certificate_sha256: identity.certificate_sha256?,
                    label: identity.local_alias,
                    state: identity.lifecycle,
                    assurance_level: identity.assurance_level.unwrap_or_else(|| "unknown".to_owned()),
                    not_after_unix_seconds: identity.not_after_unix_seconds.unwrap_or_default(),
                })
            })
            .collect(),
        recipient_keys: catalog
            .recipient_keys
            .into_iter()
            .map(|key| AccountRecipientKeyDto {
                key_id: key.id,
                algorithm: key.algorithm,
                public_key_fingerprint: key.fingerprint,
                created_at_unix_seconds: key.created_at_unix_seconds,
                label: key.local_label,
                lifecycle: key.lifecycle,
            })
            .collect(),
        contacts: catalog
            .contacts
            .into_iter()
            .map(|contact| AccountContactDto {
                contact_id: contact.contact_id,
                display_name: contact.display_name,
                signing_certificate_sha256: contact.signing_certificate_sha256,
                recipient_public_key_fingerprint: contact.recipient_public_key_fingerprint,
                verification_state: contact.verification_state,
                missing_status_caveat: contact.missing_status_caveat,
                phone_sourced: contact.trust_source == "phone_sync",
            })
            .collect(),
    })
}

fn ensure_catalog(root: &Path, _runtime: &AccountRuntime) -> Result<TzapIdentityCatalog, CommandErrorDto> {
    let mut catalog_store = FileTzapIdentityCatalogStore::new(root);
    let catalog = match catalog_store.load_catalog(ACCOUNT_KEY) {
        Ok(Some(catalog)) => catalog,
        Ok(None) => {
            let catalog = TzapIdentityCatalog::empty();
            catalog_store.save_catalog(ACCOUNT_KEY, None, catalog.clone()).map_err(|error| account_error("account_catalog_save_failed", error))?;
            catalog
        }
        Err(error) => return Err(account_error("account_catalog_failed", error)),
    };
    Ok(catalog)
}

fn validate_callback(request: &AccountHostedAuthCallbackRequest) -> Result<(), CommandErrorDto> {
    if !(16..=256).contains(&request.state.len())
        || !request.state.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
        || !matches!(request.result.as_str(), "completed" | "cancelled" | "failed")
        || request.error_code.as_ref().is_some_and(|code| code.len() > 128)
    {
        return Err(CommandErrorDto::invalid_request("Hosted callback is invalid"));
    }
    Ok(())
}

fn account_error(code: &'static str, error: impl std::fmt::Display) -> CommandErrorDto {
    CommandErrorDto::new(code, error.to_string(), None::<String>, ErrorSeverityDto::Error, true)
}

fn current_unix_seconds() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

fn hex_bytes(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_rejects_unknown_results_and_secret_shaped_state() {
        assert!(
            validate_callback(&AccountHostedAuthCallbackRequest { state: "state-1234567890".to_string(), result: "completed".to_string(), error_code: None })
                .is_ok()
        );
        assert!(
            validate_callback(&AccountHostedAuthCallbackRequest {
                state: "state=access_token=secret".to_string(),
                result: "completed".to_string(),
                error_code: None,
            })
            .is_err()
        );
    }

    #[test]
    fn empty_core_inventory_maps_to_a_secret_free_snapshot() {
        let root = std::env::temp_dir().join(format!("zmanager-account-test-{}", current_unix_seconds()));
        let runtime = AccountRuntime::new();
        let snapshot = snapshot_at(&root, &runtime).unwrap();
        assert_eq!(snapshot.auth_status, "signedOut");
        assert!(snapshot.certificates.is_empty());
        assert!(snapshot.recipient_keys.is_empty());
        assert!(snapshot.contacts.is_empty());
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("private"));
    }

    #[test]
    fn existing_public_catalog_snapshot_does_not_read_legacy_secret_file() {
        let root = std::env::temp_dir().join(format!("zmanager-account-catalog-test-{}", current_unix_seconds()));
        let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
        let mut catalog = TzapIdentityCatalog::empty();
        catalog.revision = 1;
        catalog_store.save_catalog(ACCOUNT_KEY, None, catalog).unwrap();
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("default.identity.json"), br#"{"private_key_der":"must-not-be-read"}"#).unwrap();

        let snapshot = snapshot_at(&root, &AccountRuntime::new()).unwrap();
        assert!(snapshot.recipient_keys.is_empty());
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("must-not-be-read"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn secret_store_mutation_releases_lock_before_snapshot_refresh() {
        let root = std::env::temp_dir().join(format!("zmanager-account-lock-test-{}", current_unix_seconds()));
        let runtime = AccountRuntime::new();
        with_secret_store(&runtime, |_store| Ok(())).unwrap();

        let snapshot = snapshot_at(&root, &runtime).unwrap();
        assert!(snapshot.certificates.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn deletion_pending_is_not_an_active_signing_lifecycle() {
        let mut catalog = TzapIdentityCatalog::empty();
        catalog.signing_identities.push(TzapPublicSigningIdentityRecord {
            id: "signing-test".to_owned(),
            local_alias: Some("Test".to_owned()),
            certificate_id: Some("signing-test".to_owned()),
            certificate_sha256: Some("sha256:test".to_owned()),
            issuer_certificate_sha256: None,
            issuer_key_identifier: None,
            serial_number: None,
            certificate_chain_der: vec![vec![1]],
            not_before_unix_seconds: Some(1),
            not_after_unix_seconds: Some(u64::MAX),
            renewal_grace_period_days: None,
            renewal_recommended_within_days: None,
            public_signer_id: None,
            public_org_id: None,
            public_device_id: None,
            assurance_level: Some("local_self_signed".to_owned()),
            sign_device_id: None,
            sign_device_routing: None,
            signing_key_created_at_unix_seconds: Some(1),
            legacy_key_id: None,
            metadata_version: None,
            policy_oid: None,
            signing_key_ref: TzapSecretRef::generate(),
            lifecycle: "deletion_pending".to_owned(),
        });
        assert!(!catalog.signing_identities.iter().any(|identity| { identity.lifecycle == "active" }));
    }

    #[test]
    fn recipient_key_removal_retires_active_and_purges_retired() {
        let root = std::env::temp_dir().join(format!("zmanager-account-purge-test-{}", current_unix_seconds()));
        let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
        let mut catalog = TzapIdentityCatalog::empty();
        let key_ref = TzapSecretRef::generate();
        catalog.recipient_keys.push(TzapPublicRecipientKeyRecord {
            id: "key-1".to_owned(),
            local_label: Some("Key 1".to_owned()),
            algorithm: "x25519".to_owned(),
            public_key_der: vec![1, 2, 3],
            fingerprint: "sha256:abc".to_owned(),
            private_key_ref: key_ref.clone(),
            lifecycle: "active".to_owned(),
            created_at_unix_seconds: 100,
            retired_at_unix_seconds: None,
        });
        catalog_store.save_catalog(ACCOUNT_KEY, None, catalog).unwrap();

        let runtime = AccountRuntime::new();
        // First removal retires the active key
        let mut catalog = ensure_catalog(&root, &runtime).unwrap();
        let key = catalog.recipient_keys.iter_mut().find(|k| k.id == "key-1").unwrap();
        key.lifecycle = "retired".to_owned();
        key.retired_at_unix_seconds = Some(200);
        let rev1 = catalog.revision;
        catalog.revision += 1;
        catalog_store.save_catalog(ACCOUNT_KEY, Some(rev1), catalog).unwrap();

        let snapshot = snapshot_at(&root, &runtime).unwrap();
        assert_eq!(snapshot.recipient_keys.len(), 1);
        assert_eq!(snapshot.recipient_keys[0].lifecycle, "retired");

        // Second removal purges the retired key
        let mut catalog = ensure_catalog(&root, &runtime).unwrap();
        let pos = catalog.recipient_keys.iter().position(|k| k.id == "key-1").unwrap();
        catalog.recipient_keys.remove(pos);
        let rev2 = catalog.revision;
        catalog.revision += 1;
        catalog_store.save_catalog(ACCOUNT_KEY, Some(rev2), catalog).unwrap();

        let snapshot = snapshot_at(&root, &runtime).unwrap();
        assert!(snapshot.recipient_keys.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn contact_removal_records_local_tombstone() {
        let root = std::env::temp_dir().join(format!("zmanager-contact-tombstone-test-{}", current_unix_seconds()));
        let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
        let mut catalog = TzapIdentityCatalog::empty();
        catalog.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-1".to_owned(),
            display_name: "Alice".to_owned(),
            signing_certificate_sha256: "sha256:cert".to_owned(),
            recipient_public_key_fingerprint: "sha256:fp".to_owned(),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "phone_sync".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 100,
            local_alias: None,
            card: None,
        });
        catalog_store.save_catalog(ACCOUNT_KEY, None, catalog).unwrap();

        let runtime = AccountRuntime::new();
        let mut catalog = ensure_catalog(&root, &runtime).unwrap();
        let now = 200;
        catalog.contacts.retain(|c| c.contact_id != "contact-1");
        catalog.removed_contacts.retain(|t| t.contact_id != "contact-1");
        catalog.removed_contacts.push(TzapContactTombstone { contact_id: "contact-1".to_owned(), removed_at: now });
        let rev = catalog.revision;
        catalog.revision += 1;
        catalog_store.save_catalog(ACCOUNT_KEY, Some(rev), catalog).unwrap();

        let loaded = catalog_store.load_catalog(ACCOUNT_KEY).unwrap().unwrap();
        assert!(loaded.contacts.is_empty());
        assert_eq!(loaded.removed_contacts.len(), 1);
        assert_eq!(loaded.removed_contacts[0].contact_id, "contact-1");
        assert_eq!(loaded.removed_contacts[0].removed_at, 200);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn apply_contact_snapshot_honors_local_tombstones_and_prunes_disappeared_phone_contacts() {
        let mut catalog = TzapIdentityCatalog::empty();
        // Locally deleted contact-1 at t=200
        catalog.removed_contacts.push(TzapContactTombstone { contact_id: "contact-1".to_owned(), removed_at: 200 });
        // Disappeared phone contact (previously synced, not in incoming snapshot)
        catalog.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-disappeared".to_owned(),
            display_name: "Disappeared".to_owned(),
            signing_certificate_sha256: "sha256:cert".to_owned(),
            recipient_public_key_fingerprint: "sha256:fp-old".to_owned(),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "phone_sync".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 50,
            local_alias: None,
            card: None,
        });
        // Locally imported contact (not phone-sourced)
        catalog.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-local".to_owned(),
            display_name: "Local Contact".to_owned(),
            signing_certificate_sha256: "sha256:cert2".to_owned(),
            recipient_public_key_fingerprint: "sha256:fp-local".to_owned(),
            recipient_public_key_der: vec![4, 5, 6],
            trust_source: "personal".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 50,
            local_alias: None,
            card: None,
        });

        // Snapshot contains contact-1 with accepted_at = 150 (older than local tombstone 200)
        let snapshot = TzapContactSnapshot::new(
            vec![zmanager_core::contact_snapshot::TzapContactSnapshotEntry {
                contact_id: Some("contact-1".to_owned()),
                card: serde_json::json!({
                    "envelope_version": 1,
                    "recipient_public_key_fingerprint": "contact-1",
                    "payload": {
                        "display_name": "Contact 1",
                    }
                }),
                local_alias: None,
                accepted_at: 150,
            }],
            vec![],
        );

        apply_contact_snapshot_to_catalog(&mut catalog, &snapshot, 300, None);

        // contact-1 should NOT be restored because local tombstone (200) > accepted_at (150)
        assert!(!catalog.contacts.iter().any(|c| c.contact_id == "contact-1"));
        // contact-disappeared (phone_sync) should be pruned because it's not in the snapshot
        assert!(!catalog.contacts.iter().any(|c| c.contact_id == "contact-disappeared"));
        // contact-local (not phone_sync) should be preserved
        assert!(catalog.contacts.iter().any(|c| c.contact_id == "contact-local"));
    }
}
