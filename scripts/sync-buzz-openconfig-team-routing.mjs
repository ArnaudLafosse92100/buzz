#!/usr/bin/env node
/**
 * Reconcile all seven OpenConfig team records through Buzz's native API.
 * No JSON store is edited directly.
 */

import { openConfigTeams } from "./lib/buzz-openconfig-manifest.mjs";

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

const health = await request("/v1/health");
if (health.status !== "ok") throw new Error("Buzz local automation health check did not return ok");

const teams = await request("/v1/teams");
const personas = await request("/v1/personas");
const personasByName = new Map(personas.map((persona) => [persona.display_name, persona]));
const changed = [];

for (const expected of openConfigTeams) {
  const team = teams.find((candidate) => candidate.name === expected.name);
  if (!team) throw new Error(`missing expected team: ${expected.name}`);
  const personaIds = expected.members.map((member) => {
    const persona = personasByName.get(member);
    if (!persona) throw new Error(`${expected.name}: missing persona ${member}`);
    return persona.id;
  });
  const updated = await request(`/v1/teams/${encodeURIComponent(team.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      id: team.id,
      name: expected.name,
      description: expected.description,
      instructions: expected.instructions,
      personaIds,
    }),
  });
  if (updated.name !== expected.name
    || updated.description !== expected.description
    || updated.instructions !== expected.instructions
    || JSON.stringify(updated.persona_ids) !== JSON.stringify(personaIds)) {
    throw new Error(`${expected.name}: canonical team definition did not persist`);
  }
  changed.push(expected.name);
}

const finalTeams = await request("/v1/teams");
if (finalTeams.some((team) => team.id === "builtin-team:welcome"
  || team.id === "builtin-team:fizz"
  || team.name === "Forge Coding Team"
  || team.name === "Welcome Team")) {
  throw new Error("a removed Welcome/Forge team still exists");
}
for (const expected of openConfigTeams) {
  const team = finalTeams.find((candidate) => candidate.name === expected.name);
  const personaIds = expected.members.map((name) => personasByName.get(name).id);
  if (!team
    || team.description !== expected.description
    || team.instructions !== expected.instructions
    || JSON.stringify(team.persona_ids) !== JSON.stringify(personaIds)) {
    throw new Error(`${expected.name}: final team verification failed`);
  }
}

console.log(JSON.stringify({
  changed,
  teamsVerified: openConfigTeams.length,
}, null, 2));
