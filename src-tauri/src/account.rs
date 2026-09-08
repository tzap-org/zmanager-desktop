use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
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
use zmanager_core::contact_snapshot::{CONTACT_SNAPSHOT_FORMAT_PLAIN, TzapContactSnapshot, TzapContactTombstone};
use zmanager_core::device_identity::{generate_device_csr_from_private_key, generate_recipient_encryption_key};
use zmanager_core::identity_catalog::{
    FileTzapIdentityCatalogStore, TzapIdentityCatalog, TzapIdentityCatalogStore, TzapPublicContactRecord, TzapPublicRecipientKeyRecord,
    TzapPublicSigningIdentityRecord, TzapPublicStatusCacheRecord, TzapSecretMaterialStore, TzapSecretPurpose, TzapSecretRef, TzapSecretStoreError,
};
use zmanager_tzap_hosted::auth_client::{
    AUTH_HANDOFF_LIFETIME_SECONDS, LOGIN_TZAP_BASE_URL, SESSION_AUDIENCE_LOGIN_TZAP, SESSION_AUDIENCE_SIGN_TZAP, SIGN_TZAP_BASE_URL, TzapAuthError,
    TzapAuthHttpTransport, TzapCurrentUser, TzapHostedAuthCallback, TzapHostedAuthEnvironment, TzapHostedAuthLaunchConfig, TzapOAuthStateTracker,
    TzapPendingAuthState, TzapSessionRecord, TzapSessionStore, complete_hosted_auth_handoff_for_audience, fetch_current_user_for_audience,
};
use zmanager_tzap_hosted::backup_client::{TzapBackupClient, TzapBackupError};
use zmanager_tzap_hosted::certificate_lifecycle::{
    RENEWAL_GRACE_MAX_SECONDS, TzapCertificateLifecycleClient, TzapCertificateLifecycleError, TzapRenewalPolicy, TzapRenewalRequest, TzapRetirementCompletion,
    enroll_or_renew_device_certificate,
};
use zmanager_tzap_hosted::enrollment_client::{TzapEnrollmentCertificateValidator, TzapEnrollmentClient, TzapEnrollmentError, TzapEnrollmentRequest};
use zmanager_tzap_hosted::intermediate_client::TzapOnlineIntermediateResolver;
use zmanager_tzap_hosted::local_identity_store::{TzapLocalIdentityStore, TzapSignDeviceRouting};
use zmanager_tzap_hosted::reqwest_transport::exchange_handoff_code_for_audience;
use zmanager_tzap_hosted::status_client::{TzapBulkStatusLookup, TzapStatusClient, TzapStatusResponse, classify_contact_status};
use zmanager_tzap_hosted::trust::{self, TzapCertificateProfileOptions};

use crate::error::{CommandErrorDto, ErrorSeverityDto};
use crate::secure_store::{NativeTzapLocalIdentityStore, NativeTzapSecretStore};

const ACCOUNT_KEY: &str = "default";
const REDIRECT_URI: &str = "tzap://auth/callback";
const DESKTOP_DEVICE_NAME: &str = "ZManager Desktop";
const REGISTERED_DESKTOP_CLIENT_ID: &str = "zmanager_desktop";
static GUI_TEST_ACCOUNT_STATE_INITIALIZED: OnceLock<()> = OnceLock::new();

fn hosted_online_enabled() -> bool {
    cfg!(feature = "hosted-online")
}

fn require_hosted_online_enabled() -> Result<(), CommandErrorDto> {
    if hosted_online_enabled() {
        Ok(())
    } else {
        Err(account_error(
            "hosted_online_gate",
            "Hosted online features are unavailable until the hosted-auth security and OAuth registration gates are approved",
        ))
    }
}

fn hosted_session_audience(value: Option<&str>) -> Result<&'static str, CommandErrorDto> {
    match value.unwrap_or(SESSION_AUDIENCE_SIGN_TZAP) {
        SESSION_AUDIENCE_SIGN_TZAP => Ok(SESSION_AUDIENCE_SIGN_TZAP),
        SESSION_AUDIENCE_LOGIN_TZAP => Ok(SESSION_AUDIENCE_LOGIN_TZAP),
        _ => Err(CommandErrorDto::invalid_request("Unsupported hosted session audience")),
    }
}

fn hosted_environment(value: &str) -> Result<TzapHostedAuthEnvironment, CommandErrorDto> {
    match value {
        "local" => Ok(TzapHostedAuthEnvironment::Local),
        "staging" => Ok(TzapHostedAuthEnvironment::Staging),
        "prod" => Ok(TzapHostedAuthEnvironment::Prod),
        _ => Err(CommandErrorDto::invalid_request("Unsupported hosted environment")),
    }
}

fn hosted_client_id(environment: TzapHostedAuthEnvironment) -> Result<&'static str, CommandErrorDto> {
    let configured = match environment {
        TzapHostedAuthEnvironment::Local => {
            option_env!("TZAP_DESKTOP_LOCAL_CLIENT_ID").or(option_env!("TZAP_DESKTOP_CLIENT_ID")).or(Some("zmanager-desktop-local"))
        }
        TzapHostedAuthEnvironment::Staging => option_env!("TZAP_DESKTOP_STAGING_CLIENT_ID").or(Some(REGISTERED_DESKTOP_CLIENT_ID)),
        TzapHostedAuthEnvironment::Prod => option_env!("TZAP_DESKTOP_PROD_CLIENT_ID").or(Some(REGISTERED_DESKTOP_CLIENT_ID)),
    };
    configured
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| account_error("oauth_registration_required", "Hosted OAuth client registration is not configured for this environment"))
}

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
pub struct AccountLifecycleResultDto {
    pub snapshot: AccountSnapshotDto,
    pub outcome: String,
    pub attempted_device_ids: Vec<String>,
    pub incomplete_reasons: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountRenewCertificateRequest {
    pub certificate_id: String,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountContactSyncCountsDto {
    pub imported: u32,
    pub updated: u32,
    pub removed: u32,
    pub rejected: u32,
    pub rejected_reasons: Vec<String>,
    pub status_refresh_failed: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountContactSyncResultDto {
    pub snapshot: AccountSnapshotDto,
    pub last_successful_sync_at: u64,
    pub counts: AccountContactSyncCountsDto,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCertificateDto {
    pub identity_id: String,
    pub certificate_id: String,
    pub certificate_sha256: String,
    pub label: Option<String>,
    pub identity_type: String,
    pub state: String,
    pub assurance_level: String,
    pub not_after_unix_seconds: u64,
    pub renewal_recommended: bool,
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
    pub public_signer_id: Option<String>,
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
    pub audience: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountCompleteHostedAuthRequest {
    pub state: String,
    pub handoff_code: String,
    pub callback_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AccountCurrentUserDto {
    pub display_name: String,
    pub public_signer_id: Option<String>,
    pub assurance_level: Option<String>,
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
    pending_audience: String,
    pending_environment: Option<String>,
    auth_status: String,
    session: Option<TzapSessionRecord>,
    cached_user: Option<TzapCurrentUser>,
    environment: String,
}

fn restore_session_environment(session: Option<TzapSessionRecord>, persisted_environment: Option<String>) -> (Option<TzapSessionRecord>, String) {
    match (session, persisted_environment) {
        (Some(session), Some(environment)) => (Some(session), environment),
        // An old or corrupt session without an environment must not be guessed
        // as production; require a fresh sign-in instead.
        (Some(_), None) => (None, "prod".to_owned()),
        (None, _) => (None, "prod".to_owned()),
    }
}

#[derive(Clone)]
pub struct AccountRuntime(Arc<Mutex<AccountRuntimeState>>, Arc<Mutex<NativeTzapSecretStore>>, Arc<Mutex<()>>);

impl AccountRuntime {
    pub fn new() -> Self {
        let store = NativeTzapSecretStore::for_desktop_account().expect("desktop account secure-store scope is valid");
        let persisted_session = store.load_session(ACCOUNT_KEY);
        let persisted_environment = store.load_session_environment(ACCOUNT_KEY);
        let had_persisted_session = persisted_session.is_some();
        let (session, environment) = restore_session_environment(persisted_session, persisted_environment);
        if had_persisted_session && session.is_none() {
            let mut store = store.clone();
            let _ = store.clear_session(ACCOUNT_KEY);
            let _ = store.clear_session_environment(ACCOUNT_KEY);
        }
        let auth_status = if session.is_some() { "signedIn".to_string() } else { "signedOut".to_string() };
        Self(
            Arc::new(Mutex::new(AccountRuntimeState {
                pending: None,
                pending_audience: SESSION_AUDIENCE_SIGN_TZAP.to_owned(),
                pending_environment: None,
                auth_status,
                session,
                cached_user: None,
                environment,
            })),
            Arc::new(Mutex::new(store)),
            Arc::new(Mutex::new(())),
        )
    }
}

struct OfficialEnrollmentCertificateValidator;

struct DesktopEnrollmentCertificateValidator;

fn local_fixture_enabled() -> bool {
    cfg!(debug_assertions)
        && std::env::var("ZMANAGER_GUI_TEST_MODE").ok().as_deref() == Some("1")
        && std::env::var("TZAP_E2E_ENV").ok().as_deref() == Some("local")
}

fn fixture_root_certificates() -> Option<Vec<Vec<u8>>> {
    if !local_fixture_enabled() {
        return None;
    }
    let path = std::env::var_os("TZAP_E2E_FIXTURE_ROOT_CERT")?;
    let pem = std::fs::read(path).ok()?;
    let certificate = X509::from_pem(&pem).ok()?;
    Some(vec![certificate.to_der().ok()?])
}

impl TzapEnrollmentCertificateValidator for DesktopEnrollmentCertificateValidator {
    fn validate_certificate_chain(&self, chain_der: &[Vec<u8>]) -> Result<zmanager_core::trust::TzapCertificatePublicMetadata, TzapEnrollmentError> {
        if local_fixture_enabled() {
            return trust::validate_custom_tzap_certificate_chain_der(chain_der, &TzapCertificateProfileOptions::default())
                .map(|validation| validation.public_metadata)
                .map_err(|error| TzapEnrollmentError::CertificateChain(error.to_string()));
        }
        OfficialEnrollmentCertificateValidator.validate_certificate_chain(chain_der)
    }

    fn validate_and_complete_certificate_chain(
        &self,
        chain_der: &[Vec<u8>],
    ) -> Result<(Vec<Vec<u8>>, zmanager_core::trust::TzapCertificatePublicMetadata), TzapEnrollmentError> {
        if local_fixture_enabled() {
            return self.validate_certificate_chain(chain_der).map(|metadata| (chain_der.to_vec(), metadata));
        }
        OfficialEnrollmentCertificateValidator.validate_and_complete_certificate_chain(chain_der)
    }
}

impl TzapEnrollmentCertificateValidator for OfficialEnrollmentCertificateValidator {
    fn validate_certificate_chain(&self, chain_der: &[Vec<u8>]) -> Result<zmanager_core::trust::TzapCertificatePublicMetadata, TzapEnrollmentError> {
        trust::validate_official_tzap_certificate_chain_der(chain_der, &trust::OFFICIAL_TZAP_ROOT_PINS, &TzapCertificateProfileOptions::default())
            .map(|validation| validation.public_metadata)
            .map_err(|error| TzapEnrollmentError::CertificateChain(error.to_string()))
    }

    fn validate_and_complete_certificate_chain(
        &self,
        chain_der: &[Vec<u8>],
    ) -> Result<(Vec<Vec<u8>>, zmanager_core::trust::TzapCertificatePublicMetadata), TzapEnrollmentError> {
        if let Ok(metadata) = self.validate_certificate_chain(chain_der) {
            return Ok((chain_der.to_vec(), metadata));
        }
        let mut last_error = None;
        for root_der in trust::official_tzap_root_certificates_der() {
            let mut completed_chain = chain_der.to_vec();
            completed_chain.push(root_der);
            match self.validate_certificate_chain(&completed_chain) {
                Ok(metadata) => return Ok((completed_chain, metadata)),
                Err(error) => last_error = Some(error),
            }
        }
        Err(last_error.unwrap_or_else(|| TzapEnrollmentError::CertificateChain("certificate chain validation failed".to_owned())))
    }
}

const DEFAULT_HOSTED_CERT_VALIDITY_SECONDS: u64 = 90 * 24 * 60 * 60;

fn hosted_service_base_urls(environment: TzapHostedAuthEnvironment) -> (String, String) {
    match environment {
        TzapHostedAuthEnvironment::Local => ("http://localhost:8787".to_owned(), "http://localhost:8787".to_owned()),
        TzapHostedAuthEnvironment::Staging => ("https://staging.tzap.org".to_owned(), "https://staging.tzap.org".to_owned()),
        TzapHostedAuthEnvironment::Prod => (SIGN_TZAP_BASE_URL.to_owned(), LOGIN_TZAP_BASE_URL.to_owned()),
    }
}

fn active_hosted_session(runtime: &AccountRuntime) -> Result<(TzapSessionRecord, String), CommandErrorDto> {
    expire_session_if_needed(runtime);
    let state = runtime.0.lock().expect("account runtime lock poisoned");
    let session = state.session.clone().ok_or_else(|| CommandErrorDto::unauthorized("Hosted sign-in is required for this operation"))?;
    Ok((session, state.environment.clone()))
}

fn active_sign_hosted_session(runtime: &AccountRuntime) -> Result<(TzapSessionRecord, String), CommandErrorDto> {
    let (session, environment) = active_hosted_session(runtime)?;
    if session.audience != SESSION_AUDIENCE_SIGN_TZAP {
        return Err(account_error("sign_session_required", "A signing-scope hosted session is required for this operation"));
    }
    Ok((session, environment))
}

fn lifecycle_pending_outcome(error: &TzapCertificateLifecycleError) -> Option<&'static str> {
    match error {
        TzapCertificateLifecycleError::Enrollment(TzapEnrollmentError::Denied(denial)) => match denial.kind {
            zmanager_tzap_hosted::enrollment_client::TzapEnrollmentDenialKind::DeviceApprovalRequired => Some("approval_required"),
            zmanager_tzap_hosted::enrollment_client::TzapEnrollmentDenialKind::DeviceLinkagePending => Some("device_linkage_pending"),
            zmanager_tzap_hosted::enrollment_client::TzapEnrollmentDenialKind::DeviceLinkageConflict => Some("device_linkage_conflict"),
            _ => None,
        },
        TzapCertificateLifecycleError::RenewalPendingApproval => Some("approval_required"),
        TzapCertificateLifecycleError::DeviceLinkagePending => Some("device_linkage_pending"),
        TzapCertificateLifecycleError::DeviceLinkageConflict => Some("device_linkage_conflict"),
        _ => None,
    }
}

fn map_lifecycle_error(error: TzapCertificateLifecycleError) -> CommandErrorDto {
    match error {
        TzapCertificateLifecycleError::Auth(TzapAuthError::HttpStatus { status_code: 401 }) => {
            CommandErrorDto::unauthorized("Hosted sign-in expired. Please sign in again.")
        }
        TzapCertificateLifecycleError::Enrollment(TzapEnrollmentError::Denied(denial)) => {
            account_error(denial.kind.as_str(), "The hosted service did not approve this device operation")
        }
        TzapCertificateLifecycleError::Enrollment(TzapEnrollmentError::HttpStatus { status_code, .. }) => {
            account_error("account_lifecycle_http_failed", format!("Hosted enrollment request failed with status {status_code}"))
        }
        TzapCertificateLifecycleError::CertificateNotFound => account_error("account_certificate_not_found", "Certificate was not found locally"),
        TzapCertificateLifecycleError::CertificateNotRenewable => account_error("account_certificate_not_renewable", "Certificate cannot be renewed"),
        TzapCertificateLifecycleError::RenewalTargetMismatch => {
            account_error("account_renewal_target_mismatch", "Renewal target did not match the selected certificate")
        }
        TzapCertificateLifecycleError::RenewalPendingApproval => account_error("approval_required", "Certificate renewal is awaiting device approval"),
        TzapCertificateLifecycleError::DeviceLinkagePending => account_error("device_linkage_pending", "Device linkage is pending"),
        TzapCertificateLifecycleError::DeviceLinkageConflict => account_error("device_linkage_conflict", "Device linkage conflicts with the selected account"),
        TzapCertificateLifecycleError::ActiveCertificateExists => {
            account_error("active_certificate_exists", "The hosted service already has an active certificate for this device")
        }
        TzapCertificateLifecycleError::HttpStatus { status_code } => {
            account_error("account_lifecycle_http_failed", format!("Hosted lifecycle request failed with status {status_code}"))
        }
        _other => account_error("account_lifecycle_failed", "Hosted certificate lifecycle operation failed"),
    }
}

fn lifecycle_result(
    app: &AppHandle,
    runtime: &AccountRuntime,
    outcome: &str,
    attempted_device_ids: Vec<String>,
    incomplete_reasons: Vec<String>,
) -> Result<AccountLifecycleResultDto, CommandErrorDto> {
    let root = account_state_dir(app)?;
    Ok(AccountLifecycleResultDto { snapshot: snapshot_at(&root, runtime)?, outcome: outcome.to_owned(), attempted_device_ids, incomplete_reasons })
}

#[tauri::command]
pub fn account_enroll_certificate(app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountLifecycleResultDto, CommandErrorDto> {
    let _lifecycle_guard = runtime.2.lock().expect("account lifecycle lock poisoned");
    require_hosted_online_enabled()?;
    let root = account_state_dir(&app)?;
    let (session, environment_str) = active_sign_hosted_session(&runtime)?;
    let environment = hosted_environment(&environment_str)?;
    let (sign_base_url, login_base_url) = hosted_service_base_urls(environment);
    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|error| account_error("account_http_client_failed", error))?;
    let enrollment_client = if matches!(environment, TzapHostedAuthEnvironment::Local | TzapHostedAuthEnvironment::Staging) {
        TzapEnrollmentClient::local_staging_server_with_device_name(&sign_base_url, &transport, DESKTOP_DEVICE_NAME)
    } else {
        TzapEnrollmentClient::with_device_name(&sign_base_url, &transport, DESKTOP_DEVICE_NAME)
    };
    let lifecycle_client = if matches!(environment, TzapHostedAuthEnvironment::Local | TzapHostedAuthEnvironment::Staging) {
        TzapCertificateLifecycleClient::local_staging_server_with_device_name(&sign_base_url, &login_base_url, &transport, DESKTOP_DEVICE_NAME)
    } else {
        TzapCertificateLifecycleClient::with_device_name(&sign_base_url, &login_base_url, &transport, DESKTOP_DEVICE_NAME)
    };
    let request = TzapEnrollmentRequest {
        account_key: ACCOUNT_KEY.to_owned(),
        org_id: session.selected_org_id.clone(),
        requested_validity_seconds: DEFAULT_HOSTED_CERT_VALIDITY_SECONDS,
        now_unix_seconds: current_unix_seconds(),
    };
    let label = match request.org_id.as_deref() {
        Some(org_id) => format!("ZManager Desktop Enrollment (org:{org_id})"),
        None => "ZManager Desktop Enrollment (personal)".to_owned(),
    };
    let mut store = NativeTzapLocalIdentityStore::new(&root, ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    let result = enroll_or_renew_device_certificate(
        &enrollment_client,
        &lifecycle_client,
        &DesktopEnrollmentCertificateValidator,
        &mut store,
        &session,
        &request,
        &label,
    );
    match result {
        Ok(_) => lifecycle_result(&app, &runtime, "complete", Vec::new(), Vec::new()),
        Err(error) => {
            if matches!(error, TzapCertificateLifecycleError::Auth(TzapAuthError::HttpStatus { status_code: 401 })) {
                clear_hosted_session(&runtime, "expired");
            }
            if let Some(outcome) = lifecycle_pending_outcome(&error) {
                lifecycle_result(&app, &runtime, outcome, Vec::new(), Vec::new())
            } else {
                Err(map_lifecycle_error(error))
            }
        }
    }
}

#[tauri::command]
pub fn account_renew_certificate(
    request: AccountRenewCertificateRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountLifecycleResultDto, CommandErrorDto> {
    let _lifecycle_guard = runtime.2.lock().expect("account lifecycle lock poisoned");
    require_hosted_online_enabled()?;
    if request.certificate_id.trim().is_empty() {
        return Err(CommandErrorDto::invalid_request("certificateId must not be empty"));
    }
    let root = account_state_dir(&app)?;
    let (session, environment_str) = active_sign_hosted_session(&runtime)?;
    let mut store = NativeTzapLocalIdentityStore::new(&root, ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    let inventory = store.load_inventory(ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    let certificate = inventory
        .enrolled_certificates
        .iter()
        .find(|certificate| {
            certificate.certificate_id == request.certificate_id
                && certificate.state == zmanager_tzap_hosted::local_identity_store::TzapLocalCertificateState::Active
        })
        .cloned()
        .ok_or_else(|| account_error("account_certificate_not_renewable", "The selected certificate is not an active local hosted identity"))?;
    let signing_key = inventory
        .device_signing_keys
        .iter()
        .find(|key| key.key_id == certificate.signing_key_id)
        .cloned()
        .ok_or_else(|| account_error("account_signing_key_missing", "The selected certificate's private key is unavailable"))?;
    let org_id = match &certificate.sign_device_routing {
        TzapSignDeviceRouting::Personal => None,
        TzapSignDeviceRouting::Organization { org_id, .. } => Some(org_id.clone()),
    };
    let renewal_request = TzapRenewalRequest {
        account_key: ACCOUNT_KEY.to_owned(),
        previous_certificate_id: certificate.certificate_id.clone(),
        previous_certificate_sha256: certificate.certificate_sha256.clone(),
        org_id,
        requested_validity_seconds: DEFAULT_HOSTED_CERT_VALIDITY_SECONDS,
        renewal_policy: TzapRenewalPolicy::SameKeyRequired,
        now_unix_seconds: current_unix_seconds(),
        server_grace_seconds: RENEWAL_GRACE_MAX_SECONDS,
    };
    let csr_der = generate_device_csr_from_private_key(&signing_key.private_key_der, &zmanager_core::device_identity::TzapDeviceCsrOptions::default())
        .map_err(|error| account_error("account_renewal_failed", error))?;
    let environment = hosted_environment(&environment_str)?;
    let (sign_base_url, login_base_url) = hosted_service_base_urls(environment);
    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|error| account_error("account_http_client_failed", error))?;
    let lifecycle_client = if matches!(environment, TzapHostedAuthEnvironment::Local | TzapHostedAuthEnvironment::Staging) {
        TzapCertificateLifecycleClient::local_staging_server_with_device_name(&sign_base_url, &login_base_url, &transport, DESKTOP_DEVICE_NAME)
    } else {
        TzapCertificateLifecycleClient::with_device_name(&sign_base_url, &login_base_url, &transport, DESKTOP_DEVICE_NAME)
    };
    match lifecycle_client.renew_certificate_with_reconciliation(
        &DesktopEnrollmentCertificateValidator,
        &mut store,
        &session,
        &renewal_request,
        &signing_key,
        &signing_key,
        &csr_der,
    ) {
        Ok(_) => lifecycle_result(&app, &runtime, "complete", Vec::new(), Vec::new()),
        Err(error) => {
            if matches!(error, TzapCertificateLifecycleError::Auth(TzapAuthError::HttpStatus { status_code: 401 })) {
                clear_hosted_session(&runtime, "expired");
            }
            if let Some(outcome) = lifecycle_pending_outcome(&error) {
                lifecycle_result(&app, &runtime, outcome, Vec::new(), Vec::new())
            } else {
                Err(map_lifecycle_error(error))
            }
        }
    }
}

#[tauri::command]
pub fn account_retire_device(app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountLifecycleResultDto, CommandErrorDto> {
    let _lifecycle_guard = runtime.2.lock().expect("account lifecycle lock poisoned");
    require_hosted_online_enabled()?;
    let root = account_state_dir(&app)?;
    let (session, environment_str) = active_hosted_session(&runtime)?;
    let mut store = NativeTzapLocalIdentityStore::new(&root, ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    let inventory = store.load_inventory(ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    let personal_ids = inventory.active_personal_sign_device_ids().into_iter().map(ToOwned::to_owned).collect::<Vec<_>>();
    let organization_ids = inventory.active_organization_device_retirements().into_iter().map(|route| route.sign_device_id).collect::<Vec<_>>();
    let environment = hosted_environment(&environment_str)?;
    let (sign_base_url, login_base_url) = hosted_service_base_urls(environment);
    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|error| account_error("account_http_client_failed", error))?;
    let lifecycle_client = if matches!(environment, TzapHostedAuthEnvironment::Local | TzapHostedAuthEnvironment::Staging) {
        TzapCertificateLifecycleClient::local_staging_server_with_device_name(&sign_base_url, &login_base_url, &transport, DESKTOP_DEVICE_NAME)
    } else {
        TzapCertificateLifecycleClient::with_device_name(&sign_base_url, &login_base_url, &transport, DESKTOP_DEVICE_NAME)
    };
    let mut attempted_device_ids = Vec::new();
    let mut completed_device_ids = Vec::new();
    let mut incomplete_reasons = Vec::new();

    if session.audience == SESSION_AUDIENCE_SIGN_TZAP {
        if !personal_ids.is_empty() {
            let report = lifecycle_client.retire_personal_devices(&store, &session, ACCOUNT_KEY).map_err(|error| {
                if matches!(error, TzapCertificateLifecycleError::Auth(TzapAuthError::HttpStatus { status_code: 401 })) {
                    clear_hosted_session(&runtime, "expired");
                }
                map_lifecycle_error(error)
            })?;
            attempted_device_ids.extend(report.attempted_sign_device_ids);
            completed_device_ids.extend(report.completed_sign_device_ids);
            if matches!(report.completion, TzapRetirementCompletion::Incomplete) {
                incomplete_reasons.extend(report.incomplete_reasons);
            }
        }
        if !organization_ids.is_empty() {
            incomplete_reasons.push("organization_session_required".to_owned());
            attempted_device_ids.extend(organization_ids);
        }
    } else if session.audience == SESSION_AUDIENCE_LOGIN_TZAP {
        if !organization_ids.is_empty() {
            let report = lifecycle_client.retire_organization_devices(&store, &session, ACCOUNT_KEY).map_err(|error| {
                if matches!(error, TzapCertificateLifecycleError::Auth(TzapAuthError::HttpStatus { status_code: 401 })) {
                    clear_hosted_session(&runtime, "expired");
                }
                map_lifecycle_error(error)
            })?;
            attempted_device_ids.extend(report.attempted_sign_device_ids);
            completed_device_ids.extend(report.completed_sign_device_ids);
            if matches!(report.completion, TzapRetirementCompletion::Incomplete) {
                incomplete_reasons.extend(report.incomplete_reasons);
            }
        }
        if !personal_ids.is_empty() {
            incomplete_reasons.push("sign_session_required".to_owned());
            attempted_device_ids.extend(personal_ids);
        }
    } else {
        incomplete_reasons.push("unsupported_session_audience".to_owned());
        attempted_device_ids.extend(personal_ids);
        attempted_device_ids.extend(organization_ids);
    }

    mark_completed_retirement_devices(&mut store, &completed_device_ids)?;

    if !incomplete_reasons.is_empty() {
        return lifecycle_result(&app, &runtime, "incomplete", attempted_device_ids, incomplete_reasons);
    }
    {
        let mut secure_store = runtime.1.lock().expect("account store lock poisoned");
        let _ = secure_store.clear_session(ACCOUNT_KEY);
        let _ = secure_store.clear_session_environment(ACCOUNT_KEY);
    }
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.session = None;
    state.cached_user = None;
    state.environment = "prod".to_owned();
    state.auth_status = "signedOut".to_owned();
    drop(state);
    lifecycle_result(&app, &runtime, "complete", attempted_device_ids, Vec::new())
}

fn mark_completed_retirement_devices(store: &mut impl TzapLocalIdentityStore, completed_device_ids: &[String]) -> Result<(), CommandErrorDto> {
    if completed_device_ids.is_empty() {
        return Ok(());
    }
    let mut inventory = store.load_inventory(ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    for certificate in &mut inventory.enrolled_certificates {
        if completed_device_ids.iter().any(|device_id| device_id == &certificate.sign_device_id) {
            certificate.state = zmanager_tzap_hosted::local_identity_store::TzapLocalCertificateState::Revoked;
        }
    }
    store.save_inventory(ACCOUNT_KEY, inventory).map_err(|error| account_error("account_identity_store_failed", error))?;
    Ok(())
}

#[tauri::command]
pub fn account_snapshot(
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
    diagnostics: State<'_, crate::diagnostics::DiagnosticLog>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    expire_session_if_needed(&runtime);
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
    require_hosted_online_enabled()?;
    let now = current_unix_seconds();
    let mut tracker = TzapOAuthStateTracker::new();
    let pending = tracker.begin("hosted", REDIRECT_URI, now);
    let requested_audience = hosted_session_audience(request.audience.as_deref())?;
    let environment_str = request.environment.as_deref().unwrap_or("prod");
    let environment = hosted_environment(environment_str)?;
    let client_id = hosted_client_id(environment)?;
    let mut config = TzapHostedAuthLaunchConfig::for_environment(environment, client_id, REDIRECT_URI);
    config.requested_audience = requested_audience.to_owned();
    let launch_url = config.launch_url(&pending).map_err(|error| account_error("account_auth_launch_failed", error))?;
    let response =
        AccountHostedAuthLaunchDto { launch_url, state: pending.state.clone(), expires_at_unix_seconds: now.saturating_add(AUTH_HANDOFF_LIFETIME_SECONDS) };
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.pending = Some(pending);
    state.pending_audience = requested_audience.to_owned();
    state.pending_environment = Some(environment_str.to_owned());
    state.auth_status = "pending".to_string();
    Ok(response)
}

#[tauri::command]
pub fn account_complete_hosted_auth(
    app: AppHandle,
    request: AccountCompleteHostedAuthRequest,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    require_hosted_online_enabled()?;
    let now = current_unix_seconds();
    let request_state = request.state.clone();
    let pending = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        state.pending.clone().ok_or_else(|| CommandErrorDto::invalid_request("No hosted sign-in is pending"))?
    };

    if pending.state != request_state {
        return Err(CommandErrorDto::invalid_request("Hosted sign-in state did not match"));
    }

    let (environment_str, requested_audience) = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        (
            state.pending_environment.clone().ok_or_else(|| CommandErrorDto::invalid_request("Hosted sign-in environment was not retained"))?,
            state.pending_audience.clone(),
        )
    };
    let requested_audience = hosted_session_audience(Some(&requested_audience))?;

    let mut tracker = TzapOAuthStateTracker::new();
    tracker.insert_pending(pending.clone()).map_err(|e| account_error("account_auth_callback_failed", e))?;

    let environment = hosted_environment(&environment_str)?;
    let client_id = hosted_client_id(environment)?;
    let config = TzapHostedAuthLaunchConfig::for_environment(environment, client_id, REDIRECT_URI);
    let _ = crate::hosted_transport::HostedHttpTransport::new().map_err(|e| account_error("account_http_client_failed", e))?;
    // The exchange response is created and consumed entirely inside Rust. It
    // is never accepted from, serialized into, or emitted by the deep-link
    // callback boundary.
    let session_handoff_payload = exchange_handoff_code_for_audience(
        &config.hosted_auth_base_url,
        client_id,
        REDIRECT_URI,
        &request_state,
        &pending.pkce.verifier,
        &request.handoff_code,
        requested_audience,
    )
    .map_err(|error| account_error("account_auth_callback_failed", error))?;

    let callback = TzapHostedAuthCallback {
        state: request_state.clone(),
        redirect_uri: REDIRECT_URI.to_string(),
        pkce_verifier: pending.pkce.verifier.clone(),
        callback_url: request.callback_url,
        relay_body: session_handoff_payload,
    };

    let session = {
        let _ = take_matching_pending_auth(&runtime, &request_state)?;
        let mut store = runtime.1.lock().expect("account store lock poisoned");
        let session = complete_hosted_auth_handoff_for_audience(&mut tracker, &mut *store, ACCOUNT_KEY, &callback, now, requested_audience)
            .map_err(|e| account_error("account_auth_callback_failed", e))?;
        if let Err(error) = store.save_session_environment(ACCOUNT_KEY, &environment_str) {
            let _ = store.clear_session(ACCOUNT_KEY);
            let _ = store.clear_session_environment(ACCOUNT_KEY);
            drop(store);
            let mut state = runtime.0.lock().expect("account runtime lock poisoned");
            state.session = None;
            state.cached_user = None;
            state.environment = "prod".to_owned();
            state.auth_status = "failed".to_owned();
            return Err(account_error("account_auth_callback_failed", error));
        }
        session
    };
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.session = Some(session);
    state.environment = environment_str;
    state.pending_environment = None;
    state.cached_user = None;
    state.auth_status = "signedIn".to_string();
    drop(state);

    let root = account_state_dir(&app)?;
    let catalog = ensure_catalog(&root, &runtime)?;
    snapshot_from_catalog(&runtime, catalog)
}

fn take_matching_pending_auth(runtime: &AccountRuntime, expected_state: &str) -> Result<TzapPendingAuthState, CommandErrorDto> {
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    let pending = state.pending.take().ok_or_else(|| CommandErrorDto::invalid_request("No hosted sign-in is pending"))?;
    if pending.state != expected_state {
        state.pending = Some(pending);
        return Err(CommandErrorDto::invalid_request("Hosted sign-in state did not match"));
    }
    state.pending_audience = SESSION_AUDIENCE_SIGN_TZAP.to_owned();
    state.pending_environment = None;
    Ok(pending)
}

#[tauri::command]
pub fn account_fetch_current_user(_app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountCurrentUserDto, CommandErrorDto> {
    require_hosted_online_enabled()?;
    expire_session_if_needed(&runtime);
    let (session, environment_str) = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        let session = state
            .session
            .clone()
            .filter(|session| session.expires_at_unix_seconds > current_unix_seconds())
            .ok_or_else(|| CommandErrorDto::unauthorized("Session expired. Please sign in again."))?;
        let environment_str = state.environment.clone();
        (session, environment_str)
    };

    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|e| account_error("account_http_client_failed", e))?;

    let environment = hosted_environment(&environment_str)?;
    let client_id = hosted_client_id(environment)?;
    let config = TzapHostedAuthLaunchConfig::for_environment(environment, client_id, REDIRECT_URI);

    let user_result = fetch_current_user_for_audience(&transport, &config.hosted_account_base_url, &session, &session.audience);

    match user_result {
        Ok(user) => {
            let mut state = runtime.0.lock().expect("account runtime lock poisoned");
            state.cached_user = Some(user.clone());
            Ok(AccountCurrentUserDto {
                display_name: user.display_name,
                public_signer_id: user.public_signer_id,
                assurance_level: user.assurance_level.map(|value| value.as_str().to_owned()),
                selected_org_id: user.selected_org_id,
            })
        }
        Err(e) => {
            if matches!(e, zmanager_tzap_hosted::auth_client::TzapAuthError::HttpStatus { status_code: 401 }) {
                clear_hosted_session(&runtime, "expired");
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
    state.pending_audience = SESSION_AUDIENCE_SIGN_TZAP.to_owned();
    state.pending_environment = None;
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
    clear_hosted_session(&runtime, "signedOut");
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.pending = None;
    state.pending_audience = SESSION_AUDIENCE_SIGN_TZAP.to_owned();
    state.pending_environment = None;
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
pub fn account_inspect_contact_card(request: AccountContactCardRequest, app: AppHandle) -> Result<AccountContactCardPreviewDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let intermediate_cache = zmanager_core::trust::TzapIntermediateCache::new(root.join("intermediates"));
    let intermediate_resolver = TzapOnlineIntermediateResolver::with_reqwest(intermediate_cache, None);
    let verified = verify_contact_card_with_resolver(&request.contact_card, Some(&intermediate_resolver))
        .map_err(|error| account_error("account_contact_card_invalid", error))?;
    Ok(contact_card_preview(&verified))
}

#[tauri::command]
pub fn account_accept_contact_card(
    request: AccountContactCardRequest,
    app: AppHandle,
    runtime: State<'_, AccountRuntime>,
) -> Result<AccountSnapshotDto, CommandErrorDto> {
    let root = account_state_dir(&app)?;
    let intermediate_cache = zmanager_core::trust::TzapIntermediateCache::new(root.join("intermediates"));
    let intermediate_resolver = TzapOnlineIntermediateResolver::with_reqwest(intermediate_cache, None);
    let verified = verify_contact_card_with_resolver(&request.contact_card, Some(&intermediate_resolver))
        .map_err(|error| account_error("account_contact_card_invalid", error))?;
    let recipient_public_key_der = verified
        .payload
        .get("recipient_public_key")
        .and_then(Value::as_str)
        .and_then(|value| URL_SAFE_NO_PAD.decode(value).ok())
        .ok_or_else(|| account_error("account_contact_card_invalid", "Contact card recipient public key is invalid"))?;
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
        source: String::new(),
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
pub fn account_sync_contacts(app: AppHandle, runtime: State<'_, AccountRuntime>) -> Result<AccountContactSyncResultDto, CommandErrorDto> {
    require_hosted_online_enabled()?;
    let root = account_state_dir(&app)?;
    let _lifecycle_guard = runtime.2.lock().expect("account lifecycle lock poisoned");
    let counts = sync_contact_snapshot_inner(&root, &runtime)?;
    Ok(AccountContactSyncResultDto { snapshot: snapshot_at(&root, &runtime)?, last_successful_sync_at: current_unix_seconds(), counts })
}

fn sync_contact_snapshot_inner(root: &Path, runtime: &AccountRuntime) -> Result<AccountContactSyncCountsDto, CommandErrorDto> {
    expire_session_if_needed(runtime);
    let (session, environment_str) = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        let session = state
            .session
            .clone()
            .filter(|session| session.expires_at_unix_seconds > current_unix_seconds())
            .ok_or_else(|| CommandErrorDto::unauthorized("Hosted sign-in is required to sync contacts"))?;
        let environment_str = state.environment.clone();
        (session, environment_str)
    };

    let transport = crate::hosted_transport::HostedHttpTransport::new().map_err(|e| account_error("account_http_client_failed", e))?;

    let environment = hosted_environment(&environment_str)?;
    let client_id = hosted_client_id(environment)?;
    let config = TzapHostedAuthLaunchConfig::for_environment(environment, client_id, REDIRECT_URI);
    let backup_client = TzapBackupClient::new(&config.hosted_account_base_url, &transport);

    let backup_record = match backup_client.fetch_contact_backup(&session) {
        Ok(record) => record,
        Err(TzapBackupError::NotFound) => {
            let mut catalog_store = FileTzapIdentityCatalogStore::new(root);
            let mut catalog = ensure_catalog(root, runtime)?;
            let removed = catalog.contacts.iter().filter(|c| c.source == "phone_sync").count() as u32;
            catalog.contacts.retain(|c| c.source != "phone_sync");
            let expected_revision = catalog.revision;
            catalog.revision = catalog.revision.saturating_add(1);
            catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog).map_err(|error| account_error("account_catalog_save_failed", error))?;
            return Ok(AccountContactSyncCountsDto { removed, ..Default::default() });
        }
        Err(TzapBackupError::Auth(zmanager_tzap_hosted::auth_client::TzapAuthError::HttpStatus { status_code: 401 })) => {
            clear_hosted_session(runtime, "expired");
            return Err(CommandErrorDto::unauthorized("Hosted sign-in expired. Please sign in again."));
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
    let original_catalog = ensure_catalog(root, runtime)?;
    let mut identity_store = NativeTzapLocalIdentityStore::new(root, ACCOUNT_KEY).map_err(|error| account_error("account_identity_store_failed", error))?;
    let intermediate_cache = zmanager_core::trust::TzapIntermediateCache::new(root.join("intermediates"));
    let intermediate_resolver = TzapOnlineIntermediateResolver::with_reqwest(intermediate_cache, Some(config.hosted_account_base_url.clone()));
    let mut counts = match apply_contact_snapshot_with_shared_core(&mut identity_store, ACCOUNT_KEY, &snapshot, now, Some(&intermediate_resolver)) {
        Ok(counts) => counts,
        Err(error) => {
            let failure = account_error("account_contact_snapshot_apply_failed", error);
            return Err(rollback_contact_sync_failure(root, &original_catalog, failure));
        }
    };
    let mut catalog_store = FileTzapIdentityCatalogStore::new(root);
    let mut catalog = match ensure_catalog(root, runtime) {
        Ok(catalog) => catalog,
        Err(error) => return Err(rollback_contact_sync_failure(root, &original_catalog, error)),
    };
    let (status_base_url, _) = hosted_service_base_urls(environment);
    counts.status_refresh_failed = refresh_contact_statuses(&mut catalog, &status_base_url, &transport, now);

    let expected_revision = catalog.revision;
    catalog.revision = catalog.revision.saturating_add(1);
    if let Err(error) = catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), catalog) {
        let failure = account_error("account_catalog_save_failed", error);
        return Err(rollback_contact_sync_failure(root, &original_catalog, failure));
    }

    Ok(counts)
}

fn rollback_contact_sync_failure(root: &Path, original_catalog: &TzapIdentityCatalog, failure: CommandErrorDto) -> CommandErrorDto {
    let mut catalog_store = FileTzapIdentityCatalogStore::new(root);
    let rollback_result = catalog_store.load_catalog(ACCOUNT_KEY).and_then(|current| {
        let current = current.ok_or_else(|| zmanager_core::identity_catalog::TzapIdentityCatalogError::InvalidCatalog { field: "account_catalog" })?;
        catalog_store.save_catalog(ACCOUNT_KEY, Some(current.revision), original_catalog.clone())
    });
    match rollback_result {
        Ok(()) => failure,
        Err(error) => account_error("account_contact_sync_rollback_failed", format!("{}; cached contacts could not be restored: {error}", failure.message)),
    }
}

fn apply_contact_snapshot_with_shared_core(
    store: &mut impl TzapLocalIdentityStore,
    account_key: &str,
    snapshot: &zmanager_core::contact_snapshot::TzapContactSnapshot,
    now: u64,
    intermediate_resolver: Option<&dyn zmanager_core::trust::TzapIntermediateResolver>,
) -> Result<AccountContactSyncCountsDto, String> {
    let before = store.load_inventory(account_key).map_err(|error| error.to_string())?;
    let existing_phone_ids = before
        .contacts
        .iter()
        .filter(|contact| contact.source == "phone_sync")
        .map(|contact| contact.contact_id.clone())
        .collect::<std::collections::HashSet<_>>();
    let existing_contacts = before.contacts.iter().map(|contact| (contact.contact_id.clone(), contact.clone())).collect::<std::collections::HashMap<_, _>>();
    let custom_trust_root_certificates_der = fixture_root_certificates().unwrap_or_default();
    let custom_trust_root_sha256 =
        custom_trust_root_certificates_der.iter().map(|certificate| zmanager_core::trust::certificate_sha256_identifier_for_der(certificate)).collect();
    let options = zmanager_core::contact_card::TzapContactCardImportOptions {
        verifier_time_unix_seconds: i64::try_from(now).unwrap_or(i64::MAX),
        official_root_pins: &zmanager_core::trust::OFFICIAL_TZAP_ROOT_PINS,
        official_root_certificates_der: trust::official_tzap_root_certificates_der(),
        custom_trust_root_sha256,
        custom_trust_root_certificates_der,
        certificate_profile_options: zmanager_core::trust::TzapCertificateProfileOptions::default(),
        intermediate_resolver,
    };
    let report = zmanager_core::contact_snapshot::apply_contact_snapshot(store, account_key, snapshot, &options, now).map_err(|error| error.to_string())?;
    let mut counts = AccountContactSyncCountsDto::default();
    let incoming_ids = report.restored_contacts.iter().map(|contact| contact.contact_id.clone()).collect::<std::collections::HashSet<_>>();
    for restored in &report.restored_contacts {
        match existing_contacts.get(&restored.contact_id) {
            Some(previous) if contact_sync_record_changed(previous, restored) => counts.updated = counts.updated.saturating_add(1),
            Some(_) => {}
            None => counts.imported = counts.imported.saturating_add(1),
        }
    }
    let mut inventory = store.load_inventory(account_key).map_err(|error| error.to_string())?;
    for contact in &mut inventory.contacts {
        if incoming_ids.contains(&contact.contact_id) {
            contact.source = "phone_sync".to_owned();
        }
    }
    inventory.contacts.retain(|contact| contact.source != "phone_sync" || incoming_ids.contains(&contact.contact_id));
    let retained_phone_ids = inventory
        .contacts
        .iter()
        .filter(|contact| contact.source == "phone_sync")
        .map(|contact| contact.contact_id.clone())
        .collect::<std::collections::HashSet<_>>();
    counts.removed = existing_phone_ids.difference(&retained_phone_ids).count() as u32;
    for failure in report.failed_contacts {
        record_contact_rejection(&mut counts, if failure.contact_id == "unknown" { "invalid_contact_id" } else { "invalid_card" });
    }
    store.save_inventory(account_key, inventory).map_err(|error| error.to_string())?;
    Ok(counts)
}

fn contact_sync_record_changed(
    previous: &zmanager_core::local_identity_store::TzapContactRecord,
    current: &zmanager_core::local_identity_store::TzapContactRecord,
) -> bool {
    previous.contact_id != current.contact_id
        || previous.display_name != current.display_name
        || previous.signing_certificate_sha256 != current.signing_certificate_sha256
        || previous.recipient_public_key_fingerprint != current.recipient_public_key_fingerprint
        || previous.trust_anchor_type != current.trust_anchor_type
        || previous.contact_card_payload != current.contact_card_payload
        || previous.accepted_at_unix_seconds != current.accepted_at_unix_seconds
        || previous.local_alias != current.local_alias
        || previous.card != current.card
}

fn record_contact_rejection(counts: &mut AccountContactSyncCountsDto, reason: &str) {
    counts.rejected = counts.rejected.saturating_add(1);
    if !counts.rejected_reasons.iter().any(|existing| existing == reason) {
        counts.rejected_reasons.push(reason.to_owned());
    }
}

fn refresh_contact_statuses<T: TzapAuthHttpTransport>(catalog: &mut TzapIdentityCatalog, sign_base_url: &str, transport: &T, now: u64) -> u32 {
    for contact in &mut catalog.contacts {
        if contact.source == "phone_sync" && contact_card_is_expired(contact, now) {
            contact.verification_state = "status_expired".to_owned();
            contact.missing_status_caveat = false;
        }
    }
    let contacts = catalog
        .contacts
        .iter()
        .filter(|contact| contact.source == "phone_sync" && !contact_card_is_expired(contact, now))
        .map(|contact| (contact.contact_id.clone(), contact.signing_certificate_sha256.clone(), contact.verification_state.clone()))
        .collect::<Vec<_>>();
    let client = TzapStatusClient::new(sign_base_url, transport);
    let mut failed = 0u32;
    for chunk in contacts.chunks(100) {
        let lookups = chunk
            .iter()
            .map(|(_, certificate_sha256, _)| TzapBulkStatusLookup::by_fingerprint(certificate_sha256.clone(), certificate_sha256.clone()))
            .collect::<Vec<_>>();
        let responses = match client.bulk_status(&lookups) {
            Ok(responses) => responses,
            Err(_) => {
                failed = failed.saturating_add(chunk.len() as u32);
                for (contact_id, certificate_sha256, offline_state) in chunk {
                    catalog.status_cache.retain(|status| status.lookup_id != *certificate_sha256);
                    if let Some(contact) = catalog.contacts.iter_mut().find(|contact| &contact.contact_id == contact_id) {
                        let decision = classify_contact_status(offline_state, None, certificate_sha256, None, now as i64);
                        contact.verification_state = decision.verification_state.to_owned();
                        contact.missing_status_caveat = decision.missing_status_caveat;
                    }
                }
                continue;
            }
        };
        let mut seen_contact_ids = std::collections::HashSet::new();
        for response in responses {
            let Some((contact_id, certificate_sha256, offline_state)) =
                chunk.iter().find(|(_, certificate_sha256, _)| certificate_sha256 == &response.lookup_id)
            else {
                continue;
            };
            seen_contact_ids.insert(contact_id.clone());
            let decision = classify_contact_status(offline_state, None, certificate_sha256, Some(&response.response), now as i64);
            if matches!(decision.verification_state, "cryptographically_intact_offline" | "status_unavailable" | "status_mismatch") {
                failed = failed.saturating_add(1);
            }
            if let Some(contact) = catalog.contacts.iter_mut().find(|contact| &contact.contact_id == contact_id) {
                contact.verification_state = decision.verification_state.to_owned();
                contact.missing_status_caveat = decision.missing_status_caveat;
            }
            catalog.status_cache.retain(|status| status.lookup_id != *certificate_sha256);
            if let (Some(this_update), Some(next_update)) = (response.response.this_update_unix_seconds, response.response.next_update_unix_seconds) {
                let lookup_id = response.response.certificate_sha256.clone().unwrap_or_else(|| certificate_sha256.clone());
                catalog.status_cache.push(TzapPublicStatusCacheRecord {
                    lookup_id,
                    status: response.response.status.as_str().to_owned(),
                    this_update: this_update.to_string(),
                    next_update: next_update.to_string(),
                });
            }
        }
        for (contact_id, certificate_sha256, offline_state) in chunk {
            if seen_contact_ids.contains(contact_id) {
                continue;
            }
            failed = failed.saturating_add(1);
            if let Some(contact) = catalog.contacts.iter_mut().find(|contact| &contact.contact_id == contact_id) {
                let decision = classify_contact_status(offline_state, None, certificate_sha256, None, now as i64);
                contact.verification_state = decision.verification_state.to_owned();
                contact.missing_status_caveat = decision.missing_status_caveat;
            }
        }
    }
    failed
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
    let now_unix_seconds = current_unix_seconds();
    let secret_store = runtime.1.lock().expect("account secure-store lock poisoned");
    let intermediate_cache = zmanager_core::trust::TzapIntermediateCache::new(root.join("intermediates"));
    let intermediate_resolver = TzapOnlineIntermediateResolver::with_reqwest(intermediate_cache, None);

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
            let (contact_verification_state, _) = contact_snapshot_verification(contact, &catalog.status_cache, now_unix_seconds);
            if !matches!(contact_verification_state.as_str(), "valid_now" | "valid_at_trusted_time" | "cryptographically_intact_offline") {
                return Err(account_error("account_contact_unavailable", "Only verified trusted contacts can receive new archives"));
            }
            let contact_card = contact_card_for_handoff(contact)?;
            let verified = verify_contact_card_with_resolver(contact_card, Some(&intermediate_resolver))
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
            if identity.lifecycle != "active" || identity.not_after_unix_seconds.is_some_and(|expires| expires <= now_unix_seconds) {
                return Err(account_error("account_signing_identity_unavailable", "Signing identity is not currently usable"));
            }
            if identity.certificate_sha256.as_deref().is_some_and(|certificate_sha256| {
                catalog.status_cache.iter().any(|status| {
                    status.lookup_id == certificate_sha256
                        && matches!(status.status.as_str(), "revoked" | "suspended" | "expired" | "issuer_revoked" | "issuer_suspended")
                })
            }) {
                return Err(account_error("account_signing_identity_blocked", "Signing identity is blocked by its cached certificate status"));
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
    if cfg!(debug_assertions) && std::env::var("ZMANAGER_GUI_TEST_MODE").as_deref() == Ok("1") {
        if let Some(path) = std::env::var_os("ZMANAGER_GUI_TEST_STATE_DIR") {
            return Ok(PathBuf::from(path).join("tzap-state"));
        }
        if let Some(root) = std::env::var_os("TZAP_E2E_ACCOUNT_STATE_ROOT") {
            let root = PathBuf::from(root);
            if root.is_absolute() {
                if GUI_TEST_ACCOUNT_STATE_INITIALIZED.get().is_none() {
                    if root.exists() {
                        let mut entries = std::fs::read_dir(&root).map_err(|error| account_error("account_state_path_failed", error))?;
                        if entries.next().transpose().map_err(|error| account_error("account_state_path_failed", error))?.is_some() {
                            return Err(account_error("account_state_path_failed", "TZAP_E2E_ACCOUNT_STATE_ROOT must be a fresh per-run directory"));
                        }
                    }
                    std::fs::create_dir_all(&root).map_err(|error| account_error("account_state_path_failed", error))?;
                    let _ = GUI_TEST_ACCOUNT_STATE_INITIALIZED.set(());
                }
                return Ok(root);
            }
            return Err(account_error("account_state_path_failed", "TZAP_E2E_ACCOUNT_STATE_ROOT must be absolute"));
        }
    }
    app.path().app_data_dir().map(|path| path.join("tzap-state")).map_err(|error| account_error("account_state_path_failed", error))
}

fn verify_contact_card_with_resolver(
    card: &Value,
    intermediate_resolver: Option<&dyn zmanager_core::trust::TzapIntermediateResolver>,
) -> Result<zmanager_core::contact_card::TzapVerifiedContactCard, zmanager_core::contact_card::TzapContactCardError> {
    let custom_trust_root_certificates_der = fixture_root_certificates().unwrap_or_default();
    let custom_trust_root_sha256 =
        custom_trust_root_certificates_der.iter().map(|certificate| zmanager_core::trust::certificate_sha256_identifier_for_der(certificate)).collect();
    let options = zmanager_core::contact_card::TzapContactCardImportOptions {
        verifier_time_unix_seconds: i64::try_from(current_unix_seconds()).unwrap_or(i64::MAX),
        official_root_pins: &zmanager_core::trust::OFFICIAL_TZAP_ROOT_PINS,
        official_root_certificates_der: trust::official_tzap_root_certificates_der(),
        custom_trust_root_sha256,
        custom_trust_root_certificates_der,
        certificate_profile_options: zmanager_core::trust::TzapCertificateProfileOptions::default(),
        intermediate_resolver,
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
    expire_session_if_needed(runtime);
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
    let session_is_valid = hosted_online_enabled() && state.session.as_ref().is_some_and(|session| session.expires_at_unix_seconds > current_unix_seconds());
    let sign_session_is_valid = session_is_valid && state.session.as_ref().is_some_and(|session| session.audience == SESSION_AUDIENCE_SIGN_TZAP);
    let (auth_cap, enroll_cap, status_cap) = if !hosted_online_enabled() {
        ("unavailable", "unavailable", "offline_cache_only")
    } else if session_is_valid {
        ("handoff_exchange", if sign_session_is_valid { "available" } else { "unavailable" }, "online")
    } else {
        ("launch_only", "unavailable", "offline_cache_only")
    };

    let assurance_level = hosted_online_enabled()
        .then(|| {
            catalog
                .signing_identities
                .iter()
                .find(|identity| is_hosted_signing_identity(identity) && identity.lifecycle == "active")
                .and_then(|identity| identity.assurance_level.clone())
        })
        .flatten();
    let session_expires_at_unix_seconds = hosted_online_enabled().then(|| state.session.as_ref().map(|s| s.expires_at_unix_seconds)).flatten();
    let display_name = hosted_online_enabled().then(|| state.cached_user.as_ref().map(|u| u.display_name.clone())).flatten();
    let public_signer_id = hosted_online_enabled().then(|| state.cached_user.as_ref().and_then(|u| u.public_signer_id.clone())).flatten();
    let auth_status = if !hosted_online_enabled() {
        "signedOut".to_owned()
    } else if state.session.is_some() && !session_is_valid {
        "expired".to_owned()
    } else {
        state.auth_status.clone()
    };

    let now_unix_seconds = current_unix_seconds();
    let status_cache = &catalog.status_cache;
    Ok(AccountSnapshotDto {
        auth_status,
        pending_state: hosted_online_enabled().then(|| state.pending.as_ref().map(|pending| pending.state.clone())).flatten(),
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
                let is_hosted = is_hosted_signing_identity(&identity);
                let assurance_level = identity.assurance_level.unwrap_or_else(|| "unknown".to_owned());
                let not_after_unix_seconds = identity.not_after_unix_seconds.unwrap_or_default();
                let state = if identity.lifecycle == "active" && not_after_unix_seconds > 0 && not_after_unix_seconds <= now_unix_seconds {
                    "expired".to_owned()
                } else {
                    identity.lifecycle.clone()
                };
                Some(AccountCertificateDto {
                    identity_id: identity.id,
                    certificate_id: identity.certificate_id?,
                    certificate_sha256: identity.certificate_sha256?,
                    label: identity.local_alias,
                    identity_type: if is_hosted { "hosted" } else { "offline" }.to_owned(),
                    renewal_recommended: is_hosted
                        && state == "active"
                        && identity
                            .renewal_recommended_within_days
                            .is_some_and(|days| now_unix_seconds.saturating_add(days.saturating_mul(24 * 60 * 60)) >= not_after_unix_seconds),
                    state,
                    assurance_level,
                    not_after_unix_seconds,
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
            .map(|contact| {
                let (verification_state, missing_status_caveat) = contact_snapshot_verification(&contact, status_cache, now_unix_seconds);
                AccountContactDto {
                    contact_id: contact.contact_id,
                    display_name: contact.display_name,
                    public_signer_id: contact_public_signer_id(&contact.contact_card_payload),
                    signing_certificate_sha256: contact.signing_certificate_sha256,
                    recipient_public_key_fingerprint: contact.recipient_public_key_fingerprint,
                    verification_state,
                    missing_status_caveat,
                    phone_sourced: contact.source == "phone_sync",
                }
            })
            .collect(),
    })
}

fn contact_snapshot_verification(contact: &TzapPublicContactRecord, status_cache: &[TzapPublicStatusCacheRecord], now_unix_seconds: u64) -> (String, bool) {
    if contact_card_is_expired(contact, now_unix_seconds) {
        return ("status_expired".to_owned(), false);
    }
    let Some(cached_status) = status_cache.iter().find(|status| status.lookup_id == contact.signing_certificate_sha256) else {
        return offline_contact_snapshot_state(contact);
    };
    let Ok(status) = cached_status.status.parse::<zmanager_core::trust::TzapCertificateStatus>() else {
        return ("status_unavailable".to_owned(), false);
    };
    let (Ok(this_update_unix_seconds), Ok(next_update_unix_seconds)) = (cached_status.this_update.parse::<i64>(), cached_status.next_update.parse::<i64>())
    else {
        return ("status_unavailable".to_owned(), false);
    };
    let response = TzapStatusResponse {
        status,
        certificate_sha256: Some(contact.signing_certificate_sha256.clone()),
        issuer_certificate_sha256: None,
        issuer_key_identifier: None,
        serial_number: None,
        not_before_unix_seconds: None,
        not_after_unix_seconds: None,
        this_update_unix_seconds: Some(this_update_unix_seconds),
        next_update_unix_seconds: Some(next_update_unix_seconds),
        revoked_at_unix_seconds: None,
        revocation_reason: None,
        revocation_category: None,
        query: Default::default(),
    };
    let decision = classify_contact_status(
        &contact.verification_state,
        None,
        &contact.signing_certificate_sha256,
        Some(&response),
        i64::try_from(now_unix_seconds).unwrap_or(i64::MAX),
    );
    (decision.verification_state.to_owned(), decision.missing_status_caveat)
}

fn offline_contact_snapshot_state(contact: &TzapPublicContactRecord) -> (String, bool) {
    if matches!(contact.verification_state.as_str(), "status_revoked" | "status_suspended" | "status_expired" | "invalid") {
        return (contact.verification_state.clone(), false);
    }
    ("cryptographically_intact_offline".to_owned(), true)
}

fn contact_card_is_expired(contact: &TzapPublicContactRecord, now_unix_seconds: u64) -> bool {
    contact.contact_card_payload.get("expires_at_unix_seconds").and_then(Value::as_u64).is_some_and(|expires_at| now_unix_seconds >= expires_at)
}

fn contact_public_signer_id(payload: &Value) -> Option<String> {
    payload
        .get("public_signer_id")
        .and_then(Value::as_str)
        .or_else(|| {
            payload.get("signing_public_metadata").and_then(Value::as_object).and_then(|metadata| metadata.get("public_signer_id")).and_then(Value::as_str)
        })
        .map(str::to_owned)
}

fn contact_card_for_handoff(contact: &TzapPublicContactRecord) -> Result<&Value, CommandErrorDto> {
    contact.card.as_ref().ok_or_else(|| account_error("account_contact_unavailable", "Trusted contact signed card is unavailable for final verification"))
}

fn is_hosted_signing_identity(identity: &TzapPublicSigningIdentityRecord) -> bool {
    identity.public_device_id.is_some()
        || identity.sign_device_id.is_some()
        || identity.sign_device_routing.is_some()
        || identity.assurance_level.as_deref().is_some_and(is_hosted_assurance_level)
}

fn is_hosted_assurance_level(value: &str) -> bool {
    matches!(
        value,
        "enrolled" | "oauth_verified_email" | "oauth_verified_provider_account" | "org_admin_approved_device" | "enterprise_sso_verified" | "contract_verified"
    )
}

fn expire_session_if_needed(runtime: &AccountRuntime) {
    let should_expire = {
        let state = runtime.0.lock().expect("account runtime lock poisoned");
        state.session.as_ref().is_some_and(|session| session.expires_at_unix_seconds <= current_unix_seconds())
    };
    if !should_expire {
        return;
    }
    {
        let mut store = runtime.1.lock().expect("account store lock poisoned");
        let _ = store.clear_session(ACCOUNT_KEY);
        let _ = store.clear_session_environment(ACCOUNT_KEY);
    }
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.pending = None;
    state.pending_audience = SESSION_AUDIENCE_SIGN_TZAP.to_owned();
    state.session = None;
    state.cached_user = None;
    state.environment = "prod".to_owned();
    state.auth_status = "expired".to_owned();
}

fn clear_hosted_session(runtime: &AccountRuntime, auth_status: &str) {
    {
        let mut store = runtime.1.lock().expect("account store lock poisoned");
        let _ = store.clear_session(ACCOUNT_KEY);
        let _ = store.clear_session_environment(ACCOUNT_KEY);
    }
    let mut state = runtime.0.lock().expect("account runtime lock poisoned");
    state.pending = None;
    state.pending_audience = SESSION_AUDIENCE_SIGN_TZAP.to_owned();
    state.session = None;
    state.cached_user = None;
    state.environment = "prod".to_owned();
    state.pending_environment = None;
    state.auth_status = auth_status.to_owned();
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

    struct FakeStatusTransport {
        body: Vec<u8>,
    }

    impl TzapAuthHttpTransport for FakeStatusTransport {
        fn send(
            &self,
            _request: &zmanager_tzap_hosted::auth_client::TzapAuthHttpRequest,
        ) -> Result<zmanager_tzap_hosted::auth_client::TzapAuthHttpResponse, TzapAuthError> {
            Ok(zmanager_tzap_hosted::auth_client::TzapAuthHttpResponse { status_code: 200, headers: Vec::new(), body: self.body.clone() })
        }
    }

    #[test]
    fn stale_contact_status_falls_back_to_offline_and_counts_refresh_failure() {
        let certificate_sha256 = zmanager_core::trust::format_certificate_sha256(&[1; 32]);
        let body = serde_json::json!({
            "results": [{
                "lookup_id": certificate_sha256,
                "status_response": {
                    "status": "valid",
                    "certificate_sha256": certificate_sha256,
                    "issuer_certificate_sha256": "sha256:issuer",
                    "issuer_key_identifier": "key-id",
                    "serial_number": "01",
                    "not_before_unix_seconds": 1,
                    "not_after_unix_seconds": 2000,
                    "this_update_unix_seconds": 1,
                    "next_update_unix_seconds": 2
                }
            }]
        });
        let transport = FakeStatusTransport { body: serde_json::to_vec(&body).unwrap() };
        let mut catalog = TzapIdentityCatalog::empty();
        catalog.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-1".to_owned(),
            display_name: "Contact".to_owned(),
            signing_certificate_sha256: certificate_sha256.clone(),
            recipient_public_key_fingerprint: zmanager_core::trust::format_certificate_sha256(&[2; 32]),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "phone_sync".to_owned(),
            source: "phone_sync".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 1,
            local_alias: None,
            card: None,
        });

        let failed = refresh_contact_statuses(&mut catalog, "https://status.example", &transport, 1000);

        assert_eq!(failed, 1);
        assert_eq!(catalog.contacts[0].verification_state, "cryptographically_intact_offline");
        assert!(catalog.contacts[0].missing_status_caveat);
    }

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
    fn hosted_online_gate_matches_the_explicit_build_feature() {
        assert_eq!(hosted_online_enabled(), cfg!(feature = "hosted-online"));
        assert_eq!(require_hosted_online_enabled().is_ok(), cfg!(feature = "hosted-online"));
    }

    #[test]
    fn hosted_session_audience_is_allow_listed() {
        assert_eq!(hosted_session_audience(None).unwrap(), SESSION_AUDIENCE_SIGN_TZAP);
        assert_eq!(hosted_session_audience(Some(SESSION_AUDIENCE_LOGIN_TZAP)).unwrap(), SESSION_AUDIENCE_LOGIN_TZAP);
        assert!(hosted_session_audience(Some("unexpected.example")).is_err());
    }

    #[test]
    fn hosted_environment_is_allow_listed_without_falling_back_to_production() {
        assert_eq!(hosted_environment("local").unwrap(), TzapHostedAuthEnvironment::Local);
        assert_eq!(hosted_environment("staging").unwrap(), TzapHostedAuthEnvironment::Staging);
        assert_eq!(hosted_environment("prod").unwrap(), TzapHostedAuthEnvironment::Prod);
        let error = hosted_environment("production").expect_err("unknown environments must not silently select production");
        assert_eq!(error.code, "invalid_request");
    }

    #[test]
    fn hosted_client_id_uses_the_registered_desktop_client_by_default() {
        assert_eq!(
            hosted_client_id(TzapHostedAuthEnvironment::Local).unwrap(),
            option_env!("TZAP_DESKTOP_LOCAL_CLIENT_ID").or(option_env!("TZAP_DESKTOP_CLIENT_ID")).unwrap_or("zmanager-desktop-local")
        );
        assert_eq!(
            hosted_client_id(TzapHostedAuthEnvironment::Staging).unwrap(),
            option_env!("TZAP_DESKTOP_STAGING_CLIENT_ID").unwrap_or(REGISTERED_DESKTOP_CLIENT_ID)
        );
        assert_eq!(
            hosted_client_id(TzapHostedAuthEnvironment::Prod).unwrap(),
            option_env!("TZAP_DESKTOP_PROD_CLIENT_ID").unwrap_or(REGISTERED_DESKTOP_CLIENT_ID)
        );
    }

    #[test]
    fn shared_hosted_assurance_values_are_classified_as_hosted_identities() {
        for assurance in
            ["enrolled", "oauth_verified_email", "oauth_verified_provider_account", "org_admin_approved_device", "enterprise_sso_verified", "contract_verified"]
        {
            assert!(is_hosted_assurance_level(assurance), "{assurance} should identify a hosted certificate");
        }
        assert!(!is_hosted_assurance_level("local_self_signed"));
        assert!(!is_hosted_assurance_level("imported_p12"));

        let hosted_identity = TzapPublicSigningIdentityRecord {
            id: "hosted-identity".to_owned(),
            local_alias: None,
            certificate_id: Some("hosted-certificate".to_owned()),
            certificate_sha256: Some("sha256:hosted".to_owned()),
            issuer_certificate_sha256: None,
            issuer_key_identifier: None,
            serial_number: None,
            certificate_chain_der: vec![vec![1]],
            not_before_unix_seconds: Some(1),
            not_after_unix_seconds: Some(u64::MAX),
            renewal_grace_period_days: None,
            renewal_recommended_within_days: None,
            public_signer_id: Some("signer".to_owned()),
            public_org_id: None,
            public_device_id: Some("device".to_owned()),
            assurance_level: Some("oauth_verified_email".to_owned()),
            sign_device_id: Some("sign-device".to_owned()),
            sign_device_routing: Some(TzapSignDeviceRouting::Personal),
            signing_key_created_at_unix_seconds: Some(1),
            legacy_key_id: None,
            metadata_version: Some(1),
            policy_oid: None,
            signing_key_ref: TzapSecretRef::generate(),
            lifecycle: "active".to_owned(),
        };
        assert!(is_hosted_signing_identity(&hosted_identity));

        let mut catalog = TzapIdentityCatalog::empty();
        catalog.signing_identities.push(hosted_identity);
        let snapshot = snapshot_from_catalog(&AccountRuntime::new(), catalog).expect("hosted identity snapshot should serialize");
        assert_eq!(snapshot.certificates[0].identity_type, "hosted");
    }

    #[test]
    fn partial_retirement_marks_only_server_confirmed_devices_non_signing() {
        let mut store = zmanager_core::local_identity_store::InMemoryTzapLocalIdentityStore::new();
        let certificate = |suffix: u8, device_id: &str| zmanager_core::local_identity_store::TzapEnrolledCertificateRecord {
            certificate_id: format!("certificate-{suffix}"),
            certificate_sha256: zmanager_core::trust::format_certificate_sha256(&[suffix; 32]),
            issuer_certificate_sha256: zmanager_core::trust::format_certificate_sha256(&[3; 32]),
            issuer_key_identifier: "AQ".to_owned(),
            serial_number: "01".to_owned(),
            leaf_certificate_der: vec![1],
            intermediate_chain_der: vec![vec![2]],
            not_before_unix_seconds: 1,
            not_after_unix_seconds: 100,
            renewal_grace_period_days: None,
            renewal_recommended_within_days: None,
            public_metadata: zmanager_core::trust::TzapCertificatePublicMetadata {
                version: 1,
                public_signer_id: "psign_0123456789ABCDEFGH".to_owned(),
                public_org_id: None,
                public_device_id: "pdev_0123456789ABCDEFGH".to_owned(),
                assurance_level: zmanager_core::trust::TzapIdentityAssurance::OauthVerifiedEmail,
                policy_oid: zmanager_core::trust::TZAP_OID_LEAF_POLICY.to_owned(),
            },
            sign_device_id: device_id.to_owned(),
            sign_device_routing: TzapSignDeviceRouting::Personal,
            signing_key_id: format!("key-{suffix}"),
            state: zmanager_core::local_identity_store::TzapLocalCertificateState::Active,
        };
        let mut inventory = zmanager_core::local_identity_store::TzapLocalIdentityInventory::empty();
        inventory.enrolled_certificates.push(certificate(1, "device-complete"));
        inventory.enrolled_certificates.push(certificate(2, "device-pending"));
        store.save_inventory(ACCOUNT_KEY, inventory).unwrap();

        mark_completed_retirement_devices(&mut store, &["device-complete".to_owned()]).unwrap();

        let inventory = store.load_inventory(ACCOUNT_KEY).unwrap();
        assert_eq!(inventory.enrolled_certificates.iter().map(|certificate| certificate.state.as_str()).collect::<Vec<_>>(), vec!["revoked", "active"]);
        assert_eq!(inventory.active_personal_sign_device_ids(), vec!["device-pending"]);
    }

    #[test]
    fn persisted_session_without_environment_is_discarded_instead_of_routed_to_production() {
        let session = TzapSessionRecord {
            audience: SESSION_AUDIENCE_SIGN_TZAP.to_owned(),
            access_token: zmanager_tzap_hosted::auth_client::TzapBearerToken::new("test-token").unwrap(),
            expires_at_unix_seconds: current_unix_seconds().saturating_add(3600),
            identity_assurance: zmanager_tzap_hosted::trust::TzapIdentityAssurance::OauthVerifiedEmail,
            selected_org_id: None,
            login_session_id: None,
        };

        let (restored, environment) = restore_session_environment(Some(session), None);
        assert!(restored.is_none());
        assert_eq!(environment, "prod");
    }

    #[test]
    fn lifecycle_errors_map_to_stable_secret_free_desktop_codes() {
        let cases = [
            (TzapCertificateLifecycleError::ActiveCertificateExists, "active_certificate_exists"),
            (TzapCertificateLifecycleError::DeviceLinkagePending, "device_linkage_pending"),
            (TzapCertificateLifecycleError::CertificateNotFound, "account_certificate_not_found"),
            (TzapCertificateLifecycleError::CertificateNotRenewable, "account_certificate_not_renewable"),
            (TzapCertificateLifecycleError::RenewalTargetMismatch, "account_renewal_target_mismatch"),
            (TzapCertificateLifecycleError::Auth(TzapAuthError::HttpStatus { status_code: 401 }), "unauthorized"),
        ];

        for (error, expected_code) in cases {
            let mapped = map_lifecycle_error(error);
            assert_eq!(mapped.code, expected_code);
            assert!(!mapped.message.contains("access_token"));
            assert!(!mapped.message.contains("certificate_der"));
        }

        assert_eq!(lifecycle_pending_outcome(&TzapCertificateLifecycleError::RenewalPendingApproval), Some("approval_required"));
        assert_eq!(lifecycle_pending_outcome(&TzapCertificateLifecycleError::DeviceLinkagePending), Some("device_linkage_pending"));
        assert_eq!(lifecycle_pending_outcome(&TzapCertificateLifecycleError::DeviceLinkageConflict), Some("device_linkage_conflict"));
    }

    #[test]
    fn mismatched_hosted_callback_preserves_pending_auth_state() {
        let runtime = AccountRuntime::new();
        let mut tracker = TzapOAuthStateTracker::new();
        let pending = tracker.begin("hosted", REDIRECT_URI, current_unix_seconds());
        let pending_state = pending.state.clone();
        runtime.0.lock().unwrap().pending = Some(pending);

        assert!(take_matching_pending_auth(&runtime, "different-state-123456").is_err());
        assert_eq!(runtime.0.lock().unwrap().pending.as_ref().map(|value| value.state.as_str()), Some(pending_state.as_str()));
    }

    #[test]
    fn empty_core_inventory_maps_to_a_secret_free_snapshot() {
        let root = std::env::temp_dir().join(format!("zmanager-account-test-{}", current_unix_seconds()));
        let runtime = AccountRuntime::new();
        let snapshot = snapshot_at(&root, &runtime).unwrap();
        assert_eq!(snapshot.auth_status, "signedOut");
        assert_eq!(snapshot.capabilities.auth, if hosted_online_enabled() { "launch_only" } else { "unavailable" });
        assert!(snapshot.certificates.is_empty());
        assert!(snapshot.recipient_keys.is_empty());
        assert!(snapshot.contacts.is_empty());
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("private"));
    }

    #[test]
    fn login_audience_session_cannot_claim_signing_capability() {
        let root = std::env::temp_dir().join(format!("zmanager-account-audience-test-{}", current_unix_seconds()));
        let runtime = AccountRuntime::new();
        runtime.0.lock().unwrap().session = Some(TzapSessionRecord {
            audience: SESSION_AUDIENCE_LOGIN_TZAP.to_owned(),
            access_token: zmanager_tzap_hosted::auth_client::TzapBearerToken::new("test-token").unwrap(),
            expires_at_unix_seconds: current_unix_seconds().saturating_add(3600),
            identity_assurance: zmanager_tzap_hosted::trust::TzapIdentityAssurance::OauthVerifiedEmail,
            selected_org_id: Some("public-org-1".to_owned()),
            login_session_id: Some("login-session-1".to_owned()),
        });

        let snapshot = snapshot_at(&root, &runtime).unwrap();
        if hosted_online_enabled() {
            assert_eq!(snapshot.capabilities.auth, "handoff_exchange");
            assert_eq!(snapshot.capabilities.enrollment, "unavailable");
            assert_eq!(snapshot.capabilities.status, "online");
        } else {
            assert_eq!(snapshot.capabilities.auth, "unavailable");
            assert_eq!(snapshot.capabilities.enrollment, "unavailable");
            assert_eq!(snapshot.capabilities.status, "offline_cache_only");
        }
    }

    #[test]
    fn signing_operations_reject_login_audience_sessions_at_the_rust_boundary() {
        let runtime = AccountRuntime::new();
        runtime.0.lock().unwrap().session = Some(TzapSessionRecord {
            audience: SESSION_AUDIENCE_LOGIN_TZAP.to_owned(),
            access_token: zmanager_tzap_hosted::auth_client::TzapBearerToken::new("test-token").unwrap(),
            expires_at_unix_seconds: current_unix_seconds().saturating_add(3600),
            identity_assurance: zmanager_tzap_hosted::trust::TzapIdentityAssurance::OauthVerifiedEmail,
            selected_org_id: Some("public-org-1".to_owned()),
            login_session_id: Some("login-session-1".to_owned()),
        });

        let error = active_sign_hosted_session(&runtime).expect_err("login audience must not authorize signing operations");
        assert_eq!(error.code, "sign_session_required");
        assert!(error.retryable);
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
    fn clearing_hosted_session_removes_cached_user_and_secure_session_state() {
        let runtime = AccountRuntime::new();
        {
            let mut state = runtime.0.lock().unwrap();
            state.auth_status = "signedIn".to_owned();
            state.cached_user = Some(TzapCurrentUser {
                display_name: "Cached User".to_owned(),
                public_signer_id: Some("signer-1".to_owned()),
                assurance_level: Some(zmanager_core::trust::TzapIdentityAssurance::OauthVerifiedEmail),
                selected_org_id: None,
            });
        }

        clear_hosted_session(&runtime, "signedOut");

        let state = runtime.0.lock().unwrap();
        assert_eq!(state.auth_status, "signedOut");
        assert!(state.session.is_none());
        assert!(state.cached_user.is_none());
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
    fn expired_contact_cards_are_unavailable_in_account_snapshots() {
        let mut contact = TzapPublicContactRecord {
            contact_id: "contact-expired".to_owned(),
            display_name: "Expired Contact".to_owned(),
            signing_certificate_sha256: "sha256:certificate".to_owned(),
            recipient_public_key_fingerprint: "sha256:recipient".to_owned(),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "official_pinned_root".to_owned(),
            source: "phone_sync".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({ "expires_at_unix_seconds": 100 }),
            accepted_at_unix_seconds: 1,
            local_alias: None,
            card: None,
        };

        let (state, caveat) = contact_snapshot_verification(&contact, &[], 100);
        assert_eq!(state, "status_expired");
        assert!(!caveat);

        contact.contact_card_payload = serde_json::json!({ "expires_at_unix_seconds": 101 });
        let (state, caveat) = contact_snapshot_verification(&contact, &[], 100);
        assert_eq!(state, "cryptographically_intact_offline");
        assert!(caveat);
    }

    #[test]
    fn stale_cached_contact_status_is_downgraded_to_offline_at_snapshot_time() {
        let certificate_sha256 = zmanager_core::trust::format_certificate_sha256(&[8; 32]);
        let contact = TzapPublicContactRecord {
            contact_id: "contact-stale-status".to_owned(),
            display_name: "Stale Contact".to_owned(),
            signing_certificate_sha256: certificate_sha256.clone(),
            recipient_public_key_fingerprint: zmanager_core::trust::format_certificate_sha256(&[9; 32]),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "official_pinned_root".to_owned(),
            source: "phone_sync".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 1,
            local_alias: None,
            card: None,
        };
        let status_cache = vec![TzapPublicStatusCacheRecord {
            lookup_id: certificate_sha256,
            status: "valid".to_owned(),
            this_update: "1".to_owned(),
            next_update: "10".to_owned(),
        }];

        let (state, caveat) = contact_snapshot_verification(&contact, &status_cache, 1_000);

        assert_eq!(state, "cryptographically_intact_offline");
        assert!(caveat);
    }

    #[test]
    fn expired_contacts_are_not_promoted_by_status_refresh() {
        let certificate_sha256 = zmanager_core::trust::format_certificate_sha256(&[7; 32]);
        let body = serde_json::json!({
            "results": [{
                "lookup_id": certificate_sha256,
                "status_response": {
                    "status": "valid",
                    "certificate_sha256": certificate_sha256,
                    "issuer_certificate_sha256": "sha256:issuer",
                    "issuer_key_identifier": "key-id",
                    "serial_number": "01",
                    "not_before_unix_seconds": 1,
                    "not_after_unix_seconds": 2000,
                    "this_update_unix_seconds": 90,
                    "next_update_unix_seconds": 200
                }
            }]
        });
        let transport = FakeStatusTransport { body: serde_json::to_vec(&body).unwrap() };
        let mut catalog = TzapIdentityCatalog::empty();
        catalog.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-expired-refresh".to_owned(),
            display_name: "Expired Contact".to_owned(),
            signing_certificate_sha256: certificate_sha256,
            recipient_public_key_fingerprint: "sha256:recipient".to_owned(),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "official_pinned_root".to_owned(),
            source: "phone_sync".to_owned(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({ "expires_at_unix_seconds": 100 }),
            accepted_at_unix_seconds: 1,
            local_alias: None,
            card: None,
        });

        assert_eq!(refresh_contact_statuses(&mut catalog, "https://sign.tzap.org", &transport, 100), 0);
        assert_eq!(catalog.contacts[0].verification_state, "status_expired");
        assert!(!catalog.contacts[0].missing_status_caveat);
        assert!(catalog.status_cache.is_empty());
    }

    #[test]
    fn contact_snapshot_reads_person_grouping_metadata_from_the_signed_payload() {
        let nested = serde_json::json!({
            "signing_public_metadata": { "public_signer_id": "signer-nested" }
        });
        assert_eq!(contact_public_signer_id(&nested).as_deref(), Some("signer-nested"));

        let legacy = serde_json::json!({ "public_signer_id": "signer-legacy" });
        assert_eq!(contact_public_signer_id(&legacy).as_deref(), Some("signer-legacy"));
    }

    #[test]
    fn contact_handoff_requires_the_retained_signed_card_envelope() {
        let contact = TzapPublicContactRecord {
            contact_id: "contact-envelope-required".to_owned(),
            display_name: "Contact".to_owned(),
            signing_certificate_sha256: "sha256:certificate".to_owned(),
            recipient_public_key_fingerprint: "sha256:recipient".to_owned(),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "official_pinned_root".to_owned(),
            source: String::new(),
            verification_state: "valid_now".to_owned(),
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({ "recipient_public_key": "AQID" }),
            accepted_at_unix_seconds: 1,
            local_alias: None,
            card: None,
        };

        let error = contact_card_for_handoff(&contact).expect_err("inner payload must not be trusted as a signed card");
        assert_eq!(error.code, "account_contact_unavailable");
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
            source: "phone_sync".to_owned(),
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
        let mut store = zmanager_core::local_identity_store::InMemoryTzapLocalIdentityStore::new();
        let mut inventory = zmanager_core::local_identity_store::TzapLocalIdentityInventory::empty();
        // Locally deleted contact-1 at t=200
        inventory.removed_contacts.push(TzapContactTombstone { contact_id: "contact-1".to_owned(), removed_at: 200 });
        // Disappeared phone contact (previously synced, not in incoming snapshot)
        inventory.contacts.push(zmanager_core::local_identity_store::TzapContactRecord {
            contact_id: "contact-disappeared".to_owned(),
            display_name: "Disappeared".to_owned(),
            signing_certificate_sha256: zmanager_core::trust::format_certificate_sha256(&[1; 32]),
            recipient_public_key_fingerprint: zmanager_core::trust::format_certificate_sha256(&[2; 32]),
            trust_anchor_type: zmanager_core::trust::TzapTrustAnchorType::OfficialTzap,
            source: "phone_sync".to_owned(),
            verification_state: zmanager_core::trust::TzapVerificationState::ValidNow,
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 50,
            local_alias: None,
            card: None,
        });
        // Locally imported contact (not phone-sourced)
        inventory.contacts.push(zmanager_core::local_identity_store::TzapContactRecord {
            contact_id: "contact-local".to_owned(),
            display_name: "Local Contact".to_owned(),
            signing_certificate_sha256: zmanager_core::trust::format_certificate_sha256(&[3; 32]),
            recipient_public_key_fingerprint: zmanager_core::trust::format_certificate_sha256(&[4; 32]),
            trust_anchor_type: zmanager_core::trust::TzapTrustAnchorType::OfficialTzap,
            source: String::new(),
            verification_state: zmanager_core::trust::TzapVerificationState::ValidNow,
            missing_status_caveat: false,
            contact_card_payload: serde_json::json!({}),
            accepted_at_unix_seconds: 50,
            local_alias: None,
            card: None,
        });
        store.save_inventory(ACCOUNT_KEY, inventory).unwrap();

        // Snapshot contains contact-1 with accepted_at = 150 (older than local tombstone 200)
        let snapshot = TzapContactSnapshot::new(
            vec![
                zmanager_core::contact_snapshot::TzapContactSnapshotEntry {
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
                },
                zmanager_core::contact_snapshot::TzapContactSnapshotEntry {
                    contact_id: Some("contact-invalid".to_owned()),
                    card: serde_json::json!({"invalid": true}),
                    local_alias: None,
                    accepted_at: 250,
                },
            ],
            vec![],
        );

        let counts = apply_contact_snapshot_with_shared_core(&mut store, ACCOUNT_KEY, &snapshot, 300, None).unwrap();
        let inventory = store.load_inventory(ACCOUNT_KEY).unwrap();

        // contact-1 should NOT be restored because local tombstone (200) > accepted_at (150)
        assert!(!inventory.contacts.iter().any(|c| c.contact_id == "contact-1"));
        assert_eq!(counts.rejected, 1);
        assert_eq!(counts.rejected_reasons, vec!["invalid_card"]);
        // contact-disappeared (phone_sync) should be pruned because it's not in the snapshot
        assert!(!inventory.contacts.iter().any(|c| c.contact_id == "contact-disappeared"));
        assert_eq!(counts.removed, 1);
        // contact-local (not phone_sync) should be preserved
        assert!(inventory.contacts.iter().any(|c| c.contact_id == "contact-local"));
    }

    #[test]
    fn contact_sync_failure_restores_the_previous_catalog() {
        let root =
            std::env::temp_dir().join(format!("zmanager-contact-sync-rollback-test-{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let mut catalog_store = FileTzapIdentityCatalogStore::new(&root);
        let mut original = TzapIdentityCatalog::empty();
        original.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-before".to_owned(),
            display_name: "Before".to_owned(),
            signing_certificate_sha256: zmanager_core::trust::format_certificate_sha256(&[1; 32]),
            recipient_public_key_fingerprint: zmanager_core::trust::format_certificate_sha256(&[2; 32]),
            recipient_public_key_der: vec![1, 2, 3],
            trust_source: "phone_sync".to_owned(),
            source: "phone_sync".to_owned(),
            verification_state: "cryptographically_intact_offline".to_owned(),
            missing_status_caveat: true,
            contact_card_payload: serde_json::json!({"display_name": "Before"}),
            accepted_at_unix_seconds: 100,
            local_alias: None,
            card: None,
        });
        catalog_store.save_catalog(ACCOUNT_KEY, None, original.clone()).unwrap();

        let mut mutated = original.clone();
        mutated.contacts.push(TzapPublicContactRecord {
            contact_id: "contact-after".to_owned(),
            display_name: "After".to_owned(),
            signing_certificate_sha256: zmanager_core::trust::format_certificate_sha256(&[3; 32]),
            recipient_public_key_fingerprint: zmanager_core::trust::format_certificate_sha256(&[4; 32]),
            recipient_public_key_der: vec![4, 5, 6],
            trust_source: "phone_sync".to_owned(),
            source: "phone_sync".to_owned(),
            verification_state: "cryptographically_intact_offline".to_owned(),
            missing_status_caveat: true,
            contact_card_payload: serde_json::json!({"display_name": "After"}),
            accepted_at_unix_seconds: 200,
            local_alias: None,
            card: None,
        });
        let expected_revision = mutated.revision;
        mutated.revision += 1;
        catalog_store.save_catalog(ACCOUNT_KEY, Some(expected_revision), mutated).unwrap();

        let failure = CommandErrorDto::operation_failed("contact sync failed");
        let returned = rollback_contact_sync_failure(&root, &original, failure);
        assert_eq!(returned.code, crate::constants::COMMAND_ERROR_OPERATION_FAILED);
        assert_eq!(catalog_store.load_catalog(ACCOUNT_KEY).unwrap().unwrap(), original);

        let _ = std::fs::remove_dir_all(root);
    }
}
