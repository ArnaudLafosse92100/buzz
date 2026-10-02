#!/usr/bin/env bash
# Read-only readiness check for Buzz + the full OpenConfig execution topology.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
require_openrouter=false
live_route=false

usage() {
    echo "usage: $0 [--require-openrouter] [--live-route|--live-glm]" >&2
    exit 64
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --require-openrouter) require_openrouter=true ;;
        --live-route|--live-glm) live_route=true; require_openrouter=true ;;
        *) usage ;;
    esac
    shift
done

opencode_bin="${BUZZ_OPENCONFIG_OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
openconfig_root="${OPENCONFIG_ROOT:-/Volumes/PERSO/OpenConfig}"
buzz_config="$HOME/.buzz/opencode.json"
buzz_omo_config="$HOME/.buzz/.opencode/oh-my-openagent.json"
source_omo_config="$openconfig_root/oh-my-openagent.json"
normal_config_dir="$("$openconfig_root/oc" profile path normal)"
normal_omo_config="$normal_config_dir/oh-my-openagent.json"

# Match the ACP adapter: Buzz is launched outside an interactive shell, so
# provider credentials must be loaded through OpenConfig's allowlist parser.
# Do not `source` the dotenv file; it can contain shell-sensitive values.
source "$openconfig_root/lib/common.sh"
oc_export_env_file "$openconfig_root/.env"
oc_telemetry_off

for command in jq "$opencode_bin" "$openconfig_root/oc"; do
    [[ -x "$command" || "$(command -v "$command" 2>/dev/null || true)" != "" ]] \
        || { echo "missing required command: $command" >&2; exit 69; }
done
for file in "$buzz_config" "$buzz_omo_config" "$source_omo_config" "$normal_omo_config"; do
    [[ -r "$file" ]] || { echo "missing required configuration: $file" >&2; exit 66; }
    jq -e . "$file" >/dev/null
done

# Buzz's fallback config owns provider connectivity only. Persona model routing
# is resolved from OpenConfig's named `normal` profile by the ACP adapter.
jq -e '
  (.enabled_providers | index("openrouter"))
  and (.enabled_providers | index("subscription-gateway"))
  and ((.enabled_providers | index("openai")) | not)
  and (.provider["subscription-gateway"].models["gpt-5.6-sol"].id == "llm-agent-planning")
  and (.provider["subscription-gateway"].models["gpt-5.6-terra"].id == "llm-agent-implementation")
  and (.provider["subscription-gateway"].models["gpt-5.6-sol-review"].id == "llm-agent-review")
  and ((.agent // {}) | length == 0)
' "$buzz_config" >/dev/null
jq -e '
  .default_run_agent == "sisyphus"
  and ((.agents // {}) | length == 0)
  and ((.categories // {}) | length == 0)
  and ((.disabled_hooks // []) | index("session-notification"))
' "$buzz_omo_config" >/dev/null

expected_agents=(
    sisyphus hephaestus prometheus atlas oracle librarian explore
    multimodal-looker metis momus sisyphus-junior content-aware-research
)
expected_categories=(
    visual-engineering ultrabrain deep artistry quick unspecified-low
    unspecified-high writing bug-hunt refactor-safe arch-review
    content-aware-fast content-aware-deep
)
for name in "${expected_agents[@]}"; do
    jq -e --arg name "$name" '.agents[$name] != null' "$source_omo_config" >/dev/null \
        || { echo "OpenConfig agent missing: $name" >&2; exit 1; }
done

node "$repo_root/scripts/test-buzz-openconfig-manifest.mjs"
for name in "${expected_categories[@]}"; do
    jq -e --arg name "$name" '.categories[$name] != null' "$source_omo_config" >/dev/null \
        || { echo "OpenConfig category missing: $name" >&2; exit 1; }
done

"$openconfig_root/oc" validate --quiet
echo "Static full-capacity configuration is ready: 12 agents, 13 categories, 7 teams."

providers="$($opencode_bin providers list 2>/dev/null || true)"
if ! /usr/bin/grep -q 'OpenRouter' <<<"$providers"; then
    if [[ "$require_openrouter" == true ]]; then
        echo "OpenRouter has no OpenCode credential yet. Connect it, then rerun this check." >&2
        exit 2
    fi
    echo "OpenRouter is intentionally not connected yet; static setup is complete."
    exit 0
fi

echo "OpenRouter credential detected."
if [[ "$live_route" == true ]]; then
    sisyphus_model="$("$openconfig_root/oc" profile resolve normal agents sisyphus | jq -r .model)"
    output="$(
        cd "$HOME/.buzz"
        OPENCODE_CONFIG_DIR="$normal_config_dir" "$opencode_bin" run --model "$sisyphus_model" \
            'Reply with exactly: OPENCONFIG_NORMAL_OK' 2>&1
    )" || { echo "$output" >&2; exit 1; }
    /usr/bin/grep -q 'OPENCONFIG_NORMAL_OK' <<<"$output" \
        || { echo "The resolved normal Sisyphus route did not return the expected marker." >&2; exit 1; }
    echo "Live OpenConfig normal Sisyphus route is ready ($sisyphus_model)."
fi
