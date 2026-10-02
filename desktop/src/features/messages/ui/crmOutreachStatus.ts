import type { CrmOutreachResult } from "../lib/crmOutreachResult";
import type { TimelineReaction } from "../types";
import { decodeCrmOutreachEdit } from "./crmActionCardParser";

/** A reaction acknowledges submission, never completion in CRM. */
export function crmOutreachStatus(
  reactions: TimelineReaction[],
  result: CrmOutreachResult | undefined,
  expired: boolean,
  submitting: string | null,
) {
  const own = reactions.filter((reaction) => reaction.reactedByCurrentUser);
  const decision = [...own]
    .reverse()
    .find((r) => ["✅", "❌"].includes(r.emoji))?.emoji;
  const edit = [...own]
    .reverse()
    .find((r) => decodeCrmOutreachEdit(r.emoji) !== null);
  const terminal = result && result.state !== "edited";
  const locked = Boolean(terminal || decision || submitting || expired);
  const edited = Boolean(
    edit && result?.state === "edited" && result.editPayload === edit.emoji,
  );
  if (terminal) {
    const copy = {
      rejected: ["Draft rejected", "Confirmed by CRM. No message was sent."],
      sent: ["Message sent", "CRM confirmed delivery to the sending provider."],
      expired: [
        "Review expired",
        "This review is closed. Request a new review in CRM.",
      ],
      failed: [
        "CRM needs attention",
        "The outcome could not be confirmed. Check CRM before trying again.",
      ],
    } as const;
    const [title, detail] = copy[result.state as keyof typeof copy];
    return { title, detail, locked, edited, state: result.state };
  }
  if (submitting)
    return {
      title:
        submitting === "❌" ? "Submitting rejection…" : "Submitting approval…",
      detail: "Waiting for Buzz to accept your action.",
      locked,
      edited,
      state: "submitting",
    };
  if (decision)
    return {
      title: decision === "❌" ? "Rejection submitted" : "Approval submitted",
      detail: "Waiting for CRM confirmation. No further action is needed here.",
      locked,
      edited,
      state: "awaiting-crm",
    };
  if (expired)
    return {
      title: "Review expired",
      detail: "Request a new review in CRM to continue.",
      locked,
      edited,
      state: "expired",
    };
  if (edit)
    return {
      title: edited
        ? `Revision ${result?.revision} saved`
        : "Revision submitted",
      detail: edited
        ? "Confirmed by CRM. Review the draft, then approve or reject it."
        : "Waiting for CRM to save this revision. Approval is unavailable until confirmation.",
      locked,
      edited,
      state: edited ? "edited" : "awaiting-edit",
    };
  return {
    title: "Review outreach draft",
    detail: "",
    locked,
    edited,
    state: "ready",
  };
}
