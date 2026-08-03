#!/usr/bin/env bash
# ACP adapter for Buzz personas running through OpenCode/OpenConfig.
#
# OpenCode's ACP server currently accepts session/new.systemPrompt but does not
# make it authoritative over the selected agent identity. Buzz relies on that
# field for persona isolation, so this adapter promotes the persona prompt into
# a dedicated OpenCode primary agent through OPENCODE_CONFIG_CONTENT.

set -euo pipefail

prompt_file="${BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE:-}"
engine_prompt_file="${BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE:-}"
opencode_bin="${BUZZ_OPENCONFIG_OPENCODE_BIN:-$HOME/.opencode/bin/opencode}"
model="${BUZZ_OPENCONFIG_MODEL:-openrouter/z-ai/glm-5.2-exacto}"
variant="${BUZZ_OPENCONFIG_VARIANT:-}"
agent_name="${BUZZ_OPENCONFIG_AGENT_NAME:-buzz-persona}"
openconfig_dir="${BUZZ_OPENCONFIG_CONFIG_DIR:-$HOME/.config/opencode}"
runtime_config_dir="${BUZZ_OPENCONFIG_RUNTIME_CONFIG_DIR:-$HOME/.buzz/.opencode/runtime-config}"
runtime_xdg_config_home="${BUZZ_OPENCONFIG_RUNTIME_XDG_CONFIG_HOME:-$HOME/.buzz/.opencode/xdg-config}"
openconfig_env="$openconfig_dir/.env"
openconfig_common="$openconfig_dir/lib/common.sh"

# OpenCode installs its SDK dependency into OPENCODE_CONFIG_DIR. Keep that
# mutable runtime state out of the pinned OpenConfig checkout, otherwise every
# agent restart recreates package.json, package-lock.json, and node_modules in
# the source tree. The effective config remains source-of-truth through these
# read-only-facing symlinks while OpenCode owns only the isolated runtime dir.
umask 077
mkdir -p "$runtime_config_dir"
mkdir -p "$runtime_xdg_config_home"
runtime_config_dir="$(cd "$runtime_config_dir" && pwd -P)"
runtime_xdg_config_home="$(cd "$runtime_xdg_config_home" && pwd -P)"
openconfig_dir="$(cd "$openconfig_dir" && pwd -P)"
if [[ "$runtime_config_dir" == "$openconfig_dir" ]]; then
    echo "buzz-openconfig-acp: runtime config directory must differ from OpenConfig source" >&2
    exit 64
fi
if ! command -v jq >/dev/null 2>&1; then
    echo "buzz-openconfig-acp: jq is required" >&2
    exit 69
fi
xdg_opencode_dir="$runtime_xdg_config_home/opencode"
if [[ -e "$xdg_opencode_dir" && ! -L "$xdg_opencode_dir" ]]; then
    echo "buzz-openconfig-acp: refusing to replace runtime XDG config entry: $xdg_opencode_dir" >&2
    exit 73
fi
ln -sfn "$runtime_config_dir" "$xdg_opencode_dir"
for config_entry in \
    AGENTS.md \
    opencode.json \
    oh-my-openagent.json \
    prompts \
    profiles \
    skills \
    teams \
    agents \
    projects.json; do
    source_path="$openconfig_dir/$config_entry"
    target_path="$runtime_config_dir/$config_entry"
    [[ -e "$source_path" ]] || continue
    if [[ -e "$target_path" && ! -L "$target_path" ]]; then
        echo "buzz-openconfig-acp: refusing to replace runtime config entry: $target_path" >&2
        exit 73
    fi
    ln -sfn "$source_path" "$target_path"
done

# OpenCode's TUI attention settings are process-wide. Reusing the pinned
# `tui.json` verbatim makes every headless Buzz ACP session emit its own macOS
# "Agent is ready for input" notification. Generate a Buzz-owned runtime copy
# instead: preserve every upstream TUI preference while disabling only native
# OpenCode notifications. The pinned source remains untouched, so ordinary
# OpenCode sessions keep their existing notification behavior.
source_tui="$openconfig_dir/tui.json"
runtime_tui="$runtime_config_dir/tui.json"
if [[ -e "$runtime_tui" && ! -f "$runtime_tui" ]]; then
    echo "buzz-openconfig-acp: refusing to replace non-file runtime TUI config: $runtime_tui" >&2
    exit 73
fi
if [[ -e "$source_tui" && ! -r "$source_tui" ]]; then
    echo "buzz-openconfig-acp: OpenConfig TUI config is not readable: $source_tui" >&2
    exit 66
fi
if [[ -e "$source_tui" ]] && ! jq -e 'type == "object"' "$source_tui" >/dev/null; then
    echo "buzz-openconfig-acp: OpenConfig TUI config must be a JSON object: $source_tui" >&2
    exit 65
fi
runtime_tui_tmp="$(mktemp "$runtime_config_dir/.tui.json.XXXXXX")"
if [[ -e "$source_tui" ]]; then
    if ! jq '.attention = ((.attention // {}) + {notifications: false})' \
        "$source_tui" >"$runtime_tui_tmp"; then
        rm -f -- "$runtime_tui_tmp"
        echo "buzz-openconfig-acp: failed to generate Buzz TUI config" >&2
        exit 74
    fi
else
    if ! jq -n '{attention: {notifications: false}}' >"$runtime_tui_tmp"; then
        rm -f -- "$runtime_tui_tmp"
        echo "buzz-openconfig-acp: failed to generate minimal Buzz TUI config" >&2
        exit 74
    fi
fi
if ! mv -f -- "$runtime_tui_tmp" "$runtime_tui"; then
    rm -f -- "$runtime_tui_tmp"
    echo "buzz-openconfig-acp: failed to install Buzz TUI config: $runtime_tui" >&2
    exit 74
fi
# OpenCode also initializes its conventional XDG config path even when
# OPENCODE_CONFIG_DIR is set. Point both paths at the same isolated directory;
# otherwise ~/.config/opencode may still resolve to the pinned source checkout
# and receive generated package files.
export XDG_CONFIG_HOME="$runtime_xdg_config_home"
export OPENCODE_CONFIG_DIR="$runtime_config_dir"

# The desktop app does not start through the user's interactive shell, so it
# does not inherit the OpenConfig .env automatically. Reuse OpenConfig's
# allowlist parser instead of sourcing the dotenv file: only model-provider
# credentials and the documented telemetry safeguards reach the ACP process.
if [[ -r "$openconfig_env" ]]; then
    if [[ ! -r "$openconfig_common" ]]; then
        echo "buzz-openconfig-acp: OpenConfig environment loader is missing: $openconfig_common" >&2
        exit 69
    fi
    # shellcheck source=/dev/null
    source "$openconfig_common"
    oc_export_env_file "$openconfig_env"
    oc_telemetry_off
fi

# Buzz uses the canonical OpenConfig identity directly. Keeping the same slug
# and vocabulary across prompts, logs, teams, and upstream updates avoids a
# translation layer that can drift after a rebuild.
if [[ ! "$agent_name" =~ ^[a-z][a-z0-9-]{0,63}$ ]]; then
    echo "buzz-openconfig-acp: BUZZ_OPENCONFIG_AGENT_NAME must be a lowercase slug" >&2
    exit 64
fi
if [[ -n "$variant" && ! "$variant" =~ ^(low|medium|high|max)$ ]]; then
    echo "buzz-openconfig-acp: BUZZ_OPENCONFIG_VARIANT must be low, medium, high, max, or empty" >&2
    exit 64
fi

if [[ -z "$prompt_file" ]]; then
    echo "buzz-openconfig-acp: BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE is required" >&2
    exit 64
fi

if [[ ! -f "$prompt_file" || ! -r "$prompt_file" ]]; then
    echo "buzz-openconfig-acp: persona prompt is not readable: $prompt_file" >&2
    exit 66
fi
prompt_file="$(cd "$(dirname "$prompt_file")" && pwd -P)/$(basename "$prompt_file")"
persona_root="$(cd "$HOME/.buzz/.opencode/personas" && pwd -P)"
case "$prompt_file" in
    "$persona_root/"*.md) ;;
    *)
        echo "buzz-openconfig-acp: persona prompt must be under ~/.buzz/.opencode/personas" >&2
        exit 64
        ;;
esac
if [[ ! -x "$opencode_bin" ]]; then
    echo "buzz-openconfig-acp: OpenCode binary is not executable: $opencode_bin" >&2
    exit 69
fi
base_config="${OPENCODE_CONFIG_CONTENT-}"
if [[ -z "$base_config" ]]; then
    base_config="{}"
fi
if ! jq -e 'type == "object"' >/dev/null 2>&1 <<<"$base_config"; then
    echo "buzz-openconfig-acp: OPENCODE_CONFIG_CONTENT must be a JSON object" >&2
    exit 65
fi

persona_prompt="$(< "$prompt_file")"
if [[ -n "$engine_prompt_file" ]]; then
    if [[ ! -f "$engine_prompt_file" || ! -r "$engine_prompt_file" ]]; then
        echo "buzz-openconfig-acp: engine prompt is not readable: $engine_prompt_file" >&2
        exit 66
    fi
    engine_prompt_file="$(cd "$(dirname "$engine_prompt_file")" && pwd -P)/$(basename "$engine_prompt_file")"
    case "$engine_prompt_file" in
        /Volumes/PERSO/OpenConfig/prompts/*.md) ;;
        *)
            echo "buzz-openconfig-acp: engine prompt must be under /Volumes/PERSO/OpenConfig/prompts" >&2
            exit 64
            ;;
    esac
    engine_prompt="$(< "$engine_prompt_file")"
    persona_prompt="$persona_prompt

## OpenConfig execution profile

The Buzz persona above remains the authoritative identity and governance
contract. Apply the following OpenConfig technical execution profile within
that role:

$engine_prompt"
fi

# Keep the delivery contract in the shared adapter rather than duplicating it
# across every public persona prompt. buzz-acp captures the ordinary ACP final
# response and publishes it into the originating Buzz conversation. Explicit
# CLI sends remain available for delegations and additional intentional posts.
persona_prompt="$persona_prompt

## Buzz delivery contract

Return the complete answer as your ordinary OpenCode final response. The Buzz
harness publishes that final response into the originating channel or direct
message, preserving its thread topology, when no successful explicit main
response has already been published.

Use the Buzz CLI only when the task requires an additional intentional post,
such as delegating to another persona, posting outside the originating
conversation, or broadcasting. When you deliberately use the CLI for the main
response, publish the complete response exactly once using the channel UUID
and event ID from the event context:

buzz messages send --channel <channel-uuid> --reply-to <event-id> --content -

Write that response to the command's standard input. A confirmed successful
main-response send suppresses the harness fallback, so do not repeat it in a
second post. Replying in the originating Buzz conversation is always allowed
even when the task is otherwise read-only; do not make any other system,
repository, configuration, membership, or deployment change unless the request
explicitly authorizes it. Do not publish progress chatter."
opencode_config_content="$(
    jq -cn \
        --argjson base "$base_config" \
        --arg model "$model" \
        --arg variant "$variant" \
        --arg agent_name "$agent_name" \
        --arg prompt "$persona_prompt" \
        '
        $base
        * {
            # ACP creates its session from the resolved top-level model.  Keep
            # this runtime override aligned with the named primary agent so a
            # project-level Buzz fallback cannot collapse every persona onto
            # the same model.
            model: $model,
            default_agent: $agent_name,
            agent: (
                ($base.agent // {})
                * {
                    ($agent_name): {
                        description: "Buzz managed persona",
                        mode: "primary",
                        model: $model,
                        prompt: $prompt
                    }
                }
            )
        }
        | if $variant == "" then
            del(.agent[$agent_name].variant)
          else
            .agent[$agent_name].variant = $variant
          end
        '
)"
export OPENCODE_CONFIG_CONTENT="$opencode_config_content"

# Custom harness definitions use no arguments. Tolerate the preset-style
# redundant "acp" argument as well so the adapter remains safe if selected as
# an explicit command override on an older record.
if [[ "${1:-}" == "acp" ]]; then
    shift
fi
exec "$opencode_bin" acp "$@"
