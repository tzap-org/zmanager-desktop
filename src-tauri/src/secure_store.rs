//! Native OS secure-store adapter for TZAP private material.

use keyring::{Entry, Error as KeyringError};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::OnceLock;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};
#[cfg(test)]
use zmanager_core::identity_catalog::InMemoryTzapSecretMaterialStore;
use zmanager_core::identity_catalog::{
    FileTzapIdentityCatalogStore, TzapIdentityCatalogStore, TzapSecretMaterialStore, TzapSecretPurpose, TzapSecretRef, TzapSecretStoreError,
    load_inventory_from_catalog, store_inventory_as_catalog,
};
use zmanager_core::local_identity_store::{TzapLocalIdentityInventory, TzapLocalIdentityStore, TzapLocalIdentityStoreError};
use zmanager_core::secrets::SecretBytes;
#[cfg(test)]
use zmanager_tzap_hosted::auth_client::InMemoryTzapSessionStore;
use zmanager_tzap_hosted::auth_client::{TzapAuthError, TzapSessionRecord, TzapSessionStore};

const SERVICE_NAME: &str = "org.tzap.zmanager.identity";
#[cfg(not(test))]
const SESSION_ENVIRONMENT_KEY: &str = "session-environment";

fn session_storage_account_key(account_key: &str) -> String {
    if option_env!("ZMANAGER_TZAP_BUILD_ENV") == Some("staging")
        && std::env::var("ZMANAGER_GUI_TEST_MODE").as_deref() == Ok("1")
        && std::env::var("TZAP_E2E_SECURE_STORE_NAMESPACE").is_err()
    {
        static TEST_SESSION_SCOPE: OnceLock<String> = OnceLock::new();
        let scope = TEST_SESSION_SCOPE.get_or_init(|| format!("gui-test-{}", std::process::id()));
        return format!("{account_key}:{scope}");
    }
    account_key.to_owned()
}

fn account_scope() -> String {
    let test_mode = option_env!("ZMANAGER_TZAP_BUILD_ENV") == Some("staging")
        && std::env::var("ZMANAGER_GUI_TEST_MODE").as_deref() == Ok("1")
        && std::env::var("TZAP_E2E_ENV").as_deref() == Ok("staging");
    if test_mode && let Ok(scope) = std::env::var("TZAP_E2E_SECURE_STORE_NAMESPACE") {
        if !scope.is_empty() && scope.len() <= 128 && scope.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')) {
            return scope;
        }
        panic!("TZAP_E2E_SECURE_STORE_NAMESPACE must be a non-empty, separator-free test namespace");
    }
    "default".to_owned()
}

#[derive(Debug, Clone)]
pub struct NativeTzapSecretStore {
    account_scope: String,
}

#[cfg(test)]
pub(crate) struct InMemoryDesktopTzapSecretStore {
    account_scope: String,
    secrets: InMemoryTzapSecretMaterialStore,
    sessions: InMemoryTzapSessionStore,
}

#[cfg(test)]
impl InMemoryDesktopTzapSecretStore {
    fn new() -> Self {
        static NEXT_TEST_SCOPE: AtomicUsize = AtomicUsize::new(1);
        Self {
            account_scope: format!("unit-test-{}", NEXT_TEST_SCOPE.fetch_add(1, Ordering::Relaxed)),
            secrets: InMemoryTzapSecretMaterialStore::new(),
            sessions: InMemoryTzapSessionStore::new(),
        }
    }

    pub(crate) fn secure_scope(&self) -> &str {
        &self.account_scope
    }

    pub(crate) fn clear_session_environment(&self, _account_key: &str) -> Result<(), TzapAuthError> {
        Ok(())
    }
}

#[cfg(test)]
pub(crate) type AccountTzapSecretStore = InMemoryDesktopTzapSecretStore;
#[cfg(not(test))]
pub(crate) type AccountTzapSecretStore = NativeTzapSecretStore;

pub(crate) fn account_runtime_secret_store() -> AccountTzapSecretStore {
    #[cfg(test)]
    {
        InMemoryDesktopTzapSecretStore::new()
    }
    #[cfg(not(test))]
    {
        NativeTzapSecretStore::for_desktop_account().expect("desktop account secure-store scope is valid")
    }
}

/// Desktop adapter for the shared lifecycle client. Public catalog metadata is
/// persisted on disk, while all private key material is resolved through the
/// native secure store.
pub struct NativeTzapLocalIdentityStore {
    root: PathBuf,
    account_key: String,
}

impl NativeTzapLocalIdentityStore {
    pub fn new(root: impl Into<PathBuf>, account_key: impl Into<String>) -> Result<Self, TzapLocalIdentityStoreError> {
        let account_key = account_key.into();
        NativeTzapSecretStore::for_desktop_account()
            .map_err(|error| TzapLocalIdentityStoreError::Catalog(Box::new(zmanager_core::identity_catalog::TzapIdentityCatalogError::Secret(error))))?;
        Ok(Self { root: root.into(), account_key })
    }

    fn check_account_key(&self, account_key: &str) -> Result<(), TzapLocalIdentityStoreError> {
        if account_key == self.account_key { Ok(()) } else { Err(TzapLocalIdentityStoreError::InvalidField { field: "account_key" }) }
    }

    fn secret_store(&self) -> Result<NativeTzapSecretStore, TzapLocalIdentityStoreError> {
        NativeTzapSecretStore::for_desktop_account()
            .map_err(|error| TzapLocalIdentityStoreError::Catalog(Box::new(zmanager_core::identity_catalog::TzapIdentityCatalogError::Secret(error))))
    }
}

impl TzapLocalIdentityStore for NativeTzapLocalIdentityStore {
    fn load_inventory(&self, account_key: &str) -> Result<TzapLocalIdentityInventory, TzapLocalIdentityStoreError> {
        self.check_account_key(account_key)?;
        let catalog_store = FileTzapIdentityCatalogStore::new(&self.root);
        let secret_store = self.secret_store()?;
        Ok(load_inventory_from_catalog(&catalog_store, &secret_store, account_key)?.unwrap_or_else(TzapLocalIdentityInventory::empty))
    }

    fn save_inventory(&mut self, account_key: &str, inventory: TzapLocalIdentityInventory) -> Result<(), TzapLocalIdentityStoreError> {
        self.check_account_key(account_key)?;
        inventory.validate()?;
        let mut catalog_store = FileTzapIdentityCatalogStore::new(&self.root);
        let mut secret_store = self.secret_store()?;
        store_inventory_as_catalog(&mut catalog_store, &mut secret_store, account_key, &inventory)?;
        Ok(())
    }

    fn clear_inventory(&mut self, account_key: &str) -> Result<(), TzapLocalIdentityStoreError> {
        self.check_account_key(account_key)?;
        let mut catalog_store = FileTzapIdentityCatalogStore::new(&self.root);
        if let Some(catalog) = catalog_store.load_catalog(account_key)? {
            let mut secret_store = self.secret_store()?;
            for identity in &catalog.signing_identities {
                secret_store.delete(TzapSecretPurpose::SigningKey, &identity.signing_key_ref).map_err(|error| {
                    TzapLocalIdentityStoreError::Catalog(Box::new(zmanager_core::identity_catalog::TzapIdentityCatalogError::Secret(error)))
                })?;
            }
            for key in &catalog.recipient_keys {
                secret_store.delete(TzapSecretPurpose::RecipientKey, &key.private_key_ref).map_err(|error| {
                    TzapLocalIdentityStoreError::Catalog(Box::new(zmanager_core::identity_catalog::TzapIdentityCatalogError::Secret(error)))
                })?;
            }
        }
        catalog_store.clear_catalog(account_key)?;
        Ok(())
    }
}

impl NativeTzapSecretStore {
    pub fn new(account_scope: impl Into<String>) -> Result<Self, TzapSecretStoreError> {
        let account_scope = account_scope.into();
        if account_scope.is_empty() || account_scope.contains(':') || account_scope.contains('/') || account_scope.contains('\\') {
            return Err(TzapSecretStoreError::InvalidReference);
        }
        Ok(Self { account_scope })
    }

    pub fn for_desktop_account() -> Result<Self, TzapSecretStoreError> {
        Self::new(account_scope())
    }

    #[cfg(not(test))]
    pub(crate) fn secure_scope(&self) -> &str {
        &self.account_scope
    }

    fn entry(&self, purpose: TzapSecretPurpose, reference: &TzapSecretRef) -> Result<Entry, TzapSecretStoreError> {
        TzapSecretRef::parse(reference.as_str().to_owned())?;
        Entry::new(SERVICE_NAME, &format!("{}:{}:{}", self.account_scope, purpose.as_str(), reference.as_str()))
            .map_err(|error| map_keyring_error(error, reference))
    }

    #[cfg(not(test))]
    fn session_environment_entry(&self, account_key: &str) -> Result<Entry, TzapAuthError> {
        let storage_account_key = session_storage_account_key(account_key);
        Entry::new(SERVICE_NAME, &format!("{}:{}:{}", self.account_scope, SESSION_ENVIRONMENT_KEY, storage_account_key))
            .map_err(|_| TzapAuthError::Storage { message: "Session environment keyring entry failed".to_owned() })
    }

    #[cfg(not(test))]
    pub fn clear_session_environment(&self, account_key: &str) -> Result<(), TzapAuthError> {
        let entry = self.session_environment_entry(account_key)?;
        match entry.delete_credential() {
            Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
            Err(_) => Err(TzapAuthError::Storage { message: "Session environment could not be cleared".to_owned() }),
        }
    }
}

impl TzapSecretMaterialStore for NativeTzapSecretStore {
    fn put(&mut self, purpose: TzapSecretPurpose, material: SecretBytes) -> Result<TzapSecretRef, TzapSecretStoreError> {
        if material.is_empty() {
            return Err(TzapSecretStoreError::Corrupt);
        }
        let reference = TzapSecretRef::generate();
        let entry = self.entry(purpose, &reference)?;
        entry.set_secret(material.expose_secret()).map_err(|error| map_keyring_error(error, &reference))?;
        Ok(reference)
    }

    fn put_at(&mut self, purpose: TzapSecretPurpose, reference: &TzapSecretRef, material: SecretBytes) -> Result<(), TzapSecretStoreError> {
        if material.is_empty() {
            return Err(TzapSecretStoreError::Corrupt);
        }
        let entry = self.entry(purpose, reference)?;
        entry.set_secret(material.expose_secret()).map_err(|error| map_keyring_error(error, reference))
    }

    fn resolve(&self, purpose: TzapSecretPurpose, reference: &TzapSecretRef) -> Result<SecretBytes, TzapSecretStoreError> {
        let entry = self.entry(purpose, reference)?;
        entry.get_secret().map(SecretBytes::from).map_err(|error| map_keyring_error(error, reference))
    }

    fn delete(&mut self, purpose: TzapSecretPurpose, reference: &TzapSecretRef) -> Result<(), TzapSecretStoreError> {
        let entry = self.entry(purpose, reference)?;
        entry.delete_credential().map_err(|error| map_keyring_error(error, reference))
    }
}

impl TzapSessionStore for NativeTzapSecretStore {
    fn save_session(&mut self, account_key: &str, session: TzapSessionRecord) -> Result<(), TzapAuthError> {
        let bytes = serialize_session_record(&session)?;

        let storage_account_key = session_storage_account_key(account_key);
        let entry = Entry::new(SERVICE_NAME, &format!("{}:session:{}", self.account_scope, storage_account_key))
            .map_err(|_| TzapAuthError::Storage { message: "Keyring entry failed".into() })?;

        entry.set_secret(&bytes).map_err(|_| TzapAuthError::Storage { message: "Save to keyring failed".into() })?;
        Ok(())
    }

    fn load_session(&self, account_key: &str) -> Option<TzapSessionRecord> {
        let storage_account_key = session_storage_account_key(account_key);
        let entry = Entry::new(SERVICE_NAME, &format!("{}:session:{}", self.account_scope, storage_account_key)).ok()?;

        let bytes = entry.get_secret().ok()?;
        deserialize_session_record(&bytes).ok()
    }

    fn clear_session(&mut self, account_key: &str) -> Result<(), TzapAuthError> {
        let storage_account_key = session_storage_account_key(account_key);
        let entry = Entry::new(SERVICE_NAME, &format!("{}:session:{}", self.account_scope, storage_account_key))
            .map_err(|_| TzapAuthError::Storage { message: "Keyring entry failed".into() })?;

        match entry.delete_credential() {
            Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(TzapAuthError::Storage { message: format!("Delete failed: {}", e) }),
        }
    }
}

#[cfg(test)]
impl TzapSecretMaterialStore for InMemoryDesktopTzapSecretStore {
    fn put(&mut self, purpose: TzapSecretPurpose, material: SecretBytes) -> Result<TzapSecretRef, TzapSecretStoreError> {
        self.secrets.put(purpose, material)
    }

    fn put_at(&mut self, purpose: TzapSecretPurpose, reference: &TzapSecretRef, material: SecretBytes) -> Result<(), TzapSecretStoreError> {
        self.secrets.put_at(purpose, reference, material)
    }

    fn resolve(&self, purpose: TzapSecretPurpose, reference: &TzapSecretRef) -> Result<SecretBytes, TzapSecretStoreError> {
        self.secrets.resolve(purpose, reference)
    }

    fn delete(&mut self, purpose: TzapSecretPurpose, reference: &TzapSecretRef) -> Result<(), TzapSecretStoreError> {
        self.secrets.delete(purpose, reference)
    }
}

#[cfg(test)]
impl TzapSessionStore for InMemoryDesktopTzapSecretStore {
    fn save_session(&mut self, account_key: &str, session: TzapSessionRecord) -> Result<(), TzapAuthError> {
        session.require_hosted_provenance()?;
        self.sessions.save_session(account_key, session)
    }

    fn load_session(&self, account_key: &str) -> Option<TzapSessionRecord> {
        self.sessions.load_session(account_key).filter(|session| session.require_hosted_provenance().is_ok())
    }

    fn clear_session(&mut self, account_key: &str) -> Result<(), TzapAuthError> {
        self.sessions.clear_session(account_key)
    }
}

fn serialize_session_record(session: &TzapSessionRecord) -> Result<Vec<u8>, TzapAuthError> {
    session.require_hosted_provenance()?;
    serde_json::to_vec(&session.to_secure_json()).map_err(|error| TzapAuthError::Storage { message: format!("Serialize failed: {error}") })
}

fn deserialize_session_record(bytes: &[u8]) -> Result<TzapSessionRecord, TzapAuthError> {
    let value: Value = serde_json::from_slice(bytes).map_err(|error| TzapAuthError::Storage { message: format!("Deserialize failed: {error}") })?;
    let session = TzapSessionRecord::from_secure_json(&value)?;
    session.require_hosted_provenance()?;
    Ok(session)
}

fn map_keyring_error(error: KeyringError, reference: &TzapSecretRef) -> TzapSecretStoreError {
    match error {
        KeyringError::NoEntry => TzapSecretStoreError::Missing { reference: reference.clone() },
        KeyringError::BadEncoding(_) | KeyringError::Ambiguous(_) => TzapSecretStoreError::Corrupt,
        KeyringError::NoStorageAccess(_) => TzapSecretStoreError::Locked,
        KeyringError::PlatformFailure(_) => TzapSecretStoreError::Unavailable,
        KeyringError::Invalid(_, _) | KeyringError::TooLong(_, _) => TzapSecretStoreError::Denied,
        _ => TzapSecretStoreError::Unavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zmanager_tzap_hosted::auth_client::{TzapHostedAuthEnvironment, TzapHostedAuthLaunchConfig, TzapSessionRecord};
    use zmanager_tzap_hosted::trust::TzapIdentityAssurance;

    #[test]
    fn store_scope_rejects_path_or_separator_injection() {
        assert!(NativeTzapSecretStore::new("default").is_ok());
        assert!(NativeTzapSecretStore::new("default:other").is_err());
        assert!(NativeTzapSecretStore::new("../other").is_err());
    }

    #[test]
    fn account_runtime_uses_isolated_in_memory_store_in_unit_tests() {
        let first = account_runtime_secret_store();
        let second = account_runtime_secret_store();
        assert_ne!(first.secure_scope(), second.secure_scope());
        assert!(first.secure_scope().starts_with("unit-test-"));
        assert!(second.secure_scope().starts_with("unit-test-"));
    }

    #[test]
    fn keyring_error_mapping_is_typed_without_echoing_secret_material() {
        let reference = TzapSecretRef::generate();
        let error = map_keyring_error(KeyringError::NoStorageAccess(Box::new(std::io::Error::other("locked"))), &reference);
        assert_eq!(error, TzapSecretStoreError::Locked);
        assert!(!format!("{error}").contains(reference.as_str()));
    }

    #[test]
    fn shared_cli_session_schema_round_trips_through_desktop_storage_codec() {
        let mut session = TzapSessionRecord {
            user_id: Some("staging-user".to_owned()),
            provenance: None,
            audience: "sign.tzap.org".to_owned(),
            access_token: zmanager_tzap_hosted::auth_client::TzapBearerToken::new("fixture-token").unwrap(),
            expires_at_unix_seconds: 10_000,
            identity_assurance: TzapIdentityAssurance::OauthVerifiedEmail,
            selected_org_id: None,
            login_session_id: Some("staging-login".to_owned()),
        };
        let config = TzapHostedAuthLaunchConfig::for_environment(TzapHostedAuthEnvironment::Staging, "zmanager-cli", "http://127.0.0.1:49152/auth/callback");
        let binding = zmanager_tzap_hosted::session_provenance::TzapSessionProvenance::from_launch(&config, "cli-flow-fixture").unwrap();
        session.bind_provenance(binding).unwrap();

        let encoded = serialize_session_record(&session).unwrap();
        let restored = deserialize_session_record(&encoded).unwrap();
        assert_eq!(restored, session);
        let provenance = restored.require_hosted_provenance().unwrap();
        assert_eq!(provenance.auth_flow_id, "cli-flow-fixture");
        assert_eq!(provenance.auth_origin, "https://staging.tzap.org");
        assert_eq!(provenance.environment, TzapHostedAuthEnvironment::Staging);
    }

    #[test]
    fn desktop_storage_codec_rejects_unbound_sessions() {
        let session = TzapSessionRecord {
            user_id: None,
            provenance: None,
            audience: "sign.tzap.org".to_owned(),
            access_token: zmanager_tzap_hosted::auth_client::TzapBearerToken::new("fixture-token").unwrap(),
            expires_at_unix_seconds: 10_000,
            identity_assurance: TzapIdentityAssurance::OauthVerifiedEmail,
            selected_org_id: None,
            login_session_id: None,
        };
        assert!(serialize_session_record(&session).is_err());
    }
}
