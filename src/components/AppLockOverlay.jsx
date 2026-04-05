import React, { useState } from "react";
import { useTheme } from "../context/ThemeContext";
import { verifyBiometricUnlock, isBiometricEnabled } from "../utils/biometricGuard";
import {
  PIN_LENGTH,
  isValidPin,
  decryptPhraseWithPin,
} from "../utils/pinVault";
import { loadPinVaultForUser } from "../utils/secureStorage";
import { revokeSessionToken } from "../lib/sessionAuth";
import { signInWithPrivateKey } from "../lib/authProfileService";

const AppLockOverlay = ({ userId, onUnlock, onLogout }) => {
  const { theme } = useTheme();
  const [pin, setPin] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [biometricVerified, setBiometricVerified] = useState(false);
  const biometricRequired = isBiometricEnabled();

  const unlockWithPin = async () => {
    const uid = String(userId || "").trim().toLowerCase();
    if (!uid) return;
    if (!isValidPin(pin)) {
      setStatus(`Enter a ${PIN_LENGTH}-digit PIN.`);
      return;
    }
    if (biometricRequired && !biometricVerified) {
      setStatus("Verify biometrics first, then enter PIN.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const vault = await loadPinVaultForUser(uid);
      if (!vault) throw new Error("No PIN vault found");
      const privateKeyHex = await decryptPhraseWithPin(vault, pin);
      if (!/^[0-9a-f]{64}$/i.test(String(privateKeyHex || ""))) {
        throw new Error("Invalid unlock key");
      }
      const clean = String(privateKeyHex).trim().toLowerCase();
      const signedIn = await signInWithPrivateKey(clean, true);
      onUnlock?.({
        userId: signedIn.userId,
        publicKey: signedIn.publicKey,
        privateKey: clean,
      });
    } catch (e) {
      setStatus(e?.message || "Failed to unlock");
    } finally {
      setBusy(false);
    }
  };

  const unlockWithBiometric = async () => {
    setBusy(true);
    setStatus("");
    try {
      if (!isBiometricEnabled()) throw new Error("Biometric unlock is not enabled");
      await verifyBiometricUnlock();
      setBiometricVerified(true);
      setStatus("Biometric verified. Enter PIN to unlock.");
    } catch (e) {
      setStatus(e?.message || "Biometric verification failed");
    } finally {
      setBusy(false);
    }
  };

  const doLogout = async () => {
    setBusy(true);
    try {
      await revokeSessionToken();
    } catch {
      // best effort
    }
    onLogout?.();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999,
        background: "rgba(0,0,0,0.72)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 360,
          background: theme.surface,
          borderRadius: 18,
          border: `1px solid ${theme.border}`,
          padding: 16,
          boxShadow: `0 16px 44px rgba(0,0,0,0.38), 0 0 18px ${theme.primaryGlow || "rgba(255,255,255,0.14)"}`,
          animation: "floatIn 0.24s ease both",
        }}
      >
        <div style={{ color: theme.text, fontSize: 17, fontWeight: 700, marginBottom: 8 }}>
          App Locked
        </div>
        <div style={{ color: theme.text3, fontSize: 12, marginBottom: 12 }}>
          {biometricRequired
            ? "Unlock with Face ID / fingerprint first, then PIN."
            : "Unlock with PIN."}
        </div>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          placeholder="Enter PIN"
          inputMode="numeric"
          autoComplete="off"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${theme.inputBorder}`,
            background: theme.inputBg,
            color: theme.text,
            marginBottom: 10,
          }}
        />
        <button
          onClick={unlockWithPin}
          disabled={busy}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: "none",
            background: theme.primary,
            color: theme.primaryFg,
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: 8,
          }}
        >
          {busy ? "Unlocking..." : "Unlock"}
        </button>
        <button
          onClick={unlockWithBiometric}
          disabled={busy || !biometricRequired}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: 10,
            border: `1px solid ${theme.border}`,
            background: biometricVerified ? `${theme.success}20` : theme.surface2,
            color: biometricVerified ? theme.success : theme.text,
            fontWeight: 700,
            cursor: biometricRequired ? "pointer" : "default",
            marginBottom: 14,
            opacity: biometricRequired ? 1 : 0.45,
          }}
        >
          {biometricRequired
            ? biometricVerified
              ? "Biometric verified"
              : "Use Face ID / Fingerprint"
            : "Biometric unavailable"}
        </button>
        {status && (
          <div style={{ fontSize: 11, color: theme.warning, marginBottom: 10 }}>{status}</div>
        )}
        <button
          onClick={doLogout}
          style={{
            width: "100%",
            padding: "9px 12px",
            borderRadius: 10,
            border: `1px solid ${theme.danger}`,
            background: `${theme.danger}22`,
            color: theme.danger,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default AppLockOverlay;
