import React, { useState, useEffect, useRef, useMemo } from "react";

// Module-level cache: survives Friends panel open/close
const _friendsCache = {
  received: null,
  sent: null,
  friends: null,
  blocked: null,
  uid: null,
};
window._friendsCache = _friendsCache;
import { useTheme } from "../context/ThemeContext";
import {
  SearchIcon,
  UserPlusIcon,
  CloseIcon,
  AlertIcon,
  CheckIcon,
  UserMinusIcon,
  ChatIcon,
  UserIcon,
  BlockIcon,
  MenuDotsIcon,
  TrashIcon,
} from "./Icons";
import {
  getProfile,
  getKnownProfiles,
  getFriendships,
  getFriendshipBetween,
  sendFriendRequest,
  respondFriendRequest,
  removeFriendship,
  getBlockedUsers,
  blockUser,
  unblockUser,
} from "../lib/schemaApi";

const TABS = [
  { key: "received", label: "Received" },
  { key: "sent", label: "Sent" },
  { key: "friends", label: "Friends" },
  { key: "blocked", label: "Blocked" },
];

const displayName = (value) => {
  const raw =
    typeof value === "string"
      ? value
      : value?.username || value?.name || value?.id || "";
  const clean = String(raw || "").trim();
  return clean || "anonymous";
};

const isUUID = (str) => {
  if (!str || typeof str !== "string") return false;
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str.trim());
};

const isHexUserId = (str) => /^[0-9a-f]{64}$/i.test(String(str || "").trim());

const Friends = ({
  onClose,
  onStartChat,
  startingChat,
  liveVersion,
  onBadgeChange,
  onlyTabs = null,
  embedded = false,
  hideTitle = false,
  hideSearch = false,
  customTitle = null,
}) => {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = sessionStorage.getItem("friends_tab_default") || "";
      if (saved === "blocked" || saved === "received" || saved === "sent" || saved === "friends") {
        sessionStorage.removeItem("friends_tab_default");
        return saved;
      }
    } catch {
      // ignore
    }
    return "received";
  });
  const prevTabRef = useRef("received");
  const [user, setUser] = useState(null);
  const [searchInput, setSearchInput] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchStatus, setSearchStatus] = useState({ text: "", ok: false });
  const [received, setReceived] = useState([]);
  const [sent, setSent] = useState([]);
  const [friends, setFriends] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [confirmUnfriend, setConfirmUnfriend] = useState({
    show: false,
    friendId: null,
    friendUsername: null,
  });
  const [confirmBlock, setConfirmBlock] = useState({
    show: false,
    userId: null,
    userUsername: null,
  });
  const [confirmUnblock, setConfirmUnblock] = useState({
    show: false,
    userId: null,
    userUsername: null,
  });
  const [friendMenuOpen, setFriendMenuOpen] = useState(null);
  const [requestActionId, setRequestActionId] = useState(null);
  const [requestActionKind, setRequestActionKind] = useState("");
  const menuRef = useRef(null);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setFriendMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [lastSeen, setLastSeen] = useState(() => {
    try {
      const saved = localStorage.getItem("friend_tabs_last_seen");
      return saved
        ? JSON.parse(saved)
        : {
            received: "1970-01-01T00:00:00.000Z",
            sent: "1970-01-01T00:00:00.000Z",
            friends: "1970-01-01T00:00:00.000Z",
            blocked: "1970-01-01T00:00:00.000Z",
          };
    } catch {
      return {
        received: "1970-01-01T00:00:00.000Z",
        sent: "1970-01-01T00:00:00.000Z",
        friends: "1970-01-01T00:00:00.000Z",
        blocked: "1970-01-01T00:00:00.000Z",
      };
    }
  });

  const localBadges = useMemo(
    () => ({
      received: received.some(
        (r) => new Date(r.created_at) > new Date(lastSeen.received),
      ),
      sent: sent.some((r) => new Date(r.created_at) > new Date(lastSeen.sent)),
      friends: friends.some(
        (f) => new Date(f.created_at || 0) > new Date(lastSeen.friends),
      ),
      blocked: blocked.some(
        (b) => new Date(b.created_at || 0) > new Date(lastSeen.blocked),
      ),
    }),
    [received, sent, friends, blocked, lastSeen],
  );

  const headerBadge = Object.values(localBadges).filter(Boolean).length;

  const skipBadgeSyncRef = useRef(false);
  const initialSyncDoneRef = useRef(false);
  const markSkipNextSync = () => {
    skipBadgeSyncRef.current = true;
  };

  const handleTabChange = (tab) => {
    if (tab === activeTab) return;
    const now = new Date().toISOString();
    const newLastSeen = { ...lastSeen, [tab]: now };
    const newLocalBadges = { ...localBadges, [tab]: false };
    const newHeaderBadge = Object.values(newLocalBadges).filter(Boolean).length;

    markSkipNextSync();
    setActiveTab(tab);
    setLastSeen(newLastSeen);
    prevTabRef.current = tab;

    try {
      localStorage.setItem(
        "friend_tabs_last_seen",
        JSON.stringify(newLastSeen),
      );
    } catch (e) {
      console.warn("Failed to save last seen:", e);
    }

    onBadgeChange?.(newLocalBadges, newHeaderBadge);
  };

  const handleClose = () => {
    const newLastSeen = { ...lastSeen, [activeTab]: new Date().toISOString() };
    const newLocalBadges = { ...localBadges, [activeTab]: false };
    const newHeaderBadge = Object.values(newLocalBadges).filter(Boolean).length;
    markSkipNextSync();

    try {
      localStorage.setItem(
        "friend_tabs_last_seen",
        JSON.stringify(newLastSeen),
      );
    } catch (e) {
      console.warn("Failed to save last seen:", e);
    }

    onBadgeChange?.(newLocalBadges, newHeaderBadge);
    onClose();
  };

  const fetchAll = async (uid) => {
    try {
      const [allUsers, allRequests, blockedUsers] = await Promise.all([
        getKnownProfiles(uid),
        getFriendships(),
        getBlockedUsers(uid),
      ]);

      const usersMap = {};
      (allUsers || []).forEach((u) => {
        usersMap[u.id] = u;
      });

      const requests = allRequests || [];
      const newReceived = [];
      const newSent = [];
      const nextFriends = [];
      const newBlocked = [];

      // Process blocked users
      (blockedUsers || []).forEach((b) => {
        if (usersMap[b.blocked_id]) {
          newBlocked.push({
            id: b.id,
            userId: b.blocked_id,
            username: usersMap[b.blocked_id]?.username,
            created_at: b.created_at,
          });
        }
      });

      requests.forEach((r) => {
        if (r.status === "pending") {
          if (r.receiver_id === uid && usersMap[r.sender_id]) {
            newReceived.push({
              id: r.id,
              sender_id: r.sender_id,
              created_at: r.created_at,
              sender: {
                id: r.sender_id,
                username: usersMap[r.sender_id]?.username,
              },
            });
          } else if (r.sender_id === uid && usersMap[r.receiver_id]) {
            newSent.push({
              id: r.id,
              receiver_id: r.receiver_id,
              status: r.status,
              created_at: r.created_at,
              receiver: {
                id: r.receiver_id,
                username: usersMap[r.receiver_id]?.username,
              },
            });
          }
        } else if (r.status === "accepted") {
          if (r.sender_id === uid && usersMap[r.receiver_id]) {
            nextFriends.push({
              friendshipId: r.id,
              userId: r.receiver_id,
              username: usersMap[r.receiver_id]?.username,
              created_at: r.updated_at || r.created_at,
            });
          } else if (r.receiver_id === uid && usersMap[r.sender_id]) {
            nextFriends.push({
              friendshipId: r.id,
              userId: r.sender_id,
              username: usersMap[r.sender_id]?.username,
              created_at: r.updated_at || r.created_at,
            });
          }
        }
      });

      setReceived(newReceived);
      setSent(newSent);
      setFriends(nextFriends);
      setBlocked(newBlocked);

      _friendsCache.uid = uid;
      _friendsCache.received = newReceived;
      _friendsCache.sent = newSent;
      _friendsCache.friends = nextFriends;
      _friendsCache.blocked = newBlocked;
    } catch (err) {
      console.error("fetchAll error:", err);
    }
  };

  useEffect(() => {
    const init = async () => {
      const uid = sessionStorage.getItem("userId");
      if (!uid) return;
      setUser({ id: uid });
      if (_friendsCache.uid === uid && _friendsCache.friends !== null) {
        setReceived(_friendsCache.received || []);
        setSent(_friendsCache.sent || []);
        setFriends(_friendsCache.friends || []);
        setBlocked(_friendsCache.blocked || []);
      }
      fetchAll(uid);
    };
    init();
  }, []);

  useEffect(() => {
    if (liveVersion <= 0) return;
    const uid = user?.id || sessionStorage.getItem("userId");
    if (uid) fetchAll(uid);
  }, [liveVersion, user]);

  useEffect(() => {
    if (!initialSyncDoneRef.current) {
      initialSyncDoneRef.current = true;
      skipBadgeSyncRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!Array.isArray(onlyTabs) || !onlyTabs.length) return;
    if (onlyTabs.includes(activeTab)) return;
    setActiveTab(onlyTabs[0]);
  }, [onlyTabs, activeTab]);

  useEffect(() => {
    if (skipBadgeSyncRef.current) {
      skipBadgeSyncRef.current = false;
      return;
    }
    onBadgeChange?.(localBadges, headerBadge);
  }, [localBadges, headerBadge]);

  const handleSendRequest = async () => {
    const key = searchInput.trim();
    const uid = user?.id || sessionStorage.getItem("userId");
    if (!key || !uid) return;
    setSearchLoading(true);
    setSearchStatus({ text: "", ok: false });

    if (!isHexUserId(key) && !isUUID(key)) {
      setSearchStatus({
        text: "Please enter a valid user ID.",
        ok: false,
      });
      setSearchLoading(false);
      return;
    }

    const inputLooksUuid = isUUID(key);
    const found = await getProfile(key.trim().toLowerCase());

    if (!found) {
      setSearchStatus({
        text: "No user found. Check username or user ID.",
        ok: false,
      });
      setSearchLoading(false);
      return;
    }
    if (found.id === uid) {
      setSearchStatus({ text: "You can't add yourself.", ok: false });
      setSearchLoading(false);
      return;
    }

    // Check if user is blocked (check both local state and query DB for cross-check)
    const isBlockedLocally = blocked.some(
      (b) => b.userId === found.id || b.userId === uid,
    );
    if (isBlockedLocally) {
      setSearchStatus({
        text: "Cannot send request. User is blocked.",
        ok: false,
      });
      setActiveTab("blocked");
      setSearchLoading(false);
      return;
    }

    // Check if already friends
    const isAlreadyFriend = friends.some((f) => f.userId === found.id);
    if (isAlreadyFriend) {
      setSearchStatus({
        text: "You are already friends with this user.",
        ok: false,
      });
      setActiveTab("friends");
      setSearchLoading(false);
      return;
    }

    // Check if request already sent by me (pending)
    const existingSent = sent.find((s) => s.receiver_id === found.id);
    if (existingSent) {
      setSearchStatus({
        text: "Request already sent. Waiting for response.",
        ok: false,
      });
      setActiveTab("sent");
      setSearchLoading(false);
      return;
    }

    // Check if request received from this user (pending)
    const existingReceived = received.find((r) => r.sender_id === found.id);
    if (existingReceived) {
      setSearchStatus({
        text: "This user sent you a request. Check the Received tab to accept.",
        ok: false,
      });
      setActiveTab("received");
      setSearchLoading(false);
      return;
    }

    try {
      const existingRequest = await getFriendshipBetween(uid, found.id);
      if (existingRequest?.status === "pending") {
        setSearchStatus({
          text: "A request already exists. Refreshing...",
          ok: false,
        });
        await fetchAll(uid);
        setSearchLoading(false);
        return;
      }

      await sendFriendRequest(found.id);
    } catch (insertError) {
      const message = insertError?.message || "Unknown error";
      setSearchStatus({
        text: "Failed to send request: " + message,
        ok: false,
      });
      setSearchLoading(false);
      return;
    }

    await new Promise((r) => setTimeout(r, 100));

    setSearchInput("");
    const shortId = String(found.id || "").replace(/-/g, "").slice(0, 5);
    setSearchStatus({
      text: inputLooksUuid
        ? `Request sent to @${shortId}! UUID speedrun unlocked.`
        : `Request sent to @${shortId}!`,
      ok: true,
    });
    fetchAll(uid);
    setActiveTab("sent");
    setSearchLoading(false);
  };

  useEffect(() => {
    if (!searchStatus.text) return;
    const t = setTimeout(() => setSearchStatus({ text: "", ok: false }), 2200);
    return () => clearTimeout(t);
  }, [searchStatus.text]);

  const handleAccept = async (id) => {
    const uid = user?.id || sessionStorage.getItem("userId");
    setRequestActionId(id);
    setRequestActionKind("accept");
    try {
      await respondFriendRequest(id, true);
      await fetchAll(uid);
    } finally {
      setRequestActionId(null);
      setRequestActionKind("");
    }
  };

  const handleReject = async (id) => {
    const uid = user?.id || sessionStorage.getItem("userId");
    setRequestActionId(id);
    setRequestActionKind("reject");
    try {
      await removeFriendship(id);
      await fetchAll(uid);
    } finally {
      setRequestActionId(null);
      setRequestActionKind("");
    }
  };

  const handleCancelRequest = async (id) => {
    const uid = user?.id || sessionStorage.getItem("userId");
    await removeFriendship(id);
    fetchAll(uid);
  };
  const handleChat = async (f) => {
    await onStartChat(f);
  };
  const handleUnfriend = async (friendId, friendUsername) => {
    setSearchStatus({ text: "", ok: false });
    setConfirmUnfriend({ show: true, friendId, friendUsername });
  };

  const doUnfriend = async () => {
    const uid = user?.id || sessionStorage.getItem("userId");
    const { friendId } = confirmUnfriend;
    setConfirmUnfriend({ show: false, friendId: null, friendUsername: null });
    setSearchStatus({ text: "Removing…", ok: false });
    try {
      const fr = await getFriendshipBetween(uid, friendId);
      if (fr?.id) {
        await removeFriendship(fr.id);
      }
      await fetchAll(uid);
      setSearchStatus({ text: "Friend removed.", ok: true });
    } catch (err) {
      setSearchStatus({ text: "Failed: " + err.message, ok: false });
    }
  };

  const handleBlock = async (userId, userUsername) => {
    setSearchStatus({ text: "", ok: false });
    setConfirmBlock({ show: true, userId, userUsername });
  };

  const doBlock = async () => {
    const uid = user?.id || sessionStorage.getItem("userId");
    const { userId } = confirmBlock;
    setConfirmBlock({ show: false, userId: null, userUsername: null });
    setSearchStatus({ text: "Blocking…", ok: false });
    try {
      await blockUser(uid, userId);
      await fetchAll(uid);
      setSearchStatus({ text: "User blocked.", ok: true });
    } catch (err) {
      setSearchStatus({ text: "Failed: " + err.message, ok: false });
    }
  };

  const handleUnblock = async (userId, userUsername) => {
    setSearchStatus({ text: "", ok: false });
    setConfirmUnblock({ show: true, userId, userUsername });
  };

  const doUnblock = async () => {
    const uid = user?.id || sessionStorage.getItem("userId");
    const { userId } = confirmUnblock;
    setConfirmUnblock({ show: false, userId: null, userUsername: null });
    setSearchStatus({ text: "Unblocking…", ok: false });
    try {
      await unblockUser(uid, userId);
      await fetchAll(uid);
      setSearchStatus({ text: "User unblocked.", ok: true });
    } catch (err) {
      setSearchStatus({ text: "Failed: " + err.message, ok: false });
    }
  };

  const s = {
    modal: {
      position: "absolute",
      inset: 0,
      background: "rgba(0,0,0,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
    },
    card: {
      background: theme.surface,
      borderRadius: "clamp(16px, 4vw, 28px)",
      width: "85%",
      maxWidth: 440,
      minWidth: 280,
      margin: "0 12px",
      height: "85%",
      maxHeight: 680,
      minHeight: 400,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      position: "relative",
    },
    input: {
      flex: 1,
      padding: "clamp(8px, 2vw, 11px) clamp(10px, 2vw, 14px)",
      borderRadius: "clamp(10px, 2vw, 14px)",
      border: `1.5px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.text,
      fontSize: "clamp(12px, 3vw, 16px)",
      outline: "none",
    },
    avatar: (bg) => ({
      width: "clamp(32px, 8vw, 40px)",
      height: "clamp(32px, 8vw, 40px)",
      borderRadius: "50%",
      background: bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: theme.primaryFg,
      fontWeight: 800,
      fontSize: "clamp(12px, 3vw, 16px)",
      flexShrink: 0,
    }),
    friendCard: {
      background: theme.surface2,
      borderRadius: "clamp(12px, 3vw, 16px)",
      padding: "clamp(8px, 2vw, 10px) clamp(10px, 2vw, 14px)",
      display: "flex",
      alignItems: "center",
      gap: "clamp(8px, 2vw, 12px)",
      marginBottom: 6,
    },
  };

  const statusColor = {
    pending: theme.warning,
    accepted: theme.success,
    rejected: theme.danger,
  };

  const visibleBaseTabs = Array.isArray(onlyTabs)
    ? TABS.filter((t) => onlyTabs.includes(t.key))
    : TABS;

  const tabs = visibleBaseTabs.map((t) => ({
    ...t,
    count:
      t.key === "received"
        ? received.length
        : t.key === "sent"
          ? sent.length
          : t.key === "friends"
            ? friends.length
            : blocked.length,
    badge: localBadges[t.key] ? 1 : 0,
  }));

  return (
    <div
      style={
        embedded
          ? {
              flex: 1,
              minHeight: 0,
              display: "flex",
            }
          : s.modal
      }
      onClick={embedded ? undefined : handleClose}
    >
      <div
        style={
          embedded
            ? {
                ...s.card,
                width: "100%",
                maxWidth: "100%",
                margin: 0,
                maxHeight: "100%",
                borderRadius: 0,
              }
            : s.card
        }
        className="modal-enter"
        onClick={embedded ? undefined : (e) => e.stopPropagation()}
      >
        <div style={{ padding: "16px 18px 14px", flexShrink: 0, position: "sticky", top: 0, zIndex: 2, background: theme.surface }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              {!hideTitle && (
                <h2
                  style={{
                    color: theme.text,
                    fontWeight: 800,
                    fontSize: 18,
                    margin: 0,
                  }}
                >
                  {customTitle || "Friends"}
                </h2>
              )}
              {!hideSearch && (
                <p style={{ color: theme.text3, fontSize: 11, margin: "2px 0 0" }}>
                  Search by user ID to add friends
                </p>
              )}
            </div>
            <button
              onClick={handleClose}
              className="shape-radius-sm"
              style={{
                display: embedded ? "none" : "flex",
                flexShrink: 0,
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: theme.surface2,
                border: "none",
                color: theme.text2,
                cursor: "pointer",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                transition: "box-shadow 0.2s ease",
                outline: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <CloseIcon size={16} />
            </button>
          </div>
          {!hideSearch && (
            <div
              style={{
                position: "relative",
                marginBottom: 4,
              }}
            >
              {searchStatus.text && (
                <div
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    left: 0,
                    background: theme.surface,
                    border: `1px solid ${searchStatus.ok ? theme.success : theme.danger}`,
                    color: searchStatus.ok ? theme.success : theme.danger,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "4px 8px",
                    borderRadius: 8,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                    animation: "fadeInScaleSimple 0.15s ease both",
                    pointerEvents: "none",
                    whiteSpace: "nowrap",
                    zIndex: 3,
                  }}
                >
                  {searchStatus.text}
                </div>
              )}
              <div style={{ position: "relative", width: "100%" }}>
                <input
                  id="friend-search"
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value);
                    setSearchStatus({ text: "", ok: false });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSendRequest()}
                  placeholder="Search by user ID…"
                  style={{
                    ...s.input,
                    width: "100%",
                    boxSizing: "border-box",
                    padding: "10px 46px 10px 12px",
                    borderRadius: "clamp(10px, 2vw, 14px)",
                    border: `1.5px solid ${theme.inputBorder}`,
                    background: theme.inputBg,
                    color: theme.text,
                    fontSize: 13,
                    height: 42,
                  }}
                />
                <button
                  onClick={handleSendRequest}
                  disabled={searchLoading || !searchInput.trim()}
                  style={{
                    position: "absolute",
                    right: 4,
                    top: 4,
                    bottom: 4,
                    width: 34,
                    borderRadius: "clamp(8px, 2vw, 10px)",
                    border: "none",
                    background: searchInput.trim() ? theme.primary : `${theme.primary}22`,
                    color: searchInput.trim() ? theme.primaryFg : `${theme.primary}88`,
                    fontWeight: 900,
                    cursor: searchInput.trim() ? "pointer" : "default",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: searchInput.trim() ? 1 : 0.65,
                    transition: "all 0.15s",
                    boxShadow: searchInput.trim()
                      ? `0 0 12px ${theme.primaryGlow}`
                      : "none",
                  }}
                >
                  {searchLoading ? (
                    <span style={{ fontSize: 14, fontWeight: 700 }}>…</span>
                  ) : (
                    <UserPlusIcon size={16} />
                  )}
                </button>
              </div>
            </div>
          )}

          {(() => {
            const activeIdx = tabs.findIndex((t) => t.key === activeTab);
            const N = tabs.length;
            const tabTrackRef = React.useRef(null);
            const [tabPositions, setTabPositions] = React.useState({});
            const [isCompactMode, setIsCompactMode] = React.useState(false);
            const activeTabPos = tabPositions[activeTab];

            React.useEffect(() => {
              if (tabTrackRef.current) {
                const trackWidth = tabTrackRef.current.clientWidth;
                const buttons = tabTrackRef.current.querySelectorAll("button");
                const positions = {};
                buttons.forEach((btn) => {
                  const key = btn.getAttribute("data-tab-key");
                  if (key) {
                    positions[key] = {
                      offsetLeft: btn.offsetLeft,
                      offsetWidth: btn.offsetWidth,
                    };
                  }
                });
                setTabPositions(positions);
                // Enable compact/scroll mode if track is too narrow
                setIsCompactMode(trackWidth < 360);
              }
            }, [activeTab, tabs.length]);

            // Listen for resize to toggle compact mode
            React.useEffect(() => {
              const handleResize = () => {
                if (tabTrackRef.current) {
                  setIsCompactMode(tabTrackRef.current.clientWidth < 280);
                }
              };
              window.addEventListener("resize", handleResize);
              handleResize(); // Check on mount
              return () => window.removeEventListener("resize", handleResize);
            }, []);

            const handleTabClick = (tabKey, e) => {
              handleTabChange(tabKey);
              // Auto-scroll to tab (only in compact mode)
              if (isCompactMode) {
                const btn = e.currentTarget;
                const track = tabTrackRef.current;
                if (btn && track) {
                  const trackWidth = track.clientWidth;
                  const scrollLeft = track.scrollLeft;
                  const btnLeft = btn.offsetLeft;
                  const btnWidth = btn.offsetWidth;

                  if (btnLeft < scrollLeft) {
                    track.scrollTo({ left: btnLeft, behavior: "smooth" });
                  } else if (btnLeft + btnWidth > scrollLeft + trackWidth) {
                    track.scrollTo({ left: btnLeft + btnWidth - trackWidth, behavior: "smooth" });
                  }
                }
              }
            };

            // Get active tab label color based on material for proper contrast
            const getActiveTabLabelColor = () => {
              const material = theme.material || "solid";

              // Impact-Fill (Solid) & Apple HIG: Primary background → use primaryFg
              if (material === "solid" || material === "apple") {
                return theme.primaryFg || "#ffffff";
              }

              // Other materials: primary color works fine
              return theme.primary;
            };

            // Material-specific active tab indicator styles
            const getActiveTabStyle = () => {
              const base = {
                position: "absolute",
                top: activeTabPos ? `${activeTabPos.offsetTop}px` : "4px",
                left: activeTabPos ? `${activeTabPos.offsetLeft}px` : `calc(${activeIdx} * (100% / ${N}))`,
                width: activeTabPos ? `${activeTabPos.offsetWidth}px` : `calc(100% / ${N})`,
                height: activeTabPos ? `${activeTabPos.offsetHeight}px` : "calc(100% - 8px)",
                minWidth: isCompactMode ? 60 : "unset",
                borderRadius: "var(--app-radius-sm)",
                pointerEvents: "none",
                transition: "left 0.2s cubic-bezier(0.22, 1, 0.36, 1), top 0.2s cubic-bezier(0.22, 1, 0.36, 1), width 0.2s cubic-bezier(0.22, 1, 0.36, 1), height 0.2s cubic-bezier(0.22, 1, 0.36, 1), all 0.2s cubic-bezier(0.22, 1, 0.36, 1)",
              };

              const material = theme.material || "solid";

              // Apple HIG: Fluid-Press (filled primary, subtle shadow)
              if (material === "apple") {
                return {
                  ...base,
                  background: `linear-gradient(180deg, ${theme.primary}, ${theme.primaryHover || theme.primary})`,
                  border: "none",
                  borderRadius: "calc(var(--app-radius-sm) + 1px)",
                  boxShadow: `
                    0 4px 12px ${theme.primaryGlow},
                    0 2px 4px rgba(0,0,0,0.12),
                    inset 0 1px 0 rgba(255,255,255,0.25)
                  `,
                  zIndex: 0,
                };
              }

              // Aero-Active: Light & Air
              if (material === "glass") {
                return {
                  ...base,
                  background: `linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)`,
                  backdropFilter: "blur(16px) saturate(160%)",
                  WebkitBackdropFilter: "blur(16px) saturate(160%)",
                  border: `1px solid rgba(255,255,255,0.35)`,
                  boxShadow: `
                    0 8px 32px rgba(0,0,0,0.12),
                    0 2px 8px ${theme.primary}33,
                    inset 0 1px 0 rgba(255,255,255,0.25),
                    inset 0 -1px 0 rgba(255,255,255,0.1)
                  `,
                  zIndex: 0,
                };
              }

              // Tertiary-Container: Systematic (M3)
              if (material === "m3") {
                return {
                  ...base,
                  background: `${theme.primary}18`,
                  border: `1px solid ${theme.primary}44`,
                  borderRadius: "calc(var(--app-radius-sm) + 2px)",
                  boxShadow: `
                    0 1px 3px rgba(0,0,0,0.12),
                    0 1px 2px rgba(0,0,0,0.08),
                    inset 0 0 0 1px ${theme.primary}22
                  `,
                  zIndex: 0,
                };
              }

              // Soft-Inset: Tactile (Neumorphism)
              if (material === "neumorphism") {
                return {
                  ...base,
                  background: `linear-gradient(145deg, ${theme.surface}, ${theme.surface2})`,
                  border: "none",
                  boxShadow: `
                    inset 3px 3px 6px rgba(0,0,0,0.25),
                    inset -3px -3px 6px rgba(255,255,255,0.08),
                    0 0 0 1px rgba(255,255,255,0.05)
                  `,
                  zIndex: 0,
                };
              }

              // Impact-Fill: Functional (Solid)
              return {
                ...base,
                background: `linear-gradient(135deg, ${theme.primary}, ${theme.primaryHover || theme.primary})`,
                border: "none",
                boxShadow: `
                  0 4px 12px ${theme.primaryGlow},
                  0 2px 4px rgba(0,0,0,0.15),
                  inset 0 1px 0 rgba(255,255,255,0.2)
                `,
                zIndex: 0,
              };
            };

            return (
              <div
                ref={tabTrackRef}
                className="shape-radius-lg"
                style={{
                  position: "relative",
                  background: theme.surface2,
                  borderRadius: "var(--app-radius-md)",
                  padding: "4px",
                  gap: "4px",
                  marginBottom: 4,
                  overflow: isCompactMode ? "auto" : "hidden",
                  scrollbarWidth: isCompactMode ? "thin" : "none",
                  scrollbarColor: `${theme.primary}44 transparent`,
                  border: `1px solid ${theme.border}`,
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                }}
              >
                <div
                  className="shape-radius-sm"
                  style={getActiveTabStyle()}
                />
                {tabs.map((t) => (
                  <button
                    key={t.key}
                    data-tab-key={t.key}
                    onClick={(e) => handleTabClick(t.key, e)}
                    className="shape-radius-sm"
                    style={{
                      flex: isCompactMode ? "0 0 auto" : 1,
                      minWidth: isCompactMode ? 70 : "unset",
                      padding: "8px 10px",
                      borderRadius: "var(--app-radius-sm)",
                      position: "relative",
                      zIndex: 1,
                      background: "transparent",
                      color:
                        activeTab === t.key ? getActiveTabLabelColor() : theme.text2,
                      fontWeight: activeTab === t.key ? 700 : 500,
                      fontSize: 12,
                      border: "none",
                      cursor: "pointer",
                      transition: "color 0.18s",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.label}
                    {t.count > 0 && (
                      <span style={{ opacity: 0.7 }}> ({t.count})</span>
                    )}
                    {t.badge > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          top: 0,
                          right: 2,
                          background: theme.badgeBg,
                          color: theme.badgeFg,
                          fontSize: "clamp(7px, 1.8vw, 8px)",
                          fontWeight: 800,
                          minWidth: 14,
                          height: 14,
                          borderRadius: 7,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "0 3px",
                          boxShadow: `0 0 6px ${theme.badgeBg}`,
                        }}
                      >
                        {t.badge > 99 ? "99+" : t.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>

        <div
          key={activeTab}
          style={{ flex: 1, overflowY: "auto", padding: "8px 20px 20px" }}
          className="tab-content"
        >
          {activeTab === "received" &&
            (received.length === 0 ? (
              <Empty
                Icon={UserPlusIcon}
                text="No pending requests"
                sub="Ask a friend to share their ID so you can add them"
              />
            ) : (
              received.map((req, i) => (
                <div
                  key={req.id}
                  style={{
                    ...s.friendCard,
                    flexDirection: "column",
                    alignItems: "stretch",
                    animation: `msgAppear 0.2s cubic-bezier(0.22,1,0.36,1) ${i * 40}ms both`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 10,
                    }}
                  >
                    <div style={s.avatar(theme.primary)}>
                      {displayName(req.sender).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: theme.text,
                          fontSize: "clamp(12px, 3vw, 14px)",
                        }}
                      >
                        @{displayName(req.sender)}
                      </div>
                      <div style={{ fontSize: "clamp(10px, 2.5vw, 11px)", color: theme.text3 }}>
                        {req.created_at
                          ? new Date(req.created_at).toLocaleDateString()
                          : ""}
                      </div>
                    </div>
                    <button
                      onClick={() =>
                        handleBlock(req.sender_id, displayName(req.sender))
                      }
                      title="Block user"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 10,
                        background: theme.surface,
                        border: "none",
                        color: theme.danger,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <BlockIcon size={14} />
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleAccept(req.id, req.sender_id)}
                      disabled={requestActionId === req.id}
                      style={{
                        flex: 1,
                        padding: "9px",
                        borderRadius: 10,
                        background: theme.success,
                        color: theme.successFg,
                        fontWeight: 700,
                        fontSize: 12,
                        border: "none",
                        cursor: requestActionId === req.id ? "default" : "pointer",
                        opacity: requestActionId === req.id ? 0.75 : 1,
                      }}
                    >
                      {requestActionId === req.id && requestActionKind === "accept"
                        ? "Accepting..."
                        : "Accept"}
                    </button>
                    <button
                      onClick={() => handleReject(req.id)}
                      disabled={requestActionId === req.id}
                      style={{
                        flex: 1,
                        padding: "9px",
                        borderRadius: 10,
                        background: theme.danger,
                        color: theme.dangerFg,
                        fontWeight: 700,
                        fontSize: 12,
                        border: "none",
                        cursor: requestActionId === req.id ? "default" : "pointer",
                        opacity: requestActionId === req.id ? 0.75 : 1,
                      }}
                    >
                      {requestActionId === req.id && requestActionKind === "reject"
                        ? "Rejecting..."
                        : "Reject"}
                    </button>
                  </div>
                </div>
              ))
            ))}

          {activeTab === "sent" &&
            (sent.length === 0 ? (
              <Empty
                Icon={SearchIcon}
                text="No sent requests"
                sub="Search by user ID to add friends"
              />
            ) : (
              sent.map((req) => (
                <div
                  key={req.id}
                  style={{
                    ...s.friendCard,
                    flexDirection: "column",
                    alignItems: "stretch",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={s.avatar(theme.surface)}>
                      {displayName(req.receiver).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: theme.text,
                          fontSize: 14,
                        }}
                      >
                        @{displayName(req.receiver)}
                      </div>
                      <div style={{ fontSize: 11, color: theme.text3 }}>
                        {req.created_at
                          ? new Date(req.created_at).toLocaleDateString()
                          : ""}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "3px 10px",
                        borderRadius: 20,
                        background: `${statusColor[req.status]}22`,
                        color: statusColor[req.status],
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {req.status}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      onClick={() => handleCancelRequest(req.id)}
                      style={{
                        flex: 1,
                        padding: "8px",
                        borderRadius: 10,
                        background: theme.danger,
                        color: theme.dangerFg,
                        fontWeight: 700,
                        fontSize: 12,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Cancel Request
                    </button>
                  </div>
                </div>
              ))
            ))}

          {activeTab === "friends" &&
            (friends.length === 0 ? (
              <Empty
                Icon={UserIcon}
                text="No friends yet"
                sub="Accept a request or search by username/ID"
              />
            ) : (
              <div ref={menuRef}>
                {friends.map((f, i) => (
                  <div
                    key={f.userId}
                    style={{
                      ...s.friendCard,
                      flexDirection: "column",
                      alignItems: "stretch",
                      position: "relative",
                      zIndex: friendMenuOpen === f.userId ? 60 : 1,
                      animation: `msgAppear 0.2s cubic-bezier(0.22,1,0.36,1) ${i * 40}ms both`,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div style={s.avatar(theme.success)}>
                        {displayName(f).charAt(0).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 700,
                            color: theme.text,
                            fontSize: 14,
                          }}
                        >
                          @{displayName(f)}
                        </div>
                      </div>
                      <div style={{ position: "relative" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setFriendMenuOpen(
                              friendMenuOpen === f.userId ? null : f.userId,
                            );
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: 10,
                            background: theme.surface,
                            border: "none",
                            color: theme.text2,
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <MenuDotsIcon size={16} />
                        </button>
                        {friendMenuOpen === f.userId && (
                          <div
                            className="dropdown-enter app-menu"
                            style={{
                              position: "absolute",
                              top: "100%",
                              right: 0,
                              marginTop: 6,
                              background: theme.surface,
                              borderRadius: 14,
                              boxShadow: "0 10px 28px rgba(0,0,0,0.26)",
                              overflow: "hidden",
                              zIndex: 50,
                              minWidth: 150,
                              padding: 6,
                            }}
                          >
                            <button
                              className="app-menu-item"
                              onClick={() => {
                                setFriendMenuOpen(null);
                                handleChat(f);
                              }}
                              disabled={startingChat}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                width: "100%",
                                padding: "10px 12px",
                                background: "transparent",
                                border: "none",
                                cursor: startingChat ? "default" : "pointer",
                                textAlign: "left",
                                borderRadius: 10,
                              }}
                            >
                              <ChatIcon
                                size={15}
                                style={{ color: theme.primary }}
                              />
                              <span
                                style={{
                                  color: theme.text,
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                {startingChat ? "Opening..." : "Chat"}
                              </span>
                            </button>
                            <button
                              className="app-menu-item"
                              onClick={() => {
                                setFriendMenuOpen(null);
                                handleUnfriend(f.userId, displayName(f));
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                width: "100%",
                                padding: "10px 12px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                                borderRadius: 10,
                              }}
                            >
                              <UserMinusIcon
                                size={15}
                                style={{ color: theme.text2 }}
                              />
                              <span
                                style={{
                                  color: theme.text,
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                Remove
                              </span>
                            </button>
                            <button
                              className="app-menu-item"
                              onClick={() => {
                                setFriendMenuOpen(null);
                                handleBlock(f.userId, displayName(f));
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                width: "100%",
                                padding: "10px 12px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                textAlign: "left",
                                borderRadius: 10,
                              }}
                            >
                              <BlockIcon
                                size={15}
                                style={{ color: theme.danger }}
                              />
                              <span
                                style={{
                                  color: theme.danger,
                                  fontSize: 13,
                                  fontWeight: 600,
                                }}
                              >
                                Block
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ))}

          {activeTab === "blocked" &&
            (blocked.length === 0 ? (
              <Empty
                Icon={BlockIcon}
                text="No blocked users"
                sub="Blocked users cannot send you friend requests"
              />
            ) : (
              blocked.map((b, i) => (
                <div
                  key={b.id}
                  style={{
                    ...s.friendCard,
                    flexDirection: "column",
                    alignItems: "stretch",
                    animation: `msgAppear 0.2s cubic-bezier(0.22,1,0.36,1) ${i * 40}ms both`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div style={s.avatar(theme.danger)}>
                      {displayName(b).charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          color: theme.text,
                          fontSize: 14,
                        }}
                      >
                        @{displayName(b)}
                      </div>
                      <div style={{ fontSize: 11, color: theme.text3 }}>
                        Blocked{" "}
                        {b.created_at
                          ? new Date(b.created_at).toLocaleDateString()
                          : ""}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <button
                      onClick={() => handleUnblock(b.userId, displayName(b))}
                      style={{
                        flex: 1,
                        padding: "9px",
                        borderRadius: 10,
                        background: theme.success,
                        color: theme.successFg,
                        fontWeight: 700,
                        fontSize: 12,
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Unblock
                    </button>
                  </div>
                </div>
              ))
            ))}
        </div>
      </div>

      {/* Unfriend confirmation */}
      {confirmUnfriend.show && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: 24,
              padding: 24,
              width: "100%",
              maxWidth: 320,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <AlertIcon size={40} style={{ color: theme.warning }} />
            </div>
            <h3
              style={{
                color: theme.text,
                fontWeight: 800,
                fontSize: 18,
                margin: "0 0 10px",
                textAlign: "center",
              }}
            >
              Remove friend?
            </h3>
            <p
              style={{
                color: theme.text2,
                fontSize: 13,
                lineHeight: 1.5,
                textAlign: "center",
                margin: "0 0 20px",
              }}
            >
              This will also permanently delete your conversation and all
              messages with this person. This cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() =>
                  setConfirmUnfriend({
                    show: false,
                    friendId: null,
                    friendUsername: null,
                  })
                }
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: theme.surface2,
                  color: theme.text,
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={doUnfriend}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: theme.danger,
                  color: theme.dangerFg,
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Remove & Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block confirmation */}
      {confirmBlock.show && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: 24,
              padding: 24,
              width: "100%",
              maxWidth: 320,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <BlockIcon size={40} style={{ color: theme.danger }} />
            </div>
            <h3
              style={{
                color: theme.text,
                fontWeight: 800,
                fontSize: 18,
                margin: "0 0 10px",
                textAlign: "center",
              }}
            >
              Block user?
            </h3>
            <p
              style={{
                color: theme.text2,
                fontSize: 13,
                lineHeight: 1.5,
                textAlign: "center",
                margin: "0 0 20px",
              }}
            >
              This will permanently delete your conversation and block this
              user. They will not be able to send you friend requests.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() =>
                  setConfirmBlock({
                    show: false,
                    userId: null,
                    userUsername: null,
                  })
                }
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: theme.surface2,
                  color: theme.text,
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={doBlock}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: theme.danger,
                  color: theme.dangerFg,
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Block
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unblock confirmation */}
      {confirmUnblock.show && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 60,
            padding: 16,
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: 24,
              padding: 24,
              width: "100%",
              maxWidth: 320,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <CheckIcon size={40} style={{ color: theme.success }} />
            </div>
            <h3
              style={{
                color: theme.text,
                fontWeight: 800,
                fontSize: 18,
                margin: "0 0 10px",
                textAlign: "center",
              }}
            >
              Unblock user?
            </h3>
            <p
              style={{
                color: theme.text2,
                fontSize: 13,
                lineHeight: 1.5,
                textAlign: "center",
                margin: "0 0 20px",
              }}
            >
              This user will be able to send you friend requests again.
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() =>
                  setConfirmUnblock({
                    show: false,
                    userId: null,
                    userUsername: null,
                  })
                }
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: theme.surface2,
                  color: theme.text,
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={doUnblock}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 12,
                  background: theme.success,
                  color: theme.successFg,
                  fontWeight: 700,
                  fontSize: 13,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Unblock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Empty = ({ Icon, text, sub }) => {
  const { theme } = useTheme();
  return (
    <div style={{ textAlign: "center", padding: "40px 0" }}>
      {Icon && (
        <div
          style={{
            color: theme.text3,
            marginBottom: 10,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <Icon size={36} />
        </div>
      )}
      <div style={{ color: theme.text2, fontSize: 14, fontWeight: 600 }}>
        {text}
      </div>
      {sub && (
        <div style={{ color: theme.text3, fontSize: 12, marginTop: 4 }}>
          {sub}
        </div>
      )}
    </div>
  );
};

export default Friends;
