import React, { createContext, useContext, useEffect, useState } from "react";

export const THEMES = {
  nordic: {
    name: "Nordic",
    emoji: "🌨️",
    isDark: true,
    bg: "#242933",
    surface: "#2E3440",
    surface2: "#3B4252",
    surface3: "#434C5E",
    surfaceHover: "#3D4757",
    border: "#4C566A",
    text: "#ECEFF4",
    text2: "#D8DEE9",
    text3: "#A3B0D4",
    primary: "#8FBCBB",
    primaryHover: "#88C0D0",
    primaryFg: "#2E3440",
    primaryGlow: "rgba(143,188,187,0.4)",
    danger: "#BF616A",
    dangerFg: "#ECEFF4",
    dangerGlow: "rgba(191,97,106,0.3)",
    success: "#A3BE8C",
    successFg: "#2E3440",
    successGlow: "rgba(163,190,140,0.3)",
    warning: "#EBCB8B",
    warningFg: "#2E3440",
    inputBg: "#3B4252",
    inputBorder: "#4C566A",
    sent: "#5E81AC",
    sentFg: "#ECEFF4",
    sentTime: "rgba(255,255,255,0.72)",
    seenTickColor: "#88C0D0",
    recv: "#3B4252",
    recvFg: "#ECEFF4",
    recvBorder: "transparent",
    recvTime: "#7B8CA8",
    headerBg: "#2E3440",
    headerFg: "#ECEFF4",
    headerBtn: "#3B4252",
    reactionBg: "#3B4252",
    reactionBorder: "#4C566A",
    reactionActive: "#4C566A",
    reactionActiveBorder: "#88C0D0",
    reactionText: "#ECEFF4",
    badgeBg: "#BF616A",
    badgeFg: "#ECEFF4",
    glow: "0 0 14px rgba(136,192,208,0.25)",
    glowStrong: "0 0 22px rgba(136,192,208,0.45)",
    cardShadow: "0 4px 28px rgba(0,0,0,0.35)",
    preview: {
      bg: "#242933",
      bubble1: "#5E81AC",
      bubble2: "#3B4252",
      header: "#2E3440",
    },
  },
  dracula: {
    name: "Dracula",
    emoji: "🧛",
    isDark: true,
    bg: "#1E1F29",
    surface: "#282A36",
    surface2: "#343746",
    surface3: "#3D4057",
    surfaceHover: "#3A3D52",
    border: "#44475A",
    text: "#F8F8F2",
    text2: "#BBBDCF",
    text3: "#6272A4",
    primary: "#A97BF4",
    primaryHover: "#BC93FF",
    primaryFg: "#282A36",
    primaryGlow: "rgba(189,147,249,0.4)",
    danger: "#FF5555",
    dangerFg: "#F8F8F2",
    dangerGlow: "rgba(255,85,85,0.3)",
    success: "#50FA7B",
    successFg: "#282A36",
    successGlow: "rgba(80,250,123,0.3)",
    warning: "#F1FA8C",
    warningFg: "#282A36",
    inputBg: "#343746",
    inputBorder: "#44475A",
    sent: "#BD93F9",
    sentFg: "#282A36",
    sentTime: "rgba(40,42,54,0.65)",
    seenTickColor: "#282A36",
    recv: "#343746",
    recvFg: "#F8F8F2",
    recvBorder: "transparent",
    recvTime: "#6272A4",
    headerBg: "#21222C",
    headerFg: "#F8F8F2",
    headerBtn: "#343746",
    reactionBg: "#343746",
    reactionBorder: "#44475A",
    reactionActive: "#44475A",
    reactionActiveBorder: "#BD93F9",
    reactionText: "#F8F8F2",
    badgeBg: "#FF5555",
    badgeFg: "#F8F8F2",
    glow: "0 0 14px rgba(189,147,249,0.3)",
    glowStrong: "0 0 24px rgba(189,147,249,0.55)",
    cardShadow: "0 4px 28px rgba(0,0,0,0.45)",
    preview: {
      bg: "#1E1F29",
      bubble1: "#BD93F9",
      bubble2: "#343746",
      header: "#21222C",
    },
  },
  gruvbox: {
    name: "Gruvbox",
    emoji: "🪵",
    isDark: true,
    bg: "#1D2021",
    surface: "#282828",
    surface2: "#32302F",
    surface3: "#3C3836",
    surfaceHover: "#3A3735",
    border: "#504945",
    text: "#EBDBB2",
    text2: "#D5C4A1",
    text3: "#928374",
    primary: "#FABD2F",
    primaryHover: "#FFD050",
    primaryFg: "#282828",
    primaryGlow: "rgba(250,189,47,0.35)",
    danger: "#FB4934",
    dangerFg: "#EBDBB2",
    dangerGlow: "rgba(251,73,52,0.3)",
    success: "#B8BB26",
    successFg: "#282828",
    successGlow: "rgba(184,187,38,0.3)",
    warning: "#FE8019",
    warningFg: "#282828",
    inputBg: "#32302F",
    inputBorder: "#504945",
    sent: "#689D6A",
    sentFg: "#EBDBB2",
    sentTime: "rgba(40,40,40,0.6)",
    seenTickColor: "#FABD2F",
    recv: "#32302F",
    recvFg: "#EBDBB2",
    recvBorder: "#504945",
    recvTime: "#928374",
    headerBg: "#1D2021",
    headerFg: "#EBDBB2",
    headerBtn: "#32302F",
    reactionBg: "#3C3836",
    reactionBorder: "#504945",
    reactionActive: "#504945",
    reactionActiveBorder: "#FABD2F",
    reactionText: "#EBDBB2",
    badgeBg: "#FB4934",
    badgeFg: "#EBDBB2",
    glow: "0 0 14px rgba(250,189,47,0.25)",
    glowStrong: "0 0 24px rgba(250,189,47,0.45)",
    cardShadow: "0 4px 28px rgba(0,0,0,0.5)",
    preview: {
      bg: "#1D2021",
      bubble1: "#689D6A",
      bubble2: "#32302F",
      header: "#1D2021",
    },
  },
  midnight: {
    name: "Midnight",
    emoji: "🌌",
    isDark: true,
    bg: "#0D1117",
    surface: "#161B22",
    surface2: "#1C2333",
    surface3: "#21262D",
    surfaceHover: "#1F2937",
    border: "#30363D",
    text: "#E6EDF3",
    text2: "#8B949E",
    text3: "#484F58",
    primary: "#58A6FF",
    primaryHover: "#79B8FF",
    primaryFg: "#0D1117",
    primaryGlow: "rgba(88,166,255,0.4)",
    danger: "#F85149",
    dangerFg: "#E6EDF3",
    dangerGlow: "rgba(248,81,73,0.3)",
    success: "#3FB950",
    successFg: "#0D1117",
    successGlow: "rgba(63,185,80,0.3)",
    warning: "#D29922",
    warningFg: "#0D1117",
    inputBg: "#1C2333",
    inputBorder: "#30363D",
    sent: "#1F6FEB",
    sentFg: "#E6EDF3",
    sentTime: "rgba(255,255,255,0.7)",
    seenTickColor: "#58A6FF",
    recv: "#1C2333",
    recvFg: "#E6EDF3",
    recvBorder: "#30363D",
    recvTime: "#8B949E",
    headerBg: "#161B22",
    headerFg: "#E6EDF3",
    headerBtn: "#21262D",
    reactionBg: "#21262D",
    reactionBorder: "#30363D",
    reactionActive: "#1F2937",
    reactionActiveBorder: "#58A6FF",
    reactionText: "#E6EDF3",
    badgeBg: "#F85149",
    badgeFg: "#E6EDF3",
    glow: "0 0 16px rgba(88,166,255,0.25)",
    glowStrong: "0 0 28px rgba(88,166,255,0.5)",
    cardShadow: "0 4px 32px rgba(0,0,0,0.6)",
    preview: {
      bg: "#0D1117",
      bubble1: "#1F6FEB",
      bubble2: "#1C2333",
      header: "#161B22",
    },
  },
  synthwave: {
    name: "Synthwave",
    emoji: "🌃",
    isDark: true,
    bg: "#0A0E1A",
    surface: "#111827",
    surface2: "#1A2235",
    surface3: "#1E2D45",
    surfaceHover: "#1E293B",
    border: "#2D3B55",
    text: "#E2E8F0",
    text2: "#94A3B8",
    text3: "#4B6080",
    primary: "#7C3AED",
    primaryHover: "#8B5CF6",
    primaryFg: "#FFFFFF",
    primaryGlow: "rgba(124,58,237,0.5)",
    danger: "#FF4D6D",
    dangerFg: "#FFFFFF",
    dangerGlow: "rgba(255,77,109,0.35)",
    success: "#06D6A0",
    successFg: "#0A0E1A",
    successGlow: "rgba(6,214,160,0.35)",
    warning: "#FFB703",
    warningFg: "#0A0E1A",
    inputBg: "#1A2235",
    inputBorder: "#2D3B55",
    sent: "#7C3AED",
    sentFg: "#FFFFFF",
    sentTime: "rgba(255,255,255,0.72)",
    seenTickColor: "#06D6A0",
    recv: "#1A2235",
    recvFg: "#E2E8F0",
    recvBorder: "#2D3B55",
    recvTime: "#4B6080",
    headerBg: "#0F172A",
    headerFg: "#E2E8F0",
    headerBtn: "#1A2235",
    reactionBg: "#1E2D45",
    reactionBorder: "#2D3B55",
    reactionActive: "#2D1F5E",
    reactionActiveBorder: "#7C3AED",
    reactionText: "#E2E8F0",
    badgeBg: "#FF4D6D",
    badgeFg: "#FFFFFF",
    glow: "0 0 18px rgba(124,58,237,0.3)",
    glowStrong: "0 0 32px rgba(124,58,237,0.6)",
    cardShadow: "0 4px 32px rgba(0,0,0,0.7)",
    preview: {
      bg: "#0A0E1A",
      bubble1: "#7C3AED",
      bubble2: "#1A2235",
      header: "#0F172A",
    },
  },
  aureate: {
    name: "Aureate",
    emoji: "🏆",
    isDark: true,
    bg: "#12100C",
    surface: "#1C1913",
    surface2: "#262116",
    surface3: "#2F2818",
    surfaceHover: "#332C1C",
    border: "#4A3D20",
    text: "#F7F2E7",
    text2: "#E6D9BC",
    text3: "#B69C6A",
    primary: "#D4AF37",
    primaryHover: "#E3C35A",
    primaryFg: "#1B1406",
    primaryGlow: "rgba(212,175,55,0.45)",
    danger: "#D1495B",
    dangerFg: "#FFF4E9",
    dangerGlow: "rgba(209,73,91,0.35)",
    success: "#73C48F",
    successFg: "#0E2116",
    successGlow: "rgba(115,196,143,0.35)",
    warning: "#E0A13A",
    warningFg: "#1A1106",
    inputBg: "#2B2416",
    inputBorder: "#594823",
    sent: "#D4AF37",
    sentFg: "#1B1406",
    sentTime: "rgba(27,20,6,0.62)",
    seenTickColor: "#FFE08A",
    recv: "#2A2418",
    recvFg: "#F7F2E7",
    recvBorder: "#594823",
    recvTime: "#B69C6A",
    headerBg: "#19150F",
    headerFg: "#F7F2E7",
    headerBtn: "#2A2315",
    reactionBg: "#2D2618",
    reactionBorder: "#594823",
    reactionActive: "#3D3116",
    reactionActiveBorder: "#D4AF37",
    reactionText: "#F7F2E7",
    badgeBg: "#D1495B",
    badgeFg: "#FFF4E9",
    glow: "0 0 16px rgba(212,175,55,0.33)",
    glowStrong: "0 0 30px rgba(212,175,55,0.56)",
    cardShadow: "0 6px 32px rgba(0,0,0,0.52)",
    preview: {
      bg: "#12100C",
      bubble1: "#D4AF37",
      bubble2: "#2A2418",
      header: "#19150F",
    },
  },
  oceanic: {
    name: "Oceanic",
    emoji: "🌊",
    isDark: true,
    bg: "#06141B",
    surface: "#0B1F2A",
    surface2: "#102A39",
    surface3: "#163548",
    surfaceHover: "#1A3F55",
    border: "#24506A",
    text: "#EAF7FF",
    text2: "#B8D7E8",
    text3: "#7EA8BE",
    primary: "#2EC4FF",
    primaryHover: "#54D2FF",
    primaryFg: "#05202B",
    primaryGlow: "rgba(46,196,255,0.42)",
    danger: "#FF6B6B",
    dangerFg: "#FFF7F7",
    dangerGlow: "rgba(255,107,107,0.32)",
    success: "#4CD4AE",
    successFg: "#05271F",
    successGlow: "rgba(76,212,174,0.32)",
    warning: "#FFB86B",
    warningFg: "#2A1606",
    inputBg: "#112B3A",
    inputBorder: "#2A5F7A",
    sent: "#2EC4FF",
    sentFg: "#05202B",
    sentTime: "rgba(5,32,43,0.56)",
    seenTickColor: "#9DE7FF",
    recv: "#112B3A",
    recvFg: "#EAF7FF",
    recvBorder: "#2A5F7A",
    recvTime: "#7EA8BE",
    headerBg: "#091A24",
    headerFg: "#EAF7FF",
    headerBtn: "#112B3A",
    reactionBg: "#163548",
    reactionBorder: "#2A5F7A",
    reactionActive: "#1B4660",
    reactionActiveBorder: "#2EC4FF",
    reactionText: "#EAF7FF",
    badgeBg: "#FF6B6B",
    badgeFg: "#FFF7F7",
    glow: "0 0 14px rgba(46,196,255,0.3)",
    glowStrong: "0 0 24px rgba(46,196,255,0.52)",
    cardShadow: "0 6px 28px rgba(0,0,0,0.5)",
    preview: { bg: "#06141B", bubble1: "#2EC4FF", bubble2: "#112B3A", header: "#091A24" },
  },
  slate: {
    name: "Slate",
    emoji: "🧊",
    isDark: false,
    bg: "#F3F6FB",
    surface: "#FFFFFF",
    surface2: "#EEF2F8",
    surface3: "#E5EBF4",
    surfaceHover: "#E9EEF7",
    border: "#CBD5E3",
    text: "#1D2A3A",
    text2: "#3A4A5F",
    text3: "#6A7B93",
    primary: "#3F7DFF",
    primaryHover: "#5B90FF",
    primaryFg: "#FFFFFF",
    primaryGlow: "rgba(63,125,255,0.3)",
    danger: "#E45858",
    dangerFg: "#FFFFFF",
    dangerGlow: "rgba(228,88,88,0.24)",
    success: "#2FAF7A",
    successFg: "#FFFFFF",
    successGlow: "rgba(47,175,122,0.24)",
    warning: "#E6A129",
    warningFg: "#FFFFFF",
    inputBg: "#F7F9FD",
    inputBorder: "#CBD5E3",
    sent: "#3F7DFF",
    sentFg: "#FFFFFF",
    sentTime: "rgba(255,255,255,0.7)",
    seenTickColor: "#DCE7FF",
    recv: "#FFFFFF",
    recvFg: "#1D2A3A",
    recvBorder: "#CBD5E3",
    recvTime: "#6A7B93",
    headerBg: "#FFFFFF",
    headerFg: "#1D2A3A",
    headerBtn: "#EEF2F8",
    reactionBg: "#EEF2F8",
    reactionBorder: "#CBD5E3",
    reactionActive: "#E2EAFF",
    reactionActiveBorder: "#3F7DFF",
    reactionText: "#1D2A3A",
    badgeBg: "#E45858",
    badgeFg: "#FFFFFF",
    glow: "0 0 10px rgba(63,125,255,0.22)",
    glowStrong: "0 0 18px rgba(63,125,255,0.34)",
    cardShadow: "0 6px 20px rgba(34,52,84,0.12)",
    preview: { bg: "#F3F6FB", bubble1: "#3F7DFF", bubble2: "#FFFFFF", header: "#FFFFFF" },
  },
  emerald: {
    name: "Emerald",
    emoji: "🍃",
    isDark: true,
    bg: "#0B1612",
    surface: "#11241C",
    surface2: "#163126",
    surface3: "#1A3B2F",
    surfaceHover: "#204738",
    border: "#2A5B47",
    text: "#E8FFF4",
    text2: "#BCE7D2",
    text3: "#7FB79C",
    primary: "#3DDC97",
    primaryHover: "#66E6AD",
    primaryFg: "#072015",
    primaryGlow: "rgba(61,220,151,0.42)",
    danger: "#FF7A7A",
    dangerFg: "#FFF4F4",
    dangerGlow: "rgba(255,122,122,0.32)",
    success: "#3DDC97",
    successFg: "#072015",
    successGlow: "rgba(61,220,151,0.36)",
    warning: "#F6C85F",
    warningFg: "#2A1A07",
    inputBg: "#163126",
    inputBorder: "#2A5B47",
    sent: "#3DDC97",
    sentFg: "#072015",
    sentTime: "rgba(7,32,21,0.56)",
    seenTickColor: "#BFF7DA",
    recv: "#163126",
    recvFg: "#E8FFF4",
    recvBorder: "#2A5B47",
    recvTime: "#7FB79C",
    headerBg: "#102018",
    headerFg: "#E8FFF4",
    headerBtn: "#163126",
    reactionBg: "#1A3B2F",
    reactionBorder: "#2A5B47",
    reactionActive: "#20513F",
    reactionActiveBorder: "#3DDC97",
    reactionText: "#E8FFF4",
    badgeBg: "#FF7A7A",
    badgeFg: "#FFF4F4",
    glow: "0 0 14px rgba(61,220,151,0.3)",
    glowStrong: "0 0 24px rgba(61,220,151,0.5)",
    cardShadow: "0 6px 28px rgba(0,0,0,0.5)",
    preview: { bg: "#0B1612", bubble1: "#3DDC97", bubble2: "#163126", header: "#102018" },
  },
};

export const MATERIALS = {
  solid: { key: "solid", label: "Solid" },
  glass: { key: "glass", label: "Glassmorphism" },
  neumorphism: { key: "neumorphism", label: "Neumorphism" },
  m3: { key: "m3", label: "Material Design 3" },
  apple: { key: "apple", label: "Apple HIG" },
};

export const SHAPE_STYLES = {
  sharp: { key: "sharp", label: "Sharp" },
  rounded: { key: "rounded", label: "Rounded" },
  soft: { key: "soft", label: "Soft" },
  pill: { key: "pill", label: "Pill" },
};

export const LAYOUT_STYLES = {
  modal: { key: "modal", label: "Default Mode" },
  telegram: { key: "telegram", label: "Telegram" },
  sidebar: { key: "sidebar", label: "Discord Sidebar" },
};

function hexToRgba(color, alpha) {
  const raw = String(color || "").trim();
  const m = raw.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return raw;
  const hex = m[1].length === 3
    ? m[1]
        .split("")
        .map((ch) => ch + ch)
        .join("")
    : m[1];
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function applyMaterial(baseTheme, materialName) {
  if (!baseTheme) return baseTheme;

  if (materialName === "glass") {
    return {
      ...baseTheme,
      material: "glass",
      surface: hexToRgba(baseTheme.surface, 0.78),
      surface2: hexToRgba(baseTheme.surface2, 0.72),
      surface3: hexToRgba(baseTheme.surface3, 0.66),
      surfaceHover: hexToRgba(baseTheme.surfaceHover || baseTheme.surface3, 0.82),
      inputBg: hexToRgba(baseTheme.inputBg || baseTheme.surface2, 0.74),
      border: hexToRgba(baseTheme.border, 0.42),
      inputBorder: hexToRgba(baseTheme.inputBorder || baseTheme.border, 0.52),
      headerBg: hexToRgba(baseTheme.headerBg || baseTheme.surface, 0.68),
      headerBtn: hexToRgba(baseTheme.headerBtn || baseTheme.surface2, 0.62),
      cardShadow: "0 14px 36px rgba(0,0,0,0.34)",
      primaryGlow: hexToRgba(baseTheme.primary, 0.56),
      glow: `0 0 16px ${hexToRgba(baseTheme.primary, 0.34)}`,
      glowStrong: `0 0 28px ${hexToRgba(baseTheme.primary, 0.58)}`,
      materialFx: {
        panelBackdrop: "blur(18px) saturate(165%)",
        buttonTransform: "translateY(-1.5px)",
        controlShadow: "0 10px 24px rgba(8,12,24,0.24), inset 0 1px 0 rgba(255,255,255,0.34)",
        controlHoverShadow: "0 14px 28px rgba(10,14,26,0.32), inset 0 1px 0 rgba(255,255,255,0.44)",
        focusHalo: hexToRgba(baseTheme.primary, 0.42),
        focusWidth: "2px",
        hoverFilter: "brightness(1.08) saturate(1.08)",
      },
    };
  }

  if (materialName === "neumorphism") {
    const isDark = !!baseTheme.isDark;
    return {
      ...baseTheme,
      material: "neumorphism",
      surface: baseTheme.surface,
      surface2: baseTheme.surface2,
      surface3: baseTheme.surface3,
      surfaceHover: baseTheme.surfaceHover,
      inputBg: baseTheme.inputBg,
      border: baseTheme.border,
      inputBorder: baseTheme.inputBorder,
      headerBg: baseTheme.headerBg,
      headerBtn: baseTheme.headerBtn,
      cardShadow: isDark
        ? "8px 8px 16px rgba(12,14,18,0.45), -8px -8px 16px rgba(72,78,96,0.22)"
        : "8px 8px 16px rgba(179,186,204,0.6), -8px -8px 16px rgba(255,255,255,0.9)",
      primaryGlow: hexToRgba(baseTheme.primary, isDark ? 0.2 : 0.16),
      glow: `0 0 10px ${hexToRgba(baseTheme.primary, isDark ? 0.16 : 0.12)}`,
      glowStrong: `0 0 18px ${hexToRgba(baseTheme.primary, isDark ? 0.24 : 0.18)}`,
      materialFx: {
        panelBackdrop: "none",
        buttonTransform: "translateY(0)",
        controlShadow: isDark
          ? "inset 2px 2px 4px rgba(255,255,255,0.08), inset -4px -4px 7px rgba(0,0,0,0.28)"
          : "inset 2px 2px 4px rgba(255,255,255,0.9), inset -4px -4px 7px rgba(160,170,190,0.34)",
        controlHoverShadow: isDark
          ? "inset 2px 2px 4px rgba(255,255,255,0.12), inset -5px -5px 9px rgba(0,0,0,0.35)"
          : "inset 2px 2px 4px rgba(255,255,255,0.95), inset -5px -5px 9px rgba(150,162,184,0.4)",
        focusHalo: hexToRgba(baseTheme.primary, isDark ? 0.28 : 0.22),
        focusWidth: "1.5px",
        hoverFilter: "brightness(1.02) saturate(1.03)",
      },
    };
  }

  if (materialName === "m3") {
    const isDark = !!baseTheme.isDark;
    return {
      ...baseTheme,
      material: "m3",
      surface: baseTheme.surface,
      surface2: baseTheme.surface2,
      surface3: baseTheme.surface3,
      surfaceHover: baseTheme.surfaceHover,
      border: baseTheme.border,
      inputBg: baseTheme.inputBg,
      inputBorder: baseTheme.inputBorder,
      headerBg: baseTheme.headerBg,
      headerBtn: baseTheme.headerBtn,
      cardShadow: isDark
        ? "0 6px 24px rgba(0,0,0,0.44)"
        : "0 5px 18px rgba(60,45,78,0.18)",
      primaryGlow: hexToRgba(baseTheme.primary, isDark ? 0.26 : 0.22),
      glow: `0 0 10px ${hexToRgba(baseTheme.primary, isDark ? 0.18 : 0.16)}`,
      glowStrong: `0 0 16px ${hexToRgba(baseTheme.primary, isDark ? 0.24 : 0.2)}`,
      materialFx: {
        panelBackdrop: "none",
        buttonTransform: "translateY(-1px)",
        controlShadow: isDark
          ? "0 1px 2px rgba(0,0,0,0.42), 0 2px 6px rgba(0,0,0,0.28)"
          : "0 1px 1px rgba(78,72,92,0.16), 0 2px 6px rgba(78,72,92,0.14)",
        controlHoverShadow: isDark
          ? "0 2px 4px rgba(0,0,0,0.44), 0 6px 12px rgba(0,0,0,0.26)"
          : "0 2px 4px rgba(78,72,92,0.2), 0 6px 12px rgba(78,72,92,0.16)",
        focusHalo: hexToRgba(baseTheme.primary, isDark ? 0.26 : 0.2),
        focusWidth: "2px",
        hoverFilter: "brightness(1.03) saturate(1.04)",
      },
    };
  }

  if (materialName === "apple") {
    const isDark = !!baseTheme.isDark;
    return {
      ...baseTheme,
      material: "apple",
      surface: isDark ? hexToRgba(baseTheme.surface, 0.92) : hexToRgba(baseTheme.surface, 0.96),
      surface2: isDark ? hexToRgba(baseTheme.surface2, 0.88) : hexToRgba(baseTheme.surface2, 0.94),
      surface3: isDark ? hexToRgba(baseTheme.surface3, 0.84) : hexToRgba(baseTheme.surface3, 0.9),
      surfaceHover: baseTheme.surfaceHover,
      inputBg: isDark ? hexToRgba(baseTheme.inputBg || baseTheme.surface2, 0.8) : hexToRgba(baseTheme.inputBg || baseTheme.surface2, 0.9),
      border: isDark ? hexToRgba(baseTheme.border, 0.5) : hexToRgba(baseTheme.border, 0.6),
      inputBorder: isDark ? hexToRgba(baseTheme.inputBorder || baseTheme.border, 0.6) : hexToRgba(baseTheme.inputBorder || baseTheme.border, 0.7),
      headerBg: isDark ? hexToRgba(baseTheme.headerBg || baseTheme.surface, 0.85) : hexToRgba(baseTheme.headerBg || baseTheme.surface, 0.92),
      headerBtn: isDark ? hexToRgba(baseTheme.headerBtn || baseTheme.surface2, 0.75) : hexToRgba(baseTheme.headerBtn || baseTheme.surface2, 0.85),
      cardShadow: isDark
        ? "0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.2)"
        : "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
      primaryGlow: hexToRgba(baseTheme.primary, isDark ? 0.35 : 0.28),
      glow: `0 0 12px ${hexToRgba(baseTheme.primary, isDark ? 0.25 : 0.2)}`,
      glowStrong: `0 0 20px ${hexToRgba(baseTheme.primary, isDark ? 0.35 : 0.28)}`,
      materialFx: {
        panelBackdrop: "blur(20px) saturate(180%)",
        buttonTransform: "translateY(-0.5px) scale(0.995)",
        controlShadow: isDark
          ? "0 1px 3px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)"
          : "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
        controlHoverShadow: isDark
          ? "0 4px 12px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.25)"
          : "0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)",
        focusHalo: hexToRgba(baseTheme.primary, isDark ? 0.4 : 0.32),
        focusWidth: "3px",
        hoverFilter: "brightness(1.04) saturate(1.06)",
      },
    };
  }

  return {
    ...baseTheme,
    material: "solid",
    materialFx: {
      panelBackdrop: "none",
      buttonTransform: "translateY(-0.5px)",
      controlShadow: "none",
      controlHoverShadow: "0 6px 14px rgba(0,0,0,0.14)",
      focusHalo: String(baseTheme.primaryGlow || "rgba(37,99,235,0.35)"),
      focusWidth: "2px",
      hoverFilter: "brightness(1.06)",
    },
  };
}

function normalizeThemeName(raw) {
  const n = String(raw || "").trim().toLowerCase();
  if (!n) return "dracula";
  if (n === "light" || n === "sunny") return "slate";
  return n;
}

const ThemeContext = createContext(null);
export const ThemeProvider = ({ children }) => {
  const [themeName, setThemeName] = useState(
    () => normalizeThemeName(sessionStorage.getItem("chatapp_theme") || "dracula"),
  );
  const [materialName, setMaterialName] = useState(
    () => sessionStorage.getItem("chatapp_material") || "solid",
  );
  const [shapeName, setShapeName] = useState(
    () => sessionStorage.getItem("chatapp_shape") || "rounded",
  );
  const [layoutName, setLayoutName] = useState(
    () => {
      const saved = sessionStorage.getItem("chatapp_layout") || "modal";
      return saved === "messenger" ? "telegram" : saved;
    },
  );
  const baseTheme = THEMES[themeName] || THEMES.dracula;
  const theme = applyMaterial(baseTheme, materialName);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--app-focus-color", theme.primary);
    root.style.setProperty("--app-focus-halo", theme.primaryGlow);
    root.style.setProperty("--app-focus-text", theme.primaryFg);
    root.style.setProperty("--app-primary-glow", String(theme.primaryGlow || "rgba(37,99,235,0.35)"));
    root.style.setProperty("--app-surface", String(theme.surface || "#1f2937"));
    root.style.setProperty("--app-surface-2", String(theme.surface2 || theme.surface || "#111827"));
    root.style.setProperty("--app-surface-3", String(theme.surface3 || theme.surface2 || "#0f172a"));
    root.style.setProperty("--app-border", String(theme.border || "rgba(148,163,184,0.5)"));
    root.style.setProperty("--app-material", String(theme.material || "solid"));
    root.style.setProperty(
      "--app-panel-backdrop",
      String(theme.materialFx?.panelBackdrop || "none"),
    );
    root.style.setProperty(
      "--app-button-lift",
      String(theme.materialFx?.buttonTransform || "translateY(-0.5px)"),
    );
    root.style.setProperty(
      "--app-control-shadow",
      String(theme.materialFx?.controlShadow || "none"),
    );
    root.style.setProperty(
      "--app-control-shadow-hover",
      String(theme.materialFx?.controlHoverShadow || "0 6px 14px rgba(0,0,0,0.14)"),
    );
    root.style.setProperty(
      "--app-focus-halo",
      String(theme.materialFx?.focusHalo || theme.primaryGlow || "rgba(37,99,235,0.35)"),
    );
    root.style.setProperty(
      "--app-focus-width",
      String(theme.materialFx?.focusWidth || "2px"),
    );
    root.style.setProperty(
      "--app-hover-filter",
      String(theme.materialFx?.hoverFilter || "brightness(1.06)"),
    );
    root.setAttribute("data-material", String(theme.material || "solid"));
    root.setAttribute("data-theme", String(themeName || "dracula"));

    if (shapeName === "sharp") {
      root.style.setProperty("--app-radius-xs", "6px");
      root.style.setProperty("--app-radius-sm", "8px");
      root.style.setProperty("--app-radius-md", "10px");
      root.style.setProperty("--app-radius-lg", "12px");
      root.style.setProperty("--app-radius-xl", "14px");
      root.style.setProperty("--app-focus-radius", "8px");
    } else if (shapeName === "soft") {
      root.style.setProperty("--app-radius-xs", "10px");
      root.style.setProperty("--app-radius-sm", "12px");
      root.style.setProperty("--app-radius-md", "15px");
      root.style.setProperty("--app-radius-lg", "18px");
      root.style.setProperty("--app-radius-xl", "22px");
      root.style.setProperty("--app-focus-radius", "16px");
    } else if (shapeName === "pill") {
      root.style.setProperty("--app-radius-xs", "14px");
      root.style.setProperty("--app-radius-sm", "16px");
      root.style.setProperty("--app-radius-md", "20px");
      root.style.setProperty("--app-radius-lg", "24px");
      root.style.setProperty("--app-radius-xl", "999px");
      root.style.setProperty("--app-focus-radius", "999px");
    } else {
      root.style.setProperty("--app-radius-xs", "8px");
      root.style.setProperty("--app-radius-sm", "10px");
      root.style.setProperty("--app-radius-md", "12px");
      root.style.setProperty("--app-radius-lg", "16px");
      root.style.setProperty("--app-radius-xl", "20px");
      root.style.setProperty("--app-focus-radius", "12px");
    }
    root.setAttribute("data-shape", shapeName);
    root.setAttribute("data-layout", layoutName);
  }, [theme, shapeName, layoutName]);

  const setTheme = (n) => {
    const next = normalizeThemeName(n);
    setThemeName(next);
    sessionStorage.setItem("chatapp_theme", next);
  };
  const setMaterial = (n) => {
    setMaterialName(n);
    sessionStorage.setItem("chatapp_material", n);
  };
  const setShape = (n) => {
    setShapeName(n);
    sessionStorage.setItem("chatapp_shape", n);
  };
  const setLayout = (n) => {
    const next = n === "messenger" ? "telegram" : n;
    setLayoutName(next);
    sessionStorage.setItem("chatapp_layout", next);
  };
  return (
    <ThemeContext.Provider
      value={{
        theme,
        themeName,
        setTheme,
        themes: THEMES,
        materialName,
        setMaterial,
        materials: MATERIALS,
        shapeName,
        setShape,
        shapes: SHAPE_STYLES,
        layoutName,
        setLayout,
        layouts: LAYOUT_STYLES,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};
export const useTheme = () => useContext(ThemeContext);
