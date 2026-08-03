use crate::managed_agents::discovery::{clear_resolve_cache, resolve_command};

#[cfg(unix)]
#[test]
fn bundled_sidecar_wins_over_stale_workspace_release_binary() {
    use std::os::unix::fs::PermissionsExt;

    let temp = tempfile::tempdir().expect("tempdir");
    let executable_dir = temp.path().join("Buzz.app/Contents/MacOS");
    let workspace_root = temp.path().join("workspace");
    let stale_release_dir = workspace_root.join("target/release");
    std::fs::create_dir_all(&executable_dir).expect("create executable dir");
    std::fs::create_dir_all(&stale_release_dir).expect("create stale release dir");

    let bundled = executable_dir.join("buzz-acp");
    let stale = stale_release_dir.join("buzz-acp");
    for path in [&bundled, &stale] {
        std::fs::write(path, "#!/bin/sh\n").expect("write executable");
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
            .expect("chmod executable");
    }

    let dirs = super::super::sidecars::command_search_dirs_for(
        &workspace_root,
        Some(&workspace_root),
        Some(&executable_dir),
    );
    let resolved = super::super::sidecars::resolve_command_in_dirs("buzz-acp", &dirs);

    assert_eq!(dirs.first(), Some(&executable_dir));
    assert_eq!(
        resolved.as_deref(),
        Some(bundled.as_path()),
        "the sidecar packaged beside buzz-desktop must remain authoritative"
    );
}

#[cfg(unix)]
#[test]
fn installed_app_missing_sidecar_fails_closed_instead_of_using_workspace() {
    let temp = tempfile::tempdir().expect("tempdir");
    let app_executable = temp.path().join("Buzz.app/Contents/MacOS/buzz-desktop");
    std::fs::create_dir_all(app_executable.parent().expect("executable parent"))
        .expect("create app executable dir");
    std::fs::write(&app_executable, "desktop").expect("write app executable");

    assert_eq!(
        super::super::sidecars::packaged_macos_sidecar_resolution("buzz-acp", &app_executable),
        Some(None),
        "an incomplete app bundle must not fall back to a stale external harness"
    );
    assert_eq!(
        super::super::sidecars::packaged_macos_sidecar_resolution(
            "/explicit/custom/buzz-acp",
            &app_executable
        ),
        None,
        "explicit user paths remain explicit and outside the bundle policy"
    );
}

/// The legacy Goose Windows installer wrote `%USERPROFILE%\goose\goose.exe`,
/// a directory on no standard PATH. `resolve_command_uncached` finds binaries
/// outside PATH only by scanning `common_binary_paths()`, so that directory
/// must appear there or those installs stay undiscovered (#2239 residual).
///
/// Asserts the probe list rather than a planted binary: `common_binary_paths`
/// is a process-lifetime `OnceLock`, so a test cannot re-seed `USERPROFILE`
/// deterministically, and planting an executable under the real user profile
/// is not an acceptable test side effect.
#[cfg(windows)]
#[test]
fn common_binary_paths_probes_legacy_goose_install_dir() {
    use std::path::PathBuf;

    let profile = std::env::var_os("USERPROFILE").expect("USERPROFILE is always set on Windows");
    let legacy_dir = PathBuf::from(profile).join("goose");

    let probed = super::super::common_binary_paths();

    assert!(
        probed.contains(&legacy_dir),
        "legacy Goose install dir {} must be probed, got: {probed:?}",
        legacy_dir.display()
    );
}

#[cfg(unix)]
#[test]
fn resolve_command_prefers_buzz_managed_npm_shim_over_path() {
    use std::os::unix::fs::PermissionsExt;

    let _guard = crate::managed_agents::lock_path_mutex();
    let temp = tempfile::tempdir().expect("tempdir");
    let home = temp.path().join("home");
    let xdg_data = temp.path().join("xdg-data");
    let global_bin = temp.path().join("global-bin");
    std::fs::create_dir_all(&home).expect("create home");
    std::fs::create_dir_all(&xdg_data).expect("create xdg data");
    std::fs::create_dir_all(&global_bin).expect("create global bin");

    let old_home = std::env::var_os("HOME");
    let old_xdg_data = std::env::var_os("XDG_DATA_HOME");
    let old_path = std::env::var_os("PATH").unwrap_or_default();

    std::env::set_var("HOME", &home);
    std::env::set_var("XDG_DATA_HOME", &xdg_data);
    let managed_bin = dirs::data_dir()
        .expect("data dir")
        .join("Buzz")
        .join("node-tools")
        .join("bin");
    std::fs::create_dir_all(&managed_bin).expect("create managed bin");

    let managed_shim = managed_bin.join("codex-acp");
    let global_shim = global_bin.join("codex-acp");
    std::fs::write(&managed_shim, "#!/bin/sh\necho managed\n").expect("write managed shim");
    std::fs::write(&global_shim, "#!/bin/sh\necho global\n").expect("write global shim");
    std::fs::set_permissions(&managed_shim, std::fs::Permissions::from_mode(0o755))
        .expect("chmod managed shim");
    std::fs::set_permissions(&global_shim, std::fs::Permissions::from_mode(0o755))
        .expect("chmod global shim");

    let new_path = std::env::join_paths(
        std::iter::once(global_bin.clone()).chain(std::env::split_paths(&old_path)),
    )
    .expect("join PATH");
    std::env::set_var("PATH", new_path);
    clear_resolve_cache();

    let resolved = resolve_command("codex-acp");

    std::env::set_var("PATH", &old_path);
    match old_home {
        Some(value) => std::env::set_var("HOME", value),
        None => std::env::remove_var("HOME"),
    }
    match old_xdg_data {
        Some(value) => std::env::set_var("XDG_DATA_HOME", value),
        None => std::env::remove_var("XDG_DATA_HOME"),
    }
    clear_resolve_cache();

    assert_eq!(
        resolved.as_deref(),
        Some(managed_shim.as_path()),
        "Buzz-managed npm shim must win over PATH/global shims"
    );
}
