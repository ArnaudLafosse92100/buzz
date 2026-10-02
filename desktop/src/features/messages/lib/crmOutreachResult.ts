import type { RelayEvent } from "@/shared/api/types";
import { crmEditReactionContent } from "@/shared/api/crmEditReaction";
import { resolveEventAuthorPubkey } from "@/shared/lib/authors";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
  KIND_REACTION,
} from "@/shared/constants/kinds";
import { parseCrmActionCard } from "../ui/crmActionCardParser";

export type CrmOutreachResult = {
  eventId: string;
  state: "edited" | "rejected" | "sent" | "expired" | "failed";
  revision: number;
  editPayload?: string;
};

const RECEIPT =
  /(?:^|\n)<!-- crm-outreach-result:v1:([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}):([0-9a-f]{64}):(edited|rejected|sent|expired|failed):([0-9]{1,6}):([0-9a-f]{64}|-) -->\s*$/;

/** Hide only the bounded machine receipt, retaining the readable CRM message. */
export function withoutCrmOutreachReceipt(body: string): string {
  return RECEIPT.test(body) ? body.replace(RECEIPT, "").trimEnd() : body;
}

/** Match receipts to the original card's signer, author, channel and action ID.
 * This is display state only; CRM remains the authorization and execution gate.
 */
export function collectCrmOutreachResults(
  events: RelayEvent[],
  deletedIds: Set<string>,
  relaySelfPubkey?: string | null,
): Map<string, CrmOutreachResult> {
  const results = new Map<string, CrmOutreachResult>();
  const messageKinds = [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2];
  const candidates = events
    .filter(
      (event) =>
        messageKinds.includes(event.kind) &&
        !event.pending &&
        !deletedIds.has(event.id) &&
        event.content.includes("crm-outreach-result:v1:"),
    )
    .sort((a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id));
  if (!candidates.length) return results;
  const byId = new Map(events.map((event) => [event.id, event]));
  const channel = (event: RelayEvent) => {
    const tags = event.tags.filter((tag) => tag[0] === "h");
    return tags.length === 1 ? tags[0][1] : undefined;
  };
  const author = (event: RelayEvent) =>
    resolveEventAuthorPubkey({
      event,
      relaySelfPubkey,
      preferActorTag: true,
      requireChannelTagForPTags: true,
    });
  for (const event of candidates) {
    const match = RECEIPT.exec(event.content);
    if (!match || event.content.split("crm-outreach-result:v1:").length !== 2)
      continue;
    const [, actionId, targetId, state, revision, reactionId] = match;
    const target = byId.get(targetId);
    if (
      !target ||
      target.pending ||
      deletedIds.has(targetId) ||
      !messageKinds.includes(target.kind) ||
      event.pubkey !== target.pubkey ||
      author(event) !== author(target) ||
      !channel(target) ||
      channel(event) !== channel(target) ||
      event.created_at < target.created_at
    )
      continue;
    const action = parseCrmActionCard(target.content);
    if (
      action?.actionType !== "outreach_approve" ||
      action.actionId !== actionId
    )
      continue;
    let editPayload: string | undefined;
    if (state === "edited") {
      const reaction = byId.get(reactionId);
      if (
        Number(revision) < 2 ||
        !reaction ||
        reaction.kind !== KIND_REACTION ||
        reaction.pending ||
        deletedIds.has(reactionId) ||
        channel(reaction) !== channel(target) ||
        !reaction.tags.some((tag) => tag[0] === "e" && tag[1] === targetId) ||
        reaction.created_at > event.created_at
      )
        continue;
      editPayload = crmEditReactionContent(reaction.content, reaction.tags);
      if (!editPayload.startsWith("crm-action-edit:v1:")) continue;
    } else if (revision !== "0" || reactionId !== "-") continue;
    // A delayed edit receipt must never reopen a terminal card.
    const previous = results.get(targetId);
    if (previous && previous.state !== "edited" && state === "edited") continue;
    if (state === "edited" && previous && previous.revision >= Number(revision))
      continue;
    results.set(targetId, {
      eventId: event.id,
      state: state as CrmOutreachResult["state"],
      revision: Number(revision),
      editPayload,
    });
  }
  return results;
}
