const BASE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auth-signin`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const SESSION_KEY = "chatapp-session-token";
const SESSION_EXPIRES_KEY = "chatapp-session-token-expires-at";
const SESSION_REMEMBER_KEY = "chatapp-session-remember";
const REFRESH_LEEWAY_MS = 60 * 1000;
let recoveryPromise = null;

function isPublicAuthPath(path) {
  const p = String(path || "").replace(/\/+$/, "");
  return (
    p === "/health" ||
    p === "/profile" ||
    p === "/profile/upsert" ||
    p === "/challenge" ||
    p === "/signin"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

async function fetchWithRetry(url, options, { retries = 2 } = {}) {
  let attempt = 0;
  let lastError = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeoutId);
      if (isRetryableStatus(res.status) && attempt < retries) {
        await sleep(200 * 2 ** attempt);
        attempt += 1;
        continue;
      }
      return res;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      if (attempt >= retries) throw error;
      await sleep(200 * 2 ** attempt);
      attempt += 1;
    }
  }

  throw lastError || new Error("Network request failed");
}

function headers(extra = {}) {
  let sessionToken = "";
  try {
    sessionToken = sessionStorage.getItem(SESSION_KEY) || "";
  } catch {
    // Ignore storage errors.
  }

  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    "Content-Type": "application/json",
    ...(sessionToken ? { "x-session-token": sessionToken } : {}),
    ...extra,
  };
}

function readStorage(key, fallback = null) {
  try {
    const fromSession = sessionStorage.getItem(key);
    if (fromSession) return fromSession;
  } catch {
    // ignore
  }
  try {
    const fromLocal = localStorage.getItem(key);
    if (fromLocal) return fromLocal;
  } catch {
    // ignore
  }
  return fallback;
}

function getSessionExpiryMs() {
  const iso = readStorage(SESSION_EXPIRES_KEY, "");
  if (!iso) return 0;
  const ts = Date.parse(iso);
  return Number.isFinite(ts) ? ts : 0;
}

function shouldRefreshSoon() {
  const expiresAt = getSessionExpiryMs();
  if (!expiresAt) return false;
  return expiresAt - Date.now() <= REFRESH_LEEWAY_MS;
}

function shouldRememberSessionToken() {
  try {
    if (localStorage.getItem(SESSION_REMEMBER_KEY) === "1") return true;
    return Boolean(localStorage.getItem(SESSION_KEY));
  } catch {
    return false;
  }
}

async function parseResponse(res) {
  const text = await res.text().catch(() => "");
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (e) {
    console.warn("Failed to parse response as JSON:", text.substring(0, 200));
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Unauthorized session");
    }
    const message =
      body?.detail || body?.error || `Request failed (${res.status})`;
    throw new Error(message);
  }
  // Normalize response shape: if backend returned a direct array/object without
  // `{ data: ... }`, wrap it so callers that expect `.data` continue to work.
  try {
    if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'data')) {
      return body;
    }
    return { data: body };
  } catch (e) {
    return { data: body };
  }
}

function isSessionExpiryValid(expiresAtIso, minRemainingMs = 0) {
  const ts = Date.parse(String(expiresAtIso || ""));
  if (!Number.isFinite(ts)) return false;
  return ts - Date.now() > minRemainingMs;
}

async function tryRecoverSessionOnce({ requireFresh = false } = {}) {
  if (recoveryPromise) return recoveryPromise;

  recoveryPromise = (async () => {
    console.log("[Auth][EdgeApi] tryRecoverSessionOnce", {
      requireFresh,
      hasSessionToken: Boolean(sessionStorage.getItem(SESSION_KEY)),
      hasLocalToken: (() => {
        try {
          return Boolean(localStorage.getItem(SESSION_KEY));
        } catch {
          return false;
        }
      })(),
      hasPrivateKey: Boolean(sessionStorage.getItem("userPrivateKey")),
    });
  // 1) Try to restore persisted token from localStorage into sessionStorage
    try {
      const persisted = localStorage.getItem(SESSION_KEY);
      if (persisted) {
        try {
          const persistedExpiry = localStorage.getItem(SESSION_EXPIRES_KEY);
          const expiryStillValid = isSessionExpiryValid(
            persistedExpiry,
            requireFresh ? REFRESH_LEEWAY_MS : 0,
          );
          if (persistedExpiry && !expiryStillValid) {
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(SESSION_EXPIRES_KEY);
          } else {
            sessionStorage.setItem(SESSION_KEY, persisted);
            if (persistedExpiry) {
              sessionStorage.setItem(SESSION_EXPIRES_KEY, persistedExpiry);
            }
            if (!requireFresh || (persistedExpiry && expiryStillValid)) {
              // restored session
              return true;
            }
          }
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }

    // 2) Attempt silent sign-in using session-only private key (best-effort, single attempt)
    try {
      const privateKeyHex = sessionStorage.getItem("userPrivateKey") || "";
      if (/^[0-9a-f]{64}$/i.test(privateKeyHex)) {
        // dynamic import to avoid import cycles
        const mod = await import("./authProfileService.js");
        if (mod?.signInWithPrivateKey) {
          try {
            await mod.signInWithPrivateKey(
              privateKeyHex,
              shouldRememberSessionToken(),
            );
            // signInWithPrivateKey calls createSessionToken which sets the session token
            return Boolean(sessionStorage.getItem(SESSION_KEY));
          } catch {
            // ignore failure
          }
        }
      }
    } catch {
      // ignore
    }

    return false;
  })();

  try {
    return await recoveryPromise;
  } finally {
    recoveryPromise = null;
  }
}

export async function ensureActiveSession({ forceRefresh = false } = {}) {
  const token = getSessionToken();
  if (!token) {
    return tryRecoverSessionOnce({ requireFresh: forceRefresh });
  }

  if (!forceRefresh && !shouldRefreshSoon()) {
    return true;
  }

  return tryRecoverSessionOnce({ requireFresh: true });
}

export async function edgeGet(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = query ? `${BASE_URL}${path}?${query}` : `${BASE_URL}${path}`;

  if (!isPublicAuthPath(path)) {
    await ensureActiveSession();
  }

  // First attempt
  try {
    const res = await fetchWithRetry(url, { method: "GET", headers: headers() });
    return await parseResponse(res);
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("unauthorized session")) {
      // Try recovery once, then retry the request a single time
      const recovered = await ensureActiveSession({ forceRefresh: true });
      if (recovered) {
        const retryRes = await fetchWithRetry(url, { method: "GET", headers: headers() });
        return await parseResponse(retryRes);
      }
    }
    throw err;
  }
}

export async function edgePost(path, payload = {}) {
  const url = `${BASE_URL}${path}`;

  if (!isPublicAuthPath(path)) {
    await ensureActiveSession();
  }

  try {
    const res = await fetchWithRetry(
      url,
      { method: "POST", headers: headers(), body: JSON.stringify(payload) },
      { retries: 1 },
    );
    console.log("[edgePost] Response status:", res.status, "for", path);
    return await parseResponse(res);
  } catch (err) {
    if (String(err?.message || "").toLowerCase().includes("unauthorized session")) {
      const recovered = await ensureActiveSession({ forceRefresh: true });
      if (recovered) {
        const retryRes = await fetchWithRetry(
          url,
          { method: "POST", headers: headers(), body: JSON.stringify(payload) },
          { retries: 1 },
        );
        return await parseResponse(retryRes);
      }
    }
    throw err;
  }
}

export function getSessionToken() {
  try {
    const session = sessionStorage.getItem(SESSION_KEY);
    if (session) return session;
    // Fallback to persisted token (remember me)
    const persisted = localStorage.getItem(SESSION_KEY);
    if (persisted) {
      try {
        sessionStorage.setItem(SESSION_KEY, persisted);
        const persistedExpiry = localStorage.getItem(SESSION_EXPIRES_KEY);
        if (persistedExpiry) {
          sessionStorage.setItem(SESSION_EXPIRES_KEY, persistedExpiry);
        }
      } catch {}
      return persisted;
    }
    return null;
  } catch {
    return null;
  }
}

export function setSessionToken(token, expiresAt = null) {
  try {
    if (token) {
      sessionStorage.setItem(SESSION_KEY, token);
      if (expiresAt) {
        sessionStorage.setItem(SESSION_EXPIRES_KEY, String(expiresAt));
      } else {
        sessionStorage.removeItem(SESSION_EXPIRES_KEY);
      }
    } else {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(SESSION_EXPIRES_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}

export function clearSessionToken() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_EXPIRES_KEY);
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_EXPIRES_KEY);
      localStorage.removeItem(SESSION_REMEMBER_KEY);
    } catch {}
  } catch {
    // Ignore storage errors.
  }
}

export function persistSessionTokenToLocal() {
  try {
    const token = sessionStorage.getItem(SESSION_KEY);
    if (!token) return;
    localStorage.setItem(SESSION_KEY, token);
    localStorage.setItem(SESSION_REMEMBER_KEY, "1");
    const expiresAt = sessionStorage.getItem(SESSION_EXPIRES_KEY);
    if (expiresAt) {
      localStorage.setItem(SESSION_EXPIRES_KEY, expiresAt);
    }
  } catch {
    // ignore
  }
}

export function isRememberMeEnabled() {
  try {
    return localStorage.getItem(SESSION_REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

export function disableRememberMe() {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(SESSION_EXPIRES_KEY);
    localStorage.removeItem(SESSION_REMEMBER_KEY);
  } catch {
    // ignore
  }
}
