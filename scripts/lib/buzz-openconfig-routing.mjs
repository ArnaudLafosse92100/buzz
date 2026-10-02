import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { openConfigRoot } from "./buzz-openconfig-manifest.mjs";

const execFileAsync = promisify(execFile);

export const buzzOpenConfigProfile = "normal";

export async function resolveOpenConfigRole(role, profile = buzzOpenConfigProfile) {
  const { stdout } = await execFileAsync(
    `${openConfigRoot}/oc`,
    ["profile", "resolve", profile, role.routeSection, role.routeName],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const route = JSON.parse(stdout);
  if (route.profile !== profile
    || route.section !== role.routeSection
    || route.name !== role.routeName
    || typeof route.model !== "string"
    || !Array.isArray(route.fallback_models)) {
    throw new Error(`${role.name}: invalid OpenConfig route resolution`);
  }
  return Object.freeze({
    ...role,
    profile: route.profile,
    section: route.section,
    model: route.model,
    fallback_models: route.fallback_models,
    variant: route.variant ?? null,
    reasoning: route.reasoning ?? null,
    routeSource: route.source,
  });
}

export async function resolveOpenConfigRoles(roles, profile = buzzOpenConfigProfile) {
  return Promise.all(roles.map((role) => resolveOpenConfigRole(role, profile)));
}
