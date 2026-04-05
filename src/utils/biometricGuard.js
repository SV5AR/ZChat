const BIO_KEY = "chatapp_bio_guard_v1";

function toB64Url(bytes) {
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(value) {
  const normalized = String(value || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function readConfig() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(BIO_KEY) || "{}");
    return {
      enabled: Boolean(parsed.enabled),
      credentialId: String(parsed.credentialId || ""),
      userId: String(parsed.userId || ""),
      createdAt: Number(parsed.createdAt) || 0,
    };
  } catch {
    return { enabled: false, credentialId: "", userId: "", createdAt: 0 };
  }
}

function writeConfig(next) {
  try {
    sessionStorage.setItem(BIO_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
}

function randomBytes(len) {
  return window.crypto.getRandomValues(new Uint8Array(len));
}

function canUseWebAuthn() {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    !!window.PublicKeyCredential &&
    !!navigator.credentials
  );
}

function isIpAddress(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

function getDomainIssue() {
  if (typeof window === "undefined") return "";
  if (!window.isSecureContext) {
    return "Biometric unlock requires HTTPS (or localhost).";
  }
  const host = String(window.location.hostname || "").toLowerCase();
  if (!host) return "Invalid browser origin for biometric unlock.";
  if (host === "localhost" || host.endsWith(".localhost")) return "";
  if (isIpAddress(host)) {
    return "This origin uses an IP address. iPhone/Safari WebAuthn requires a real HTTPS domain.";
  }
  if (!host.includes(".")) {
    return "This origin is not a valid domain for WebAuthn.";
  }
  return "";
}

function mapWebAuthnError(err) {
  const msg = String(err?.message || "");
  const low = msg.toLowerCase();
  // Handle platform-specific module/import failures (seen on some fingerprint stacks or when
  // bundlers/runtime trap imports during SSR/build like on Netlify). Give a helpful fallback
  // message so the app can retry with relaxed options instead of failing hard.
  if (low.includes("importing a module") || low.includes("failed to import") || low.includes("module not found")) {
    return (
      "Platform authenticator failed to initialize (module import error). " +
      "This can happen on some fingerprint stacks or during server-side builds (e.g. Netlify). " +
      "A relaxed fallback will be attempted; if problems persist, try again in the browser or use an alternate biometric (Face ID)."
    );
  }
  if (
    msg.includes("effective domain of the document is not a valid domain") ||
    msg.includes("not a valid domain")
  ) {
    return (
      getDomainIssue() ||
      "This origin is not valid for WebAuthn. Use an HTTPS domain in Safari on iPhone."
    );
  }
  return msg || "Biometric operation failed.";
}

export function isBiometricSupported() {
  return canUseWebAuthn();
}

export function getBiometricReadinessIssue() {
  if (!canUseWebAuthn()) {
    return "Biometric unlock requires WebAuthn support and a secure context.";
  }
  return getDomainIssue();
}

export function isBiometricEnabled() {
  const conf = readConfig();
  return Boolean(conf.enabled && conf.credentialId);
}

export async function registerBiometricCredential() {
  if (!canUseWebAuthn()) {
    throw new Error("Biometric unlock requires HTTPS and WebAuthn support.");
  }
  const issue = getDomainIssue();
  if (issue) throw new Error(issue);

  const challenge = randomBytes(32);
  const userId = randomBytes(32);

  let cred;
  try {
    // Prefer platform UV authenticator when available, but allow fallback on error
    let uvAvailable = false;
    try {
      if (typeof PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable === "function") {
        uvAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
    } catch (e) {
      // ignore detection errors
      uvAvailable = false;
    }

    // Build base options
    cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "ChatApp Device" },
        user: {
          id: userId,
          name: "chatapp-local-user",
          displayName: "ChatApp Local User",
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        timeout: 60000,
        attestation: "none",
        // Prefer platform authenticator (built-in biometric) and require user verification.
        // Some devices/browsers (especially fingerprint on certain Android combos) may fail
        // to create with strict options; we will retry with a relaxed set on failure.
        authenticatorSelection: uvAvailable
          ? {
              authenticatorAttachment: "platform",
              userVerification: "required",
              residentKey: "preferred",
            }
          : {
              userVerification: "required",
            },
      },
    });
  } catch (err) {
    // If creation failed (some fingerprint stacks throw module/import errors), try a relaxed fallback
    try {
      const fallbackCred = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "ChatApp Device" },
          user: {
            id: userId,
            name: "chatapp-local-user",
            displayName: "ChatApp Local User",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 60000,
          attestation: "none",
          // Relaxed: omit authenticatorAttachment and residentKey
          authenticatorSelection: {
            userVerification: "required",
          },
        },
      });
      cred = fallbackCred;
    } catch (err2) {
      throw new Error(mapWebAuthnError(err2 || err));
    }
  }

  if (!cred?.rawId) {
    throw new Error("Failed to register biometric credential.");
  }

  const credentialId = toB64Url(new Uint8Array(cred.rawId));
  writeConfig({
    enabled: true,
    credentialId,
    userId: toB64Url(userId),
    createdAt: Date.now(),
  });
}

export async function verifyBiometricUnlock() {
  if (!canUseWebAuthn()) {
    throw new Error("Biometric unlock is not supported on this browser.");
  }
  const issue = getDomainIssue();
  if (issue) throw new Error(issue);

  const conf = readConfig();
  if (!conf.enabled || !conf.credentialId) {
    throw new Error("Biometric unlock is not enabled on this device.");
  }

  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [
          {
            id: fromB64Url(conf.credentialId),
            type: "public-key",
            // Prefer internal/platform transport; some stacks fail when non-internal transports are present
            transports: ["internal"],
          },
        ],
        timeout: 60000,
        userVerification: "required",
      },
    });
  } catch (err) {
    // Retry without allowCredentials (some browsers accept any UV platform authenticator)
    try {
      assertion = await navigator.credentials.get({
        publicKey: {
          challenge: randomBytes(32),
          timeout: 60000,
          userVerification: "required",
        },
      });
    } catch (err2) {
      throw new Error(mapWebAuthnError(err2 || err));
    }
  }

  if (!assertion) {
    throw new Error("Biometric verification was cancelled.");
  }
}

export function clearBiometricCredential() {
  writeConfig({ enabled: false, credentialId: "", userId: "", createdAt: 0 });
}
