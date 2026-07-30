# Buzz Upstream Guardian

The Guardian keeps this customized Buzz branch compatible with
[`block/buzz`](https://github.com/block/buzz) without allowing an official
binary updater to overwrite local features.

It is a control plane, not an LLM-powered `git pull`. Git establishes the exact
SHAs, pending commits, changed paths, merge result, customized capability
overlap, and required checks before an agent is asked to interpret anything.

## Safety contract

| Risk | Meaning | Automatic action |
|---|---|---|
| None | Official SHA is already integrated | Report only |
| Green | Only allowlisted paths changed, with no customized capability overlap or conflict | Create a candidate branch and PR |
| Orange | Same file, same customized capability, or unknown code changed | Report and hand off to Hercules |
| Red | Merge conflict or critical runtime/agent surface changed | Block and hand off to Genie |

The Guardian never merges the candidate PR, installs an application, deploys a
relay, or treats an agent message as approval. Hades review and Lumière
verification must reference the same immutable candidate SHA. Any new commit
invalidates both.

## Local analysis

Activate the repository toolchain, fetch the official branch, and analyze:

```bash
. ./bin/activate-hermit
git fetch origin main
just guardian-analyze
```

Artifacts are written under `.guardian-runs/latest/`:

- `report.json` is the deterministic compatibility record;
- `report.md` is the human/Buzz journal entry;
- `handoff.json` is the bounded multi-agent task manifest.

To create an isolated candidate worktree, the report must be green:

```bash
just guardian-prepare
```

The candidate is preserved for review. The command never cleans up a worktree,
pushes, merges, or installs anything.

## Visible Buzz handoff

Publishing is a separate, explicit side effect. Configure the owner identity
outside Git:

```bash
export BUZZ_RELAY_URL="https://your-relay.example"
export BUZZ_PRIVATE_KEY="..."
export BUZZ_GUARDIAN_CHANNEL="<channel-uuid>"
export BUZZ_GUARDIAN_LEAD_PUBKEY="<genie-pubkey>"
export BUZZ_CLI="/Applications/Buzz.app/Contents/MacOS/buzz"
just guardian-notify
```

The CLI publishes a top-level message and explicitly mentions Genie when the
lead pubkey is configured. Buzz remains the visible journal; the JSON artifacts
remain the workflow ledger.

## GitHub automation

`.github/workflows/upstream-guardian.yml` runs daily on the personal fork and
can also be started manually. It:

1. checks out `codex/hermes-mcp-bridge`;
2. fetches `block/buzz/main`;
3. uploads the immutable report and handoff artifacts;
4. opens a candidate PR only for green changes;
5. opens one review issue per upstream SHA for orange or red changes.

Scheduled and manually dispatched workflows must first exist on the
repository's default branch. Until a small activation PR places this workflow
on the fork's default branch, use the local command. Once activated, a manual
dispatch may select the custom integration branch. The workflow is
intentionally restricted to `ArnaudLafosse92100/buzz` so it cannot activate if
proposed to the official repository.

## Policy maintenance

`scripts/upstream-guardian/policy.json` is the source of truth for customized
capabilities, critical paths, safe paths, owners, reviewers, verifiers, and
checks. Update it in the same commit whenever a new local customization is
introduced.

Start conservatively. A code path is orange unless it is explicitly safe. Move
paths toward green only after repeated clean integrations and live evidence.
