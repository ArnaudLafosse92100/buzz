#!/usr/bin/env bash
# Read-only readiness check for Buzz + the full OpenConfig execution topology.

set -euo pipefail

require_openrouter=false
live_glm=false

usage() {
    echo "usage: $0 [--require-openrouter] [--live-glm]" >&2
    exit 64
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --require-openrouter) require_openrouter=true ;;
        --live-glm) live_glm=true; require_openrouter=true ;;
        *) usage ;;
    esac
    shift
done

opencode_bin="${BUZZ_OPENCONFIG_OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
openconfig_root="${OPENCONFIG_ROOT:-/Volumes/PERSO/OpenConfig}"
buzz_config="$HOME/.buzz/opencode.json"
buzz_omo_config="$HOME/.buzz/.opencode/oh-my-openagent.json"
source_omo_config="$openconfig_root/oh-my-openagent.json"

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
for file in "$buzz_config" "$buzz_omo_config" "$source_omo_config"; do
    [[ -r "$file" ]] || { echo "missing required configuration: $file" >&2; exit 66; }
    jq -e . "$file" >/dev/null
done

# Buzz must delegate to the source OpenConfig topology rather than carrying a
# truncated local copy of the agent/category/team definitions.
jq -e '
  .model == "openrouter/z-ai/glm-5.2-exacto"
  and .small_model == "openrouter/deepseek/deepseek-v4-flash"
  and .default_agent == "sisyphus"
  and (.enabled_providers | index("openrouter"))
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
if [[ "$live_glm" == true ]]; then
    output="$(
        cd "$HOME/.buzz"
        "$opencode_bin" run --model openrouter/z-ai/glm-5.2-exacto \
            'Reply with exactly: GLM_OPENROUTER_OK' 2>&1
    )" || { echo "$output" >&2; exit 1; }
    /usr/bin/grep -q 'GLM_OPENROUTER_OK' <<<"$output" \
        || { echo "GLM did not return the expected readiness marker." >&2; exit 1; }
    echo "Live GLM through OpenRouter is ready."
fi
