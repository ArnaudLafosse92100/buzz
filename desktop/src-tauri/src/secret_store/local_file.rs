use super::{acquire_blob_lock, KeyringProbe, SecretStore};
use std::path::{Path, PathBuf};

const LOCAL_BLOB_FILE: &str = "secrets.local.json";
const LOCAL_BLOB_TOMBSTONE: &str = "secrets.local.deleted";
const LOCAL_FILE_SECRETS_BUILD_MARKER: &str = "BUZZ_LOCAL_FILE_SECRETS_V1";

fn local_secret_data_dir(service: &str) -> Result<PathBuf, String> {
    let identifier = match service {
        "buzz-desktop" => "xyz.block.buzz.app",
        "buzz-desktop-dev" => "xyz.block.buzz.app.dev",
        _ if service.starts_with("buzz-desktop-dev.") => "xyz.block.buzz.app.dev",
        _ => return Err(format!("unsupported local secret service: {service}")),
    };
    dirs::data_dir()
        .map(|path| path.join(identifier))
        .ok_or_else(|| "failed to resolve local app data directory".to_string())
}

fn local_blob_path(service: &str) -> Result<PathBuf, String> {
    Ok(local_secret_data_dir(service)?.join(LOCAL_BLOB_FILE))
}

fn local_blob_tombstone_path(service: &str) -> Result<PathBuf, String> {
    Ok(local_secret_data_dir(service)?.join(LOCAL_BLOB_TOMBSTONE))
}

fn read_local_blob(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "read local secret blob {}: {error}",
            path.display()
        )),
    }
}

fn write_local_blob(path: &Path, bytes: &[u8]) -> Result<(), String> {
    use atomic_write_file::AtomicWriteFile;
    use std::io::Write as _;
    use std::os::unix::fs::PermissionsExt as _;

    let parent = path
        .parent()
        .ok_or_else(|| format!("local secret path has no parent: {}", path.display()))?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create local secret directory {}: {error}",
            parent.display()
        )
    })?;

    let mut file = AtomicWriteFile::open(path)
        .map_err(|error| format!("open local secret blob {}: {error}", path.display()))?;
    file.set_permissions(std::fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("protect local secret blob {}: {error}", path.display()))?;
    file.write_all(bytes)
        .map_err(|error| format!("write local secret blob {}: {error}", path.display()))?;
    file.commit()
        .map_err(|error| format!("commit local secret blob {}: {error}", path.display()))
}

fn local_migration_blocked(service: &str) -> bool {
    local_blob_tombstone_path(service).is_ok_and(|path| path.exists())
}

impl SecretStore {
    pub(super) fn read_blob_raw(&self) -> Result<Option<Vec<u8>>, String> {
        let path = local_blob_path(&self.service)?;
        if let Some(bytes) = read_local_blob(&path)? {
            return Ok(Some(bytes));
        }
        if local_migration_blocked(&self.service) {
            return Ok(None);
        }

        let Some(bytes) = self.read_blob_raw_keyring()? else {
            return Ok(None);
        };
        write_local_blob(&path, &bytes)?;
        let _ = std::fs::remove_file(local_blob_tombstone_path(&self.service)?);
        eprintln!(
            "{LOCAL_FILE_SECRETS_BUILD_MARKER}: imported macOS Keychain secrets into owner-only local storage"
        );
        Ok(Some(bytes))
    }

    pub(super) fn write_blob_raw(&self, bytes: &[u8]) -> Result<(), String> {
        write_local_blob(&local_blob_path(&self.service)?, bytes)?;
        match std::fs::remove_file(local_blob_tombstone_path(&self.service)?) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                eprintln!("buzz-desktop: failed to remove local secret tombstone: {error}");
            }
        }
        Ok(())
    }

    pub(super) fn probe_legacy_key(&self, _key: &str) -> KeyringProbe {
        // The whole legacy blob is imported before load_blob returns. Looking
        // up individual Keychain entries after that would reintroduce prompts
        // and could resurrect a key deliberately deleted from the local blob.
        KeyringProbe::ReachableButEmpty
    }

    pub(super) fn migrate_legacy_key(&self, _key: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    /// Delete the local blob and block recovery from the retained Keychain
    /// backup after an explicit reset.
    pub fn delete_all_with_legacy_cleanup(&self) -> Result<(), String> {
        let _lock = acquire_blob_lock(&self.service)?;
        let path = local_blob_path(&self.service)?;
        match std::fs::remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "delete local secret blob {}: {error}",
                    path.display()
                ));
            }
        }
        write_local_blob(&local_blob_tombstone_path(&self.service)?, b"deleted\n")?;
        let mut guard = self.cache.lock().unwrap_or_else(|error| error.into_inner());
        *guard = None;
        Ok(())
    }

    pub fn verify_fully_wiped(&self) -> bool {
        local_blob_path(&self.service).is_ok_and(|path| !path.exists())
            && local_blob_tombstone_path(&self.service).is_ok_and(|path| path.exists())
    }

    pub fn delete(&self, key: &str) -> Result<(), String> {
        self.mutate_blob(|map| {
            map.remove(key);
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt as _;

    #[test]
    fn local_blob_round_trip_is_owner_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.local.json");
        write_local_blob(&path, br#"{"identity":"nsec1test"}"#).unwrap();

        assert_eq!(
            read_local_blob(&path).unwrap(),
            Some(br#"{"identity":"nsec1test"}"#.to_vec())
        );
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn local_blob_uses_release_app_data_directory() {
        let path = local_blob_path("buzz-desktop").unwrap();
        assert!(path.ends_with("xyz.block.buzz.app/secrets.local.json"));
        assert!(local_blob_path("unrelated-service").is_err());
    }
}
