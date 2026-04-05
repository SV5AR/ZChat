import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
const TextDecoder = globalThis.TextDecoder;
const TextEncoder = globalThis.TextEncoder;
import { supabase } from "../supabaseClient";
import { useTheme } from "../context/ThemeContext";
import {
  BackIcon,
  MenuDotsIcon,
  TrashIcon,
  UserMinusIcon,
  BlockIcon,
  SendIcon,
  TickSentIcon,
  TickDeliveredIcon,
  TickSeenIcon,
  CheckIcon,
  CloseIcon,
  PenIcon,
  PlusIcon,
  CheckSquareIcon,
  DotsIcon,
  LockIcon,
  ReplyArrowIcon,
} from "./Icons";
import {
  getConversationKey,
  getRatchetState,
  createRatchetState,
  encryptWithRatchet,
  decryptWithRatchet,
} from "../utils/ratchetManager";
import { deriveSharedKeyNaCl, decryptWithNaCl } from "../utils/crypto";
import {
  getChatsForUser,
  getMessagesWithFriend,
  sendMessageToFriend,
  editMessageById,
  deleteMessageById,
  hideChatForMe,
  deleteChatForEveryone,
  hideMessageForMe,
  markMessagesReadForFriend,
  getMessageReactions,
  clearOwnReaction,
  upsertReaction,
  getFriendshipBetween,
  removeFriendship,
  blockUser,
  getProfile,
} from "../lib/schemaApi";
import {
  loadCustomReactions,
  saveCustomReactions,
} from "../utils/metadataStore";
import { cacheGet, cacheSet, cacheClearByPrefix } from "../utils/cache";

const DEFAULT_REACTIONS = ["❤️", "👍", "😂", "😮", "😢"];

// ── Module-level caches
// Conversation messages are stored centrally on window._sessionCache.convMessages
// Module keeps only small per-conversation metadata and reaction cache.
const _reactCache = {}; // { conversationId: reactionsMap }
const _convMetaCache = {}; // { conversationId: { otherUser } }
const _scrollCache = {}; // { conversationId: scrollTop } — restore position on reopen
const _convLoaded = new Set(); // Track conversationIds that have been successfully loaded

// Helpers to access the authoritative in-memory conv message cache
function _getConvMsgs(convId) {
  return window._sessionCache?.convMessages?.[convId] || [];
}
function _setConvMsgs(convId, arr) {
  if (!window._sessionCache) window._sessionCache = {};
  if (!window._sessionCache.convMessages) window._sessionCache.convMessages = {};
  if (arr === undefined || arr === null) {
    delete window._sessionCache.convMessages[convId];
  } else {
    window._sessionCache.convMessages[convId] = arr;
  }
}

function isValidRootKey(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || ""));
}

function getRootKeyFromStorage(fallback = "") {
  const stored = sessionStorage.getItem("userPrivateKey") || "";
  if (isValidRootKey(stored)) return stored;
  if (isValidRootKey(fallback)) return fallback;
  return "";
}

function convMsgCacheKey(uid, convId) {
  return `conv_msgs_${String(uid || "").trim().toLowerCase()}_${convId}`;
}

function convReactCacheKey(uid, convId) {
  return `conv_reactions_${String(uid || "").trim().toLowerCase()}_${convId}`;
}

function clearChatPersistentCache(uid, convId) {
  const userId = String(uid || "").trim().toLowerCase();
  const chatId = String(convId || "").trim().toLowerCase();
  if (!userId || !chatId) return;
  cacheClearByPrefix(convMsgCacheKey(userId, chatId));
  cacheClearByPrefix(convReactCacheKey(userId, chatId));
}

function formatDateLabel(date) {
  const d = new Date(date);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - msgDay) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "long", day: "numeric" }
      : { month: "long", day: "numeric", year: "numeric" },
  );
}

const InlinePopup = ({ isMine, children }) => (
  <div style={{ width: "100%", marginBottom: 4, flexShrink: 0 }}>
    <div
      style={{
        display: "flex",
        justifyContent: isMine ? "flex-end" : "flex-start",
        animation: "floatInUp 0.18s cubic-bezier(0.22,1,0.36,1) both",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  </div>
);

const Chat = ({
  conversationId,
  user,
  otherUser: initialOtherUser,
  onClose,
  hasUnread = false,
  onBadgeClear,
  onFriendListRefresh,
  ecdhPrivateKey,
  embedded = false,
  fullView = false,
}) => {
  const isLikelyUserId = (v) => {
    const s = String(v || "").trim();
    return /^[0-9a-f]{64}$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  };
  const { theme } = useTheme();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [otherUser, setOtherUser] = useState(initialOtherUser || null);
  const [status, setStatus] = useState("");
  const [initialising, setInitialising] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [rtSubscribed, setRtSubscribed] = useState(false);
  const [replyTarget, setReplyTarget] = useState(null);
  const initTimeoutRef = useRef(null);

  useEffect(() => {
    if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
    return () => {
      if (initTimeoutRef.current) clearTimeout(initTimeoutRef.current);
    };
  }, [conversationId]);
  const [reactions, setReactions] = useState({});
  const [emojiEditorError, setEmojiEditorError] = useState("");
  const inputBarRef = useRef(null);
  // Popup state: { type: "reaction"|"menu", msgId } — inline in message flow
  const [popup, setPopup] = useState(null); // { type, msgId }
  const [popupRect, setPopupRect] = useState(null); // DOMRect of the original bubble
  const [popupPhase, setPopupPhase] = useState(null); // "opening" | "open" | "closing"
  const [customReactions, setCustomReactions] = useState(DEFAULT_REACTIONS);
  const [showEmojiEditor, setShowEmojiEditor] = useState(false); // full emoji picker
  const [showAddEmoji, setShowAddEmoji] = useState(null); // { msgId } for adding reaction
  const [editingSlot, setEditingSlot] = useState(null); // index 0-4 being edited
  const [showMenu, setShowMenu] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState("");
  const [confirmUnfriend, setConfirmUnfriend] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMsgs, setSelectedMsgs] = useState(new Set());
  const [editingMsg, setEditingMsg] = useState(null);
  const [editInput, setEditInput] = useState("");
  const [conversationClosed, setConversationClosed] = useState(false);
  const [closeCountdown, setCloseCountdown] = useState(3);
  const [inputDir, setInputDir] = useState("auto");
  const bottomRef = useRef(null);
  const countdownRef = useRef(null);
  const msgsContainerRef = useRef(null);
  const messagesLenRef = useRef(0);
  const loadMessagesRef = useRef(null);
  const loadReactionsRef = useRef(null);
  const loadMessagesQueueRef = useRef(Promise.resolve());
  const outboxQueueRef = useRef([]);
  const outboxPlainByClientRef = useRef(new Map());
  const incomingEventQueueRef = useRef(Promise.resolve());
  const processedIncomingRef = useRef(new Set());
  const failedDecryptAtRef = useRef(new Map());
  // Reaction pending guard: Map<"msgId:emoji", { type: "add"|"remove", resolved: boolean }>
  const reactionPendingRef = useRef(new Map());
  // Desired state: Map<"msgId:emoji", true|false> — tracks whether the user wants this reaction
  const reactionDesiredRef = useRef(new Map());
  const reactionBusyRef = useRef(false);
  const outboxBusyRef = useRef(false);
  const cardRef = useRef(null);
  const msgRefs = useRef({});
  const userIdRef = useRef(user?.id);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  useEffect(() => {
    messagesLenRef.current = messages.length;
  }, [messages.length]);

  const decodeReactionEmoji = useCallback(
    async (rawEmoji) => {
      let emoji = rawEmoji;
      if (typeof emoji !== "string") return "";
      const trimmed = emoji.trim();
      if (!trimmed.startsWith("{")) return emoji;
      try {
        const parsed = JSON.parse(trimmed);
        if (
          parsed?.v === 1 &&
          parsed?.c &&
          ecdhPrivateKey &&
          otherUser?.publicKey
        ) {
          const sharedHex = await deriveSharedKeyNaCl(
            ecdhPrivateKey,
            String(otherUser.publicKey),
          );
          const dec = sharedHex
            ? await decryptWithNaCl(parsed.c, sharedHex)
            : null;
          if (dec) emoji = dec;
        }
      } catch {
        // Keep raw value when parse/decrypt fails.
      }
      return emoji;
    },
    [ecdhPrivateKey, otherUser?.publicKey],
  );

  useEffect(() => {
    let mounted = true;
    loadCustomReactions(DEFAULT_REACTIONS)
      .then((stored) => {
        if (!mounted || !Array.isArray(stored)) return;
        const unique = [...new Set(stored)].slice(0, 5);
        while (unique.length < 5) unique.push(DEFAULT_REACTIONS[unique.length]);
        setCustomReactions(unique);
      })
      .catch(() => {
        if (mounted) setCustomReactions(DEFAULT_REACTIONS);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // ── Init: use passed props for instant open ─────────────────────────────────
  useEffect(() => {
    let cancelled = false;
          const currentConvId = conversationId;
          const peerTargetId = otherUser?.id || currentConvId;

    const init = async () => {
      if (!user?.id || !currentConvId) {
        if (!cancelled) {
          setStatus("");
          setInitialising(false);
        }
        return;
      }

      // Fast path: use passed props directly
      if (initialOtherUser) {
        // init: fast path (log removed)
        if (cancelled) return;
        setOtherUser(initialOtherUser);

        // Verify this conversation still exists in DB (handles deleted/recreated edge case)
        const convData = await getChatsForUser(user.id);
        if (cancelled) return;
        
        const myConv = (convData || []).find((c) => {
          const otherId = c?.other_user_id;
          return (
            c?.conversation_id === currentConvId ||
            otherId === currentConvId ||
            otherId === initialOtherUser?.id
          );
        });
        const refreshedOther = {
          id: myConv?.other_user_id || initialOtherUser.id,
          username: myConv?.other_username || initialOtherUser.username,
          publicKey: myConv?.other_public_key || initialOtherUser.publicKey,
        };
        setOtherUser(refreshedOther);

        const convKey = getConversationKey(user.id, refreshedOther.id);
        let ratchetState = await getRatchetState(convKey);
        if (!ratchetState && ecdhPrivateKey && refreshedOther?.publicKey) {
          const otherKey = typeof refreshedOther.publicKey === "string" ? refreshedOther.publicKey : null;
          if (otherKey) {
            ratchetState = await createRatchetState(ecdhPrivateKey, otherKey, convKey);
          }
        }

        // Check cache for messages
        const cachedMessages = _getConvMsgs(currentConvId);
        const cachedReactions = _reactCache[currentConvId];

        // init: cache check (log removed)

        // Check if messages are preloaded in session cache
        let preloadedMessages = null;
        if (window._sessionCache?.convMessages?.[currentConvId]) {
          preloadedMessages = window._sessionCache.convMessages[currentConvId];
          // using preloaded messages (log removed)
        }

        let shouldLoadFromDB = false;
        
        if (preloadedMessages && preloadedMessages.length > 0) {
          // using preloaded messages (log removed)
          serverLoadedRef.current = true;
          setMessages(preloadedMessages);
        } else if (cachedMessages && cachedMessages.length > 0) {
          // using local cache (log removed)
          setMessages(cachedMessages);
          shouldLoadFromDB = true;
        } else {
          // no cached messages - loading from DB (log removed)
          shouldLoadFromDB = true;
        }

        // Sync with DB in background to keep fresh (doesn't block display)
        if (shouldLoadFromDB) {
          // background sync initiated (log removed)
          // Background fast sync: do not show visual syncing badge
          loadMessages(currentConvId, 60, false, true).then((fresh) => {
            if (fresh && fresh.length > 0) {
              serverLoadedRef.current = true;
              setMessages(fresh);
              // Update session cache with fresh data
              _setConvMsgs(currentConvId, fresh);
            }
          });
        }

        if (cancelled) return;

        // Load reactions in background — always reconcile with DB
        loadReactions(currentConvId).catch(() => {});

        markMessagesAsSeen(peerTargetId).catch(() => {});
        updateLastRead(peerTargetId).catch(() => {});
        if (hasUnread && onBadgeClear) onBadgeClear();

        _convMetaCache[currentConvId] = { otherUser };
        _convLoaded.add(currentConvId);

        if (!cancelled) setInitialising(false);
        return;
      }

      // Fallback: if no otherUser passed, try cache
      const cached = _convMetaCache[currentConvId];
      if (cached && !cancelled) {
        // init fallback - using cached session (log removed)
        setOtherUser(cached.otherUser);
        
        // Check cache but only use if has messages (for fast display)
        const cachedMsgs = _getConvMsgs(currentConvId);
        if (cachedMsgs && cachedMsgs.length > 0) {
          // fallback showing cached messages (log removed)
          setMessages(cachedMsgs);
          // Sync with DB after showing cached (background; don't flash sync badge)
          await loadMessages(currentConvId, 60, false);
          if (_reactCache[currentConvId]) setReactions(_reactCache[currentConvId]);
          _convMetaCache[currentConvId] = cached;
          _convLoaded.add(currentConvId);
          if (!cancelled) setInitialising(false);
          return;
        }
        // Fall through to load from DB
      }

      // If already loaded, keep caching but still refresh from server
      // (removes stale-on-reopen behavior)
      if (_convLoaded.has(currentConvId) && cached) {
        // keep going into slow path to refresh data
      }

      // Slow path: load from database
      const convData = await getChatsForUser(user.id);
      if (cancelled) return;

      const myConv = (convData || []).find((c) => {
        const otherId = c?.other_user_id;
        return (
          c?.conversation_id === currentConvId ||
          otherId === currentConvId ||
          otherId === initialOtherUser?.id
        );
      });
      if (!myConv) {
        if (!cancelled) {
          const fallbackId = currentConvId;
          (async () => {
            const p = await getProfile(fallbackId).catch(() => null);
            const fallbackOther = {
              id: fallbackId,
              username: p?.username || "Unknown",
              publicKey: p?.public_key || null,
            };
            setOtherUser(fallbackOther);
            _convMetaCache[currentConvId] = { otherUser: fallbackOther };
            await loadMessages(currentConvId, 60, false).catch(() => []);
            loadReactions(currentConvId).catch(() => {});
            setStatus("");
            setInitialising(false);
          })();
        }
        return;
      }

      const other = {
        id: myConv.other_user_id,
        username: myConv.other_username,
        publicKey: myConv.other_public_key,
      };
      const peerResolvedId = other.id || currentConvId;

      const convKey = getConversationKey(user.id, other.id);
      let ratchetState = await getRatchetState(convKey);
      if (!ratchetState && ecdhPrivateKey && other.publicKey) {
        const otherKey = typeof other.publicKey === "string" ? other.publicKey : null;
        if (otherKey) {
          ratchetState = await createRatchetState(ecdhPrivateKey, otherKey, convKey);
        }
      }
      if (cancelled) return;

      setOtherUser(other);
      await loadMessages(currentConvId);
      if (cancelled) return;
      loadReactions(currentConvId).catch(() => {});
      markMessagesAsSeen(peerResolvedId).catch(() => {});
      updateLastRead(peerResolvedId).catch(() => {});
      _convMetaCache[currentConvId] = { otherUser: other };
      _convLoaded.add(currentConvId);
      if (!cancelled) setInitialising(false);
    };

    init().catch((err) => {
      if (!cancelled) {
        console.error("Chat load error:", err);
        setStatus("");
        setInitialising(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    conversationId,
    user?.id,
    initialOtherUser,
    ecdhPrivateKey,
  ]);

  // Track whether user is scrolled near bottom (within 120px)
  const isNearBottomRef = useRef(true);
  const prevMsgCountRef = useRef(0);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const firstNewMsgIdRef = useRef(null); // track the first missed message id for scroll-to-target
  const unseenMsgIdsRef = useRef(new Set()); // track specific unseen message IDs
  const rtChannelRef = useRef(null); // realtime channel for broadcasting edit events

  // Track whether server data has been loaded for this conversation
  const serverLoadedRef = useRef(false);

  // Restore from persistent cache ONLY as initial fallback (before server data arrives)
  useEffect(() => {
    const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
    if (!conversationId || !isValidRootKey(rootKey)) return;
    let cancelled = false;

    // Only restore messages if server hasn't loaded yet
    const checkAndRestore = () => {
      if (serverLoadedRef.current) return;
      cacheGet(rootKey, convMsgCacheKey(user?.id, conversationId))
        .then((cached) => {
          if (cancelled || !Array.isArray(cached) || cached.length === 0) return;
          if (serverLoadedRef.current) return;
          setMessages((prev) => (prev.length ? prev : cached));
          _setConvMsgs(conversationId, cached);
        })
        .catch(() => {});
    };
    checkAndRestore();

    return () => {
      cancelled = true;
    };
  }, [conversationId, ecdhPrivateKey]);

  const handleScroll = useCallback(() => {
    const el = msgsContainerRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const wasNearBottom = isNearBottomRef.current;
    isNearBottomRef.current = distFromBottom < 120;
    setShowScrollBtn(distFromBottom > 200);

    // Check which unseen messages are now visible in the viewport
    if (unseenMsgIdsRef.current.size > 0) {
      const containerRect = el.getBoundingClientRect();
      const containerTop = containerRect.top;
      const containerBottom = containerRect.bottom;
      let removedAny = false;

      for (const msgId of unseenMsgIdsRef.current) {
        const bubbleEl = msgRefs.current[`bubble_${msgId}`];
        if (!bubbleEl) continue;
        const rect = bubbleEl.getBoundingClientRect();
        // Consider visible if any part of the bubble overlaps with the container viewport
        const isVisible = rect.bottom > containerTop && rect.top < containerBottom;
        if (isVisible) {
          unseenMsgIdsRef.current.delete(msgId);
          removedAny = true;
        }
      }

      if (removedAny) {
        setNewMsgCount(unseenMsgIdsRef.current.size);
        // Update firstNewMsgIdRef to the first remaining unseen message
        if (unseenMsgIdsRef.current.size === 0) {
          firstNewMsgIdRef.current = null;
        } else {
          // Find the earliest remaining unseen message in the messages array
          const msgIdSet = new Set(unseenMsgIdsRef.current);
          for (const m of messages) {
            if (msgIdSet.has(String(m.id))) {
              firstNewMsgIdRef.current = m.id;
              break;
            }
          }
        }
      }
    }

    // Reset when user scrolls all the way to bottom
    if (!wasNearBottom && isNearBottomRef.current && newMsgCount > 0) {
      setNewMsgCount(0);
      unseenMsgIdsRef.current.clear();
      firstNewMsgIdRef.current = null;
    }

    // Save scroll position so we can restore it on reopen
    _scrollCache[conversationId] = el.scrollTop;
  }, [conversationId, newMsgCount, messages]);

  // Reset scroll state when conversation changes
  useEffect(() => {
    prevMsgCountRef.current = 0;
    isNearBottomRef.current = true;
    setNewMsgCount(0);
    firstNewMsgIdRef.current = null;
    unseenMsgIdsRef.current.clear();
  }, [conversationId]);

  // Scroll to bottom: first load only, or when user is near bottom and new msg arrives
  useEffect(() => {
    const el = msgsContainerRef.current;
    if (!el || messages.length === 0) return;
    const newCount = messages.length;
    const prevCount = prevMsgCountRef.current;
    prevMsgCountRef.current = newCount;

    if (prevCount === 0) {
      // First load — restore saved position or scroll to bottom
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const container = msgsContainerRef.current;
          if (!container) return;
          // If has unread, always go to bottom
          if (hasUnread) delete _scrollCache[conversationId];
          const saved = _scrollCache[conversationId];
          if (
            saved !== undefined &&
            saved < container.scrollHeight - container.clientHeight - 50
          ) {
            container.scrollTop = saved;
          } else {
            container.scrollTop = container.scrollHeight;
          }
          const dist =
            container.scrollHeight -
            container.scrollTop -
            container.clientHeight;
          isNearBottomRef.current = dist < 120;
          setShowScrollBtn(dist > 200);
        }),
      );
      return;
    }
    if (newCount > prevCount) {
      const lastMsg = messages[messages.length - 1];
      const iAmSender = lastMsg?.sender_id === user?.id;
      if (iAmSender || isNearBottomRef.current) {
        // Scroll to bottom: always for sender, or if receiver is near bottom
        setTimeout(() => {
          const container = msgsContainerRef.current;
          if (container)
            container.scrollTo({
              top: container.scrollHeight,
              behavior: "smooth",
            });
        }, 30);
      } else if (lastMsg?.sender_id !== user?.id) {
        // User is scrolled up and someone else sent a message — track as unseen
        const delta = newCount - prevCount;
        const newMsgs = messages.slice(-delta);
        for (const m of newMsgs) {
          if (m.sender_id !== user?.id) {
            unseenMsgIdsRef.current.add(String(m.id));
          }
        }
        setNewMsgCount(unseenMsgIdsRef.current.size);
        // Track the first new message for scroll-to-target
        if (!firstNewMsgIdRef.current) {
          const prevMsgs = new Set(messages.slice(0, prevCount).map((m) => String(m.id)));
          for (const m of newMsgs) {
            if (m.sender_id !== user?.id && !prevMsgs.has(String(m.id))) {
              firstNewMsgIdRef.current = m.id;
              break;
            }
          }
        }
      }
    }
    // User scrolled up to read history: do nothing — let them stay where they are
  }, [messages.length]);

  // ── Realtime ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!conversationId || !user?.id) return;

    // realtime setup

    const ch = supabase
      .channel(`conv:${conversationId}`, {
        config: {
          broadcast: { self: false },
          private: false,
        },
      });
    // Store channel ref for broadcasting edit events
    rtChannelRef.current = ch;
    console.log("[Realtime] Channel created for:", conversationId, "ref:", rtChannelRef.current ? "exists" : "null");

    ch
      // New message
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `receiver_id=eq.${user.id}`,
        },
        (p) => {
          // realtime message received — instant UI update, no queue blocking
          if (!p.new) return;

          const senderId = p.new?.sender_id;
          const receiverId = p.new?.receiver_id;
          if (!senderId || !receiverId) return;
          const eventConvId = senderId === user.id ? receiverId : senderId;
          if (eventConvId !== conversationId) {
            return;
          }

          // Instantly add to UI with empty content (will decrypt in background)
          const incomingMsg = {
            ...p.new,
            content: "",
            reply_to_message_id: p.new.reply_to_message_id ?? null,
          };
          setMessages((prev) => {
            if (prev.some((m) => String(m.id) === String(p.new.id))) return prev;
            const next = [...prev, incomingMsg];
            _setConvMsgs(conversationId, next);
            return next;
          });

          // Don't mark as seen yet — only mark when the message is actually visible in the viewport
          // The handleScroll-based visibility check + seen effect will handle it when user scrolls to it
          if (hasUnread && onBadgeClear) onBadgeClear();

          // Decrypt in background — fire and forget, no queue blocking
          (async () => {
            try {
              if (p.new.encrypted_content && typeof p.new.encrypted_content === "string" && p.new.encrypted_content.startsWith("{")) {
                const parsed = JSON.parse(p.new.encrypted_content);
                if (parsed.c && parsed.n !== undefined) {
                  const convKey = getConversationKey(senderId, receiverId);
                  const dec = await decryptWithRatchet(parsed.c, convKey, ecdhPrivateKey, Number(parsed.n)).catch(() => null);
                  if (dec) {
                    setMessages((prev) => {
                      const updated = prev.map((m) =>
                        String(m.id) === String(p.new.id) ? { ...m, content: dec } : m,
                      );
                      _setConvMsgs(conversationId, updated);
                      return updated;
                    });
                    return;
                  }
                }
              }
            } catch {
              // fall through to loadMessages
            }
            // If direct decrypt failed, invalidate cache and fetch fresh
            invalidateMessageCache(senderId || conversationId);
            loadMessagesRef.current
              ?.(conversationId, Math.max(60, messagesLenRef.current + 10), false, true)
              .catch(() => {});
          })();

          return;
        },
      )
      // Message UPDATE — listen for read_at changes (seen ticks)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
        },
        (p) => {
          if (!p.new?.id) return;
          const msgId = String(p.new.id);
          const isIncoming = p.new?.receiver_id === user?.id;
          const isOutgoing = p.new?.sender_id === user?.id;

          console.log("[Msg UPDATE]", {
            msgId,
            isIncoming,
            isOutgoing,
            isEdited: p.new?.is_edited,
            hasEncryptedContent: !!p.new?.encrypted_content,
            hasReadAt: !!p.new?.read_at,
            hasSeenAt: !!p.new?.seen_at,
          });

          // Handle incoming message edits
          if (isIncoming && p.new?.is_edited && p.new?.encrypted_content) {
            console.log("[Edit] Received message edit from other user:", {
              msgId,
              encryptedContentLength: p.new.encrypted_content.length,
              isEdited: p.new.is_edited,
            });
            setMessages((prev) => {
              const existing = prev.find((m) => String(m.id) === msgId);
              if (!existing) return prev;
              // Only update if content actually changed (avoid unnecessary decrypts)
              if (existing.encrypted_content === p.new.encrypted_content && existing.is_edited) return prev;
              const updated = prev.map((m) =>
                String(m.id) === msgId
                  ? { ...m, ...p.new, is_edited: true, content: "" }
                  : m,
              );
              _setConvMsgs(conversationId, updated);
              return updated;
            });
            // Decrypt updated content in background
            (async () => {
              try {
                if (p.new.encrypted_content && typeof p.new.encrypted_content === "string" && p.new.encrypted_content.startsWith("{")) {
                  const parsed = JSON.parse(p.new.encrypted_content);
                  if (parsed.c && parsed.n !== undefined) {
                    const senderId = p.new.sender_id;
                    const receiverId = p.new.receiver_id;
                    const convKey = getConversationKey(senderId, receiverId);
                    const dec = await decryptWithRatchet(parsed.c, convKey, ecdhPrivateKey, Number(parsed.n)).catch(() => null);
                    if (dec) {
                      setMessages((prev) => {
                        const updated = prev.map((m) =>
                          String(m.id) === msgId ? { ...m, content: dec } : m,
                        );
                        _setConvMsgs(conversationId, updated);
                        return updated;
                      });
                    }
                  }
                }
              } catch { /* fall through */ }
            })();
          }

          // Handle read_at/seen_at updates for outgoing messages
          if (isOutgoing) {
            const newReadAt = p.new?.read_at || p.new?.seen_at;
            if (!newReadAt) return;
            setMessages((prev) => {
              const updated = prev.map((m) =>
                String(m.id) === msgId
                  ? { ...m, read_at: newReadAt, seen_at: newReadAt }
                  : m,
              );
              _setConvMsgs(conversationId, updated);
              return updated;
            });
          }
        },
      )
      // Reaction INSERT — update state (replace temp if exists, or add new)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "reactions",
        },
        async (p) => {
          if (!p.new?.message_id) return;
          const msgExists = (_getConvMsgs(conversationId) || []).some((m) => m.id === p.new.message_id);
          if (!msgExists) return;
          const emoji = await decodeReactionEmoji(p.new.encrypted_emoji);
          const key = `${p.new.message_id}:${emoji}`;

          // Skip if user explicitly removed this reaction (delayed INSERT from a previous add)
          const desired = reactionDesiredRef.current.get(key);
          if (desired === false && p.new.user_id === user.id) return;

          const normalized = { ...p.new, emoji };
          setReactions((prev) => {
            const existing = prev[p.new.message_id] || [];
            // Skip if we already have this real reaction ID
            if (existing.some((r) => r.id === p.new.id)) return prev;
            // Replace temp reaction from same user+emoji
            const tmpIdx = existing.findIndex(
              (r) =>
                r.id?.startsWith("tmp_") &&
                r.user_id === p.new.user_id &&
                r.emoji === emoji,
            );
            if (tmpIdx !== -1) {
              const updatedList = [...existing];
              updatedList[tmpIdx] = normalized;
              const updated = { ...prev, [p.new.message_id]: updatedList };
              _reactCache[conversationId] = updated;
              const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
              if (isValidRootKey(rootKey)) {
                cacheSet(rootKey, convReactCacheKey(user?.id, conversationId), updated).catch(() => {});
              }
              return updated;
            }
            // Also skip if we already have this emoji from this user (prevents double-count)
            if (existing.some((r) => !r.id?.startsWith("tmp_") && r.user_id === p.new.user_id && r.emoji === emoji)) return prev;
            const updated = {
              ...prev,
              [p.new.message_id]: [...existing, normalized],
            };
            _reactCache[conversationId] = updated;
            const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
            if (isValidRootKey(rootKey)) {
              cacheSet(rootKey, convReactCacheKey(user?.id, conversationId), updated).catch(() => {});
            }
            return updated;
          });
        },
      )
      // Reaction DELETE
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "reactions",
        },
        async (p) => {
          if (p.old?.message_id) {
            const msgExists = (_getConvMsgs(conversationId) || []).some((m) => m.id === p.old.message_id);
            if (!msgExists) return;
          }
          // If we have the old data, use it directly
          if (p.old?.id && p.old?.message_id) {
            setReactions((prev) => {
              const existing = prev[p.old.message_id] || [];
              const updatedForMsg = existing.filter((r) => r.id !== p.old.id);
              const updated = { ...prev, [p.old.message_id]: updatedForMsg };
              if (updatedForMsg.length === 0) delete updated[p.old.message_id];
              _reactCache[conversationId] = updated;
              const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
              if (isValidRootKey(rootKey)) {
                cacheSet(rootKey, convReactCacheKey(user?.id, conversationId), updated).catch(() => {});
              }
              return updated;
            });
            return;
          }

          // Fallback: refetch all reactions if we don't have p.old data
          // This happens when REPLICA IDENTITY isn't set to FULL
          const msgs = await getMessagesWithFriend(conversationId, 200);
          const nested = await Promise.all(
            (msgs || []).map((m) => getMessageReactions(m.id).catch(() => [])),
          );
          const data = await Promise.all(
            nested.flat().map(async (r) => ({
              ...r,
              emoji: await decodeReactionEmoji(r.encrypted_emoji),
            })),
          );
          // Filter out reactions the user explicitly removed
          const filtered = data.filter((r) => {
            const key = `${r.message_id}:${r.emoji}`;
            const desired = reactionDesiredRef.current.get(key);
            if (desired === false && r.user_id === user.id) return false;
            return true;
          });
          const map = {};
          (filtered || []).forEach((r) => {
            if (!map[r.message_id]) map[r.message_id] = [];
            map[r.message_id].push(r);
          });
          setReactions((prev) => {
            const merged = { ...prev };
            for (const msgId of Object.keys(map)) {
              merged[msgId] = map[msgId];
            }
            _reactCache[conversationId] = merged;
            return merged;
          });
          const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
          if (isValidRootKey(rootKey)) {
            cacheSet(rootKey, convReactCacheKey(user?.id, conversationId), map).catch(() => {});
          }
        },
      )
      // Reaction UPDATE
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "reactions",
        },
        async (p) => {
          if (p.new?.message_id) {
            const msgExists = (_getConvMsgs(conversationId) || []).some((m) => m.id === p.new.message_id);
            if (!msgExists) return;
          }
          const msgs = await getMessagesWithFriend(conversationId, 200);
          const nested = await Promise.all(
            (msgs || []).map((m) => getMessageReactions(m.id).catch(() => [])),
          );
          const data = await Promise.all(
            nested.flat().map(async (r) => ({
              ...r,
              emoji: await decodeReactionEmoji(r.encrypted_emoji),
            })),
          );
          // Filter out reactions the user explicitly removed
          const filtered = data.filter((r) => {
            const key = `${r.message_id}:${r.emoji}`;
            const desired = reactionDesiredRef.current.get(key);
            if (desired === false && r.user_id === user.id) return false;
            return true;
          });
          const map = {};
          (filtered || []).forEach((r) => {
            if (!map[r.message_id]) map[r.message_id] = [];
            map[r.message_id].push(r);
          });
          setReactions((prev) => {
            const merged = { ...prev };
            for (const msgId of Object.keys(map)) {
              merged[msgId] = map[msgId];
            }
            _reactCache[conversationId] = merged;
            return merged;
          });
          const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
          if (isValidRootKey(rootKey)) {
            cacheSet(rootKey, convReactCacheKey(user?.id, conversationId), map).catch(() => {});
          }
        },
      )
      // Message status update (seen/delivered) and content update (edited)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
        },
        async (p) => {
          if (!p.new) return;

          const senderId = p.new?.sender_id;
          const receiverId = p.new?.receiver_id;
          if (!senderId || !receiverId) return;
          const eventConvId = senderId === user.id ? receiverId : senderId;
          if (eventConvId !== conversationId) return;

          setMessages((prev) => {
            const msg = prev.find((m) => m.id === p.new.id);
            if (!msg) return prev;

            // Check if content was actually edited using DB field
            const wasEdited = p.new.is_edited === true;

            // Check if this is just a status update (seen/delivered) or an actual edit
            const statusChanged =
              (p.new.read_at || null) !== (msg.read_at || msg.seen_at || null) ||
              (p.new.delivered_at || null) !== (msg.delivered_at || null);

            // If only status changed (seen/delivered), do simple update
            if (statusChanged && !wasEdited) {
              return prev.map((m) =>
                m.id === p.new.id
                  ? {
                      ...m,
                      read_at: p.new.read_at || null,
                      seen_at: p.new.read_at || p.new.seen_at || null,
                      delivered_at: p.new.delivered_at,
                    }
                  : m,
              );
            }

            // Content was edited - decrypt and update using ratchet
            if (wasEdited) {
              (async () => {
                if (p.new.sender_id === user.id) {
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === p.new.id ? { ...m, is_edited: true } : m,
                    ),
                  );
                  return;
                }

                const convKey = getConversationKey(p.new.sender_id, p.new.receiver_id);
                const ratchetState = await getRatchetState(convKey);
                
                if (ratchetState && ecdhPrivateKey) {
                  try {
                    if (p.new.encrypted_content.startsWith("{")) {
                      const parsed = JSON.parse(p.new.encrypted_content);
                      if (parsed.c && parsed.n !== undefined) {
                        const decrypted = await decryptWithRatchet(
                          parsed.c,
                          convKey,
                          ecdhPrivateKey,
                          Number(parsed.n),
                        );
                        setMessages((prev) =>
                          prev.map((m) =>
                            m.id === p.new.id
                              ? { ...m, content: decrypted, is_edited: true }
                              : m,
                          ),
                        );
                        return;
                      }
                    }
                  } catch (e) {
                    // ignore transient realtime decrypt noise
                  }
                }
                
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === p.new.id
                      ? {
                          ...m,
                          content: m.content || "",
                          is_edited: true,
                        }
                      : m,
                  ),
                );
              })();
            }

            // Update with new encrypted content and is_edited from DB
            return prev.map((m) =>
              m.id === p.new.id
                ? {
                    ...m,
                    encrypted_content: p.new.encrypted_content,
                    updated_at: p.new.updated_at,
                    read_at: p.new.read_at || null,
                    seen_at: p.new.read_at || p.new.seen_at || null,
                    delivered_at: p.new.delivered_at,
                    is_edited: p.new.is_edited,
                  }
                : m,
            );
          });

          const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
          if (isValidRootKey(rootKey)) {
            setTimeout(() => {
               cacheSet(rootKey, convMsgCacheKey(user?.id, conversationId), _getConvMsgs(conversationId) || []).catch(() => {});
            }, 0);
          }
        },
      )
      // Message deleted
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "messages",
        },
        (p) => {
          if (!p.old?.id) return;
          // Remove from session cache and UI immediately
          const updated = (_getConvMsgs(conversationId) || []).filter((m) => m.id !== p.old.id);
          _setConvMsgs(conversationId, updated);
          setMessages(updated);
          // Force clear persistent cache — never persist deleted data
          clearChatPersistentCache(user?.id, conversationId);
          const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
          if (isValidRootKey(rootKey)) {
            setTimeout(() => {
              cacheSet(rootKey, convMsgCacheKey(user?.id, conversationId), updated).catch(() => {});
            }, 0);
          }
        },
      )
      // Friendship deleted/updated → closed banner
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "friendships",
        },
        (p) => {
          const otherId = otherUser?.id;
          const me = user?.id;
          if (!otherId || !me) return;

          const sender = p.new?.sender_id || p.old?.sender_id || null;
          const receiver = p.new?.receiver_id || p.old?.receiver_id || null;
          const isThisPair =
            (sender === me && receiver === otherId) ||
            (sender === otherId && receiver === me);
          if (!isThisPair) return;
          
          const isRemoved = p.event === "DELETE" || 
            (p.new?.status === "removed" || p.new?.status === "rejected");
          
          if (!isRemoved) return;

          _setConvMsgs(conversationId, null);
          delete _reactCache[conversationId];
          delete _convMetaCache[conversationId];
          _convLoaded.delete(conversationId);

          setConversationClosed(true);
          setCloseCountdown(3);
          let count = 3;
          countdownRef.current = setInterval(() => {
            count -= 1;
            setCloseCountdown(count);
            if (count <= 0) {
              clearInterval(countdownRef.current);
              if (count === 0) {
                setTimeout(() => onClose(), 1100);
              } else {
                onClose();
              }
            }
          }, 1000);
        },
      )
      // Listen for custom message edit broadcasts
      .on("broadcast", { event: "message_edited" }, async (payload) => {
        const msgId = payload?.messageId;
        if (!msgId) return;
        console.log("[Edit] Received broadcast edit notification for:", msgId);
        // Refetch messages from server to get the updated content
        loadMessagesRef.current?.(conversationId, 60, false, true).catch(() => {});
        // Also refetch reactions in case edit triggered any side effects
        loadReactionsRef.current?.(conversationId).catch(() => {});
      });

    // Listen for custom event bus edit notifications (same-tab fallback)
    const onEditEvent = (ev) => {
      const { conversationId: evConvId, messageId } = ev.detail || {};
      if (evConvId !== conversationId || !messageId) return;
      console.log("[Edit] Received custom event bus edit notification for:", messageId);
      loadMessagesRef.current?.(conversationId, 60, false, true).catch(() => {});
    };
    window.addEventListener("zchat:message_edited", onEditEvent);

    // Listen for localStorage edit notifications (cross-tab)
    const onStorageEdit = (ev) => {
      if (ev.key && ev.key.startsWith(`zchat_edit_${conversationId}`) && ev.newValue) {
        try {
          const data = JSON.parse(ev.newValue);
          console.log("[Edit] Received localStorage edit notification:", data.messageId);
          loadMessagesRef.current?.(conversationId, 60, false, true).catch(() => {});
        } catch (e) {
          console.error("[Edit] Failed to parse localStorage edit notification:", e);
        }
      }
    };
    window.addEventListener("storage", onStorageEdit);

    ch
      .subscribe((status, err) => {
        // realtime subscription status change
        setRtSubscribed(status === "SUBSCRIBED");
      });
    // Listen for app-level cache update events so we refresh UI immediately
    const onConvUpdated = (ev) => {
      try {
        const chatId = ev?.detail?.chatId;
        const change = ev?.detail?.change;
        if (!chatId || chatId !== conversationId) return;

        // If delta payload included, try minimal in-place update to session cache
        if (change && change.eventType) {
          try {
            const existing = _getConvMsgs(conversationId) || [];
            let updated = existing;
            if (change.eventType === "INSERT" && change.new) {
              if (!existing.find(m => String(m.id) === String(change.new.id))) {
                updated = [...existing, change.new].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
              }
            } else if (change.eventType === "UPDATE" && change.new) {
              updated = existing.map(m => (String(m.id) === String(change.new.id) ? { ...m, ...change.new } : m));
            } else if (change.eventType === "DELETE" && change.old) {
              updated = existing.filter(m => String(m.id) !== String(change.old.id));
            }
            _setConvMsgs(conversationId, updated);
            setMessages(updated);
            return;
          } catch (e) {
            // fall through to full session cache read on error
            // ignore delta apply noise; fallback to session cache
          }
        }

        // Fallback: read authoritative session cache and update UI
        const sess = _getConvMsgs(conversationId) || [];
        setMessages(sess);

        // Schedule sequential background decrypt for pending incoming messages
        // Sort by message number to ensure ratchet chain advances correctly
        (async () => {
          try {
            const pendingToDecrypt = (sess || [])
              .filter((m) => {
                const isIncoming = m.receiver_id === user?.id;
                const hasEncrypted = typeof m.encrypted_content === "string" && m.encrypted_content.trim().length > 0;
                const needsPlain = !m.content || m.content === "[Decrypt failed]" || m.content === "[Encrypted message]";
                return isIncoming && hasEncrypted && needsPlain;
              })
              .map((m) => {
                let msgNum = null;
                try {
                  if (m.encrypted_content.startsWith("{")) {
                    msgNum = JSON.parse(m.encrypted_content).n;
                  }
                } catch { /* ignore */ }
                return { ...m, _msgNum: msgNum };
              })
              .sort((a, b) => {
                if (a._msgNum !== null && b._msgNum !== null) return a._msgNum - b._msgNum;
                if (a._msgNum !== null) return -1;
                if (b._msgNum !== null) return 1;
                return 0;
              });

            if (!pendingToDecrypt.length) return;

            const convKey = getConversationKey(user?.id, otherUser?.id || conversationId);
            let ratchetState = await getRatchetState(convKey);
            if (!ratchetState && ecdhPrivateKey && otherUser?.publicKey) {
              const otherKey = typeof otherUser.publicKey === "string" ? otherUser.publicKey : null;
              if (otherKey) {
                ratchetState = await createRatchetState(ecdhPrivateKey, otherKey, convKey);
              }
            }
            if (!ratchetState || !ecdhPrivateKey) return;

            let changed = false;
            for (const m of pendingToDecrypt) {
              if (typeof m.encrypted_content !== "string" || !m.encrypted_content.startsWith("{")) continue;
              let parsed;
              try { parsed = JSON.parse(m.encrypted_content); } catch { continue; }
              if (!parsed.c || parsed.n === undefined) continue;

              const dec = await decryptWithRatchet(parsed.c, convKey, ecdhPrivateKey, Number(parsed.n)).catch(() => null);
              if (dec) {
                const existing = _getConvMsgs(conversationId) || [];
                const idx = existing.findIndex((mm) => mm.id === m.id);
                if (idx >= 0 && (!existing[idx].content || existing[idx].content === "[Decrypt failed]" || existing[idx].content === "[Encrypted message]")) {
                  existing[idx] = { ...existing[idx], content: dec };
                  _setConvMsgs(conversationId, existing);
                  changed = true;
                }
              }
            }

            if (changed) {
              const final = _getConvMsgs(conversationId) || [];
              setMessages(final);
              const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
              if (isValidRootKey(rootKey)) {
                await import("../utils/cache").then((c) => c.cacheSet(rootKey, convMsgCacheKey(user?.id, conversationId), final)).catch(() => {});
              }
            }
          } catch (e) {
            // ignore
          }
        })();
      } catch (e) {
        // ignore
      }
    };
    window.addEventListener("sessionCache:convUpdated", onConvUpdated);

    return () => {
      supabase.removeChannel(ch);
      setRtSubscribed(false);
      window.removeEventListener("sessionCache:convUpdated", onConvUpdated);
      window.removeEventListener("zchat:message_edited", onEditEvent);
      window.removeEventListener("storage", onStorageEdit);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [conversationId, user?.id]);

  // showSync (default true) controls whether the visual "syncing" indicator is shown.
  // Some callers (e.g. optimistic send reconciliation) want to fetch without flashing
  // the UI syncing badge, so they pass showSync = false.
  const loadMessages = async (convId, limit = 60, showSync = true, bypassCache = false) => {
    if (!isLikelyUserId(convId)) {
      const cached = (_getConvMsgs(convId) || []).filter(Boolean);
      if (cached.length) setMessages(cached);
      return cached;
    }
    const run = async () => {
      if (showSync) setSyncing(true);
      try {
        const msgs = await getMessagesWithFriend(convId, limit, bypassCache);
      // loadMessages DB result log removed
      if (!msgs) {
        setMessages([]);
        return;
      }

      const cachedById = new Map(
        ((_getConvMsgs(convId) || []).filter(Boolean)).map((m) => [m.id, m]),
      );
      const cachedByClientId = new Map();
      ((_getConvMsgs(convId) || []).filter(Boolean))
        .filter((m) => String(m.client_message_id || m.clientMessageId || "").trim())
        .forEach((m) => {
          const key = String(m.client_message_id || m.clientMessageId).trim();
          if (key) cachedByClientId.set(key, m);
        });

      // Decrypt only new/changed messages; keep cached plaintext for unchanged ones.
      const processed = [];
      for (const m of msgs) {
        const incomingKey = `${m.id || ""}:${m.sender_id || ""}:${m.receiver_id || ""}`;
        const cached = cachedById.get(m.id);
        // Check if content changed (edit detection)
        const contentChanged = cached && cached.encrypted_content !== m.encrypted_content;
        if (contentChanged) {
          console.log("[Edit] Detected content change for message:", m.id, "will re-decrypt");
        }
        if (
          cached &&
          cached.encrypted_content === m.encrypted_content &&
          typeof cached.content === "string" &&
          cached.content !== "[Decrypt failed]"
        ) {
          processed.push({
            ...m,
            content: cached.content,
            // Always use server's latest metadata (seen_at, read_at, delivered_at)
            seen_at: m.seen_at || m.read_at || cached.seen_at,
            read_at: m.read_at || cached.read_at,
            delivered_at: m.delivered_at || cached.delivered_at,
          });
          continue;
        }

        const isIncoming = m.receiver_id === user?.id;
        if (!isIncoming) {
          // For outgoing messages, try multiple strategies to preserve content:
          // 1. If cached message has content and IDs match (after flushOutbox ID swap)
          // 2. If client_message_id matches (some servers may persist it)
          // 3. If outbox plain text map has it
          const clientId = String(m.client_message_id || m.clientMessageId || "").trim();
          const cacheByClient = clientId ? cachedByClientId.get(clientId) : null;
          const preservedContent =
            typeof cached?.content === "string" && cached.content !== "" && cached.content !== "[Decrypt failed]"
              ? cached.content
              : typeof cacheByClient?.content === "string"
                ? cacheByClient.content
                : outboxPlainByClientRef.current.get(clientId) || "";
          if (preservedContent) {
            processed.push({ ...m, content: preservedContent });
            continue;
          }
          // No preserved content found — keep empty, loadMessages merge will handle it
          processed.push({ ...m, content: "" });
          continue;
        }

        let content = m.encrypted_content || "";
        const convKey = getConversationKey(m.sender_id, m.receiver_id);

        let ratchetState = await getRatchetState(convKey);

        if (!ratchetState) {
          try {
            const { initRatchetFromStorage } = await import("../utils/ratchetManager");
            await initRatchetFromStorage(ecdhPrivateKey);
            ratchetState = await getRatchetState(convKey);
          } catch (e) {
            // ignore ratchet state reload noise
          }
        }

        if (!ratchetState && ecdhPrivateKey && otherUser?.publicKey) {
          const otherKey =
            typeof otherUser.publicKey === "string" ? otherUser.publicKey : null;
          if (otherKey) {
            ratchetState = await createRatchetState(ecdhPrivateKey, otherKey, convKey);
          }
        }

        if (ratchetState && ecdhPrivateKey && m.encrypted_content) {
          const lastFailAt = failedDecryptAtRef.current.get(incomingKey) || 0;
          if (Date.now() - lastFailAt < 2500) {
            processed.push({ ...m, content: "" });
            continue;
          }
          try {
            if (m.encrypted_content.startsWith("{")) {
              const parsed = JSON.parse(m.encrypted_content);
              if (parsed.c && parsed.n !== undefined) {
                const dedupeKey = `${incomingKey}:${Number(parsed.n)}`;
                if (processedIncomingRef.current.has(dedupeKey)) {
                  processed.push({ ...m, content: cached?.content || "" });
                  continue;
                }
                const dec = await decryptWithRatchet(
                  parsed.c,
                  convKey,
                  ecdhPrivateKey,
                  Number(parsed.n),
                );
                content = dec || "";
                if (dec) {
                  processedIncomingRef.current.add(dedupeKey);
                  if (processedIncomingRef.current.size > 400) {
                    const first = processedIncomingRef.current.values().next().value;
                    if (first) processedIncomingRef.current.delete(first);
                  }
                  failedDecryptAtRef.current.delete(incomingKey);
                }
              } else {
                content = "";
              }
            } else {
              content = "";
            }
          } catch (e) {
            failedDecryptAtRef.current.set(incomingKey, Date.now());
            content = "";
          }
        } else if (m.encrypted_content) {
          content = "";
        }

        processed.push({ ...m, content });
      }

      const pendingLocal = ((_getConvMsgs(convId) || []).filter(Boolean)).filter(
        (m) => m.pending === true || String(m.id || "").startsWith("tmp_"),
      );

      // Also preserve cached outgoing messages that have plaintext content
      // but weren't matched by the server response (e.g. client_message_id not persisted)
      const cachedOutgoing = ((_getConvMsgs(convId) || []).filter(Boolean)).filter(
        (m) =>
          m.sender_id === user?.id &&
          typeof m.content === "string" &&
          m.content !== "" &&
          m.content !== "[Decrypt failed]" &&
          !processed.some((p) => String(p.id) === String(m.id)),
      );

      // Build a map of server messages by ID for metadata merging
      const serverMsgMap = new Map(processed.map((m) => [String(m.id), m]));

      // Preserve existing message order — only update metadata for messages that exist,
      // and append truly new messages at the end. NEVER re-sort.
      const existing = _getConvMsgs(convId) || [];
      const merged = [];
      const seenIds = new Set();

      // First pass: update existing messages with server metadata (read_at, delivered_at, etc.)
      for (const msg of existing) {
        const serverMsg = serverMsgMap.get(String(msg.id));
        if (serverMsg) {
          // Check if content was edited (encrypted_content changed)
          const wasEdited = msg.encrypted_content !== serverMsg.encrypted_content;
          // Merge: prefer server content for edits, otherwise keep local decrypted content
          merged.push({
            ...serverMsg,
            content: wasEdited ? (serverMsg.content || msg.content || "") : (msg.content || serverMsg.content || ""),
            pending: msg.pending !== undefined ? msg.pending : serverMsg.pending,
            failed: msg.failed !== undefined ? msg.failed : serverMsg.failed,
          });
          seenIds.add(String(msg.id));
        } else {
          // Message not on server — only keep if it's genuinely pending (not yet sent)
          const isPending = msg.pending === true || String(msg.id || "").startsWith("tmp_");
          if (isPending) {
            merged.push(msg);
            seenIds.add(String(msg.id));
          }
          // Otherwise: confirmed message that's no longer on the server — DROP it (deleted/hidden)
        }
      }

      // Second pass: add cached outgoing that weren't in existing
      for (const msg of cachedOutgoing) {
        if (!seenIds.has(String(msg.id))) {
          merged.push(msg);
          seenIds.add(String(msg.id));
        }
      }

      // Third pass: add pending local that weren't in existing
      for (const msg of pendingLocal) {
        if (!seenIds.has(String(msg.id))) {
          merged.push(msg);
          seenIds.add(String(msg.id));
        }
      }

      // Fourth pass: add any server messages not yet seen (truly new)
      for (const msg of processed) {
        if (!seenIds.has(String(msg.id))) {
          merged.push(msg);
          seenIds.add(String(msg.id));
        }
      }

      setMessages(merged);
      serverLoadedRef.current = true;
      // loadMessages caching log removed
      _setConvMsgs(convId, merged);
      const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
      if (isValidRootKey(rootKey)) {
        cacheSet(rootKey, convMsgCacheKey(user?.id, convId), merged).catch(() => {});
      }
      
      // Return processed messages for callers
        return merged;
      } catch (err) {
        console.error("loadMessages exception:", err);
        setMessages([]);
      } finally {
        if (showSync) setSyncing(false);
      }
    };

    const prev = loadMessagesQueueRef.current;
    const next = prev.then(run, run);
    loadMessagesQueueRef.current = next.catch(() => {});
    return next;
  };

  const prefetchOlderChunk = async (baseMessages) => {
    const current = Array.isArray(baseMessages) ? baseMessages : messages;
    if (!conversationId || current.length < 50) return;

    try {
      // Prefetch in background without showing sync UI
      await loadMessages(conversationId, Math.min(current.length + 220, 1000), false);
    } catch {
      // ignore background prefetch errors
    }
  };

  const loadOlderMessages = async () => {
    if (loadingOlder || !conversationId || messages.length < 50) return;
    setLoadingOlder(true);
    try {
      // Background pagination - do not flash sync UI
      await loadMessages(conversationId, Math.min(messages.length + 220, 1000), false);
    } catch {
      // ignore background pagination errors
    } finally {
      setLoadingOlder(false);
    }
  };

  useEffect(() => {
    if (!conversationId || messages.length < 50) return;
    const timer = setTimeout(() => {
      prefetchOlderChunk(messages);
    }, 500);
    return () => clearTimeout(timer);
  }, [conversationId, messages.length]);

  const loadReactions = async (convId) => {
    const msgs = await getMessagesWithFriend(convId, 200);
    const nested = await Promise.all(
      (msgs || []).map((m) => getMessageReactions(m.id).catch(() => [])),
    );
    const data = await Promise.all(
      nested.flat().map(async (r) => ({
        ...r,
        emoji: await decodeReactionEmoji(r.encrypted_emoji),
      })),
    );
    const map = {};
    (data || []).forEach((r) => {
      if (!map[r.message_id]) map[r.message_id] = [];
      map[r.message_id].push(r);
    });

    // Merge: server reactions take priority, clean up stale temps, respect desired state
    setReactions((prev) => {
      const merged = { ...prev };
      const now = Date.now();
      const TEMP_STALE_MS = 10000; // temps older than 10s without server confirmation are stale

      // Process all message IDs that have server reactions
      for (const msgId of Object.keys(map)) {
        const serverList = map[msgId];
        const existingList = prev[msgId] || [];
        const serverIds = new Set(serverList.map((r) => r.id));
        // Build a set of server reactions by user_id+emoji to deduplicate temps
        const serverUserEmoji = new Set(
          serverList.map((r) => `${r.user_id}:${r.emoji}`),
        );
        // Filter out server reactions the user explicitly removed
        const filteredServer = serverList.filter((r) => {
          const key = `${r.message_id}:${r.emoji}`;
          const desired = reactionDesiredRef.current.get(key);
          if (desired === false && r.user_id === user.id) return false; // user removed it
          return true;
        });
        // Keep only temps that are recent AND not already represented on the server
        const keptTemps = existingList.filter((r) => {
          if (!r.id?.startsWith("tmp_")) return false;
          if (serverIds.has(r.id)) return false;
          // If server already has this user+emoji combination, discard the temp
          if (serverUserEmoji.has(`${r.user_id}:${r.emoji}`)) return false;
          const age = now - parseInt(r.id.split("_")[1], 10);
          return isNaN(age) || age < TEMP_STALE_MS;
        });
        merged[msgId] = [...filteredServer, ...keptTemps];
      }

      // Also check existing messages in prev that weren't in map: remove stale temps
      for (const msgId of Object.keys(prev)) {
        if (map[msgId]) continue; // already handled above
        const existingList = prev[msgId] || [];
        const freshTemps = existingList.filter((r) => {
          if (!r.id?.startsWith("tmp_")) return true; // keep confirmed reactions
          const age = now - parseInt(r.id.split("_")[1], 10);
          return !isNaN(age) && age < TEMP_STALE_MS; // keep only recent temps
        });
        if (freshTemps.length === 0) {
          delete merged[msgId];
        } else {
          merged[msgId] = freshTemps;
        }
      }

      _reactCache[convId] = merged;
      return merged;
    });
    const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
    if (isValidRootKey(rootKey)) {
      cacheSet(rootKey, convReactCacheKey(user?.id, convId), map).catch(() => {});
    }
  };

  useEffect(() => {
    loadMessagesRef.current = loadMessages;
    loadReactionsRef.current = loadReactions;
  }, [loadMessages, loadReactions]);

  useEffect(() => {
    loadMessagesQueueRef.current = Promise.resolve();
    incomingEventQueueRef.current = Promise.resolve();
    processedIncomingRef.current = new Set();
    failedDecryptAtRef.current = new Map();
  }, [conversationId]);

  const markMessagesAsSeen = async (convId) => {
    try {
      await markMessagesReadForFriend(convId);
    } catch (e) {
      console.error("markMessagesAsSeen error:", e);
    }
  };

  const updateLastRead = async (convId) => {
    await markMessagesReadForFriend(convId);
  };

  useEffect(() => {
    if (!conversationId || !user?.id) return;
    let alive = true;

    const poll = async () => {
      if (!alive || document.visibilityState === "hidden") return;
      try {
        const lim = Math.max(60, Math.min(messagesLenRef.current + 12, 240));
        await loadMessagesRef.current?.(conversationId, lim, false, true);
        await loadReactionsRef.current?.(conversationId);
      } catch {
        // ignore background poll errors
      }
    };

    const everyMs = rtSubscribed ? 8000 : 3000;
    const boot = window.setTimeout(poll, rtSubscribed ? 3000 : 1000);
    const timer = window.setInterval(poll, everyMs);

    return () => {
      alive = false;
      window.clearTimeout(boot);
      window.clearInterval(timer);
    };
  }, [conversationId, user?.id, rtSubscribed]);

  // Mark messages as read only when they're actually visible in the viewport
  useEffect(() => {
    if (!conversationId || !user?.id || !otherUser?.id) return;
    const el = msgsContainerRef.current;
    if (!el) return;

    const containerRect = el.getBoundingClientRect();
    const containerTop = containerRect.top;
    const containerBottom = containerRect.bottom;

    // Find incoming messages that are unseen AND visible in the viewport
    const visibleUnseen = messages.filter((m) => {
      if (m.sender_id !== otherUser.id) return false;
      if (m.read_at || m.seen_at) return false;
      const bubbleEl = msgRefs.current[`bubble_${m.id}`];
      if (!bubbleEl) return false;
      const rect = bubbleEl.getBoundingClientRect();
      return rect.bottom > containerTop && rect.top < containerBottom;
    });

    if (visibleUnseen.length > 0) {
      markMessagesAsSeen(otherUser.id).catch(() => {});
    }
  }, [messages, conversationId, user?.id, otherUser?.id]);

  const flushOutbox = useCallback(async () => {
    if (outboxBusyRef.current) return;
    outboxBusyRef.current = true;
    setSending(true);
    try {
      while (outboxQueueRef.current.length > 0) {
        const item = outboxQueueRef.current.shift();
        if (!item) continue;
        try {
          const convKey = getConversationKey(user.id, item.friendId);
          let ratchetState = await getRatchetState(convKey);
          if (!ratchetState && ecdhPrivateKey && item.friendPublicKey) {
            const otherKey =
              typeof item.friendPublicKey === "string" ? item.friendPublicKey : null;
            if (otherKey) {
              ratchetState = await createRatchetState(ecdhPrivateKey, otherKey, convKey);
            }
          }
          if (!ratchetState || !ecdhPrivateKey) {
            throw new Error("Ratchet session is not ready.");
          }

          const result = await encryptWithRatchet(item.text, convKey, ecdhPrivateKey);
          if (!result?.ciphertext) {
            throw new Error("Failed to encrypt message.");
          }
          const encryptedContent = JSON.stringify({
            c: result.ciphertext,
            n: result.messageNumber,
          });

          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === item.tempId ? { ...m, encrypted_content: encryptedContent } : m,
            );
            _setConvMsgs(conversationId, updated);
            const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
            if (isValidRootKey(rootKey)) {
              cacheSet(rootKey, convMsgCacheKey(user?.id, conversationId), updated).catch(() => {});
            }
            return updated;
          });

          const sent = await sendMessageToFriend(
            item.friendId,
            encryptedContent,
            item.replyToMessageId,
            item.clientMessageId,
          );
          const isOfflineQueued = sent?.offline === true;

          if (!sent?.id || isOfflineQueued) {
            if (isOfflineQueued) {
              setStatus("Message queued - will send when online");
            } else {
              throw new Error("Message was not persisted on server");
            }
          }

          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === item.tempId
                ? {
                    ...m,
                    clientMessageId: m.clientMessageId || item.clientMessageId,
                    client_message_id: m.client_message_id || item.clientMessageId,
                    id:
                      sent?.id && !String(sent.id).startsWith("offline_")
                        ? sent.id
                        : m.id,
                    created_at: sent?.created_at || m.created_at,
                    delivered_at: isOfflineQueued
                      ? m.delivered_at || null
                      : sent?.delivered_at || m.delivered_at || new Date().toISOString(),
                    pending: isOfflineQueued,
                    failed: false,
                    offlineQueued: isOfflineQueued ? true : undefined,
                    content: m.content || item.text,
                  }
                : m,
            );
            _setConvMsgs(conversationId, updated);
            const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
            if (isValidRootKey(rootKey)) {
              cacheSet(rootKey, convMsgCacheKey(user?.id, conversationId), updated).catch(() => {});
            }
            return updated;
          });
        } catch (err) {
          // Mark message as failed — user can retry
          setMessages((prev) => {
            const updated = prev.map((m) =>
              m.id === item.tempId ? { ...m, pending: false, failed: true } : m,
            );
            _setConvMsgs(conversationId, updated);
            return updated;
          });
          setStatus("Failed to send: " + (err?.message || "Unknown"));
        }
      }
      // Don't call loadMessages here — realtime will handle reconciliation
      // and polling will catch up if realtime is delayed
    } finally {
      outboxBusyRef.current = false;
      setSending(false);
    }
  }, [conversationId, ecdhPrivateKey, user?.id]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || !otherUser?.id) return;
    try {
      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const clientMessageId = `cmsg_${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const replyToMessageId = replyTarget?.id || null;
      const newMsg = {
        id: tempId,
        conversation_id: conversationId,
        sender_id: user.id,
        receiver_id: otherUser.id,
        encrypted_content: "",
        content: text,
        clientMessageId,
        client_message_id: clientMessageId,
        pending: true,
        failed: false,
        reply_to_message_id: replyToMessageId,
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => {
        const updated = [...prev, newMsg];
        _setConvMsgs(conversationId, updated);
        const rootKey = getRootKeyFromStorage(ecdhPrivateKey);
        if (isValidRootKey(rootKey)) {
          cacheSet(rootKey, convMsgCacheKey(user?.id, conversationId), updated).catch(() => {});
        }
        return updated;
      });

      outboxQueueRef.current.push({
        tempId,
        clientMessageId,
        friendId: otherUser.id,
        friendPublicKey: otherUser.publicKey || null,
        text,
        replyToMessageId,
      });
      outboxPlainByClientRef.current.set(clientMessageId, text);

      setInput("");
      setReplyTarget(null);
      setStatus("");
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
      flushOutbox();
    } catch (err) {
      setStatus("Failed to prepare message: " + (err?.message || "Unknown"));
    }
  };

  // ── Message popup (reaction picker or action menu) ─────────────────────────
  // Heights for scroll calculation: use menu height as it's tallest
  const POPUP_MENU_H = 200; // menu popup approx height
  const POPUP_REACT_H = 56; // reaction popup height
  const HEADER_H = 62; // header height

  const openPopup = useCallback(
    (type, msgId) => {
      if (popup?.msgId === msgId && popup?.type === type) {
        if (popupPhase === "open") {
          setPopupPhase("closing");
          setTimeout(() => {
            setPopup(null);
            setPopupRect(null);
            setPopupPhase(null);
          }, 200);
        }
        return;
      }
      const el = msgRefs.current[`bubble_${msgId}`];
      if (el) setPopupRect(el.getBoundingClientRect());
      setPopup({ type, msgId });
      setPopupPhase("opening");
      setTimeout(() => setPopupPhase("open"), 280);
    },
    [popup, popupPhase],
  );

  const closePopup = () => {
    setPopup(null);
    setPopupRect(null);
    setPopupPhase(null);
  };

  // ── Message actions ───────────────────────────────────────────────────────
  const handleDeleteMsgForMe = async (msgId) => {
    closePopup();
    const ids = selectMode ? [...selectedMsgs] : [msgId];
    setSelectMode(false);
    setSelectedMsgs(new Set());
    // Remove from session cache immediately
    const updated = (_getConvMsgs(conversationId) || []).filter((m) => !ids.includes(m.id));
    _setConvMsgs(conversationId, updated);
    setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
    for (const id of ids) {
      if (!id) continue;
      try {
        await hideMessageForMe(id, user?.id);
      } catch (e) {
        console.warn("Failed to hide message for me:", id, e);
      }
    }
  };

  const handleDeleteMsgForAll = async (msgId) => {
    closePopup();
    const ids = selectMode ? [...selectedMsgs] : [msgId];
    setSelectMode(false);
    setSelectedMsgs(new Set());
    // Remove from session cache immediately
    const updated = (_getConvMsgs(conversationId) || []).filter((m) => !ids.includes(m.id));
    _setConvMsgs(conversationId, updated);
    setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
    for (const id of ids) {
      await deleteMessageById(id);
    }
  };

  const handleStartEdit = (msg) => {
    closePopup();
    setEditingMsg(msg);
    setEditInput(msg.content);
  };

  const handleStartReply = (msg) => {
    closePopup();
    setReplyTarget(msg);
    setTimeout(() => {
      const input = document.getElementById("chat-input-box");
      if (input) input.focus();
    }, 0);
  };

  const handleSaveEdit = async () => {
    if (!editingMsg || !editInput.trim()) return;
    const content = editInput.trim();
    const prevContent = editingMsg.content;
    const prevEncrypted = editingMsg.encrypted_content;

    try {
      let encryptedContent = null;
      const convKey = getConversationKey(user.id, otherUser.id);
      const ratchetState = await getRatchetState(convKey);

      if (ratchetState && ecdhPrivateKey) {
        const result = await encryptWithRatchet(content, convKey, ecdhPrivateKey);
        if (result) {
          encryptedContent = JSON.stringify({
            c: result.ciphertext,
            n: result.messageNumber,
          });
        }
      }

      if (!encryptedContent) {
        setStatus("Error: Ratchet session is not ready.");
        return;
      }

      console.log("[Edit] Sending edit to server:", {
        messageId: editingMsg.id,
        encryptedContentLength: encryptedContent.length,
      });

      // Optimistic update: apply immediately so user sees the change
      setMessages((prev) => {
        const updated = prev.map((m) =>
          m.id === editingMsg.id
            ? {
                ...m,
                content: content,
                encrypted_content: encryptedContent,
                updated_at: new Date().toISOString(),
                is_edited: true,
              }
            : m,
        );
        // Also sync to session cache so loadMessages doesn't overwrite it
        _setConvMsgs(conversationId, updated);
        return updated;
      });

      console.log("[Edit] Calling editMessageById...");
      try {
        const serverResponse = await editMessageById(editingMsg.id, encryptedContent);
        console.log("[Edit] Server response:", JSON.stringify(serverResponse, null, 2));
        if (!serverResponse) {
          console.error("[Edit] Server returned empty response — edit may not have been saved");
        }
        // Notify the receiver via broadcast that this message was edited
        console.log("[Edit] Attempting broadcast, rtChannelRef:", rtChannelRef.current ? "exists" : "null");
        if (rtChannelRef.current) {
          console.log("[Edit] Broadcasting message_edited:", editingMsg.id);
          rtChannelRef.current.send({
            type: "broadcast",
            event: "message_edited",
            payload: { messageId: editingMsg.id },
          }).then(() => {
            console.log("[Edit] Broadcast sent successfully");
          }).catch((err) => {
            console.error("[Edit] Broadcast failed:", err);
          });
        } else {
          console.error("[Edit] No realtime channel available for broadcast");
        }
        // Fallback: use localStorage event for cross-tab notification
        try {
          const editKey = `zchat_edit_${conversationId}`;
          localStorage.setItem(editKey, JSON.stringify({
            messageId: editingMsg.id,
            timestamp: Date.now(),
          }));
          console.log("[Edit] Wrote edit notification to localStorage:", editKey);
        } catch (e) {
          console.error("[Edit] Failed to write localStorage edit notification:", e);
        }
      } catch (e) {
        console.error("[Edit] Server error:", e);
        console.error("[Edit] Error stack:", e.stack);
        setStatus("Failed to edit message: " + e.message);
        // Rollback: restore original content
        setMessages((prev) => {
          const restored = prev.map((m) =>
            m.id === editingMsg.id
              ? { ...m, content: prevContent, encrypted_content: prevEncrypted }
              : m,
          );
          _setConvMsgs(conversationId, restored);
          return restored;
        });
        return;
      }

      setEditingMsg(null);
      setEditInput("");
    } catch (err) {
      console.error("handleSaveEdit error:", err);
      setStatus("Failed to edit message: " + err.message);
    }
  };

  // Add a reaction (always adds, never removes — used by pill bar)
  const addReaction = async (messageId, emoji) => {
    const key = `${messageId}:${emoji}`;
    const pending = reactionPendingRef.current.get(key);
    if (pending && !pending.resolved) return;

    // Mark desired state so realtime handler won't re-add a stale delayed INSERT
    reactionDesiredRef.current.set(key, true);

    // Capture the list of user's OTHER reactions before adding (for post-insert verification)
    const beforeReactions = reactions[messageId] || [];
    const myOtherEmojis = beforeReactions
      .filter((r) => r.user_id === user.id && r.emoji !== emoji)
      .map((r) => r.emoji);

    const existing = beforeReactions.find(
      (r) => r.user_id === user.id && r.emoji === emoji,
    );
    if (existing) return; // already have it, ignore

    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempReaction = {
      id: tempId,
      message_id: messageId,
      user_id: user.id,
      emoji,
      conversation_id: conversationId,
    };

    setReactions((prev) => {
      const list = prev[messageId] || [];
      if (list.some((r) => r.user_id === user.id && r.emoji === emoji)) return prev;
      const updated = { ...prev, [messageId]: [...list, tempReaction] };
      _reactCache[conversationId] = updated;
      return updated;
    });

    reactionPendingRef.current.set(key, { type: "add", resolved: false });

    try {
      await upsertReaction(
        messageId,
        emoji,
        otherUser?.id,
        otherUser?.publicKey,
      );

      // Verify: check that our other reactions weren't silently removed by the server
      if (myOtherEmojis.length > 0) {
        const serverReactions = await getMessageReactions(messageId).catch(() => []);
        const serverDecrypted = await Promise.all(
          serverReactions
            .filter((r) => r.user_id === user.id)
            .map(async (r) => ({
              ...r,
              emoji: await decodeReactionEmoji(r.encrypted_emoji),
            })),
        );
        const serverEmojiSet = new Set(serverDecrypted.map((r) => r.emoji));
        const missing = myOtherEmojis.filter((e) => !serverEmojiSet.has(e));
        if (missing.length > 0) {
          // Server lost our other reactions — re-add them
          for (const lostEmoji of missing) {
            const lostTempId = `tmp_recover_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            const lostReaction = {
              id: lostTempId,
              message_id: messageId,
              user_id: user.id,
              emoji: lostEmoji,
              conversation_id: conversationId,
            };
            setReactions((prev) => {
              const list = prev[messageId] || [];
              if (list.some((r) => r.user_id === user.id && r.emoji === lostEmoji)) return prev;
              const updated = { ...prev, [messageId]: [...list, lostReaction] };
              _reactCache[conversationId] = updated;
              return updated;
            });
            // Fire-and-forget re-add
            upsertReaction(messageId, lostEmoji, otherUser?.id, otherUser?.publicKey).catch(() => {});
          }
        }
      }

      reactionPendingRef.current.set(key, { type: "add", resolved: true });
      setTimeout(() => reactionPendingRef.current.delete(key), 500);
    } catch {
      reactionPendingRef.current.delete(key);
      reactionDesiredRef.current.delete(key);
      setReactions((prev) => {
        const list = prev[messageId] || [];
        const updated = {
          ...prev,
          [messageId]: list.filter((r) => r.id !== tempId),
        };
        _reactCache[conversationId] = updated;
        return updated;
      });
    }
  };

  // Toggle a specific reaction emoji on/off (used by badge clicks)
  const toggleReaction = async (messageId, emoji) => {
    const key = `${messageId}:${emoji}`;
    const pending = reactionPendingRef.current.get(key);
    if (pending && !pending.resolved) return;

    const currentReactions = reactions[messageId] || [];
    const existing = currentReactions.find(
      (r) => r.user_id === user.id && r.emoji === emoji,
    );

    if (existing) {
      // ── REMOVE path ──
      const reactionId = existing.id;

      // Mark undesired so delayed realtime INSERTs for this emoji are skipped
      reactionDesiredRef.current.set(key, false);

      setReactions((prev) => {
        const list = prev[messageId] || [];
        const filtered = list.filter((r) => r.id !== reactionId);
        const updated = { ...prev, [messageId]: filtered };
        _reactCache[conversationId] = updated;
        return updated;
      });

      reactionPendingRef.current.set(key, { type: "remove", resolved: false });

      try {
        await clearOwnReaction(messageId, reactionId);
        reactionPendingRef.current.set(key, { type: "remove", resolved: true });
        setTimeout(() => reactionPendingRef.current.delete(key), 500);
      } catch {
        // Rollback: restore and mark desired again
        reactionPendingRef.current.delete(key);
        reactionDesiredRef.current.set(key, true);
        setReactions((prev) => {
          const list = prev[messageId] || [];
          if (list.some((r) => r.id === reactionId)) return prev;
          const updated = { ...prev, [messageId]: [...list, existing] };
          _reactCache[conversationId] = updated;
          return updated;
        });
      }
    } else {
      // ── ADD path ──
      reactionDesiredRef.current.set(key, true);

      const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const tempReaction = {
        id: tempId,
        message_id: messageId,
        user_id: user.id,
        emoji,
        conversation_id: conversationId,
      };

      setReactions((prev) => {
        const list = prev[messageId] || [];
        if (list.some((r) => r.user_id === user.id && r.emoji === emoji)) return prev;
        const updated = { ...prev, [messageId]: [...list, tempReaction] };
        _reactCache[conversationId] = updated;
        return updated;
      });

      reactionPendingRef.current.set(key, { type: "add", resolved: false });

      try {
        await upsertReaction(
          messageId,
          emoji,
          otherUser?.id,
          otherUser?.publicKey,
        );
        reactionPendingRef.current.set(key, { type: "add", resolved: true });
        setTimeout(() => reactionPendingRef.current.delete(key), 500);
      } catch {
        // Rollback: remove temp and clear desired
        reactionPendingRef.current.delete(key);
        reactionDesiredRef.current.delete(key);
        setReactions((prev) => {
          const list = prev[messageId] || [];
          const updated = {
            ...prev,
            [messageId]: list.filter((r) => r.id !== tempId),
          };
          _reactCache[conversationId] = updated;
          return updated;
        });
      }
    }
  };

  const handleReact = async (messageId, emoji) => {
    // Legacy alias — delegates to toggleReaction for badge clicks,
    // but pill clicks should use addReaction directly.
    return toggleReaction(messageId, emoji);
  };

  const toggleSelect = (msgId) => {
    setSelectedMsgs((prev) => {
      const n = new Set(prev);
      n.has(msgId) ? n.delete(msgId) : n.add(msgId);
      return n;
    });
  };

  // ── Conv header delete handlers ───────────────────────────────────────────
  const handleDeleteForMe = async () => {
    setDeleting(true);
    setDeleteStatus("");
    try {
      if (otherUser?.id) {
        await hideChatForMe(otherUser.id);
      }
      clearChatPersistentCache(user?.id, conversationId);
      onClose();
    } catch (err) {
      setDeleteStatus("Failed: " + err.message);
      setDeleting(false);
    }
  };

  const handleDeleteForAll = async () => {
    setDeleting(true);
    setDeleteStatus("");
    try {
      if (otherUser?.id) {
        await deleteChatForEveryone(otherUser.id);
      }
      clearChatPersistentCache(user?.id, conversationId);
      onClose();
    } catch (err) {
      setDeleteStatus("Failed: " + err.message);
      setDeleting(false);
    }
  };

  const handleUnfriendFromChat = () => {
    setShowMenu(false);
    setConfirmUnfriend(true);
  };
  const handleBlockFromChat = () => {
    setShowMenu(false);
    setConfirmBlock(true);
  };
  const doBlockFromChat = async () => {
    setConfirmBlock(false);
    if (!otherUser) return;
    try {
      await blockUser(user.id, otherUser.id);
      onClose();
    } catch (err) {
      setDeleteStatus("Failed: " + err.message);
    }
  };
  const doUnfriendFromChat = async () => {
    setConfirmUnfriend(false);
    if (!otherUser) return;
    try {
      const row = await getFriendshipBetween(user.id, otherUser.id);
      if (row?.id) await removeFriendship(row.id);
      // Refresh friend list explicitly
      if (onFriendListRefresh) onFriendListRefresh();
      onClose();
    } catch (err) {
      setDeleteStatus("Failed: " + err.message);
    }
  };

  const msgReactions = (id) => {
    const r = reactions[id] || [];
    const g = {};
    r.forEach((x) => {
      if (!g[x.emoji]) g[x.emoji] = [];
      g[x.emoji].push(x.user_id);
    });
    return g;
  };

  const getMessageStatus = (msg) => {
    if (msg?.failed) return "failed";
    const hasSeen = Boolean(msg?.seen_at || msg?.read_at);
    const hasDelivered = Boolean(msg?.delivered_at);
    const impliedDelivered =
      msg?.sender_id === user?.id &&
      !msg?.pending &&
      !msg?.failed &&
      !String(msg?.id || "").startsWith("tmp_");
    if (hasSeen) return "seen";
    if (hasDelivered || impliedDelivered) return "delivered";
    return "sent";
  };

  const handleRetrySend = async (msgId) => {
    const msg = messages.find((m) => String(m.id) === String(msgId));
    if (!msg || !msg.content || !otherUser?.id) return;
    // Re-queue the message
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const clientMessageId = `cmsg_${user.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // Remove the failed message
    setMessages((prev) => prev.filter((m) => String(m.id) !== String(msgId)));
    // Add as pending
    const newMsg = {
      ...msg,
      id: tempId,
      clientMessageId,
      client_message_id: clientMessageId,
      pending: true,
      failed: false,
      delivered_at: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, newMsg]);
    outboxQueueRef.current.push({
      tempId,
      clientMessageId,
      friendId: otherUser.id,
      friendPublicKey: otherUser.publicKey || null,
      text: msg.content,
      replyToMessageId: msg.reply_to_message_id || null,
    });
    outboxPlainByClientRef.current.set(clientMessageId, msg.content);
    flushOutbox();
  };

  // ── Render guards ─────────────────────────────────────────────────────────
  const s = {
    wrap: {
      position: embedded ? "relative" : "absolute",
      inset: embedded ? "auto" : 0,
      zIndex: embedded ? 1 : 50,
      display: "flex",
      justifyContent: embedded || fullView ? "stretch" : "center",
      alignItems: embedded || fullView ? "stretch" : "center",
      background: embedded ? "transparent" : fullView ? "transparent" : theme.bg,
      padding: embedded ? 0 : fullView ? 0 : 16,
      width: "100%",
      height: "100%",
    },
    card: {
      width: "100%",
      maxWidth: embedded ? "100%" : fullView ? "100%" : 480,
      height: "100%",
      background: theme.surface,
      boxShadow: embedded ? "none" : fullView ? "none" : theme.cardShadow,
      borderRadius: embedded ? 0 : fullView ? 0 : 28,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column",
      position: "relative",
    },
  };

  if (initialising && messages.length === 0) {
    return (
      <div style={s.wrap}>
        <div
          style={{ ...s.card, alignItems: "center", justifyContent: "center" }}
        >
          <div
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              border: `2px solid ${theme.border}`,
              borderTopColor: theme.primary,
              animation: "spin 0.8s linear infinite",
              marginBottom: 10,
            }}
          />
          <div style={{ color: theme.text2, fontSize: 13 }} />
        </div>
      </div>
    );
  }

  // Guard: don't render if we don't have valid user or conversation data
  if (!user?.id || !conversationId || status === "Chat not found.") {
    return (
      <div style={s.wrap}>
        <div
          style={{ ...s.card, alignItems: "center", justifyContent: "center" }}
        >
          <div style={{ color: theme.text2 }}>
            {!user?.id ? "Loading user…" : "Chat not found."}
          </div>
          <button
            onClick={onClose}
            style={{
              marginTop: 16,
              padding: "8px 24px",
              borderRadius: 12,
              background: theme.primary,
              color: theme.primaryFg,
              border: "none",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  const inputBtnActive = input.trim();

  return (
    <div style={s.wrap}>
      <div ref={cardRef} style={s.card} className="modal-enter">
        {/* ── Header ── */}
        <div
          style={{
            background: theme.headerBg,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            position: "relative",
          }}
        >
          {!embedded && (
            <button
              onClick={onClose}
              style={{
                width: 34,
                height: 34,
                borderRadius: "50%",
                background: theme.headerBtn,
                border: "none",
                color: theme.headerFg,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <BackIcon size={17} />
            </button>
          )}
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: theme.primary,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: theme.primaryFg,
              fontWeight: 800,
              fontSize: 16,
              flexShrink: 0,
              boxShadow: `0 0 8px ${theme.primaryGlow}`,
            }}
          >
              {(otherUser?.username || "anonymous").charAt(0).toUpperCase() || "A"}
            </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 700,
                color: theme.headerFg,
                fontSize: 15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {otherUser?.username || "anonymous"}
            </div>
            <div
              style={{
                fontSize: 11,
                color: theme.success,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <LockIcon
                size={11}
                style={{ filter: `drop-shadow(0 0 3px ${theme.success})` }}
              />
              End-to-end encrypted
            </div>
          </div>
          <button
            onClick={() => setShowMenu((v) => !v)}
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: theme.headerBtn,
              border: "none",
              color: theme.primary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: `0 0 8px ${theme.primaryGlow}`,
            }}
          >
            <MenuDotsIcon size={17} style={{ color: theme.primary }} />
          </button>

          {/* Header menu dropdown */}
          {showMenu && (
            <>
              <div
                onClick={() => setShowMenu(false)}
                style={{ position: "fixed", inset: 0, zIndex: 998 }}
              />
              <div
                className="dropdown-enter"
                style={{
                  position: "absolute",
                  top: 58,
                  right: 12,
                  background: theme.surface,
                  borderRadius: 16,
                  padding: "6px 0",
                  boxShadow: `0 8px 32px rgba(0,0,0,0.25), 0 0 0 1px ${theme.border}`,
                  zIndex: 999,
                  width: "max-content",
                  overflow: "hidden",
                }}
              >
                {[
                  {
                    label: "Delete for me",
                    sub: "Removes from your list",
                    color: theme.text,
                    fn: () => {
                      setShowMenu(false);
                      handleDeleteForMe();
                    },
                  },
                  {
                    label: "Delete for everyone",
                    sub: "Removes for both users",
                    color: theme.danger,
                    fn: () => {
                      setShowMenu(false);
                      handleDeleteForAll();
                    },
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={item.fn}
                    disabled={deleting}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      background: "none",
                      border: "none",
                      color: item.color,
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = theme.surface2)
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "none")
                    }
                  >
                    <TrashIcon size={15} style={{ flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{item.label}</div>
                      <div
                        style={{
                          fontSize: 11,
                          color: theme.text3,
                          marginTop: 1,
                        }}
                      >
                        {item.sub}
                      </div>
                    </div>
                  </button>
                ))}
                <div
                  style={{
                    height: 1,
                    background: theme.border,
                    margin: "3px 0",
                  }}
                />
                <button
                  onClick={handleUnfriendFromChat}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "none",
                    border: "none",
                    color: theme.warning,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = theme.surface2)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <UserMinusIcon size={15} style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Unfriend</div>
                    <div
                      style={{ fontSize: 11, color: theme.text3, marginTop: 1 }}
                    >
                      Remove from friends list
                    </div>
                  </div>
                </button>
                <button
                  onClick={handleBlockFromChat}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    background: "none",
                    border: "none",
                    color: theme.danger,
                    fontSize: 13,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = theme.surface2)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "none")
                  }
                >
                  <BlockIcon size={15} style={{ flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600 }}>Block</div>
                    <div
                      style={{ fontSize: 11, color: theme.text3, marginTop: 1 }}
                    >
                      Block and delete chat
                    </div>
                  </div>
                </button>
                {deleteStatus && (
                  <div
                    style={{
                      padding: "8px 14px",
                      fontSize: 11,
                      color: theme.danger,
                      borderTop: `1px solid ${theme.border}`,
                    }}
                  >
                    {deleteStatus}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {status && (
          <div
            style={{
              padding: "6px 14px",
              background: `${theme.warning}22`,
              color: theme.warning,
              fontSize: 11,
              borderBottom: `1px solid ${theme.warning}44`,
            }}
          >
            {status}
          </div>
        )}
        {syncing && !status && (
          <div
            style={{
              position: "absolute",
              top: 70,
              right: 12,
              zIndex: 90,
              padding: "6px 10px",
              borderRadius: 12,
              background: `${theme.surface}f2`,
              color: theme.primary,
              fontSize: 11,
              border: `1px solid ${theme.primary}33`,
              boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                border: `2px solid ${theme.primary}66`,
                borderTopColor: theme.primary,
                display: "inline-block",
                animation: "spin 0.8s linear infinite",
              }}
            />
            Syncing new messages...
          </div>
        )}

        {/* ── Conversation closed overlay ── */}
        {conversationClosed && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.82)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 200,
              borderRadius: 28,
              gap: 14,
              animation: "floatIn 0.28s ease",
            }}
          >
            {/* Countdown circle */}
            <div style={{ position: "relative", width: 80, height: 80 }}>
              <svg
                width="80"
                height="80"
                style={{ transform: "rotate(-90deg)" }}
              >
                {/* Background circle */}
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  fill="none"
                  stroke={`${theme.primary}33`}
                  strokeWidth="6"
                />
                {/* Progress circle - matches theme primary color */}
                <circle
                  cx="40"
                  cy="40"
                  r="35"
                  fill="none"
                  stroke={theme.primary}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 35}`}
                  strokeDashoffset={`${2 * Math.PI * 35 * (1 - Math.max(0, closeCountdown) / 3)}`}
                  style={{
                    transition: "stroke-dashoffset 1s linear",
                    filter: `drop-shadow(0 0 6px ${theme.primaryGlow})`,
                  }}
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: theme.primary,
                  fontSize: 24,
                  fontWeight: 800,
                  textShadow: `0 0 12px ${theme.primaryGlow}`,
                }}
              >
                {closeCountdown}
              </div>
            </div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 20 }}>
              Conversation Closed
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.7)",
                fontSize: 13,
                textAlign: "center",
                maxWidth: 260,
                lineHeight: 1.6,
              }}
            >
              This chat was deleted by the other person.
            </div>
            <button
              onClick={() => {
                clearInterval(countdownRef.current);
                onClose();
              }}
              style={{
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.25)",
                color: "#fff",
                borderRadius: 14,
                padding: "10px 24px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Close Now
            </button>
          </div>
        )}

        {/* ── Messages ── */}
        <div
          style={{
            position: "relative",
            flex: 1,
            minHeight: 0,
            isolation: "isolate",
          }}
        >
          <div
            ref={msgsContainerRef}
            onScroll={handleScroll}
            onClick={() => {
              if (popup) closePopup();
            }}
            style={{
              position: "relative",
              height: "100%",
              overflowY: "auto",
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              background: theme.bg,
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  gap: 8,
                }}
              >
                <div style={{ color: theme.text2, fontSize: 13 }}>
                  No messages yet. Say hello! 👋
                </div>
              </div>
            ) : (
              <>
                {messages.length >= 50 && (
                  <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
                    <button
                      onClick={loadOlderMessages}
                      disabled={loadingOlder}
                      style={{
                        border: `1px solid ${theme.border}`,
                        background: theme.surface2,
                        color: theme.text2,
                        borderRadius: 14,
                        padding: "6px 12px",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: loadingOlder ? "default" : "pointer",
                        opacity: loadingOlder ? 0.7 : 1,
                      }}
                    >
                      {loadingOlder ? "Loading older messages..." : "Load older messages"}
                    </button>
                  </div>
                )}
              {(() => {
                // Pre-compute: which messages are "last in a consecutive run" by same sender
                const items = [];
                let lastDateLabel = null;

                messages.forEach((msg, idx) => {
                  // Skip messages that are still being decrypted (no content, not failed, not mine)
                  if (!msg.failed && msg.sender_id !== user?.id && !msg.content && msg.encrypted_content) {
                    return;
                  }
                  const dateLabel = formatDateLabel(msg.created_at);
                  if (dateLabel !== lastDateLabel) {
                    items.push({
                      type: "date",
                      label: dateLabel,
                      key: `date_${msg.id}`,
                    });
                    lastDateLabel = dateLabel;
                  }
                  const nextMsg = messages[idx + 1];
                  const isLastInRun =
                    !nextMsg ||
                    nextMsg.sender_id !== msg.sender_id ||
                    formatDateLabel(nextMsg.created_at) !== dateLabel;
                  items.push({ type: "msg", msg, isLastInRun });
                });

                return items.map((item) => {
                  if (item.type === "date")
                    return (
                      <div
                        key={item.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 10,
                          margin: "10px 0 6px",
                          flexShrink: 0,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: 1,
                            background: theme.border,
                          }}
                        />
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: theme.text3,
                            background: theme.surface2,
                            padding: "3px 12px",
                            borderRadius: 20,
                            border: `1px solid ${theme.border}`,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {item.label}
                        </div>
                        <div
                          style={{
                            flex: 1,
                            height: 1,
                            background: theme.border,
                          }}
                        />
                      </div>
                    );

                  const { msg, isLastInRun } = item;
                  const isMine = msg.sender_id === user.id;
                  const reactionMap = msgReactions(msg.id);
                  const hasReacts = Object.keys(reactionMap).length > 0;
                  const isSelected = selectedMsgs.has(msg.id);
                  const isPopupOpen = popup?.msgId === msg.id;

                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: isMine ? "flex-end" : "flex-start",
                        marginBottom: isLastInRun ? (hasReacts ? 20 : 8) : 2,
                        position: "relative",
                        animation: msg.pending || String(msg.id || "").startsWith("tmp_")
                          ? "msgAppear 0.22s cubic-bezier(0.22,1,0.36,1) both"
                          : "none",
                      }}
                    >
                      {/* Bubble row */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-end",
                          gap: 4,
                          flexDirection: isMine ? "row-reverse" : "row",
                          maxWidth: "85%",
                          alignSelf: isMine ? "flex-end" : "flex-start",
                        }}
                      >
                        {/* Message bubble — tap opens popup */}
                        <div
                          ref={(el) => {
                            if (el) msgRefs.current[`bubble_${msg.id}`] = el;
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectMode) {
                              toggleSelect(msg.id);
                              return;
                            }
                            if (isPopupOpen) {
                              closePopup();
                              return;
                            }
                            openPopup("menu", msg.id);
                          }}
                          style={{
                            padding: "9px 14px",
                            borderRadius: isMine
                              ? "18px 18px 4px 18px"
                              : "18px 18px 18px 4px",
                            background: isSelected
                              ? isMine
                                ? `${theme.sent}99`
                                : theme.surface2
                              : isMine
                                ? theme.sent
                                : theme.recv,
                            color: isMine ? theme.sentFg : theme.recvFg,
                            border: isSelected
                              ? `2px solid ${theme.primary}`
                              : isMine
                                ? "none"
                                : `1px solid ${theme.recvBorder}`,
                            fontSize: 14,
                            lineHeight: 1.45,
                            wordBreak: "break-word",
                            cursor: "pointer",
                            maxWidth: "100%",
                            boxShadow: isSelected
                              ? `0 0 0 3px ${theme.primary}44`
                              : isMine
                                ? `0 2px 12px ${theme.sent}44`
                                : "0 1px 4px rgba(0,0,0,0.1)",
                            transition:
                              "background 0.12s, border 0.12s, box-shadow 0.12s, outline 0.1s",
                            outline: isPopupOpen
                              ? `3px solid ${theme.primary}88`
                              : "none",
                            outlineOffset: isPopupOpen ? 2 : 0,
                          }}
                          dir="auto"
                          >
                           {msg.reply_to_message_id && (
                            <div
                              style={{
                                marginBottom: 6,
                                padding: "6px 8px",
                                borderRadius: 10,
                                border: `1px solid ${isMine ? `${theme.sentFg}55` : theme.border}`,
                                background: isMine ? `${theme.sentFg}22` : theme.surface2,
                                fontSize: 11,
                                color: isMine ? `${theme.sentFg}E0` : theme.text2,
                              }}
                            >
                              <span style={{ fontWeight: 700, marginRight: 6 }}>
                                Reply
                              </span>
                              {messages.find((m) => m.id === msg.reply_to_message_id)?.content ||
                                ""}
                            </div>
                          )}
                          {!msg.content && msg.failed ? (
                            <span style={{ fontStyle: "italic", opacity: 0.7 }}>Message failed to send</span>
                          ) : msg.content ? (
                            msg.content
                          ) : null}
                          <div
                            style={{
                              fontSize: 10,
                              marginTop: 3,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "flex-end",
                              gap: 3,
                              direction: "ltr",
                              unicodeBidi: "isolate",
                              color: isMine ? theme.sentTime : theme.recvTime,
                            }}
                            >
                            {/* Sent messages: (edited) → timestamp → ticks */}
                            {isMine && (
                              <>
                                {msg.is_edited && (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      color: "rgba(255,255,255,0.7)",
                                      marginRight: 2,
                                      fontStyle: "italic",
                                    }}
                                  >
                                    (edited)
                                  </span>
                                )}
                                <span>
                                  {new Date(msg.created_at).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {msg.failed ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRetrySend(msg.id);
                                    }}
                                    style={{
                                      background: "none",
                                      border: "none",
                                      cursor: "pointer",
                                      padding: "0 2px",
                                      display: "flex",
                                      alignItems: "center",
                                      opacity: 0.8,
                                    }}
                                    title="Retry sending"
                                  >
                                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                                      <polyline points="1 4 1 10 7 10" />
                                      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                                    </svg>
                                  </button>
                                ) : getMessageStatus(msg) === "seen" ? (
                                  <TickSeenIcon
                                    size={15}
                                    style={{
                                      color: "#ffffff",
                                      filter: `drop-shadow(0 0 3px ${theme.primary}66) drop-shadow(0 0 6px ${theme.primary}44)`,
                                    }}
                                  />
                                ) : getMessageStatus(msg) === "delivered" ? (
                                  <TickDeliveredIcon
                                    size={15}
                                    style={{ color: "rgba(0,0,0,0.45)" }}
                                  />
                                ) : (
                                  <TickSentIcon
                                    size={14}
                                    style={{ color: "rgba(0,0,0,0.35)" }}
                                  />
                                )}
                              </>
                            )}
                            {/* Received messages: timestamp → (edited) */}
                            {!isMine && (
                              <>
                                <span>
                                  {new Date(msg.created_at).toLocaleTimeString([], {
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                                {msg.is_edited && (
                                  <span
                                    style={{
                                      fontSize: 9,
                                      color: theme.text2,
                                      marginLeft: 2,
                                      fontStyle: "italic",
                                    }}
                                  >
                                    (edited)
                                  </span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Reaction badges on original message - click to toggle */}
                      {hasReacts && (
                        <div
                          style={{
                            display: "flex",
                            gap: 3,
                            flexWrap: "wrap",
                            marginTop: -4,
                            justifyContent: isMine ? "flex-end" : "flex-start",
                            paddingLeft: isMine ? 0 : 10,
                            paddingRight: isMine ? 10 : 0,
                          }}
                        >
                          {Object.entries(reactionMap).map(([emoji, uids]) => {
                            const mine = uids.includes(user.id);
                            return (
                              <button
                                key={emoji}
                                onClick={() => toggleReaction(msg.id, emoji)}
                                onContextMenu={(e) => {
                                  e.preventDefault();
                                  if (mine) toggleReaction(msg.id, emoji);
                                }}
                                style={{
                                  background: mine
                                    ? theme.reactionActive
                                    : theme.reactionBg,
                                  border: `1px solid ${mine ? theme.reactionActiveBorder : theme.border}`,
                                  borderRadius: 12,
                                  padding: "1px 6px",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  color: theme.reactionText,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 2,
                                }}
                              >
                                {emoji}{" "}
                                <span style={{ fontSize: 10, fontWeight: 600 }}>
                                  {uids.length}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Sender name — only on last message in a consecutive run */}
                      {isLastInRun && (
                        <div
                          style={{
                            fontSize: 10,
                            color: theme.text3,
                            marginTop: 2,
                            paddingLeft: isMine ? 0 : 4,
                            paddingRight: isMine ? 4 : 0,
                          }}
                        >
                          {isMine ? "You" : (otherUser?.username || "anonymous")}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
              </>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* ── Scroll to bottom button — single instance ── */}
        {showScrollBtn && (
          <button
            onClick={() => {
              const c = msgsContainerRef.current;
              if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
            }}
            style={{
              position: "absolute",
              right: 14,
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              color: theme.text2,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: `0 4px 16px rgba(0,0,0,0.22), 0 0 0 1px ${theme.border}`,
              zIndex: 20,
              animation: "floatIn 0.18s cubic-bezier(0.22,1,0.36,1) both",
              transition: "background 0.15s",
              top: inputBarRef.current
                ? Math.max(16, inputBarRef.current.offsetTop - 38 - 16)
                : undefined,
              bottom: inputBarRef.current
                ? undefined
                : selectMode
                  ? 84
                  : editingMsg
                    ? 84
                    : 76,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = theme.surface2)
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = theme.surface)
            }
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        )}

        {/* ── New messages badge ── */}
        {newMsgCount > 0 && (
          <button
            onClick={() => {
              if (firstNewMsgIdRef.current) {
                const el = msgRefs.current[`bubble_${firstNewMsgIdRef.current}`];
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                } else {
                  const c = msgsContainerRef.current;
                  if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
                }
              } else {
                const c = msgsContainerRef.current;
                if (c) c.scrollTo({ top: c.scrollHeight, behavior: "smooth" });
              }
            }}
            style={{
              position: "absolute",
              right: 60,
              padding: "5px 12px",
              background: theme.primary,
              color: theme.primaryFg || "#fff",
              border: "none",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              boxShadow: `0 2px 12px ${theme.primaryGlow}`,
              zIndex: 20,
              animation: "floatInUp 0.2s cubic-bezier(0.22,1,0.36,1) both",
              letterSpacing: 0.2,
              whiteSpace: "nowrap",
              top: inputBarRef.current
                ? Math.max(16, inputBarRef.current.offsetTop - 30 - 16)
                : undefined,
              bottom: inputBarRef.current ? undefined : selectMode ? 90 : editingMsg ? 90 : 82,
            }}
          >
            New messages ({newMsgCount})
          </button>
        )}


        {/* ── Select mode bar ── */}
        {selectMode && (
          <div
            style={{
              padding: "10px 14px",
              borderTop: `2px solid ${theme.primary}`,
              background: theme.surface2,
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span
                style={{ fontSize: 13, color: theme.text2, fontWeight: 600 }}
              >
                {selectedMsgs.size} selected
              </span>
              <button
                onClick={() => {
                  setSelectMode(false);
                  setSelectedMsgs(new Set());
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: theme.text3,
                  fontSize: 12,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                Cancel
              </button>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                {
                  label: `Delete for me (${selectedMsgs.size})`,
                  bg: theme.surface,
                  color: theme.text,
                  border: `1px solid ${theme.border}`,
                  fn: () => handleDeleteMsgForMe(null),
                },
                {
                  label: `Delete for all (${selectedMsgs.size})`,
                  bg: theme.danger,
                  color: theme.dangerFg,
                  border: "none",
                  fn: () => handleDeleteMsgForAll(null),
                },
              ].map((b) => (
                <button
                  key={b.label}
                  onClick={b.fn}
                  disabled={selectedMsgs.size === 0}
                  style={{
                    flex: 1,
                    padding: "10px",
                    borderRadius: 12,
                    background: b.bg,
                    color: b.color,
                    fontWeight: 700,
                    fontSize: 12,
                    border: b.border,
                    cursor: selectedMsgs.size > 0 ? "pointer" : "default",
                    opacity: selectedMsgs.size > 0 ? 1 : 0.4,
                  }}
                >
                  {b.label}
                </button>
              ))}
            </div>
            </div>
          )}

        {/* ── Input / Edit ── */}
        {!selectMode &&
          (editingMsg ? (
            <div
              ref={inputBarRef}
              style={{
                padding: "10px 14px",
                borderTop: `1px solid ${theme.primary}44`,
                background: theme.surface,
                flexShrink: 0,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: theme.primary,
                  fontWeight: 600,
                  marginBottom: 6,
                  paddingLeft: 4,
                }}
              >
                Editing message
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  value={editInput}
                  onChange={(e) => {
                    setEditInput(e.target.value);
                    // Detect RTL based on first character for edit input
                    if (e.target.value) {
                      const firstChar = e.target.value[0];
                      const isRTL =
                        /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
                          firstChar,
                        );
                      e.target.style.direction = isRTL ? "rtl" : "ltr";
                      e.target.style.textAlign = isRTL ? "right" : "start";
                    } else {
                      e.target.style.direction = "ltr";
                      e.target.style.textAlign = "start";
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) handleSaveEdit();
                    if (e.key === "Escape") {
                      setEditingMsg(null);
                      setEditInput("");
                    }
                  }}
                  dir="ltr"
                  style={{
                    flex: 1,
                    flexShrink: 1,
                    maxWidth: "70%",
                    padding: "10px 14px",
                    borderRadius: 20,
                    border: `1.5px solid ${theme.primary}`,
                    background: theme.inputBg,
                    color: theme.text,
                    fontSize: 14,
                    outline: "none",
                    direction: "auto",
                    textAlign: "start",
                  }}
                  autoFocus
                />
                <button
                  onClick={handleSaveEdit}
                  disabled={!editInput.trim()}
                  style={{
                    minWidth: 34,
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: theme.primary,
                    color: theme.primaryFg,
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: `0 0 10px ${theme.primaryGlow}`,
                    flexShrink: 0,
                  }}
                >
                  <CheckIcon size={16} />
                </button>
                <button
                  onClick={() => {
                    setEditingMsg(null);
                    setEditInput("");
                  }}
                  style={{
                    minWidth: 34,
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: theme.surface2,
                    color: theme.text2,
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  <CloseIcon size={16} />
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={inputBarRef}
              style={{
                padding: "10px 14px",
                borderTop: `1px solid ${theme.border}`,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                background: theme.surface,
                flexShrink: 0,
                alignItems: "stretch",
              }}
            >
              {replyTarget && (
                <div
                  style={{
                    background: theme.surface2,
                    border: `1px solid ${theme.border}`,
                    borderRadius: 10,
                    padding: "7px 10px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        color: theme.primary,
                        fontWeight: 700,
                        fontSize: 11,
                        marginBottom: 2,
                      }}
                    >
                      Replying to {replyTarget.sender_id === user.id ? "yourself" : (otherUser?.username || "friend")}
                    </div>
                    <div
                      style={{
                        color: theme.text2,
                        fontSize: 12,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 280,
                      }}
                    >
                      {replyTarget.content ? replyTarget.content : "Message"}
                    </div>
                  </div>
                  <button
                    onClick={() => setReplyTarget(null)}
                    style={{
                      border: "none",
                      background: "none",
                      color: theme.text3,
                      cursor: "pointer",
                      padding: 2,
                    }}
                  >
                    <CloseIcon size={14} />
                  </button>
                </div>
              )}
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-end",
                }}
              >
                <textarea
                  id="chat-input-box"
                  value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  // Detect RTL based on the current input - if there's text, check first char
                  // This allows direction to update when user starts typing in a different language
                  if (e.target.value) {
                    const firstChar = e.target.value[0];
                    const isRTL =
                      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(
                        firstChar,
                      );
                    setInputDir(isRTL ? "rtl" : "ltr");
                  } else {
                    // Reset to ltr when empty to keep placeholder LTR
                    setInputDir("ltr");
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (input.trim()) handleSend();
                  }
                }}
                placeholder="Type a message…"
                rows={1}
                dir="ltr"
                style={{
                  flex: 1,
                  padding: "8px 16px",
                  borderRadius: 20,
                  borderRadius: 20,
                  border: `1.5px solid ${theme.inputBorder}`,
                  background: theme.inputBg,
                  color: theme.text,
                  fontSize: 14,
                  outline: "none",
                  resize: "none",
                  minHeight: "40px",
                  maxHeight: "120px",
                  lineHeight: 1.4,
                  fontFamily: "inherit",
                  overflow: "hidden",
                  direction: inputDir,
                  textAlign: inputDir === "rtl" ? "right" : "left",
                }}
                onFocus={(e) => {
                  e.target.style.boxShadow = `0 0 0 3px ${theme.primaryGlow}`;
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onBlur={(e) => (e.target.style.boxShadow = "none")}
                onInput={(e) => {
                  e.target.style.height = "auto";
                  e.target.style.height =
                    Math.min(e.target.scrollHeight, 120) + "px";
                }}
              />
              <button
                onClick={handleSend}
                disabled={!inputBtnActive}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: inputBtnActive ? theme.primary : theme.surface2,
                  color: inputBtnActive ? theme.primaryFg : theme.text3,
                  border: "none",
                  cursor: inputBtnActive ? "pointer" : "default",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.15s",
                  flexShrink: 0,
                  boxShadow: inputBtnActive
                    ? `0 0 14px ${theme.primaryGlow}`
                    : "none",
                }}
              >
                <SendIcon size={18} />
              </button>
              </div>
            </div>
          ))}
      </div>

      {/* ══ POPUP - floating overlay with dynamic repositioning ════════ */}
      {popup && popupRect && (() => {
          const popupContent = (() => {
          const msg = messages.find((m) => m.id === popup.msgId);
          if (!msg) return null;
          const isMine = msg.sender_id === user.id;
          const HEADER_H = 60;
          const INPUT_H = 70;
          const REACT_H = 46;
          const MENU_H = 130;
          const GAP = 4;
          const PADDING = 16;
          const MSG_H = popupRect.height;

          const container = msgsContainerRef.current?.getBoundingClientRect();
          const contLeft = container?.left || 0;
          const contWidth = container?.width || 380;
          const contTop = container?.top || 0;
          const contHeight = container?.height || 400;
          const contBottom = contTop + contHeight;

          const INPUT_TOP = contBottom - INPUT_H;
          const screenHeight = contHeight;

          const overlayWidth = Math.min(
            Math.max(0, popupRect.width || 0),
            Math.max(0, contWidth - 16),
          );
          const leftCandidate = isMine
            ? popupRect.right - overlayWidth
            : popupRect.left;
          const leftPos = Math.max(
            contLeft + 8,
            Math.min(leftCandidate, contLeft + contWidth - overlayWidth - 8),
          );

          const isLongMessage = MSG_H > screenHeight * 0.5;

          let messageTop = popupRect.top;
          let positionMode = "normal";

          const dropdownBottom = messageTop + MSG_H + GAP + MENU_H;
          const isBottomCollision = dropdownBottom > INPUT_TOP - 10;
          const isTopCollision = messageTop < contTop + HEADER_H + 10;

          if (isLongMessage) {
            const spaceAbove = messageTop - (contTop + HEADER_H);
            const spaceBelow = INPUT_TOP - (messageTop + MSG_H);
            
            if (spaceBelow >= spaceAbove) {
              messageTop = INPUT_TOP - GAP - MENU_H - GAP - MSG_H;
              positionMode = "longMsgAnchorAbove";
            } else {
              messageTop = contTop + HEADER_H + 10;
              positionMode = "longMsgPushDown";
            }
          } else if (isBottomCollision && !isTopCollision) {
            messageTop = INPUT_TOP - GAP - MENU_H - GAP - MSG_H;
            positionMode = "anchorAbove";
          } else if (isTopCollision) {
            messageTop = contTop + HEADER_H + 10;
            positionMode = "pushDown";
          }

          const rawGroupTop = messageTop - REACT_H - GAP;
          const groupTop = Math.max(
            contTop + HEADER_H + 8,
            Math.min(rawGroupTop, INPUT_TOP - MENU_H - REACT_H - 8),
          );

          const pillStyle = {
            background: theme.surface,
            borderRadius: 24,
            boxShadow: `0 4px 20px rgba(0,0,0,0.25), 0 0 0 1px ${theme.border}`,
          };

          const sc = theme.seenTickColor || theme.sentFg;

          const utilityZIndex = 9992;
          const messageZIndex = 9991;

          const useFloatingLayer = positionMode === "longMsgAnchorAbove" || positionMode === "longMsgPushDown";

          return (
            <div
              onClick={closePopup}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 9990,
                background: "rgba(0,0,0,0)",
                backdropFilter: "blur(0px)",
                WebkitBackdropFilter: "blur(0px)",
                animation: "fadeIn 200ms forwards",
              }}
            >
              <style>{`
              @keyframes fadeIn {
                from { background: rgba(0,0,0,0); backdrop-filter: blur(0px); }
                to { background: rgba(0,0,0,0.5); backdrop-filter: blur(4px); }
              }
              @keyframes slideDownReveal {
                from { opacity: 0; transform: translateY(-8px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes scaleReveal {
                from { opacity: 0; transform: translateY(8px) scale(0.98); }
                to { opacity: 1; transform: translateY(0) scale(1); }
              }
              @keyframes menuReveal {
                from { opacity: 0; transform: translateY(6px); }
                to { opacity: 1; transform: translateY(0); }
              }
            `}</style>
              {useFloatingLayer ? (
                <div
                  style={{
                    position: "fixed",
                    zIndex: utilityZIndex,
                    left: leftPos,
                    top: groupTop,
                    width: overlayWidth,
                  }}
                >
                  {positionMode === "longMsgAnchorAbove" ? (
                    <>
                      <div
                        style={{
                          position: "relative",
                          zIndex: messageZIndex,
                          padding: "9px 14px",
                          borderRadius: isMine
                            ? "18px 18px 4px 18px"
                            : "18px 18px 18px 4px",
                          background: isMine ? theme.sent : theme.recv,
                          color: isMine ? theme.sentFg : theme.recvFg,
                          boxShadow: isMine
                            ? `0 8px 32px ${theme.sent}66, 0 2px 24px ${theme.sent}88`
                            : `0 8px 24px rgba(0,0,0,0.3), 0 2px 12px rgba(0,0,0,0.2)`,
                          fontSize: 14,
                          lineHeight: 1.45,
                          wordBreak: "break-word",
                          outline: `3px solid ${theme.primary}88`,
                          outlineOffset: 2,
                          marginBottom: GAP,
                          transform: "scale(1.03)",
                          animation: "scaleReveal 200ms 80ms forwards",
                          opacity: 0,
                        }}
                        dir="auto"
                      >
                        {msg.content}
                        <div
                          style={{
                            fontSize: 10,
                            marginTop: 3,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 3,
                            direction: "ltr",
                            unicodeBidi: "isolate",
                            color: isMine ? theme.sentTime : theme.recvTime,
                          }}
                        >
                          {isMine ? (
                            <>
                              {msg.is_edited && (
                                <span style={{ fontSize: 9, color: `${theme.sentFg}B8`, fontStyle: "italic" }}>
                                  (edited)
                                </span>
                              )}
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {(() => {
                                const status = getMessageStatus(msg);
                                if (status === "seen")
                                  return (
                                    <TickSeenIcon
                                      size={15}
                                      style={{
                                        color: sc,
                                        filter: `drop-shadow(0 0 3px ${sc}) drop-shadow(0 0 6px ${sc}BB)`,
                                      }}
                                    />
                                  );
                                if (status === "delivered")
                                  return (
                                    <TickDeliveredIcon
                                      size={15}
                                      style={{ color: `${theme.sentFg}DD` }}
                                    />
                                  );
                                return (
                                  <TickSentIcon
                                    size={14}
                                    style={{ color: `${theme.sentFg}66` }}
                                  />
                                );
                              })()}
                            </>
                          ) : (
                            <>
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {msg.is_edited && (
                                <span style={{ fontSize: 9, color: theme.text2, fontStyle: "italic" }}>
                                  (edited)
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: isMine ? "flex-end" : "flex-start",
                          marginBottom: GAP,
                          animation: "slideDownReveal 180ms 50ms forwards",
                          opacity: 0,
                        }}
                      >
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <div
                            style={{
                              ...pillStyle,
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              padding: "4px 8px",
                            }}
                          >
                            {customReactions.map((e) => {
                              const active = (reactions[popup.msgId] || []).some(
                                (r) => r.user_id === user.id && r.emoji === e,
                              );
                              return (
                                <button
                                  key={e}
                                  onClick={() => {
                                    if (!active) addReaction(popup.msgId, e);
                                    closePopup();
                                  }}
                                  style={{
                                    background: active
                                      ? `${theme.primary}30`
                                      : "none",
                                    border: active
                                      ? `1.5px solid ${theme.primary}88`
                                      : "1.5px solid transparent",
                                    borderRadius: 10,
                                    cursor: active ? "default" : "pointer",
                                    fontSize: 20,
                                    padding: "4px 6px",
                                  }}
                                >
                                  {e}
                                </button>
                              );
                            })}
                            <div
                              style={{
                                width: 1,
                                height: 18,
                                background: theme.border,
                                margin: "0 6px",
                              }}
                            />
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => {
                                  setShowAddEmoji({ msgId: popup.msgId });
                                  closePopup();
                                }}
                                style={{
                                  background: theme.surface2,
                                  border: "none",
                                  cursor: "pointer",
                                  color: theme.text2,
                                  padding: "6px",
                                  borderRadius: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title="Add reaction"
                              >
                                <PlusIcon size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  setShowEmojiEditor(true);
                                  closePopup();
                                }}
                                style={{
                                  background: theme.surface2,
                                  border: "none",
                                  cursor: "pointer",
                                  color: theme.text2,
                                  padding: "6px",
                                  borderRadius: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title="Edit reaction slots"
                              >
                                <PenIcon size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: isMine ? "flex-end" : "flex-start",
                          animation: "menuReveal 180ms 120ms forwards",
                          opacity: 0,
                        }}
                      >
                        <div
                          style={{
                            ...pillStyle,
                            borderRadius: 14,
                            padding: "6px 0",
                            width: "100%",
                            minWidth: 0,
                          }}
                        >
                          {isMine && (
                            <button
                              onClick={() => handleStartEdit(msg)}
                              style={{
                                width: "100%",
                                padding: "10px 14px",
                                background: "none",
                                border: "none",
                                color: theme.text,
                                fontSize: 13,
                                cursor: "pointer",
                                textAlign: "left",
                                display: "flex",
                                gap: 10,
                                alignItems: "center",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <PenIcon size={14} style={{ color: theme.text2 }} />
                              <span style={{ fontWeight: 600 }}>Edit</span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectMode(true);
                              setSelectedMsgs(new Set([popup.msgId]));
                              closePopup();
                            }}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.text,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <CheckSquareIcon
                              size={14}
                              style={{ color: theme.text2 }}
                            />
                            <span style={{ fontWeight: 600 }}>Select</span>
                          </button>
                          <button
                            onClick={() => handleStartReply(msg)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.text,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <ReplyArrowIcon size={14} style={{ color: theme.text2 }} />
                            <span style={{ fontWeight: 600 }}>Reply</span>
                          </button>
                          <div
                            style={{
                              height: 1,
                              background: theme.border,
                              margin: "2px 8px",
                            }}
                          />
                          <button
                            onClick={() => handleDeleteMsgForMe(popup.msgId)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.text,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <TrashIcon size={14} />
                            <span>Delete for me</span>
                          </button>
                          <button
                            onClick={() => handleDeleteMsgForAll(popup.msgId)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.danger,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <TrashIcon size={14} style={{ color: theme.danger }} />
                            <span>Delete for all</span>
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: isMine ? "flex-end" : "flex-start",
                          marginBottom: GAP,
                          animation: "slideDownReveal 180ms 50ms forwards",
                          opacity: 0,
                        }}
                      >
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <div
                            style={{
                              ...pillStyle,
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                              padding: "4px 8px",
                            }}
                          >
                            {customReactions.map((e) => {
                              const active = (reactions[popup.msgId] || []).some(
                                (r) => r.user_id === user.id && r.emoji === e,
                              );
                              return (
                                <button
                                  key={e}
                                  onClick={() => {
                                    if (!active) addReaction(popup.msgId, e);
                                    closePopup();
                                  }}
                                  style={{
                                    background: active
                                      ? `${theme.primary}30`
                                      : "none",
                                    border: active
                                      ? `1.5px solid ${theme.primary}88`
                                      : "1.5px solid transparent",
                                    borderRadius: 10,
                                    cursor: active ? "default" : "pointer",
                                    fontSize: 20,
                                    padding: "4px 6px",
                                  }}
                                >
                                  {e}
                                </button>
                              );
                            })}
                            <div
                              style={{
                                width: 1,
                                height: 18,
                                background: theme.border,
                                margin: "0 6px",
                              }}
                            />
                            <div style={{ display: "flex", gap: 6 }}>
                              <button
                                onClick={() => {
                                  setShowAddEmoji({ msgId: popup.msgId });
                                  closePopup();
                                }}
                                style={{
                                  background: theme.surface2,
                                  border: "none",
                                  cursor: "pointer",
                                  color: theme.text2,
                                  padding: "6px",
                                  borderRadius: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title="Add reaction"
                              >
                                <PlusIcon size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  setShowEmojiEditor(true);
                                  closePopup();
                                }}
                                style={{
                                  background: theme.surface2,
                                  border: "none",
                                  cursor: "pointer",
                                  color: theme.text2,
                                  padding: "6px",
                                  borderRadius: 12,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                                title="Edit reaction slots"
                              >
                                <PenIcon size={16} />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: isMine ? "flex-end" : "flex-start",
                          animation: "menuReveal 180ms 120ms forwards",
                          opacity: 0,
                          marginBottom: GAP,
                        }}
                      >
                        <div
                          style={{
                            ...pillStyle,
                            borderRadius: 14,
                            padding: "6px 0",
                            width: "100%",
                            minWidth: 0,
                          }}
                        >
                          {isMine && (
                            <button
                              onClick={() => handleStartEdit(msg)}
                              style={{
                                width: "100%",
                                padding: "10px 14px",
                                background: "none",
                                border: "none",
                                color: theme.text,
                                fontSize: 13,
                                cursor: "pointer",
                                textAlign: "left",
                                display: "flex",
                                gap: 10,
                                alignItems: "center",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <PenIcon size={14} style={{ color: theme.text2 }} />
                              <span style={{ fontWeight: 600 }}>Edit</span>
                            </button>
                          )}
                          <button
                            onClick={() => {
                              setSelectMode(true);
                              setSelectedMsgs(new Set([popup.msgId]));
                              closePopup();
                            }}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.text,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <CheckSquareIcon
                              size={14}
                              style={{ color: theme.text2 }}
                            />
                            <span style={{ fontWeight: 600 }}>Select</span>
                          </button>
                          <button
                            onClick={() => handleStartReply(msg)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.text,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <ReplyArrowIcon size={14} style={{ color: theme.text2 }} />
                            <span style={{ fontWeight: 600 }}>Reply</span>
                          </button>
                          <div
                            style={{
                              height: 1,
                              background: theme.border,
                              margin: "2px 8px",
                            }}
                          />
                          <button
                            onClick={() => handleDeleteMsgForMe(popup.msgId)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.text,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <TrashIcon size={14} />
                            <span>Delete for me</span>
                          </button>
                          <button
                            onClick={() => handleDeleteMsgForAll(popup.msgId)}
                            style={{
                              width: "100%",
                              padding: "10px 14px",
                              background: "none",
                              border: "none",
                              color: theme.danger,
                              fontSize: 13,
                              cursor: "pointer",
                              textAlign: "left",
                              display: "flex",
                              gap: 10,
                              alignItems: "center",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <TrashIcon size={14} style={{ color: theme.danger }} />
                            <span>Delete for all</span>
                          </button>
                        </div>
                      </div>
                      <div
                        style={{
                          position: "relative",
                          zIndex: messageZIndex,
                          padding: "9px 14px",
                          borderRadius: isMine
                            ? "18px 18px 4px 18px"
                            : "18px 18px 18px 4px",
                          background: isMine ? theme.sent : theme.recv,
                          color: isMine ? theme.sentFg : theme.recvFg,
                          boxShadow: isMine
                            ? `0 8px 32px ${theme.sent}66, 0 2px 24px ${theme.sent}88`
                            : `0 8px 24px rgba(0,0,0,0.3), 0 2px 12px rgba(0,0,0,0.2)`,
                          fontSize: 14,
                          lineHeight: 1.45,
                          wordBreak: "break-word",
                          outline: `3px solid ${theme.primary}88`,
                          outlineOffset: 2,
                          marginBottom: GAP,
                          transform: "scale(1.03)",
                          animation: "scaleReveal 200ms 80ms forwards",
                          opacity: 0,
                        }}
                        dir="auto"
                      >
                        {msg.content}
                        <div
                          style={{
                            fontSize: 10,
                            marginTop: 3,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 3,
                            direction: "ltr",
                            unicodeBidi: "isolate",
                            color: isMine ? theme.sentTime : theme.recvTime,
                          }}
                        >
                          {isMine ? (
                            <>
                              {msg.is_edited && (
                                <span style={{ fontSize: 9, color: `${theme.sentFg}B8`, fontStyle: "italic" }}>
                                  (edited)
                                </span>
                              )}
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {(() => {
                                const status = getMessageStatus(msg);
                                if (status === "seen")
                                  return (
                                    <TickSeenIcon
                                      size={15}
                                      style={{
                                        color: sc,
                                        filter: `drop-shadow(0 0 3px ${sc}) drop-shadow(0 0 6px ${sc}BB)`,
                                      }}
                                    />
                                  );
                                if (status === "delivered")
                                  return (
                                    <TickDeliveredIcon
                                      size={15}
                                      style={{ color: `${theme.sentFg}DD` }}
                                    />
                                  );
                                return (
                                  <TickSentIcon
                                    size={14}
                                    style={{ color: `${theme.sentFg}66` }}
                                  />
                                );
                              })()}
                            </>
                          ) : (
                            <>
                              <span>
                                {new Date(msg.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {msg.is_edited && (
                                <span style={{ fontSize: 9, color: theme.text2, fontStyle: "italic" }}>
                                  (edited)
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div
                  style={{
                    position: "fixed",
                    zIndex: 9991,
                    left: leftPos,
                    top: groupTop,
                    width: overlayWidth,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: isMine ? "flex-end" : "flex-start",
                      marginBottom: GAP,
                      animation: "slideDownReveal 180ms 50ms forwards",
                      opacity: 0,
                    }}
                  >
                    <div
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <div
                        style={{
                          ...pillStyle,
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          padding: "4px 8px",
                        }}
                      >
                        {customReactions.map((e) => {
                          const active = (reactions[popup.msgId] || []).some(
                            (r) => r.user_id === user.id && r.emoji === e,
                          );
                          return (
                            <button
                              key={e}
                              onClick={() => {
                                if (!active) addReaction(popup.msgId, e);
                                closePopup();
                              }}
                              style={{
                                background: active
                                  ? `${theme.primary}30`
                                  : "none",
                                border: active
                                  ? `1.5px solid ${theme.primary}88`
                                  : "1.5px solid transparent",
                                borderRadius: 10,
                                cursor: active ? "default" : "pointer",
                                fontSize: 20,
                                padding: "4px 6px",
                              }}
                            >
                              {e}
                            </button>
                          );
                        })}
                        <div
                          style={{
                            width: 1,
                            height: 18,
                            background: theme.border,
                            margin: "0 6px",
                          }}
                        />
                        <div style={{ display: "flex", gap: 6 }}>
                          <button
                            onClick={() => {
                              setShowAddEmoji({ msgId: popup.msgId });
                              closePopup();
                            }}
                            style={{
                              background: theme.surface2,
                              border: "none",
                              cursor: "pointer",
                              color: theme.text2,
                              padding: "6px",
                              borderRadius: 12,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            title="Add reaction"
                          >
                            <PlusIcon size={16} />
                          </button>
                          <button
                            onClick={() => {
                              setShowEmojiEditor(true);
                              closePopup();
                            }}
                            style={{
                              background: theme.surface2,
                              border: "none",
                              cursor: "pointer",
                              color: theme.text2,
                              padding: "6px",
                              borderRadius: 12,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                            title="Edit reaction slots"
                          >
                            <PenIcon size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      padding: "9px 14px",
                      borderRadius: isMine
                        ? "18px 18px 4px 18px"
                        : "18px 18px 18px 4px",
                      background: isMine ? theme.sent : theme.recv,
                      color: isMine ? theme.sentFg : theme.recvFg,
                      boxShadow: isMine
                        ? `0 8px 32px ${theme.sent}66, 0 2px 24px ${theme.sent}88`
                        : `0 8px 24px rgba(0,0,0,0.3), 0 2px 12px rgba(0,0,0,0.2)`,
                      fontSize: 14,
                      lineHeight: 1.45,
                      wordBreak: "break-word",
                      outline: `3px solid ${theme.primary}88`,
                      outlineOffset: 2,
                      marginBottom: GAP,
                      transform: "scale(1.03)",
                      animation: "scaleReveal 200ms 80ms forwards",
                      opacity: 0,
                    }}
                    dir="auto"
                  >
                    {msg.content}
                    <div
                      style={{
                        fontSize: 10,
                        marginTop: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "flex-end",
                        gap: 3,
                        direction: "ltr",
                        unicodeBidi: "isolate",
                        color: isMine ? theme.sentTime : theme.recvTime,
                      }}
                    >
                      {isMine ? (
                        <>
                          {msg.is_edited && (
                            <span style={{ fontSize: 9, color: `${theme.sentFg}B8`, fontStyle: "italic" }}>
                              (edited)
                            </span>
                          )}
                          <span>
                                {new Date(msg.created_at).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                              {(() => {
                                const status = getMessageStatus(msg);
                                if (status === "seen")
                                  return (
                                    <TickSeenIcon
                                      size={15}
                                      style={{
                                        color: "#ffffff",
                                        filter: `drop-shadow(0 0 3px ${theme.primary}66) drop-shadow(0 0 6px ${theme.primary}44)`,
                                      }}
                                    />
                                  );
                                if (status === "delivered")
                                  return (
                                    <TickDeliveredIcon
                                      size={15}
                                      style={{ color: "rgba(0,0,0,0.45)" }}
                                    />
                                  );
                                return (
                                  <TickSentIcon
                                    size={14}
                                    style={{ color: "rgba(0,0,0,0.35)" }}
                                  />
                                );
                              })()}
                        </>
                      ) : (
                        <>
                          <span>
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {msg.is_edited && (
                            <span style={{ fontSize: 9, color: theme.text2, fontStyle: "italic" }}>
                              (edited)
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: isMine ? "flex-end" : "flex-start",
                      animation: "menuReveal 180ms 120ms forwards",
                      opacity: 0,
                    }}
                  >
                        <div
                          style={{
                            ...pillStyle,
                            borderRadius: 14,
                            padding: "6px 0",
                            minWidth: 160,
                            width: "max-content",
                          }}
                        >
                      {isMine && (
                        <button
                          onClick={() => handleStartEdit(msg)}
                          style={{
                            width: "100%",
                            padding: "10px 14px",
                            background: "none",
                            border: "none",
                            color: theme.text,
                            fontSize: 13,
                            cursor: "pointer",
                            textAlign: "left",
                            display: "flex",
                            gap: 10,
                            alignItems: "center",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <PenIcon size={14} style={{ color: theme.text2 }} />
                          <span style={{ fontWeight: 600 }}>Edit</span>
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setSelectMode(true);
                          setSelectedMsgs(new Set([popup.msgId]));
                          closePopup();
                        }}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          background: "none",
                          border: "none",
                          color: theme.text,
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <CheckSquareIcon
                          size={14}
                          style={{ color: theme.text2 }}
                        />
                        <span style={{ fontWeight: 600 }}>Select</span>
                      </button>
                      <button
                        onClick={() => handleStartReply(msg)}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          background: "none",
                          border: "none",
                          color: theme.text,
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <ReplyArrowIcon size={14} style={{ color: theme.text2 }} />
                        <span style={{ fontWeight: 600 }}>Reply</span>
                      </button>
                      <div
                        style={{
                          height: 1,
                          background: theme.border,
                          margin: "2px 8px",
                        }}
                      />
                      <button
                        onClick={() => handleDeleteMsgForMe(popup.msgId)}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          background: "none",
                          border: "none",
                          color: theme.text,
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <TrashIcon size={14} />
                        <span>Delete for me</span>
                      </button>
                      <button
                        onClick={() => handleDeleteMsgForAll(popup.msgId)}
                        style={{
                          width: "100%",
                          padding: "10px 14px",
                          background: "none",
                          border: "none",
                          color: theme.danger,
                          fontSize: 13,
                          cursor: "pointer",
                          textAlign: "left",
                          display: "flex",
                          gap: 10,
                          alignItems: "center",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <TrashIcon size={14} style={{ color: theme.danger }} />
                        <span>Delete for all</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
          })();
          return popupContent ? createPortal(popupContent, document.body) : null;
        })()}

      {/* ── Add emoji panel (pick any emoji for a reaction) ── */}
      {showAddEmoji && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 9999,
            padding: "0 0 0",
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: "24px 24px 0 0",
              padding: 20,
              width: "100%",
              maxWidth: 480,
              animation: "slideUp 0.28s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <span
                style={{ color: theme.text, fontWeight: 700, fontSize: 15 }}
              >
                React with…
              </span>
              <button
                onClick={() => setShowAddEmoji(null)}
                style={{
                  background: theme.surface2,
                  border: "none",
                  color: theme.text2,
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                ✕
              </button>
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                maxHeight: 200,
                overflowY: "auto",
              }}
            >
              {[
                "😀",
                "😂",
                "🥲",
                "😍",
                "🤩",
                "😎",
                "🥳",
                "😊",
                "🙂",
                "😐",
                "😒",
                "😔",
                "😢",
                "😭",
                "😡",
                "🤬",
                "❤️",
                "🧡",
                "💛",
                "💚",
                "💙",
                "💜",
                "🖤",
                "🤍",
                "💯",
                "🔥",
                "✨",
                "⭐",
                "🎉",
                "🎊",
                "👏",
                "🙌",
                "👍",
                "👎",
                "👋",
                "🤝",
                "💪",
                "🫶",
                "🙏",
                "😴",
                "🤔",
                "🤫",
                "🤭",
                "😅",
                "😆",
                "😁",
                "😬",
                "🤯",
                "😱",
                "🥺",
                "😇",
                "🤗",
                "😋",
                "😝",
                "😜",
                "🤪",
                "🤓",
                "🧐",
                "😏",
                "😤",
                "🤢",
                "🤮",
                "🤧",
                "🤒",
              ].map((e) => {
                const alreadySet = (reactions[showAddEmoji.msgId] || []).some(
                  (r) => r.user_id === user.id && r.emoji === e,
                );
                return (
                <button
                  key={e}
                  onClick={() => {
                    addReaction(showAddEmoji.msgId, e);
                    setShowAddEmoji(null);
                  }}
                  style={{
                    background: alreadySet ? `${theme.primary}28` : "none",
                    border: alreadySet
                      ? `2px solid ${theme.primary}88`
                      : "2px solid transparent",
                    cursor: alreadySet ? "default" : "pointer",
                    fontSize: 24,
                    padding: "4px",
                    borderRadius: 10,
                    transition: "transform 0.1s",
                  }}
                  onMouseEnter={(ev) => {
                    if (!alreadySet) ev.currentTarget.style.transform = "scale(1.2)";
                  }}
                  onMouseLeave={(ev) =>
                    (ev.currentTarget.style.transform = "scale(1)")
                  }
                >
                  {e}
                </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Emoji editor (customize the 5 reaction slots) ── */}
      {showEmojiEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: "24px 24px 0 0",
              padding: 20,
              width: "100%",
              maxWidth: 480,
              animation: "slideUp 0.28s cubic-bezier(0.22,1,0.36,1)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <span
                style={{ color: theme.text, fontWeight: 700, fontSize: 15 }}
              >
                Edit reaction set
              </span>
              <button
                onClick={() => {
                  setShowEmojiEditor(false);
                  setEditingSlot(null);
                }}
                style={{
                  background: theme.surface2,
                  border: "none",
                  color: theme.text2,
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 16,
                }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 11, color: theme.text3, marginBottom: 14 }}>
              Tap one of the 5 slots to select it, then pick a replacement from
              the list below.
            </div>
            {/* Current 5 slots */}
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              {customReactions.map((e, idx) => (
                <button
                  key={idx}
                  onClick={() => setEditingSlot(idx)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    fontSize: 24,
                    background:
                      editingSlot === idx
                        ? `${theme.primary}28`
                        : theme.surface2,
                    border: `2px solid ${editingSlot === idx ? theme.primary : theme.border}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all 0.15s",
                    boxShadow:
                      editingSlot === idx
                        ? `0 0 10px ${theme.primaryGlow}`
                        : "none",
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            {editingSlot !== null && (
              <div
                style={{
                  fontSize: 11,
                  color: theme.primary,
                  fontWeight: 600,
                  textAlign: "center",
                  marginBottom: 10,
                }}
              >
                Slot {editingSlot + 1} selected — pick replacement below
              </div>
            )}
            {/* Full emoji list */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 4,
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {[
                "😀",
                "😂",
                "🥲",
                "😍",
                "🤩",
                "😎",
                "🥳",
                "😊",
                "😐",
                "😒",
                "😔",
                "😢",
                "😭",
                "😡",
                "❤️",
                "🧡",
                "💛",
                "💚",
                "💙",
                "💜",
                "💯",
                "🔥",
                "✨",
                "⭐",
                "🎉",
                "👏",
                "🙌",
                "👍",
                "👎",
                "👋",
                "🤝",
                "💪",
                "🫶",
                "🙏",
                "😴",
                "🤔",
                "🤫",
                "😅",
                "🤯",
                "😱",
                "🥺",
                "😇",
                "🤗",
                "😋",
                "😝",
                "😜",
                "🤪",
                "🤓",
                "😏",
                "🤢",
                "🤧",
                "🤒",
                "🫡",
                "🫠",
              ].map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    if (editingSlot === null) return;
                    setEmojiEditorError("");
                    const existingSlot = customReactions.indexOf(e);
                    if (existingSlot !== -1 && existingSlot !== editingSlot) {
                      setEmojiEditorError(
                        "That emoji is already in another slot.",
                      );
                      return;
                    }
                    const updated = [...customReactions];
                    updated[editingSlot] = e;
                    setCustomReactions(updated);
                    saveCustomReactions(updated).catch(() => {});
                    // Advance to next slot automatically
                    setEditingSlot((prev) => (prev < 4 ? prev + 1 : null));
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 22,
                    padding: "3px",
                    borderRadius: 8,
                    transition: "transform 0.1s",
                    opacity: editingSlot === null ? 0.5 : 1,
                  }}
                  onMouseEnter={(ev) => {
                    if (editingSlot !== null)
                      ev.currentTarget.style.transform = "scale(1.2)";
                  }}
                  onMouseLeave={(ev) =>
                    (ev.currentTarget.style.transform = "scale(1)")
                  }
                >
                  {e}
                </button>
              ))}
            </div>
            {emojiEditorError && (
              <div
                style={{
                  marginTop: 8,
                  textAlign: "center",
                  color: theme.danger,
                  fontSize: 12,
                }}
              >
                {emojiEditorError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Unfriend confirmation ── */}
      {confirmUnfriend && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: 24,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              animation: "floatIn 0.22s ease",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>⚠️</div>
              <div style={{ color: theme.text, fontWeight: 800, fontSize: 18 }}>
                Remove friend?
              </div>
              <p
                style={{
                  color: theme.text2,
                  fontSize: 13,
                  lineHeight: 1.5,
                  marginTop: 8,
                }}
              >
                This will permanently delete this chat and all messages
                for both users.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmUnfriend(false)}
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
                onClick={doUnfriendFromChat}
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

      {/* ── Block confirmation ── */}
      {confirmBlock && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 16,
          }}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: 24,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              animation: "floatIn 0.22s ease",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 44, marginBottom: 8 }}>🚫</div>
              <div style={{ color: theme.text, fontWeight: 800, fontSize: 18 }}>
                Block user?
              </div>
              <p
                style={{
                  color: theme.text2,
                  fontSize: 13,
                  lineHeight: 1.5,
                  marginTop: 8,
                }}
              >
                This will permanently delete this chat and block this
                user. They will not be able to send you friend requests.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setConfirmBlock(false)}
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
                onClick={doBlockFromChat}
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
                Block & Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Chat;
