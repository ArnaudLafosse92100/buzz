#!/usr/bin/env node
/**
 * Create or reconcile the public OpenConfig personas and native Buzz teams.
 * All identity, model, variant, port, and team policy data comes from the
 * checked-in manifest; this file only performs native API operations.
 */

import {
  buzzRepoRoot,
  openConfigRoles,
  openConfigTeams,
} from "./lib/buzz-openconfig-manifest.mjs";
import { buzzOpenConfigProfile } from "./lib/buzz-openconfig-routing.mjs";
import { legacyTeamNames } from "./lib/buzz-openconfig-legacy-identities.mjs";
import { installPersonaPrompt } from "./lib/buzz-openconfig-persona-prompts.mjs";

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

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForStableStart(pubkey, name) {
  const deadline = Date.now() + 15_000;
  let stableSince = null;
  let lastError = null;
  while (Date.now() < deadline) {
    const agents = await request("/v1/agents");
    const agent = agents.find((candidate) => candidate.pubkey === pubkey);
    if (!agent) throw new Error(`${name}: managed agent disappeared while starting`);
    if (agent.status === "running" || agent.status === "deployed") {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 2_000) return { ok: true, error: null };
    } else {
      stableSince = null;
      lastError = agent.last_error ?? lastError;
      if (agent.status === "stopped" && lastError) return { ok: false, error: lastError };
    }
    await delay(250);
  }
  return { ok: false, error: lastError ?? "did not remain running for two seconds" };
}

async function startAgentReliably(agent, name) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await request(`/v1/agents/${encodeURIComponent(agent.pubkey)}/start`, { method: "POST" });
    const result = await waitForStableStart(agent.pubkey, name);
    if (result.ok) return;
    lastError = result.error;
    if (attempt < 3) await delay(attempt * 1_000);
  }
  throw new Error(`${name}: failed to start after three attempts: ${lastError}`);
}

function roleMatches(personas, role) {
  return personas.filter((persona) => persona.runtime === "buzz-openconfig"
    && persona.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === role.enginePath);
}

function behaviorPayload(persona) {
  const allowlist = persona.respond_to_allowlist ?? [];
  const hasBehavior = persona.respond_to !== null || persona.parallelism !== null || allowlist.length > 0;
  if (!hasBehavior) return undefined;
  return {
    ...(persona.respond_to === null ? {} : { respondTo: persona.respond_to }),
    respondToAllowlist: allowlist,
    ...(persona.parallelism === null ? {} : { parallelism: persona.parallelism }),
  };
}

function functionalSnapshot(persona) {
  const envVars = { ...(persona.env_vars ?? {}) };
  for (const key of [
    "BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE",
    "BUZZ_OPENCONFIG_MODEL",
    "BUZZ_OPENCONFIG_PROFILE",
    "BUZZ_OPENCONFIG_ROUTE_SECTION",
    "BUZZ_OPENCONFIG_ROUTE_NAME",
    "BUZZ_OPENCONFIG_PROJECT_DIR",
    "BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE",
    "BUZZ_OPENCONFIG_PUBLIC_NAME",
    "BUZZ_OPENCONFIG_AGENT_NAME",
    "BUZZ_OPENCONFIG_VARIANT",
  ]) delete envVars[key];
  return {
    id: persona.id,
    pubkey: persona.pubkey,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    name_pool: persona.name_pool,
    env_vars: envVars,
    respond_to: persona.respond_to,
    respond_to_allowlist: persona.respond_to_allowlist ?? [],
    parallelism: persona.parallelism,
  };
}

function canonicalPersonaPayload(persona, spec, systemPrompt) {
  const behavior = behaviorPayload(persona);
  const envVars = {
    ...(persona.env_vars ?? {}),
    BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE: spec.enginePath,
    BUZZ_OPENCONFIG_PROFILE: buzzOpenConfigProfile,
    BUZZ_OPENCONFIG_ROUTE_SECTION: spec.routeSection,
    BUZZ_OPENCONFIG_ROUTE_NAME: spec.routeName,
    BUZZ_OPENCONFIG_PROJECT_DIR: buzzRepoRoot,
    BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE: spec.personaPath,
    BUZZ_OPENCONFIG_PUBLIC_NAME: spec.name,
    BUZZ_OPENCONFIG_AGENT_NAME: spec.slug,
  };
  delete envVars.BUZZ_OPENCONFIG_MODEL;
  delete envVars.BUZZ_OPENCONFIG_VARIANT;
  return {
    id: persona.id,
    displayName: spec.displayName,
    avatarUrl: null,
    systemPrompt,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    namePool: persona.name_pool,
    envVars,
    ...(behavior ? { behavior } : {}),
  };
}

async function ensurePersona(spec, personas) {
  const existing = roleMatches(personas, spec);
  if (existing.length > 1) {
    throw new Error(`multiple personas carry OpenConfig engine ${spec.enginePath}; refusing to select one`);
  }

  const systemPrompt = await installPersonaPrompt(spec);
  if (existing.length === 1) {
    const before = functionalSnapshot(existing[0]);
    const updated = await request(`/v1/personas/${encodeURIComponent(existing[0].id)}`, {
      method: "PATCH",
      body: JSON.stringify(canonicalPersonaPayload(existing[0], spec, systemPrompt)),
    });
    if (JSON.stringify(functionalSnapshot(updated)) !== JSON.stringify(before)) {
      throw new Error(`${spec.name}: canonical reconciliation changed a non-OpenConfig functional field`);
    }
    if (updated.display_name !== spec.displayName || updated.avatar_url !== null || updated.system_prompt !== systemPrompt) {
      throw new Error(`${spec.name}: canonical identity or prompt did not persist`);
    }
    return { persona: updated, created: false };
  }

  const envVars = {
    BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE: spec.enginePath,
    BUZZ_OPENCONFIG_PROFILE: buzzOpenConfigProfile,
    BUZZ_OPENCONFIG_ROUTE_SECTION: spec.routeSection,
    BUZZ_OPENCONFIG_ROUTE_NAME: spec.routeName,
    BUZZ_OPENCONFIG_PROJECT_DIR: buzzRepoRoot,
    BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE: spec.personaPath,
    BUZZ_OPENCONFIG_PUBLIC_NAME: spec.name,
    BUZZ_OPENCONFIG_AGENT_NAME: spec.slug,
  };

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
for (const team of openConfigTeams) {
  const personaIds = team.members.map((name) => {
    const persona = personasByRole.get(name);
    if (!persona) throw new Error(`team ${team.name} requires OpenConfig role ${name}`);
    return persona.id;
  });
  const acceptedNames = new Set([team.name, legacyTeamNames.get(team.name)]);
  const matches = existingTeams.filter((candidate) => acceptedNames.has(candidate.name));
  if (matches.length > 1) {
    throw new Error(`team ${team.name} has both canonical and legacy records; refusing to guess`);
  }
  if (matches.length === 1) {
    const updated = await request(`/v1/teams/${encodeURIComponent(matches[0].id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        id: matches[0].id,
        name: team.name,
        description: team.description,
        instructions: team.instructions,
        personaIds,
      }),
    });
    if (updated.id !== matches[0].id
      || updated.name !== team.name
      || updated.description !== team.description
      || updated.instructions !== team.instructions
      || JSON.stringify(updated.persona_ids) !== JSON.stringify(personaIds)) {
      throw new Error(`team ${team.name} did not converge in place`);
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
  const expectedPrompt = await installPersonaPrompt(role);
  const actual = matches[0];
  if (actual.display_name !== role.displayName
    || actual.avatar_url !== null
    || actual.system_prompt !== expectedPrompt
    || actual.env_vars?.BUZZ_OPENCONFIG_PUBLIC_NAME !== role.name
    || actual.env_vars?.BUZZ_OPENCONFIG_AGENT_NAME !== role.slug
    || actual.env_vars?.BUZZ_OPENCONFIG_PROFILE !== buzzOpenConfigProfile
    || actual.env_vars?.BUZZ_OPENCONFIG_ROUTE_SECTION !== role.routeSection
    || actual.env_vars?.BUZZ_OPENCONFIG_ROUTE_NAME !== role.routeName
    || actual.env_vars?.BUZZ_OPENCONFIG_PROJECT_DIR !== buzzRepoRoot
    || "BUZZ_OPENCONFIG_MODEL" in (actual.env_vars ?? {})
    || "BUZZ_OPENCONFIG_VARIANT" in (actual.env_vars ?? {})) {
    throw new Error(`${role.name}: final canonical persona verification failed`);
  }
  finalPersonasByRole.set(role.name, matches[0]);
}
const configuredTeams = finalTeams.filter((team) => openConfigTeams.some((expected) => expected.name === team.name));
if (configuredTeams.length !== openConfigTeams.length) {
  throw new Error(`expected ${openConfigTeams.length} OpenConfig teams, found ${configuredTeams.length}`);
}
for (const expected of openConfigTeams) {
  const team = configuredTeams.find((candidate) => candidate.name === expected.name);
  const personaIds = expected.members.map((name) => finalPersonasByRole.get(name).id);
  if (!team
    || team.description !== expected.description
    || team.instructions !== expected.instructions
    || JSON.stringify(team.persona_ids) !== JSON.stringify(personaIds)) {
    throw new Error(`${expected.name}: final canonical team verification failed`);
  }
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
  await startAgentReliably(agent, role.name);
}

console.log(JSON.stringify({
  createdAgents,
  createdTeams,
  namedOpenConfigRoles: finalPersonasByRole.size,
  openConfigTeams: configuredTeams.length,
  totalBuzzTeams: finalTeams.length,
  acpPorts: Object.fromEntries(openConfigRoles.map((role) => [role.name, role.acpPort])),
}, null, 2));
