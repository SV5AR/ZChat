import React from "react";

const BackendSetupIssueBanner = ({ theme, message }) => {
  if (!message) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        right: 12,
        zIndex: 2000,
        padding: "10px 12px",
        borderRadius: 12,
        background: theme.surface,
        border: `1px solid ${theme.danger}`,
        color: theme.text,
        fontSize: 12,
        boxShadow: theme.cardShadow,
      }}
    >
      <strong style={{ color: theme.danger }}>Backend setup issue:</strong>{" "}
      {message}
    </div>
  );
};

export default BackendSetupIssueBanner;
