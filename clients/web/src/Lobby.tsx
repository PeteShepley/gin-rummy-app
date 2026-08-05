import { useState } from "react";
import type { CSSProperties } from "react";
import type { ErrorReason } from "./protocol.ts";

// The pre-game menu for networked play. Create a room (get a shareable code)
// or join one with a code; both take a display name shown on the seats. While
// waiting, the room code is displayed to share with a friend. This is plain
// React/DOM over the Pixi table, matching the in-game overlay's look.

export type LobbyUiState =
  | { phase: "menu"; error?: ErrorReason }
  | { phase: "connecting" }
  | { phase: "waiting"; code: string };

const errorText: Record<ErrorReason, string> = {
  badCode: "No game found for that code. Check it and try again.",
  roomFull: "That game already has two players.",
  badToken: "Your seat is no longer available."
};

interface LobbyProps {
  state: LobbyUiState;
  onCreate: (name: string) => void;
  onJoin: (code: string, name: string) => void;
}

export function Lobby({ state, onCreate, onJoin }: LobbyProps) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  const trimmedName = name.trim();
  const displayName = trimmedName || "Player";

  if (state.phase === "connecting") {
    return (
      <div style={backdrop}>
        <div style={card}>
          <p style={{ margin: 0 }}>Connecting…</p>
        </div>
      </div>
    );
  }

  if (state.phase === "waiting") {
    const share = () => {
      void navigator.clipboard?.writeText(state.code).then(
        () => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        },
        () => setCopied(false)
      );
    };
    return (
      <div style={backdrop}>
        <div style={card}>
          <h1 style={title}>Waiting for your opponent</h1>
          <p style={{ margin: 0 }}>Share this code so a friend can join:</p>
          <div style={codeDisplay}>{state.code}</div>
          <button type="button" style={button} onClick={share}>
            {copied ? "Copied!" : "Copy code"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={backdrop}>
      <div style={card}>
        <h1 style={title}>Gin Rummy</h1>
        {state.error && <p style={errorStyle}>{errorText[state.error]}</p>}

        <label style={label}>
          Display name
          <input
            style={input}
            value={name}
            maxLength={20}
            placeholder="Player"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <button
          type="button"
          style={primaryButton}
          onClick={() => onCreate(displayName)}
        >
          Create a new game
        </button>

        <div style={divider}>or join with a code</div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input
            style={{ ...input, textTransform: "uppercase", flex: 1 }}
            value={code}
            maxLength={6}
            placeholder="ABC123"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
          <button
            type="button"
            style={button}
            disabled={code.trim().length === 0}
            onClick={() => onJoin(code.trim(), displayName)}
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
}

const backdrop: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(0, 0, 0, 0.45)"
};

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.85rem",
  minWidth: "280px",
  maxWidth: "90vw",
  padding: "1.5rem",
  background: "rgba(20, 20, 20, 0.92)",
  color: "#fff",
  borderRadius: "12px",
  boxShadow: "0 12px 40px rgba(0, 0, 0, 0.4)",
  fontFamily: "system-ui, sans-serif"
};

const title: CSSProperties = {
  margin: 0,
  fontSize: "1.4rem",
  textAlign: "center"
};

const label: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  fontSize: "0.85rem"
};

const input: CSSProperties = {
  padding: "0.5rem 0.6rem",
  borderRadius: "6px",
  border: "1px solid #555",
  background: "#111",
  color: "#fff",
  fontSize: "1rem"
};

const button: CSSProperties = {
  padding: "0.5rem 0.9rem",
  borderRadius: "6px",
  border: "1px solid #666",
  background: "#2a2a2a",
  color: "#fff",
  fontSize: "0.95rem",
  cursor: "pointer"
};

const primaryButton: CSSProperties = {
  ...button,
  background: "#1d7a3a",
  border: "1px solid #1d7a3a",
  fontWeight: 600
};

const divider: CSSProperties = {
  textAlign: "center",
  opacity: 0.6,
  fontSize: "0.8rem"
};

const codeDisplay: CSSProperties = {
  fontSize: "2rem",
  fontWeight: 700,
  letterSpacing: "0.3rem",
  textAlign: "center",
  padding: "0.5rem",
  background: "#111",
  borderRadius: "8px",
  userSelect: "all"
};

const errorStyle: CSSProperties = {
  margin: 0,
  padding: "0.5rem 0.6rem",
  borderRadius: "6px",
  background: "rgba(150, 40, 40, 0.5)",
  fontSize: "0.85rem"
};
