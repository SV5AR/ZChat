import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useTheme,
  THEMES,
  MATERIALS,
  SHAPE_STYLES,
  LAYOUT_STYLES,
} from "../context/ThemeContext";
import { CloseIcon } from "./Icons";

const ThemePicker = ({ onClose }) => {
  const {
    theme,
    themeName,
    setTheme,
    materialName,
    setMaterial,
    shapeName,
    setShape,
    layoutName,
    setLayout,
  } = useTheme();
  const [hovered, setHovered] = useState(null);
  const [tab, setTab] = useState("palette");
  const [closing, setClosing] = useState(false);
  const prevTabRef = React.useRef("palette");
  const [tabAnimClass, setTabAnimClass] = useState("tab-content");
  const closeTimerRef = React.useRef(null);

  React.useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    const prev = prevTabRef.current;
    prevTabRef.current = tab;
    const cls = prev === tab ? "tab-content" : "tab-content tab-content-slide";
    setTabAnimClass(cls);
  }, [tab]);

  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 180);
  };

  const handlePick = (key) => {
    setTheme(key);
  };

  const tabTrackRef = useRef(null);
  const tabButtonRefs = useRef({});
  const [tabPositions, setTabPositions] = useState({});
  const [isCompactMode, setIsCompactMode] = useState(false);

  useEffect(() => {
    // Measure tab positions and check if compact mode is needed
    if (tabTrackRef.current) {
      const trackWidth = tabTrackRef.current.clientWidth;
      const buttons = tabTrackRef.current.querySelectorAll("button");
      const positions = {};
      let totalMinWidth = 0;
      buttons.forEach((btn) => {
        const key = btn.getAttribute("data-tab");
        if (key) {
          positions[key] = {
            offsetLeft: btn.offsetLeft,
            offsetWidth: btn.offsetWidth,
          };
          totalMinWidth += parseInt(btn.style.minWidth || 70, 10);
        }
      });
      setTabPositions(positions);
      // Enable compact/scroll mode if track is too narrow to fit all tabs comfortably
      setIsCompactMode(trackWidth < 300);
    }
  }, [tab]);

  // Listen for resize to toggle compact mode
  useEffect(() => {
    const handleResize = () => {
      if (tabTrackRef.current) {
        setIsCompactMode(tabTrackRef.current.clientWidth < 380);
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize(); // Check on mount
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const handleTabClick = (tabKey) => {
    setTab(tabKey);
    // Auto-scroll to make the clicked tab visible (only in compact mode)
    if (isCompactMode) {
      const btn = tabButtonRefs.current[tabKey];
      if (btn && tabTrackRef.current) {
        const track = tabTrackRef.current;
        const trackWidth = track.clientWidth;
        const scrollLeft = track.scrollLeft;
        const btnLeft = btn.offsetLeft;
        const btnWidth = btn.offsetWidth;

        // Check if tab is outside visible area
        if (btnLeft < scrollLeft) {
          // Tab is to the left of visible area
          track.scrollTo({ left: btnLeft, behavior: "smooth" });
        } else if (btnLeft + btnWidth > scrollLeft + trackWidth) {
          // Tab is to the right of visible area
          track.scrollTo({ left: btnLeft + btnWidth - trackWidth, behavior: "smooth" });
        }
      }
    }
  };

  const tabs = ["palette", "material", "shape", "layout"];
  const activeTabIdx = tabs.indexOf(tab);
  const activeTabPos = tabPositions[tab];

  // Get active tab label color based on material for proper contrast
  const getActiveTabLabelColor = () => {
    const material = theme.material || "solid";

    // Impact-Fill (Solid) & Apple HIG: Primary background → use primaryFg
    if (material === "solid" || material === "apple") {
      return theme.primaryFg || "#ffffff";
    }

    // Aero-Active (Glass): Frosted glass → use primary
    if (material === "glass") {
      return theme.primary;
    }

    // Tertiary-Container (M3): Subtle tint → use primary
    if (material === "m3") {
      return theme.primary;
    }

    // Soft-Inset (Neumorphism): Surface background → use primary
    return theme.primary;
  };

  // Material-specific active tab indicator styles
  const getActiveTabStyle = () => {
    const base = {
      position: "absolute",
      top: activeTabPos ? `${activeTabPos.offsetTop}px` : "4px",
      left: activeTabPos ? `${activeTabPos.offsetLeft}px` : `calc(${activeTabIdx} * 25%)`,
      width: activeTabPos ? `${activeTabPos.offsetWidth}px` : "25%",
      height: activeTabPos ? `${activeTabPos.offsetHeight}px` : "calc(100% - 8px)",
      borderRadius: "var(--app-radius-sm)",
      pointerEvents: "none",
      transition:
        "left 0.25s cubic-bezier(0.22,1,0.36,1), top 0.25s cubic-bezier(0.22,1,0.36,1), width 0.25s cubic-bezier(0.22,1,0.36,1), height 0.25s cubic-bezier(0.22,1,0.36,1), all 0.25s cubic-bezier(0.22,1,0.36,1)",
    };

    const material = theme.material || "solid";

    // Apple HIG: Fluid-Press (filled primary, subtle shadow)
    if (material === "apple") {
      return {
        ...base,
        background: `linear-gradient(180deg, ${theme.primary}, ${theme.primaryHover || theme.primary})`,
        border: "none",
        borderRadius: "calc(var(--app-radius-sm) + 1px)",
        boxShadow: `
          0 4px 12px ${theme.primaryGlow},
          0 2px 4px rgba(0,0,0,0.12),
          inset 0 1px 0 rgba(255,255,255,0.25)
        `,
      };
    }

    // Aero-Active: Light & Air
    if (material === "glass") {
      return {
        ...base,
        background: `linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)`,
        backdropFilter: "blur(16px) saturate(160%)",
        WebkitBackdropFilter: "blur(16px) saturate(160%)",
        border: `1px solid rgba(255,255,255,0.35)`,
        boxShadow: `
          0 8px 32px rgba(0,0,0,0.12),
          0 2px 8px ${theme.primary}33,
          inset 0 1px 0 rgba(255,255,255,0.25),
          inset 0 -1px 0 rgba(255,255,255,0.1)
        `,
      };
    }

    // Tertiary-Container: Systematic (M3)
    if (material === "m3") {
      return {
        ...base,
        background: `${theme.primary}18`,
        border: `1px solid ${theme.primary}44`,
        borderRadius: "calc(var(--app-radius-sm) + 2px)",
        boxShadow: `
          0 1px 3px rgba(0,0,0,0.12),
          0 1px 2px rgba(0,0,0,0.08),
          inset 0 0 0 1px ${theme.primary}22
        `,
      };
    }

    // Soft-Inset: Tactile (Neumorphism)
    if (material === "neumorphism") {
      return {
        ...base,
        background: `linear-gradient(145deg, ${theme.surface}, ${theme.surface2})`,
        border: "none",
        boxShadow: `
          inset 3px 3px 6px rgba(0,0,0,0.25),
          inset -3px -3px 6px rgba(255,255,255,0.08),
          0 0 0 1px rgba(255,255,255,0.05)
        `,
      };
    }

    // Impact-Fill: Functional (Solid)
    return {
      ...base,
      background: `linear-gradient(135deg, ${theme.primary}, ${theme.primaryHover || theme.primary})`,
      border: "none",
      boxShadow: `
        0 4px 12px ${theme.primaryGlow},
        0 2px 4px rgba(0,0,0,0.15),
        inset 0 1px 0 rgba(255,255,255,0.2)
      `,
    };
  };

  const modal = (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 220,
        padding: 16,
        transform: "translateZ(0)",
        willChange: "opacity",
      }}
      onClick={requestClose}
      className={closing ? "modal-exit" : "modal-enter"}
    >
      <div
        style={{
          background: theme.surface,
          borderRadius: 28,
          padding: 0,
          width: "85%",
          maxWidth: 440,
          minWidth: 280,
          height: "85%",
          maxHeight: 680,
          minHeight: 400,
          position: "relative",
          boxShadow: theme.cardShadow,
          border: `1px solid ${theme.border}`,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          willChange: "transform, opacity",
          backfaceVisibility: "hidden",
        }}
        className={closing ? "modal-card-exit" : "modal-card-enter"}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 18px 14px",
            flexShrink: 0,
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: theme.surface,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ flex: 1, paddingRight: 12 }}>
              <h2
                className="tab-content"
                style={{
                  color: theme.text,
                  fontWeight: 800,
                  fontSize: 18,
                  margin: 0,
                }}
              >
                Appearance
              </h2>
               <p className="tab-content" style={{ color: theme.text3, fontSize: 11, margin: "2px 0 0" }}>
                 {Object.keys(THEMES).length} themes available · Changes apply
                 instantly
               </p>
            </div>
            <button
              onClick={requestClose}
              className="shape-radius-sm"
              style={{
                flexShrink: 0,
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
                boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
                transition: "box-shadow 0.2s ease",
                outline: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <CloseIcon size={16} />
            </button>
          </div>

          <div
            ref={tabTrackRef}
            className="theme-tab-track"
            style={{
              display: "flex",
              alignItems: "center",
              background: theme.surface2,
              borderRadius: "var(--app-radius-md)",
              padding: "4px",
              gap: "4px",
              border: `1px solid ${theme.border}`,
              position: "relative",
              overflow: isCompactMode ? "auto" : "hidden",
              scrollbarWidth: isCompactMode ? "thin" : "none",
              scrollbarColor: `${theme.primary}44 transparent`,
            }}
          >
          <div
            className="theme-tab-indicator"
            style={getActiveTabStyle()}
          />
          <button
            ref={(el) => (tabButtonRefs.current["palette"] = el)}
            data-tab="palette"
            onClick={() => handleTabClick("palette")}
            style={{
              flex: isCompactMode ? "0 0 auto" : 1,
              minWidth: isCompactMode ? 70 : "unset",
              border: "none",
              borderRadius: "var(--app-radius-sm)",
              padding: "8px 12px",
              background: "transparent",
              color: tab === "palette" ? getActiveTabLabelColor() : theme.text2,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              position: "relative",
              zIndex: 1,
              transition: "color 0.18s ease",
              whiteSpace: "nowrap",
            }}
          >
            Colors
          </button>
          <button
            ref={(el) => (tabButtonRefs.current["material"] = el)}
            data-tab="material"
            onClick={() => handleTabClick("material")}
            style={{
              flex: isCompactMode ? "0 0 auto" : 1,
              minWidth: isCompactMode ? 75 : "unset",
              border: "none",
              borderRadius: "var(--app-radius-sm)",
              padding: "8px 12px",
              background: "transparent",
              color: tab === "material" ? getActiveTabLabelColor() : theme.text2,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              position: "relative",
              zIndex: 1,
              transition: "color 0.18s ease",
              whiteSpace: "nowrap",
            }}
          >
            Material
          </button>
          <button
            ref={(el) => (tabButtonRefs.current["shape"] = el)}
            data-tab="shape"
            onClick={() => handleTabClick("shape")}
            style={{
              flex: isCompactMode ? "0 0 auto" : 1,
              minWidth: isCompactMode ? 65 : "unset",
              border: "none",
              borderRadius: "var(--app-radius-sm)",
              padding: "8px 12px",
              background: "transparent",
              color: tab === "shape" ? getActiveTabLabelColor() : theme.text2,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              position: "relative",
              zIndex: 1,
              transition: "color 0.18s ease",
              whiteSpace: "nowrap",
            }}
          >
            Shape
          </button>
          <button
            ref={(el) => (tabButtonRefs.current["layout"] = el)}
            data-tab="layout"
            onClick={() => handleTabClick("layout")}
            style={{
              flex: isCompactMode ? "0 0 auto" : 1,
              minWidth: isCompactMode ? 65 : "unset",
              border: "none",
              borderRadius: "var(--app-radius-sm)",
              padding: "8px 12px",
              background: "transparent",
              color: tab === "layout" ? getActiveTabLabelColor() : theme.text2,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              position: "relative",
              zIndex: 1,
              transition: "color 0.18s ease",
              whiteSpace: "nowrap",
            }}
          >
            Layout
          </button>
        </div>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            padding: "clamp(6px, 1.5vw, 8px) clamp(16px, 4vw, 24px) clamp(16px, 3vw, 24px)",
          }}
        >

        <div
          key={`theme-tab-${tab}`}
          className={tabAnimClass}
          style={{ display: "flex", flexDirection: "column", gap: "clamp(8px, 2vw, 10px)" }}
        >
          {tab === "palette" && Object.entries(THEMES).map(([key, t]) => {
            const active = key === themeName;
            const isHovered = hovered === key;
            const p = t.preview;

            return (
              <button
                key={key}
                onClick={() => handlePick(key)}
                onMouseEnter={() => setHovered(key)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: active
                    ? `${t.primary}22`
                    : isHovered
                      ? theme.surface2
                      : theme.surface2,
                  border: `2px solid ${active ? t.primary : isHovered ? `${t.primary}66` : theme.border}`,
                  borderRadius: "var(--app-radius-lg)",
                  padding: "clamp(10px, 2.5vw, 14px) clamp(12px, 3vw, 16px)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "clamp(10px, 2.5vw, 14px)",
                  textAlign: "left",
                  boxShadow: active
                    ? `0 0 0 1px ${t.primary}33, 0 4px 20px ${t.primary}33`
                    : isHovered
                      ? `0 0 12px ${t.primary}22`
                      : "none",
                  transition: "all 0.18s ease",
                  transform: isHovered && !active ? "translateY(-1px)" : "none",
                }}
              >
                {/* Mini chat preview */}
                <div
                  style={{
                    width: "clamp(56px, 14vw, 72px)",
                    height: "clamp(42px, 10vw, 54px)",
                    borderRadius: "var(--app-radius-md)",
                    overflow: "hidden",
                    background: p.bg,
                    flexShrink: 0,
                    border: `1px solid ${active ? t.primary + "66" : theme.border}`,
                    boxShadow:
                      active || isHovered ? `0 0 8px ${t.primary}44` : "none",
                    transition: "box-shadow 0.18s",
                  }}
                >
                  {/* Header strip */}
                  <div
                    style={{
                      height: 15,
                      background: p.header,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 7px",
                      gap: 4,
                    }}
                  >
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: `${t.primary}99`,
                      }}
                    />
                    <div
                      style={{
                        flex: 1,
                        height: 3,
                        borderRadius: 2,
                        background: "rgba(255,255,255,0.2)",
                      }}
                    />
                  </div>
                  {/* Messages */}
                  <div
                    style={{
                      padding: "4px 6px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 3,
                    }}
                  >
                    <div
                      style={{
                        alignSelf: "flex-end",
                        background: p.bubble1,
                        borderRadius: "7px 7px 2px 7px",
                        padding: "2px 7px",
                        fontSize: 7,
                        color: t.sentFg,
                        maxWidth: 44,
                        boxShadow: `0 0 4px ${p.bubble1}88`,
                      }}
                    >
                      Hey! 👋
                    </div>
                    <div
                      style={{
                        alignSelf: "flex-start",
                        background: p.bubble2,
                        borderRadius: "7px 7px 7px 2px",
                        padding: "2px 7px",
                        fontSize: 7,
                        color: t.recvFg,
                        maxWidth: 44,
                        border:
                          t.recvBorder !== "transparent"
                            ? `1px solid ${t.border}`
                            : "none",
                      }}
                    >
                      Hello!
                    </div>
                  </div>
                </div>

                {/* Theme info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "clamp(5px, 1.5vw, 7px)",
                      marginBottom: 5,
                    }}
                  >
                    <span style={{ fontSize: "clamp(14px, 3.5vw, 17px)" }}>{t.emoji}</span>
                    <span
                      style={{
                        fontWeight: 800,
                        fontSize: "clamp(13px, 3vw, 15px)",
                        color: active ? t.primary : theme.text,
                      }}
                    >
                      {t.name}
                    </span>
                    {active && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: "clamp(9px, 2vw, 10px)",
                          fontWeight: 700,
                          color: t.primary,
                          background: `${t.primary}22`,
                          padding: "clamp(2px, 0.5vw, 2px) clamp(8px, 2vw, 10px)",
                          borderRadius: 20,
                          border: `1px solid ${t.primary}44`,
                          boxShadow: `0 0 8px ${t.primary}44`,
                          whiteSpace: "nowrap",
                        }}
                      >
                        ✓ Active
                      </span>
                    )}
                  </div>

                  {/* Color swatches */}
                  <div style={{ display: "flex", gap: 5, marginBottom: 5 }}>
                    {[
                      t.primary,
                      t.sent,
                      t.success,
                      t.danger,
                      t.warning,
                      t.bg,
                    ].map((c, i) => (
                      <div
                        key={i}
                        style={{
                          width: "clamp(11px, 2.5vw, 13px)",
                          height: "clamp(11px, 2.5vw, 13px)",
                          borderRadius: "50%",
                          background: c,
                          border: `1px solid ${theme.border}`,
                          boxShadow: `0 0 5px ${c}77`,
                          flexShrink: 0,
                        }}
                      />
                    ))}
                  </div>

                  <div
                    style={{
                      fontSize: "clamp(10px, 2vw, 11px)",
                      color: active ? t.primary : theme.text3,
                      fontWeight: active ? 600 : 400,
                      lineHeight: 1.4,
                    }}
                  >
                    {t.isDark ? "🌙 Dark" : "☀️ Light"} ·{" "}
                    {active ? "Currently active" : "Click to apply"}
                  </div>
                </div>
              </button>
            );
          })}

          {tab === "material" && Object.values(MATERIALS).map((m) => {
            const active = materialName === m.key;
            const isHovered = hovered === `m-${m.key}`;
            return (
              <button
                key={m.key}
                onClick={() => setMaterial(m.key)}
                onMouseEnter={() => setHovered(`m-${m.key}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: active ? `${theme.primary}22` : theme.surface2,
                  border: `2px solid ${active ? theme.primary : theme.border}`,
                  borderRadius: "var(--app-radius-lg)",
                  padding: "clamp(10px, 2.5vw, 14px) clamp(12px, 3vw, 16px)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "clamp(8px, 2vw, 12px)",
                  textAlign: "left",
                  boxShadow: isHovered ? `0 0 10px ${theme.primaryGlow}` : "none",
                  transition: "all 0.18s ease",
                }}
              >
                <div>
                  <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{m.label}</div>
                  <div style={{ color: theme.text3, fontSize: 11, marginTop: 3 }}>
                    {m.key === "solid" && "Classic flat surfaces"}
                    {m.key === "glass" && "Liquid glass with frosted depth"}
                    {m.key === "neumorphism" && "Soft extruded tactile depth"}
                    {m.key === "m3" && "Google Material Design 3 surfaces"}
                  </div>
                </div>
                <div
                  style={{
                    width: 52,
                    height: 34,
                    borderRadius: "var(--app-radius-md)",
                    background:
                      m.key === "solid"
                        ? theme.surface3
                        : m.key === "glass"
                          ? "linear-gradient(140deg, rgba(255,255,255,0.5), rgba(255,255,255,0.1) 40%, rgba(255,255,255,0.02))"
                          : m.key === "m3"
                            ? "linear-gradient(180deg, #eaddff, #d0bcff)"
                            : theme.surface2,
                    border: `1px solid ${theme.border}`,
                    boxShadow:
                      m.key === "neumorphism"
                        ? "inset 2px 2px 6px rgba(255,255,255,0.5), inset -2px -2px 6px rgba(0,0,0,0.12)"
                        : m.key === "m3"
                          ? "0 1px 2px rgba(0,0,0,0.24), 0 4px 8px rgba(0,0,0,0.18)"
                        : "none",
                  }}
                />
              </button>
            );
          })}

          {tab === "shape" && Object.values(SHAPE_STYLES).map((shape) => {
            const active = shapeName === shape.key;
            const isHovered = hovered === `s-${shape.key}`;
            return (
              <button
                key={shape.key}
                onClick={() => setShape(shape.key)}
                onMouseEnter={() => setHovered(`s-${shape.key}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: active ? `${theme.primary}22` : theme.surface2,
                  border: `2px solid ${active ? theme.primary : theme.border}`,
                  borderRadius: "var(--app-radius-lg)",
                  padding: "14px 16px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  textAlign: "left",
                  boxShadow: isHovered ? `0 0 10px ${theme.primaryGlow}` : "none",
                  transition: "all 0.18s ease",
                }}
              >
                <div>
                  <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{shape.label}</div>
                  <div style={{ color: theme.text3, fontSize: 11, marginTop: 3 }}>
                    {shape.key === "sharp" && "Crisp interface corners"}
                    {shape.key === "rounded" && "Balanced modern corners"}
                    {shape.key === "soft" && "Friendly soft curves"}
                    {shape.key === "pill" && "Maximum rounded geometry"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  {[8, 12, 18].map((r, i) => (
                    <div
                      key={i}
                      style={{
                        width: 14 + i * 6,
                        height: 10 + i * 4,
                        borderRadius:
                          shape.key === "sharp"
                            ? 4
                            : shape.key === "rounded"
                              ? 8
                              : shape.key === "soft"
                                ? 12
                                : 999,
                        border: `1px solid ${theme.border}`,
                        background: theme.surface3,
                      }}
                    />
                  ))}
                </div>
              </button>
            );
          })}

          {tab === "layout" && Object.values(LAYOUT_STYLES).map((layout) => {
            const active = layoutName === layout.key;
            const isHovered = hovered === `l-${layout.key}`;
            return (
              <button
                key={layout.key}
                onClick={() => setLayout(layout.key)}
                onMouseEnter={() => setHovered(`l-${layout.key}`)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  background: active ? `${theme.primary}22` : theme.surface2,
                  border: `2px solid ${active ? theme.primary : theme.border}`,
                  borderRadius: "var(--app-radius-lg)",
                  padding: "clamp(10px, 2.5vw, 14px) clamp(12px, 3vw, 16px)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "clamp(8px, 2vw, 12px)",
                  textAlign: "left",
                  boxShadow: isHovered ? `0 0 10px ${theme.primaryGlow}` : "none",
                  transition: "all 0.18s ease",
                }}
              >
                <div>
                  <div style={{ color: theme.text, fontWeight: 700, fontSize: "clamp(12px, 3vw, 14px)" }}>{layout.label}</div>
                  <div style={{ color: theme.text3, fontSize: "clamp(9px, 2vw, 11px)", marginTop: 3 }}>
                    {layout.key === "telegram" && "Top app bar with threaded chat emphasis"}
                    {layout.key === "modal" && "Classic modal overlays for sections"}
                    {layout.key === "sidebar" && "Compact left navigation rail for quick switching"}
                  </div>
                </div>
                <div
                  style={{
                    width: "clamp(70px, 18vw, 86px)",
                    height: "clamp(42px, 10vw, 52px)",
                    borderRadius: 12,
                    border: `1px solid ${theme.border}`,
                    background: theme.surface3,
                    position: "relative",
                    overflow: "hidden",
                  }}
                >
                  {layout.key === "sidebar" ? (
                    <>
                      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 20, background: `${theme.primary}33` }} />
                      <div style={{ position: "absolute", left: 22, right: 6, top: 6, height: 7, borderRadius: 4, background: theme.surface }} />
                      <div style={{ position: "absolute", left: 24, right: 8, top: 17, height: 6, borderRadius: 4, background: `${theme.primary}44` }} />
                      <div style={{ position: "absolute", left: 24, right: 8, top: 27, height: 6, borderRadius: 4, background: theme.surface }} />
                      <div style={{ position: "absolute", left: 24, right: 8, top: 37, height: 6, borderRadius: 4, background: theme.surface }} />
                    </>
                  ) : layout.key === "modal" ? (
                    <>
                      <div style={{ position: "absolute", left: 6, right: 6, top: 5, height: 8, borderRadius: 4, background: theme.surface }} />
                      <div style={{ position: "absolute", left: 10, top: 18, width: 28, height: 10, borderRadius: 8, background: `${theme.primary}66` }} />
                      <div style={{ position: "absolute", right: 10, top: 18, width: 28, height: 10, borderRadius: 8, background: `${theme.warning}66` }} />
                      <div style={{ position: "absolute", left: 10, right: 10, bottom: 8, height: 10, borderRadius: 8, background: `${theme.success}66` }} />
                    </>
                  ) : (
                    <>
                      <div style={{ position: "absolute", left: 6, right: 6, top: 5, height: 8, borderRadius: 4, background: `${theme.primary}44` }} />
                      <div style={{ position: "absolute", left: 8, right: 8, top: 18, height: 8, borderRadius: 4, background: theme.surface2 }} />
                      <div style={{ position: "absolute", left: 8, right: 8, top: 30, height: 8, borderRadius: 4, background: theme.surface2 }} />
                      <div style={{ position: "absolute", left: 8, width: 26, bottom: 7, height: 8, borderRadius: 8, background: `${theme.primary}66` }} />
                    </>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        </div>
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(modal, document.body);
  }
  return modal;
};

export default ThemePicker;
