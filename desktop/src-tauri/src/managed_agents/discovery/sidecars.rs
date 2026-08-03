use super::{
    command_looks_like_path, executable_basename, is_executable_file, normalize_command_identity,
    workspace_root_dir,
};
use std::path::{Path, PathBuf};

const BUNDLED_SIDECAR_COMMANDS: &[&str] = &[
    "buzz-acp",
    "buzz",
    "buzz-agent",
    "buzz-dev-mcp",
    "git-credential-nostr",
];

fn profile_target_dirs(root: &Path) -> [PathBuf; 2] {
    if cfg!(debug_assertions) {
        [root.join("target/debug"), root.join("target/release")]
    } else {
        [root.join("target/release"), root.join("target/debug")]
    }
}

pub(super) fn command_search_dirs_for(
    workspace_root: &Path,
    current_dir: Option<&Path>,
    executable_dir: Option<&Path>,
) -> Vec<PathBuf> {
    // The directory beside the running desktop is authoritative. This keeps a
    // stale workspace target from shadowing the sidecars bundled with the app.
    let mut dirs = executable_dir
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    dirs.extend(profile_target_dirs(workspace_root));
    if let Some(current_dir) = current_dir {
        dirs.extend(profile_target_dirs(current_dir));
    }

    dirs.into_iter().fold(Vec::new(), |mut unique, dir| {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
        unique
    })
}

fn command_search_dirs() -> Vec<PathBuf> {
    let current_dir = std::env::current_dir().ok();
    let executable_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf));
    command_search_dirs_for(
        &workspace_root_dir(),
        current_dir.as_deref(),
        executable_dir.as_deref(),
    )
}

pub(super) fn resolve_command_in_dirs(command: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let file_name = executable_basename(command);
    dirs.iter()
        .map(|dir| dir.join(&file_name))
        .find(|candidate| is_executable_file(candidate))
}

pub(super) fn resolve_workspace_command(command: &str) -> Option<PathBuf> {
    if command_looks_like_path(command) {
        let path = PathBuf::from(command);
        return is_executable_file(&path).then_some(path);
    }
    resolve_command_in_dirs(command, &command_search_dirs())
}

/// Return the authoritative resolution for a sidecar in an installed macOS
/// app bundle. `Some(None)` deliberately fails closed when the bundle applies
/// but its sidecar is missing.
pub(super) fn packaged_macos_sidecar_resolution(
    command: &str,
    current_executable: &Path,
) -> Option<Option<PathBuf>> {
    if command_looks_like_path(command)
        || !BUNDLED_SIDECAR_COMMANDS.contains(&normalize_command_identity(command).as_str())
    {
        return None;
    }

    let executable_dir = current_executable.parent()?;
    let contents_dir = executable_dir.parent()?;
    let is_app_bundle = executable_dir
        .file_name()
        .is_some_and(|name| name == "MacOS")
        && contents_dir
            .file_name()
            .is_some_and(|name| name == "Contents")
        && contents_dir
            .parent()
            .and_then(Path::extension)
            .is_some_and(|extension| extension == "app");
    if !is_app_bundle {
        return None;
    }

    let candidate = executable_dir.join(executable_basename(command));
    Some(is_executable_file(&candidate).then_some(candidate))
}

pub(super) fn resolve_packaged_macos_sidecar(command: &str) -> Option<Option<PathBuf>> {
    std::env::current_exe()
        .ok()
        .and_then(|executable| packaged_macos_sidecar_resolution(command, &executable))
}
