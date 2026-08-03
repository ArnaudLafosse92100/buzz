# Local macOS Signing And Secret Storage

Locally signed Tauri builds have no Apple Team ID. The legacy macOS Keychain
therefore records each build's `cdhash`, which changes on every rebuild and
makes the `buzz-desktop` prompt return after selecting "Always Allow".

Buzz keeps the reusable local-build fix in the repo:

- `desktop/scripts/install-local-macos-app.sh` signs and installs `Buzz.app`.
- `just desktop-rebuild-install-local-macos` builds and installs one exact
  target-specific bundle with a staged, rollback-safe swap.
- `just desktop-install-local-macos` remains available only when deliberately
  signing an already-built bundle.
- `just desktop-signing-status` verifies the installed signature and local
  secret readiness.
- The local installer fails closed unless the `buzz-desktop` executable embeds
  the `BUZZ_LOCAL_FILE_SECRETS_V1` build marker. A future update built without
  `local-file-secrets` is rejected before it can replace the working app.
- Builds with `local-file-secrets` cannot enable Tauri's auto-updater, even if
  updater environment variables are present. Future local updates must pass
  through `just desktop-rebuild-install-local-macos` and its verification gate.
- Local builds enable `local-file-secrets`. The first launch imports the
  existing Keychain blob into
  `~/Library/Application Support/xyz.block.buzz.app/secrets.local.json`, written
  atomically with owner-only (`0600`) permissions. The Keychain item remains as
  a recovery backup but is not read again.

## First Setup On A Mac

Create the local signing identity once while rebuilding and installing, then
verify:

```bash
. ./bin/activate-hermit
just desktop-rebuild-install-local-macos --create-identity
just desktop-signing-status
```

The first launch may still show one final Keychain prompt for `buzz-desktop`.
Choose "Allow" once so Buzz can import the existing blob. Later local installs
read `secrets.local.json` instead and no longer touch that Keychain item.

## Later Local Rebuilds

After the identity exists on that machine:

```bash
. ./bin/activate-hermit
just desktop-rebuild-install-local-macos
just desktop-signing-status
```

## New Computer

Use the same first-setup flow on the new Mac. This creates a new local signing
identity. If a migrated Keychain blob exists, approve its one-time import;
otherwise Buzz creates the local blob directly.

The deployment recipe stages and verifies the new app beside the destination,
then swaps it into place. If final verification fails, it restores the previous
Buzz bundle. It refuses to replace a destination that is not the expected Buzz
bundle identifier.

Never commit `secrets.local.json`, `.p12`, `.pfx`, `.pem`, or private-key files.
The local file is protected by Unix permissions and the Mac's disk encryption,
not by per-access Keychain authorization. Official Apple-signed builds keep the
normal Keychain backend because they do not enable `local-file-secrets`.

## Expected Healthy Status

`just desktop-signing-status` should report:

```text
signature=valid
local_secret_backend=embedded
local_secret_store=ready
local_secret_permissions=600
local_signing_identity=present
```

The designated requirement must look like:

```text
designated => identifier "xyz.block.buzz.app" and certificate leaf = H"..."
```

If it says `designated => cdhash`, the installed app is still ad-hoc signed.
