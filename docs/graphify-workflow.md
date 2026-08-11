# Graphify workflow

Graphify is a local derived architecture index for Buzz. It accelerates code
navigation and impact discovery, but it is not evidence of relay/database
state, Nostr authorization, deployment, CI, signing identity, Block-internal
repositories, or CRM/Buzz production integration.

## Corpus and confidentiality

The routine corpus is defined by [`.graphifyignore`](../.graphifyignore). It
keeps supported code from the Rust crates, desktop/Tauri, web and admin clients,
mobile application, migrations, scripts, examples, and benchmarks, including
tests. It excludes Hermit and agent state, dependencies, targets/builds,
documentation, YAML, public/static assets, media, credentials, caches,
fixtures/generated output, and Graphify state.

Graphify 0.9.39 classifies YAML as documentation rather than AST-supported
code, so workflow/deployment YAML must be inspected directly. Semantic
extraction requires an explicit allowlist, approved provider, privacy decision,
and budget. MCP, memory, global graph, URL ingestion, wiki/Obsidian, and CI are
not enabled.

## Pinned environment and rebuild

Use only:

```sh
/Users/arnaud/.local/share/buzz-crm-graphify/.venv/bin/graphify --version
```

It must return `graphify 0.9.39`. To recreate it:

```sh
uv venv /Users/arnaud/.local/share/buzz-crm-graphify/.venv
uv pip install \
  --python /Users/arnaud/.local/share/buzz-crm-graphify/.venv/bin/python \
  'graphifyy[sql,watch]==0.9.39'
```

Before replacing `graphify-out/`, move it to a timestamped directory under
`/Volumes/PERSO/Buzz-CRM-graphify-backups/` and verify file counts and SHA-256
hashes. The operational graph must be directed, clustered, normalized,
code-only, and ignored by Git. Never retain a `--no-cluster` build as the
operational graph.

```sh
/Users/arnaud/.local/share/buzz-crm-graphify/.venv/bin/graphify \
  update /Volumes/PERSO/Buzz-CRM --force
node scripts/verify-graphify-output.mjs graphify-out/graph.json
```

The verifier rejects empty or undirected graphs, missing or duplicate IDs,
dangling endpoints, absolute/historical/prohibited paths, non-AST nodes,
Graphify memory, missing expected source roots, and any new, changed, or deleted
eligible source not reflected in the graph.

## Automatic freshness

The native recursive watcher is not used on the external volume. A lightweight
controller checks the eligible corpus every 30 seconds and invokes the pinned
`graphify update` only when the verifier emits exactly one canonical freshness
error. Structural or ambiguous failures are logged and fail closed.

```sh
cat /Users/arnaud/.local/share/buzz-crm-graphify/autosync.pid
ps -p "$(cat /Users/arnaud/.local/share/buzz-crm-graphify/autosync.pid)"
tail -f /Users/arnaud/.local/share/buzz-crm-graphify/autosync.log
```

The macOS `com.arnaud.graphify-autosync` LaunchAgent starts this controller at
login, waits for `/Volumes/PERSO`, and relaunches it after failure. Post-commit
and post-checkout hooks use only the exact pinned interpreter and never fall
back to `.graphify_python`, `PATH`, global Graphify, `python3`, or `python`.

## Query discipline

Use `query`, `path`, `affected`, and `explain` for orientation, then inspect the
referenced source. Do not save results under `graphify-out/memory/`. Inspect
YAML, live relay/database state, CI/deployment systems, signing state, and
external repositories directly when those are authoritative.
