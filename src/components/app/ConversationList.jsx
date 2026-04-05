import React from "react";
import ConversationEmptyState from "./ConversationEmptyState";
import ConversationListItem from "./ConversationListItem";
import { useTheme } from "../../context/ThemeContext";

const ConversationList = ({
  theme,
  conversations,
  convLoading,
  unreadCounts,
  lastMessages,
  userId,
  menuOpenFor,
  onMenuOpenChange,
  onOpenConversation,
  onOpenFriends,
  onDeleteForMe,
  onDeleteForAll,
  onUnfriend,
  onBlock,
}) => {
  const { layoutName } = useTheme();
  return (
    <div
      style={{
        flex: 1,
        overflowY: "auto",
        minHeight: 0,
        paddingLeft: layoutName === "sidebar" ? 6 : 0,
        paddingRight: layoutName === "sidebar" ? 6 : 0,
      }}
      onClick={() => onMenuOpenChange(null)}
    >
      {conversations.length === 0 && !convLoading ? (
        <ConversationEmptyState theme={theme} onOpenFriends={onOpenFriends} />
      ) : (
        <div
          style={{
            padding:
              layoutName === "messenger"
                ? "12px 14px"
                : layoutName === "sidebar"
                  ? "8px 8px"
                  : "8px 12px",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: theme.text3,
              textTransform: "uppercase",
              letterSpacing: 1.2,
              padding: "10px 6px 6px",
            }}
          >
            Messages
          </div>
          {conversations.map((conv) => (
            <ConversationListItem
              key={conv.conversation_id}
              theme={theme}
              conversation={conv}
              unread={unreadCounts[conv.conversation_id] || 0}
              lastMessage={lastMessages[conv.conversation_id]}
              userId={userId}
              menuOpen={menuOpenFor === conv.conversation_id}
              onOpenConversation={onOpenConversation}
              onToggleMenu={(conversationId) =>
                onMenuOpenChange(
                  menuOpenFor === conversationId ? null : conversationId,
                )
              }
              onDeleteForMe={onDeleteForMe}
              onDeleteForAll={onDeleteForAll}
              onUnfriend={onUnfriend}
              onBlock={onBlock}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ConversationList;
