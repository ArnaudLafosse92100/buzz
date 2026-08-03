use super::*;

impl SecretStore {
    /// Read the whole blob without triggering legacy-key migration.
    pub fn load_all_readonly(&self) -> Result<Option<HashMap<String, String>>, String> {
        #[cfg(feature = "system-keyring")]
        {
            self.load_blob()
        }
        #[cfg(not(feature = "system-keyring"))]
        {
            Err("system-keyring feature disabled".to_string())
        }
    }

    /// Merge all entries into the blob in one mutation.
    pub fn store_all(&self, entries: &HashMap<String, String>) -> Result<(), String> {
        #[cfg(feature = "system-keyring")]
        {
            self.mutate_blob(|map| {
                for (key, value) in entries {
                    map.insert(key.clone(), value.clone());
                }
            })
        }
        #[cfg(not(feature = "system-keyring"))]
        {
            let _ = entries;
            Err("system-keyring feature disabled".to_string())
        }
    }
}
