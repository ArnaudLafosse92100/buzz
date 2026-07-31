import type { UserSearchResult } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { hasMention } from "./hasMention";
import type { MentionCandidate } from "./mentionCandidates";

export function formatSearchUserDisplayName(user: UserSearchResult) {
  return user.displayName?.trim() || user.nip05Handle?.trim() || null;
}

export function formatSearchUserSecondaryLabel(user: UserSearchResult) {
  const displayName = user.displayName?.trim();
  const nip05Handle = user.nip05Handle?.trim();
  return displayName && nip05Handle ? nip05Handle : null;
}

export function appendUniqueName(current: string[], name: string): string[] {
  return current.some(
    (candidate) => candidate.toLowerCase() === name.toLowerCase(),
  )
    ? current
    : [...current, name];
}

export function resolveMentionDisplayName(
  pubkey: string,
  mentionMap: ReadonlyMap<string, string>,
  candidates: readonly MentionCandidate[],
): string | null {
  const normalizedPubkey = normalizePubkey(pubkey);
  for (const [displayName, mentionPubkey] of mentionMap) {
    if (normalizePubkey(mentionPubkey) === normalizedPubkey) {
      return displayName;
    }
  }
  return (
    candidates.find(
      (candidate) =>
        candidate.pubkey !== undefined &&
        normalizePubkey(candidate.pubkey) === normalizedPubkey,
    )?.displayName ?? null
  );
}

export function collectMentionPubkeys(
  text: string,
  mentionMap: ReadonlyMap<string, string>,
  personaMentionMap: ReadonlyMap<string, string>,
  candidates: readonly MentionCandidate[],
): string[] {
  const pubkeys: string[] = [];
  const selectedDisplayNames = new Set(
    [...mentionMap.keys(), ...personaMentionMap.keys()].map((name) =>
      name.trim().toLowerCase(),
    ),
  );

  for (const [displayName, pubkey] of mentionMap) {
    if (hasMention(text, displayName)) pubkeys.push(pubkey);
  }

  for (const candidate of candidates) {
    const { displayName, pubkey } = candidate;
    if (!pubkey || !candidate.isMember || pubkeys.includes(pubkey)) continue;
    if (
      displayName &&
      !selectedDisplayNames.has(displayName.trim().toLowerCase()) &&
      hasMention(text, displayName)
    ) {
      pubkeys.push(pubkey);
    }
  }

  return [...new Set(pubkeys)];
}
