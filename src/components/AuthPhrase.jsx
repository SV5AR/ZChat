import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useTheme } from "../context/ThemeContext";
import {
  LockIcon,
  CopyIcon,
  RefreshCwIcon,
  PaletteIcon,
  EyeIcon,
  EyeOffIcon,
  CheckIcon,
  TrashIcon,
  ChevronDownIcon,
  AlertIcon,
  PasteIcon,
} from "./Icons";
import {
  generateSecurePhrase,
  validatePhrase,
} from "../utils/bip39Auth";
import { deriveAesKeyFromPrivateKey } from "../utils/zchatIdentity";
import {
  encryptWithKey,
  decryptWithKey,
} from "../utils/crypto";
import {
  initSecureStorage,
  loadPinVault,
  loadPinVaultForUser,
  listPinVaultEntries,
  savePinVault,
  savePinVaultForUser,
  clearPinVault,
  clearPinVaultForUser,
  saveAccount,
  listAccounts,
  removeAccount,
  saveRootKeyForUser,
  loadRootKeyForUser,
  clearRootKeyForUser,
  markRootKeyEncryptedForUser,
} from "../utils/secureStorage";
import {
  PIN_LENGTH,
  isValidPin,
  getPinStrengthError,
  encryptPhraseWithPin,
  decryptPhraseWithPin,
} from "../utils/pinVault";
import {
  getPinGuardStatus,
  registerPinFailure,
  registerPinSuccess,
  formatCooldown,
} from "../utils/pinGuard";
import {
  isBiometricEnabled,
  verifyBiometricUnlock,
} from "../utils/biometricGuard";
import ThemePicker from "./ThemePicker";
import {
  signInWithPhrase,
  signInWithPrivateKey,
  signUpWithPhrase,
} from "../lib/authProfileService";
import { persistSessionTokenToLocal, disableRememberMe } from "../lib/edgeApi";
import { detectIncognitoMode } from "../utils/incognitoMode";

const AuthPhrase = ({ onAuthSuccess }) => {
  const { theme } = useTheme();
  const [mode, setMode] = useState("signin");
  const [signupStep, setSignupStep] = useState("choose");
  const [wordCount, setWordCount] = useState(12);
  const [phrase, setPhrase] = useState("");
  const [phraseInput, setPhraseInput] = useState("");
  const [writtenDown, setWrittenDown] = useState(false);
  const [msg, setMsg] = useState({ text: "", type: "info" });
  const [copyHint, setCopyHint] = useState(false);
  const [loading, setLoading] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [showPhrase, setShowPhrase] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [unlockPin, setUnlockPin] = useState("");
  const [hasPinVault, setHasPinVault] = useState(false);
  const [pinVaultEntries, setPinVaultEntries] = useState([]);
  const [vaultTargetUserId, setVaultTargetUserId] = useState("");
  const [vaultDropdownOpen, setVaultDropdownOpen] = useState(false);
  const [pinLockRemaining, setPinLockRemaining] = useState(0);
  const [clearingVault, setClearingVault] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [clearError, setClearError] = useState("");
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [activeSubmit, setActiveSubmit] = useState("");
  const [showSavedLoginModal, setShowSavedLoginModal] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [isIncognitoMode, setIsIncognitoMode] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [mobilePanelClass, setMobilePanelClass] = useState("");
  const [canPastePhrase, setCanPastePhrase] = useState(true);
  const [clipboardFallbackText, setClipboardFallbackText] = useState("");
  const fadeRef = useRef(null);
  const mobileSwapTimersRef = useRef([]);
  const vaultDropdownRef = useRef(null);
  const rootWrapRef = useRef(null);
  const cardRef = useRef(null);

  const getScrollableParent = (el) => {
    let node = el?.parentElement;
    while (node) {
      const style = window.getComputedStyle(node);
      const canScroll =
        (style.overflowY === "auto" || style.overflowY === "scroll") &&
        node.scrollHeight > node.clientHeight;
      if (canScroll) return node;
      node = node.parentElement;
    }
    return null;
  };

  const keepInputAboveKeyboard = (targetEl) => {
    const inputEl = targetEl || document.activeElement;
    if (!inputEl || !(inputEl instanceof HTMLElement)) return;

    requestAnimationFrame(() => {
      const vv = window.visualViewport;
      const viewportHeight = vv?.height || window.innerHeight;
      const offsetTop = vv?.offsetTop || 0;
      const rect = inputEl.getBoundingClientRect();
      const safeBottomPadding = 16;
      const keyboardTop = offsetTop + viewportHeight;

      const scrollTargets = [
        getScrollableParent(inputEl),
        cardRef.current,
        rootWrapRef.current,
        document.scrollingElement,
      ].filter(Boolean);

      let handled = false;
      for (const target of scrollTargets) {
        if (!(target instanceof HTMLElement)) continue;
        const targetRect = target.getBoundingClientRect();
        const visibleBottom = Math.min(targetRect.bottom, keyboardTop) - safeBottomPadding;
        const delta = rect.bottom - visibleBottom;
        if (delta > 0) {
          target.scrollBy({ top: delta + 10, behavior: "smooth" });
          handled = true;
          break;
        }
      }

      if (!handled) {
        const requiredBottom = rect.bottom + safeBottomPadding;
        const delta = requiredBottom - keyboardTop;
        if (delta > 0) {
          window.scrollBy({ top: delta + 10, behavior: "smooth" });
        } else {
          inputEl.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }

      setTimeout(() => {
        const latest = inputEl.getBoundingClientRect();
        const postDelta = latest.bottom + safeBottomPadding - (offsetTop + (window.visualViewport?.height || window.innerHeight));
        if (postDelta > 0) {
          window.scrollBy({ top: postDelta + 6, behavior: "smooth" });
        }
      }, 130);
    });
  };

  useEffect(() => {
    function handleClickOutside(event) {
      if (vaultDropdownRef.current && !vaultDropdownRef.current.contains(event.target)) {
        setVaultDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setCanPastePhrase(true);
  }, [mode, signupStep]);

  useEffect(() => {
    return () => {
      mobileSwapTimersRef.current.forEach((id) => clearTimeout(id));
      mobileSwapTimersRef.current = [];
    };
  }, []);

  const runMobileSwap = (applyChange) => {
    if (!isMobileViewport) {
      applyChange();
      return;
    }

    mobileSwapTimersRef.current.forEach((id) => clearTimeout(id));
    mobileSwapTimersRef.current = [];

    setMobilePanelClass("mobile-auth-out-left");
    const outTimer = setTimeout(() => {
      applyChange();
      setMobilePanelClass("mobile-auth-in-right");
      const inTimer = setTimeout(() => {
        setMobilePanelClass("");
      }, 260);
      mobileSwapTimersRef.current.push(inTimer);
    }, 170);
    mobileSwapTimersRef.current.push(outTimer);
  };

  useEffect(() => {
    if (vaultDropdownOpen) {
      requestAnimationFrame(() => {
        const anchor = vaultDropdownRef.current;
        if (anchor) {
          anchor.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }
  }, [vaultDropdownOpen]);

  useEffect(() => {
    if (!showSavedLoginModal) return;
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        keepInputAboveKeyboard(active);
      }
    });
  }, [showSavedLoginModal, vaultDropdownOpen, pinLockRemaining, selectedAccount, vaultTargetUserId, pinVaultEntries]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return undefined;

    let raf = null;
    const onViewportChange = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const inset = Math.max(
          0,
          window.innerHeight - (vv.height + vv.offsetTop),
        );
        setKeyboardInset(inset);
        keepInputAboveKeyboard();
      });
    };

    vv.addEventListener("resize", onViewportChange);
    vv.addEventListener("scroll", onViewportChange);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      setKeyboardInset(0);
      vv.removeEventListener("resize", onViewportChange);
      vv.removeEventListener("scroll", onViewportChange);
    };
  }, []);

  const handleClearVault = async () => {
    setShowClearConfirm(true);
  };

  const confirmClearVault = async () => {
    setShowClearConfirm(false);
    setClearError("");
    setClearingVault(true);
    try {
      await initSecureStorage();
      
      // Revoke all tokens and clear accounts
      const { revokeSessionToken } = await import("../lib/sessionAuth");
      for (const acc of accounts) {
        try {
          await revokeSessionToken();
        } catch {
          // Continue even if revoke fails
        }
      }
      
      // Clear all pin vaults
      for (const entry of pinVaultEntries) {
        if (entry.userId) {
          await clearPinVaultForUser(entry.userId);
        }
      }

      // Clear legacy global pin vault key too
      await clearPinVault().catch(() => {});
      
      // Clear all accounts
      for (const acc of accounts) {
        await removeAccount(acc.userId);
      }

      // Clear active runtime session artifacts
      try {
        localStorage.removeItem("chatapp-manual-logout");
      } catch {
        // ignore
      }
      sessionStorage.removeItem("userId");
      sessionStorage.removeItem("userPublicKey");
      sessionStorage.removeItem("userPrivateKey");
      
      setPinVaultEntries([]);
      setHasPinVault(false);
      setVaultTargetUserId("");
      setAccounts([]);
      setSelectedAccount(null);
      showMsg("All vaults cleared successfully", "success");
    } catch (e) {
      setClearError("Failed to clear vault: " + e.message);
    } finally {
      setClearingVault(false);
    }
  };
  const copyRef = useRef(null);

  const showMsg = (text, type = "info") => {
    if (fadeRef.current) {
      clearTimeout(fadeRef.current);
      fadeRef.current = null;
    }
    setMsg({ text, type });
    fadeRef.current = setTimeout(() => {
      setMsg({ text: "", type: "info" });
      fadeRef.current = null;
    }, 4000);
  };

  const showCopy = () => {
    setCopyHint(true);
    if (copyRef.current) clearTimeout(copyRef.current);
    copyRef.current = setTimeout(() => setCopyHint(false), 1800);
  };

  useEffect(() => {
    const userId = sessionStorage.getItem("userId");
    if (!userId) return;
    console.log("[Auth][AuthPhrase] auto onAuthSuccess", userId);
    onAuthSuccess?.(userId);
  }, [onAuthSuccess]);

  const persistRootKey = async (userId, privateKey, options = {}) => {
    const uid = String(userId || "").trim().toLowerCase();
    const key = String(privateKey || "").trim().toLowerCase();
    if (!uid || !/^[0-9a-f]{64}$/i.test(key)) {
      throw new Error("Invalid root key for persistence");
    }
    await saveRootKeyForUser(uid, key);
    if (options.remember) {
      persistSessionTokenToLocal();
    } else {
      disableRememberMe();
    }
  };

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mediaQuery = window.matchMedia("(max-width: 820px), (pointer: coarse)");
    const sync = () => setIsMobileViewport(mediaQuery.matches);
    sync();
    mediaQuery.addEventListener("change", sync);
    return () => mediaQuery.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    detectIncognitoMode()
      .then((isIncognito) => {
        setIsIncognitoMode(isIncognito);
        if (isIncognito) {
          setPinEnabled(false);
          setRememberMe(false);
        }
      })
      .catch(() => setIsIncognitoMode(false));
  }, []);

  useEffect(() => {
    initSecureStorage()
      .then(() => Promise.all([
        listPinVaultEntries(),
        listAccounts()
      ]))
      .then(([entries, accs]) => {
        setPinVaultEntries(entries || []);
        setHasPinVault(Boolean(entries?.length));
        setVaultTargetUserId("auto");
        setAccounts(accs || []);
      })
      .catch(() => {
        setPinVaultEntries([]);
        setHasPinVault(false);
        setAccounts([]);
      });
  }, []);

  useEffect(() => {
    const refresh = () => {
      const status = getPinGuardStatus();
      setPinLockRemaining(status.remainingMs);
    };

    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const normalizePhrase = (value) =>
    value
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");

  const openSignup = () => {
    runMobileSwap(() => {
      setMode("signup");
      setSignupStep("choose");
      setWordCount(12);
      setPhrase("");
      setPhraseInput("");
      setWrittenDown(false);
      setMsg({ text: "", type: "info" });
      setShowPhrase(false);
      setSigningIn(false);
      setPinEnabled(false);
      setPinInput("");
      setPinConfirm("");
    });
  };

  const startSignupFlow = (wc) => {
    runMobileSwap(() => {
      setWordCount(wc);
      setPhrase(generateSecurePhrase(wc));
      setPhraseInput("");
      setWrittenDown(false);
      setShowPhrase(false);
      setSignupStep("reveal");
      setPinEnabled(false);
      setPinInput("");
      setPinConfirm("");
    });
  };

  const goBackToSignIn = () => {
    runMobileSwap(() => {
      setMode("signin");
      setSignupStep("choose");
      setPhrase("");
      setPhraseInput("");
      setWrittenDown(false);
      setMsg({ text: "", type: "info" });
      setShowPhrase(false);
      setSigningIn(false);
      setPinEnabled(false);
      setPinInput("");
      setPinConfirm("");
    });
  };

  const goBackSignupStep = () => {
    if (signupStep === "verify") {
      runMobileSwap(() => {
        setSignupStep("reveal");
        setPhraseInput("");
      });
      return;
    }
    if (signupStep === "reveal") {
      runMobileSwap(() => {
        setSignupStep("choose");
        setPhrase("");
        setPhraseInput("");
        setWrittenDown(false);
      });
      return;
    }
    goBackToSignIn();
  };

  const proceedToVerify = () => {
    if (!writtenDown) {
      showMsg("Confirm that you wrote the phrase down first.", "error");
      return;
    }
    runMobileSwap(() => {
      setSignupStep("verify");
      setPhraseInput("");
    });
  };

  const normalizePastedPhrase = (value) =>
    String(value || "")
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[.,;:!?()[\]{}<>"'`~@#$%^&*_+=|\\/]+/g, " ")
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");

  const readClipboardSmart = async () => {
    if (navigator?.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText();
      } catch {
        // fall back to legacy path
      }
    }
    try {
      const host = document.createElement("textarea");
      host.setAttribute("aria-hidden", "true");
      host.style.position = "fixed";
      host.style.opacity = "0";
      host.style.left = "-9999px";
      document.body.appendChild(host);
      host.focus();
      const ok = document.execCommand("paste");
      const value = host.value || "";
      document.body.removeChild(host);
      if (ok && value) return value;
    } catch {
      // ignore
    }
    if (clipboardFallbackText) return clipboardFallbackText;
    throw new Error("clipboard-unavailable");
  };

  const pastePhraseFromClipboard = async (target = "signin") => {
    try {
      const text = await readClipboardSmart();
      const cleaned = normalizePastedPhrase(text);
      const words = cleaned ? cleaned.split(" ") : [];
      const valid = words.length === 12 || words.length === 24;
      if (!valid) {
        showMsg("Clipboard must contain a 12/24-word phrase.", "error");
        return;
      }
      setPhraseInput(cleaned);
      setClipboardFallbackText("");
    } catch {
      showMsg(
        "Clipboard read is blocked. Paste manually into the input field once, then tap Paste again.",
        "error",
      );
    }
  };

  const handleRegenerate = () => {
    setPhrase(generateSecurePhrase(wordCount));
    setPhraseInput("");
    setWrittenDown(false);
  };

  const handleVerifyPhrase = async () => {
    if (!phraseInput.trim()) {
      showMsg(`Please type your ${wordCount} words to verify.`, "error");
      return;
    }
    if (normalizePhrase(phraseInput) !== normalizePhrase(phrase)) {
      showMsg("Phrases don't match. Check carefully.", "error");
      setPhraseInput("");
      return;
    }
    setLoading(true);
    setBusyText("Verifying phrase...");
    try {
      if (pinEnabled) {
        const strengthError = getPinStrengthError(pinInput);
        if (strengthError) {
          throw new Error(strengthError);
        }
        if (pinInput !== pinConfirm) {
          throw new Error("PIN confirmation does not match");
        }
      }

      const created = await signUpWithPhrase(phrase, rememberMe);
      sessionStorage.setItem("userId", created.userId);
      sessionStorage.setItem("userPublicKey", created.publicKey);
      sessionStorage.setItem("userPrivateKey", created.privateKey);
      if (rememberMe && !pinEnabled) {
        await persistRootKey(created.userId, created.privateKey, {
          remember: true,
        });
      } else {
        disableRememberMe();
      }

      // Save account for quick login if PIN enabled or Remember Me checked
      if (pinEnabled || rememberMe) {
        await saveAccount({
          userId: created.userId,
          username: created.username,
          publicKey: created.publicKey,
        });
        const accs = await listAccounts().catch(() => []);
        setAccounts(accs);
      }

      if (pinEnabled) {
        const vault = await encryptPhraseWithPin(created.privateKey, pinInput);
        await savePinVault(vault);
        await savePinVaultForUser(created.userId, vault, created.username);
        await markRootKeyEncryptedForUser(created.userId);
        const persistedVault = await loadPinVaultForUser(created.userId);
        if (!persistedVault) {
          throw new Error(
            "Unable to persist device PIN vault. Check browser storage permissions and try again.",
          );
        }
        setHasPinVault(true);
        const entries = await listPinVaultEntries().catch(() => []);
        setPinVaultEntries(entries || []);
        if (entries?.length === 1) {
          setVaultTargetUserId(entries[0].userId || "");
        }
      } else {
        await clearPinVault().catch(() => {});
        const entries = await listPinVaultEntries().catch(() => []);
        setPinVaultEntries(entries || []);
        setHasPinVault(Boolean(entries?.length));
        if (entries?.length === 1) {
          setVaultTargetUserId(entries[0].userId || "");
        }
      }

      showMsg("Account created! Signing you in…", "success");
      setBusyText("Creating secure session...");
      setSigningIn(true);
      setPhraseInput("");
      setPinInput("");
      setPinConfirm("");
      setTimeout(() => {
        setBusyText("");
        console.log("[Auth][AuthPhrase] signup onAuthSuccess", created.userId);
        onAuthSuccess?.(created.userId);
        setSigningIn(false);
      }, 450);
    } catch (e) {
      showMsg(e.message || "Signup failed.", "error");
      setSigningIn(false);
      setBusyText("");
    } finally {
      setLoading(false);
    }
  };

  const handleAccountLogin = async (account, useBiometric = false) => {
      if (!account || !account.userId) {
        throw new Error("Invalid account data");
      }

      const savedRootKey = await loadRootKeyForUser(account.userId);
      if (!savedRootKey) {
        throw new Error("Saved login key not found for this account");
      }

    // If biometric enabled and user chose to use it
    if (useBiometric) {
      try {
        const { verifyBiometricUnlock, isBiometricEnabled } = await import("../utils/biometricGuard");
        if (isBiometricEnabled()) {
          await verifyBiometricUnlock();
        }
      } catch (e) {
        showMsg(e.message || "Biometric verification failed", "error");
        return;
      }
    }

    setSigningIn(true);
    setBusyText("Verifying saved account...");
      try {
        // Create a fresh session token for edge API calls.
        const signedIn = await signInWithPrivateKey(savedRootKey, rememberMe);

        sessionStorage.setItem("userId", signedIn.userId);
        sessionStorage.setItem("userPublicKey", signedIn.publicKey);
        sessionStorage.setItem("userPrivateKey", signedIn.privateKey);
        if (rememberMe) {
          await persistRootKey(signedIn.userId, signedIn.privateKey, {
            remember: true,
          });
        }

      showMsg("Signed in! Loading…", "success");
      setBusyText("Opening secure session...");
      setTimeout(() => {
        setBusyText("");
        console.log("[Auth][AuthPhrase] account login onAuthSuccess", signedIn.userId);
        onAuthSuccess?.(signedIn.userId);
      }, 350);
    } finally {
      setSigningIn(false);
    }
  };

  const handleRemoveAccount = async (acc, e) => {
    e.stopPropagation();
    try {
      const { revokeSessionToken } = await import("../lib/sessionAuth");
      await revokeSessionToken();
      await removeAccount(acc.userId);
      const { clearBiometricCredential } = await import("../utils/biometricGuard");
      clearBiometricCredential();
      const accs = await listAccounts();
      setAccounts(accs);
      if (selectedAccount?.userId === acc.userId) {
        setSelectedAccount(null);
      }
      showMsg("Account removed", "success");
    } catch (err) {
      showMsg(err.message || "Failed to remove account", "error");
    }
  };

  const refreshStoredEntries = async () => {
    const [entries, accs] = await Promise.all([
      listPinVaultEntries().catch(() => []),
      listAccounts().catch(() => []),
    ]);
    setPinVaultEntries(entries || []);
    setHasPinVault(Boolean(entries?.length));
    setAccounts(accs || []);
  };

  const getAccountOptions = () => {
    const merged = new Map();

    for (const acc of accounts) {
      if (!acc?.userId) continue;
      merged.set(acc.userId, {
        userId: acc.userId,
        username: acc.username || null,
        hasSavedAccount: true,
        hasPinVault: false,
        account: acc,
      });
    }

    for (const entry of pinVaultEntries) {
      const userId = entry?.userId;
      if (!userId) continue;
      const existing = merged.get(userId);
      if (existing) {
        existing.hasPinVault = true;
        if (!existing.username && entry.username) existing.username = entry.username;
      } else {
        merged.set(userId, {
          userId,
          username: entry.username || null,
          hasSavedAccount: false,
          hasPinVault: true,
          account: null,
        });
      }
    }

    return Array.from(merged.values());
  };

  const handleSelectAccountOption = async (option) => {
    if (!option?.userId) return;
    setVaultDropdownOpen(false);

    if (option.hasPinVault) {
      setVaultTargetUserId(option.userId);
      if (option.account) {
        setSelectedAccount(option.account);
      } else {
        setSelectedAccount({
          userId: option.userId,
          username: option.username || null,
        });
      }
      setPhraseInput("");
      showMsg("Enter your PIN to unlock this account", "info");
      return;
    }

    setUnlockPin("");
    setVaultTargetUserId("auto");

    if (option.hasSavedAccount && option.account) {
      setSelectedAccount(option.account);
      setAccountsLoading(true);
      try {
        await handleAccountLogin(option.account);
      } catch (e) {
        showMsg(e.message || "Login failed", "error");
      } finally {
        setAccountsLoading(false);
      }
    }
  };

  const handleBiometricAccountOption = async (option, e) => {
    e.stopPropagation();
    if (!option?.hasSavedAccount || !option?.account) {
      showMsg("No saved key for this account", "error");
      return;
    }

    try {
      if (!isBiometricEnabled()) {
        throw new Error("Biometric unlock is not enabled on this device");
      }
      await verifyBiometricUnlock();

      setVaultDropdownOpen(false);
      setSelectedAccount(option.account);
      setAccountsLoading(true);
      await handleAccountLogin(option.account);
    } catch (err) {
      showMsg(err.message || "Biometric verification failed", "error");
    } finally {
      setAccountsLoading(false);
    }
  };

  const handleRemoveAccountOption = async (option, e) => {
    e.stopPropagation();
    try {
      if (option.hasSavedAccount) {
        await removeAccount(option.userId);
        await clearRootKeyForUser(option.userId);
      } else {
        await clearPinVaultForUser(option.userId);
      }

      // Also clear global pin vault if it belongs to this account
      try {
        const globalVault = await loadPinVault();
        const userVault = await loadPinVaultForUser(option.userId);
        if (globalVault && userVault && globalVault === userVault) {
          await clearPinVault();
        }
      } catch {
        // ignore
      }

      if (selectedAccount?.userId === option.userId) {
        setSelectedAccount(null);
      }
      if (vaultTargetUserId === option.userId) {
        setVaultTargetUserId("auto");
      }

      await refreshStoredEntries();
      showMsg("Account removed", "success");
    } catch (err) {
      showMsg(err.message || "Failed to remove account", "error");
    }
  };

  const resolveSelectedAccountLabel = () => {
    if (selectedAccount?.username) return selectedAccount.username;
    if (selectedAccount?.userId) {
      return `${selectedAccount.userId.slice(0, 6)}...${selectedAccount.userId.slice(-4)}`;
    }
    if (vaultTargetUserId && vaultTargetUserId !== "auto") {
      const entry = pinVaultEntries.find((e) => e.userId === vaultTargetUserId);
      if (entry?.username) return entry.username;
      return `${vaultTargetUserId.slice(0, 6)}...${vaultTargetUserId.slice(-4)}`;
    }
    return "Select Account";
  };

  const handleSignIn = async (e, preferredMode = "auto") => {
    if (e?.preventDefault) e.preventDefault();
    if (activeSubmit) return;
    setActiveSubmit(preferredMode);
    setLoading(true);
    setSigningIn(true);
    setBusyText("Verifying credentials...");
    try {
      const hasPhrase = phraseInput.trim().length > 0;
      const hasPin = unlockPin.length > 0;

      if (preferredMode === "pin" && !hasPinVault) {
        throw new Error("No PIN vault found for this device/account");
      }
      
      // Prefer PIN mode when PIN is available, even if phrase input has text

      const usePinMode =
        preferredMode === "pin" ||
        (preferredMode === "auto" && hasPin && !hasPhrase);

      // Priority: explicit PIN mode, otherwise phrase
      let resolvedPhrase = "";
      let resolvedPrivateKey = "";
      
      if (usePinMode && hasPinVault) {
        const guard = getPinGuardStatus();
        if (guard.locked) {
          throw new Error(
            `PIN temporarily locked. Try again in ${formatCooldown(guard.remainingMs)}.`,
          );
        }

        let vault = await loadPinVault();
        let matchedUserId = "";
        let unlockedPhrase = "";

        if (pinVaultEntries.length > 0) {
          const orderedEntries =
            vaultTargetUserId && vaultTargetUserId !== "auto"
              ? [
                  ...pinVaultEntries.filter(
                    (entry) => entry.userId === vaultTargetUserId,
                  ),
                  ...pinVaultEntries.filter(
                    (entry) => entry.userId !== vaultTargetUserId,
                  ),
                ]
              : pinVaultEntries;

          for (const entry of orderedEntries) {
            try {
              const phraseCandidate = await decryptPhraseWithPin(
                entry.vault,
                unlockPin,
              );
              unlockedPhrase = phraseCandidate;
              matchedUserId = entry.userId || "";
              vault = entry.vault;
              break;
            } catch {
              // Try next vault entry.
            }
          }
        }

        if (!unlockedPhrase && vault) {
          try {
            unlockedPhrase = await decryptPhraseWithPin(vault, unlockPin);
          } catch {
            // handled below via guard failure path
          }
        }

        if (!vault) {
          throw new Error(
            "Secure vault not found on this device. In Private/Incognito mode, device vault data is usually cleared when you close the tab or browser.",
          );
        }
        if (!isValidPin(unlockPin)) {
          throw new Error(`Enter your ${PIN_LENGTH}-digit PIN to unlock`);
        }
        if (isBiometricEnabled()) {
          try {
            await verifyBiometricUnlock();
          } catch {
            throw new Error("Biometric verification failed or was cancelled.");
          }
        }
        try {
          if (!unlockedPhrase) {
            throw new Error("invalid_pin");
          }
          resolvedPrivateKey = unlockedPhrase;
          registerPinSuccess();

          if (matchedUserId && vault) {
            await savePinVaultForUser(matchedUserId, vault).catch(() => {});
          }
        } catch {
          const next = registerPinFailure();
          if (next.remainingMs > 0) {
            throw new Error(
              `Invalid PIN. Locked for ${formatCooldown(next.remainingMs)}.`,
            );
          }
          throw new Error("Invalid PIN. Please try again.");
        }
      }

      // If PIN mode didn't resolve key but we have phrase input, use phrase
      if (!resolvedPrivateKey && !resolvedPhrase && hasPhrase) {
        resolvedPhrase = phraseInput.trim();
      }

      if (!resolvedPrivateKey && !resolvedPhrase) {
        // Show contextual error based on what user has entered
        if (hasPhrase) {
          throw new Error("Enter your recovery phrase");
        }
        if (hasPin && hasPinVault) {
          throw new Error("Enter your PIN");
        }
        throw new Error("Enter your recovery phrase or unlock with PIN");
      }
      let signedIn;
      if (resolvedPrivateKey) {
        signedIn = await signInWithPrivateKey(resolvedPrivateKey, rememberMe);
      } else {
        if (!validatePhrase(resolvedPhrase)) {
          throw new Error("Invalid format — use a valid 12 or 24 word phrase.");
        }
        signedIn = await signInWithPhrase(resolvedPhrase, rememberMe);
      }

      sessionStorage.setItem("userId", signedIn.userId);
      sessionStorage.setItem("userPublicKey", signedIn.publicKey);
      sessionStorage.setItem("userPrivateKey", signedIn.privateKey);
      if (rememberMe && !hasPinVault) {
        await persistRootKey(signedIn.userId, signedIn.privateKey, {
          remember: true,
        });
      } else if (!rememberMe) {
        disableRememberMe();
      }

      // Save/update account for quick login if PIN enabled or Remember Me checked
      let username = null;
      if (signedIn.encryptedUsername && signedIn.privateKey) {
        try {
          const aesKey = await deriveAesKeyFromPrivateKey(signedIn.privateKey);
          username = await decryptWithKey(signedIn.encryptedUsername, aesKey);
        } catch (e) {
          console.warn("Failed to decrypt username for account save:", e);
        }
      }
      
      if (hasPinVault || rememberMe) {
        await saveAccount({
          userId: signedIn.userId,
          username: username,
          publicKey: signedIn.publicKey,
        });
        const accs = await listAccounts().catch(() => []);
        setAccounts(accs);
      }

      // Update vault with username if needed
      if (username) {
        const vaultEntry = pinVaultEntries.find(e => e.userId === signedIn.userId);
        if (vaultEntry && !vaultEntry.username) {
          await savePinVaultForUser(signedIn.userId, vaultEntry.vault, username);
          const entries = await listPinVaultEntries().catch(() => []);
          setPinVaultEntries(entries || []);
        }
      }
      showMsg("Signed in! Loading…", "success");
      setBusyText("Opening secure session...");
      setShowSavedLoginModal(false);
      setTimeout(() => {
        setBusyText("");
        console.log("[Auth][AuthPhrase] sign-in onAuthSuccess", signedIn.userId);
        onAuthSuccess?.(signedIn.userId);
      }, 350);
    } catch (e) {
      showMsg(e.message || "Sign in failed.", "error");
      setBusyText("");
      setSigningIn(false);
    } finally {
      setLoading(false);
      setActiveSubmit("");
      setPhraseInput("");
      setUnlockPin("");
    }
  };

  const msgColors = {
    info: {
      bg: `${theme.primary}22`,
      border: theme.primary,
      color: theme.primary,
    },
    success: {
      bg: `${theme.success}22`,
      border: theme.success,
      color: theme.success,
    },
    error: {
      bg: `${theme.danger}22`,
      border: theme.danger,
      color: theme.danger,
    },
  };

  const s = {
    wrap: {
      height: "100dvh",
      background: theme.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 16,
      position: "relative",
      overflowY: "auto",
      WebkitOverflowScrolling: "touch",
    },
    card: {
      background: theme.surface,
      borderRadius: 28,
      padding: 20,
      width: "100%",
      maxWidth: 480,
      boxShadow: theme.cardShadow,
      border: `1px solid ${theme.border}`,
      position: "relative",
      zIndex: 1,
      maxHeight: "90dvh",
      overflowY: "auto",
      overflowX: "hidden",
    },
    input: {
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      border: `1.5px solid ${theme.inputBorder}`,
      background: theme.inputBg,
      color: theme.text,
      fontSize: 16,
      outline: "none",
      marginBottom: 12,
      boxSizing: "border-box",
      fontFamily: "inherit",
      lineHeight: 1.5,
    },
    phraseBox: {
      background: theme.surface2,
      border: `2px solid ${theme.primary}`,
      borderRadius: 12,
      padding: 16,
      marginBottom: 12,
      fontFamily: "monospace",
      fontSize: 13,
      color: theme.text,
      lineHeight: 1.8,
      textAlign: "center",
      letterSpacing: "0.3px",
      wordBreak: "break-word",
    },
    btn: (bg, fg) => ({
      width: "100%",
      padding: "10px 12px",
      borderRadius: 12,
      background: bg,
      color: fg,
      fontWeight: 600,
      fontSize: 14,
      border: "none",
      cursor: "pointer",
      marginTop: 2,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
    }),
    btnSmall: (bg, fg) => ({
      padding: "7px 13px",
      borderRadius: 10,
      background: bg,
      color: fg,
      fontWeight: 600,
      fontSize: 11,
      border: "none",
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 4,
    }),
    link: {
      background: "none",
      border: "none",
      color: theme.primary,
      fontSize: 12,
      cursor: "pointer",
      textDecoration: "underline",
      padding: 0,
    },
  };

  const FancyCheckbox = ({ checked, onToggle, label, disabled = false }) => (
    <button
      type="button"
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        borderRadius: 12,
        border: `1px solid ${checked ? theme.primary : theme.border}`,
        background: checked ? `${theme.primary}16` : theme.surface2,
        color: disabled ? theme.text3 : theme.text2,
        padding: "10px 12px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
        textAlign: "left",
        transition:
          "border-color 0.28s cubic-bezier(0.22,1,0.36,1), background-color 0.28s cubic-bezier(0.22,1,0.36,1), transform 0.12s ease",
        marginBottom: 10,
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = "scale(0.992)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: 6,
          border: `1.5px solid ${checked ? theme.primary : theme.inputBorder}`,
          background: checked ? theme.primary : theme.surface,
          boxShadow: checked ? `0 0 0 3px ${theme.primary}2f` : "0 0 0 0 rgba(0,0,0,0)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginTop: 1,
          flexShrink: 0,
          transition:
            "border-color 0.28s cubic-bezier(0.22,1,0.36,1), background-color 0.28s cubic-bezier(0.22,1,0.36,1), box-shadow 0.28s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        <span
          style={{
            color: theme.primaryFg,
            display: "inline-flex",
            opacity: checked ? 1 : 0,
            transform: checked ? "scale(1) translateY(0)" : "scale(0.65) translateY(1px)",
            transition: "opacity 0.2s cubic-bezier(0.22,1,0.36,1), transform 0.2s cubic-bezier(0.22,1,0.36,1)",
          }}
        >
          <CheckIcon size={12} />
        </span>
      </span>
      <span
        style={{
          fontSize: 12,
          lineHeight: 1.5,
          color: checked ? theme.text : theme.text2,
          transition: "color 0.2s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {label}
      </span>
    </button>
  );

  const savedLoginOptions = getAccountOptions();
  const selectedSavedLoginUserId =
    vaultTargetUserId && vaultTargetUserId !== "auto"
      ? vaultTargetUserId
      : selectedAccount?.userId || "";
  const selectedSavedLoginOption = savedLoginOptions.find(
    (opt) => opt.userId === selectedSavedLoginUserId,
  );
  const selectedRequiresPin = Boolean(selectedSavedLoginOption?.hasPinVault);
  const modeBadge = pinEnabled
    ? { text: "PIN + Session", color: theme.success, bg: `${theme.success}1f` }
    : rememberMe
      ? { text: "Keep Session", color: theme.warning, bg: `${theme.warning}1f` }
      : { text: "Session Only", color: theme.danger, bg: `${theme.danger}1f` };

  const layoutTransition = {
    type: "tween",
    duration: isMobileViewport ? 0 : 1.05,
    ease: [0.22, 1, 0.36, 1],
  };
  const panelSlideX = isMobileViewport ? 0 : 34;
  const stepSlideX = isMobileViewport ? 0 : 26;

  return (
    <div ref={rootWrapRef} style={s.wrap}>
      {/* Floating message banner at top */}
      {msg.text && (
        <div
          style={{
            position: "fixed",
            top: "max(48px, env(safe-area-inset-top, 0px) + 32px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: theme.surface,
            backdropFilter: "blur(10px)",
            WebkitBackdropFilter: "blur(10px)",
            border: `1px solid ${msgColors[msg.type]?.border}`,
            color: msgColors[msg.type]?.color,
            padding: "11px 16px",
            borderRadius: 14,
            fontSize: 13,
            fontWeight: 700,
            lineHeight: 1.4,
            zIndex: 120,
            boxShadow: `0 8px 28px rgba(0,0,0,0.32), 0 0 14px ${msgColors[msg.type]?.border}33`,
            animation: "fadeInScale 0.2s ease-out both",
            minWidth: 220,
            maxWidth: "min(92vw, 420px)",
            textAlign: "center",
          }}
        >
          {msg.text}
        </div>
      )}

      {/* Keep background consistent between sign in and sign up */}

      {(loading || signingIn) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 90,
            background: "rgba(0,0,0,0.34)",
            backdropFilter: "blur(2px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 280,
              borderRadius: 16,
              background: theme.surface,
              border: `1px solid ${theme.border}`,
              boxShadow: theme.cardShadow,
              padding: 16,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                border: `2px solid ${theme.border}`,
                borderTopColor: theme.primary,
                margin: "0 auto 10px",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <div style={{ color: theme.text, fontWeight: 700, fontSize: 13 }}>
              {busyText || "Processing secure auth..."}
            </div>
          </div>
        </div>
      )}

      <LayoutGroup id="auth-flow">
      <motion.div
        ref={cardRef}
        className={isMobileViewport ? `mobile-auth-panel ${mobilePanelClass}`.trim() : undefined}
        layoutRoot
        layout="size"
        transition={{ layout: layoutTransition }}
        style={{
          ...s.card,
          ...(isMobileViewport
            ? { transition: "height 0.26s ease, min-height 0.26s ease" }
            : null),
          transformOrigin: "top center",
          willChange: "transform, opacity, width, height",
          transform: "translateZ(0)",
          WebkitTransform: "translate3d(0,0,0)",
          backfaceVisibility: "hidden",
          WebkitBackfaceVisibility: "hidden",
          WebkitPerspective: 1000,
          contain: "layout paint style",
        }}
      >
        {/* Theme picker button */}
        <button
          onClick={() => setShowThemePicker(true)}
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: theme.surface2,
            border: "none",
            color: theme.text2,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 30,
          }}
          title="Change theme"
        >
          <PaletteIcon size={16} />
        </button>

        <AnimatePresence mode="popLayout" initial={false}>
        {/* ── SIGN IN ── */}
        {mode === "signin" && (
          <motion.form
            key="panel-signin"
            layout="size"
            initial={{ opacity: 0, x: panelSlideX }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -panelSlideX }}
            transition={{
              type: "tween",
              duration: isMobileViewport ? 0 : 0.72,
              ease: [0.22, 1, 0.36, 1],
              layout: layoutTransition,
            }}
            style={{
              width: "100%",
              ...(isMobileViewport ? { animation: "none", transform: "none" } : null),
              willChange: "transform, opacity",
              transform: "translate3d(0,0,0)",
              WebkitTransform: "translate3d(0,0,0)",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              paddingTop: 8,
            }}
            onSubmit={(e) => handleSignIn(e, "phrase")}
          >
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ color: theme.primary, marginBottom: 8 }}>
                <LockIcon size={44} />
              </div>
              <h2
                style={{
                  color: theme.text,
                  fontSize: 20,
                  fontWeight: 700,
                  margin: "0 0 4px",
                }}
              >
                Sign In
              </h2>
            </div>



            <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
              <input
                type="text"
                placeholder="Enter your phrases"
                value={phraseInput}
                onFocus={(e) => keepInputAboveKeyboard(e.currentTarget)}
                id="signin-input"
                onChange={(e) => setPhraseInput(e.target.value)}
                onPaste={(e) => {
                  const raw = e.clipboardData?.getData("text") || "";
                  if (raw) setClipboardFallbackText(raw);
                }}
                style={{ ...s.input, marginBottom: 0, flex: 1 }}
                disabled={loading}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={() => pastePhraseFromClipboard("signin")}
                disabled={loading || !canPastePhrase}
                style={{
                  ...s.btnSmall(`${theme.primary}1d`, theme.primary),
                  marginTop: 0,
                  border: `1px solid ${theme.primary}66`,
                  opacity: canPastePhrase ? 1 : 0.46,
                  cursor: canPastePhrase ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                  minWidth: 44,
                  width: 44,
                  justifyContent: "center",
                  alignSelf: "stretch",
                  boxShadow: canPastePhrase ? `0 0 10px ${theme.primaryGlow}` : "none",
                }}
                title={canPastePhrase ? "Paste phrase" : "Clipboard does not contain 12/24 words"}
              >
                <PasteIcon size={14} />
              </button>
            </div>

            {/* Remember me Tabs */}
              <div style={{ marginTop: 12, marginBottom: 12 }}>
                <div style={{ position: "relative" }}>
                {isIncognitoMode && (
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 4,
                    }}
                  >
                    <div
                      style={{
                      background: `${theme.warning}1a`,
                      border: `1px solid ${theme.warning}66`,
                      color: theme.warning,
                      borderRadius: 999,
                      padding: "3px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      whiteSpace: "nowrap",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.16)",
                    }}
                  >
                    <AlertIcon size={10} /> You are on Incognito mode!
                  </div>
                  </div>
                )}
                <div style={{
                  opacity: isIncognitoMode ? 0.45 : 1,
                  pointerEvents: isIncognitoMode ? "none" : "auto",
                  filter: isIncognitoMode ? "grayscale(0.22)" : "none",
                  transition: "opacity 0.2s ease",
                }}>
                <div style={{ 
                  display: "flex", 
                  background: isIncognitoMode ? theme.surface : theme.surface2,
                 borderRadius: 10, 
                 padding: isIncognitoMode ? "24px 4px 4px" : 4,
                 gap: 4,
                  border: `1px solid ${theme.inputBorder}`,
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: isIncognitoMode
                    ? "inset 0 0 0 999px rgba(0,0,0,0.16)"
                    : "none",
              }}>
                <motion.div
                  initial={false}
                  animate={{
                    left: pinEnabled ? 4 : "calc(50% + 2px)",
                    scale: pinEnabled || rememberMe ? 1 : 0.94,
                    y: 0,
                    opacity: pinEnabled || rememberMe ? 1 : 0,
                  }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  style={{
                    position: "absolute",
                    top: 4,
                    left: 4,
                    width: "calc(50% - 6px)",
                    height: "calc(100% - 8px)",
                    borderRadius: 8,
                    background: theme.primary + "30",
                    transformOrigin: "center center",
                    pointerEvents: "none",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (pinEnabled) {
                      setPinEnabled(false);
                    } else {
                      setPinEnabled(true);
                      setRememberMe(false);
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    color: pinEnabled ? theme.success : theme.text3,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  Remember me (Recommended)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (rememberMe) {
                      setRememberMe(false);
                    } else {
                      setPinEnabled(false);
                      setRememberMe(true);
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "10px 8px",
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    color: !pinEnabled && rememberMe ? theme.warning : theme.text3,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                  }}
                >
                  Remember me
                </button>
              </div>

                </div>
                </div>

              <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: modeBadge.color,
                    background: modeBadge.bg,
                    border: `1px solid ${modeBadge.color}44`,
                    borderRadius: 999,
                    padding: "4px 9px",
                  }}
                >
                  {modeBadge.text}
                </span>
              </div>

              <div style={{
                opacity: isIncognitoMode ? 0.45 : 1,
                pointerEvents: isIncognitoMode ? "none" : "auto",
                filter: isIncognitoMode ? "grayscale(0.22)" : "none",
                transition: "opacity 0.2s ease",
              }}>
                <AnimatePresence initial={false}>
                  {pinEnabled && (
                  <motion.div
                    key="remember-pin-input"
                    initial={{ height: 0, opacity: 0, y: -6 }}
                    animate={{ height: "auto", opacity: 1, y: 0 }}
                    exit={{ height: 0, opacity: 0, y: -6 }}
                    transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      marginTop: 8,
                      overflow: "hidden",
                      willChange: "transform, opacity, height",
                      transform: "translateZ(0)",
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                    }}
                  >
                    <input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={PIN_LENGTH}
                      placeholder={`${PIN_LENGTH}-digit PIN`}
                      value={unlockPin}
                      onChange={(e) =>
                        setUnlockPin(
                          e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH),
                        )
                      }
                    style={{ ...s.input, marginBottom: 0 }}
                    disabled={loading}
                    autoComplete="off"
                    onFocus={(e) => keepInputAboveKeyboard(e.currentTarget)}
                  />
                  </motion.div>
                )}
                </AnimatePresence>
              </div>
              </div>

            {(() => {
              const hasPhrase = phraseInput.trim().length > 0;
              const hasPin = unlockPin.length > 0;
              return (
                <>
                  <button
                    type="submit"
                    disabled={
                      loading ||
                      activeSubmit === "pin" ||
                      (hasPinVault && pinLockRemaining > 0 && !hasPhrase && !hasPin)
                    }
                    style={{
                      ...s.btn(theme.primary, theme.primaryFg),
                      opacity: activeSubmit === "pin" ? 0.5 : 1,
                      cursor: activeSubmit === "pin" ? "not-allowed" : "pointer",
                    }}
                  >
                    {loading || signingIn ? "Signing in…" : "Sign In"}
                  </button>
                </>
              );
            })()}

            {savedLoginOptions.length > 0 && (
              <div style={{ marginTop: 8, marginBottom: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowSavedLoginModal(true)}
                  disabled={loading || activeSubmit === "phrase"}
                  onMouseEnter={(e) => {
                    if (!loading && activeSubmit !== "phrase") {
                      e.currentTarget.style.background = theme.surfaceHover || theme.surface3;
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = theme.surface2;
                  }}
                  style={{
                    ...s.btn(theme.surface2, theme.text),
                    border: `1px solid ${theme.inputBorder}`,
                    marginTop: 0,
                    opacity: activeSubmit === "phrase" ? 0.6 : 1,
                    transition: "background 0.18s ease, transform 0.12s ease",
                  }}
                >
                  Saved Login
                </button>
              </div>
            )}

            <AnimatePresence mode="wait">
              {showSavedLoginModal && (
              <motion.div
                key="saved-login-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "absolute",
                  top: -20,
                  right: -20,
                  bottom: -20,
                  left: -20,
                  borderRadius: 28,
                  background: "rgba(8,10,18,0.56)",
                  zIndex: 140,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  willChange: "opacity",
                  transform: "translateZ(0)",
                  backfaceVisibility: "hidden",
                  WebkitBackfaceVisibility: "hidden",
                }}
                onClick={() => setShowSavedLoginModal(false)}
              >
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 12 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  layout
                  transition={{ layout: { duration: 0.34, ease: [0.22, 1, 0.36, 1] } }}
                  style={{
                    width: "100%",
                    maxWidth: 360,
                    minHeight: vaultDropdownOpen ? 300 : 0,
                    maxHeight: "82dvh",
                    borderRadius: 14,
                    background: theme.surface,
                    border: `1px solid ${theme.border}`,
                    boxShadow: theme.cardShadow,
                    padding: 14,
                    overflowY: "auto",
                    transition:
                      "min-height 0.26s ease, max-height 0.26s ease, padding-bottom 0.26s ease",
                    paddingBottom: 14 + Math.min(120, keyboardInset),
                    willChange: "transform, opacity",
                    transform: "translateZ(0)",
                    transformOrigin: "top center",
                    backfaceVisibility: "hidden",
                    WebkitBackfaceVisibility: "hidden",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>Saved Login</div>
                    <button
                      type="button"
                      onClick={() => setShowSavedLoginModal(false)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: theme.text3,
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: 1,
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {getAccountOptions().length > 0 && (
                    <div ref={vaultDropdownRef} style={{ marginBottom: 8, position: "relative" }}>
                      <div
                        onClick={() => setVaultDropdownOpen(!vaultDropdownOpen)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          height: 44,
                          borderRadius: 10,
                          border: `1.5px solid ${vaultDropdownOpen ? theme.accent : theme.inputBorder}`,
                          background: theme.inputBg,
                          color: theme.text,
                          fontSize: 13,
                          padding: "0 12px",
                          cursor: "pointer",
                        }}
                      >
                        <span>{resolveSelectedAccountLabel()}</span>
                        <ChevronDownIcon size={14} style={{ transform: vaultDropdownOpen ? "rotate(180deg)" : "none" }} />
                      </div>
                      <AnimatePresence initial={false}>
                        {vaultDropdownOpen && (
                          <motion.div
                            key="saved-login-dropdown"
                            initial={{ height: 0, opacity: 0, y: -6 }}
                            animate={{ height: "auto", opacity: 1, y: 0 }}
                            exit={{ height: 0, opacity: 0, y: -6 }}
                            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                            style={{
                              overflow: "hidden",
                              borderRadius: 10,
                              marginTop: 4,
                              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
                            }}
                          >
                            <div
                              className="dropdown-enter"
                              style={{
                                background: theme.inputBg,
                                border: `1px solid ${theme.inputBorder}`,
                                borderRadius: 10,
                                overflow: "hidden",
                                maxHeight: 260,
                                overflowY: "auto",
                              }}
                            >
                          {getAccountOptions().map((option, idx, arr) => {
                            const label = option.username || `${option.userId.slice(0, 6)}...${option.userId.slice(-4)}`;
                            const isSelected =
                              (selectedAccount?.userId && selectedAccount.userId === option.userId) ||
                              (vaultTargetUserId && vaultTargetUserId !== "auto" && vaultTargetUserId === option.userId);
                            return (
                              <div
                                key={option.userId}
                                onClick={() => handleSelectAccountOption(option)}
                                style={{
                                  padding: "12px",
                                  fontSize: 12,
                                  color: theme.text,
                                  cursor: "pointer",
                                  background: isSelected ? `${theme.primary}18` : "transparent",
                                  borderBottom: idx < arr.length - 1 ? `1px solid ${theme.inputBorder}` : "none",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  transition: "background 0.18s ease, transform 0.12s ease",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) e.currentTarget.style.background = `${theme.surfaceHover || theme.surface2}`;
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = isSelected ? `${theme.primary}18` : "transparent";
                                }}
                              >
                                <div>
                                  <div style={{ fontWeight: 600 }}>{label}</div>
                                  <div style={{ fontSize: 10, color: theme.text3, marginTop: 2 }}>
                                    {option.hasPinVault ? "PIN required" : "Saved account"}
                                  </div>
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  {option.hasSavedAccount && (
                                    <div
                                      onClick={(e) => handleBiometricAccountOption(option, e)}
                                      style={{
                                        padding: "6px",
                                        cursor: "pointer",
                                        borderRadius: 6,
                                        transition: "background 0.16s ease, transform 0.12s ease",
                                      }}
                                      onMouseEnter={(e) => {
                                        e.currentTarget.style.background = `${theme.primary}1a`;
                                      }}
                                      onMouseLeave={(e) => {
                                        e.currentTarget.style.background = "transparent";
                                      }}
                                      title="Login with Biometric"
                                    >
                                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={theme.primary} strokeWidth="2">
                                        <path d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.2-2.85.571-4.15" />
                                      </svg>
                                    </div>
                                  )}
                                  <div
                                    onClick={(e) => handleRemoveAccountOption(option, e)}
                                    style={{
                                      padding: "6px",
                                      cursor: "pointer",
                                      borderRadius: 6,
                                      transition: "background 0.16s ease, transform 0.12s ease",
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.background = `${theme.danger}18`;
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.background = "transparent";
                                    }}
                                  >
                                    <TrashIcon size={14} stroke={theme.danger} />
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                          <div
                            onClick={handleClearVault}
                            style={{
                              padding: "10px 12px",
                              fontSize: 12,
                              color: theme.danger,
                              cursor: clearingVault ? "wait" : "pointer",
                              borderTop: `1px solid ${theme.inputBorder}`,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              transition: "background 0.18s ease",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = `${theme.danger}14`;
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            <TrashIcon size={12} stroke={theme.danger} />
                            <span style={{ color: theme.danger }}>{clearingVault ? "Clearing..." : "Clear all vaults"}</span>
                          </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 8,
                      overflow: "hidden",
                      maxHeight: selectedRequiresPin ? 56 : 0,
                      opacity: selectedRequiresPin ? 1 : 0,
                      transform: selectedRequiresPin
                        ? "translateY(0)"
                        : "translateY(-6px)",
                      transition:
                        "max-height 0.22s ease, opacity 0.2s ease, transform 0.22s ease",
                    }}
                  >
                    <div style={{ position: "relative" }}>
                      <input
                        type="password"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={PIN_LENGTH}
                        placeholder={`${PIN_LENGTH}-digit PIN`}
                        value={unlockPin}
                        onChange={(e) =>
                          setUnlockPin(
                            e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH),
                          )
                        }
                      style={{ ...s.input, marginBottom: 0, paddingRight: 88 }}
                      disabled={
                        !selectedRequiresPin || loading || activeSubmit === "phrase"
                      }
                      autoComplete="off"
                      onFocus={(e) => keepInputAboveKeyboard(e.currentTarget)}
                    />
                      <button
                        type="button"
                        onClick={(e) => handleSignIn(e, "pin")}
                        disabled={
                          !selectedRequiresPin ||
                          loading ||
                          activeSubmit === "phrase" ||
                          !unlockPin ||
                          (hasPinVault && pinLockRemaining > 0)
                        }
                        style={{
                          position: "absolute",
                          right: 6,
                          top: 6,
                          height: 34,
                          borderRadius: 8,
                          border: `1px solid ${theme.primary}`,
                          background:
                            !selectedRequiresPin ||
                            loading ||
                            activeSubmit === "phrase" ||
                            !unlockPin
                              ? `${theme.primary}33`
                              : theme.primary,
                          color: theme.primaryFg,
                          padding: "0 10px",
                          fontSize: 11,
                          fontWeight: 700,
                          cursor:
                            !selectedRequiresPin ||
                            loading ||
                            activeSubmit === "phrase" ||
                            !unlockPin
                              ? "not-allowed"
                              : "pointer",
                          transition: "background 0.18s ease, transform 0.12s ease, opacity 0.18s ease",
                        }}
                        onMouseEnter={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.background = theme.primaryHover || theme.primary;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!e.currentTarget.disabled) {
                            e.currentTarget.style.background = theme.primary;
                          }
                        }}
                      >
                        Login
                      </button>
                    </div>
                  </div>

                  {pinLockRemaining > 0 && (
                    <div style={{ marginTop: 8, fontSize: 11, color: theme.warning, textAlign: "center" }}>
                      PIN unlock locked for {formatCooldown(pinLockRemaining)}
                    </div>
                  )}
                </motion.div>
              </motion.div>
            )}
            </AnimatePresence>
            
            <p
              style={{
                color: theme.text2,
                fontSize: 11,
                textAlign: "center",
                marginTop: 10,
                marginBottom: 0,
              }}
            >
              Don't have an account?{" "}
              <button
                type="button"
                onClick={openSignup}
                style={{ ...s.link, fontSize: 11 }}
              >
                Sign up
              </button>
            </p>
          </motion.form>
        )}

        {/* ── SIGN UP ── */}
        {mode === "signup" && (
          <motion.div
            key="panel-signup"
            layout="size"
            initial={{ opacity: 0, x: panelSlideX }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -panelSlideX }}
            transition={{
              type: "tween",
              duration: isMobileViewport ? 0 : 0.76,
              ease: [0.22, 1, 0.36, 1],
              layout: layoutTransition,
            }}
            style={{
              width: "100%",
              ...(isMobileViewport ? { animation: "none", transform: "none" } : null),
              willChange: "transform, opacity",
              transform: "translate3d(0,0,0)",
              WebkitTransform: "translate3d(0,0,0)",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
            }}
          >
          <AnimatePresence mode="popLayout" initial={false}>
            {signupStep === "choose" ? (
          <motion.div
            key="signup-choose"
            layout="size"
            initial={{ opacity: 0, x: stepSlideX }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -stepSlideX }}
            transition={{
              type: "tween",
              duration: isMobileViewport ? 0 : 0.72,
              ease: [0.22, 1, 0.36, 1],
              layout: layoutTransition,
            }}
            style={{
              width: "100%",
              ...(isMobileViewport ? { animation: "none", transform: "none" } : null),
              willChange: "transform, opacity",
              transform: "translate3d(0,0,0)",
              WebkitTransform: "translate3d(0,0,0)",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ color: theme.primary, marginBottom: 8 }}>
                <LockIcon size={44} />
              </div>
              <h2
                style={{
                  color: theme.text,
                  fontSize: 20,
                  fontWeight: 700,
                  margin: "0 0 4px",
                }}
              >
                Create Account
              </h2>
              <p style={{ color: theme.text2, fontSize: 12, margin: 0 }}>
                Choose phrase strength to start setup
              </p>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <button
                onClick={() => startSignupFlow(12)}
                style={{ ...s.btn(theme.primary, theme.primaryFg), marginTop: 0 }}
              >
                Use 12 words (fast)
              </button>
            </div>
            <div style={{ display: "flex", gap: 10, marginBottom: 8 }}>
              <button
                onClick={() => startSignupFlow(24)}
                style={{ ...s.btn(theme.surface2, theme.text), marginTop: 0 }}
              >
                Use 24 words (strong)
              </button>
            </div>

            <p style={{ color: theme.text2, fontSize: 11, textAlign: "center", marginBottom: 0 }}>
              24 words are harder to store but provide stronger backup entropy.
            </p>

            <div style={{ 
              position: "sticky", 
              bottom: 0, 
              background: "transparent",
              paddingTop: 16,
              paddingBottom: 8,
              marginTop: 12,
              textAlign: "center",
              zIndex: 10,
              pointerEvents: "none",
            }}>
              <button 
                onClick={goBackToSignIn} 
                style={{ 
                  ...s.link, 
                  fontSize: 13,
                  padding: "10px 20px",
                  borderRadius: 20,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: theme.surface2,
                  boxShadow: `0 0 14px ${theme.primary}30, 0 2px 8px rgba(0,0,0,0.12)`,
                  border: `1px solid ${theme.primary}2e`,
                  pointerEvents: "auto",
                }}
              >
                ← Back to sign in
              </button>
            </div>
          </motion.div>
            ) : signupStep !== "choose" && phrase ? (
          <motion.div
            key={`signup-${signupStep}`}
            layout="size"
            initial={{ opacity: 0, x: stepSlideX }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -stepSlideX }}
            transition={{
              type: "tween",
              duration: isMobileViewport ? 0 : 0.76,
              ease: [0.22, 1, 0.36, 1],
              layout: layoutTransition,
            }}
            style={{
              width: "100%",
              ...(isMobileViewport ? { animation: "none", transform: "none" } : null),
              willChange: "transform, opacity",
              transform: "translate3d(0,0,0)",
              WebkitTransform: "translate3d(0,0,0)",
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: 14 }}>
              <div style={{ color: theme.primary, marginBottom: 8 }}>
                <LockIcon size={44} />
              </div>
              <h2
                style={{
                  color: theme.text,
                  fontSize: 20,
                  fontWeight: 700,
                  margin: "0 0 4px",
                }}
              >
                Create Account
              </h2>
              <p style={{ color: theme.text2, fontSize: 12, margin: 0 }}>
                {signupStep === "reveal"
                  ? "Step 2 of 3: save your phrase offline"
                  : "Step 3 of 3: verify your phrase to finish"}
              </p>
            </div>

            <div style={{ textAlign: "center", marginBottom: 10 }}>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  borderRadius: 999,
                  padding: "4px 10px",
                  background: `${theme.primary}1f`,
                  color: theme.primary,
                  border: `1px solid ${theme.primary}66`,
                }}
              >
                {wordCount} words
              </span>
            </div>

            <div
              style={{
                ...s.phraseBox,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  color: theme.text,
                  fontFamily: "monospace",
                  letterSpacing: "1px",
                  userSelect: showPhrase ? "text" : "none",
                  cursor: showPhrase ? "text" : "default",
                }}
              >
                {showPhrase
                  ? phrase
                  : phrase
                      .split("")
                      .map((c) => (c === " " ? " " : "•"))
                      .join("")}
              </div>
            </div>

            {/* Actions row with "Copied!" tooltip next to copy button */}
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              {signupStep === "reveal" && (
                <button
                  onClick={handleRegenerate}
                  style={s.btnSmall(theme.surface2, theme.text2)}
                  title="Generate new phrase"
                >
                  <RefreshCwIcon size={13} /> New phrase
                </button>
              )}
              <button
                onClick={() => setShowPhrase(!showPhrase)}
                style={s.btnSmall(theme.surface2, theme.text2)}
                title={showPhrase ? "Hide phrase" : "Show phrase"}
              >
                {showPhrase ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}{" "}
                {showPhrase ? "Hide" : "Show"}
              </button>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(phrase);
                    showCopy();
                  }}
                  style={{...s.btnSmall(theme.primary, theme.primaryFg), position: "relative"}}
                  title="Copy to clipboard"
                >
                  <CopyIcon size={13} /> Copy
                  {copyHint && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: "calc(100% + 8px)",
                        left: "50%",
                        transform: "translateX(-50%)",
                        background: theme.success,
                        color: theme.successFg || "#fff",
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "4px 10px",
                        borderRadius: 8,
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                        animation: "fadeInScale 0.15s ease both",
                        pointerEvents: "none",
                        zIndex: 10,
                      }}
                    >
                      ✓ Copied!
                    </div>
                  )}
                </button>
              </div>
            </div>

            {signupStep === "reveal" && (
              <FancyCheckbox
                checked={writtenDown}
                onToggle={() => setWrittenDown((v) => !v)}
                label="I wrote this phrase down and understand it cannot be recovered if lost."
              />
            )}

            {signupStep === "verify" && (
              <>
              <p
                style={{
                  color: theme.text2,
                  fontSize: 11,
                  marginBottom: 8,
                  textAlign: "center",
                }}
              >
                Type the full {wordCount}-word phrase below to verify you saved it
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "stretch", marginBottom: 12 }}>
              <textarea
                placeholder={`Enter your ${wordCount} words`}
               value={phraseInput}
               onFocus={(e) => keepInputAboveKeyboard(e.currentTarget)}
               id="phrase-textarea"
               onChange={(e) => setPhraseInput(e.target.value)}
               onPaste={(e) => {
                 const raw = e.clipboardData?.getData("text") || "";
                 if (raw) setClipboardFallbackText(raw);
               }}
               style={{
                 ...s.input,
                 minHeight: 64,
                 fontFamily: "inherit",
                 resize: "none",
                 marginBottom: 0,
                 flex: 1,
               }}
               disabled={loading}
               autoComplete="off"
               autoCorrect="off"
               autoCapitalize="none"
               spellCheck={false}
             />
              <button
                type="button"
                onClick={() => pastePhraseFromClipboard("verify")}
                disabled={loading || !canPastePhrase}
                style={{
                  ...s.btnSmall(`${theme.primary}1d`, theme.primary),
                  marginTop: 0,
                  border: `1px solid ${theme.primary}66`,
                  opacity: canPastePhrase ? 1 : 0.46,
                  cursor: canPastePhrase ? "pointer" : "not-allowed",
                  whiteSpace: "nowrap",
                  minWidth: 44,
                  width: 44,
                  justifyContent: "center",
                  alignSelf: "stretch",
                  boxShadow: canPastePhrase ? `0 0 10px ${theme.primaryGlow}` : "none",
                }}
                title={canPastePhrase ? "Paste phrase" : "Clipboard does not contain 12/24 words"}
              >
                <PasteIcon size={14} />
              </button>
              </div>

              {/* Remember me Tabs */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ position: "relative" }}>
                {isIncognitoMode && (
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      left: "50%",
                      transform: "translateX(-50%)",
                      zIndex: 4,
                    }}
                  >
                    <div
                      style={{
                      background: `${theme.warning}1a`,
                      border: `1px solid ${theme.warning}66`,
                      color: theme.warning,
                      borderRadius: 999,
                      padding: "3px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      whiteSpace: "nowrap",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.16)",
                    }}
                  >
                    <AlertIcon size={10} /> You are on Incognito mode!
                  </div>
                  </div>
                )}
                <div style={{
                  opacity: isIncognitoMode ? 0.45 : 1,
                  pointerEvents: isIncognitoMode ? "none" : "auto",
                  filter: isIncognitoMode ? "grayscale(0.22)" : "none",
                  transition: "opacity 0.2s ease",
                }}>
                <div style={{ 
                  display: "flex", 
                  background: isIncognitoMode ? theme.surface : theme.surface2,
                  borderRadius: 10, 
                  padding: isIncognitoMode ? "24px 4px 4px" : 4,
                  gap: 4,
                  border: `1px solid ${theme.border}`,
                  marginBottom: 10,
                  position: "relative",
                  overflow: "hidden",
                  boxShadow: isIncognitoMode
                    ? "inset 0 0 0 999px rgba(0,0,0,0.16)"
                    : "none",
                }}>
                <motion.div
                  initial={false}
                  animate={{
                      left: pinEnabled ? 4 : "calc(50% + 2px)",
                      scale: pinEnabled || rememberMe ? 1 : 0.94,
                      y: 0,
                      opacity: pinEnabled || rememberMe ? 1 : 0,
                    }}
                    transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 4,
                      width: "calc(50% - 6px)",
                      height: "calc(100% - 8px)",
                      borderRadius: 8,
                      background: theme.primary + "30",
                      transformOrigin: "center center",
                      pointerEvents: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (pinEnabled) {
                        setPinEnabled(false);
                      } else {
                        setPinEnabled(true);
                        setRememberMe(false);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: "10px 8px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: pinEnabled ? theme.success : theme.text3,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    Remember me (Recommended)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (rememberMe) {
                        setRememberMe(false);
                      } else {
                        setPinEnabled(false);
                        setRememberMe(true);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: "10px 8px",
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: !pinEnabled && rememberMe ? theme.warning : theme.text3,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    Remember me
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {pinEnabled ? (
                    <motion.div
                      key="signup-pin-panel"
                      initial={{ height: 0, opacity: 0, y: -8 }}
                      animate={{ height: "auto", opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -8 }}
                      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ 
                        background: theme.surface2, 
                        borderRadius: 10, 
                        padding: 12,
                        border: `1px solid ${theme.inputBorder}`,
                      }}>
                        <div style={{ fontSize: 11, color: theme.text3, marginBottom: 8 }}>
                          Adds an extra PIN security layer & maintain session
                        </div>
                        <motion.input
                          layout
                          type="password"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={PIN_LENGTH}
                          placeholder={`Set ${PIN_LENGTH}-digit PIN`}
                          value={pinInput}
                          onChange={(e) =>
                            setPinInput(
                              e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH),
                            )
                          }
                          style={{ ...s.input, marginBottom: 8 }}
                          disabled={loading}
                          autoComplete="off"
                          onFocus={(e) => keepInputAboveKeyboard(e.currentTarget)}
                        />
                        {pinInput.length === PIN_LENGTH &&
                          getPinStrengthError(pinInput) && (
                            <div
                              style={{
                                marginBottom: 8,
                                fontSize: 11,
                                color: theme.warning,
                              }}
                            >
                              {getPinStrengthError(pinInput)}
                            </div>
                          )}
                        <motion.input
                          layout
                          type="password"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={PIN_LENGTH}
                          placeholder="Confirm PIN"
                          value={pinConfirm}
                          onChange={(e) =>
                            setPinConfirm(
                              e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH),
                            )
                          }
                          style={{ ...s.input, marginBottom: 0 }}
                          disabled={loading}
                          autoComplete="off"
                          onFocus={(e) => keepInputAboveKeyboard(e.currentTarget)}
                        />
                      </div>
                    </motion.div>
                  ) : rememberMe ? (
                    <motion.div
                      key="signup-remember-panel"
                      initial={{ height: 0, opacity: 0, y: -8 }}
                      animate={{ height: "auto", opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -8 }}
                      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ 
                        background: theme.surface2, 
                        borderRadius: 10, 
                        padding: 12,
                        border: `1px solid ${theme.inputBorder}`,
                      }}>
                        <div style={{ fontSize: 11, color: theme.text3 }}>
                          Maintain the session
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="signup-session-only-panel"
                      initial={{ height: 0, opacity: 0, y: -8 }}
                      animate={{ height: "auto", opacity: 1, y: 0 }}
                      exit={{ height: 0, opacity: 0, y: -8 }}
                      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                      style={{ overflow: "hidden" }}
                    >
                      <div style={{ 
                        background: theme.surface2, 
                        borderRadius: 10, 
                        padding: 12,
                        border: `1px solid ${theme.inputBorder}`,
                      }}>
                        <div style={{ fontSize: 10, color: theme.danger, opacity: 0.9 }}>
                          Session will revoke on closing tab
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
                </div>
                </div>

                <div style={{ marginTop: 8, display: "flex", justifyContent: "center" }}>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      color: modeBadge.color,
                      background: modeBadge.bg,
                      border: `1px solid ${modeBadge.color}44`,
                      borderRadius: 999,
                      padding: "4px 9px",
                    }}
                  >
                    {modeBadge.text}
                  </span>
                </div>

                {pinEnabled && (
                  <div style={{ marginTop: 10 }}>
                    <FancyCheckbox
                      checked={biometricEnabled}
                      disabled={!(pinInput.length === PIN_LENGTH && pinConfirm.length === PIN_LENGTH && pinInput === pinConfirm)}
                      onToggle={async () => {
                        if (!biometricEnabled) {
                          try {
                            const { registerBiometricCredential, getBiometricReadinessIssue } = await import("../utils/biometricGuard");
                            const issue = getBiometricReadinessIssue();
                            if (issue) {
                              showMsg(issue, "error");
                              return;
                            }
                            await registerBiometricCredential();
                            setBiometricEnabled(true);
                            showMsg("Biometric registered! Use it to unlock", "success");
                          } catch (e) {
                            showMsg(e.message || "Failed to register biometric", "error");
                          }
                        } else {
                          const { clearBiometricCredential } = await import("../utils/biometricGuard");
                          clearBiometricCredential();
                          setBiometricEnabled(false);
                        }
                      }}
                      label={
                        <span style={{ color: theme.primary }}>
                          Enable Biometric Unlock
                        </span>
                      }
                    />
                    <div style={{ fontSize: 11, color: theme.text3, marginTop: -4, lineHeight: 1.4 }}>
                      Use Touch ID / Face ID to unlock
                    </div>
                  </div>
                )}
              </div>
              </>
            )}

            {signupStep === "reveal" ? (
              <button
                onClick={proceedToVerify}
                disabled={loading || !writtenDown}
                style={s.btn(theme.primary, theme.primaryFg)}
              >
                Continue to verification
              </button>
            ) : (
              <button
                onClick={handleVerifyPhrase}
                disabled={loading}
                style={s.btn(theme.primary, theme.primaryFg)}
              >
                {loading
                  ? signingIn
                    ? "Signing in…"
                    : "Creating…"
                  : "Create Account"}
              </button>
            )}

            <div style={{ 
              position: "sticky", 
              bottom: 0, 
              background: "transparent",
              paddingTop: 16,
              paddingBottom: 8,
              marginTop: 12,
              textAlign: "center",
              zIndex: 10,
              pointerEvents: "none",
            }}>
              <button
                onClick={goBackSignupStep}
                style={{ 
                  ...s.link, 
                  fontSize: 13,
                  padding: "10px 20px",
                  borderRadius: 20,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: theme.surface2,
                  boxShadow: `0 0 14px ${theme.primary}30, 0 2px 8px rgba(0,0,0,0.12)`,
                  border: `1px solid ${theme.primary}2e`,
                  pointerEvents: "auto",
                }}
              >
                ← Back
              </button>
            </div>
          </motion.div>
            ) : null}
          </AnimatePresence>
          </motion.div>
        )}
        </AnimatePresence>
      </motion.div>
      </LayoutGroup>

      {showThemePicker && (
        <ThemePicker onClose={() => setShowThemePicker(false)} />
      )}

      {showClearConfirm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            style={{
              background: theme.surface,
              borderRadius: 20,
              padding: 24,
              maxWidth: 320,
              width: "100%",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 18, fontWeight: 700, color: theme.text, marginBottom: 12 }}>
              Clear All Vaults?
            </div>
            <div style={{ fontSize: 13, color: theme.text2, marginBottom: 20, lineHeight: 1.5 }}>
              This will remove all saved PIN vaults from this device. You will need to enter your phrase again to sign in.
            </div>
            {clearError && (
              <div style={{ fontSize: 12, color: theme.danger, marginBottom: 12, padding: 8, background: theme.danger + "15", borderRadius: 8 }}>
                {clearError}
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => setShowClearConfirm(false)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme.surfaceHover || theme.border;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = theme.surface2;
                }}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: `1px solid ${theme.border}`,
                  background: theme.surface2,
                  color: theme.text,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmClearVault}
                disabled={clearingVault}
                onMouseEnter={(e) => {
                  if (!clearingVault) e.currentTarget.style.opacity = "0.85";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  background: theme.danger,
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: clearingVault ? "wait" : "pointer",
                  opacity: clearingVault ? 0.7 : 1,
                  transition: "opacity 0.15s",
                  opacity: clearingVault ? 0.7 : 1,
                }}
              >
                {clearingVault ? "Clearing..." : "Clear All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthPhrase;
