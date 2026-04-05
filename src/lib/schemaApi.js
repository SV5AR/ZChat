import { edgeGet, edgePost } from "./edgeApi";
import { encryptPayload, decryptPayload, encryptStatus, encryptTypingIndicator, encryptMessageMetadata, generateRequestNoise, obfuscateTimestamp, deobfuscateTimestamp } from "../utils/secureApi";
import {
  decryptWithKey,
  encryptWithKey,
  deriveSharedKeyNaCl,
  encryptWithNaCl,
  decryptWithNaCl,
} from "../utils/crypto";
import { deriveAesKeyFromPrivateKey } from "../utils/zchatIdentity";
import { enqueueMutation, initOfflineQueue, processQueue, getQueuedMutations, getQueueSize, isOnline, clearOfflineQueue } from "../utils/offlineQueue";

// ── Unified TTL Cache Layer ──────────────────────────────────────────────────
const _apiCache = new Map();
const API_CACHE_TTL = {
  chats: 30 * 1000,
  profiles: 5 * 60 * 1000,
  friendships: 15 * 1000,
  unreadCounts: 10 * 1000,
  chatRows: 30 * 1000,
  blockedUsers: 60 * 1000,
  lastMessages: 20 * 1000,
  convMessages: 45 * 1000,
  usernameShares: 30 * 1000,
};

function cacheGet(key) {
  const entry = _apiCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > entry.ttl) {
    _apiCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function cacheSet(key, data, ttl) {
  _apiCache.set(key, { data, ts: Date.now(), ttl: ttl || 30000 });
}

function cacheInvalidate(pattern) {
  for (const key of _apiCache.keys()) {
    if (typeof pattern === "string") {
      if (key === pattern) _apiCache.delete(key);
    } else if (pattern instanceof RegExp) {
      if (pattern.test(key)) _apiCache.delete(key);
    }
  }
}

function cacheInvalidateAll() {
  _apiCache.clear();
}

function invalidateFriendshipCaches() {
  cacheInvalidate(/^friendships/);
  cacheInvalidate(/^chats_/);
  cacheInvalidate(/^chatRows_/);
  cacheInvalidate(/^unreadCounts/);
}

function invalidateMessageCache(friendId) {
  const fid = normalizeUserId(friendId);
  cacheInvalidate(new RegExp(`^convMessages_${fid}`));
  cacheInvalidate(/^unreadCounts/);
}

export { cacheGet, cacheSet, cacheInvalidate, cacheInvalidateAll, invalidateFriendshipCaches, invalidateMessageCache, API_CACHE_TTL };

let _mutationQueue = Promise.resolve();
let _offlineQueueInitialized = false;

function enqueueLocalMutation(task) {
  const run = _mutationQueue.then(task, task);
  _mutationQueue = run.catch(() => {});
  return run;
}

function queuedPost(path, payload) {
  return enqueueLocalMutation(() => edgePost(path, payload));
}

export async function initSchemaApi() {
  if (_offlineQueueInitialized) return;
  _offlineQueueInitialized = true;
  
  initOfflineQueue(async (item) => {
    console.log("[SchemaApi] Processing queued mutation:", item.type, item.payload);
    switch (item.type) {
      case "send_friend_request":
        await edgePost("/friendships/request", item.payload);
        break;
      case "respond_friend_request":
        await edgePost("/friendships/respond", item.payload);
        break;
      case "remove_friendship":
        await edgePost("/friendships/remove", item.payload);
        break;
      case "block_user":
        await edgePost("/blocks/add", item.payload);
        break;
      case "unblock_user":
        await edgePost("/blocks/remove", item.payload);
        break;
      case "send_message":
        await edgePost("/messages/send", item.payload);
        break;
      case "add_reaction":
        await edgePost("/reactions/upsert", item.payload);
        break;
      case "remove_reaction":
        await edgePost("/reactions/upsert", item.payload);
        break;
      default:
        console.warn("[SchemaApi] Unknown queued mutation type:", item.type);
    }
  });
  
  window.dispatchEvent(new CustomEvent("schemaApi:ready"));
}

export function getOfflineQueueSize() {
  return getQueueSize();
}

export function getOfflineMutations() {
  return getQueuedMutations();
}

export function clearOfflineMutations() {
  clearOfflineQueue();
}

async function queuedMutationWithFallback(type, payload, immediateFn) {
  if (!isOnline()) {
    console.log("[SchemaApi] Offline, queuing:", type);
    enqueueMutation({ type, payload });
    return { queued: true, offline: true };
  }
  
  try {
    const result = await immediateFn();
    console.log("[SchemaApi] Immediate success:", type);
    return { result, offline: false };
  } catch (err) {
    const errorMsg = String(err?.message || "").toLowerCase();
    if (errorMsg.includes("network") || errorMsg.includes("fetch") || errorMsg.includes("offline") || err.name === "TypeError") {
      console.log("[SchemaApi] Network error, queuing:", type, err.message);
      enqueueMutation({ type, payload });
      return { queued: true, offline: true };
    }
    throw err;
  }
}

async function buildUsernameShareEnvelopeForFriend(friendId) {
  const uid = normalizeUserId(sessionStorage.getItem("userId"));
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  const otherId = normalizeUserId(friendId);
  if (!uid || !otherId || !/^[0-9a-f]{64}$/i.test(privateKeyHex)) return null;

  const targetUsername = (await getOwnPlainUsername()) || "";
  if (!targetUsername) return null;

  const otherProfile = await getProfile(otherId).catch(() => null);
  const otherPublic = String(otherProfile?.public_key || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(otherPublic)) return null;

  const sharedHex = await deriveSharedKeyNaCl(privateKeyHex, otherPublic);
  if (!sharedHex) return null;

  const cipher = await encryptWithNaCl(targetUsername, sharedHex);
  if (!cipher) return null;

  return JSON.stringify({ v: 1, c: cipher });
}

async function getRootPrivateKey() {
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  return /^[0-9a-f]{64}$/i.test(privateKeyHex) ? privateKeyHex : null;
}

async function withEncryption(apiCall, encryptFields = [], decryptFields = []) {
  const rootPrivateKey = await getRootPrivateKey();

  return async (...args) => {
    let result = await apiCall(...args);

    if (rootPrivateKey) {
      for (const field of decryptFields) {
        if (result?.[field]) {
          result[field] = await decryptPayload(result[field], rootPrivateKey);
        }
      }
    }

    return result;
  };
}

async function encryptOutgoing(rootPrivateKeyHex, data, fields) {
  if (!rootPrivateKeyHex || !data) return data;

  const encrypted = { ...data };
  for (const field of fields) {
    if (encrypted[field]) {
      encrypted[field] = await encryptPayload(encrypted[field], rootPrivateKeyHex);
    }
  }
  return encrypted;
}

function normalizeUserId(value) {
  return String(value || "").trim().toLowerCase();
}

function conversationIdFor(userId) {
  return normalizeUserId(userId);
}

function nowIso() {
  return new Date().toISOString();
}

function looksEncrypted(value) {
  const text = String(value || "").trim();
  return text.length > 24 && /^[A-Za-z0-9+/=]+$/.test(text);
}

async function decodeProfileUsername(encryptedUsername) {
  const raw = String(encryptedUsername || "").trim();
  if (!raw) return "anonymous";

  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) {
    return looksEncrypted(raw) ? "anonymous" : raw;
  }

  try {
    const aesKey = await deriveAesKeyFromPrivateKey(privateKeyHex);
    const decrypted = await decryptWithKey(raw, aesKey);
    const clean = String(decrypted || "").trim();
    return clean || "anonymous";
  } catch {
    return looksEncrypted(raw) ? "anonymous" : raw;
  }
}

const _aliasMem = {};
const _incomingUsernameSharesCache = {
  uid: "",
  rows: [],
  loadedAt: 0,
};

function parseEnvelope(raw) {
  try {
    const parsed = JSON.parse(String(raw || ""));
    if (parsed && parsed.v === 1 && typeof parsed.c === "string") {
      return parsed;
    }
  } catch {
    // Ignore parse errors.
  }
  return null;
}

async function decryptUsernameShare(shareCipher, ownerPublicKey) {
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  if (!/^[0-9a-f]{64}$/i.test(privateKeyHex)) return "anonymous";
  if (!ownerPublicKey || !/^[0-9a-f]{64}$/i.test(ownerPublicKey)) return "anonymous";
  const env = parseEnvelope(shareCipher);
  if (!env?.c) return "anonymous";
  try {
    const sharedHex = await deriveSharedKeyNaCl(privateKeyHex, ownerPublicKey);
    if (!sharedHex) return "anonymous";
    const username = await decryptWithNaCl(env.c, sharedHex);
    const clean = String(username || "").trim();
    return clean || "anonymous";
  } catch {
    return "anonymous";
  }
}

async function getOwnPlainUsername() {
  const uid = normalizeUserId(sessionStorage.getItem("userId"));
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  if (!uid || !/^[0-9a-f]{64}$/i.test(privateKeyHex)) return null;
  const profile = await getProfile(uid).catch(() => null);
  const encrypted = String(profile?.encrypted_username || "").trim();
  if (!encrypted) return null;
  const aesKey = await deriveAesKeyFromPrivateKey(privateKeyHex);
  const plain = await decryptWithKey(encrypted, aesKey);
  const clean = String(plain || "").trim();
  return clean || null;
}

async function loadIncomingUsernameShares(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return [];
  const body = await edgeGet("/username-shares", {});
  const rows = body?.data || body || [];
  _incomingUsernameSharesCache.uid = uid;
  _incomingUsernameSharesCache.rows = rows;
  _incomingUsernameSharesCache.loadedAt = Date.now();
  return rows;
}

function invalidateIncomingUsernameSharesCache() {
  _incomingUsernameSharesCache.uid = "";
  _incomingUsernameSharesCache.rows = [];
  _incomingUsernameSharesCache.loadedAt = 0;
}

function randomNonceHex() {
  const bytes = window.crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function getProfile(userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  const cacheKey = `profile_${id}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const body = await edgeGet("/profile", { id });
    const data = body?.data || body || null;
    cacheSet(cacheKey, data, API_CACHE_TTL.profiles);
    return data;
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("unauthorized session")) {
      return null;
    }
    throw err;
  }
}

export async function getFriendships(status) {
  const cacheKey = `friendships${status ? `_${status}` : ""}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  try {
    const body = await edgeGet("/friendships", status ? { status } : {});
    const data = body?.data || body || [];
    cacheSet(cacheKey, data, API_CACHE_TTL.friendships);
    return data;
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("unauthorized session")) {
      return [];
    }
    throw err;
  }
}

export async function getFriendshipBetween(userId, otherUserId) {
  const uid = normalizeUserId(userId);
  const oid = normalizeUserId(otherUserId);
  const rows = await getFriendships();
  return (
    rows.find((row) => {
      const a = normalizeUserId(row.sender_id);
      const b = normalizeUserId(row.receiver_id);
      return (a === uid && b === oid) || (a === oid && b === uid);
    }) || null
  );
}

export async function getChatsForUser(userId) {
  const uid = normalizeUserId(userId);
  if (!uid) return [];
  const cacheKey = `chats_${uid}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const [rows, incomingShares, chatRows] = await Promise.all([
    getFriendships("accepted"),
    loadIncomingUsernameShares(uid).catch(() => []),
    getChatRowsForUser(uid).catch(() => []),
  ]);
  const acceptedPairs = new Set(
    (rows || []).map((row) => {
      const a = normalizeUserId(row.sender_id);
      const b = normalizeUserId(row.receiver_id);
      return a < b ? `${a}:${b}` : `${b}:${a}`;
    }),
  );

  const activeChatMap = new Map();
  (chatRows || []).forEach((r) => {
    const a = normalizeUserId(r.user_a);
    const b = normalizeUserId(r.user_b);
    const other = a === uid ? b : b === uid ? a : "";
    if (!other) return;
    const pairKey = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!acceptedPairs.has(pairKey)) return;
    activeChatMap.set(other, r.updated_at || r.created_at || nowIso());
  });

  const incomingMap = new Map(
    (incomingShares || []).map((row) => [normalizeUserId(row.owner_id), row]),
  );

  const usernameById = new Map();
  await Promise.all(
    Array.from(activeChatMap.keys()).map(async (otherId) => {
      const profile = await getProfile(otherId).catch(() => null);
      const share = incomingMap.get(otherId);
      const otherUsername = share
        ? await decryptUsernameShare(share.encrypted_username, share.owner_public_key)
        : "anonymous";
      usernameById.set(otherId, {
        username: otherUsername,
        publicKey: profile?.public_key || null,
      });
    }),
  );

  const conversations = await Promise.all(
    Array.from(activeChatMap.keys()).map(async (otherId) => {
      const profileData = usernameById.get(otherId) || {
        username: "anonymous",
        publicKey: null,
      };
      return {
        conversation_id: conversationIdFor(otherId),
        friendship_id: null,
        other_user_id: otherId,
        other_username: profileData.username,
        other_public_key: profileData.publicKey,
        created_at: activeChatMap.get(otherId) || nowIso(),
        last_read_at: null,
      };
    }),
  );

  const result = (conversations || [])
    .filter(Boolean)
    .sort(
      (a, b) =>
        new Date(b.created_at || 0).getTime() -
        new Date(a.created_at || 0).getTime(),
    );
  cacheSet(cacheKey, result, API_CACHE_TTL.chats);
  return result;
}

export async function getKnownProfiles(userId) {
  const uid = normalizeUserId(userId);
  const [rows, blockedRows] = await Promise.all([
    getFriendships(),
    getBlockedUsers(uid).catch(() => []),
  ]);
  const acceptedIds = new Set();
  const ids = new Set([uid]);
  rows.forEach((row) => {
    const senderId = normalizeUserId(row.sender_id);
    const receiverId = normalizeUserId(row.receiver_id);
    ids.add(senderId);
    ids.add(receiverId);
    if (row.status === "accepted") {
      if (senderId === uid && receiverId) acceptedIds.add(receiverId);
      if (receiverId === uid && senderId) acceptedIds.add(senderId);
    }
  });
  (blockedRows || []).forEach((row) => {
    ids.add(normalizeUserId(row.blocked_id));
  });

  const profiles = await Promise.all(
    Array.from(ids)
      .filter(Boolean)
      .map((id) => getProfile(id).catch(() => null)),
  );

  const filtered = profiles.filter(Boolean);
  const incomingShares = await loadIncomingUsernameShares(uid).catch(() => []);
  const incomingMap = new Map(
    (incomingShares || []).map((row) => [normalizeUserId(row.owner_id), row]),
  );
  return Promise.all(
    filtered.map(async (profile) => {
      const pid = normalizeUserId(profile.id);
      if (pid === uid) {
        return {
          ...profile,
          username: await decodeProfileUsername(profile.encrypted_username),
        };
      }
      const share = incomingMap.get(pid);
      const username = share
        ? acceptedIds.has(pid)
          ? await decryptUsernameShare(share.encrypted_username, share.owner_public_key)
          : "anonymous"
        : "anonymous";
      return {
        ...profile,
        username,
      };
    }),
  );
}

export async function findChatWithUser(userId, otherUserId) {
  const uid = normalizeUserId(userId);
  const oid = normalizeUserId(otherUserId);
  if (!uid || !oid) return [];

  const row = await getFriendshipBetween(uid, oid);
  if (!row || row.status !== "accepted") return [];

  const chatRows = await getChatRowsForUser(uid).catch(() => []);
  const found = (chatRows || []).find((r) => {
    const a = normalizeUserId(r.user_a);
    const b = normalizeUserId(r.user_b);
    return (a === uid && b === oid) || (a === oid && b === uid);
  });
  if (!found) return [];

  return [
    {
      conversation_id: conversationIdFor(oid),
      friendship_id: row.id,
    },
  ];
}

export async function sendFriendRequest(receiverId, encryptedKeyBundle = null) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const payload = {
    receiverId: normalizeUserId(receiverId),
    encryptedKeyBundle,
    nonce: randomNonceHex(),
    ...(noise ? { noise } : {}),
  };

  const requesterUsernameShare = await buildUsernameShareEnvelopeForFriend(
    receiverId,
  ).catch(() => null);
  if (requesterUsernameShare) {
    payload.requesterUsernameShare = requesterUsernameShare;
  }

  if (rootPrivateKeyHex) {
    const encrypted = await encryptPayload(
      {
        receiverId: normalizeUserId(receiverId),
        encryptedKeyBundle,
        timestamp: obfuscateTimestamp(),
      },
      rootPrivateKeyHex,
    );
    payload.encrypted_metadata = encrypted;
  }

  return queuedMutationWithFallback("send_friend_request", payload, () => 
    edgePost("/friendships/request", payload)
  ).then((result) => {
    cacheInvalidate(/^friendships/);
    return result;
  });
}

export async function respondFriendRequest(friendshipId, accept, encryptedKeyBundle = null) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const payload = {
    friendshipId,
    accept,
    nonce: randomNonceHex(),
    ...(encryptedKeyBundle ? { encryptedKeyBundle } : {}),
    ...(noise ? { noise } : {}),
  };

  if (accept) {
    try {
      const rows = await getFriendships();
      const row = (rows || []).find((r) => r.id === friendshipId);
      const uid = normalizeUserId(sessionStorage.getItem("userId"));
      const otherId = row
        ? normalizeUserId(row.sender_id) === uid
          ? normalizeUserId(row.receiver_id)
          : normalizeUserId(row.sender_id)
        : "";
      if (otherId) {
        const accepterUsernameShare = await buildUsernameShareEnvelopeForFriend(
          otherId,
        ).catch(() => null);
        if (accepterUsernameShare) {
          payload.accepterUsernameShare = accepterUsernameShare;
        }
      }
    } catch {
      // best effort
    }
  }

  if (rootPrivateKeyHex) {
    const encrypted = await encryptPayload(
      {
        friendshipId,
        accept,
        encryptedKeyBundle,
        timestamp: obfuscateTimestamp(),
      },
      rootPrivateKeyHex,
    );
    payload.encrypted_metadata = encrypted;
  }

  return queuedMutationWithFallback("respond_friend_request", payload, () => 
    edgePost("/friendships/respond", payload)
  ).then((result) => {
    cacheInvalidate(/^friendships/);
    cacheInvalidate(/^chats_/);
    cacheInvalidate(/^chatRows_/);
    return result;
  });
}

export async function getUsernameShares() {
  const body = await edgeGet("/username-shares", {});
  return body?.data || [];
}

export async function removeFriendship(friendshipId) {
  const payload = { friendshipId, nonce: randomNonceHex() };
  return queuedMutationWithFallback("remove_friendship", payload, () => 
    edgePost("/friendships/remove", payload)
  ).then((result) => {
    cacheInvalidate(/^friendships/);
    cacheInvalidate(/^chats_/);
    cacheInvalidate(/^chatRows_/);
    return result;
  });
}

export async function getMessagesWithFriend(friendId, limit = 200, bypassCache = false) {
  const fid = normalizeUserId(friendId);
  const cacheKey = `convMessages_${fid}_${limit}`;
  if (!bypassCache) {
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
  }

  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const params = {
    friendId: fid,
    limit,
    ...(noise ? { noise } : {}),
  };

  const body = await edgeGet("/messages", params);
  const raw = body?.data || body || [];

  const messages = (raw || []).map((msg) => ({
    ...msg,
    conversation_id: conversationIdFor(fid),
    message_id: msg.id,
    seen_at: msg.read_at || null,
    delivered_at: msg.delivered_at || null,
    is_edited: Boolean(msg.is_edited),
    reply_to_message_id: msg.reply_to_message_id || null,
  }));
  
  cacheSet(cacheKey, messages, API_CACHE_TTL.convMessages);
  return messages;
}

export async function getMessagesWithFriendBefore(friendId, beforeIso, limit = 200) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const params = {
    friendId: normalizeUserId(friendId),
    limit,
    before: beforeIso,
    ...(noise ? { noise } : {}),
  };

  const body = await edgeGet("/messages", params);
  const raw = body?.data || body || [];

  return (raw || []).map((msg) => ({
    ...msg,
    conversation_id: conversationIdFor(friendId),
    message_id: msg.id,
    seen_at: msg.read_at || null,
    delivered_at: msg.delivered_at || null,
    is_edited: Boolean(msg.is_edited),
    reply_to_message_id: msg.reply_to_message_id || null,
  }));
}

export async function sendMessageToFriend(
  friendId,
  encryptedContent,
  replyToMessageId = null,
  clientMessageId = null,
) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const nonce = randomNonceHex();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;
  
  const payload = {
    receiverId: normalizeUserId(friendId),
    encryptedContent,
    // Include both camelCase and snake_case client id so servers with either
    // naming convention can persist and echo it back for client-side reconciliation.
    ...(clientMessageId ? { clientMessageId, client_message_id: clientMessageId } : {}),
    nonce,
    ...(replyToMessageId ? { replyToMessageId } : {}),
    ...(noise ? { noise } : {}),
  };
  
  if (rootPrivateKeyHex) {
    const encryptedMetadata = await encryptMessageMetadata(
      `msg_${Date.now()}`,
      { recipient: normalizeUserId(friendId) },
      rootPrivateKeyHex
    );
    payload.encrypted_metadata = encryptedMetadata;
  }

  const result = await queuedMutationWithFallback(
    "send_message",
    payload,
    () => edgePost("/messages/send", payload),
  );

  if (result.offline) {
    return { id: `offline_${Date.now()}`, conversation_id: conversationIdFor(friendId), pending: true };
  }

  return {
    ...(result.result?.data || {}),
    conversation_id: conversationIdFor(friendId),
  };
}

export async function editMessageById(messageId, encryptedContent) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const payload = {
    messageId,
    encryptedContent,
    nonce: randomNonceHex(),
    ...(noise ? { noise } : {}),
  };

  if (rootPrivateKeyHex) {
    payload.encrypted_metadata = await encryptMessageMetadata(
      `msg-edit_${messageId}`,
      { messageId },
      rootPrivateKeyHex,
    );
  }

  console.log("[Edit API] Sending payload:", {
    messageId: payload.messageId,
    encryptedContentLength: payload.encryptedContent?.length,
    nonceLength: payload.nonce?.length,
    hasMetadata: !!payload.encrypted_metadata,
  });

  try {
    const body = await edgePost("/messages/edit", {
      ...payload,
    });
    console.log("[Edit API] Server response:", body);
    return body?.data || body || null;
  } catch (err) {
    console.error("[Edit API] Server error:", err);
    throw err;
  }
}

export async function deleteMessageById(messageId) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const payload = {
    messageId,
    nonce: randomNonceHex(),
    ...(noise ? { noise } : {}),
  };

  if (rootPrivateKeyHex) {
    payload.encrypted_metadata = await encryptMessageMetadata(
      `msg-del_${messageId}`,
      { messageId },
      rootPrivateKeyHex,
    );
  }

  return edgePost("/messages/delete", payload);
}

export async function getUnreadCountsByFriend() {
  const cached = cacheGet("unreadCounts");
  if (cached) return cached;
  const body = await edgeGet("/messages/unread-counts");
  const raw = body?.data || body || [];
  const counts = {};
  (raw || []).forEach((row) => {
    counts[normalizeUserId(row.friend_id)] = Number(row.unread_count) || 0;
  });
  cacheSet("unreadCounts", counts, API_CACHE_TTL.unreadCounts);
  return counts;
}

export async function markMessagesReadForFriend(friendId) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  const payload = {
    friendId: normalizeUserId(friendId),
    ...(noise ? { noise } : {}),
  };

  if (rootPrivateKeyHex) {
    payload.encrypted_metadata = await encryptMessageMetadata(
      `msg-read_${Date.now()}`,
      { friendId: normalizeUserId(friendId) },
      rootPrivateKeyHex,
    );
  }

  return edgePost("/messages/mark-read", payload);
}

export async function getMessageReactions(messageId) {
  const body = await edgeGet("/reactions", { messageId });
  return (body?.data || []).filter((r) => r.encrypted_emoji);
}

export async function upsertReaction(
  messageId,
  emoji,
  friendId = null,
  friendPublicKey = null,
) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  const noise = rootPrivateKeyHex ? generateRequestNoise() : null;

  let encryptedEmoji = emoji;
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  const friendPublic = String(friendPublicKey || "").trim().toLowerCase();
  if (
    /^[0-9a-f]{64}$/i.test(privateKeyHex) &&
    /^[0-9a-f]{64}$/i.test(friendPublic)
  ) {
    const sharedHex = await deriveSharedKeyNaCl(privateKeyHex, friendPublic);
    const cipher = sharedHex ? await encryptWithNaCl(emoji, sharedHex) : null;
    if (cipher) {
      encryptedEmoji = JSON.stringify({ v: 1, c: cipher });
    }
  }

  const payload = {
    messageId,
    encryptedEmoji,
    nonce: randomNonceHex(),
    ...(noise ? { noise } : {}),
  };

  if (rootPrivateKeyHex) {
    payload.encrypted_metadata = await encryptMessageMetadata(
      `reaction_${messageId}_${Date.now()}`,
      { messageId },
      rootPrivateKeyHex,
    );
  }

  return queuedMutationWithFallback("add_reaction", payload, () => 
    edgePost("/reactions/upsert", payload)
  );
}

export async function clearOwnReaction(messageId, reactionId = null) {
  const payload = {
    messageId,
    encryptedEmoji: "",
    ...(reactionId ? { reactionId } : {}),
    nonce: randomNonceHex(),
  };
  return queuedMutationWithFallback("remove_reaction", payload, () => 
    edgePost("/reactions/upsert", payload)
  );
}

export async function getFriendAliases(ownerId) {
  const owner = normalizeUserId(ownerId);
  if (!owner) return [];
  return Object.entries(_aliasMem[owner] || {}).map(
    ([friendId, encrypted_username]) => ({
      id: `${owner}:${friendId}`,
      owner_id: owner,
      friend_id: friendId,
      encrypted_username,
    }),
  );
}

export async function upsertFriendAlias(ownerId, friendId, encryptedUsername) {
  const owner = normalizeUserId(ownerId);
  const friend = normalizeUserId(friendId);
  if (!owner || !friend) return null;
  _aliasMem[owner] = _aliasMem[owner] || {};
  _aliasMem[owner][friend] = encryptedUsername;
  return {
    id: `${owner}:${friend}`,
    owner_id: owner,
    friend_id: friend,
    encrypted_username: encryptedUsername,
  };
}

export async function fanoutUsernameShares(plainUsername = null) {
  const uid = normalizeUserId(sessionStorage.getItem("userId"));
  const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
  if (!uid || !/^[0-9a-f]{64}$/i.test(privateKeyHex)) return;
  const targetUsername =
    String(plainUsername || "").trim() || (await getOwnPlainUsername()) || "";
  if (!targetUsername) return;

  const friends = await getFriendships("accepted");
  const incoming = await getUsernameShares().catch(() => []);
  const incomingMap = new Map(
    (incoming || []).map((row) => [normalizeUserId(row.owner_id), row]),
  );

  const knownProfiles = await getKnownProfiles(uid).catch(() => []);
  const profileMap = new Map(
    (knownProfiles || []).map((p) => [normalizeUserId(p.id), p]),
  );

  await Promise.all(
    (friends || []).map(async (row) => {
      const otherId =
        normalizeUserId(row.sender_id) === uid
          ? normalizeUserId(row.receiver_id)
          : normalizeUserId(row.sender_id);
      if (!otherId) return;
      let otherPublic = String(profileMap.get(otherId)?.public_key || "")
        .trim()
        .toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(otherPublic)) {
        const incomingShare = incomingMap.get(otherId);
        otherPublic = String(incomingShare?.owner_public_key || "")
          .trim()
          .toLowerCase();
      }
      if (!/^[0-9a-f]{64}$/i.test(otherPublic)) {
        const otherProfile = await getProfile(otherId).catch(() => null);
        otherPublic = String(otherProfile?.public_key || "")
          .trim()
          .toLowerCase();
      }
      if (!/^[0-9a-f]{64}$/i.test(otherPublic)) return;
      const sharedHex = await deriveSharedKeyNaCl(privateKeyHex, otherPublic);
      if (!sharedHex) return;
      const cipher = await encryptWithNaCl(targetUsername, sharedHex);
      if (!cipher) return;
      const envelope = JSON.stringify({ v: 1, c: cipher });
      await edgePost("/username-shares/upsert", {
        friendId: otherId,
        encryptedUsername: envelope,
      });
    }),
  );
  invalidateIncomingUsernameSharesCache();
}

export async function getBlockedUsers(blockerId) {
  const blocker = normalizeUserId(blockerId);
  if (!blocker) return [];
  const cacheKey = `blocked_${blocker}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const body = await edgeGet("/blocks", {});
  const data = body?.data || [];
  cacheSet(cacheKey, data, API_CACHE_TTL.blockedUsers);
  return data;
}

export async function blockUser(blockerId, blockedId) {
  const blocker = normalizeUserId(blockerId);
  const blocked = normalizeUserId(blockedId);
  if (!blocker || !blocked) return false;
  const payload = { blockedId: blocked, nonce: randomNonceHex() };
  return queuedMutationWithFallback("block_user", payload, () => 
    edgePost("/blocks/add", payload)
  ).then((result) => {
    cacheInvalidate(/^blocked_/);
    return result;
  });
}

export async function unblockUser(blockerId, blockedId) {
  const blocker = normalizeUserId(blockerId);
  const blocked = normalizeUserId(blockedId);
  if (!blocker || !blocked) return false;
  const payload = { blockedId: blocked, nonce: randomNonceHex() };
  return queuedMutationWithFallback("unblock_user", payload, () => 
    edgePost("/blocks/remove", payload)
  ).then((result) => {
    cacheInvalidate(/^blocked_/);
    return result;
  });
}

export async function hideMessageForMe(messageId, userId) {
  return edgePost("/messages/hide", {
    messageId,
    nonce: randomNonceHex(),
  });
}

export async function hideChatForMe(friendId) {
  return edgePost("/messages/hide", {
    friendId: normalizeUserId(friendId),
    nonce: randomNonceHex(),
  });
}

export async function ensureChatExists(friendId) {
  return edgePost("/chat/ensure", {
    friendId: normalizeUserId(friendId),
    nonce: randomNonceHex(),
  }).then((result) => {
    cacheInvalidate(/^chats_/);
    cacheInvalidate(/^chatRows_/);
    return result;
  });
}

export async function getChatRowsForUser(userId) {
  const uid = normalizeUserId(userId || sessionStorage.getItem("userId"));
  if (!uid) return [];
  const cacheKey = `chatRows_${uid}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  const body = await edgeGet("/chat", {});
  const data = body?.data || [];
  cacheSet(cacheKey, data, API_CACHE_TTL.chatRows);
  return data;
}

export async function deleteChatForEveryone(friendId) {
  return edgePost("/chat/delete", {
    friendId: normalizeUserId(friendId),
    nonce: randomNonceHex(),
  }).then((result) => {
    cacheInvalidate(/^chats_/);
    cacheInvalidate(/^chatRows_/);
    cacheInvalidate(/^convMessages_/);
    return result;
  });
}

export async function updateEncryptedStatus(isOnline) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  if (!rootPrivateKeyHex) return null;

  const encryptedStatus = await encryptStatus(isOnline, rootPrivateKeyHex);
  const noise = generateRequestNoise();
  
  return edgePost("/status/update", {
    encrypted: encryptedStatus,
    noise,
  });
}

export async function sendEncryptedTypingIndicator(recipientId, isTyping) {
  const rootPrivateKeyHex = await getRootPrivateKey();
  if (!rootPrivateKeyHex) return null;

  const encrypted = await encryptTypingIndicator(recipientId, isTyping, rootPrivateKeyHex);
  const noise = generateRequestNoise();
  
  return edgePost("/typing", {
    encrypted,
    noise,
  });
}

// ============================================================
// Ratchet State Storage (Forward Secrecy)
// ============================================================

export async function saveRatchetState(conversationKey, encryptedState) {
  try {
    return await edgePost("/ratchet-state", {
      conversation_key: conversationKey,
      encrypted_state: encryptedState,
    });
  } catch (error) {
    const msg = String(error?.message || "").toLowerCase();
    if (msg.includes("ratchet_states") || msg.includes("42p01")) {
      return { data: null, skipped: true };
    }
    throw error;
  }
}

export async function loadRatchetStates() {
  try {
    const result = await edgeGet("/ratchet-state", {});
    return result?.data || [];
  } catch (error) {
    console.warn("[loadRatchetStates] falling back to empty states:", error?.message || error);
    return [];
  }
}
