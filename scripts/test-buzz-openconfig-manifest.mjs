#!/usr/bin/env node
/** Static contract tests for the canonical Buzz/OpenConfig manifest. */

import { access, readFile } from "node:fs/promises";
import {
  openConfigRoles,
  openConfigTeams,
  openConfigRoleByName,
} from "./lib/buzz-openconfig-manifest.mjs";

const failures = [];
const unique = (values) => new Set(values).size === values.length;

if (openConfigRoles.length !== 13) failures.push(`expected 13 roles, found ${openConfigRoles.length}`);
if (openConfigTeams.length !== 7) failures.push(`expected 7 teams, found ${openConfigTeams.length}`);
for (const [label, values] of [
  ["role names", openConfigRoles.map((role) => role.name)],
  ["role slugs", openConfigRoles.map((role) => role.slug)],
  ["engine paths", openConfigRoles.map((role) => role.enginePath)],
  ["persona paths", openConfigRoles.map((role) => role.personaPath)],
  ["ACP ports", openConfigRoles.map((role) => role.acpPort)],
  ["team names", openConfigTeams.map((team) => team.name)],
]) {
  if (!unique(values)) failures.push(`${label} must be unique`);
}

const allowedVariants = new Set([null, "low", "medium", "high", "max"]);
for (const role of openConfigRoles) {
  if (!allowedVariants.has(role.variant)) failures.push(`${role.name}: invalid variant ${role.variant}`);
  if (role.model.includes("deepseek-v4-pro")) failures.push(`${role.name}: retired DeepSeek V4 Pro route reintroduced`);
  if (role.acpPort < 1024 || role.acpPort > 65535) failures.push(`${role.name}: invalid ACP port`);
  for (const file of [role.enginePath, role.personaSource]) {
    await access(file).catch(() => failures.push(`${role.name}: missing ${file}`));
  }
}

const expectedRoles = [
  "Sisyphus",
  "Hephaestus",
  "Oracle",
  "Sisyphus Junior",
  "Bug Hunt",
  "Prometheus",
  "Atlas",
  "Explore",
  "Librarian",
  "Multimodal Looker",
  "Metis",
  "Momus",
  "Content-Aware Research",
];
const expectedTeams = [
  "content-aware-audit",
  "debug-team",
  "docs-team",
  "explorers",
  "refactor-team",
  "review-panel",
  "ship-feature",
];
if (JSON.stringify(openConfigRoles.map((role) => role.name)) !== JSON.stringify(expectedRoles)) {
  failures.push("public roster is not the canonical OpenConfig roster");
}
if (JSON.stringify(openConfigTeams.map((team) => team.name)) !== JSON.stringify(expectedTeams)) {
  failures.push("team roster is not the canonical OpenConfig roster");
}

const removedDisneyNames = [
  "Merlin", "Hercules", "Hades", "Mushu", "Lumière", "Jiminy Cricket",
  "Tarzan", "Moana", "Belle", "Rapunzel", "Mulan", "Yzma", "Basil", "Genie",
];
for (const removed of [...removedDisneyNames, "Fizz", "Honey", "Bumble", "Welcome Team", "Forge Coding Team"]) {
  if (openConfigRoles.some((role) => role.name === removed)
    || openConfigTeams.some((team) => team.name === removed)) {
    failures.push(`removed identity leaked into manifest: ${removed}`);
  }
}
for (const team of openConfigTeams) {
  if (!unique(team.members)) failures.push(`${team.name}: duplicate members`);
  for (const member of team.members) {
    if (!openConfigRoleByName.has(member)) failures.push(`${team.name}: unknown member ${member}`);
  }
  const teamText = `${team.description}\n${team.instructions}`;
  for (const role of openConfigRoles) {
    if (teamText.includes(role.name) && !team.members.includes(role.name)) {
      failures.push(`${team.name}: references non-member ${role.name}`);
    }
  }
  for (const removed of removedDisneyNames) {
    if (teamText.includes(removed)) failures.push(`${team.name}: leaks removed Disney identity ${removed}`);
  }
}

const ship = openConfigTeams.find((team) => team.name === "ship-feature");
const refactor = openConfigTeams.find((team) => team.name === "refactor-team");
if (JSON.stringify(ship?.members) !== JSON.stringify(["Sisyphus", "Hephaestus", "Sisyphus Junior", "Bug Hunt"])) {
  failures.push("ship-feature roster is not the canonical OpenConfig pipeline");
}
if (JSON.stringify(refactor?.members) !== JSON.stringify(["Sisyphus", "Metis", "Atlas", "Oracle", "Bug Hunt"])) {
  failures.push("refactor-team roster is not the canonical critique/execute/advise/verify pipeline");
}

const upstream = JSON.parse(await readFile("/Volumes/PERSO/OpenConfig/oh-my-openagent.json", "utf8"));
for (const role of openConfigRoles) {
  const key = role.engine.split("/").at(-1).replace(/\.md$/, "");
  const profile = role.engine.startsWith("categories/") ? upstream.categories?.[key] : upstream.agents?.[key];
  if (!profile) {
    failures.push(`${role.name}: missing upstream profile ${role.engine}`);
    continue;
  }
  if (profile.model !== role.model) failures.push(`${role.name}: model drift (${profile.model} != ${role.model})`);
  if ((profile.variant ?? null) !== role.variant) {
    failures.push(`${role.name}: variant drift (${profile.variant ?? "default"} != ${role.variant ?? "default"})`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Buzz OpenConfig manifest tests passed: 13 roles, 7 teams, upstream routes aligned");
