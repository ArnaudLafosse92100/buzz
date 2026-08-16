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

The pinned code-only workflow classifies YAML as documentation rather than AST-supported
code, so workflow/deployment YAML must be inspected directly. Semantic
extraction requires an explicit allowlist, approved provider, privacy decision,
and budget. MCP, global graph, URL ingestion, wiki/Obsidian, and CI are not
enabled. Work memory lives outside the scanned repository at
`/Users/arnaud/.local/share/buzz-crm-graphify/memory`.

## Pinned environment and rebuild

Use only:

```sh
/Users/arnaud/.local/share/buzz-crm-graphify/.venv/bin/graphify --version
```

It must return `graphify 0.9.44`. To recreate it:

```sh
uv venv /Users/arnaud/.local/share/buzz-crm-graphify/.venv
uv pip install \
  --python /Users/arnaud/.local/share/buzz-crm-graphify/.venv/bin/python \
  'graphifyy[sql,watch]==0.9.44'
```

Never delete or reinitialize `graphify-out/` for an upgrade. Preserve the
graph, manifest, labels, reports and reflected memory; take the documented
verified external backup before any staged full extraction. The controller
owns `graphify-out/.graphify_python` and
`graphify-out/.graphify_memory_dir`, which point to the pinned runtime and
external memory and must be used by interactive commands.

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
raw in-tree memory, missing expected source roots, and any new, changed, or deleted
eligible source not reflected in the graph.

## Automatic freshness

The native recursive watcher is not used on the external volume. A lightweight
controller checks the eligible corpus every 30 seconds and invokes the pinned
`graphify update` when the verifier emits exactly one canonical freshness error,
or after recoverably migrating accidental in-tree memory. Other structural or
ambiguous failures are logged and fail closed.

```sh
cat /Users/arnaud/.local/share/buzz-crm-graphify/autosync.pid
ps -p "$(cat /Users/arnaud/.local/share/buzz-crm-graphify/autosync.pid)"
tail -f /Users/arnaud/.local/share/buzz-crm-graphify/autosync.log
```

The macOS `com.arnaud.graphify-autosync` LaunchAgent starts this controller at
login, waits for `/Volumes/PERSO`, and relaunches it after failure. Post-commit
and post-checkout hooks use only the exact pinned interpreter and never fall
back to `.graphify_python`, `PATH`, global Graphify, `python3`, or `python`.
The controller also reflects external memory into
`graphify-out/reflections/LESSONS.md` and `.graphify_learning.json`, and records
separate graph/memory freshness in `health.json`.

`/Users/arnaud/.local/share/buzz-crm-graphify/health.json` is the live authority
for runtime version, pointer paths and graph/memory freshness. This Markdown is
configuration policy, not relay, deployment or integration status. File age or
a recent edit never proves that a mutable Markdown claim is current.

## Query discipline

Use `query`, `path`, `affected`, and `explain` for orientation, then inspect the
referenced source. Save Q&A history only by passing `--memory-dir` with
`/Users/arnaud/.local/share/buzz-crm-graphify/memory`; never save under
`graphify-out/memory/`. Do not mark an outcome before it is observed. Inspect
YAML, live relay/database state, CI/deployment systems, signing state, and
external repositories directly when those are authoritative. AGENTS.md and
reflected lessons are hints, not live status.
