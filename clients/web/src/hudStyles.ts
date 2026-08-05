import type { CSSProperties } from "react";

// The table's buttons. Kept out of the component files so those export
// components and nothing else, which is what Vite's fast refresh needs.

export const hudButton: CSSProperties = {
  padding: "0.4rem 0.8rem",
  borderRadius: "6px",
  border: "1px solid #6b7f6b",
  background: "#2a3a2a",
  color: "#fff",
  fontSize: "0.9rem",
  fontFamily: "inherit",
  cursor: "pointer"
};

export const hudPrimaryButton: CSSProperties = {
  ...hudButton,
  background: "#1d7a3a",
  border: "1px solid #2aa050",
  fontWeight: 600
};
