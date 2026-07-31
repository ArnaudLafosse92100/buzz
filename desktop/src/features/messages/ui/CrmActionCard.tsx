import * as React from "react";
import {
  Building2,
  Check,
  Copy,
  Pencil,
  ShieldBan,
  Trash2,
  X,
} from "lucide-react";

import type { TimelineReaction } from "@/features/messages/types";
import {
  decodeCrmOutreachEdit,
  encodeCrmOutreachEdit,
  extractCrmRedditDraft,
  type CrmActionCard as CrmAction,
} from "@/features/messages/ui/crmActionCardParser";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Textarea } from "@/shared/ui/textarea";

const APPROVE_EMOJI = "✅";
const CANCEL_EMOJI = "❌";
const LEAD_CATEGORY_CHOICES = [
  { label: "Interested", reaction: "👍" },
  { label: "Meeting Request", reaction: "📅" },
  { label: "Information Request", reaction: "ℹ️" },
  { label: "Not Interested", reaction: "👎" },
  { label: "Out Of Office", reaction: "🕒" },
  { label: "Do Not Contact", reaction: "⛔" },
  { label: "Wrong Person", reaction: "🔀" },
] as const;
const LEAD_CONTROL_CHOICES = [
  { icon: ShieldBan, label: "Block person", reaction: "⛔" },
  { icon: Building2, label: "Block company", reaction: "🏢" },
  { icon: Trash2, label: "Remove from campaign", reaction: "🗑️" },
] as const;
const CALENDAR_SLOT_REACTIONS = new Set(["1️⃣", "2️⃣", "3️⃣"]);

function isFinalDecisionReaction(
  actionType: CrmAction["actionType"],
  emoji: string,
): boolean {
  switch (actionType) {
    case "reddit_mark_posted":
      return emoji === APPROVE_EMOJI || emoji === CANCEL_EMOJI;
    case "lead_categorize":
      return (
        emoji === CANCEL_EMOJI ||
        LEAD_CATEGORY_CHOICES.some((choice) => choice.reaction === emoji)
      );
    case "outreach_approve":
      return emoji === APPROVE_EMOJI || emoji === CANCEL_EMOJI;
    case "calendar_book":
      return emoji === CANCEL_EMOJI || CALENDAR_SLOT_REACTIONS.has(emoji);
    case "lead_control":
      return emoji === APPROVE_EMOJI;
  }
}

export function CrmActionCard({
  action,
  canToggle,
  pending,
  reactions,
  onSelect,
  onChooseLeadControl,
}: {
  action: CrmAction;
  canToggle: boolean;
  pending: boolean;
  reactions: TimelineReaction[];
  onSelect: (emoji: string) => Promise<void>;
  onChooseLeadControl: (
    choices: readonly string[],
    emoji: string,
  ) => Promise<void>;
}) {
  const [selectedReaction, setSelectedReaction] = React.useState<string | null>(
    null,
  );
  const [editOpen, setEditOpen] = React.useState(false);
  const [editBody, setEditBody] = React.useState("");
  const [editError, setEditError] = React.useState<string | null>(null);
  const expiresAt = Date.parse(action.expiresAt);
  const expired = !Number.isFinite(expiresAt) || Date.now() >= expiresAt;
  const decided = reactions.some(
    (reaction) =>
      reaction.reactedByCurrentUser &&
      isFinalDecisionReaction(action.actionType, reaction.emoji),
  );
  const disabled = !canToggle || pending || expired || decided;
  const redditDraft =
    action.actionType === "reddit_mark_posted"
      ? extractCrmRedditDraft(action.content)
      : null;
  const latestOutreachEdit =
    action.actionType === "outreach_approve"
      ? ([...reactions]
          .reverse()
          .filter((reaction) => reaction.reactedByCurrentUser)
          .map((reaction) => decodeCrmOutreachEdit(reaction.emoji))
          .find((body): body is string => body !== null) ?? null)
      : null;
  const outreachDraft = latestOutreachEdit ?? action.outreachDraft ?? "";
  const calendarSlots =
    action.actionType === "calendar_book" ? (action.calendarSlots ?? []) : [];
  const leadControlReactions =
    action.actionType === "lead_control"
      ? (action.leadControlChoices ??
        LEAD_CONTROL_CHOICES.map((choice) => choice.reaction))
      : [];
  const selectedLeadControl =
    action.actionType === "lead_control"
      ? ([...reactions]
          .reverse()
          .find(
            (reaction) =>
              reaction.reactedByCurrentUser &&
              leadControlReactions.includes(reaction.emoji),
          )?.emoji ?? null)
      : null;

  if (action.actionType === "lead_control") {
    const availableLeadControlChoices = LEAD_CONTROL_CHOICES.filter((choice) =>
      leadControlReactions.includes(choice.reaction),
    );
    return (
      <div className="my-2 max-w-md rounded-lg border border-input/50 bg-muted/20 p-3">
        <p className="text-sm font-medium">Lead safeguards</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {availableLeadControlChoices.map((choice) => {
            const Icon = choice.icon;
            const selected = selectedLeadControl === choice.reaction;

            return (
              <Button
                aria-pressed={selected}
                disabled={disabled}
                key={choice.reaction}
                onClick={() => {
                  if (!selected) {
                    void onChooseLeadControl(
                      availableLeadControlChoices.map((item) => item.reaction),
                      choice.reaction,
                    );
                  }
                }}
                size="sm"
                type="button"
                variant={selected ? "default" : "outline"}
              >
                <Icon aria-hidden="true" />
                {choice.label}
              </Button>
            );
          })}
        </div>
        {selectedLeadControl ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={disabled}
              onClick={() => void onSelect(APPROVE_EMOJI)}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Check aria-hidden="true" />
              Apply change
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (action.actionType === "lead_categorize") {
    return (
      <div className="my-2 max-w-md rounded-lg border border-input/50 bg-muted/20 p-3">
        <p className="text-sm font-medium">Categorize lead</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {LEAD_CATEGORY_CHOICES.map((choice) => (
            <Button
              disabled={disabled}
              key={choice.reaction}
              onClick={() => setSelectedReaction(choice.reaction)}
              size="sm"
              type="button"
              variant={
                selectedReaction === choice.reaction ? "default" : "outline"
              }
            >
              {choice.label}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            disabled={disabled || !selectedReaction}
            onClick={() => selectedReaction && void onSelect(selectedReaction)}
            size="sm"
            type="button"
          >
            <Check aria-hidden="true" />
            Record category
          </Button>
          <Button
            disabled={disabled}
            onClick={() => void onSelect(CANCEL_EMOJI)}
            size="sm"
            type="button"
            variant="outline"
          >
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (action.actionType === "calendar_book") {
    return (
      <div className="my-2 max-w-md rounded-lg border border-input/50 bg-muted/20 p-3">
        <p className="text-sm font-medium">Book meeting</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {calendarSlots.map((choice) => (
            <Button
              disabled={disabled}
              key={choice.reaction}
              onClick={() => setSelectedReaction(choice.reaction)}
              size="sm"
              type="button"
              variant={
                selectedReaction === choice.reaction ? "default" : "outline"
              }
            >
              {choice.label}
            </Button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <Button
            disabled={disabled || !selectedReaction}
            onClick={() => selectedReaction && void onSelect(selectedReaction)}
            size="sm"
            type="button"
          >
            <Check aria-hidden="true" />
            Confirm booking
          </Button>
          <Button
            disabled={disabled}
            onClick={() => void onSelect(CANCEL_EMOJI)}
            size="sm"
            type="button"
            variant="outline"
          >
            <X aria-hidden="true" />
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (action.actionType === "outreach_approve") {
    const unchanged = editBody.trim() === outreachDraft.trim();
    const invalidEdit = editBody.trim().length < 5 || editBody.length > 12_000;

    const openEditor = () => {
      setEditBody(outreachDraft);
      setEditError(null);
      setEditOpen(true);
    };

    const saveEdit = async () => {
      if (invalidEdit || unchanged || pending) return;
      setEditError(null);
      try {
        await onSelect(encodeCrmOutreachEdit(editBody));
        setEditOpen(false);
      } catch (error) {
        setEditError(
          error instanceof Error
            ? error.message
            : "Buzz could not save this revision.",
        );
      }
    };

    return (
      <div
        className="my-2 max-w-xl rounded-lg border border-input/50 bg-muted/20 p-3"
        data-testid="crm-outreach-action"
      >
        <p className="text-sm font-medium">Review outreach draft</p>
        <div className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-background px-3 py-2 text-sm leading-6">
          {outreachDraft || "The draft body is unavailable."}
        </div>
        {latestOutreachEdit ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Revision submitted in Buzz. The CRM will confirm it before approval.
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            disabled={disabled}
            onClick={() => void onSelect(APPROVE_EMOJI)}
            size="sm"
            type="button"
          >
            <Check aria-hidden="true" />
            Approve and send
          </Button>
          <Button
            data-testid="crm-edit-draft"
            disabled={disabled}
            onClick={openEditor}
            size="sm"
            type="button"
            variant="outline"
          >
            <Pencil aria-hidden="true" />
            Edit draft
          </Button>
          <Button
            disabled={disabled}
            onClick={() => void onSelect(CANCEL_EMOJI)}
            size="sm"
            type="button"
            variant="outline"
          >
            <X aria-hidden="true" />
            Reject draft
          </Button>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit outreach draft</DialogTitle>
              <DialogDescription>
                Review the complete message here. Saving creates a new audited
                CRM revision; it does not send the message.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <label className="text-sm font-medium" htmlFor="crm-draft-body">
                Message
              </label>
              <Textarea
                autoFocus
                className="min-h-64 resize-y leading-6"
                id="crm-draft-body"
                maxLength={12_000}
                onChange={(event) => setEditBody(event.target.value)}
                value={editBody}
              />
              <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
                <span>
                  {editError ??
                    "The revised text remains pending until you approve it."}
                </span>
                <span>{editBody.length.toLocaleString()} / 12,000</span>
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => setEditOpen(false)}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                disabled={invalidEdit || unchanged || pending}
                onClick={() => void saveEdit()}
                type="button"
              >
                {pending ? "Saving…" : "Save revision"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="my-2 max-w-md rounded-lg border border-input/50 bg-muted/20 p-3">
      <p className="text-sm font-medium">Mark Reddit draft as posted</p>
      <div className="mt-3 flex gap-2">
        {redditDraft ? (
          <Button
            disabled={pending}
            onClick={() => copyTextToClipboard(redditDraft, "Draft copied")}
            size="sm"
            type="button"
            variant="outline"
          >
            <Copy aria-hidden="true" />
            Copy draft
          </Button>
        ) : null}
        <Button
          disabled={disabled}
          onClick={() => void onSelect(APPROVE_EMOJI)}
          size="sm"
          type="button"
        >
          <Check aria-hidden="true" />
          Approve
        </Button>
        <Button
          disabled={disabled}
          onClick={() => void onSelect(CANCEL_EMOJI)}
          size="sm"
          type="button"
          variant="outline"
        >
          <X aria-hidden="true" />
          Cancel
        </Button>
      </div>
    </div>
  );
}
