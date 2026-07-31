export const openConfigRoot = "/Volumes/PERSO/OpenConfig";
export const engineRoot = `${openConfigRoot}/prompts`;
export const personaRoot = "/Users/arnaud/.buzz/.opencode/personas";

function role(name, slug, engine, persona, model, variant, acpPort) {
  return Object.freeze({
    name,
    displayName: name,
    slug,
    engine,
    enginePath: `${engineRoot}/${engine}`,
    persona,
    personaPath: `${personaRoot}/${persona}`,
    model,
    variant,
    acpPort,
  });
}

// Single source of truth for every public Buzz identity and the exact
// OpenConfig execution profile hidden behind it. A null variant means the
// upstream agent intentionally relies on its model default.
export const openConfigRoles = Object.freeze([
  role("Merlin", "merlin", "agents/sisyphus.md", "e07a513e-f3c4-46df-b7d5-1b7675e5c3ee.md", "openrouter/z-ai/glm-5.2-exacto", "low", 4105),
  role("Hercules", "hercules", "agents/hephaestus.md", "032894bb-92f6-4b16-91ac-1e1ba292fa2a.md", "subscription-gateway/gpt-5.6-terra", "high", 4106),
  role("Hades", "hades", "agents/oracle.md", "75f32831-215c-4a9c-92dd-1bc9037c783d.md", "subscription-gateway/gpt-5.6-sol", "high", 4107),
  role("Mushu", "mushu", "agents/sisyphus-junior.md", "89757873-0389-42ee-8f34-db644eccd02a.md", "openrouter/deepseek/deepseek-v4-flash", "low", 4108),
  role("Lumière", "lumiere", "categories/bug-hunt.md", "c1bc49ff-3604-48fe-bfe6-4db7cf2ac4c3.md", "openrouter/z-ai/glm-5.2-exacto", "low", 4109),
  role("Jiminy Cricket", "jiminy-cricket", "agents/prometheus.md", "openconfig-prometheus.md", "openrouter/z-ai/glm-5.2-exacto", "low", 4110),
  role("Tarzan", "tarzan", "agents/atlas.md", "openconfig-atlas.md", "openrouter/z-ai/glm-5.2-exacto", "low", 4111),
  role("Moana", "moana", "agents/explore.md", "openconfig-explore.md", "openrouter/deepseek/deepseek-v4-flash", "low", 4112),
  role("Belle", "belle", "agents/librarian.md", "openconfig-librarian.md", "openrouter/deepseek/deepseek-v4-flash", "low", 4113),
  role("Rapunzel", "rapunzel", "agents/multimodal-looker.md", "openconfig-multimodal-looker.md", "openrouter/anthropic/claude-sonnet-5", null, 4114),
  role("Mulan", "mulan", "agents/metis.md", "openconfig-metis.md", "openrouter/anthropic/claude-sonnet-5", "medium", 4115),
  role("Yzma", "yzma", "agents/momus.md", "openconfig-momus.md", "subscription-gateway/gpt-5.6-sol-review", "max", 4116),
  role("Basil", "basil", "agents/content-aware-research.md", "openconfig-content-aware-research.md", "openrouter/deepseek/deepseek-v4-pro", "high", 4117),
]);

export const shipFeatureInstructions = `This team delivers software through a visible peer-to-peer pipeline in one Buzz thread.

ROSTER

- @Merlin — engineering lead, planner, router, decision owner, and sole final reporter.
- @Hercules — primary implementer for complex, architectural, cross-module, security-sensitive, or high-value work.
- @Mushu — fast implementer for small, mechanical, repetitive, local, and low-risk work.
- @Hades — independent reviewer and test strategist. Candidate code is not accepted until Hades approves the exact commit SHA.
- @Lumière — independent live verifier. Work is not complete until Lumière verifies the exact SHA approved by Hades and provides execution evidence.

DELIVERY PIPELINE

1. The user normally addresses @Merlin.
2. @Merlin inspects the real repository, defines the objective, acceptance criteria, non-goals, risks, required checks, and assigns implementation to @Hercules or @Mushu.
3. The implementer works in an assigned isolated worktree and publishes a handoff containing the exact candidate SHA, changed files, tests executed, results, known risks, and remaining limitations.
4. The implementer tags @Hades for independent review.
5. @Hades reviews the exact candidate SHA and returns either \`REVIEW PASS\` or \`REVIEW REJECT\`.
6. On rejection, @Hades tags the responsible implementer and describes each blocker with severity, evidence, affected location, reproduction steps, and required correction.
7. The implementer repairs the bounded scope, creates a new immutable SHA, and tags @Hades again. Every new commit invalidates earlier review or verification.
8. On approval, @Hades states the approved SHA and tags @Lumière with the acceptance scenarios and failure paths to verify.
9. @Lumière checks out the exact approved SHA, runs the real application or the closest safe representative environment, and returns \`VERIFICATION PASS\` or \`VERIFICATION FAIL\` with concrete evidence.
10. @Lumière reports the result to @Merlin.
11. Only @Merlin publishes the final consolidated result to the user.

VISIBLE COLLABORATION

- All planning, delegation, handoffs, reviews, rejections, repair plans, decisions, and verification results happen publicly in the same Buzz thread.
- Agents speak directly to one another using explicit @mentions.
- Every substantive message ends with exactly one next owner: \`ACTION OWNER: @Name\`.
- When human authorization or a product decision is required, use \`ACTION OWNER: USER\` and stop until the user responds.
- Only the action owner may perform the next mutable action. Other mentioned agents remain observers unless explicitly delegated work.

IMPLEMENTATION, REVIEW, AND STOP RULES

- Act only on explicit delegation and keep changes inside the delegated scope.
- Use one writer per assigned worktree. Never edit another agent's worktree.
- Every implementation handoff records the objective, acceptance criteria, non-goals, base SHA, candidate SHA, worktree or branch, changed files, exact checks and results, risks, limitations, and next owner.
- Review and verification are bound to one immutable commit SHA. Any new commit invalidates all earlier approval and verification.
- @Hades and @Lumière remain read-only by default. If either changes product code, the resulting SHA requires a new independent review.
- @Lumière never repairs source code during verification; failures route back through @Merlin.
- If the same blocker survives two repair attempts, return ownership to @Merlin for replanning.
- No merge, deployment, publication, production change, external contact, spending, or irreversible action occurs without explicit human authorization.
- Work is complete only when Hades has approved a SHA and Lumière has independently verified that same SHA.`;

export const openConfigTeams = Object.freeze([
  Object.freeze({
    name: "Content-Aware Audit",
    members: ["Merlin", "Moana", "Basil"],
    description: "Reconnaissance plus deep technical research, coordinated by Merlin.",
    instructions: "Merlin coordinates scope and publishes the consolidated finding. Moana maps the relevant code and evidence quickly. Basil performs the deep technical analysis and does not edit. Do not duplicate each other: return evidence to Merlin, who decides the next owner.",
  }),
  Object.freeze({
    name: "Debug Team",
    members: ["Merlin", "Lumière", "Basil"],
    description: "Reproduce, isolate root cause, and verify a bounded defect.",
    instructions: "Merlin owns triage and final status. Lumière reproduces and verifies the observable bug. Basil traces root cause and alternatives without editing. Each member reports evidence only for its assigned stage; Merlin assigns any fix to a specific executor.",
  }),
  Object.freeze({
    name: "Docs Team",
    members: ["Merlin", "Belle", "Jiminy Cricket"],
    description: "Authoritative research and an implementable documentation plan.",
    instructions: "Merlin owns scope and final response. Belle finds authoritative documentation and repository precedents. Jiminy Cricket turns verified facts into audience, structure, acceptance criteria, and review plan. No member publishes or changes documentation without explicit authorization.",
  }),
  Object.freeze({
    name: "Explorers",
    members: ["Merlin", "Moana", "Belle"],
    description: "Fast code and documentation reconnaissance before a decision.",
    instructions: "Merlin asks a bounded question and synthesizes. Moana scouts code paths, tests, and configuration. Belle scouts documented contracts and upstream behavior. Do not implement; report concise source-grounded findings and unresolved questions.",
  }),
  Object.freeze({
    name: "Refactor Team",
    members: ["Merlin", "Mulan", "Tarzan", "Hades", "Lumière"],
    description: "Architecture-led refactoring with a single accountable executor.",
    instructions: "Merlin owns scope and approval gates. Mulan analyzes dependencies, migration risk, sequencing, and rollback. Tarzan implements only the approved bounded plan and runs checks. Do not have multiple members edit the same surface. Tarzan hands the immutable candidate SHA to Hades; only Hades-approved evidence goes to Lumière for independent verification, then back to Merlin for the final report.",
  }),
  Object.freeze({
    name: "Review Panel",
    members: ["Merlin", "Hades", "Lumière", "Yzma"],
    description: "Independent architecture, bug, verification, and adversarial review panel.",
    instructions: "Merlin coordinates one immutable candidate identifier. Hades reviews architectural correctness. Lumière validates reproducible behavior and tests. Yzma performs adversarial review for regressions and false completion claims. Members do not edit or merge; Merlin publishes the combined accept/reject decision and remaining evidence gaps.",
  }),
  Object.freeze({
    name: "Ship Feature",
    members: ["Merlin", "Hercules", "Mushu", "Hades", "Lumière"],
    description: "Plan, implement, verify, and report a feature through a disciplined pipeline.",
    instructions: shipFeatureInstructions,
  }),
]);

export const publicIdentityReplacements = Object.freeze([
  ["Content-Aware Research", "Basil"],
  ["Multimodal Looker", "Rapunzel"],
  ["Sisyphus Junior", "Mushu"],
  ["Prometheus", "Jiminy Cricket"],
  ["Hephaestus", "Hercules"],
  ["Sisyphus", "Merlin"],
  ["Bug Hunt", "Lumière"],
  ["Oracle", "Hades"],
  ["Genie", "Merlin"],
  ["Atlas", "Tarzan"],
  ["Explore", "Moana"],
  ["Librarian", "Belle"],
  ["Metis", "Mulan"],
  ["Momus", "Yzma"],
]);

export const openConfigRoleByName = new Map(openConfigRoles.map((item) => [item.name, item]));
export const openConfigTeamByName = new Map(openConfigTeams.map((item) => [item.name, item]));
