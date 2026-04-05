import React from "react";
import { useTheme } from "../context/ThemeContext";
import { FriendsIcon, SettingsIcon } from "./Icons";

const AppHeader = ({
  onFriendsClick,
  onSettingsClick,
  notifCount,
  connected,
  showActionButtons = true,
}) => {
  const { theme, layoutName } = useTheme();

  const btnStyle = {
    background: theme.headerBtn,
    border: "none",
    color: theme.headerFg,
    width: 40,
    height: 40,
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    transition: "background 0.15s",
  };

  return (
    <div
      style={{
        display: layoutName === "telegram" || layoutName === "sidebar" ? "none" : "block",
        background: theme.headerBg,
        padding: layoutName === "messenger" ? "12px 18px" : "10px 16px",
        flexShrink: 0,
        boxShadow: `0 2px 16px rgba(0,0,0,0.25), 0 1px 0 ${theme.border}`,
        borderBottomLeftRadius: layoutName === "messenger" ? 18 : 0,
        borderBottomRightRadius: layoutName === "messenger" ? 18 : 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        {showActionButtons ? (
          <button
            onClick={onFriendsClick}
            style={{
              ...btnStyle,
              position: "relative",
              boxShadow: notifCount > 0 ? `0 0 12px ${theme.danger}66` : "none",
            }}
            title="Friends"
          >
            <FriendsIcon size={18} />
            {notifCount > 0 && (
              <span
                className="badge-pop"
                style={{
                  position: "absolute",
                  top: -3,
                  right: -3,
                  background: theme.badgeBg,
                  color: theme.badgeFg,
                  fontSize: 9,
                  fontWeight: 800,
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "0 4px",
                  border: `2px solid ${theme.headerBg}`,
                  boxShadow: `0 0 8px ${theme.badgeBg}`,
                  lineHeight: 1,
                }}
              >
                {notifCount > 99 ? "99+" : notifCount}
              </span>
            )}
          </button>
        ) : (
          <span style={{ width: 40, height: 40, flexShrink: 0 }} />
        )}

        {/* Title + connection indicator */}
        <div style={{ textAlign: "center", flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 7,
            }}
          >
            <span
              style={{
                fontWeight: 900,
                fontSize: 17,
                color: theme.headerFg,
                letterSpacing: 0.3,
              }}
            >
              ZChat
            </span>
            {connected ? (
              <span
                className="dot-connected"
                title="Connected"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  display: "inline-block",
                  background: theme.success,
                  boxShadow: `0 0 6px ${theme.success}`,
                }}
              />
            ) : (
              <span
                className="radar-container"
                title="Reconnecting…"
                style={{
                  width: 16,
                  height: 16,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {/* Pulse rings */}
                <span
                  className="radar-pulse"
                  style={{ borderColor: theme.danger }}
                />
                <span
                  className="radar-pulse"
                  style={{ borderColor: theme.danger }}
                />
                <span
                  className="radar-pulse"
                  style={{ borderColor: theme.danger }}
                />
                {/* Core dot */}
                <span
                  className="radar-core"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    display: "inline-block",
                    background: theme.danger,
                    boxShadow: `0 0 6px ${theme.danger}`,
                  }}
                />
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 10,
              marginTop: 1,
              fontWeight: 600,
              letterSpacing: 0.2,
              color: connected ? theme.success : theme.danger,
            }}
          >
            {connected ? "zero-knowledge encrypted" : "reconnecting…"}
          </div>
        </div>

        {showActionButtons ? (
          <button onClick={onSettingsClick} style={btnStyle} title="Settings">
            <SettingsIcon size={18} />
          </button>
        ) : (
          <span style={{ width: 40, height: 40, flexShrink: 0 }} />
        )}
      </div>
    </div>
  );
};

export default AppHeader;
