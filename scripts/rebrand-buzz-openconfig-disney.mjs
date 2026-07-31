#!/usr/bin/env node
/**
 * Re-skin the public Buzz OpenConfig personas with coherent Disney character
 * names and portraits without changing their operational configuration.
 *
 * The script identifies each role from its immutable upstream engine prompt,
 * then replays every functional field verbatim through Buzz's native persona
 * update command. It intentionally does not modify prompts, models, runtime,
 * provider, environment, behavior, managed-agent arguments, or teams.
 *
 * Required environment:
 *   BUZZ_LOCAL_AUTOMATION_TOKEN  bearer token supplied at desktop launch
 * Optional environment:
 *   BUZZ_LOCAL_AUTOMATION_URL    defaults to http://127.0.0.1:43121
 */

import { readFile } from "node:fs/promises";

const baseUrl = (process.env.BUZZ_LOCAL_AUTOMATION_URL ?? "http://127.0.0.1:43121").replace(/\/$/, "");
const token = process.env.BUZZ_LOCAL_AUTOMATION_TOKEN;

if (!token || token.length < 32) {
  throw new Error("BUZZ_LOCAL_AUTOMATION_TOKEN must contain the local API bearer token");
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${body?.error ?? "invalid response"}`);
  }
  return body;
}

const engineRoot = "/Volumes/PERSO/OpenConfig/prompts";
const merlinAvatarPath = "/Users/arnaud/Downloads/Merlin_-_DisneyCharacter.jpg";
const merlinAvatarUrl = `data:image/jpeg;base64,${(await readFile(merlinAvatarPath)).toString("base64")}`;

// `enginePrompt` is the immutable technical identity. Display name and avatar
// below are deliberately the only fields this script changes.
const roster = [
  { name: "Merlin", enginePrompt: `${engineRoot}/agents/sisyphus.md`, avatarUrl: merlinAvatarUrl },
  { name: "Hercules", enginePrompt: `${engineRoot}/agents/hephaestus.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/7/70/Profile_-_Hercules.jpeg" },
  { name: "Hades", enginePrompt: `${engineRoot}/agents/oracle.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/2/2c/Profile_-_Hades.jpeg" },
  { name: "Lumière", enginePrompt: `${engineRoot}/categories/bug-hunt.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/f/f5/Profile_-_Lumiere.jpeg" },
  { name: "Mushu", enginePrompt: `${engineRoot}/agents/sisyphus-junior.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/1/17/Profile_-_Mushu.jpeg" },
  { name: "Jiminy Cricket", enginePrompt: `${engineRoot}/agents/prometheus.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/f/f0/Profile_-_Jiminy_Cricket.jpeg" },
  { name: "Tarzan", enginePrompt: `${engineRoot}/agents/atlas.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/2/2e/Profile_-_Tarzan.png" },
  { name: "Moana", enginePrompt: `${engineRoot}/agents/explore.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/7/7d/Profile_-_Moana.png" },
  { name: "Belle", enginePrompt: `${engineRoot}/agents/librarian.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/1/1b/Profile_-_Belle.jpeg" },
  { name: "Rapunzel", enginePrompt: `${engineRoot}/agents/multimodal-looker.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/a/ae/Profile_-_Rapunzel.jpeg" },
  { name: "Mulan", enginePrompt: `${engineRoot}/agents/metis.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/0/04/Profile_-_Mulan.jpeg" },
  { name: "Yzma", enginePrompt: `${engineRoot}/agents/momus.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/f/f2/Profile_-_Yzma.jpeg" },
  { name: "Basil", enginePrompt: `${engineRoot}/agents/content-aware-research.md`, avatarUrl: "https://static.wikia.nocookie.net/disney/images/2/28/Basil_of_Baker_Street.png" },
];

function functionalSnapshot(persona) {
  return {
    system_prompt: persona.system_prompt,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    name_pool: persona.name_pool,
    env_vars: persona.env_vars,
    respond_to: persona.respond_to,
    respond_to_allowlist: persona.respond_to_allowlist,
    parallelism: persona.parallelism,
  };
}

function updatePayload(persona, spec) {
  const body = {
    id: persona.id,
    displayName: spec.name,
    avatarUrl: spec.avatarUrl,
    systemPrompt: persona.system_prompt,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    namePool: persona.name_pool,
    envVars: persona.env_vars,
  };
  const hasBehavior = persona.respond_to !== null
    || persona.parallelism !== null
    || persona.respond_to_allowlist.length > 0;
  if (hasBehavior) {
    body.behavior = {
      ...(persona.respond_to === null ? {} : { respondTo: persona.respond_to }),
      respondToAllowlist: persona.respond_to_allowlist,
      ...(persona.parallelism === null ? {} : { parallelism: persona.parallelism }),
    };
  }
  return body;
}

const health = await request("/v1/health");
if (health.status !== "ok") throw new Error("Buzz local automation health check did not return ok");

const personas = await request("/v1/personas");
const changed = [];
for (const spec of roster) {
  const matches = personas.filter((persona) => persona.runtime === "buzz-openconfig"
    && persona.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === spec.enginePrompt);
  if (matches.length !== 1) {
    throw new Error(`${spec.name}: expected exactly one Buzz OpenConfig persona with engine ${spec.enginePrompt}, found ${matches.length}`);
  }

  const persona = matches[0];
  const before = functionalSnapshot(persona);
  const result = await request(`/v1/personas/${encodeURIComponent(persona.id)}`, {
    method: "PATCH",
    body: JSON.stringify(updatePayload(persona, spec)),
  });
  if (JSON.stringify(functionalSnapshot(result)) !== JSON.stringify(before)) {
    throw new Error(`${spec.name}: native update changed a functional field; stopping for manual review`);
  }
  if (result.display_name !== spec.name || result.avatar_url !== spec.avatarUrl) {
    throw new Error(`${spec.name}: native update did not persist the requested identity`);
  }
  changed.push({ name: spec.name, personaId: result.id });
}

console.log(JSON.stringify({ changed, functionalFieldsPreserved: true }, null, 2));
