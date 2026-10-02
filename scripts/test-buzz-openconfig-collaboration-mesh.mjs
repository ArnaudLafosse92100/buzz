#!/usr/bin/env node
/**
 * Static regression check for the directed public Buzz OpenConfig handoff
 * mesh. It checks prompt source files only: live synchronization remains the
 * responsibility of sync-buzz-openconfig-persona-prompts.mjs.
 */

import { readFile } from "node:fs/promises";
import { openConfigRoleByName } from "./lib/buzz-openconfig-manifest.mjs";

const expectedHandoffs = new Map([
  ["Sisyphus", ["Hephaestus", "Sisyphus Junior", "Explore", "Librarian", "Content-Aware Research", "Multimodal Looker", "Prometheus", "Metis", "Atlas", "Oracle", "Bug Hunt", "Momus"]],
  ["Hephaestus", ["Sisyphus", "Metis", "Explore", "Librarian", "Content-Aware Research", "Multimodal Looker", "Oracle", "Bug Hunt"]],
  ["Oracle", ["Sisyphus", "Metis", "Content-Aware Research", "Multimodal Looker", "Bug Hunt"]],
  ["Bug Hunt", ["Oracle", "Multimodal Looker", "Sisyphus", "Hephaestus", "Atlas", "Sisyphus Junior"]],
  ["Sisyphus Junior", ["Sisyphus", "Metis", "Hephaestus", "Explore", "Librarian", "Oracle", "Bug Hunt"]],
  ["Prometheus", ["Sisyphus", "Explore", "Librarian", "Content-Aware Research", "Multimodal Looker", "Metis", "Hephaestus", "Atlas", "Sisyphus Junior"]],
  ["Atlas", ["Sisyphus", "Prometheus", "Explore", "Librarian", "Hephaestus", "Oracle", "Bug Hunt"]],
  ["Explore", ["Sisyphus", "Prometheus", "Metis", "Content-Aware Research", "Librarian", "Multimodal Looker", "Bug Hunt"]],
  ["Librarian", ["Sisyphus", "Prometheus", "Metis", "Explore", "Content-Aware Research"]],
  ["Multimodal Looker", ["Sisyphus", "Prometheus", "Metis", "Explore", "Bug Hunt", "Oracle"]],
  ["Metis", ["Sisyphus", "Prometheus", "Explore", "Librarian", "Content-Aware Research", "Multimodal Looker", "Momus"]],
  ["Momus", ["Sisyphus", "Prometheus"]],
  ["Content-Aware Research", ["Sisyphus", "Explore", "Librarian", "Multimodal Looker", "Metis"]],
]);

const removedDisneyNames = /\b(Genie|Merlin|Hercules|Hades|Mushu|Jiminy Cricket|Tarzan|Moana|Belle|Rapunzel|Mulan|Yzma|Basil)\b|Lumière/;
const violations = [];

for (const [roleName, names] of expectedHandoffs) {
  const role = openConfigRoleByName.get(roleName);
  if (!role) {
    violations.push(`${roleName}: missing from canonical manifest`);
    continue;
  }
  const contents = await readFile(role.personaSource, "utf8");
  if (!contents.includes("## Collaboration mesh")) violations.push(`${role.personaSource}: missing collaboration mesh heading`);
  if (!contents.includes("ACTION OWNER")) violations.push(`${role.personaSource}: missing next-owner contract`);
  for (const name of names) {
    if (!contents.includes(`@${name}`)) violations.push(`${role.personaSource}: missing @${name} handoff`);
  }
  if (removedDisneyNames.test(contents)) violations.push(`${role.personaSource}: removed Disney identity leaked into prompt`);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`Buzz OpenConfig collaboration mesh tests passed: ${expectedHandoffs.size} personas`);
