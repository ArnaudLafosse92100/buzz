# Buzz

Desktop chat shell with:

- Tauri + React + TypeScript + Vite
- Tailwind CSS
- shadcn/ui-ready shared components
- Biome (lint/format/check)
- Feature-driven frontend structure

## Scripts

- `pnpm dev` - run the web frontend
- `pnpm tauri dev` - run the desktop app
- `pnpm build` - typecheck and build frontend
- `pnpm typecheck` - TypeScript checks
- `pnpm lint` - Biome lint
- `pnpm format` - Biome format (write)
- `pnpm check` - Biome check

## Local macOS Install

Locally signed builds have no Apple Team ID, so macOS Keychain authorizes each
new binary hash separately. After every rebuild, the `buzz-desktop` item can
ask again even when "Always Allow" was selected before.

Use the canonical rebuild-and-install recipe so the signed bundle cannot drift
from the target that was just built:

```bash
just desktop-rebuild-install-local-macos --create-identity
just desktop-signing-status
```

After the first run, omit `--create-identity`. The recipe stages and verifies
the new app before swapping it into `/Applications`, and restores the previous
bundle if final verification fails. On its first launch the local build imports
the existing Keychain blob once into `secrets.local.json` with mode `0600`.
Later local rebuilds use that file and do not ask for Keychain authorization.
The original Keychain item is retained as a recovery backup.
The installer also verifies the embedded `BUZZ_LOCAL_FILE_SECRETS_V1` marker
and refuses any future local update built without this backend.

See [Desktop Local macOS Signing](../docs/desktop-local-macos-signing.md) for
the migration and new-machine runbook.

## Structure

- `src/shared` - reusable app-wide code (`ui`, `lib`, `styles`)
- `src/features` - feature modules (vertical slices)
- `src/app` - top-level app composition
