import { secureGetItem, secureSetItem } from "./crypto";
import { cacheGet, cacheSet } from "./cache";

const LAST_SEEN_DEFAULT = {
  received: "1970-01-01T00:00:00.000Z",
  sent: "1970-01-01T00:00:00.000Z",
  friends: "1970-01-01T00:00:00.000Z",
  blocked: "1970-01-01T00:00:00.000Z",
};

const LAST_SEEN_SECURE_KEY = "friend_tabs_last_seen";

const REACTIONS_SECURE_KEY = "chatapp_reactions";

function mergeLastSeen(value) {
  const src = value && typeof value === "object" ? value : {};
  return {
    received: src.received || LAST_SEEN_DEFAULT.received,
    sent: src.sent || LAST_SEEN_DEFAULT.sent,
    friends: src.friends || LAST_SEEN_DEFAULT.friends,
    blocked: src.blocked || LAST_SEEN_DEFAULT.blocked,
  };
}

export async function loadFriendTabsLastSeen() {
  const userId = String(sessionStorage.getItem("userId") || "").trim().toLowerCase();
  try {
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    if (/^[0-9a-f]{64}$/i.test(rootKey) && userId) {
      const v = await cacheGet(rootKey, `meta_lastseen_${userId}`);
      if (v) return mergeLastSeen(v);
    }
  } catch (e) {
    // ignore
  }

  // Fallback to secure store for older installs
  try {
    const encrypted = await secureGetItem(LAST_SEEN_SECURE_KEY);
    if (encrypted) return mergeLastSeen(encrypted);
  } catch {
    // ignore
  }

  return { ...LAST_SEEN_DEFAULT };
}

export async function saveFriendTabsLastSeen(value) {
  const merged = mergeLastSeen(value);
  const userId = String(sessionStorage.getItem("userId") || "").trim().toLowerCase();
  try {
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    if (/^[0-9a-f]{64}$/i.test(rootKey) && userId) {
      await cacheSet(rootKey, `meta_lastseen_${userId}`, merged);
      return;
    }
  } catch (e) {
    // ignore
  }

  // Fallback for older installs
  await secureSetItem(LAST_SEEN_SECURE_KEY, merged);
}

export async function loadCustomReactions(defaultReactions) {
  const userId = String(sessionStorage.getItem("userId") || "").trim().toLowerCase();
  try {
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    if (/^[0-9a-f]{64}$/i.test(rootKey) && userId) {
      const v = await cacheGet(rootKey, `meta_custom_reacts_${userId}`);
      if (Array.isArray(v)) return v;
    }
  } catch (e) {
    // ignore
  }

  try {
    const encrypted = await secureGetItem(REACTIONS_SECURE_KEY);
    if (Array.isArray(encrypted)) return encrypted;
  } catch {
    // ignore
  }

  return defaultReactions;
}

export async function saveCustomReactions(reactions) {
  const userId = String(sessionStorage.getItem("userId") || "").trim().toLowerCase();
  try {
    const rootKey = sessionStorage.getItem("userPrivateKey") || "";
    if (/^[0-9a-f]{64}$/i.test(rootKey) && userId) {
      await cacheSet(rootKey, `meta_custom_reacts_${userId}`, reactions);
      return;
    }
  } catch (e) {
    // ignore
  }

  // Fallback
  await secureSetItem(REACTIONS_SECURE_KEY, reactions);
}
