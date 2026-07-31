#!/usr/bin/env node
/**
 * Static regression check for the directed public Buzz OpenConfig handoff
 * mesh. It checks prompt source files only: live synchronization remains the
 * responsibility of sync-buzz-openconfig-persona-prompts.mjs.
 */

import { readFile } from "node:fs/promises";
import { openConfigRoleByName, personaRoot } from "./lib/buzz-openconfig-manifest.mjs";

const expectedHandoffs = new Map([
  ["Merlin", ["Hercules", "Mushu", "Moana", "Belle", "Basil", "Rapunzel", "Jiminy Cricket", "Mulan", "Tarzan", "Hades", "Lumière", "Yzma"]],
  ["Hercules", ["Merlin", "Mulan", "Moana", "Belle", "Basil", "Rapunzel", "Hades", "Lumière"]],
  ["Hades", ["Merlin", "Mulan", "Basil", "Rapunzel", "Lumière"]],
  ["Lumière", ["Hades", "Rapunzel", "Merlin", "Hercules", "Tarzan", "Mushu"]],
  ["Mushu", ["Merlin", "Mulan", "Hercules", "Moana", "Belle", "Hades", "Lumière"]],
  ["Jiminy Cricket", ["Merlin", "Moana", "Belle", "Basil", "Rapunzel", "Mulan", "Hercules", "Tarzan", "Mushu"]],
  ["Tarzan", ["Merlin", "Mulan", "Moana", "Belle", "Hercules", "Hades", "Lumière"]],
  ["Moana", ["Merlin", "Jiminy Cricket", "Mulan", "Basil", "Belle", "Rapunzel", "Lumière"]],
  ["Belle", ["Merlin", "Jiminy Cricket", "Mulan", "Moana", "Basil"]],
  ["Rapunzel", ["Merlin", "Jiminy Cricket", "Mulan", "Moana", "Lumière", "Hades"]],
  ["Mulan", ["Merlin", "Jiminy Cricket", "Moana", "Belle", "Basil", "Rapunzel", "Hercules", "Tarzan", "Mushu", "Hades", "Lumière", "Yzma"]],
  ["Yzma", ["Merlin", "Mulan", "Hades", "Rapunzel"]],
  ["Basil", ["Merlin", "Moana", "Belle", "Rapunzel", "Mulan"]],
]);

const legacyNames = /\b(Genie|Prometheus|Atlas|Explore|Librarian|Multimodal Looker|Metis|Momus|Content-Aware Research|Sisyphus Junior|Hephaestus|Sisyphus|Bug Hunt|Oracle)\b/;
const violations = [];

for (const [roleName, names] of expectedHandoffs) {
  const filename = openConfigRoleByName.get(roleName)?.persona;
  if (!filename) {
    violations.push(`${roleName}: missing from canonical manifest`);
    continue;
  }
  const contents = await readFile(`${personaRoot}/${filename}`, "utf8");
  if (!contents.includes("## Collaboration mesh")) violations.push(`${filename}: missing collaboration mesh heading`);
  if (!contents.includes("ACTION OWNER")) violations.push(`${filename}: missing next-owner contract`);
  for (const name of names) {
    if (!contents.includes(`@${name}`)) violations.push(`${filename}: missing @${name} handoff`);
  }
  if (legacyNames.test(contents)) violations.push(`${filename}: legacy public role leaked into prompt`);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`Buzz OpenConfig collaboration mesh tests passed: ${expectedHandoffs.size} personas`);
