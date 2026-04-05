import React from "react";

const AppLoadingScreen = ({ theme, progress = 0, status = "Securing your data..." }) => {
  const pct = Math.max(0, Math.min(100, Math.round((Number(progress) || 0) * 100)));
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: theme.bg,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
      }}
    >
      <div style={{ position: "relative", width: 64, height: 64 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: `3px solid ${theme.border}`,
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "50%",
            border: "3px solid transparent",
            borderTopColor: theme.primary,
            animation: "spin 0.9s linear infinite",
            boxShadow: `0 0 16px ${theme.primaryGlow}`,
          }}
        />
      </div>
      <div style={{ color: theme.text, fontSize: 16, fontWeight: 800 }}>
        SecureChat
      </div>
      <div style={{ color: theme.text3, fontSize: 12 }}>{status}</div>
      <div
        style={{
          width: 220,
          height: 6,
          borderRadius: 999,
          background: theme.surface2,
          border: `1px solid ${theme.border}`,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${theme.primary}88, ${theme.primary})`,
            boxShadow: `0 0 14px ${theme.primaryGlow}`,
            transition: "width 180ms ease",
          }}
        />
      </div>
      <div style={{ color: theme.text3, fontSize: 11, fontWeight: 700 }}>{pct}%</div>
    </div>
  );
};

export default AppLoadingScreen;
