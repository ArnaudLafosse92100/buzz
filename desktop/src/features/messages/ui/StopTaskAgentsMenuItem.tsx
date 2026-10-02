import { OctagonX } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useActiveAgentPubkeysForTask } from "@/features/agents/activeAgentTurnsStore";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import { getThreadReference } from "@/features/messages/lib/threading";
import type { TimelineMessage } from "@/features/messages/types";
import { cancelManagedAgentTask } from "@/shared/api/agentControl";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { DropdownMenuItem } from "@/shared/ui/dropdown-menu";

export function taskRootEventId(message: TimelineMessage): string {
  return (
    message.rootId ??
    getThreadReference(message.tags ?? []).rootId ??
    message.id
  ).toLowerCase();
}

export function StopTaskAgentsMenuItem({
  channelId,
  message,
}: {
  channelId: string;
  message: TimelineMessage;
}) {
  const [isSending, setIsSending] = React.useState(false);
  const identityQuery = useIdentityQuery();
  const membersQuery = useChannelMembersQuery(channelId);
  const managedAgentsQuery = useManagedAgentsQuery();
  const rootEventId = taskRootEventId(message);
  const activeAgentPubkeys = useActiveAgentPubkeysForTask(
    channelId,
    rootEventId,
  );

  const currentPubkey = identityQuery.data?.pubkey
    ? normalizePubkey(identityQuery.data.pubkey)
    : null;
  const members = membersQuery.data ?? [];
  const selfMember = currentPubkey
    ? members.find((member) => normalizePubkey(member.pubkey) === currentPubkey)
    : null;
  const canManageChannel =
    selfMember?.role === "owner" || selfMember?.role === "admin";
  const memberPubkeys = new Set(
    members.map((member) => normalizePubkey(member.pubkey)),
  );
  const activeTaskPubkeys = new Set(activeAgentPubkeys.map(normalizePubkey));
  const ownedRunningMembers = (managedAgentsQuery.data ?? []).filter(
    (agent) =>
      isManagedAgentActive(agent) &&
      memberPubkeys.has(normalizePubkey(agent.pubkey)),
  );
  const activeOwnedCount = ownedRunningMembers.filter((agent) =>
    activeTaskPubkeys.has(normalizePubkey(agent.pubkey)),
  ).length;

  if (!canManageChannel || activeOwnedCount === 0) {
    return null;
  }

  async function stopTaskAgents() {
    const confirmed = window.confirm(
      `Stop ${activeOwnedCount} agent${activeOwnedCount === 1 ? "" : "s"} working on this conversation? Other conversations will continue.`,
    );
    if (!confirmed) return;

    setIsSending(true);
    const results = await Promise.allSettled(
      ownedRunningMembers.map((agent) =>
        cancelManagedAgentTask(agent.pubkey, channelId, rootEventId),
      ),
    );
    setIsSending(false);

    const failureCount = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (failureCount > 0) {
      toast.error(
        `Failed to reach ${failureCount} agent${failureCount === 1 ? "" : "s"}.`,
      );
      return;
    }
    toast.success(
      `Stop signal sent for this conversation. ${activeOwnedCount} active agent${activeOwnedCount === 1 ? "" : "s"} targeted.`,
    );
  }

  return (
    <DropdownMenuItem
      className="text-destructive focus:text-destructive"
      data-testid={`stop-task-agents-${message.id}`}
      disabled={isSending}
      onClick={() => {
        void stopTaskAgents();
      }}
    >
      <OctagonX className="h-4 w-4" />
      Stop running agents
    </DropdownMenuItem>
  );
}
