import { cacheGet, cacheSet } from "./cache";

const CACHE_KEYS = {
  CHATS: (uid) => `chats_${uid}`,
  FRIENDS: (uid) => `friends_${uid}`,
  LAST_MESSAGES: (uid) => `lastmsg_${uid}`,
  UNREAD_COUNTS: (uid) => `unread_${uid}`,
  MESSAGES: (uid, convId) => `chat_msgs_${uid}_${convId}`,
  REACTIONS: (uid, convId) => `chat_reactions_${uid}_${convId}`,
};

export function getCacheKey(type, uid, extra = null) {
  switch (type) {
    case "chats":
      return CACHE_KEYS.CHATS(uid);
    case "friends":
      return CACHE_KEYS.FRIENDS(uid);
    case "lastMessages":
      return CACHE_KEYS.LAST_MESSAGES(uid);
    case "unreadCounts":
      return CACHE_KEYS.UNREAD_COUNTS(uid);
    case "messages":
      return CACHE_KEYS.MESSAGES(uid, extra);
    case "reactions":
      return CACHE_KEYS.REACTIONS(uid, extra);
    default:
      return null;
  }
}

export function isValidRootKey(key) {
  return /^[0-9a-f]{64}$/i.test(String(key || ""));
}

export function getRootKeyFromStorage() {
  const stored = sessionStorage.getItem("userPrivateKey") || "";
  if (isValidRootKey(stored)) return stored;
  return "";
}

export async function saveToCache(keyType, uid, data, extraKey = null) {
  const rootKey = getRootKeyFromStorage();
  if (!isValidRootKey(rootKey)) return;
  
  const key = getCacheKey(keyType, uid, extraKey);
  if (key) {
    await cacheSet(rootKey, key, data);
  }
}

export async function loadFromCache(keyType, uid, extraKey = null) {
  const rootKey = getRootKeyFromStorage();
  if (!isValidRootKey(rootKey)) return null;
  
  const key = getCacheKey(keyType, uid, extraKey);
  if (key) {
    return await cacheGet(rootKey, key);
  }
  return null;
}

export function convMsgCacheKey(uid, convId) {
  return `conv_msgs_${String(uid || "").trim().toLowerCase()}_${convId}`;
}

export function convReactCacheKey(uid, convId) {
  return `conv_reactions_${String(uid || "").trim().toLowerCase()}_${convId}`;
}

export const CHAT_STATES = {
  INITIALIZING: "initializing",
  READY: "ready",
  SYNCING: "syncing",
  OFFLINE: "offline",
};

export function createCacheState(initialValue = null) {
  let state = initialValue;
  let listeners = [];

  return {
    get: () => state,
    set: (newValue) => {
      state = newValue;
      listeners.forEach(fn => fn(state));
    },
    update: (updater) => {
      state = updater(state);
      listeners.forEach(fn => fn(state));
    },
    subscribe: (fn) => {
      listeners.push(fn);
      return () => {
        listeners = listeners.filter(l => l !== fn);
      };
    },
  };
}

export function applyDeltaToChatsCache(currentChats, change) {
  if (!currentChats) currentChats = [];
  
  const { eventType, new: newRecord, old: oldRecord } = change;
  const otherUserId = newRecord?.other_user_id || oldRecord?.other_user_id;
  
  switch (eventType) {
    case "INSERT":
      if (newRecord && !currentChats.find(c => c.conversation_id === newRecord.conversation_id)) {
        console.log("[CacheManager] Delta: Adding new chat to cache", newRecord.conversation_id);
        return [
          {
            conversation_id: newRecord.conversation_id,
            chat_row_id: newRecord.id || null,
            created_at: newRecord.created_at,
            last_read_at: newRecord.last_read_at,
            other_public_key: newRecord.other_public_key,
            otherUser: { id: newRecord.other_user_id, username: newRecord.other_username },
          },
          ...currentChats,
        ];
      }
      return currentChats;

    case "DELETE":
      console.log("[CacheManager] Delta: Removing chat from cache", oldRecord?.conversation_id || otherUserId);
      return currentChats.filter(c => 
        c.conversation_id !== (oldRecord?.conversation_id || otherUserId) &&
        c.otherUser?.id !== otherUserId
      );

    case "UPDATE":
      return currentChats.map(c => {
        if (c.conversation_id === (newRecord?.conversation_id || otherUserId)) {
          return { ...c, ...newRecord };
        }
        return c;
      });

    default:
      return currentChats;
  }
}

export function applyDeltaToFriendsCache(currentFriends, change) {
  if (!currentFriends) currentFriends = { received: [], sent: [], friends: [], blocked: [] };
  
  const { eventType, new: newRecord, old: oldRecord } = change;
  const userId = sessionStorage.getItem("userId");
  
  switch (eventType) {
    case "INSERT":
      if (newRecord?.status === "pending") {
        if (newRecord.sender_id === userId) {
          if (!currentFriends.sent.find(s => s.id === newRecord.id)) {
            console.log("[CacheManager] Delta: Adding sent request to cache");
            return {
              ...currentFriends,
              sent: [...currentFriends.sent, {
                id: newRecord.id,
                receiver_id: newRecord.receiver_id,
                status: newRecord.status,
                created_at: newRecord.created_at,
              }],
            };
          }
        } else if (newRecord.receiver_id === userId) {
          if (!currentFriends.received.find(r => r.id === newRecord.id)) {
            console.log("[CacheManager] Delta: Adding received request to cache");
            return {
              ...currentFriends,
              received: [...currentFriends.received, {
                id: newRecord.id,
                sender_id: newRecord.sender_id,
                created_at: newRecord.created_at,
              }],
            };
          }
        }
      }
      return currentFriends;

    case "UPDATE":
      if (newRecord?.status === "accepted") {
        const updated = { ...currentFriends };
        
        updated.received = updated.received.filter(r => r.id !== newRecord.id);
        updated.sent = updated.sent.filter(s => s.id !== newRecord.id);
        
        const friendId = newRecord.sender_id === userId ? newRecord.receiver_id : newRecord.sender_id;
        if (!updated.friends.find(f => f.userId === friendId)) {
          console.log("[CacheManager] Delta: Adding accepted friend to cache");
          updated.friends = [...updated.friends, {
            friendship_id: newRecord.id,
            userId: friendId,
            created_at: newRecord.updated_at || newRecord.created_at,
          }];
        }
        return updated;
      }
      
      if (newRecord?.status === "rejected" || newRecord?.status === "removed") {
        return {
          ...currentFriends,
          received: currentFriends.received.filter(r => r.id !== newRecord.id),
          sent: currentFriends.sent.filter(s => s.id !== newRecord.id),
          friends: currentFriends.friends.filter(f => f.friendship_id !== newRecord.id),
        };
      }
      return currentFriends;

    case "DELETE":
      return {
        ...currentFriends,
        received: currentFriends.received.filter(r => r.id !== oldRecord?.id),
        sent: currentFriends.sent.filter(s => s.id !== oldRecord?.id),
        friends: currentFriends.friends.filter(f => f.friendship_id !== oldRecord?.id),
      };

    default:
      return currentFriends;
  }
}

export function applyDeltaToMessagesCache(currentMessages, change) {
  if (!currentMessages) currentMessages = [];
  
  const { eventType, new: newRecord, old: oldRecord } = change;
  
  switch (eventType) {
    case "INSERT":
      if (newRecord && !currentMessages.find(m => m.id === newRecord.id)) {
        console.log("[CacheManager] Delta: Adding new message to cache", newRecord.id);
        return [...currentMessages, newRecord].sort(
          (a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        );
      }
      return currentMessages;

    case "UPDATE":
      console.log("[CacheManager] Delta: Updating message in cache", newRecord?.id);
      return currentMessages.map(m => {
        if (m.id === newRecord.id) {
          return { ...m, ...newRecord };
        }
        return m;
      });

    case "DELETE":
      console.log("[CacheManager] Delta: Removing message from cache", oldRecord?.id);
      return currentMessages.filter(m => m.id !== oldRecord?.id);

    default:
      return currentMessages;
  }
}

export function applyDeltaToLastMessage(currentLastMsg, newMessage) {
  if (!currentLastMsg || !newMessage) return newMessage;
  
  if (new Date(newMessage.created_at) > new Date(currentLastMsg.created_at || 0)) {
    return newMessage;
  }
  return currentLastMsg;
}
