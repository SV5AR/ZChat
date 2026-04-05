import React from "react";

/**
 * All icons are pure SVG paths — no emoji.
 * They inherit `color` via `currentColor` so they match any theme automatically.
 */

const Icon = ({
  d,
  size = 20,
  style = {},
  strokeWidth = 1.8,
  fill = "none",
  stroke,
  className,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={fill}
    stroke={stroke || "currentColor"}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={{ flexShrink: 0, ...style }}
  >
    {Array.isArray(d) ? (
      d.map((path, i) => <path key={i} d={path} />)
    ) : (
      <path d={d} />
    )}
  </svg>
);

// ── Auth ──────────────────────────────────────────────────────────────────────
export const LockIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6-5V9a6 6 0 0 0-12 0v3H5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1h-1z"
  />
);
export const MailIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 0l8 9 8-9"
  />
);
export const CheckMailIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
      "M9 12l2 2 4-4",
    ]}
  />
);

// ── Navigation ────────────────────────────────────────────────────────────────
export const FriendsIcon = ({ size = 20, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    {/* Main person */}
    <circle cx="9" cy="7" r="4" />
    <path d="M1 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
    {/* Second person (smaller, offset right) */}
    <circle cx="17" cy="7.5" r="3" />
    <path d="M23 21v-1.5a4 4 0 0 0-3-3.86" />
  </svg>
);
export const SettingsIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
      "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
    ]}
  />
);
export const BellIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9",
      "M13.73 21a2 2 0 0 1-3.46 0",
    ]}
  />
);
export const PaletteIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c.55 0 1-.45 1-1 0-.26-.1-.5-.26-.69a.928.928 0 0 1-.23-.65c0-.55.45-1 1-1h1.17c2.88 0 5.32-2.1 5.32-5C21 6.1 17 2 12 2zM6.5 13a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"
    fill="currentColor"
    strokeWidth={0}
  />
);
export const BackIcon = (p) => (
  <Icon size={p.size || 20} style={p.style} d="M19 12H5M12 5l-7 7 7 7" />
);
export const CloseIcon = (p) => (
  <Icon size={p.size || 20} style={p.style} d="M18 6L6 18M6 6l12 12" />
);
export const MenuDotsIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M12 5a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"
    strokeWidth={2.5}
  />
);

// ── Chat ──────────────────────────────────────────────────────────────────────
export const ChatIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
  />
);
export const SendIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
  />
);

// ── Actions ───────────────────────────────────────────────────────────────────
export const TrashIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={["M3 6h18", "M19 6l-1 14H6L5 6", "M8 6V4h8v2", "M10 11v6", "M14 11v6"]}
  />
);
export const UserPlusIcon = (p) => (
  <svg
    width={p.size || 20}
    height={p.size || 20}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...(p.style || {}) }}
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <line x1="19" y1="8" x2="19" y2="14" />
    <line x1="16" y1="11" x2="22" y2="11" />
  </svg>
);
export const UserMinusIcon = ({ size = 20, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    <circle cx="9" cy="7" r="4" />
    <path d="M1 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2" />
    <line x1="16" y1="11" x2="22" y2="11" />
  </svg>
);
export const BlockIcon = ({ size = 20, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
  </svg>
);
export const ReplyArrowIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={["M9 14L4 9l5-5", "M4 9h9a7 7 0 0 1 7 7v2"]}
  />
);
export const CopyIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z",
      "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1",
    ]}
  />
);
export const PasteIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M8 4h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2",
      "M9 2h6v4H9z",
      "M10 13h6",
      "M10 17h4",
    ]}
  />
);
export const EyeIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z",
      "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    ]}
  />
);
export const EyeOffIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94",
      "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19",
      "M1 1l22 22",
      "M14.12 14.12a3 3 0 0 1-4.24-4.24",
    ]}
  />
);
export const KeyIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
    ]}
  />
);
export const ShieldIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
  />
);
export const RotateCCWIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={["M1 4v6h6", "M3.51 15a9 9 0 1 0 2.13-9.36L1 10"]}
  />
);
export const AlertIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
      "M12 9v4",
      "M12 17h.01",
    ]}
  />
);
export const CheckIcon = (p) => (
  <Icon size={p.size || 20} style={p.style} d="M20 6L9 17l-5-5" />
);
export const LogOutIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",
      "M16 17l5-5-5-5",
      "M21 12H9",
    ]}
  />
);
export const UserIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2",
      "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    ]}
  />
);
export const WifiIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M5 12.55a11 11 0 0 1 14.08 0",
      "M1.42 9a16 16 0 0 1 21.16 0",
      "M8.53 16.11a6 6 0 0 1 6.95 0",
      "M12 20h.01",
    ]}
  />
);
export const WifiOffIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M1 1l22 22",
      "M16.72 11.06A10.94 10.94 0 0 1 19 12.55",
      "M5 12.55a11 11 0 0 1 5.17-2.39",
      "M10.71 5.05A16 16 0 0 1 22.56 9",
      "M1.42 9a15.91 15.91 0 0 1 4.7-2.88",
      "M8.53 16.11a6 6 0 0 1 6.95 0",
      "M12 20h.01",
    ]}
  />
);
export const SearchIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.35-4.35"]}
  />
);

export const SearchFriendIcon = ({ size = 20, style = {} }) => {
  const s = size || 20;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      <circle cx="11" cy="10" r="4.5" />
      <path d="M4 21c0-3.87 3.13-7 7-7s7 3.13 7 7" />
      <circle cx="19" cy="3.5" r="3" strokeWidth={1.5} />
      <line x1="21.2" y1="5.8" x2="22.5" y2="7.1" strokeWidth={1.5} />
    </svg>
  );
};

export const UserNotFoundIcon = ({ size = 20, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
    <line x1="8" y1="8" x2="14" y2="14" strokeWidth={2} />
    <line x1="14" y1="8" x2="8" y2="14" strokeWidth={2} />
  </svg>
);

export const DarkIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
  />
);
export const SunIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M12 1v2",
      "M12 21v2",
      "M4.22 4.22l1.42 1.42",
      "M18.36 18.36l1.42 1.42",
      "M1 12h2",
      "M21 12h2",
      "M4.22 19.78l1.42-1.42",
      "M18.36 5.64l1.42-1.42",
      "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z",
    ]}
  />
);

// ── Tick states for messages ──────────────────────────────────────────────────
// Single check: sent (message reached server)
export const TickSentIcon = ({ size = 14, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, display: "inline-block", ...style }}
  >
    <polyline points="2,8 6,12 14,4" />
  </svg>
);

// Double check: delivered (reached friend's device)
export const TickDeliveredIcon = ({ size = 16, style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 20 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, display: "inline-block", ...style }}
  >
    <polyline points="1,8 5,12 13,4" />
    <polyline points="7,8 11,12 19,4" />
  </svg>
);

// Double check coloured: seen (friend opened and read)
export const TickSeenIcon = ({ size = 16, style = {} }) => (
  <TickDeliveredIcon size={size} style={style} />
);

// ── Additional icons ──────────────────────────────────────────────────────────
export const PenIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    strokeWidth={1.8}
    d={[
      "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",
      "M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z",
    ]}
  />
);
export const PlusIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    strokeWidth={2.2}
    d={["M12 5v14", "M5 12h14"]}
  />
);
export const CheckSquareIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    strokeWidth={1.8}
    d={[
      "M9 11l3 3L22 4",
      "M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
    ]}
  />
);
export const DotsIcon = (p) => (
  <svg
    width={p.size || 20}
    height={p.size || 20}
    viewBox="0 0 24 24"
    fill="currentColor"
    style={{ flexShrink: 0, ...(p.style || {}) }}
  >
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);
export const RefreshCwIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d={[
      "M23 4v6h-6",
      "M1 20v-6h6",
      "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
    ]}
  />
);
export const ChevronDownIcon = (p) => (
  <Icon
    size={p.size || 20}
    style={p.style}
    d="M6 9l6 6 6-6"
  />
);
