#!/usr/bin/env node
/**
 * Keep every Buzz/OpenCode-facing OpenConfig identity on the public Disney
 * naming scheme while preserving the underlying role, model, team roster and
 * execution profile. Canonical upstream prompt paths intentionally stay put.
 */

import {
  openConfigRoles,
  openConfigTeams,
  publicIdentityReplacements,
} from "./lib/buzz-openconfig-manifest.mjs";

const baseUrl = (process.env.BUZZ_LOCAL_AUTOMATION_URL ?? "http://127.0.0.1:43121").replace(/\/$/, "");
const token = process.env.BUZZ_LOCAL_AUTOMATION_TOKEN;
if (!token || token.length < 32) throw new Error("BUZZ_LOCAL_AUTOMATION_TOKEN must contain the local API bearer token");

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
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} failed (${response.status}): ${body?.error ?? "invalid response"}`);
  return body;
}

const roles = openConfigRoles;
const editableTeamNames = new Set(openConfigTeams.map((team) => team.name));
const replacements = publicIdentityReplacements;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relabel(text) {
  if (text === null || text === undefined) return text;
  return replacements.reduce(
    (result, [from, to]) => result.replace(new RegExp(`\\b${escapeRegExp(from)}\\b`, "g"), to),
    text,
  );
}

function personaPayload(persona, role) {
  const envVars = {
    ...persona.env_vars,
    BUZZ_OPENCONFIG_PUBLIC_NAME: role.name,
    BUZZ_OPENCONFIG_AGENT_NAME: role.slug,
  };
  const body = {
    id: persona.id,
    displayName: persona.display_name,
    avatarUrl: persona.avatar_url,
    systemPrompt: relabel(persona.system_prompt),
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    namePool: persona.name_pool,
    envVars,
  };
  const hasBehavior = persona.respond_to !== null || persona.parallelism !== null || persona.respond_to_allowlist.length > 0;
  if (hasBehavior) {
    body.behavior = {
      ...(persona.respond_to === null ? {} : { respondTo: persona.respond_to }),
      respondToAllowlist: persona.respond_to_allowlist,
      ...(persona.parallelism === null ? {} : { parallelism: persona.parallelism }),
    };
  }
  return body;
}

function personaFunctionalSnapshot(persona) {
  const envVars = { ...persona.env_vars };
  delete envVars.BUZZ_OPENCONFIG_PUBLIC_NAME;
  delete envVars.BUZZ_OPENCONFIG_AGENT_NAME;
  return {
    display_name: persona.display_name,
    avatar_url: persona.avatar_url,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    name_pool: persona.name_pool,
    env_vars: envVars,
    respond_to: persona.respond_to,
    respond_to_allowlist: persona.respond_to_allowlist,
    parallelism: persona.parallelism,
  };
}

const health = await request("/v1/health");
if (health.status !== "ok") throw new Error("Buzz local automation health check did not return ok");

const personas = await request("/v1/personas");
const personaChanges = [];
for (const role of roles) {
  const enginePath = role.enginePath;
  const matches = personas.filter((persona) => persona.runtime === "buzz-openconfig"
    && persona.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === enginePath);
  if (matches.length !== 1) throw new Error(`${role.name}: expected exactly one persona for ${enginePath}, found ${matches.length}`);
  const before = personaFunctionalSnapshot(matches[0]);
  const updated = await request(`/v1/personas/${encodeURIComponent(matches[0].id)}`, {
    method: "PATCH",
    body: JSON.stringify(personaPayload(matches[0], role)),
  });
  if (JSON.stringify(personaFunctionalSnapshot(updated)) !== JSON.stringify(before)) {
    throw new Error(`${role.name}: a non-identity persona field changed`);
  }
  personaChanges.push(role.name);
}

const teams = await request("/v1/teams");
const teamChanges = [];
for (const team of teams.filter((candidate) => editableTeamNames.has(candidate.name))) {
  const updated = await request(`/v1/teams/${encodeURIComponent(team.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      id: team.id,
      name: team.name,
      description: relabel(team.description),
      instructions: relabel(team.instructions),
      personaIds: team.persona_ids,
    }),
  });
  if (updated.name !== team.name || JSON.stringify(updated.persona_ids) !== JSON.stringify(team.persona_ids)) {
    throw new Error(`${team.name}: a team identity or roster changed`);
  }
  teamChanges.push(team.name);
}
if (teamChanges.length !== editableTeamNames.size) throw new Error(`expected ${editableTeamNames.size} editable OpenConfig teams, updated ${teamChanges.length}`);

const stalePattern = new RegExp(replacements.map(([from]) => escapeRegExp(from)).join("|"));
const finalPersonas = await request("/v1/personas");
const finalTeams = await request("/v1/teams");
for (const persona of finalPersonas.filter((candidate) => candidate.runtime === "buzz-openconfig")) {
  if (stalePattern.test(persona.system_prompt)) throw new Error(`${persona.display_name}: stale public role reference remains in persona instructions`);
}
for (const team of finalTeams.filter((candidate) => editableTeamNames.has(candidate.name))) {
  if (stalePattern.test(team.description ?? "") || stalePattern.test(team.instructions ?? "")) {
    throw new Error(`${team.name}: stale public role reference remains in team text`);
  }
}

console.log(JSON.stringify({ personaChanges, teamChanges, publicNamesConsistent: true }, null, 2));
