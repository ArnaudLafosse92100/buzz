#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
adapter="$repo_root/scripts/buzz-openconfig-acp.sh"
test_root="$(mktemp -d "${TMPDIR:-/tmp}/buzz-openconfig-acp.XXXXXX")"
test_root="$(cd "$test_root" && pwd -P)"
trap 'rm -rf "$test_root"' EXIT

fake_home="$test_root/home"
prompt_dir="$fake_home/.buzz/.opencode/personas"
mkdir -p "$prompt_dir"
openconfig_dir="$fake_home/.config/opencode"
mkdir -p "$openconfig_dir/lib"
mkdir -p "$openconfig_dir/prompts"
printf '%s\n' '# Test OpenConfig instructions' >"$openconfig_dir/AGENTS.md"
printf '%s\n' '{}' >"$openconfig_dir/opencode.json"
printf '%s\n' '{}' >"$openconfig_dir/oh-my-openagent.json"
cat >"$openconfig_dir/tui.json" <<'JSON'
{
  "theme": "test-theme",
  "attention": {
    "enabled": true,
    "notifications": true,
    "sound": false
  }
}
JSON
cat >"$openconfig_dir/lib/common.sh" <<'SH'
oc_export_env_file() {
  set -a
  # The fixture contains only a non-secret test key.
  source "$1"
  set +a
}
oc_telemetry_off() { :; }
SH
printf '%s\n' 'OPENROUTER_API_KEY=test-openrouter-key' 'LLM_GATEWAY_API_KEY=test-gateway-key' 'LLM_GATEWAY_OPENAI_BASE_URL=https://gateway.example/v1' >"$openconfig_dir/.env"
prompt_file="$prompt_dir/sisyphus.md"
printf '%s\n' "You are Sisyphus. Consult Prometheus, Atlas, Explore, Librarian, Multimodal Looker, Metis, Momus, Content-Aware Research, Sisyphus Junior, Hephaestus, Bug Hunt, and Oracle. Return MESH_OK." >"$prompt_file"

# Simulate the legacy runtime layout, where Buzz symlinked the global TUI
# config directly. The adapter must replace only this runtime symlink while
# leaving the OpenConfig source file unchanged.
legacy_runtime_config_dir="$fake_home/.buzz/.opencode/runtime-config"
mkdir -p "$legacy_runtime_config_dir"
ln -s "$openconfig_dir/tui.json" "$legacy_runtime_config_dir/tui.json"

fake_opencode="$test_root/opencode"
capture="$test_root/capture.json"
cat >"$fake_opencode" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
jq -n \
  --argjson config "$OPENCODE_CONFIG_CONTENT" \
  --arg args "$*" \
  --argjson openrouter_key_present "$(test -n "${OPENROUTER_API_KEY:-}" && printf true || printf false)" \
  --argjson gateway_key_present "$(test -n "${LLM_GATEWAY_API_KEY:-}" && printf true || printf false)" \
  --argjson gateway_url_present "$(test -n "${LLM_GATEWAY_OPENAI_BASE_URL:-}" && printf true || printf false)" \
  --arg runtime_config_dir "${OPENCODE_CONFIG_DIR:-}" \
  --arg xdg_config_home "${XDG_CONFIG_HOME:-}" \
  '{config: $config, args: $args, openrouter_key_present: $openrouter_key_present, gateway_key_present: $gateway_key_present, gateway_url_present: $gateway_url_present, runtime_config_dir: $runtime_config_dir, xdg_config_home: $xdg_config_home}' >"$BUZZ_OPENCONFIG_CAPTURE"
SH
chmod +x "$fake_opencode"

HOME="$fake_home" \
BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE="$prompt_file" \
BUZZ_OPENCONFIG_AGENT_NAME='sisyphus' \
BUZZ_OPENCONFIG_VARIANT='high' \
BUZZ_OPENCONFIG_OPENCODE_BIN="$fake_opencode" \
BUZZ_OPENCONFIG_CAPTURE="$capture" \
OPENCODE_CONFIG_CONTENT='{"share":"disabled","agent":{"existing":{"mode":"subagent"}}}' \
    "$adapter" acp --log-level WARN

jq -e '
  .args == "acp --log-level WARN"
  and .config.share == "disabled"
  and .config.default_agent == "sisyphus"
  and .config.model == "openrouter/z-ai/glm-5.2-exacto"
  and .config.agent.existing.mode == "subagent"
  and .config.agent.sisyphus.mode == "primary"
  and .config.agent.sisyphus.model == "openrouter/z-ai/glm-5.2-exacto"
  and .config.agent.sisyphus.variant == "high"
  and .openrouter_key_present == true
  and .gateway_key_present == true
  and .gateway_url_present == true
  and .runtime_config_dir == $runtime_config_dir
  and .xdg_config_home == $xdg_config_home
  and (.config.agent.sisyphus.prompt | startswith("You are Sisyphus. Consult Prometheus, Atlas, Explore, Librarian, Multimodal Looker, Metis, Momus, Content-Aware Research, Sisyphus Junior, Hephaestus, Bug Hunt, and Oracle. Return MESH_OK."))
  and (.config.agent.sisyphus.prompt | contains("## Buzz delivery contract"))
  and (.config.agent.sisyphus.prompt | contains("Return the complete answer as your ordinary OpenCode final"))
  and (.config.agent.sisyphus.prompt | contains("when no successful explicit main"))
  and (.config.agent.sisyphus.prompt | contains("response has already been published"))
  and (.config.agent.sisyphus.prompt | contains("buzz messages send --channel <channel-uuid> --reply-to <event-id> --content -"))
  and (.config.agent.sisyphus.prompt | contains("Your OpenCode final text is not itself a Buzz channel message") | not)
  and (.config.agent | has("buzz-persona") | not)
  and (.config.agent.sisyphus.prompt | test("\\b(Genie|Merlin|Hercules|Hades|Mushu|Jiminy Cricket|Tarzan|Moana|Belle|Rapunzel|Mulan|Yzma|Basil)\\b|Lumière") | not)
' \
  --arg runtime_config_dir "$fake_home/.buzz/.opencode/runtime-config" \
  --arg xdg_config_home "$fake_home/.buzz/.opencode/xdg-config" \
  "$capture" >/dev/null || {
  jq . "$capture" >&2
  exit 1
}

runtime_config_dir="$fake_home/.buzz/.opencode/runtime-config"
xdg_config_home="$fake_home/.buzz/.opencode/xdg-config"
test -L "$xdg_config_home/opencode"
test "$(readlink "$xdg_config_home/opencode")" = "$runtime_config_dir"
for config_entry in AGENTS.md opencode.json oh-my-openagent.json prompts; do
  test -L "$runtime_config_dir/$config_entry"
  test "$(readlink "$runtime_config_dir/$config_entry")" = "$openconfig_dir/$config_entry"
done
test -f "$runtime_config_dir/tui.json"
test ! -L "$runtime_config_dir/tui.json"
jq -e '
  .theme == "test-theme"
  and .attention.enabled == true
  and .attention.notifications == false
  and .attention.sound == false
' "$runtime_config_dir/tui.json" >/dev/null
jq -e '.attention.notifications == true' "$openconfig_dir/tui.json" >/dev/null
test ! -e "$openconfig_dir/package.json"
test ! -e "$openconfig_dir/package-lock.json"
test ! -e "$openconfig_dir/node_modules"

# An intentionally absent upstream variant must remove any stale base override.
capture_default="$test_root/capture-default.json"
HOME="$fake_home" \
BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE="$prompt_file" \
BUZZ_OPENCONFIG_AGENT_NAME='multimodal-looker' \
BUZZ_OPENCONFIG_OPENCODE_BIN="$fake_opencode" \
BUZZ_OPENCONFIG_CAPTURE="$capture_default" \
OPENCODE_CONFIG_CONTENT='{"agent":{"multimodal-looker":{"variant":"stale"}}}' \
    "$adapter"
jq -e '.config.agent["multimodal-looker"] | has("variant") | not' "$capture_default" >/dev/null

if HOME="$fake_home" \
    BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE="$prompt_file" \
    BUZZ_OPENCONFIG_VARIANT='xhigh' \
    BUZZ_OPENCONFIG_OPENCODE_BIN="$fake_opencode" \
    "$adapter" >/dev/null 2>&1; then
    echo "expected invalid-variant rejection" >&2
    exit 1
fi

if HOME="$fake_home" \
    BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE="$test_root/outside.md" \
    BUZZ_OPENCONFIG_OPENCODE_BIN="$fake_opencode" \
    "$adapter" >/dev/null 2>&1; then
    echo "expected prompt-path rejection" >&2
    exit 1
fi

printf '%s\n' "outside" >"$test_root/outside.md"
if HOME="$fake_home" \
    BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE="$prompt_dir/../../../../outside.md" \
    BUZZ_OPENCONFIG_OPENCODE_BIN="$fake_opencode" \
    "$adapter" >/dev/null 2>&1; then
    echo "expected persona path-traversal rejection" >&2
    exit 1
fi

echo "buzz-openconfig-acp tests passed"
