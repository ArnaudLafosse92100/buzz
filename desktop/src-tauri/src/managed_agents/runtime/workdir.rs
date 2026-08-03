use std::{collections::BTreeMap, path::PathBuf};

/// User-configurable working directory consumed at the local-spawn boundary.
pub(super) const AGENT_WORKDIR_ENV_VAR: &str = "BUZZ_AGENT_WORKDIR";

pub(super) fn resolve_agent_workdir(
    env: &BTreeMap<String, String>,
) -> Result<Option<PathBuf>, String> {
    let Some(raw) = env
        .get(AGENT_WORKDIR_ENV_VAR)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(super::super::default_agent_workdir());
    };

    let requested = PathBuf::from(raw);
    if !requested.is_absolute() {
        return Err(format!(
            "{AGENT_WORKDIR_ENV_VAR} must be an absolute path: {raw}"
        ));
    }
    let metadata = std::fs::metadata(&requested)
        .map_err(|error| format!("{AGENT_WORKDIR_ENV_VAR} is not accessible at {raw}: {error}"))?;
    if !metadata.is_dir() {
        return Err(format!(
            "{AGENT_WORKDIR_ENV_VAR} must point to a directory: {raw}"
        ));
    }

    requested
        .canonicalize()
        .map(Some)
        .map_err(|error| format!("failed to resolve {AGENT_WORKDIR_ENV_VAR} at {raw}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_workdir_resolves_to_existing_absolute_directory() {
        let temp = tempfile::tempdir().expect("temp dir");
        let env = BTreeMap::from([(
            AGENT_WORKDIR_ENV_VAR.to_string(),
            temp.path().display().to_string(),
        )]);

        let resolved = resolve_agent_workdir(&env)
            .expect("valid workdir")
            .expect("explicit workdir");
        assert_eq!(
            resolved,
            temp.path().canonicalize().expect("canonical path")
        );
    }

    #[test]
    fn relative_workdir_is_rejected() {
        let env = BTreeMap::from([(
            AGENT_WORKDIR_ENV_VAR.to_string(),
            "relative/repo".to_string(),
        )]);
        let error = resolve_agent_workdir(&env).expect_err("relative path must fail");
        assert!(error.contains("must be an absolute path"), "{error}");
    }

    #[test]
    fn missing_workdir_is_rejected() {
        let temp = tempfile::tempdir().expect("temp dir");
        let missing = temp.path().join("missing");
        let env = BTreeMap::from([(
            AGENT_WORKDIR_ENV_VAR.to_string(),
            missing.display().to_string(),
        )]);
        let error = resolve_agent_workdir(&env).expect_err("missing path must fail");
        assert!(error.contains("is not accessible"), "{error}");
    }
}
