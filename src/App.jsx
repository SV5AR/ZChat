import React, { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import AppHeader from "./components/AppHeader";
import Settings from "./components/Settings";
import Friends from "./components/Friends";
import AuthPhrase from "./components/AuthPhrase";
import Chat from "./components/Chat";
import ThemePicker from "./components/ThemePicker";
import AppLoadingScreen from "./components/app/AppLoadingScreen";
import BackendSetupIssueBanner from "./components/app/BackendSetupIssueBanner";
import ConversationList from "./components/app/ConversationList";
import AppLockOverlay from "./components/AppLockOverlay";
import { FriendsIcon, SettingsIcon, ChatIcon, SearchIcon, SearchFriendIcon, BellIcon, MenuDotsIcon, TrashIcon, UserMinusIcon, BlockIcon, UserNotFoundIcon } from "./components/Icons";
import { supabase } from "./supabaseClient";
import { useTheme } from "./context/ThemeContext";
import { getPlatform } from "./utils/platform";
import {
  loadMasterKeyFromSession,
  clearMasterKeyFromSession,
  encryptWithKey,
  decryptWithKey,
  deriveAESKeyFromMasterKey,
} from "./utils/crypto";
import { clearSecureStorage, clearSessionOnly, clearUserCache } from "./utils/secureStorage";
import { deriveZchatIdentityFromPrivateKey } from "./utils/zchatIdentity";
import { edgePost } from "./lib/edgeApi";
import {
  getProfile,
  getChatsForUser,
  getKnownProfiles,
  getFriendships,
  getUnreadCountsByFriend,
  getMessagesWithFriend,
  updateEncryptedStatus,
  hideChatForMe,
  deleteChatForEveryone,
  getFriendshipBetween,
  sendFriendRequest,
  getBlockedUsers,
  removeFriendship,
  blockUser,
  findChatWithUser,
  ensureChatExists,
  invalidateFriendshipCaches,
  invalidateMessageCache,
  cacheSet,
  cacheGet,
  cacheInvalidate,
  API_CACHE_TTL,
} from "./lib/schemaApi";
import {
  isAppLockEnabled,
  getAppLockTimeoutSec,
  touchAppActivity,
  shouldLockNow,
  setAppLockState,
  isAppLockedState,
  getAppLockedUserId,
} from "./utils/appLock";
import { dropSessionToken } from "./lib/sessionAuth";

const isBackendObjectMissingError = (error) => {
  const code = String(error?.code || "");
  const status = Number(error?.status || 0);
  const text =
    `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();

  return (
    status === 404 ||
    code === "PGRST202" ||
    code === "42P01" ||
    code === "42883" ||
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("could not find")
  );
};

const backendSetupMessage =
  "Backend schema is not fully deployed for this Supabase project (missing users table and/or RPC functions). Run the SQL migrations in Supabase SQL Editor, then retry sign-in.";

const isUUID = (str) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(str || "").trim(),
  );
const isHexUserId = (str) => /^[0-9a-f]{64}$/i.test(String(str || "").trim());

// ── Global App Cache ───────────────────────────────────────────────────────────
const _appCache = {
  conversations: [], // [{conversation_id, other_user_id, other_username, last_read_at, created_at}]
  usersMap: {}, // {userId: {id, username, phrase_hash}}
  friendRequests: [], // [{id, sender_id, receiver_id, status, created_at}]
  convMessages: {}, // {convId: [{id, sender_id, content, ...}]}
  convReactions: {}, // {convId: {msgId: [reactions]}}
  convSharedKeys: {}, // {convId: sharedKey}
  initialized: false,
};

// Load all initial data on cold start
const loadInitialData = async (uid) => {
  if (!uid || _appCache.initialized) return;

  // Try to restore from persistent cache first for instant UI
  try {
    const raw = localStorage.getItem(`zchat_convs_${uid}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.conversations?.length) {
        _appCache.conversations = parsed.conversations;
        _appCache.usersMap = parsed.usersMap || {};
        _appCache.friendRequests = parsed.friendRequests || [];
      }
    }
  } catch {
    // ignore stale cache
  }

  try {
    const [conversations, users, friendships] = await Promise.all([
      getChatsForUser(uid),
      getKnownProfiles(uid),
      getFriendships(),
    ]);

    const usersMap = {};
    (users || []).forEach((u) => {
      usersMap[u.id] = u;
    });

    _appCache.conversations = conversations || [];
    _appCache.usersMap = usersMap;
    _appCache.friendRequests = friendships || [];
    _appCache.initialized = true;

    // Persist to localStorage for instant cold start
    try {
      localStorage.setItem(`zchat_convs_${uid}`, JSON.stringify({
        conversations: _appCache.conversations,
        usersMap: _appCache.usersMap,
        friendRequests: _appCache.friendRequests,
        ts: Date.now(),
      }));
    } catch {
      // ignore storage errors
    }

    return {
      conversations: _appCache.conversations,
      usersMap: _appCache.usersMap,
      friendRequests: _appCache.friendRequests,
    };
  } catch (err) {
    console.error("Failed to load initial data:", err);
    return null;
  }
};

// Add new conversation to cache
const addConversationToCache = (conv) => {
  if (
    !_appCache.conversations.find(
      (c) => c.conversation_id === conv.conversation_id,
    )
  ) {
    _appCache.conversations.unshift(conv);
  }
};

// Remove conversation from cache
const removeConversationFromCache = (convId) => {
  _appCache.conversations = _appCache.conversations.filter(
    (c) => c.conversation_id !== convId,
  );
  delete _appCache.convMessages[convId];
  delete _appCache.convReactions[convId];
  delete _appCache.convSharedKeys[convId];
  // Force clear session cache (Chat.jsx reads from here)
  if (window._sessionCache?.convMessages) {
    delete window._sessionCache.convMessages[convId];
  }
  // Force clear encrypted persistent cache
  try {
    const uid = sessionStorage.getItem("userId");
    if (uid) {
      localStorage.removeItem(`sc_cache_v1_conv_msgs_${uid}_${convId}`);
      localStorage.removeItem(`sc_cache_v1_conv_reactions_${uid}_${convId}`);
    }
  } catch {
    // ignore
  }
};

const _addMessageToCache = (convId, message) => {
  if (!_appCache.convMessages[convId]) {
    _appCache.convMessages[convId] = [];
  }
  if (!_appCache.convMessages[convId].find((m) => m.id === message.id)) {
    _appCache.convMessages[convId].push(message);
  }
};

const _getMessagesFromCache = (convId) => {
  return _appCache.convMessages[convId] || [];
};

const _setMessagesInCache = (convId, messages) => {
  _appCache.convMessages[convId] = messages;
};

const _addFriendRequestToCache = (request) => {
  _appCache.friendRequests.unshift(request);
};

const _updateFriendRequestInCache = (requestId, status) => {
  const req = _appCache.friendRequests.find((r) => r.id === requestId);
  if (req) req.status = status;
};

const _removeFriendRequestFromCache = (requestId) => {
  _appCache.friendRequests = _appCache.friendRequests.filter(
    (r) => r.id !== requestId,
  );
};

const _getUserFromCache = (userId) => {
  return _appCache.usersMap[userId];
};

const _setSharedKeyInCache = (convId, sharedKey) => {
  _appCache.convSharedKeys[convId] = sharedKey;
};

const _getSharedKeyFromCache = (convId) => {
  return _appCache.convSharedKeys[convId];
};

const _resetAppCache = () => {
  _appCache.conversations = [];
  _appCache.usersMap = {};
  _appCache.friendRequests = [];
  _appCache.convMessages = {};
  _appCache.convReactions = {};
  _appCache.convSharedKeys = {};
  _appCache.initialized = false;
};

const trySetAuthUserContext = async (userId) => {
  if (!userId) return;
  // Legacy RPC no longer required with edge session-token auth.
};

const App = () => {
  const { theme, layoutName } = useTheme();
  const [platform, setPlatform] = useState(null);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [privateKey, setPrivateKey] = useState(null);
  const [ecdhPrivateKey, setEcdhPrivateKey] = useState(null);
  const [appLoading, setAppLoading] = useState(true); // true until initial data loaded
  const [appInitProgress, setAppInitProgress] = useState(0);
  const [appInitStatus, setAppInitStatus] = useState("Checking secure session...");
  const [conversations, setConversations] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({}); // { conversation_id: count }
  const [lastMessages, setLastMessages] = useState({}); // { conversation_id: { sender_id, created_at } }
  const [convLoading, setConvLoading] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const startingRef = useRef(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showFriends, setShowFriends] = useState(false);
  const [friendListVersion, setFriendListVersion] = useState(0); // increments to signal Friends to refetch
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [telegramTab, setTelegramTab] = useState("chats");
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [backendSyncIssue, setBackendSyncIssue] = useState("");
  const [sidebarContacts, setSidebarContacts] = useState([]);
  const [contactsList, setContactsList] = useState([]);
  const [sidebarSearchOpen, setSidebarSearchOpen] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [sidebarSearchStatus, setSidebarSearchStatus] = useState({ text: "", ok: false });
  const [sidebarSearchLoading, setSidebarSearchLoading] = useState(false);
  const [sidebarCompact, setSidebarCompact] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarFriendsFocus, setSidebarFriendsFocus] = useState(false);
  const [sidebarFriendsMode, setSidebarFriendsMode] = useState("notifications");
  const [telegramContactMenuOpen, setTelegramContactMenuOpen] = useState(null);
  const sidebarSearchInputRef = useRef(null);
  const sidebarSearchShellRef = useRef(null);
  const sidebarRootRef = useRef(null);
  const [contactPresenceMap, setContactPresenceMap] = useState({});
  const [appLocked, setAppLocked] = useState(false);
  const [appLockPolicyReady, setAppLockPolicyReady] = useState(false);
  const inactivityRef = useRef(null);

  // Detect platform on mount
  useEffect(() => {
    setPlatform(getPlatform());
  }, []);

  const wipeRuntimeSessionForLock = useCallback(() => {
    dropSessionToken();
    clearMasterKeyFromSession();
    try {
      sessionStorage.removeItem("userPrivateKey");
      sessionStorage.removeItem("userPublicKey");
      sessionStorage.removeItem("userProfile");
      sessionStorage.removeItem("userId");
    } catch {
      // ignore
    }
    setPrivateKey(null);
    setEcdhPrivateKey(null);
  }, []);

  // ── Notification badges ──────────────────────────────────────────────────────
  const [notifCount, setNotifCount] = useState(0);

  // Header badge is synced with Friends active tab's badge
  const effectiveNotifCount = notifCount;
  const chatBadgeCount = Object.values(unreadCounts || {}).reduce(
    (sum, v) => sum + (Number(v) || 0),
    0,
  );
  const [contactsBadgeCount, setContactsBadgeCount] = useState(0);
  const [sidebarUnseenMsgs, setSidebarUnseenMsgs] = useState({});
  const [sidebarFriendsBadgeCleared, setSidebarFriendsBadgeCleared] = useState(false);
  const [bellRinging, setBellRinging] = useState(false);
  const [rightPanelReady, setRightPanelReady] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncBadgePhase, setSyncBadgePhase] = useState("hidden");
  const [telegramContactQuery, setTelegramContactQuery] = useState("");
  const [telegramContactStatus, setTelegramContactStatus] = useState({ text: "", ok: false });
  const [telegramContactLoading, setTelegramContactLoading] = useState(false);
  const syncTimerRef = useRef(null);
  const convRefreshTimerRef = useRef(null);
  const friendshipsSignatureRef = useRef("");
  const syncBadgeTimerRef = useRef(null);
  const syncBadgeExitTimerRef = useRef(null);
  const initialSyncBadgeShownRef = useRef(false);

  useEffect(() => {
    if (layoutName !== "telegram") return;
    try {
      window.scrollTo(0, 0);
    } catch {
      // ignore
    }
  }, [layoutName, telegramTab]);
  const [_notifBadges, setNotifBadges] = useState({
    received: 0,
    sent: 0,
    friends: 0,
  });

  // Fetch initial badge state from database
  const fetchInitialBadges = useCallback(async (uid) => {
    if (!uid) return;
    try {
      const lastSeen = JSON.parse(
        localStorage.getItem("friend_tabs_last_seen") ||
          '{"received":"1970-01-01T00:00:00.000Z","sent":"1970-01-01T00:00:00.000Z","friends":"1970-01-01T00:00:00.000Z"}',
      );

      const requests = await getFriendships();
      let receivedCount = 0,
        sentCount = 0;

      requests.forEach((r) => {
        if (r.status === "pending") {
          if (
            r.receiver_id === uid &&
            new Date(r.created_at) > new Date(lastSeen.received)
          ) {
            receivedCount++;
          }
          if (
            r.sender_id === uid &&
            new Date(r.created_at) > new Date(lastSeen.sent)
          ) {
            sentCount++;
          }
        }
      });

      const newBadges = {
        received: receivedCount > 0 ? 1 : 0,
        sent: sentCount > 0 ? 1 : 0,
        friends: 0,
      };
      const headerCount = receivedCount + sentCount;

      setNotifBadges(newBadges);
      setNotifCount(headerCount);
    } catch (err) {
      console.error("fetchInitialBadges error:", err);
    }
  }, []);

  // Fetch badges when user changes (cold start, login, etc.)
  useEffect(() => {
    if (user?.id) {
      fetchInitialBadges(user.id);
    }
  }, [user?.id, fetchInitialBadges]);

  // ── Connection status ────────────────────────────────────────────────────────
  const [connected, setConnected] = useState(false);

  // ── Friend list version for triggering re-fetch ──────────────────────────────
  const [_liveVersion, setLiveVersion] = useState(0);

  const setInitStage = useCallback((progress, label) => {
    const p = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
    setAppInitProgress((prev) => (p > prev ? p : prev));
    if (label) setAppInitStatus(label);
  }, []);

  const markSyncing = useCallback((active = true) => {
    if (syncTimerRef.current) {
      clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
    if (active) {
      setIsSyncing(true);
      syncTimerRef.current = setTimeout(() => setIsSyncing(false), 1200);
    } else {
      setIsSyncing(false);
    }
  }, []);

  const showSyncBadge = useCallback((durationMs = 1200) => {
    if (syncBadgeTimerRef.current) {
      clearTimeout(syncBadgeTimerRef.current);
      syncBadgeTimerRef.current = null;
    }
    if (syncBadgeExitTimerRef.current) {
      clearTimeout(syncBadgeExitTimerRef.current);
      syncBadgeExitTimerRef.current = null;
    }
    setSyncBadgePhase("in");
    syncBadgeTimerRef.current = setTimeout(() => {
      setSyncBadgePhase("out");
      syncBadgeExitTimerRef.current = setTimeout(() => {
        setSyncBadgePhase("hidden");
        syncBadgeExitTimerRef.current = null;
      }, 260);
      syncBadgeTimerRef.current = null;
    }, durationMs);
  }, []);

  // ── Auth ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    setInitStage(0.02, "Checking secure session...");
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const lockActive = isAppLockedState();
      const lockedUserId = getAppLockedUserId();
      if (lockActive && lockedUserId) {
        setUser({ id: lockedUserId });
        setAppLocked(true);
        wipeRuntimeSessionForLock();
        setInitStage(1, "Locked");
        setAppLoading(false);
        return;
      }

      if (session?.user) {
        try {
          await trySetAuthUserContext(session.user.id);
          await initUser(session.user);
        } catch (e) {
          console.error("Auth bootstrap failed:", e);
          if (isBackendObjectMissingError(e)) {
            setBackendSyncIssue(backendSetupMessage);
          }
          setInitStage(1, "Failed to initialize");
          setAppLoading(false);
        }
      } else {
        const localId = sessionStorage.getItem("userId");
        if (localId) {
          try {
            await trySetAuthUserContext(localId);
            await initUser({ id: localId });
          } catch (e) {
            console.error("Session bootstrap failed:", e);
            if (isBackendObjectMissingError(e)) {
              setBackendSyncIssue(backendSetupMessage);
            }
            setInitStage(1, "Failed to initialize");
            setAppLoading(false);
          }
        } else {
          setInitStage(1, "Ready");
          setAppLoading(false);
        }
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      async (_, session) => {
        const lockActive = isAppLockedState();
        const lockedUserId = getAppLockedUserId();
        if (lockActive && lockedUserId) {
          setUser({ id: lockedUserId });
          setAppLocked(true);
          wipeRuntimeSessionForLock();
          setInitStage(1, "Locked");
          setAppLoading(false);
          return;
        }

        if (session?.user) {
          try {
            await trySetAuthUserContext(session.user.id);
            await initUser(session.user);
          } catch (e) {
            console.error("Auth state init failed:", e);
            if (isBackendObjectMissingError(e)) {
              setBackendSyncIssue(backendSetupMessage);
            }
            setInitStage(1, "Failed to initialize");
            setAppLoading(false);
          }
        } else {
          const localId = sessionStorage.getItem("userId");
          if (localId) {
            try {
              await trySetAuthUserContext(localId);
              await initUser({ id: localId });
            } catch (e) {
              console.error("Auth state local init failed:", e);
              if (isBackendObjectMissingError(e)) {
                setBackendSyncIssue(backendSetupMessage);
              }
              setInitStage(1, "Failed to initialize");
              setAppLoading(false);
            }
          } else {
            setUser(null);
            setUserProfile(null);
            setPrivateKey(null);
            setAppLoading(false);
            setEcdhPrivateKey(null);
            setConversations([]);
            setNotifCount(0);
            clearMasterKeyFromSession();
            clearSessionOnly().catch(() => {}); // Logout cleanup
            setAppLockState(false);
            setInitStage(1, "Ready");
          }
        }
      },
    );
    return () => listener.subscription.unsubscribe();
  }, [setInitStage, wipeRuntimeSessionForLock]);

  useEffect(() => {
    if (!user?.id) {
      setAppLocked(false);
      setAppLockPolicyReady(true);
      return;
    }

    setAppLockPolicyReady(false);
    if (isAppLockedState() || (isAppLockEnabled() && shouldLockNow())) {
      setAppLocked(true);
      setAppLockState(true, user.id);
      wipeRuntimeSessionForLock();
    }
    setAppLockPolicyReady(true);

    const arm = () => {
      if (inactivityRef.current) {
        clearTimeout(inactivityRef.current);
      }
      if (!isAppLockEnabled()) return;
      touchAppActivity();
      inactivityRef.current = setTimeout(() => {
        setAppLocked(true);
        setAppLockState(true, user.id);
        wipeRuntimeSessionForLock();
      }, getAppLockTimeoutSec() * 1000);
    };

    const onActivity = () => {
      if (appLocked) return;
      arm();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        touchAppActivity();
      } else if (shouldLockNow()) {
        setAppLocked(true);
        setAppLockState(true, user.id);
        wipeRuntimeSessionForLock();
      } else {
        arm();
      }
    };

    const events = ["mousemove", "keydown", "click", "touchstart"];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));
    document.addEventListener("visibilitychange", onVisibility);
    arm();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
      document.removeEventListener("visibilitychange", onVisibility);
      if (inactivityRef.current) {
        clearTimeout(inactivityRef.current);
      }
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
      }
    };
  }, [user?.id, appLocked, wipeRuntimeSessionForLock]);

  const handleUnlock = ({ userId, publicKey, privateKey }) => {
    const uid = String(userId || user?.id || "").trim().toLowerCase();
    if (!uid) return;
    sessionStorage.setItem("userId", uid);
    if (publicKey) sessionStorage.setItem("userPublicKey", String(publicKey).trim().toLowerCase());
    sessionStorage.setItem("userPrivateKey", privateKey);
    setPrivateKey(privateKey);
    setEcdhPrivateKey(privateKey);
    setUser({ id: uid });
    setAppLocked(false);
    setAppLockState(false);
    touchAppActivity();
    initUser({ id: uid }).catch((err) => {
      console.error("Unlock re-init failed:", err);
      setAppLocked(true);
      setAppLockState(true, uid);
    });
  };

  const handleLockLogout = () => {
    // Only clear session — preserve PIN vault and root keys for easy re-login
    clearSessionOnly().catch(() => {});
    setUser(null);
    setUserProfile(null);
    setPrivateKey(null);
    setEcdhPrivateKey(null);
    setConversations([]);
    setSelectedConversation(null);
    setShowFriends(false);
    setShowSettings(false);
    setAppLocked(false);
    setAppLockState(false);
  };

  const randomUsername = () =>
    `user${Math.floor(100000 + Math.random() * 900000)}`;

  const initUser = async (authUser) => {
    setAppLoading(true);
    setAppInitProgress(0);
    setInitStage(0.08, "Validating profile...");
    setUser(authUser);
    setBackendSyncIssue("");

    // Load masterKey first (needed for username decryption)
    const savedMk = loadMasterKeyFromSession();

    let profile = await getProfile(authUser.id);

    if (!profile && savedMk) {
      const newUsername = randomUsername();
      const aesKey = await deriveAESKeyFromMasterKey(savedMk);
      const encryptedUsername = await encryptWithKey(newUsername, aesKey);
      const fallbackPubFromSession = String(
        sessionStorage.getItem("userPublicKey") || "",
      ).trim();
      const derivedIdentity = /^[0-9a-f]{64}$/i.test(savedMk)
        ? deriveZchatIdentityFromPrivateKey(savedMk)
        : null;
      const publicKey =
        fallbackPubFromSession || derivedIdentity?.publicKeyHex || "";
      if (publicKey) {
        await edgePost("/profile/upsert", {
          id: authUser.id,
          publicKey,
          encryptedUsername,
        });
        profile = await getProfile(authUser.id);
      }
    }

    if (!profile) {
      throw new Error("Unable to load or create user profile via edge API");
    }

    let decryptedUsername = "anonymous";
    if (profile.encrypted_username && savedMk) {
      try {
        const aesKey = await deriveAESKeyFromMasterKey(savedMk);
        const dec = await decryptWithKey(profile.encrypted_username, aesKey);
        if (dec) decryptedUsername = dec;
      } catch (e) {
        console.warn("Failed to decrypt own username:", e);
      }
    }

    const resolvedProfile = {
      ...profile,
      username: decryptedUsername,
    };
    setInitStage(0.2, "Securing account data...");
    setUserProfile(resolvedProfile);
    sessionStorage.setItem("userProfile", JSON.stringify(resolvedProfile));
    // Badge state is managed by Friends component via onBadgeChange

    // Load all initial data into cache on cold start
    const cachedData = await loadInitialData(authUser.id);
    if (cachedData) {
      // Set conversations from cache (include phrase_hash for encryption)
      const convs = cachedData.conversations.map((c) => ({
        conversation_id: c.conversation_id,
        created_at: c.created_at,
        last_read_at: c.last_read_at,
        otherUser: {
          id: c.other_user_id,
          username: c.other_username,
          publicKey: c.other_public_key || null,
        },
        other_phrase_hash: c.other_phrase_hash,
        otherPhraseHash: c.other_phrase_hash,
      }));
      setConversations(convs);

      // Calculate initial badges from cached data
      const lastSeen = JSON.parse(
        localStorage.getItem("friend_tabs_last_seen") ||
          '{"received":"1970-01-01T00:00:00.000Z","sent":"1970-01-01T00:00:00.000Z","friends":"1970-01-01T00:00:00.000Z"}',
      );
      const requests = cachedData.friendRequests;
      let receivedCount = 0,
        sentCount = 0,
        friendsCount = 0;

      requests.forEach((r) => {
        if (r.status === "pending") {
          if (
            r.receiver_id === authUser.id &&
            new Date(r.created_at) > new Date(lastSeen.received)
          ) {
            receivedCount++;
          }
          if (
            r.sender_id === authUser.id &&
            new Date(r.created_at) > new Date(lastSeen.sent)
          ) {
            sentCount++;
          }
        } else if (r.status === "accepted") {
          if (
            (r.sender_id === authUser.id || r.receiver_id === authUser.id) &&
            new Date(r.updated_at || r.created_at) > new Date(lastSeen.friends)
          ) {
            friendsCount++;
          }
        }
      });

      setNotifBadges({
        received: receivedCount > 0 ? 1 : 0,
        sent: sentCount > 0 ? 1 : 0,
        friends: 0,
      });
      setNotifCount(receivedCount + sentCount);
    }

    setInitStage(0.45, "Validating live conversations...");

    if (/^[0-9a-f]{64}$/i.test(String(savedMk || ""))) {
      setPrivateKey(savedMk);
      setEcdhPrivateKey(savedMk);
    }

    // Cold-start mirror pass: reconcile cached state with server before entering app.
    // This removes stale/deleted items and preloads a small fresh message window.
    try {
      const liveConvs = await getChatsForUser(authUser.id);
      const mergedLive = (liveConvs || []).map((c) => ({
        conversation_id: c.conversation_id,
        created_at: c.created_at,
        last_read_at: c.last_read_at,
        otherUser: {
          id: c.other_user_id,
          username: c.other_username,
          publicKey: c.other_public_key || null,
        },
        other_phrase_hash: c.other_phrase_hash,
      }));
      setConversations(mergedLive);
      _appCache.conversations = liveConvs || [];
      setSidebarContacts(
        mergedLive.map((m) => ({
          id: m.conversation_id,
          username: m.otherUser?.username || "anonymous",
        })),
      );

      const counts = await getUnreadCountsByFriend().catch(() => ({}));
      setUnreadCounts(counts || {});

      const warm = mergedLive.slice(0, 10);
      const lastMsgs = {};
      const minWarmCount = Math.min(
        warm.length,
        Math.max(1, Math.ceil(warm.length * 0.2)),
      );
      const warmNow = warm.slice(0, minWarmCount);
      const warmLater = warm.slice(minWarmCount);
      await Promise.all(
        warmNow.map(async (conv) => {
          const rows = await getMessagesWithFriend(conv.otherUser?.id, 20).catch(() => []);
          if (rows?.length) {
            _setMessagesInCache(conv.conversation_id, rows);
            lastMsgs[conv.conversation_id] = rows[rows.length - 1];
          } else {
            _setMessagesInCache(conv.conversation_id, []);
          }
        }),
      );
      setLastMessages(lastMsgs);

      if (warmLater.length) {
        setInitStage(0.6, "Warming message cache...");
        Promise.all(
          warmLater.map(async (conv) => {
            const rows = await getMessagesWithFriend(conv.otherUser?.id, 20).catch(() => []);
            if (rows?.length) {
              _setMessagesInCache(conv.conversation_id, rows);
              return [conv.conversation_id, rows[rows.length - 1]];
            }
            _setMessagesInCache(conv.conversation_id, []);
            return null;
          }),
        )
          .then((pairs) => {
            const laterMsgs = {};
            (pairs || []).forEach((pair) => {
              if (!pair) return;
              laterMsgs[pair[0]] = pair[1];
            });
            if (Object.keys(laterMsgs).length) {
              setLastMessages((prev) => ({ ...prev, ...laterMsgs }));
            }
          })
          .catch(() => {});
      }
    } catch {
      // Keep already loaded cached state when warm mirror fails.
    }

    setInitStage(1, "Ready");
    setAppLoading(false);
  };

  // Open friends panel - badges are managed by Friends component
  const handleFriendsClick = () => {
    if (layoutName === "telegram") {
      setTelegramTab("notifications");
      return;
    }
    if (layoutName === "sidebar") {
      setShowSettings(false);
      setShowFriends(true);
      setSelectedConversation(null);
      return;
    }
    setShowFriends(true);
  };

  // ── Conversations ─────────────────────────────────────────────────────────────
  const fetchConversations = useCallback(async () => {
    if (!user?.id) return;
    try {
      // Invalidate profile cache to ensure fresh usernames
      cacheInvalidate(/^profile_/);
      const convs = await getChatsForUser(user.id);

      if (!convs?.length) {
        setConversations([]);
        setUnreadCounts({});
        setLastMessages({});
        markSyncing(false);
        return;
      }

      const merged = convs.map((c) => ({
        conversation_id: c.conversation_id,
        created_at: c.created_at,
        last_read_at: c.last_read_at,
        otherUser: {
          id: c.other_user_id,
          username: c.other_username,
          publicKey: c.other_public_key || null,
        },
        other_phrase_hash: c.other_phrase_hash,
      }));

      setConversations((prev) => {
        const changed =
          merged.length !== prev.length ||
          merged.some(
            (m, i) =>
              !prev[i] ||
              prev[i].conversation_id !== m.conversation_id ||
              prev[i].otherUser?.username !== m.otherUser?.username,
          );
        if (changed) {
          // Update app cache with fresh data (keep raw format for Conversation)
          _appCache.conversations = convs || [];
        }
        return changed ? merged : prev;
      });
      setSidebarContacts(
        merged.map((m) => ({
          id: m.conversation_id,
          username: m.otherUser?.username || "anonymous",
        })),
      );

      const counts = await getUnreadCountsByFriend();
      setUnreadCounts(counts);

      const lastMsgs = {};
      await Promise.all(
        merged.map(async (conv) => {
          const msgs = await getMessagesWithFriend(conv.otherUser?.id, 1);
          if (msgs?.[0]) lastMsgs[conv.conversation_id] = msgs[0];
        }),
      );
      setLastMessages(lastMsgs);
    } catch (err) {
      console.error("fetchConversations error:", err);
    } finally {
      setConvLoading(false);
      markSyncing(false);
    }
  }, [user?.id, markSyncing]);

  const scheduleConversationRefresh = useCallback(
    (delayMs = 220) => {
      if (!user?.id) return;
      if (convRefreshTimerRef.current) {
        clearTimeout(convRefreshTimerRef.current);
      }
      convRefreshTimerRef.current = setTimeout(() => {
        fetchConversations();
        convRefreshTimerRef.current = null;
      }, delayMs);
    },
    [user?.id, fetchConversations],
  );

  const signatureForFriendships = useCallback((rows) => {
    return (rows || [])
      .map((r) => `${r.id || ""}:${r.status || ""}:${r.updated_at || r.created_at || ""}`)
      .sort()
      .join("|");
  }, []);

  // ── Realtime connection + notifications ──────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;

    const uid = user.id;

    const channel = supabase
      .channel(`app:${uid}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
        },
        (p) => {
          markSyncing(true);
          invalidateFriendshipCaches();
          fetchInitialBadges(uid);
          setFriendListVersion((v) => v + 1);
          scheduleConversationRefresh(140);

          const isNewPendingReq = p.eventType === "INSERT" && p.new?.status === "pending" && p.new?.receiver_id === uid;
          if (isNewPendingReq) {
            setBellRinging(false);
            requestAnimationFrame(() => {
              setBellRinging(true);
              setTimeout(() => setBellRinging(false), 900);
            });
          }

          getFriendships()
            .then((rows) => {
              _appCache.friendRequests = rows || [];
              try {
                const _friendsCache = window._friendsCache;
                if (_friendsCache) {
                  _friendsCache.received = (rows || []).filter((r) => r.status === "pending" && r.receiver_id === uid);
                  _friendsCache.sent = (rows || []).filter((r) => r.status === "pending" && r.sender_id === uid);
                  _friendsCache.friends = (rows || []).filter((r) => r.status === "accepted");
                  _friendsCache.uid = uid;
                }
              } catch {
                // ignore
              }
            })
            .catch(() => {});
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${uid}`,
        },
        (p) => {
          markSyncing(true);
          const senderId = p.new?.sender_id;
          const receiverId = p.new?.receiver_id;
          const convId = senderId === uid ? receiverId : senderId;
          if (convId) {
            invalidateMessageCache(senderId || convId);
            _addMessageToCache(convId, p.new);
            // Also push to session cache so Chat component shows it instantly when opened
            if (!window._sessionCache) window._sessionCache = { convMessages: {}, convReactions: {} };
            if (!window._sessionCache.convMessages) window._sessionCache.convMessages = {};
            if (!window._sessionCache.convMessages[convId]) {
              window._sessionCache.convMessages[convId] = [];
            }
            const sessionMsg = {
              ...p.new,
              conversation_id: convId,
              message_id: p.new.id,
              seen_at: p.new.read_at || null,
              delivered_at: p.new.delivered_at || null,
              is_edited: Boolean(p.new.is_edited),
              reply_to_message_id: p.new.reply_to_message_id || null,
            };
            if (!window._sessionCache.convMessages[convId].find((m) => m.id === p.new.id)) {
              window._sessionCache.convMessages[convId].push(sessionMsg);
            }
            setLastMessages((prev) => ({ ...prev, [convId]: p.new }));
            // Instantly increment unread badge for this conversation
            setUnreadCounts((prev) => ({
              ...prev,
              [convId]: (prev[convId] || 0) + 1,
            }));
            // Always mark as unseen in sidebar if applicable
            if (senderId && layoutName === "sidebar") {
              setSidebarUnseenMsgs((prev) => ({ ...prev, [senderId]: true }));
            }
            // Also mark by conversation_id for sidebar lookup
            if (convId && layoutName === "sidebar") {
              setSidebarUnseenMsgs((prev) => ({ ...prev, [convId]: true }));
            }
            scheduleConversationRefresh(80);
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${uid}`,
        },
        () => {
          markSyncing(true);
          scheduleConversationRefresh(120);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_rows",
        },
        (p) => {
          markSyncing(true);
          const a = p.new?.user_a;
          const b = p.new?.user_b;
          if (a !== uid && b !== uid) return;
          scheduleConversationRefresh(120);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_rows",
        },
        (p) => {
          markSyncing(true);
          const a = p.old?.user_a;
          const b = p.old?.user_b;
          if (a !== uid && b !== uid) return;
          const deletedConvId = a === uid ? b : a;
          if (deletedConvId) {
            removeConversationFromCache(deletedConvId);
            setConversations((prev) =>
              prev.filter((c) => c.conversation_id !== deletedConvId),
            );
            setUnreadCounts((prev) => {
              const n = { ...prev };
              delete n[deletedConvId];
              return n;
            });
            setLastMessages((prev) => {
              const n = { ...prev };
              delete n[deletedConvId];
              return n;
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "username_shares",
          filter: `recipient_id=eq.${uid}`,
        },
        () => {
          markSyncing(true);
          setFriendListVersion((v) => v + 1);
          scheduleConversationRefresh(120);
          // Invalidate profile cache so new usernames are fetched fresh
          cacheInvalidate(/^profile_/);
          cacheInvalidate(/^chats_/);
        },
      )
      .subscribe((status, err) => {
        // realtime status
        setConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          markSyncing(true);
          fetchConversations();
          fetchInitialBadges(uid);
        }
      });

    const connChannel = supabase
      .channel("connection-check")
      .subscribe((status, err) => {
        // connection status
        setConnected(status === "SUBSCRIBED");
      });

    return () => {
      if (convRefreshTimerRef.current) {
        clearTimeout(convRefreshTimerRef.current);
        convRefreshTimerRef.current = null;
      }
      supabase.removeChannel(channel);
      supabase.removeChannel(connChannel);
    };
  }, [user?.id, fetchInitialBadges, fetchConversations, markSyncing, scheduleConversationRefresh]);

  useEffect(() => {
    if (user?.id) fetchConversations();
  }, [user?.id, fetchConversations]);

  useEffect(() => {
    if (!user?.id) {
      initialSyncBadgeShownRef.current = false;
      return;
    }
    if (!initialSyncBadgeShownRef.current) {
      initialSyncBadgeShownRef.current = true;
      showSyncBadge(1300);
    }
  }, [user?.id, showSyncBadge]);

  useEffect(() => {
    if (!user?.id) return;
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      showSyncBadge(1200);
      markSyncing(true);
      scheduleConversationRefresh(80);
      fetchInitialBadges(user.id);
      setFriendListVersion((v) => v + 1);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [user?.id, fetchInitialBadges, markSyncing, scheduleConversationRefresh, showSyncBadge]);

  useEffect(() => {
    return () => {
      if (syncBadgeTimerRef.current) clearTimeout(syncBadgeTimerRef.current);
      if (syncBadgeExitTimerRef.current) clearTimeout(syncBadgeExitTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) {
      friendshipsSignatureRef.current = "";
      return;
    }

    let alive = true;
    const uid = user.id;

    const poll = async () => {
      if (!alive || document.visibilityState === "hidden") return;
      try {
        const rows = await getFriendships().catch(() => []);
        if (!alive) return;
        const nextSig = signatureForFriendships(rows || []);
        if (nextSig !== friendshipsSignatureRef.current) {
          friendshipsSignatureRef.current = nextSig;
          _appCache.friendRequests = rows || [];
          setFriendListVersion((v) => v + 1);
          fetchInitialBadges(uid);
          scheduleConversationRefresh(80);
        }
      } catch {
        // ignore polling errors
      }
    };

    poll();
    const timer = window.setInterval(poll, 3500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user?.id, fetchInitialBadges, scheduleConversationRefresh, signatureForFriendships]);

  const _lastDistributedFriendships = useRef(null);

  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;

    const distribute = async () => {
      // Always invalidate profile cache on distribution to ensure fresh usernames
      cacheInvalidate(/^profile_/);
      const cached = cacheGet("friendships");
      if (cached && cached === _lastDistributedFriendships.current) return;
      try {
        const friendships = cached || await getFriendships().catch(() => []);
        if (!friendships || friendships === _lastDistributedFriendships.current) return;
        _lastDistributedFriendships.current = friendships;
        _appCache.friendRequests = friendships;

        const pMap = {};
        const profileIds = [...new Set(friendships.map((f) => f.sender_id === uid ? f.receiver_id : f.sender_id))];
        const profiles = await getKnownProfiles(uid).catch(() => []);
        (profiles || []).forEach((p) => { pMap[p.id] = p; });

        const accepted = friendships
          .filter((f) => f.status === "accepted")
          .map((f) => (f.sender_id === uid ? f.receiver_id : f.sender_id));
        const uniq = [...new Set(accepted)].map((id) => ({
          id,
          username: pMap[id]?.username || id.slice(0, 8),
        }));

        setSidebarContacts(uniq);
        setContactsList(uniq);

        const acceptedFull = friendships.filter((f) => f.status === "accepted");
        const newlyAccepted = acceptedFull.filter((f) => {
          const other = f.sender_id === uid ? f.receiver_id : f.sender_id;
          if (!other) return false;
          const stamp = f.updated_at || f.accepted_at || f.created_at;
          const seenAt = localStorage.getItem("contacts_seen_at") || "1970-01-01T00:00:00.000Z";
          return new Date(stamp || 0) > new Date(seenAt);
        });
        // Only update badge count if it's not already cleared by user interaction
        if (!sidebarFriendsBadgeCleared) {
          setContactsBadgeCount(newlyAccepted.length);
        }
      } catch {
        // ignore
      }
    };

    distribute();
  }, [user?.id, friendListVersion]);

  useEffect(() => {
    if (layoutName !== "telegram" || telegramTab !== "contacts") return;
    try {
      localStorage.setItem("contacts_seen_at", new Date().toISOString());
    } catch {
      // ignore
    }
    setContactsBadgeCount(0);
  }, [layoutName, telegramTab]);

  useEffect(() => {
    if (layoutName !== "sidebar") return;
    const expanded = !sidebarCompact || sidebarExpanded || sidebarSearchOpen;
    if (expanded && !sidebarFriendsBadgeCleared) {
      setContactsBadgeCount(0);
      setSidebarFriendsBadgeCleared(true);
      // Persist seen timestamp so refresh doesn't resurrect the badge
      try {
        localStorage.setItem("contacts_seen_at", new Date().toISOString());
      } catch { /* ignore */ }
    }
    if (!expanded) {
      setSidebarFriendsBadgeCleared(false);
    }
  }, [layoutName, sidebarCompact, sidebarExpanded, sidebarSearchOpen, sidebarFriendsBadgeCleared]);

  useEffect(() => {
    if (!user?.id) return;
    let heartbeat = null;

    const publish = async (state) => {
      try {
        await updateEncryptedStatus(state === "online").catch(() => {});
      } catch {
        // ignore
      }
    };

    publish("online");
    heartbeat = window.setInterval(() => publish("online"), 30000);

    const onVis = () => {
      if (document.visibilityState === "hidden") publish("away");
      else publish("online");
    };
    document.addEventListener("visibilitychange", onVis);

    const onBeforeUnload = () => {
      publish("offline");
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      if (heartbeat) window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("beforeunload", onBeforeUnload);
      publish("offline");
    };
  }, [user?.id]);

  useEffect(() => {
    if (layoutName !== "sidebar" || !sidebarSearchOpen) return;
    const timer = setTimeout(() => {
      sidebarSearchInputRef.current?.focus();
      sidebarSearchInputRef.current?.select?.();
    }, 120);
    return () => clearTimeout(timer);
  }, [layoutName, sidebarSearchOpen]);

  useEffect(() => {
    if (layoutName !== "telegram" || telegramTab !== "contacts") return;
    const onDown = (e) => {
      const node = e.target;
      if (node?.closest?.("[data-tg-contact-menu='1']")) return;
      setTelegramContactMenuOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [layoutName, telegramTab]);

  useEffect(() => {
    if (layoutName !== "sidebar") {
      setSidebarCompact(false);
      setSidebarExpanded(false);
      setSidebarFriendsFocus(false);
      return;
    }
    const apply = () => {
      const compact = window.innerWidth <= 760;
      setSidebarCompact(compact);
      if (!compact) setSidebarExpanded(true);
      else if (!sidebarSearchOpen) setSidebarExpanded(false);
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [layoutName, sidebarSearchOpen]);

  useEffect(() => {
    const expandedNow = !sidebarCompact || sidebarExpanded || sidebarSearchOpen;
    if (!expandedNow || sidebarSearchOpen) {
      setSidebarFriendsFocus(false);
    }
  }, [sidebarCompact, sidebarExpanded, sidebarSearchOpen]);

  useEffect(() => {
    if (layoutName !== "sidebar" || !sidebarCompact || !sidebarExpanded) return;
    const onPointerDown = (e) => {
      const node = sidebarRootRef.current;
      if (node && node.contains(e.target)) return;
      setSidebarExpanded(false);
      if (!sidebarSearchOpen) {
        setSidebarSearch("");
        setSidebarSearchStatus({ text: "", ok: false });
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [layoutName, sidebarCompact, sidebarExpanded, sidebarSearchOpen]);

  useEffect(() => {
    if (layoutName !== "sidebar" || !sidebarSearchOpen) return;
    const onPointerDown = (e) => {
      const node = sidebarSearchShellRef.current;
      if (!node) return;
      if (!node.contains(e.target)) {
        setSidebarSearchOpen(false);
        setSidebarSearch("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [layoutName, sidebarSearchOpen]);

  useEffect(() => {
    const onEsc = (e) => {
      if (e.key !== "Escape") return;

      const active = document.activeElement;
      if (
        active &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)
      ) {
        active.blur();
        return;
      }

      if (showThemePicker) {
        setShowThemePicker(false);
        return;
      }

      if (layoutName === "telegram") {
        if (selectedConversation) {
          setSelectedConversation(null);
          setTelegramTab("chats");
          return;
        }
        if (telegramTab !== "chats") {
          setTelegramTab("chats");
          return;
        }
      }

      if (layoutName === "sidebar") {
        if (sidebarSearchOpen) {
          setSidebarSearchOpen(false);
          setSidebarSearch("");
          return;
        }
        if (sidebarCompact && sidebarExpanded) {
          setSidebarExpanded(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (showFriends) {
          setShowFriends(false);
          return;
        }
        if (selectedConversation) {
          setSelectedConversation(null);
          return;
        }
      }

      if (showSettings) {
        setShowSettings(false);
        return;
      }
      if (showFriends) {
        setShowFriends(false);
        return;
      }
      if (selectedConversation) {
        setSelectedConversation(null);
      }
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [
    layoutName,
    selectedConversation,
    showFriends,
    showSettings,
    showThemePicker,
    sidebarSearchOpen,
    sidebarCompact,
    sidebarExpanded,
    telegramTab,
  ]);

  const handleKeysReady = useCallback((mk, pk) => {
    setPrivateKey(mk);
    setEcdhPrivateKey(pk);
  }, []);

  const handleDeleteConvForMe = async (convId) => {
    // delete for me
    setMenuOpenFor(null);
    try {
      await hideChatForMe(convId);
    } catch (e) {
      console.warn("Delete conversation session failed:", e);
    }
    fetchConversations();
  };

  const handleDeleteConvForAll = async (convId) => {
    // delete for everyone
    setMenuOpenFor(null);
    try {
      await deleteChatForEveryone(convId);
    } catch (e) {
      console.warn("Delete conversation failed:", e);
    }
    fetchConversations();
  };

  const handleUnfriend = async (convId, otherUserId) => {
    // unfriend
    setMenuOpenFor(null);
    try {
      const friendId = otherUserId || convId;
      const friendship = await getFriendshipBetween(user.id, friendId);
      if (friendship?.id) {
        await removeFriendship(friendship.id);
      }
    } catch (e) {
      console.warn("Unfriend failed:", e);
    }
    fetchConversations();
    setSelectedConversation(null);
  };

  const handleBlockConversation = async (conversation) => {
    setMenuOpenFor(null);
    try {
      const friendId = conversation.otherUser?.id || conversation.conversation_id;
      await blockUser(user.id, friendId);
    } catch (e) {
      console.warn("Block failed:", e);
    }
    fetchConversations();
    setSelectedConversation(null);
  };

  const handleStartChat = useCallback(
    async (friend) => {
      if (!user || startingRef.current) return;
      const friendId = friend?.userId || friend?.id || null;
      if (!friendId) return;
      startingRef.current = true;
      setStartingChat(true);
      try {
        const existing = await findChatWithUser(user.id, friendId);
        if (existing?.length) {
          setShowFriends(false);
          setSelectedConversation(existing[0].conversation_id);
          setStartingChat(false);
          startingRef.current = false;
          return;
        }
        await ensureChatExists(friendId);
        const convId = friendId;

        // Add to cache immediately for instant open
        const newConv = {
          conversation_id: convId,
          other_user_id: friendId,
          other_username: friend.username,
          created_at: new Date().toISOString(),
          last_read_at: null,
        };
        addConversationToCache(newConv);

        // Update conversations state
      setConversations((prev) => [
          {
            conversation_id: convId,
            created_at: new Date().toISOString(),
            last_read_at: null,
            otherUser: { id: friendId, username: friend.username },
          },
          ...prev,
        ]);

      // Close friends panel and open conversation immediately
      setShowFriends(false);
      setTelegramTab("chats");
      setSelectedConversation(convId);

        // Refresh conversations in background to sync with server
        fetchConversations();
      } catch (err) {
        console.error("handleStartChat error:", err);
        alert("Failed: " + (err.message || "Unknown"));
      } finally {
        setStartingChat(false);
        startingRef.current = false;
      }
    },
    [user, fetchConversations],
  );

  const handleTelegramSendRequest = useCallback(async () => {
    const key = String(telegramContactQuery || "").trim().toLowerCase();
    const uid = String(user?.id || "").trim().toLowerCase();
    if (!key || !uid) return;
    setTelegramContactLoading(true);
    setTelegramContactStatus({ text: "", ok: false });

    if (!isHexUserId(key) && !isUUID(key)) {
      setTelegramContactStatus({ text: "Please enter a valid user ID.", ok: false });
      setTelegramContactLoading(false);
      return;
    }

    try {
      const profile = await getProfile(key);
      if (!profile?.id) {
        setTelegramContactStatus({ text: "User not found.", ok: false });
        return;
      }
      const targetId = String(profile.id).trim().toLowerCase();
      if (targetId === uid) {
        setTelegramContactStatus({ text: "You cannot add yourself.", ok: false });
        return;
      }
      const blockedRows = await getBlockedUsers(uid).catch(() => []);
      const blockedSet = new Set((blockedRows || []).map((r) => String(r.blocked_id || "").trim().toLowerCase()));
      if (blockedSet.has(targetId)) {
        setTelegramContactStatus({ text: "Cannot send request. User is blocked.", ok: false });
        return;
      }
      const existing = await getFriendshipBetween(uid, targetId);
      if (existing) {
        if (existing.status === "accepted") {
          setTelegramContactStatus({ text: "Already in your friends list.", ok: false });
        } else if (existing.status === "pending") {
          const mine = String(existing.sender_id || "").trim().toLowerCase() === uid;
          setTelegramContactStatus({
            text: mine ? "Request already sent." : "This user already sent you a request.",
            ok: false,
          });
        } else {
          setTelegramContactStatus({ text: "Request already exists.", ok: false });
        }
        return;
      }

      await sendFriendRequest(targetId);
      setTelegramContactQuery("");
      setTelegramContactStatus({ text: "Request sent.", ok: true });
      setFriendListVersion((v) => v + 1);
      fetchInitialBadges(uid);
    } catch (e) {
      setTelegramContactStatus({ text: e?.message || "Failed to send request.", ok: false });
    } finally {
      setTelegramContactLoading(false);
    }
  }, [telegramContactQuery, user?.id, fetchInitialBadges]);

  const handleSidebarSendRequest = useCallback(async () => {
    const key = String(sidebarSearch || "").trim().toLowerCase();
    const uid = String(user?.id || "").trim().toLowerCase();
    if (!key || !uid) return;
    setSidebarSearchLoading(true);
    setSidebarSearchStatus({ text: "", ok: false });

    if (!isHexUserId(key) && !isUUID(key)) {
      setSidebarSearchStatus({ text: "Please enter a valid user ID.", ok: false });
      setSidebarSearchLoading(false);
      return;
    }

    try {
      const profile = await getProfile(key);
      if (!profile?.id) {
        setSidebarSearchStatus({ text: "User not found.", ok: false });
        return;
      }
      const targetId = String(profile.id).trim().toLowerCase();
      if (targetId === uid) {
        setSidebarSearchStatus({ text: "You cannot add yourself.", ok: false });
        return;
      }
      const blockedRows = await getBlockedUsers(uid).catch(() => []);
      const blockedSet = new Set((blockedRows || []).map((r) => String(r.blocked_id || "").trim().toLowerCase()));
      if (blockedSet.has(targetId)) {
        setSidebarSearchStatus({ text: "Cannot send request. User is blocked.", ok: false });
        return;
      }
      const existing = await getFriendshipBetween(uid, targetId);
      if (existing) {
        if (existing.status === "accepted") {
          setSidebarSearchStatus({ text: "Already in your friends list.", ok: false });
        } else if (existing.status === "pending") {
          const mine = String(existing.sender_id || "").trim().toLowerCase() === uid;
          setSidebarSearchStatus({ text: mine ? "Request already sent." : "Incoming request exists.", ok: false });
        } else {
          setSidebarSearchStatus({ text: "Request already exists.", ok: false });
        }
        return;
      }
      await sendFriendRequest(targetId);
      setSidebarSearch("");
      setSidebarSearchStatus({ text: "Request sent.", ok: true });
      setFriendListVersion((v) => v + 1);
      fetchInitialBadges(uid);
    } catch (e) {
      setSidebarSearchStatus({ text: e?.message || "Failed to send request.", ok: false });
    } finally {
      setSidebarSearchLoading(false);
    }
  }, [sidebarSearch, user?.id, fetchInitialBadges]);

  const openConversation = useCallback(
    (conversationId) => {
      if (appLocked) return;
      const hit = conversations.find(
        (c) => c.conversation_id === conversationId || c.otherUser?.id === conversationId,
      );
      const targetId = hit?.otherUser?.id || null;
      setShowFriends(false);
      setShowSettings(false);
      setSelectedConversation(conversationId);
      setUnreadCounts((prev) => {
        const n = { ...prev };
        delete n[conversationId];
        if (targetId) delete n[targetId];
        return n;
      });
    },
    [appLocked, conversations],
  );

  useEffect(() => {
    if (!user?.id || !sidebarContacts.length) {
      setContactPresenceMap({});
      return;
    }
    let alive = true;
    (async () => {
      try {
        const profiles = await getKnownProfiles(user.id).catch(() => []);
        const next = {};
        const now = Date.now();
        (profiles || []).forEach((p) => {
          const id = String(p?.id || "").trim().toLowerCase();
          const seen = Number(p?.last_seen_ts || p?.last_seen || 0);
          const online = seen > 0 && now - seen < 60 * 1000;
          if (id) next[id] = online;
        });
        if (!alive) return;
        setContactPresenceMap(next);
      } catch {
        // ignore
      }
    })();
    return () => {
      alive = false;
    };
  }, [user?.id, sidebarContacts, friendListVersion]);

  if (appLoading) {
    return (
      <AppLoadingScreen
        theme={theme}
        progress={appInitProgress}
        status={appInitStatus}
      />
    );
  }

  if (!user)
    return (
      <>
        <BackendSetupIssueBanner theme={theme} message={backendSyncIssue} />
        <AuthPhrase
          onAuthSuccess={async (userId) => {
            if (userId) {
              try {
                await trySetAuthUserContext(userId);
                await initUser({ id: userId });
              } catch (e) {
                console.error("Post-auth init failed:", e);
                if (isBackendObjectMissingError(e)) {
                  setBackendSyncIssue(backendSetupMessage);
                }
                setInitStage(1, "Failed to initialize");
              }
            } else {
              window.location.reload();
            }
          }}
        />
      </>
    );

  if (!appLockPolicyReady) {
    return (
      <AppLoadingScreen
        theme={theme}
        progress={1}
        status="Applying lock policy..."
      />
    );
  }

  if (appLocked && user?.id) {
    return (
      <div
        style={{
          height: "100dvh",
          width: "100vw",
          background: theme.bg,
          overflow: "hidden",
        }}
      >
        <AppLockOverlay
          userId={user.id}
          onUnlock={handleUnlock}
          onLogout={handleLockLogout}
        />
      </div>
    );
  }

  const cardGlow = theme.isDark
    ? `0 0 0 1px ${theme.border}, 0 20px 60px rgba(0,0,0,0.5)`
    : `0 20px 60px rgba(0,0,0,0.12)`;
  const motionFast = "var(--app-motion-fast, 140ms)";
  const motionNormal = "var(--app-motion-normal, 220ms)";
  const motionSlow = "var(--app-motion-slow, 320ms)";
  const easeStandard = "var(--app-ease-standard, ease)";
  const easeEmphasis = "var(--app-ease-emphasized, cubic-bezier(0.22,1,0.36,1))";

  const tgMaterial = String(theme.material || "solid");
  const tgActiveBg =
    tgMaterial === "m3"
      ? `color-mix(in srgb, ${theme.primary} 24%, transparent)`
      : tgMaterial === "neumorphism"
        ? `color-mix(in srgb, ${theme.surface2} 84%, ${theme.primary} 16%)`
        : tgMaterial === "glass"
          ? `color-mix(in srgb, ${theme.primary} 22%, rgba(255,255,255,0.06))`
          : `${theme.primary}2a`;
  const tgActiveShadow =
    tgMaterial === "m3"
      ? `0 0 0 1px color-mix(in srgb, ${theme.primary} 42%, transparent) inset`
      : tgMaterial === "neumorphism"
        ? "inset 2px 2px 5px rgba(0,0,0,0.2), inset -2px -2px 5px rgba(255,255,255,0.12)"
        : tgMaterial === "glass"
          ? `0 0 0 1px color-mix(in srgb, ${theme.primary} 36%, transparent) inset, 0 0 16px color-mix(in srgb, ${theme.primaryGlow || theme.primary} 52%, transparent)`
          : `0 0 10px ${theme.primaryGlow || `${theme.primary}55`}`;

  const TELEGRAM_NAV_H = 74;
  const TELEGRAM_NAV_BOTTOM_PAD = `calc(${TELEGRAM_NAV_H}px + env(safe-area-inset-bottom, 0px))`;
  const bottomNav = (
    <div
      style={{
        height: TELEGRAM_NAV_H,
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: `1px solid ${theme.border}`,
        background: theme.headerBg,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        flexShrink: 0,
        zIndex: 20,
        padding: "8px 10px",
        paddingBottom: `calc(8px + env(safe-area-inset-bottom, 0px))`,
        boxSizing: "border-box",
      }}
    >
        <button
          className="tg-bottom-nav-btn"
          onClick={() => {
            setTelegramTab("contacts");
            setSelectedConversation(null);
            setShowFriends(false);
            setShowSettings(false);
          }}
          style={{
            background: telegramTab === "contacts" ? tgActiveBg : "transparent",
            border: "none",
            color: theme.text,
            cursor: "pointer",
            borderRadius: "var(--app-radius-md)",
            padding: "10px 12px",
            position: "relative",
            transition: `all ${motionNormal} ${easeStandard}`,
            transform: telegramTab === "contacts" ? "translateY(-1px)" : "translateY(0)",
            boxShadow: telegramTab === "contacts" ? tgActiveShadow : "none",
          }}
          title="Friends"
          aria-pressed={telegramTab === "contacts"}
        >
          <FriendsIcon size={20} style={{ color: telegramTab === "contacts" ? theme.primary : theme.text2 }} />
        {contactsBadgeCount > 0 && (
          <span
            style={{
              position: "absolute",
              right: -6,
              top: -6,
              minWidth: 14,
              height: 14,
              borderRadius: 999,
              padding: "0 4px",
              background: theme.badgeBg,
              color: theme.badgeFg,
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {contactsBadgeCount > 99 ? "99+" : contactsBadgeCount}
          </span>
        )}
      </button>
        <button
          className="tg-bottom-nav-btn"
          onClick={() => {
            setTelegramTab("chats");
            setSelectedConversation(null);
            setShowFriends(false);
            setShowSettings(false);
          }}
          style={{
            background: telegramTab === "chats" ? tgActiveBg : "transparent",
            border: "none",
            color: theme.text,
            cursor: "pointer",
            borderRadius: "var(--app-radius-md)",
            padding: "10px 12px",
            position: "relative",
            transition: `all ${motionNormal} ${easeStandard}`,
            transform: telegramTab === "chats" ? "translateY(-1px)" : "translateY(0)",
            boxShadow: telegramTab === "chats" ? tgActiveShadow : "none",
          }}
          title="Chats"
          aria-pressed={telegramTab === "chats"}
      >
        <ChatIcon size={20} style={{ color: telegramTab === "chats" ? theme.primary : theme.text2 }} />
        {chatBadgeCount > 0 && (
          <span
            style={{
              position: "absolute",
              right: -6,
              top: -6,
              minWidth: 14,
              height: 14,
              borderRadius: 999,
              padding: "0 4px",
              background: theme.badgeBg,
              color: theme.badgeFg,
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {chatBadgeCount > 99 ? "99+" : chatBadgeCount}
          </span>
        )}
      </button>
        <button
          className="tg-bottom-nav-btn"
          onClick={() => {
            setTelegramTab("notifications");
            setShowFriends(false);
            setShowSettings(false);
            setSelectedConversation(null);
          }}
          style={{
            background: telegramTab === "notifications" ? tgActiveBg : "transparent",
            border: "none",
            color: theme.text,
            cursor: "pointer",
            position: "relative",
            borderRadius: "var(--app-radius-md)",
            padding: "10px 12px",
            transition: `all ${motionNormal} ${easeStandard}`,
            transform: telegramTab === "notifications" ? "translateY(-1px)" : "translateY(0)",
            boxShadow: telegramTab === "notifications" ? tgActiveShadow : "none",
          }}
          title="Notifications"
          aria-pressed={telegramTab === "notifications"}
      >
        <BellIcon size={20} style={{ color: telegramTab === "notifications" ? theme.primary : theme.text2 }} />
        {effectiveNotifCount > 0 && (
          <span
            style={{
              position: "absolute",
              right: -6,
              top: -6,
              minWidth: 14,
              height: 14,
              borderRadius: 999,
              padding: "0 4px",
              background: theme.badgeBg,
              color: theme.badgeFg,
              fontSize: 9,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {effectiveNotifCount > 99 ? "99+" : effectiveNotifCount}
          </span>
        )}
      </button>
        <button
          className="tg-bottom-nav-btn"
          onClick={() => {
            setTelegramTab("settings");
            setShowFriends(false);
            setShowSettings(false);
            setSelectedConversation(null);
          }}
          style={{
            background: telegramTab === "settings" ? tgActiveBg : "transparent",
            border: "none",
            color: theme.text,
            cursor: "pointer",
            borderRadius: "var(--app-radius-md)",
            padding: "10px 12px",
            transition: `all ${motionNormal} ${easeStandard}`,
            transform: telegramTab === "settings" ? "translateY(-1px)" : "translateY(0)",
            boxShadow: telegramTab === "settings" ? tgActiveShadow : "none",
          }}
          title="Settings"
          aria-pressed={telegramTab === "settings"}
      >
        <SettingsIcon size={20} style={{ color: telegramTab === "settings" ? theme.primary : theme.text2 }} />
      </button>
    </div>
  );

  const filteredSidebarContacts = sidebarContacts.filter((c) =>
    String(c.username || "")
      .toLowerCase()
      .includes(String(sidebarSearch || "").trim().toLowerCase()),
  );
  const sidebarSearchTrimmed = String(sidebarSearch || "").trim().toLowerCase();
  const canSendSidebarRequest =
    isHexUserId(sidebarSearchTrimmed) || isUUID(sidebarSearchTrimmed);
  const sidebarDirectoryContacts = contactsList.map((c) => ({
    id: c.id,
    username: c.username,
    isContact: true,
  }));
  const sidebarChatItems = sidebarContacts.map((c) => ({
    id: c.id,
    username: c.username,
    isContact: false,
  }));
  const baseSidebarItems = sidebarSearchOpen
    ? sidebarDirectoryContacts
    : sidebarChatItems.length > 0
      ? sidebarChatItems
      : sidebarDirectoryContacts;
  const visibleSidebarItems = baseSidebarItems.filter((c) =>
    String(c.username || "")
      .toLowerCase()
      .includes(sidebarSearchTrimmed),
  );
  const sidebarWidth = layoutName !== "sidebar"
    ? 86
    : !sidebarCompact
      ? sidebarSearchOpen
        ? 280
        : 86
      : sidebarSearchOpen
        ? "48%"
        : sidebarFriendsFocus
          ? "34%"
        : (sidebarExpanded || sidebarSearchOpen)
        ? "28%"
        : "10%";
  const sidebarWidthPx = layoutName !== "sidebar"
    ? 86
    : !sidebarCompact
      ? sidebarSearchOpen ? 280 : 86
      : sidebarSearchOpen
        ? window.innerWidth * 0.48
        : sidebarFriendsFocus
          ? window.innerWidth * 0.34
          : (sidebarExpanded || sidebarSearchOpen)
            ? window.innerWidth * 0.28
            : window.innerWidth * 0.10;
  const sidebarIsExpanded = !sidebarCompact || sidebarExpanded || sidebarSearchOpen;
  const sidebarScale = sidebarCompact && !sidebarIsExpanded ? 0.7 : 1;
  const sidebarBtnSize = sidebarCompact && !sidebarIsExpanded ? 28 : Math.round(46 * sidebarScale);
  const sidebarAvatarDot = Math.max(7, Math.round(9 * sidebarScale));

  const filteredTelegramContacts = contactsList.filter((c) =>
    String(c.username || "")
      .toLowerCase()
      .includes(String(telegramContactQuery || "").trim().toLowerCase()),
  );
  const telegramContactQueryTrimmed = String(telegramContactQuery || "").trim().toLowerCase();
  const canSendTelegramRequest =
    isHexUserId(telegramContactQueryTrimmed) || isUUID(telegramContactQueryTrimmed);
  const selectedConvDataRaw = _appCache.conversations.find(
    (c) => c.conversation_id === selectedConversation || c.other_user_id === selectedConversation,
  );
  const selectedConvDataState = conversations.find(
    (c) => c.conversation_id === selectedConversation || c.otherUser?.id === selectedConversation,
  );
  const selectedConvData = selectedConvDataRaw ||
    (selectedConvDataState
      ? {
          conversation_id: selectedConvDataState.conversation_id,
          other_user_id: selectedConvDataState.otherUser?.id,
          other_username: selectedConvDataState.otherUser?.username,
          other_public_key: selectedConvDataState.otherUser?.publicKey || null,
        }
      : null);
  const selectedFriendId = selectedConvData?.other_user_id || null;

  const telegramSectionHeader = (title) => (
    <div
      style={{
        padding: "16px 18px",
        borderBottom: `1px solid ${theme.border}`,
        background: theme.headerBg,
        color: theme.headerFg,
        flexShrink: 0,
        position: "sticky",
        top: 0,
        zIndex: 25,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <div
        key={`tg-header-${title}`}
        className="tg-header-title"
        style={{ fontSize: 20, fontWeight: 900, letterSpacing: 0.2 }}
      >
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: theme.text2 }}>ZChat</span>
        {connected ? (
          <span
            className="dot-connected"
            title="Connected"
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              display: "inline-block",
              background: theme.success,
              boxShadow: `0 0 9px ${theme.success}`,
            }}
          />
        ) : (
          <span
            className="radar-container"
            title="Reconnecting"
            style={{
              width: 16,
              height: 16,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span className="radar-pulse" style={{ borderColor: theme.danger }} />
            <span className="radar-pulse" style={{ borderColor: theme.danger }} />
            <span className="radar-pulse" style={{ borderColor: theme.danger }} />
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
    </div>
  );

  return (
    <div
      className="app-root"
      style={{
        height: "100dvh",
        background: theme.bg,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "calc(10px + env(safe-area-inset-top, 0px)) calc(12px + env(safe-area-inset-right, 0px)) calc(10px + env(safe-area-inset-bottom, 0px)) calc(12px + env(safe-area-inset-left, 0px))",
        overflow: "hidden",
      }}
    >
      <div
        className="app-shell"
        style={{
          width: "100%",
          maxWidth: layoutName === "sidebar" ? 980 : 480,
          height: "100%",
          maxHeight: "100%",
          background: theme.surface,
          boxShadow: cardGlow,
          borderRadius: 28,
          overflow: "hidden",
          display: "flex",
          flexDirection: layoutName === "sidebar" ? "row" : "column",
          position: "relative",
        }}
      >
        {layoutName === "sidebar" && (
          <div
            ref={sidebarRootRef}
            onClick={() => {
              if (sidebarCompact && !sidebarExpanded) setSidebarExpanded(true);
            }}
            style={{
              width: sidebarWidth,
              position: "relative",
              borderRight: `1px solid ${theme.border}`,
              background: theme.surface2,
              display: "flex",
              flexDirection: "column",
              alignItems: sidebarIsExpanded ? "stretch" : "center",
              gap: 10,
              padding: sidebarCompact
                ? sidebarIsExpanded
                  ? "18px 10px 12px"
                  : "18px 2px 12px"
                : "20px 12px 16px",
              transition: `width ${motionSlow} ${easeEmphasis}, opacity ${motionNormal} ${easeStandard}`,
              opacity: sidebarCompact && !sidebarExpanded ? 0.78 : 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 8,
                order: 1,
                alignItems: "center",
                opacity: sidebarIsExpanded ? 1 : 0.94,
                transform: sidebarIsExpanded ? "translateY(0)" : "translateY(1px)",
                transition: `opacity ${motionNormal} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}`,
              }}
            >
            <div
              ref={sidebarSearchShellRef}
              style={{
                width: sidebarIsExpanded ? "100%" : sidebarBtnSize,
                height: sidebarSearchOpen ? "auto" : sidebarBtnSize,
                minHeight: sidebarBtnSize,
                alignSelf: sidebarIsExpanded ? "stretch" : "center",
                transition: `width ${motionNormal} ${easeStandard}`,
                position: "relative",
              }}
            >
              {sidebarSearchOpen ? (
                <div style={{ width: "100%", position: "relative" }}>
                  <div style={{ position: "relative", width: "100%" }}>
                    <input
                      ref={sidebarSearchInputRef}
                      value={sidebarSearch}
                      onChange={(e) => {
                        setSidebarSearch(e.target.value);
                        setSidebarSearchStatus({ text: "", ok: false });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (canSendSidebarRequest) handleSidebarSendRequest();
                      }}
                      placeholder="Search friends or paste user ID"
                      style={{
                        width: "100%",
                        height: sidebarBtnSize,
                        boxSizing: "border-box",
                        padding: "8px 48px 8px 10px",
                        borderRadius: 14,
                        border: `1px solid ${theme.primary}`,
                        background: theme.inputBg,
                        color: theme.text,
                        fontSize: 12,
                      }}
                    />
                    <button
                      onClick={handleSidebarSendRequest}
                      disabled={sidebarSearchLoading || !canSendSidebarRequest}
                      style={{
                        position: "absolute",
                        right: 3,
                        top: 3,
                        bottom: 3,
                        width: 36,
                        borderRadius: 10,
                        border: "none",
                        background: canSendSidebarRequest
                          ? theme.primary
                          : `${theme.primary}22`,
                        color: canSendSidebarRequest
                          ? theme.primaryFg
                          : `${theme.primary}88`,
                        fontWeight: 900,
                        cursor: canSendSidebarRequest ? "pointer" : "default",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        opacity: canSendSidebarRequest ? 1 : 0.65,
                      }}
                    >
                      {sidebarSearchLoading ? (
                        "…"
                      ) : (
                        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <line x1="19" y1="8" x2="19" y2="14" />
                          <line x1="16" y1="11" x2="22" y2="11" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      marginBottom: 6,
                      fontSize: 10,
                      color: theme.text3,
                      textAlign: "center",
                      lineHeight: 1.4,
                      padding: "0 2px",
                    }}
                  >
                    Type a name to filter friends, or paste an ID to send a request
                  </div>
                  {sidebarSearchStatus.text && (
                    <div
                      style={{
                        position: "absolute",
                        right: 3,
                        top: "calc(100% + 4px)",
                        borderRadius: 8,
                        border: `1px solid ${sidebarSearchStatus.ok ? theme.success : theme.danger}`,
                        background: theme.surface,
                        color: sidebarSearchStatus.ok ? theme.success : theme.danger,
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "3px 8px",
                        zIndex: 2,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {sidebarSearchStatus.text}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => {
                    if (sidebarCompact && !sidebarIsExpanded) {
                      setSidebarExpanded(true);
                      return;
                    }
                    setSidebarSearchOpen(true);
                    if (sidebarCompact) setSidebarExpanded(true);
                  }}
                  style={{
                    width: sidebarBtnSize,
                    height: sidebarBtnSize,
                    borderRadius: Math.max(10, Math.round(14 * sidebarScale)),
                    border: `1px solid ${theme.border}`,
                    background: theme.surface,
                    color: theme.text,
                    fontWeight: 800,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto",
                    transition:
                      `width ${motionNormal} ${easeEmphasis}, height ${motionNormal} ${easeEmphasis}, border-radius ${motionNormal} ${easeStandard}, background-color ${motionNormal} ${easeStandard}, border-color ${motionNormal} ${easeStandard}`,
                  }}
                  title="Search friends"
                >
                  <SearchFriendIcon size={Math.max(14, Math.round(18 * sidebarScale))} />
                </button>
              )}
            </div>
            <div
              style={{
                maxHeight: sidebarSearchOpen ? 0 : sidebarBtnSize,
                opacity: sidebarSearchOpen ? 0 : 1,
                transform: sidebarSearchOpen ? "translateY(8px)" : "translateY(0)",
                overflow: "hidden",
                transition: `max-height ${motionNormal} ${easeStandard}, opacity ${motionFast} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}`,
                pointerEvents: sidebarSearchOpen ? "none" : "auto",
              }}
            >
            <button
              onClick={() => {
                if (sidebarCompact && !sidebarIsExpanded) {
                  setSidebarExpanded(true);
                  return;
                }
                const alreadyOpenNotifications =
                  showFriends && sidebarFriendsMode === "notifications";
                if (alreadyOpenNotifications) {
                  setShowFriends(false);
                  if (sidebarCompact) setSidebarExpanded(false);
                  return;
                }
                if (sidebarCompact) setSidebarExpanded(true);
                setShowSettings(false);
                setSidebarFriendsMode("notifications");
                setShowFriends(true);
                setSelectedConversation(null);
                if (sidebarCompact) setSidebarExpanded(false);
              }}
              style={{
                width: sidebarBtnSize,
                height: sidebarBtnSize,
                borderRadius: Math.max(10, Math.round(14 * sidebarScale)),
                border: "none",
                background: showFriends ? `${theme.primary}22` : theme.surface,
                color: showFriends ? theme.primary : theme.text,
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: sidebarSearchOpen ? 0.55 : 1,
                alignSelf: "center",
                transform: sidebarSearchOpen ? "translateY(8px)" : "translateY(0)",
                transition:
                  `opacity ${motionFast} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}, width ${motionNormal} ${easeEmphasis}, height ${motionNormal} ${easeEmphasis}, border-radius ${motionNormal} ${easeStandard}`,
              }}
              title="Notifications"
            >
              <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BellIcon size={Math.max(14, Math.round(19 * sidebarScale))} className={bellRinging ? "bell-ring" : ""} />
                {effectiveNotifCount > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      right: -6,
                      top: -5,
                      minWidth: 13,
                      height: 13,
                      borderRadius: 999,
                      padding: "0 3px",
                      background: theme.badgeBg,
                      color: theme.badgeFg,
                      fontSize: 8,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {effectiveNotifCount > 99 ? "99+" : effectiveNotifCount}
                  </span>
                )}
              </div>
            </button>
            </div>
            <div
              style={{
                maxHeight: sidebarSearchOpen ? 0 : sidebarBtnSize,
                opacity: sidebarSearchOpen ? 0 : 1,
                transform: sidebarSearchOpen ? "translateY(8px)" : "translateY(0)",
                overflow: "hidden",
                transition: `max-height ${motionNormal} ${easeStandard}, opacity ${motionFast} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}`,
                pointerEvents: sidebarSearchOpen ? "none" : "auto",
              }}
            >
            <button
              onClick={() => {
                if (sidebarCompact && !sidebarIsExpanded) {
                  setSidebarExpanded(true);
                  return;
                }
                if (sidebarCompact) setSidebarExpanded(true);
                setShowFriends(false);
                setSidebarFriendsMode("blocked");
                setShowSettings((prev) => {
                  if (!prev) setSelectedConversation(null);
                  return !prev;
                });
                if (sidebarCompact) setSidebarExpanded(false);
              }}
              style={{
                width: sidebarBtnSize,
                height: sidebarBtnSize,
                borderRadius: Math.max(10, Math.round(14 * sidebarScale)),
                border: `1px solid ${theme.border}`,
                background: showSettings ? `${theme.primary}22` : theme.surface,
                color: showSettings ? theme.primary : theme.text,
                fontWeight: 800,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                opacity: sidebarSearchOpen ? 0.55 : 1,
                alignSelf: "center",
                transform: sidebarSearchOpen ? "translateY(8px)" : "translateY(0)",
                transition:
                  `opacity ${motionFast} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}, width ${motionNormal} ${easeEmphasis}, height ${motionNormal} ${easeEmphasis}, border-radius ${motionNormal} ${easeStandard}`,
              }}
              title="Settings"
            >
              <SettingsIcon size={Math.max(14, Math.round(19 * sidebarScale))} />
            </button>
            </div>
            </div>
            </div>
            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 5,
                marginTop: 8,
                marginBottom: sidebarCompact && !sidebarIsExpanded ? 10 : 4,
                order: 3,
                paddingBottom: sidebarCompact && !sidebarIsExpanded ? 2 : 0,
              }}
            >
              <div
                style={{
                  fontSize: Math.max(7, Math.round(9 * sidebarScale)),
                  fontWeight: 900,
                  letterSpacing: 0.35,
                  color: theme.text2,
                  textTransform: "uppercase",
                }}
              >
                ZChat
              </div>
              {connected ? (
                <span
                  className="dot-connected"
                  style={{
                    width: Math.max(8, Math.round(10 * sidebarScale)),
                    height: Math.max(8, Math.round(10 * sidebarScale)),
                    borderRadius: 999,
                    display: "inline-block",
                    background: theme.success,
                    boxShadow: `0 0 10px ${theme.success}`,
                  }}
                  title="Connected"
                />
              ) : (
                <span
                  className="radar-container"
                  style={{
                    width: Math.max(12, Math.round(16 * sidebarScale)),
                    height: Math.max(12, Math.round(16 * sidebarScale)),
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title="Reconnecting"
                >
                  <span className="radar-pulse" style={{ borderColor: theme.danger }} />
                  <span className="radar-pulse" style={{ borderColor: theme.danger }} />
                  <span className="radar-pulse" style={{ borderColor: theme.danger }} />
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
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                overflowY: "auto",
                overflowX: "hidden",
                paddingTop: 6,
                paddingBottom: 6,
                flex: 1,
                order: 2,
                background: `linear-gradient(180deg, ${theme.surface}66 0%, ${theme.surface2}66 100%)`,
                border: `1px solid ${theme.border}`,
                borderRadius: sidebarIsExpanded ? 14 : 12,
                paddingLeft: sidebarIsExpanded ? 6 : 2,
                paddingRight: sidebarIsExpanded ? 6 : 2,
                opacity: sidebarIsExpanded ? 1 : 0.88,
                transform: sidebarIsExpanded ? "translateY(0)" : "translateY(2px)",
                transition: `opacity ${motionNormal} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}`,
              }}
            >
              {sidebarSearchOpen && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 6px 0",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      color: theme.text3,
                      textTransform: "uppercase",
                      letterSpacing: 0.45,
                      textAlign: "center",
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    Friends
                    {contactsBadgeCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          right: -4,
                          top: -6,
                          minWidth: 14,
                          height: 14,
                          borderRadius: 999,
                          padding: "0 4px",
                          background: theme.badgeBg,
                          color: theme.badgeFg,
                          fontSize: 9,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: 1,
                        }}
                      >
                        {contactsBadgeCount > 99 ? "99+" : contactsBadgeCount}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      height: 1,
                      width: "100%",
                      background: `linear-gradient(90deg, ${theme.border} 0%, ${theme.primary}55 50%, ${theme.border} 100%)`,
                      borderRadius: 999,
                    }}
                  />
                </div>
              )}
              {!sidebarSearchOpen && sidebarIsExpanded && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    padding: "2px 6px 0",
                  }}
                >
                  <button
                    onClick={() => setSidebarFriendsFocus((p) => !p)}
                    style={{
                      border: "none",
                      background: "transparent",
                      padding: 0,
                      textAlign: "center",
                      cursor: "pointer",
                      fontSize: 10,
                      fontWeight: 800,
                      color: sidebarFriendsFocus ? theme.primary : theme.text3,
                      textTransform: "uppercase",
                      letterSpacing: 0.45,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    Friends
                    {contactsBadgeCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          right: -4,
                          top: -6,
                          minWidth: 14,
                          height: 14,
                          borderRadius: 999,
                          padding: "0 4px",
                          background: theme.badgeBg,
                          color: theme.badgeFg,
                          fontSize: 9,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: 1,
                        }}
                      >
                        {contactsBadgeCount > 99 ? "99+" : contactsBadgeCount}
                      </span>
                    )}
                  </button>
                  <div
                    style={{
                      height: 1,
                      width: "100%",
                      background: `linear-gradient(90deg, ${theme.border} 0%, ${
                        sidebarFriendsFocus ? theme.primary : `${theme.primary}55`
                      } 50%, ${theme.border} 100%)`,
                      borderRadius: 999,
                    }}
                  />
                </div>
              )}
              {!sidebarSearchOpen && !sidebarIsExpanded && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 0 0",
                    width: "100%",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: "100%",
                    }}
                  >
                    <FriendsIcon size={Math.max(14, Math.round(16 * sidebarScale))} style={{ color: theme.text3 }} />
                    {contactsBadgeCount > 0 && (
                      <span
                        style={{
                          position: "absolute",
                          right: -4,
                          top: -5,
                          minWidth: 13,
                          height: 13,
                          borderRadius: 999,
                          padding: "0 3px",
                          background: theme.badgeBg,
                          color: theme.badgeFg,
                          fontSize: 8,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          lineHeight: 1,
                        }}
                      >
                        {contactsBadgeCount > 99 ? "99+" : contactsBadgeCount}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      height: 1,
                      width: "80%",
                      background: `linear-gradient(90deg, transparent 0%, ${theme.primary}44 50%, transparent 100%)`,
                      borderRadius: 999,
                    }}
                  />
                </div>
              )}
              {visibleSidebarItems.length === 0 && sidebarSearch.trim().length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: "24px 8px",
                      gap: 10,
                      opacity: 0.7,
                    }}
                  >
                    <UserNotFoundIcon size={32} style={{ color: theme.text3 }} />
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: theme.text3,
                        textAlign: "center",
                      }}
                    >
                      User not found
                    </div>
                  </div>
                ) : visibleSidebarItems.map((c) => {
                  const hasUnseenMsg = sidebarUnseenMsgs[c.id] || false;
                  return (
                  <button
                    key={c.id}
                    onClick={async () => {
                      if (sidebarCompact && !sidebarIsExpanded) {
                        setSidebarExpanded(true);
                        return;
                      }
                      setShowFriends(false);
                      setShowSettings(false);
                      if (c.isContact) {
                        setStartingChat(true);
                        setSelectedConversation(c.id);
                        setSidebarUnseenMsgs((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
                        // Fire-and-forget: ensure chat exists in background
                        ensureChatExists(c.id)
                          .then(() => fetchConversations())
                          .catch(() => handleStartChat({ id: c.id, username: c.username }).catch(() => {}))
                          .finally(() => setStartingChat(false));
                      } else {
                        const conv = conversations.find(
                          (x) => x.conversation_id === c.id || x.otherUser?.id === c.id,
                        );
                        const peerId = conv?.otherUser?.id || (isHexUserId(c.id) || isUUID(c.id) ? c.id : null);
                        // Set conversation immediately — don't wait for ensureChatExists
                        setSelectedConversation((prev) => (prev === c.id ? null : c.id));
                        setSidebarUnseenMsgs((prev) => { const n = { ...prev }; delete n[c.id]; return n; });
                        // Ensure chat exists in background
                        if (peerId) ensureChatExists(peerId).catch(() => {});
                      }
                      if (sidebarCompact) setSidebarExpanded(false);
                    }}
                    style={{
                      width: sidebarIsExpanded ? "100%" : sidebarBtnSize,
                      minWidth: sidebarIsExpanded ? undefined : sidebarBtnSize,
                      maxWidth: sidebarIsExpanded ? undefined : sidebarBtnSize,
                      height: sidebarBtnSize,
                      alignSelf: "center",
                      borderRadius: Math.max(10, Math.round(14 * sidebarScale)),
                      border:
                        !sidebarIsExpanded
                          ? "none"
                          : selectedConversation === c.id && !c.isContact
                          ? `1px solid ${theme.primary}`
                          : `1px solid ${theme.border}`,
                      background:
                        !sidebarIsExpanded
                          ? "transparent"
                          : selectedConversation === c.id && !c.isContact
                          ? `${theme.primary}22`
                          : theme.surface,
                      color: theme.text,
                      fontSize: sidebarIsExpanded ? 11 : Math.max(9, Math.round(10 * sidebarScale)),
                      fontWeight: 800,
                      cursor: "pointer",
                      overflow: sidebarIsExpanded ? "hidden" : "visible",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      padding: sidebarIsExpanded ? "0 12px" : 0,
                      letterSpacing: 0.2,
                      textAlign: sidebarIsExpanded ? "left" : "center",
                      transition:
                        `width ${motionNormal} ${easeEmphasis}, height ${motionNormal} ${easeEmphasis}, padding ${motionNormal} ${easeStandard}, border-radius ${motionNormal} ${easeStandard}, background-color ${motionNormal} ${easeStandard}, border-color ${motionNormal} ${easeStandard}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                    }}
                    title={c.username}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: sidebarIsExpanded ? 8 : 0,
                        width: "100%",
                        justifyContent:
                          sidebarIsExpanded
                            ? "flex-start"
                            : "center",
                        transition: `gap ${motionNormal} ${easeStandard}, justify-content ${motionNormal} ${easeStandard}`,
                      }}
                    >
                      {!sidebarIsExpanded && (
                        <span
                          style={{
                            position: "relative",
                            width: Math.max(20, Math.round(sidebarBtnSize * 0.5)),
                            height: Math.max(20, Math.round(sidebarBtnSize * 0.5)),
                            borderRadius: "50%",
                            background: "rgba(0,0,0,0.46)",
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: Math.max(10, Math.round(12 * sidebarScale)),
                            fontWeight: 900,
                            letterSpacing: 0.2,
                            textShadow: "0 0 8px rgba(255,255,255,0.25)",
                            boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
                            flexShrink: 0,
                          }}
                        >
                          {(c.username || "?").slice(0, 1).toUpperCase()}
                          {hasUnseenMsg && (
                            <span
                              style={{
                                position: "absolute",
                                top: -3,
                                right: -3,
                                minWidth: 12,
                                height: 12,
                                borderRadius: 999,
                                padding: "0 3px",
                                background: theme.primary,
                                color: theme.primaryFg,
                                fontSize: 7,
                                fontWeight: 800,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                lineHeight: 1,
                                boxShadow: `0 0 6px ${theme.primaryGlow}`,
                              }}
                            >
                              !
                            </span>
                          )}
                        </span>
                      )}
                      {sidebarIsExpanded && (
                        <>
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              paddingLeft: 2,
                              position: "relative",
                            }}
                          >
                            {c.username || "Unknown"}
                          </span>
                          {hasUnseenMsg && (
                            <span
                              style={{
                                position: "absolute",
                                top: 6,
                                right: 8,
                                minWidth: 14,
                                height: 14,
                                borderRadius: 999,
                                padding: "0 3px",
                                background: theme.primary,
                                color: theme.primaryFg,
                                fontSize: 8,
                                fontWeight: 800,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                lineHeight: 1,
                                boxShadow: `0 0 6px ${theme.primaryGlow}`,
                              }}
                            >
                              !
                            </span>
                          )}
                          {(sidebarIsExpanded || sidebarFriendsFocus) && contactPresenceMap[c.id] && (
                            <span
                              style={{
                                position: "absolute",
                                top: 6,
                                left: 8,
                                width: 8,
                                height: 8,
                                borderRadius: 999,
                                background: theme.success,
                                boxShadow: `0 0 8px ${theme.successGlow}`,
                                border: "1px solid rgba(0,0,0,0.25)",
                              }}
                            />
                          )}
                        </>
                      )}
                    </span>
                  </button>
                );})}
            </div>

            {sidebarCompact && !sidebarIsExpanded && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.2)",
                  pointerEvents: "none",
                  zIndex: 8,
                  borderRadius: 0,
                }}
              />
            )}

          </div>
        )}
        <div
          className="section-fade"
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            position: "relative",
            paddingBottom: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              flexDirection: "column",
              transition: `opacity ${motionNormal} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}`,
              opacity: (layoutName === "sidebar" && (sidebarCompact && sidebarIsExpanded || sidebarFriendsFocus)) || (layoutName === "modal" && selectedConversation) ? 0 : 1,
              transform:
                (layoutName === "sidebar" && (sidebarCompact && sidebarIsExpanded || sidebarFriendsFocus)) || (layoutName === "modal" && selectedConversation)
                  ? "translateX(20px) scale(0.985)"
                  : "translateX(0) scale(1)",
              pointerEvents:
                (layoutName === "sidebar" && (sidebarCompact && sidebarIsExpanded || sidebarFriendsFocus)) || (layoutName === "modal" && selectedConversation)
                  ? "none"
                  : "auto",
            }}
          >
          <AppHeader
            onFriendsClick={handleFriendsClick}
            onSettingsClick={() => {
              if (layoutName === "telegram") {
                setTelegramTab("settings");
                setSelectedConversation(null);
                setShowFriends(false);
                setShowSettings(false);
                return;
              }
              setShowSettings(true);
            }}
            notifCount={effectiveNotifCount}
            connected={connected}
            showActionButtons={layoutName !== "sidebar"}
          />

          {layoutName === "sidebar" ? (
            showSettings ? (
              <Settings
                embedded
                onClose={() => setShowSettings(false)}
                onKeysReady={handleKeysReady}
                currentPrivateKey={privateKey}
                userProfile={userProfile}
                onUserProfileUpdate={setUserProfile}
                onThemeClick={() => setShowThemePicker(true)}
                onBlockedListClick={() => {
                  setShowSettings(false);
                  setSidebarFriendsMode("blocked");
                  setShowFriends(true);
                }}
              />
            ) : showFriends ? (
              <Friends
                embedded
                onClose={() => setShowFriends(false)}
                  onStartChat={handleStartChat}
                  masterKeyLoaded={!!ecdhPrivateKey}
                  startingChat={startingChat}
                  liveVersion={friendListVersion}
                  privateKey={privateKey}
                  ecdhPrivateKey={ecdhPrivateKey}
                  userPublicKey={userProfile?.public_key}
                  onlyTabs={sidebarFriendsMode === "blocked" ? ["blocked"] : ["received", "sent"]}
                  hideSearch={sidebarFriendsMode !== "blocked"}
                  customTitle="Notification"
                  onBadgeChange={(newBadges, headerCount) => {
                    const reqOnlyCount = (newBadges?.received ? 1 : 0) + (newBadges?.sent ? 1 : 0);
                    setNotifBadges(newBadges);
                    setNotifCount(reqOnlyCount);
                  }}
                />
            ) : !selectedConversation ? (
              layoutName === "sidebar" && sidebarSearchOpen ? (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    position: "relative",
                    overflow: "hidden",
                    gap: 24,
                  }}
                >
                  {/* Orbiting magnifying glass - ABOVE the hint */}
                  <div
                    className="sidebar-search-magnify-orbit"
                    style={{
                      width: 120,
                      height: 120,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <div
                      className="sidebar-search-magnify-tilt"
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: "50%",
                        background: `${theme.primary}18`,
                        border: `2px solid ${theme.primary}44`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        boxShadow: `0 0 24px ${theme.primaryGlow}`,
                      }}
                    >
                      <SearchIcon size={28} style={{ color: theme.primary }} />
                    </div>
                  </div>
                  {/* Hint text - BELOW the magnifier */}
                  <div
                    style={{
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        color: theme.text3,
                        fontSize: 14,
                        fontWeight: 600,
                        letterSpacing: 0.15,
                        marginBottom: 4,
                      }}
                    >
                      Searching...
                    </div>
                    <div
                      style={{
                        color: theme.text3,
                        fontSize: 11,
                        opacity: 0.6,
                      }}
                    >
                      Type a name or paste a user ID
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                <div style={{ textAlign: "center" }}>
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      borderRadius: 16,
                      margin: "0 auto 10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: `${theme.primary}22`,
                      color: theme.primary,
                      boxShadow: `0 0 14px ${theme.primaryGlow}`,
                    }}
                  >
                    <ChatIcon size={24} />
                  </div>
                  <div
                    style={{
                      color: theme.text3,
                      fontSize: 13,
                      fontWeight: 600,
                      letterSpacing: 0.15,
                    }}
                  >
                    Select a chat to start messaging
                  </div>
                  {layoutName === "sidebar" && (
                    <div
                      style={{
                        color: theme.text3,
                        fontSize: 11,
                        textAlign: "center",
                        lineHeight: 1.5,
                        maxWidth: 240,
                        opacity: 0.7,
                      }}
                    >
                      or tap the <span style={{ display: "inline-flex", verticalAlign: "middle", margin: "0 2px" }}><SearchFriendIcon size={14} style={{ color: theme.primary }} /></span> icon to add a friend by ID
                    </div>
                  )}
                </div>
              </div>
            )) : (
              <div
                style={{
                  flex: 1,
                  minHeight: 0,
                  minWidth: 0,
                  display: "flex",
                  position: "relative",
                  overflow: "hidden",
                  opacity: sidebarCompact && sidebarIsExpanded ? 0.35 : 1,
                  transform:
                    sidebarCompact && sidebarIsExpanded
                      ? "translateX(20px) scale(0.985)"
                      : "translateX(0) scale(1)",
                  transition:
                    `opacity ${motionNormal} ${easeStandard}, transform ${motionNormal} ${easeEmphasis}`,
                  pointerEvents: (sidebarCompact && sidebarIsExpanded) || !rightPanelReady ? "none" : "auto",
                  filter: sidebarCompact && sidebarIsExpanded ? "blur(2px)" : "none",
                }}
              >
                {sidebarCompact && sidebarIsExpanded && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 9999,
                      background: "rgba(0, 0, 0, 0.22)",
                      pointerEvents: "auto",
                      touchAction: "none",
                    }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setRightPanelReady(false);
                      setSidebarExpanded(false);
                      setSidebarSearchOpen(false);
                      setTimeout(() => setRightPanelReady(true), 300);
                    }}
                  >
                    <div
                      className="sidebar-focus-nav-icon"
                      aria-hidden
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        zIndex: 10,
                        pointerEvents: "none",
                      }}
                    >
                      <span className="line line-1" />
                      <span className="line line-2" />
                      <span className="line line-3" />
                    </div>
                  </div>
                )}
                <Chat
                  key={`sidebar-chat-${selectedFriendId || selectedConversation}`}
                  conversationId={selectedFriendId || selectedConversation}
                  user={user}
                  otherUser={
                    selectedConvData
                      ? {
                          id: selectedConvData.other_user_id,
                          username: selectedConvData.other_username,
                          publicKey: selectedConvData.other_public_key || null,
                        }
                      : null
                  }
                  ecdhPrivateKey={ecdhPrivateKey}
                  hasUnread={(unreadCounts[selectedConversation] || 0) > 0}
                  onBadgeClear={() => {
                    setUnreadCounts((prev) => {
                      const n = { ...prev };
                      delete n[selectedConversation];
                      return n;
                    });
                  }}
                  embedded
                  onClose={() => {
                    setSelectedConversation(null);
                    setSidebarUnseenMsgs((prev) => { const n = { ...prev }; delete n[selectedFriendId || selectedConversation]; return n; });
                    setUnreadCounts((prev) => {
                      const n = { ...prev };
                      delete n[selectedConversation];
                      return n;
                    });
                    fetchConversations();
                  }}
                />
              </div>
            )
          ) : layoutName === "telegram" ? (
            telegramTab === "contacts" ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                {telegramSectionHeader("Friends")}
                <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 0", paddingBottom: TELEGRAM_NAV_BOTTOM_PAD }}>
                  <div
                    style={{
                      position: "relative",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    {telegramContactStatus.text && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "calc(100% + 6px)",
                          left: 0,
                          background: theme.surface,
                          border: `1px solid ${telegramContactStatus.ok ? theme.success : theme.danger}`,
                          color: telegramContactStatus.ok ? theme.success : theme.danger,
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
                        {telegramContactStatus.text}
                      </div>
                    )}
                    <input
                      value={telegramContactQuery}
                      onChange={(e) => {
                        setTelegramContactQuery(e.target.value);
                        setTelegramContactStatus({ text: "", ok: false });
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        if (canSendTelegramRequest) {
                          handleTelegramSendRequest();
                        }
                      }}
                      placeholder="Search friends or paste user ID"
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: `1.5px solid ${theme.inputBorder}`,
                        background: theme.inputBg,
                        color: theme.text,
                        fontSize: 14,
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={handleTelegramSendRequest}
                      disabled={telegramContactLoading || !canSendTelegramRequest}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 12,
                        background: canSendTelegramRequest ? theme.primary : theme.surface2,
                        color: canSendTelegramRequest ? theme.primaryFg : theme.text3,
                        border: "none",
                        cursor: canSendTelegramRequest ? "pointer" : "default",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 900,
                        fontSize: 18,
                        boxShadow: canSendTelegramRequest ? `0 0 12px ${theme.primaryGlow}` : "none",
                      }}
                      title="Send friend request"
                    >
                      {telegramContactLoading ? "…" : "+"}
                    </button>
                  </div>
                {filteredTelegramContacts.length === 0 ? (
                  <div style={{ color: theme.text3, fontSize: 13, textAlign: "center", marginTop: 28 }}>
                    No friends yet.
                  </div>
                ) : (
                  filteredTelegramContacts.map((c) => (
                    <div
                      key={c.id}
                      data-tg-contact-menu="1"
                      style={{
                        width: "100%",
                        border: `1px solid ${theme.border}`,
                        background: theme.surface2,
                        color: theme.text,
                        borderRadius: 12,
                        padding: "10px 12px",
                        marginBottom: 8,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 10,
                        position: "relative",
                        zIndex: telegramContactMenuOpen === c.id ? 60 : 1,
                        animation: "msgAppear 0.18s cubic-bezier(0.22,1,0.36,1) both",
                      }}
                    >
                      <button
                        onClick={() => {
                          setTelegramTab("chats");
                          setSelectedConversation(c.id);
                          setTelegramContactMenuOpen(null);
                        }}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: theme.text,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          minWidth: 0,
                          flex: 1,
                          textAlign: "left",
                        }}
                      >
                        <span
                          style={{
                            width: 28,
                            height: 28,
                            borderRadius: 999,
                            background: `${theme.primary}22`,
                            color: theme.primary,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 12,
                            fontWeight: 800,
                            flexShrink: 0,
                          }}
                        >
                          {String(c.username || "?").slice(0, 1).toUpperCase()}
                        </span>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontWeight: 700,
                          }}
                        >
                          {c.username || "Unknown"}
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          setTelegramContactMenuOpen((p) => (p === c.id ? null : c.id))
                        }
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          border: `1px solid ${theme.border}`,
                          background: theme.surface,
                          color: theme.text2,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                        title="More"
                      >
                        <MenuDotsIcon size={15} />
                      </button>
                      {telegramContactMenuOpen === c.id && (
                        <div
                          className="dropdown-enter app-menu"
                          style={{
                            position: "absolute",
                            right: 8,
                            top: "calc(100% + 6px)",
                            width: 220,
                            background: theme.surface,
                            border: `1px solid ${theme.border}`,
                            borderRadius: 16,
                            boxShadow: "0 14px 34px rgba(0,0,0,0.3)",
                            zIndex: 80,
                            overflow: "hidden",
                            padding: 6,
                          }}
                        >
                          {[
                            {
                              label: "Start chat",
                              action: () => handleStartChat({ id: c.id, username: c.username }),
                              icon: <ChatIcon size={15} />,
                            },
                            {
                              label: "Delete chat for me",
                              action: () => handleDeleteConvForMe(c.id),
                              icon: <TrashIcon size={15} />,
                            },
                            {
                              label: "Delete chat for everyone",
                              action: () => handleDeleteConvForAll(c.id),
                              icon: <TrashIcon size={15} style={{ color: theme.danger }} />,
                            },
                            {
                              label: "Unfriend",
                              action: () => handleUnfriend(c.id, c.id),
                              icon: <UserMinusIcon size={15} style={{ color: theme.danger }} />,
                            },
                            {
                              label: "Block",
                              action: () =>
                                handleBlockConversation({
                                  conversation_id: c.id,
                                  otherUser: { id: c.id, username: c.username },
                                }),
                              icon: <BlockIcon size={15} style={{ color: theme.danger }} />,
                            },
                          ].map((item) => (
                            <button
                              key={item.label}
                              className="app-menu-item"
                              onClick={async () => {
                                setTelegramContactMenuOpen(null);
                                await item.action();
                                if (item.label === "Start chat") {
                                  setTelegramTab("chats");
                                }
                              }}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                border: "none",
                                background: "transparent",
                                color: theme.text,
                                fontSize: 13,
                                fontWeight: 700,
                                padding: "11px 10px",
                                cursor: "pointer",
                                borderRadius: 12,
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <span style={{ width: 18, display: "inline-flex", justifyContent: "center" }}>
                                {item.icon}
                              </span>
                              <span>{item.label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
                </div>
              </div>
            ) : telegramTab === "notifications" ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, paddingBottom: TELEGRAM_NAV_BOTTOM_PAD }}>
                {telegramSectionHeader("Notifications")}
                <Friends
                  embedded
                  onlyTabs={["received", "sent"]}
                  hideTitle
                  hideSearch
                  onClose={() => setTelegramTab("chats")}
                  onStartChat={handleStartChat}
                  masterKeyLoaded={!!ecdhPrivateKey}
                  startingChat={startingChat}
                  liveVersion={friendListVersion}
                  privateKey={privateKey}
                  ecdhPrivateKey={ecdhPrivateKey}
                  userPublicKey={userProfile?.public_key}
                  onBadgeChange={(newBadges, headerCount) => {
                    const reqOnlyCount = (newBadges?.received ? 1 : 0) + (newBadges?.sent ? 1 : 0);
                    setNotifBadges(newBadges);
                    setNotifCount(reqOnlyCount);
                  }}
                />
              </div>
            ) : telegramTab === "chats" ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
                {telegramSectionHeader("Chats")}
                <div style={{ flex: 1, minHeight: 0, paddingBottom: TELEGRAM_NAV_BOTTOM_PAD }}>
                  <ConversationList
                    theme={theme}
                    conversations={conversations}
                    convLoading={convLoading}
                    unreadCounts={unreadCounts}
                    lastMessages={lastMessages}
                    userId={user?.id}
                    menuOpenFor={menuOpenFor}
                    onMenuOpenChange={setMenuOpenFor}
                    onOpenConversation={openConversation}
                    onOpenFriends={() => setTelegramTab("contacts")}
                    onDeleteForMe={handleDeleteConvForMe}
                    onDeleteForAll={handleDeleteConvForAll}
                    onUnfriend={handleUnfriend}
                    onBlock={handleBlockConversation}
                  />
                </div>
              </div>
            ) : telegramTab === "settings" ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
                {telegramSectionHeader("Settings")}
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: TELEGRAM_NAV_BOTTOM_PAD }}>
                  <Settings
                    embedded
                    embeddedScroll={false}
                    hideTitle
                    onClose={() => setTelegramTab("chats")}
                    onKeysReady={handleKeysReady}
                    currentPrivateKey={privateKey}
                    userProfile={userProfile}
                    onUserProfileUpdate={setUserProfile}
                    onThemeClick={() => {
                      setShowThemePicker(true);
                    }}
                  />
                </div>
              </div>
            ) : null
          ) : (
            <ConversationList
              theme={theme}
              conversations={conversations}
              convLoading={convLoading}
              unreadCounts={unreadCounts}
              lastMessages={lastMessages}
              userId={user?.id}
              menuOpenFor={menuOpenFor}
              onMenuOpenChange={setMenuOpenFor}
              onOpenConversation={openConversation}
              onOpenFriends={handleFriendsClick}
              onDeleteForMe={handleDeleteConvForMe}
              onDeleteForAll={handleDeleteConvForAll}
              onUnfriend={handleUnfriend}
              onBlock={handleBlockConversation}
            />
          )}
          {layoutName === "telegram" && bottomNav}
          </div>
        </div>

          {layoutName === "modal" && showSettings && !appLocked && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
              }}
            >
              <Settings
                embedded={false}
                onClose={() => {
                  setShowSettings(false);
                }}
                onKeysReady={handleKeysReady}
                currentPrivateKey={privateKey}
                userProfile={userProfile}
                onUserProfileUpdate={setUserProfile}
                onThemeClick={() => {
                  setShowThemePicker(true);
                }}
              />
            </div>
          )}
          {layoutName === "modal" && showFriends && !appLocked && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 50,
              }}
            >
              <Friends
                embedded={false}
                onClose={() => {
                  setShowFriends(false);
                }}
                onStartChat={handleStartChat}
                masterKeyLoaded={!!ecdhPrivateKey}
                startingChat={startingChat}
                liveVersion={friendListVersion}
                privateKey={privateKey}
                ecdhPrivateKey={ecdhPrivateKey}
                userPublicKey={userProfile?.public_key}
                onBadgeChange={(newBadges, headerCount) => {
                  const reqOnlyCount = (newBadges?.received ? 1 : 0) + (newBadges?.sent ? 1 : 0);
                  setNotifBadges(newBadges);
                  setNotifCount(reqOnlyCount);
                }}
              />
            </div>
          )}
        {layoutName === "modal" && showThemePicker && !appLocked && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 220,
            }}
          >
            <ThemePicker onClose={() => setShowThemePicker(false)} />
          </div>
        )}
        {layoutName !== "modal" && showThemePicker && !appLocked && (
          <ThemePicker onClose={() => setShowThemePicker(false)} />
        )}
        {!appLocked && selectedConversation && layoutName !== "sidebar" &&
          (() => {
            const convData = selectedConvData;
            const friendId = selectedFriendId;

            return (
              <div
                style={{
                  position: layoutName === "modal" ? "absolute" : "fixed",
                  inset: 0,
                  zIndex: 120,
                  opacity:
                    layoutName === "sidebar" && sidebarCompact && sidebarIsExpanded
                      ? 0
                      : 1,
                  transform:
                    layoutName === "sidebar" && sidebarCompact && sidebarIsExpanded
                      ? "translateX(20px) scale(0.985)"
                      : "translateX(0) scale(1)",
                  transition:
                    "opacity 0.22s ease, transform 0.24s cubic-bezier(0.22,1,0.36,1)",
                  pointerEvents:
                    layoutName === "sidebar" && sidebarCompact && sidebarIsExpanded
                      ? "none"
                      : "auto",
                  background: theme.surface,
                }}
              >
                <Chat
                  key={`main-chat-${friendId || selectedConversation}`}
                  conversationId={friendId || selectedConversation}
                  user={user}
                  otherUser={
                    convData
                      ? {
                          id: convData.other_user_id,
                          username: convData.other_username,
                          publicKey: convData.other_public_key || null,
                        }
                      : null
                  }
                  ecdhPrivateKey={ecdhPrivateKey}
                  hasUnread={(unreadCounts[selectedConversation] || 0) > 0}
                  onBadgeClear={() => {
                    setUnreadCounts((prev) => {
                      const n = { ...prev };
                      delete n[selectedConversation];
                      return n;
                    });
                  }}
                  embedded={layoutName === "sidebar"}
                  fullView={layoutName === "modal"}
                  onClose={() => {
                    setSelectedConversation(null);
                    if (layoutName === "telegram") setTelegramTab("chats");
                    setUnreadCounts((prev) => {
                      const n = { ...prev };
                      delete n[selectedConversation];
                      return n;
                    });
                    fetchConversations();
                  }}
                />
              </div>
            );
          })()}
        {appLocked && user?.id && (
          <AppLockOverlay
            userId={user.id}
            onUnlock={handleUnlock}
            onLogout={handleLockLogout}
          />
        )}
      </div>
    </div>
  );
};

export default App;
