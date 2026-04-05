/**
 * Platform detection utility for device-specific behavior.
 * Detects iOS, Android, and desktop platforms to enable
 * platform-specific UI/UX adjustments.
 */

let _platform = null;

function detectPlatform() {
  if (_platform) return _platform;

  if (typeof navigator === "undefined") {
    _platform = "desktop";
    return _platform;
  }

  const ua = navigator.userAgent || navigator.vendor || window.opera;
  const platform = navigator.platform?.toLowerCase() || "";

  // iOS detection
  if (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "macintel" && navigator.maxTouchPoints > 1)
  ) {
    _platform = "ios";
    return _platform;
  }

  // Android detection
  if (/android/i.test(ua)) {
    _platform = "android";
    return _platform;
  }

  // Desktop
  _platform = "desktop";
  return _platform;
}

export function isIOS() {
  return detectPlatform() === "ios";
}

export function isAndroid() {
  return detectPlatform() === "android";
}

export function isMobile() {
  return isIOS() || isAndroid();
}

export function getPlatform() {
  return detectPlatform();
}

/**
 * Returns the appropriate modal positioning strategy based on layout and platform.
 * For modal layout on mobile, uses absolute positioning within the app container.
 * For other layouts or desktop, uses fixed positioning.
 */
export function getModalPositionStrategy(layoutName) {
  const platform = detectPlatform();
  const isMobileDevice = platform === "ios" || platform === "android";

  return {
    useAbsolutePositioning: layoutName === "modal" && isMobileDevice,
    platform,
    isMobile: isMobileDevice,
  };
}
