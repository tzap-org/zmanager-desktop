//! Native OS secure-store adapter for TZAP private material.

use keyring::{Entry, Error as KeyringError};
use serde_json::{Value, json};
use std::path::PathBuf;
use zmanager_core::identity_catalog::{
    FileTzapIdentityCatalogStore, TzapIdentityCatalogStore, TzapSecretMaterialStore, TzapSecretPurpose, TzapSecretRef, TzapSecretStoreError,
    load_inventory_from_catalog, store_inventory_as_catalog,
};
use zmanager_core::local_identity_store::{TzapLocalIdentityInventory, TzapLocalIdentityStore, TzapLocalIdentityStoreError};
use zmanager_core::secrets::SecretBytes;
use zmanager_core::trust::TzapIdentityAssurance;
use zmanager_tzap_hosted::auth_client::{TzapAuthError, TzapBearerToken, TzapSessionRecord, TzapSessionStore};

const SERVICE_NAME: &str = "org.tzap.zmanager.identity";
const SESSION_ENVIRONMENT_KEY: &str = "session-environment";

#[derive(Debug, Clone)]
pub struct NativeTzapSecretStore {
    account_scope: String,
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
        NativeTzapSecretStore::new(account_key.clone())
            .map_err(|error| TzapLocalIdentityStoreError::Catalog(Box::new(zmanager_core::identity_catalog::TzapIdentityCatalogError::Secret(error))))?;
        Ok(Self { root: root.into(), account_key })
    }

    fn check_account_key(&self, account_key: &str) -> Result<(), TzapLocalIdentityStoreError> {
        if account_key == self.account_key { Ok(()) } else { Err(TzapLocalIdentityStoreError::InvalidField { field: "account_key" }) }
    }

    fn secret_store(&self) -> Result<NativeTzapSecretStore, TzapLocalIdentityStoreError> {
        NativeTzapSecretStore::new(self.account_key.clone())
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
        store_inventory_as_catalog(&mut catalog_store, &mut secret_store, account_key, &inventory, current_unix_seconds())?;
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

    fn entry(&self, purpose: TzapSecretPurpose, reference: &TzapSecretRef) -> Result<Entry, TzapSecretStoreError> {
        TzapSecretRef::parse(reference.as_str().to_owned())?;
        Entry::new(SERVICE_NAME, &format!("{}:{}:{}", self.account_scope, purpose.as_str(), reference.as_str()))
            .map_err(|error| map_keyring_error(error, reference))
    }

    fn session_environment_entry(&self, account_key: &str) -> Result<Entry, TzapAuthError> {
        Entry::new(SERVICE_NAME, &format!("{}:{}:{}", self.account_scope, SESSION_ENVIRONMENT_KEY, account_key))
            .map_err(|_| TzapAuthError::Storage { message: "Session environment keyring entry failed".to_owned() })
    }

    pub fn save_session_environment(&self, account_key: &str, environment: &str) -> Result<(), TzapAuthError> {
        if !matches!(environment, "local" | "staging" | "prod") {
            return Err(TzapAuthError::Storage { message: "Unsupported hosted environment".to_owned() });
        }
        self.session_environment_entry(account_key)?
            .set_secret(environment.as_bytes())
            .map_err(|_| TzapAuthError::Storage { message: "Session environment could not be stored".to_owned() })
    }

    pub fn load_session_environment(&self, account_key: &str) -> Option<String> {
        let entry = self.session_environment_entry(account_key).ok()?;
        let bytes = entry.get_secret().ok()?;
        let environment = std::str::from_utf8(&bytes).ok()?;
        matches!(environment, "local" | "staging" | "prod").then(|| environment.to_owned())
    }

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
        let json_value = json!({
            "audience": session.audience,
            "access_token": session.access_token.expose(),
            "expires_at_unix_seconds": session.expires_at_unix_seconds,
            "identity_assurance": session.identity_assurance.as_str(),
            "selected_org_id": session.selected_org_id,
            "login_session_id": session.login_session_id,
        });
        let bytes = serde_json::to_vec(&json_value).map_err(|e| TzapAuthError::Storage { message: format!("Serialize failed: {}", e) })?;

        let entry = Entry::new(SERVICE_NAME, &format!("{}:session:{}", self.account_scope, account_key))
            .map_err(|_| TzapAuthError::Storage { message: "Keyring entry failed".into() })?;

        entry.set_secret(&bytes).map_err(|_| TzapAuthError::Storage { message: "Save to keyring failed".into() })?;
        Ok(())
    }

    fn load_session(&self, account_key: &str) -> Option<TzapSessionRecord> {
        let entry = Entry::new(SERVICE_NAME, &format!("{}:session:{}", self.account_scope, account_key)).ok()?;

        let bytes = entry.get_secret().ok()?;
        let value: Value = serde_json::from_slice(&bytes).ok()?;

        let audience = value.get("audience")?.as_str()?.to_string();
        let access_token = TzapBearerToken::new(value.get("access_token")?.as_str()?).ok()?;
        let expires_at_unix_seconds = value.get("expires_at_unix_seconds")?.as_u64()?;
        let identity_assurance = TzapIdentityAssurance::parse(value.get("identity_assurance")?.as_str()?)?;
        let selected_org_id = value.get("selected_org_id").and_then(|v| v.as_str()).map(|s| s.to_string());
        let login_session_id = value.get("login_session_id").and_then(|v| v.as_str()).map(|s| s.to_string());

        Some(TzapSessionRecord { audience, access_token, expires_at_unix_seconds, identity_assurance, selected_org_id, login_session_id })
    }

    fn clear_session(&mut self, account_key: &str) -> Result<(), TzapAuthError> {
        let entry = Entry::new(SERVICE_NAME, &format!("{}:session:{}", self.account_scope, account_key))
            .map_err(|_| TzapAuthError::Storage { message: "Keyring entry failed".into() })?;

        match entry.delete_credential() {
            Ok(_) | Err(KeyringError::NoEntry) => Ok(()),
            Err(e) => Err(TzapAuthError::Storage { message: format!("Delete failed: {}", e) }),
        }
    }
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

fn current_unix_seconds() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |duration| duration.as_secs())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_scope_rejects_path_or_separator_injection() {
        assert!(NativeTzapSecretStore::new("default").is_ok());
        assert!(NativeTzapSecretStore::new("default:other").is_err());
        assert!(NativeTzapSecretStore::new("../other").is_err());
    }

    #[test]
    fn keyring_error_mapping_is_typed_without_echoing_secret_material() {
        let reference = TzapSecretRef::generate();
        let error = map_keyring_error(KeyringError::NoStorageAccess(Box::new(std::io::Error::other("locked"))), &reference);
        assert_eq!(error, TzapSecretStoreError::Locked);
        assert!(!format!("{error}").contains(reference.as_str()));
    }
}
