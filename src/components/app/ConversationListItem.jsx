import React from "react";
import { DotsIcon, LockIcon } from "../Icons";
import ConversationActionsMenu from "./ConversationActionsMenu";

const displayName = (value) => {
  const raw =
    typeof value === "string"
      ? value
      : value?.username || value?.name || value?.id || "";
  const clean = String(raw || "").trim();
  return clean || "anonymous";
};

const ConversationListItem = ({
  theme,
  conversation,
  unread,
  lastMessage,
  userId,
  menuOpen,
  onOpenConversation,
  onToggleMenu,
  onDeleteForMe,
  onDeleteForAll,
  onUnfriend,
  onBlock,
}) => {
  const isMine = lastMessage?.sender_id === userId;
  const previewText = lastMessage ? (isMine ? "You: •••" : "•••") : null;

  return (
    <div
      style={{
        position: "relative",
        zIndex: menuOpen ? 80 : 1,
      }}
      className="item-appear"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderRadius: 16,
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = theme.surfaceHover)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <div
          onClick={() =>
            onOpenConversation(conversation.otherUser?.id || conversation.conversation_id)
          }
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "11px 10px 11px 12px",
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: theme.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: theme.primaryFg,
              fontWeight: 800,
              fontSize: 20,
              flexShrink: 0,
              boxShadow: `0 0 10px ${theme.primaryGlow}`,
            }}
          >
            {displayName(conversation.otherUser).charAt(0).toUpperCase()}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                color: theme.text,
                fontSize: 14,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              @{displayName(conversation.otherUser)}
            </div>
            <div
              style={{
                fontSize: 11,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: unread > 0 ? theme.text2 : theme.text3,
                fontWeight: unread > 0 ? 600 : 400,
              }}
            >
              {previewText ||
                new Date(conversation.created_at).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              gap: 3,
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: 10, color: theme.text3 }}>
              {lastMessage
                ? new Date(lastMessage.created_at).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}
            </div>
            {unread === 0 ? (
              <LockIcon
                size={11}
                style={{
                  color: theme.success,
                  filter: `drop-shadow(0 0 3px ${theme.success})`,
                }}
              />
            ) : (
              <span
                className="badge-pop"
                style={{
                  background: theme.badgeBg,
                  color: theme.badgeFg,
                  fontSize: 10,
                  fontWeight: 800,
                  minWidth: 20,
                  height: 20,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 5px",
                  boxShadow: `0 0 8px ${theme.badgeBg}`,
                }}
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </div>
        </div>

        <button
          data-conv-menu-id={conversation.conversation_id}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu(conversation.conversation_id);
          }}
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            flexShrink: 0,
            background: theme.surface2,
            border: `1px solid ${menuOpen ? theme.border : "transparent"}`,
            color: theme.text3,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s, color 0.15s",
            marginRight: 8,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = theme.surface2;
            e.currentTarget.style.color = theme.text;
          }}
          onMouseLeave={(e) => {
            if (!menuOpen) {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = theme.text3;
            }
          }}
        >
          <DotsIcon size={16} style={{ color: theme.primary }} />
        </button>
      </div>

      {menuOpen && (
        <ConversationActionsMenu
          theme={theme}
          conversation={conversation}
          onDeleteForMe={onDeleteForMe}
          onDeleteForAll={onDeleteForAll}
          onUnfriend={onUnfriend}
          onBlock={onBlock}
        />
      )}
    </div>
  );
};

export default ConversationListItem;
