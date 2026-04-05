const KEY = "chatapp_pin_guard_v1";

const LOCK_SCHEDULE_MS = [0, 0, 30000, 60000, 300000, 900000];

function now() {
  return Date.now();
}

function readState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) || "{}");
    return {
      failures: Number(parsed.failures) || 0,
      lockUntil: Number(parsed.lockUntil) || 0,
    };
  } catch {
    return { failures: 0, lockUntil: 0 };
  }
}

function writeState(state) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

export function getPinGuardStatus() {
  const state = readState();
  const remainingMs = Math.max(0, state.lockUntil - now());
  return {
    locked: remainingMs > 0,
    remainingMs,
    failures: state.failures,
  };
}

export function registerPinFailure() {
  const state = readState();
  const failures = Math.min(state.failures + 1, 20);
  const cooldownIndex = Math.min(failures, LOCK_SCHEDULE_MS.length - 1);
  const cooldownMs = LOCK_SCHEDULE_MS[cooldownIndex];
  const lockUntil = cooldownMs > 0 ? now() + cooldownMs : 0;
  const next = { failures, lockUntil };
  writeState(next);
  return {
    failures,
    lockUntil,
    remainingMs: Math.max(0, lockUntil - now()),
  };
}

export function registerPinSuccess() {
  writeState({ failures: 0, lockUntil: 0 });
}

export function formatCooldown(remainingMs) {
  const sec = Math.max(1, Math.ceil(remainingMs / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.ceil(sec / 60);
  return `${min}m`;
}
