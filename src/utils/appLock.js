const APP_LOCK_ENABLED = "chatapp_app_lock_enabled";
const APP_LOCK_TIMEOUT_SEC = "chatapp_app_lock_timeout_sec";
const APP_LAST_ACTIVE = "chatapp_app_last_active";
const APP_LOCK_ACTIVE = "chatapp_app_lock_active";
const APP_LOCK_USER_ID = "chatapp_app_lock_user_id";

export const APP_LOCK_OPTIONS = [60, 300, 600, 900, 1800, 3600];

function n(value, fallback = 60) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isAppLockEnabled() {
  try {
    return localStorage.getItem(APP_LOCK_ENABLED) === "1";
  } catch {
    return false;
  }
}

export function setAppLockEnabled(enabled) {
  try {
    localStorage.setItem(APP_LOCK_ENABLED, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}

export function getAppLockTimeoutSec() {
  try {
    return Math.max(15, n(localStorage.getItem(APP_LOCK_TIMEOUT_SEC), 60));
  } catch {
    return 60;
  }
}

export function setAppLockTimeoutSec(seconds) {
  const next = Math.max(15, n(seconds, 60));
  try {
    localStorage.setItem(APP_LOCK_TIMEOUT_SEC, String(next));
  } catch {
    // ignore
  }
}

export function touchAppActivity() {
  try {
    localStorage.setItem(APP_LAST_ACTIVE, String(Date.now()));
  } catch {
    // ignore
  }
}

export function shouldLockNow() {
  if (!isAppLockEnabled()) return false;
  try {
    const last = n(localStorage.getItem(APP_LAST_ACTIVE), 0);
    if (!last) return false;
    return Date.now() - last >= getAppLockTimeoutSec() * 1000;
  } catch {
    return false;
  }
}

export function setAppLockState(locked, userId = "") {
  try {
    localStorage.setItem(APP_LOCK_ACTIVE, locked ? "1" : "0");
    if (locked && userId) {
      localStorage.setItem(APP_LOCK_USER_ID, String(userId).trim().toLowerCase());
    } else {
      localStorage.removeItem(APP_LOCK_USER_ID);
    }
  } catch {
    // ignore
  }
}

export function isAppLockedState() {
  try {
    return localStorage.getItem(APP_LOCK_ACTIVE) === "1";
  } catch {
    return false;
  }
}

export function getAppLockedUserId() {
  try {
    return String(localStorage.getItem(APP_LOCK_USER_ID) || "").trim().toLowerCase();
  } catch {
    return "";
  }
}
