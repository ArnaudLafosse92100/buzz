#!/usr/bin/env node
/**
 * Create or reconcile the public OpenConfig personas and native Buzz teams.
 * All identity, model, variant, port, and team policy data comes from the
 * checked-in manifest; this file only performs native API operations.
 */

import { readFile } from "node:fs/promises";
import {
  openConfigRoles,
  openConfigTeams,
} from "./lib/buzz-openconfig-manifest.mjs";

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

function roleMatches(personas, role) {
  return personas.filter((persona) => persona.runtime === "buzz-openconfig"
    && persona.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === role.enginePath);
}

async function ensurePersona(spec, personas) {
  const existing = roleMatches(personas, spec);
  if (existing.length === 1) return { persona: existing[0], created: false };
  if (existing.length > 1) {
    throw new Error(`multiple personas carry OpenConfig engine ${spec.enginePath}; refusing to select one`);
  }

  const systemPrompt = await readFile(spec.personaPath, "utf8");
  const envVars = {
    BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE: spec.enginePath,
    BUZZ_OPENCONFIG_MODEL: spec.model,
    BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE: spec.personaPath,
    BUZZ_OPENCONFIG_PUBLIC_NAME: spec.name,
    BUZZ_OPENCONFIG_AGENT_NAME: spec.slug,
  };
  if (spec.variant !== null) envVars.BUZZ_OPENCONFIG_VARIANT = spec.variant;

  const response = await request("/v1/personas-with-agent", {
    method: "POST",
    body: JSON.stringify({
      persona: {
        displayName: spec.displayName,
        avatarUrl: null,
        systemPrompt,
        runtime: "buzz-openconfig",
        model: null,
        provider: null,
        namePool: [],
        envVars,
        behavior: {
          respondTo: "owner-only",
          respondToAllowlist: [],
          parallelism: 1,
        },
      },
      startAfterCreate: false,
      startOnAppLaunch: false,
      agentArgs: ["--port", String(spec.acpPort)],
    }),
  });
  return { persona: response.persona, created: true };
}

const health = await request("/v1/health");
if (health.status !== "ok") throw new Error("Buzz local automation health check did not return ok");

let personas = await request("/v1/personas");
const createdAgents = [];
for (const spec of openConfigRoles) {
  const result = await ensurePersona(spec, personas);
  if (result.created) {
    createdAgents.push(spec.name);
    personas.push(result.persona);
  }
}

personas = await request("/v1/personas");
const personasByRole = new Map();
for (const role of openConfigRoles) {
  const matches = roleMatches(personas, role);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one active persona for OpenConfig role ${role.name}, found ${matches.length}`);
  }
  personasByRole.set(role.name, matches[0]);
}

const createdTeams = [];
const existingTeams = await request("/v1/teams");
const teamsByName = new Map(existingTeams.map((team) => [team.name, team]));
for (const team of openConfigTeams) {
  const personaIds = team.members.map((name) => {
    const persona = personasByRole.get(name);
    if (!persona) throw new Error(`team ${team.name} requires OpenConfig role ${name}`);
    return persona.id;
  });
  const existing = teamsByName.get(team.name);
  if (existing) {
    if (JSON.stringify(existing.persona_ids) !== JSON.stringify(personaIds)) {
      throw new Error(`team ${team.name} already exists with a different roster; run the team synchronizer`);
    }
    continue;
  }
  await request("/v1/teams", {
    method: "POST",
    body: JSON.stringify({
      name: team.name,
      description: team.description,
      instructions: team.instructions,
      personaIds,
    }),
  });
  createdTeams.push(team.name);
}

const finalPersonas = await request("/v1/personas");
const finalTeams = await request("/v1/teams");
const finalPersonasByRole = new Map();
for (const role of openConfigRoles) {
  const matches = roleMatches(finalPersonas, role);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one final persona for OpenConfig role ${role.name}, found ${matches.length}`);
  }
  finalPersonasByRole.set(role.name, matches[0]);
}
const configuredTeams = finalTeams.filter((team) => openConfigTeams.some((expected) => expected.name === team.name));
if (configuredTeams.length !== openConfigTeams.length) {
  throw new Error(`expected ${openConfigTeams.length} OpenConfig teams, found ${configuredTeams.length}`);
}

const managedAgents = await request("/v1/agents");
const managedByPersonaId = new Map();
for (const agent of managedAgents) {
  if (![...finalPersonasByRole.values()].some((persona) => persona.id === agent.persona_id)) continue;
  const matches = managedByPersonaId.get(agent.persona_id) ?? [];
  matches.push(agent);
  managedByPersonaId.set(agent.persona_id, matches);
}

for (const role of openConfigRoles) {
  const persona = finalPersonasByRole.get(role.name);
  const matches = managedByPersonaId.get(persona.id) ?? [];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one managed agent for ${role.name}, found ${matches.length}`);
  }
  const path = `/v1/agents/${encodeURIComponent(matches[0].pubkey)}`;
  await request(`${path}/stop`, { method: "POST" });
  await request(`${path}/args`, {
    method: "PATCH",
    body: JSON.stringify({ agentArgs: ["--port", String(role.acpPort)] }),
  });
  await request(`${path}/start-on-app-launch`, {
    method: "PATCH",
    body: JSON.stringify({ startOnAppLaunch: true }),
  });
}

for (const role of openConfigRoles) {
  const agent = managedByPersonaId.get(finalPersonasByRole.get(role.name).id)[0];
  await request(`/v1/agents/${encodeURIComponent(agent.pubkey)}/start`, { method: "POST" });
}

console.log(JSON.stringify({
  createdAgents,
  createdTeams,
  namedOpenConfigRoles: finalPersonasByRole.size,
  openConfigTeams: configuredTeams.length,
  totalBuzzTeams: finalTeams.length,
  acpPorts: Object.fromEntries(openConfigRoles.map((role) => [role.name, role.acpPort])),
}, null, 2));
