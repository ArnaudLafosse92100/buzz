#!/usr/bin/env bash
# Reversible local migration of Buzz managed personas from Hermes to
# OpenCode/OpenConfig. This changes runtime data only; it never installs or
# replaces Buzz.app.

set -euo pipefail

action="${1:-check}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
app_data="${BUZZ_APP_DATA_DIR:-$HOME/Library/Application Support/xyz.block.buzz.app}"
agents_store="$app_data/agents/managed-agents.json"
global_config="$app_data/agents/global-agent-config.json"
custom_harness_dir="$app_data/custom_harnesses"
backup_root="$app_data/agents/openconfig-migration"
nest_root="${BUZZ_NEST_DIR:-$HOME/.buzz}"
persona_root="$nest_root/.opencode/personas"
buzz_omo_config="$nest_root/.opencode/oh-my-openagent.json"
buzz_omo_source="$repo_root/scripts/config/buzz-oh-my-openagent.json"
archive_root="$nest_root/archive/hermes-openconfig-migration"
adapter_source="$repo_root/scripts/buzz-openconfig-acp.sh"
adapter_install="${BUZZ_OPENCONFIG_ADAPTER_PATH:-$HOME/.local/bin/buzz-openconfig-acp}"
harness_file="$custom_harness_dir/buzz-openconfig.json"
manifest_module="$repo_root/scripts/lib/buzz-openconfig-manifest.mjs"

die() {
    echo "migrate-buzz-hermes-to-openconfig: $*" >&2
    exit 1
}

require_file() {
    [[ -f "$1" ]] || die "required file missing: $1"
}

manifest_json() {
    MANIFEST_MODULE="$manifest_module" node --input-type=module -e '
      import { pathToFileURL } from "node:url";
      const { openConfigRoles } = await import(pathToFileURL(process.env.MANIFEST_MODULE));
      process.stdout.write(JSON.stringify(openConfigRoles));
    '
}

atomic_jq() {
    local source="$1"
    local filter="$2"
    shift 2
    local parent tmp mode
    parent="$(dirname "$source")"
    mode="$(stat -f '%Lp' "$source")"
    tmp="$(mktemp "$parent/.openconfig-migrate.XXXXXX")"
    if ! jq "$@" "$filter" "$source" >"$tmp"; then
        rm -f "$tmp"
        return 1
    fi
    jq -e . "$tmp" >/dev/null
    chmod "$mode" "$tmp"
    mv "$tmp" "$source"
}

active_target_ids() {
    jq -r '
      . as $records
      | [
          $records[]
          | select(.pubkey != "" and .start_on_app_launch == true)
          | .persona_id
          | select(. != null)
        ] as $active
      | $records[]
      | select(.pubkey == "" and (.runtime == "hermes" or .runtime == "buzz-openconfig"))
      | select(.slug as $id | $active | index($id))
      | .slug
    ' "$agents_store"
}

check_state() {
    require_file "$agents_store"
    require_file "$global_config"
    require_file "$adapter_source"
    require_file "$buzz_omo_source"
    require_file "$manifest_module"
    jq -e . "$agents_store" >/dev/null
    jq -e . "$global_config" >/dev/null

    local expected migrated prompts routed expected_routes
    expected="$(active_target_ids | wc -l | tr -d ' ')"
    migrated="$(jq '[.[] | select(.pubkey != "" and .start_on_app_launch == true and .runtime == "buzz-openconfig")] | length' "$agents_store")"
    prompts="$(find "$persona_root" -maxdepth 1 -type f -name '*.md' 2>/dev/null | wc -l | tr -d ' ')"
    routed="$(jq '[.[]
      | select(.pubkey == "" and .runtime == "buzz-openconfig")
      | select(.env_vars.BUZZ_OPENCONFIG_MODEL? | test("^(subscription-gateway|openrouter)/"))
    ] | length' "$agents_store")"
    expected_routes="$(manifest_json | jq 'map({(.name): .model}) | add')"
    local expected_variants
    expected_variants="$(manifest_json | jq 'map({(.name): .variant}) | add')"

    jq -e '.preferred_runtime == "buzz-openconfig"' "$global_config" >/dev/null \
        || die "preferred runtime is not buzz-openconfig"
    [[ -x "$adapter_install" ]] || die "adapter is not executable: $adapter_install"
    jq -e '.disabled_hooks | index("session-notification")' "$buzz_omo_config" >/dev/null \
        || die "Buzz-local OpenAgent notification override is missing"
    jq -e '.id == "buzz-openconfig" and .command != ""' "$harness_file" >/dev/null \
        || die "custom harness is missing or invalid"
    [[ "$expected" -eq 0 || "$migrated" -eq "$expected" ]] \
        || die "runtime migration mismatch: expected=$expected migrated=$migrated"
    [[ "$migrated" -eq "$prompts" ]] \
        || die "persona prompt mismatch: agents=$migrated prompts=$prompts"
    [[ "$routed" -eq "$expected" ]] \
        || die "model-route mismatch: expected=$expected routed=$routed"
    jq -e --argjson expected_routes "$expected_routes" '
      [ .[]
        | select(.pubkey == "" and .runtime == "buzz-openconfig")
        | {(.name): .env_vars.BUZZ_OPENCONFIG_MODEL}
      ] | add == $expected_routes
    ' "$agents_store" >/dev/null \
        || die "Buzz persona model routes differ from the OpenConfig mapping"
    jq -e --argjson expected_variants "$expected_variants" '
      [ .[]
        | select(.pubkey == "" and .runtime == "buzz-openconfig")
        | {(.name): (.env_vars.BUZZ_OPENCONFIG_VARIANT // null)}
      ] | add == $expected_variants
    ' "$agents_store" >/dev/null \
        || die "Buzz persona variants differ from the OpenConfig mapping"

    echo "OpenConfig migration healthy: agents=$migrated prompts=$prompts routes=$routed"
}

apply_migration() {
    require_file "$agents_store"
    require_file "$global_config"
    require_file "$adapter_source"
    require_file "$buzz_omo_source"
    require_file "$manifest_module"
    command -v jq >/dev/null 2>&1 || die "jq is required"
    command -v sqlite3 >/dev/null 2>&1 || die "sqlite3 is required"

    if [[ "${BUZZ_OPENCONFIG_ALLOW_RUNNING:-0}" != "1" ]] \
        && pgrep -f '/Applications/Buzz.app/Contents/MacOS/buzz-desktop' >/dev/null 2>&1; then
        die "Buzz is running; quit it before applying the migration"
    fi

    local stamp backup_dir
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_dir="$backup_root/$stamp"
    mkdir -p "$backup_dir" "$custom_harness_dir" "$persona_root" "$archive_root/$stamp" "$(dirname "$adapter_install")"
    cp -p "$agents_store" "$backup_dir/managed-agents.json"
    cp -p "$global_config" "$backup_dir/global-agent-config.json"
    [[ ! -f "$harness_file" ]] || cp -p "$harness_file" "$backup_dir/buzz-openconfig.json"
    printf '%s\n' "$backup_dir" >"$backup_root/latest"

    ln -sfn "$adapter_source" "$adapter_install"
    install -m 600 "$buzz_omo_source" "$buzz_omo_config"

    local harness_tmp
    harness_tmp="$(mktemp "$custom_harness_dir/.buzz-openconfig.XXXXXX")"
    jq -n \
      --arg command "$adapter_install" \
      '{
        id: "buzz-openconfig",
        label: "Buzz OpenConfig",
        command: $command,
        args: [],
        env: {},
        installInstructionsUrl: "https://github.com/jesseoue/opencode-configs",
        installHint: "OpenCode/OpenConfig with authoritative Buzz persona injection."
      }' >"$harness_tmp"
    chmod 600 "$harness_tmp"
    mv "$harness_tmp" "$harness_file"

    local targets_json roles_json
    targets_json="$(active_target_ids | jq -Rsc 'split("\n") | map(select(length > 0))')"
    roles_json="$(manifest_json)"
    [[ "$(jq 'length' <<<"$targets_json")" -gt 0 ]] || die "no active Hermes-backed personas found"

    local definition id name prompt_file profile_slug db archive_dir
    while IFS= read -r definition; do
        id="$(jq -r '.id' <<<"$definition")"
        name="$(jq -r '.name' <<<"$definition")"
        prompt_file="$persona_root/$id.md"
        jq -r '.system_prompt // ""' <<<"$definition" >"$prompt_file"
        [[ -s "$prompt_file" ]] || die "empty system prompt for $name"
        chmod 600 "$prompt_file"

        case "$name" in
            "Lumière") profile_slug="lumiere" ;;
            *) profile_slug="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')" ;;
        esac
        db="$HOME/.hermes/profiles/$profile_slug/state.db"
        archive_dir="$archive_root/$stamp/$profile_slug"
        mkdir -p "$archive_dir"
        if [[ -f "$db" ]]; then
            cp -p "$db" "$archive_dir/state.db"
            sqlite3 -json "$db" '
              SELECT m.session_id, m.role, m.content, m.tool_name, m.timestamp
              FROM messages AS m
              WHERE m.active = 1
              ORDER BY m.timestamp, m.id;
            ' >"$archive_dir/messages.json"
            chmod 600 "$archive_dir/state.db" "$archive_dir/messages.json"
        fi
    done < <(
        jq -c --argjson targets "$targets_json" '
          .[]
          | select(.pubkey == "" and (.slug as $id | $targets | index($id)))
          | {id: .slug, name, system_prompt}
        ' "$agents_store"
    )

    # shellcheck disable=SC2016 # jq program; variables are jq variables.
    atomic_jq "$agents_store" '
      map(
        if (
          (if .pubkey == "" then .slug else .persona_id end) as $target_id
          | $targets
          | index($target_id)
        ) then
          (if .name == "Genie" then "Merlin" else .name end) as $role_name
          | ($roles[] | select(.name == $role_name)) as $role
          | .name = $role.name
          | if .pubkey == "" then
            .runtime = "buzz-openconfig"
            | .env_vars = (((.env_vars // {}) | del(.HERMES_HOME)) + {
                "BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE": ($persona_root + "/" + .slug + ".md"),
                "BUZZ_OPENCONFIG_MODEL": $role.model,
                "BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE": $role.enginePath,
                "BUZZ_OPENCONFIG_PUBLIC_NAME": $role.name,
                "BUZZ_OPENCONFIG_AGENT_NAME": $role.slug
              })
            | if $role.variant == null then
                del(.env_vars.BUZZ_OPENCONFIG_VARIANT)
              else
                .env_vars.BUZZ_OPENCONFIG_VARIANT = $role.variant
              end
          else
            .runtime = "buzz-openconfig"
            | .agent_command = $adapter
            | .agent_command_override = null
            | .agent_args = []
          end
        else .
        end
      )
    ' --argjson targets "$targets_json" --argjson roles "$roles_json" --arg persona_root "$persona_root" --arg adapter "$adapter_install"

    atomic_jq "$global_config" '.preferred_runtime = "buzz-openconfig"'

    printf '%s\n' \
      "Hermes transcripts were exported from the five active persona profiles." \
      "The original ~/.hermes data remains untouched." \
      "Backup: $backup_dir" \
      >"$archive_root/$stamp/README.txt"
    chmod 600 "$archive_root/$stamp/README.txt"

    check_state
    echo "Backup: $backup_dir"
}

rollback_migration() {
    local backup_dir="${2:-}"
    if [[ -z "$backup_dir" && -f "$backup_root/latest" ]]; then
        backup_dir="$(<"$backup_root/latest")"
    fi
    [[ -n "$backup_dir" && -d "$backup_dir" ]] || die "rollback backup not found"
    require_file "$backup_dir/managed-agents.json"
    require_file "$backup_dir/global-agent-config.json"
    if [[ "${BUZZ_OPENCONFIG_ALLOW_RUNNING:-0}" != "1" ]] \
        && pgrep -f '/Applications/Buzz.app/Contents/MacOS/buzz-desktop' >/dev/null 2>&1; then
        die "Buzz is running; quit it before rollback"
    fi
    cp -p "$backup_dir/managed-agents.json" "$agents_store"
    cp -p "$backup_dir/global-agent-config.json" "$global_config"
    echo "Rolled back runtime configuration from $backup_dir"
}

case "$action" in
    apply) apply_migration ;;
    check) check_state ;;
    rollback) rollback_migration "$@" ;;
    *) die "usage: $0 {apply|check|rollback [backup-dir]}" ;;
esac
