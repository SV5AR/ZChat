import React, { useEffect } from "react";
import AuthPhrase from "./AuthPhrase";
import { clearActivePhrase } from "../utils/sessionSecrets";
import { clearRootPrivateKeyHexFromSession } from "../utils/secureStorage";

function cleanupLegacyAuthArtifacts() {
  try {
    console.log("[Auth][AuthPage] cleanupLegacyAuthArtifacts");
    clearActivePhrase();
    clearRootPrivateKeyHexFromSession();
    // Keep user key/session context for active sign-up/sign-in flow.
    // Do not clear userId/userPrivateKey here; that caused auth boot loops.
    sessionStorage.removeItem("supabase.auth.token");
    sessionStorage.removeItem("chatapp-auth-mode");
    sessionStorage.removeItem("chatapp-email");
  } catch {
    // Ignore storage access issues.
  }
}

const AuthPage = ({ onAuthSuccess }) => {
  useEffect(() => {
    cleanupLegacyAuthArtifacts();
  }, []);

  return <AuthPhrase onAuthSuccess={onAuthSuccess} />;
};

export default AuthPage;
