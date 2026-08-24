import path from "node:path";
import { fileURLToPath } from "node:url";

export const buzzRepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const openConfigRoot = "/Volumes/PERSO/OpenConfig";
export const engineRoot = `${openConfigRoot}/prompts`;
export const personaRoot = "/Users/arnaud/.buzz/.opencode/personas";
export const personaSourceRoot = `${buzzRepoRoot}/scripts/config/buzz-openconfig-personas`;

function role(name, slug, engine, persona, acpPort) {
  const [routeSection, filename] = engine.split("/");
  return Object.freeze({
    name,
    displayName: name,
    slug,
    engine,
    enginePath: `${engineRoot}/${engine}`,
    persona,
    personaPath: `${personaRoot}/${persona}`,
    personaSource: `${personaSourceRoot}/${slug}.md`,
    routeSection,
    routeName: filename.replace(/\.md$/, ""),
    acpPort,
  });
}

// Single source of truth for the public Buzz roster. Names and slugs are the
// canonical OpenConfig identities so prompts, teams, logs, and upstream updates
// all use one vocabulary. Models, fallbacks, reasoning, and variants are never
// copied here: they are resolved from OpenConfig's named runtime profile.
export const openConfigRoles = Object.freeze([
  role("Sisyphus", "sisyphus", "agents/sisyphus.md", "e07a513e-f3c4-46df-b7d5-1b7675e5c3ee.md", 4105),
  role("Hephaestus", "hephaestus", "agents/hephaestus.md", "032894bb-92f6-4b16-91ac-1e1ba292fa2a.md", 4106),
  role("Oracle", "oracle", "agents/oracle.md", "75f32831-215c-4a9c-92dd-1bc9037c783d.md", 4107),
  role("Sisyphus Junior", "sisyphus-junior", "agents/sisyphus-junior.md", "89757873-0389-42ee-8f34-db644eccd02a.md", 4108),
  role("Bug Hunt", "bug-hunt", "categories/bug-hunt.md", "c1bc49ff-3604-48fe-bfe6-4db7cf2ac4c3.md", 4109),
  role("Prometheus", "prometheus", "agents/prometheus.md", "openconfig-prometheus.md", 4110),
  role("Atlas", "atlas", "agents/atlas.md", "openconfig-atlas.md", 4111),
  role("Explore", "explore", "agents/explore.md", "openconfig-explore.md", 4112),
  role("Librarian", "librarian", "agents/librarian.md", "openconfig-librarian.md", 4113),
  role("Multimodal Looker", "multimodal-looker", "agents/multimodal-looker.md", "openconfig-multimodal-looker.md", 4114),
  role("Metis", "metis", "agents/metis.md", "openconfig-metis.md", 4115),
  role("Momus", "momus", "agents/momus.md", "openconfig-momus.md", 4116),
  role("Content-Aware Research", "content-aware-research", "agents/content-aware-research.md", "openconfig-content-aware-research.md", 4117),
]);

export const shipFeatureInstructions = `This team delivers software through a visible OpenConfig pipeline in one Buzz thread.

ROSTER

- @Sisyphus — engineering lead, router, decision owner, and sole final reporter.
- @Hephaestus — primary implementer for complex, architectural, cross-module, security-sensitive, or high-value work.
- @Sisyphus Junior — focused implementer for small, mechanical, local, and low-risk work.
- @Bug Hunt — independent regression verifier. Candidate work is not accepted until Bug Hunt verifies the exact immutable candidate.

DELIVERY PIPELINE

1. The user normally addresses @Sisyphus.
2. @Sisyphus inspects the real repository, defines the objective, acceptance criteria, non-goals, risks, and required checks, then assigns bounded implementation to @Hephaestus or @Sisyphus Junior.
3. The implementer works in the assigned scope and publishes a handoff containing the exact candidate SHA when commits are authorized, changed files, checks executed, results, risks, and remaining limitations.
4. The implementer tags @Bug Hunt for independent verification.
5. @Bug Hunt returns either \`VERIFICATION PASS\` or \`VERIFICATION FAIL\` with concrete evidence.
6. On failure, @Bug Hunt tags the responsible implementer and describes each blocker with evidence, affected location, reproduction steps, and required correction.
7. The implementer repairs only the bounded scope and resubmits. Any new candidate invalidates prior verification.
8. @Bug Hunt reports the final verification result to @Sisyphus.
9. Only @Sisyphus publishes the consolidated result to the user.

VISIBLE COLLABORATION

- All planning, delegation, handoffs, decisions, and verification results happen publicly in the same Buzz thread.
- Agents speak directly to one another using explicit @mentions.
- Every substantive message ends with exactly one next owner: \`ACTION OWNER: @Name\`.
- When human authorization or a product decision is required, use \`ACTION OWNER: USER\` and stop until the user responds.
- Only the action owner may perform the next mutable action. Other mentioned agents remain observers unless explicitly delegated work.

IMPLEMENTATION, VERIFICATION, AND STOP RULES

- Act only on explicit delegation and keep changes inside the delegated scope.
- Use one writer per assigned worktree. Never edit another agent's worktree.
- Verification is bound to one immutable candidate. Any new candidate invalidates earlier verification.
- @Bug Hunt remains read-only while verifying. If reassigned to implement a minimal fix, another verifier must review the resulting candidate.
- If the same blocker survives two repair attempts, return ownership to @Sisyphus for replanning.
- No commit, merge, deployment, publication, production change, external contact, spending, or irreversible action occurs without explicit human authorization.
- Work is complete only when @Bug Hunt has independently verified the final candidate.`;

export const openConfigTeams = Object.freeze([
  Object.freeze({
    name: "content-aware-audit",
    members: ["Sisyphus", "Explore", "Content-Aware Research"],
    description: "Reconnaissance and deep technical research coordinated by Sisyphus.",
    instructions: "Sisyphus coordinates scope and publishes the consolidated finding. Explore maps relevant code paths and evidence quickly. Content-Aware Research performs deep technical analysis without editing. Avoid duplicate work and return evidence to Sisyphus, who decides the next owner.",
  }),
  Object.freeze({
    name: "debug-team",
    members: ["Sisyphus", "Bug Hunt", "Content-Aware Research"],
    description: "Reproduce, isolate root cause, and verify a bounded defect.",
    instructions: "Sisyphus owns triage and final status. Bug Hunt reproduces and verifies observable behavior. Content-Aware Research traces difficult root causes and alternatives without editing. Each member reports evidence only for its assigned stage; Sisyphus assigns any fix to a specific executor.",
  }),
  Object.freeze({
    name: "docs-team",
    members: ["Sisyphus", "Librarian", "Prometheus"],
    description: "Authoritative research and an implementable documentation plan.",
    instructions: "Sisyphus owns scope and final response. Librarian finds authoritative documentation and repository precedents. Prometheus turns verified facts into audience, structure, acceptance criteria, and review plan. No member publishes or changes documentation without explicit authorization.",
  }),
  Object.freeze({
    name: "explorers",
    members: ["Sisyphus", "Explore", "Librarian"],
    description: "Fast code and documentation reconnaissance before a decision.",
    instructions: "Sisyphus asks a bounded question and synthesizes. Explore scouts code paths, tests, and configuration. Librarian scouts documented contracts and upstream behavior. Do not implement; report concise source-grounded findings and unresolved questions.",
  }),
  Object.freeze({
    name: "refactor-team",
    members: ["Sisyphus", "Metis", "Atlas", "Oracle", "Bug Hunt"],
    description: "Evidence-led refactoring with critique, execution, advice, and verification separated.",
    instructions: "Sisyphus owns scope and approval gates. Metis identifies hidden assumptions, ambiguities, migration risks, and missing acceptance criteria before planning. Oracle advises on architecture and difficult trade-offs without becoming the implementation reviewer. Atlas executes only the approved bounded plan. Bug Hunt independently verifies preserved behavior and regressions. Use one writer, immutable handoffs, and return final evidence to Sisyphus.",
  }),
  Object.freeze({
    name: "review-panel",
    members: ["Sisyphus", "Content-Aware Research", "Bug Hunt", "Sisyphus Junior"],
    description: "Multi-lens architecture, security, correctness, and cleanup review.",
    instructions: "Sisyphus coordinates one immutable candidate and publishes the combined decision. Content-Aware Research reviews architecture, security boundaries, coupling, and blast radius. Bug Hunt finds reproducible correctness and regression defects. Sisyphus Junior proposes only bounded behavior-preserving cleanup and remains read-only in this team. Members report findings with evidence and do not edit, merge, or deploy.",
  }),
  Object.freeze({
    name: "ship-feature",
    members: ["Sisyphus", "Hephaestus", "Sisyphus Junior", "Bug Hunt"],
    description: "Route, implement, verify, and report a feature through the canonical OpenConfig pipeline.",
    instructions: shipFeatureInstructions,
  }),
]);

export const openConfigRoleByName = new Map(openConfigRoles.map((item) => [item.name, item]));
export const openConfigTeamByName = new Map(openConfigTeams.map((item) => [item.name, item]));
