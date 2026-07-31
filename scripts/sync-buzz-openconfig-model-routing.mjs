#!/usr/bin/env node
/**
 * Synchronize the public Buzz OpenConfig roster to the gateway-owned model
 * routes. It uses the loopback admin API rather than writing Buzz stores so
 * persona validation, owner records, and running-agent lifecycle stay native.
 *
 * Usage:
 *   BUZZ_LOCAL_AUTOMATION_TOKEN=... node scripts/sync-buzz-openconfig-model-routing.mjs --restart
 *
 * `--restart` is deliberate: a running ACP subprocess only receives its
 * persona environment at start. Without it, this script persists and verifies
 * the routes but leaves existing subprocesses untouched.
 */

import { openConfigRoles } from "./lib/buzz-openconfig-manifest.mjs";

const baseUrl = (process.env.BUZZ_LOCAL_AUTOMATION_URL ?? "http://127.0.0.1:43121").replace(/\/$/, "");
const token = process.env.BUZZ_LOCAL_AUTOMATION_TOKEN;
const restart = process.argv.slice(2).includes("--restart");
if (!token || token.length < 32) {
  throw new Error("BUZZ_LOCAL_AUTOMATION_TOKEN must contain the local API bearer token");
}

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

const routes = openConfigRoles;

function snapshotWithoutRoute(persona) {
  const envVars = { ...(persona.env_vars ?? {}) };
  delete envVars.BUZZ_OPENCONFIG_MODEL;
  delete envVars.BUZZ_OPENCONFIG_VARIANT;
  return {
    display_name: persona.display_name,
    avatar_url: persona.avatar_url,
    system_prompt: persona.system_prompt,
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

function updatePayload(persona, route) {
  const envVars = { ...(persona.env_vars ?? {}), BUZZ_OPENCONFIG_MODEL: route.model };
  if (route.variant === null) delete envVars.BUZZ_OPENCONFIG_VARIANT;
  else envVars.BUZZ_OPENCONFIG_VARIANT = route.variant;
  const body = {
    id: persona.id,
    displayName: persona.display_name,
    avatarUrl: persona.avatar_url,
    systemPrompt: persona.system_prompt,
    runtime: persona.runtime,
    model: persona.model,
    provider: persona.provider,
    namePool: persona.name_pool,
    envVars,
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

let personas = await request("/v1/personas");
const updated = [];
for (const route of routes) {
  const matches = personas.filter((persona) => persona.runtime === "buzz-openconfig"
    && persona.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === route.enginePath);
  if (matches.length !== 1) {
    throw new Error(`${route.name}: expected exactly one managed persona for ${route.enginePath}, found ${matches.length}`);
  }
  const before = snapshotWithoutRoute(matches[0]);
  const result = await request(`/v1/personas/${encodeURIComponent(matches[0].id)}`, {
    method: "PATCH",
    body: JSON.stringify(updatePayload(matches[0], route)),
  });
  if (JSON.stringify(snapshotWithoutRoute(result)) !== JSON.stringify(before)) {
    throw new Error(`${route.name}: native route update changed a non-routing field`);
  }
  if (result.env_vars?.BUZZ_OPENCONFIG_MODEL !== route.model) {
    throw new Error(`${route.name}: native route update did not persist ${route.model}`);
  }
  const actualVariant = result.env_vars?.BUZZ_OPENCONFIG_VARIANT ?? null;
  if (actualVariant !== route.variant) {
    throw new Error(`${route.name}: native route update did not persist variant ${route.variant ?? "default"}`);
  }
  updated.push({ name: route.name, model: route.model, variant: route.variant, personaId: result.id });
}

personas = await request("/v1/personas");
for (const route of routes) {
  const persona = personas.find((candidate) => candidate.runtime === "buzz-openconfig"
    && candidate.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === route.enginePath);
  if (!persona
    || persona.env_vars?.BUZZ_OPENCONFIG_MODEL !== route.model
    || (persona.env_vars?.BUZZ_OPENCONFIG_VARIANT ?? null) !== route.variant) {
    throw new Error(`${route.name}: final route verification failed`);
  }
}

const restarted = [];
if (restart) {
  const agents = await request("/v1/agents");
  for (const route of routes) {
    const persona = personas.find((candidate) => candidate.runtime === "buzz-openconfig"
      && candidate.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === route.enginePath);
    const matches = agents.filter((agent) => agent.persona_id === persona.id);
    if (matches.length !== 1) throw new Error(`${route.name}: expected exactly one managed runtime, found ${matches.length}`);
    await request(`/v1/agents/${encodeURIComponent(matches[0].pubkey)}/stop`, { method: "POST" });
  }
  for (const route of routes) {
    const persona = personas.find((candidate) => candidate.runtime === "buzz-openconfig"
      && candidate.env_vars?.BUZZ_OPENCONFIG_ENGINE_PROMPT_FILE === route.enginePath);
    const agent = agents.find((candidate) => candidate.persona_id === persona.id);
    await request(`/v1/agents/${encodeURIComponent(agent.pubkey)}/start`, { method: "POST" });
    restarted.push(route.name);
  }
}

console.log(JSON.stringify({ updated, restarted, routesVerified: routes.length }, null, 2));
