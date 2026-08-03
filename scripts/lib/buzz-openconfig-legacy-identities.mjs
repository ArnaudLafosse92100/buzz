// One-way compatibility data for installations created before Buzz adopted
// canonical OpenConfig names. Never use these aliases for new records or
// prompt generation; they exist only to converge old local data in place.
export const legacyIdentityReplacements = Object.freeze([
  ["Jiminy Cricket", "Prometheus"],
  ["Lumière", "Bug Hunt"],
  ["Hercules", "Hephaestus"],
  ["Rapunzel", "Multimodal Looker"],
  ["Merlin", "Sisyphus"],
  ["Mushu", "Sisyphus Junior"],
  ["Hades", "Oracle"],
  ["Tarzan", "Atlas"],
  ["Moana", "Explore"],
  ["Belle", "Librarian"],
  ["Mulan", "Metis"],
  ["Yzma", "Momus"],
  ["Basil", "Content-Aware Research"],
  ["Genie", "Sisyphus"],
]);
export const legacyIdentityMap = Object.freeze(Object.fromEntries(legacyIdentityReplacements));

export const legacyTeamNames = new Map([
  ["content-aware-audit", "Content-Aware Audit"],
  ["debug-team", "Debug Team"],
  ["docs-team", "Docs Team"],
  ["explorers", "Explorers"],
  ["refactor-team", "Refactor Team"],
  ["review-panel", "Review Panel"],
  ["ship-feature", "Ship Feature"],
]);

export function canonicalizeLegacyIdentity(text) {
  if (text === null || text === undefined) return text;
  return legacyIdentityReplacements.reduce(
    (result, [from, to]) => result.replaceAll(from, to),
    text,
  );
}
