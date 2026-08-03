#!/usr/bin/env node
/**
 * Synchronize the checked-in-local Buzz persona prompt files into their
 * native managed persona records. This is deliberately a narrow admin tool:
 * it changes system prompts only and proves every functional field survives
 * the native update unchanged.
 *
 * Required environment:
 *   BUZZ_LOCAL_AUTOMATION_TOKEN  bearer token supplied at desktop launch
 * Optional environment:
 *   BUZZ_LOCAL_AUTOMATION_URL    defaults to http://127.0.0.1:43121
 */

import { openConfigRoles } from "./lib/buzz-openconfig-manifest.mjs";
import { installPersonaPrompt } from "./lib/buzz-openconfig-persona-prompts.mjs";

const baseUrl = (process.env.BUZZ_LOCAL_AUTOMATION_URL ?? "http://127.0.0.1:43121").replace(/\/$/, "");
const token = process.env.BUZZ_LOCAL_AUTOMATION_TOKEN;
if (!token || token.length < 32) {
  throw new Error("BUZZ_LOCAL_AUTOMATION_TOKEN must contain the local API bearer token");
}

const expectedRoster = new Map(openConfigRoles.map((role) => [role.enginePath, role]));

async function request(pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${pathname} failed (${response.status}): ${body?.error ?? "invalid response"}`);
  }
  return body;
}

function functionalSnapshot(persona) {
  return {
    display_name: persona.display_name,
    avatar_url: persona.avatar_url,
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

function updatePayload(persona, systemPrompt) {
  const body = {
    id: persona.id,
    displayName: persona.display_name,
    avatarUrl: persona.avatar_url,
    systemPrompt,
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
const managed = personas.filter((persona) => persona.runtime === "buzz-openconfig"
  && expectedRoster.has(persona.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE));
if (managed.length !== expectedRoster.size) {
  throw new Error(`expected ${expectedRoster.size} managed OpenConfig personas, found ${managed.length}`);
}

const seenEngines = new Set();
const changed = [];
for (const persona of managed) {
  const engine = persona.env_vars.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE;
  if (seenEngines.has(engine)) throw new Error(`duplicate managed persona for ${engine}`);
  seenEngines.add(engine);
  const role = expectedRoster.get(engine);
  const expectedName = role.name;
  if (persona.display_name !== expectedName) {
    throw new Error(`${engine}: expected public name ${expectedName}, found ${persona.display_name}`);
  }
  if (persona.env_vars?.BUZZ_OPENCONFIG_PERSONA_PROMPT_FILE !== role.personaPath) {
    throw new Error(`${expectedName}: runtime prompt path drifted from the canonical manifest`);
  }
  const systemPrompt = await installPersonaPrompt(role);
  if (!systemPrompt.includes("## Collaboration mesh") || !systemPrompt.includes("ACTION OWNER")) {
    throw new Error(`${expectedName}: source prompt is missing the required collaboration mesh`);
  }

  const before = functionalSnapshot(persona);
  const updated = await request(`/v1/personas/${encodeURIComponent(persona.id)}`, {
    method: "PATCH",
    body: JSON.stringify(updatePayload(persona, systemPrompt)),
  });
  if (JSON.stringify(functionalSnapshot(updated)) !== JSON.stringify(before)) {
    throw new Error(`${expectedName}: native update changed a functional field`);
  }
  if (updated.system_prompt !== systemPrompt) {
    throw new Error(`${expectedName}: native update did not persist its collaboration mesh`);
  }
  changed.push(expectedName);
}

console.log(JSON.stringify({ changed: changed.sort(), functionalFieldsPreserved: true }, null, 2));
