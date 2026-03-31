import {
  initSupabase,
  publishEnvelope,
  subscribeToEnvelopes,
  fetchPrekeyById,
} from "./supabaseClient";
import sessionManager from "./sessionManager";

function bufToB64(b: Uint8Array) {
  return btoa(String.fromCharCode(...b));
}
function b64ToBuf(s: string) {
  return new Uint8Array(
    atob(s)
      .split("")
      .map((c) => c.charCodeAt(0)),
  );
}

let sbInited = false;
let appKey: CryptoKey | null = null;

export function initMessaging({
  supabaseUrl,
  supabaseKey,
}: {
  supabaseUrl: string;
  supabaseKey: string;
}) {
  if (!sbInited) {
    initSupabase(supabaseUrl, supabaseKey);
    sbInited = true;
  }
}

async function ensureAppKey() {
  if (appKey) return appKey;
  const existing = localStorage.getItem("app_sym_key");
  if (existing) {
    const keyBytes = b64ToBuf(existing);
    appKey = await crypto.subtle.importKey(
      "raw",
      keyBytes.buffer,
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    );
    return appKey;
  }
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  appKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
  localStorage.setItem("app_sym_key", bufToB64(keyBytes));
  // zero local copy
  keyBytes.fill(0);
  return appKey;
}

export async function sendMessage(to: string, plaintext: string) {
  // prefer per-contact ratchet sessions
  const sess = sessionManager.getSession(to);
  if (sess) {
    const r = await sess.ratchet.encrypt(new TextEncoder().encode(plaintext));
    const envelope = {
      type: "msg",
      from: "me",
      to,
      ts: new Date().toISOString(),
      header: r.header,
      ct: bufToB64(r.ct),
    };
    await publishEnvelope("envelopes", envelope);
    return envelope;
  }

  // no session: try to fetch recipient prekey bundle and initiate handshake
  const bundle = await fetchPrekeyById(to);
  if (bundle) {
    const handshake = await sessionManager.initiateSession(
      to,
      bundle,
      plaintext,
    );
    await publishEnvelope("envelopes", handshake);
    return handshake;
  }

  // fallback to app-wide symmetric envelope
  const key = await ensureAppKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const envelope = {
    from: "me",
    to,
    ts: new Date().toISOString(),
    iv: Array.from(iv),
    body: bufToB64(new Uint8Array(enc)),
  };
  await publishEnvelope("envelopes", envelope);
  return envelope;
}

export async function subscribe(onMessage: (env: any) => void) {
  await ensureAppKey();
  return subscribeToEnvelopes("envelopes", async (rec: any) => {
    try {
      if (rec.type === "handshake") {
        const plaintext = await sessionManager.handleIncomingHandshake(rec);
        onMessage({
          from: rec.from,
          to: rec.to,
          text: plaintext,
          ts: rec.ts,
          handshake: true,
        });
        return;
      }
      if (rec.type === "msg") {
        const sess = sessionManager.getSession(rec.from);
        if (sess) {
          const ct = b64ToBuf(rec.ct);
          const plain = await sess.ratchet.decrypt(rec.header, ct);
          onMessage({
            from: rec.from,
            to: rec.to,
            text: new TextDecoder().decode(plain),
            ts: rec.ts,
          });
          return;
        }
      }
      // fallback symmetric decrypt
      const key = await ensureAppKey();
      const iv = new Uint8Array(rec.iv || []);
      const body = b64ToBuf(rec.body || "");
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        body.buffer,
      );
      const text = new TextDecoder().decode(plain);
      onMessage({ from: rec.from, to: rec.to, text, ts: rec.ts });
    } catch (e) {
      // ignore decrypt errors for now
      console.warn("decrypt failed", e);
    }
  });
}

export default { initMessaging, sendMessage, subscribe };
