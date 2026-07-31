import type { ChannelSuggestion } from "@/features/messages/lib/useChannelLinks";
import type { EmojiSuggestion } from "@/features/messages/lib/useEmojiAutocomplete";
import type { MentionSuggestion } from "./MentionAutocomplete";
import { ChannelAutocomplete } from "./ChannelAutocomplete";
import { EmojiAutocomplete } from "./EmojiAutocomplete";
import { MentionAutocomplete } from "./MentionAutocomplete";

type ComposerAutocompleteMenusProps = {
  channelLinks: {
    isChannelOpen: boolean;
    channelSelectedIndex: number;
    channelSuggestions: ChannelSuggestion[];
  };
  emojiAutocomplete: {
    isEmojiAutocompleteOpen: boolean;
    emojiSelectedIndex: number;
    emojiSuggestions: EmojiSuggestion[];
  };
  mentions: {
    fetchMoreSuggestions: () => void;
    isMentionOpen: boolean;
    mentionSelectedIndex: number;
    suggestions: MentionSuggestion[];
  };
  onChannelSelect: (suggestion: ChannelSuggestion) => void;
  onEmojiSelect: (suggestion: EmojiSuggestion) => void;
  onMentionSelect: (suggestion: MentionSuggestion) => void;
};

export function ComposerAutocompleteMenus({
  channelLinks,
  emojiAutocomplete,
  mentions,
  onChannelSelect,
  onEmojiSelect,
  onMentionSelect,
}: ComposerAutocompleteMenusProps) {
  return (
    <>
      <EmojiAutocomplete
        onSelect={onEmojiSelect}
        selectedIndex={emojiAutocomplete.emojiSelectedIndex}
        suggestions={
          emojiAutocomplete.isEmojiAutocompleteOpen
            ? emojiAutocomplete.emojiSuggestions
            : []
        }
      />
      <ChannelAutocomplete
        onSelect={onChannelSelect}
        selectedIndex={channelLinks.channelSelectedIndex}
        suggestions={
          channelLinks.isChannelOpen ? channelLinks.channelSuggestions : []
        }
      />
      <MentionAutocomplete
        onFetchMore={mentions.fetchMoreSuggestions}
        onSelect={onMentionSelect}
        selectedIndex={mentions.mentionSelectedIndex}
        suggestions={mentions.isMentionOpen ? mentions.suggestions : []}
      />
    </>
  );
}
