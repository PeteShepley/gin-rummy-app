import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { TableCanvas } from "./TableCanvas.tsx";
import { createGameStore } from "./store.ts";
import { createLoopbackTransport } from "./loopback.ts";
import type { LoopbackTransport } from "./loopback.ts";
import { createRelayTransport, loadSession } from "./relayTransport.ts";
import type { LobbyEvent, RelayTransport } from "./relayTransport.ts";
import { Lobby } from "./Lobby.tsx";
import type { LobbyUiState } from "./Lobby.tsx";
import { Feed } from "./Feed.tsx";
import { Hud, Nameplate, WinBanner } from "./Hud.tsx";
import { hudButton, hudPrimaryButton } from "./hudStyles.ts";
import { legalActions, otherSeat } from "./engine/game.ts";
import { ginDiscards } from "./engine/melds.ts";
import { cardKey, sameCard } from "./engine/cards.ts";
import type { TableMetrics } from "./layout.ts";
import type { Action, Seat } from "./engine/game.ts";
import type { Card } from "./engine/cards.ts";

// The default (no query param) is networked play: a lobby that creates or
// joins a room over the WebSocket relay. The dev shortcuts survive: ?seat=a
// is the loopback creating tab (sequencer shim), ?seat=b joins it over the
// BroadcastChannel, ?solo is the single-tab hotseat harness. In every
// networked mode the store only ever applies stamped actions.
const params = new URLSearchParams(window.location.search);
const mode: "solo" | "creator" | "joiner" | "relay" =
  params.get("seat") === "a"
    ? "creator"
    : params.get("seat") === "b"
      ? "joiner"
      : params.has("solo")
        ? "solo"
        : "relay";

const store = createGameStore();
let loopback: LoopbackTransport | null = null;
let staticSubmit: ((action: Action) => void) | null = null;
if (mode === "solo") {
  // The hotseat follows whoever is acting, so both seats are "you" in turn;
  // neutral labels are the honest ones now that the nameplates always show.
  store.start({
    seed: Date.now() >>> 0,
    dealer: "a",
    viewerSeat: "a",
    names: { a: "Player A", b: "Player B" }
  });
  staticSubmit = (action) => store.apply(action);
} else if (mode === "creator" || mode === "joiner") {
  loopback = createLoopbackTransport({
    role: mode,
    store,
    seed: Date.now() >>> 0
  });
  staticSubmit = (action) => loopback!.submit(action);
}

// This top-level bootstrap re-runs on any hot update that reaches this
// module; a second live transport would corrupt the room. Dispose the old
// one and reload outright.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    window.location.reload();
  });
  import.meta.hot.dispose(() => {
    loopback?.destroy();
  });
}

// The table + overlay, shared by every mode. `follow` decides whose seat is
// rendered face-up: the hotseat follows the acting seat; networked modes fix
// the view to the viewer's own seat. Seat names come from the hand contract.
interface GameViewProps {
  submit: (action: Action) => void;
  follow: "acting" | "viewer";
  noGameText: string;
  banner?: React.ReactNode;
}

function GameView({ submit, follow, noGameText, banner }: GameViewProps) {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Where the Pixi table put things. Pixi's resizeTo stays the single resize
  // owner; the scene reports its geometry so the DOM chrome can line up with
  // the piles and the card rows instead of guessing.
  const [metrics, setMetrics] = useState<TableMetrics | null>(null);
  const game = snapshot.game;
  const soloFallback: Seat =
    game?.result?.type === "gin" ? game.result.winner : (game?.dealer ?? "a");
  const seatToPlay: Seat =
    follow === "acting"
      ? (game?.toAct ?? soloFallback)
      : (snapshot.viewerSeat ?? "a");
  const legal = game ? legalActions(game, seatToPlay) : [];
  const selected = snapshot.selectedCard;

  const ginKeys: ReadonlySet<string> = new Set(
    game && game.phase === "discard" && game.toAct === seatToPlay
      ? ginDiscards(game.hands[seatToPlay]).map(cardKey)
      : []
  );
  const discardBlocked =
    selected && game?.takenFromDiscard
      ? sameCard(selected, game.takenFromDiscard)
      : false;

  const submitDiscard = (declareGin: boolean) => {
    if (selected)
      submit({ type: "discard", seat: seatToPlay, card: selected, declareGin });
  };

  const handlers = {
    onCardClick: (clicked: Card) => {
      const held =
        game?.hands[seatToPlay].some((own) => sameCard(own, clicked)) ?? false;
      if (!held) return;
      store.selectCard(
        selected && sameCard(clicked, selected) ? null : clicked
      );
    },
    onStockClick: () => {
      if (legal.includes("drawStock"))
        submit({ type: "drawStock", seat: seatToPlay });
    },
    // An undeclared discard of a gin card is a legitimate plain discard: no
    // explicit declaration, no gin (user ruling, per the rules).
    onDiscardPileClick: () => {
      if (legal.includes("takeUpcard"))
        submit({ type: "takeUpcard", seat: seatToPlay });
      else if (legal.includes("drawDiscard"))
        submit({ type: "drawDiscard", seat: seatToPlay });
      else if (legal.includes("discard") && selected && !discardBlocked)
        submitDiscard(false);
    },
    // A finished drag. This is presentation state only: it never becomes an
    // action, so the two clients may hold the same hand in different orders.
    onHandReorder: (keys: readonly string[]) =>
      store.setHandOrder(seatToPlay, keys),
    onMetrics: setMetrics
  };

  const opponent = otherSeat(seatToPlay);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <TableCanvas
        snapshot={snapshot}
        perspective={seatToPlay}
        ginKeys={ginKeys}
        handlers={handlers}
      />
      <Feed entries={snapshot.feed} metrics={metrics} />
      {game && (
        <Nameplate
          name={snapshot.names[opponent]}
          active={game.toAct === opponent}
          style={{
            top: metrics
              ? `${metrics.opponentY + metrics.cardH / 2 + 8}px`
              : "9rem"
          }}
        />
      )}
      {game?.result && (
        <WinBanner
          result={game.result}
          names={snapshot.names}
          perspective={seatToPlay}
          metrics={metrics}
        />
      )}
      {banner}
      <Hud
        game={game}
        names={snapshot.names}
        perspective={seatToPlay}
        metrics={metrics}
        noGameText={noGameText}
      >
        {legal.includes("startHand") && (
          <button
            type="button"
            style={hudPrimaryButton}
            onClick={() => submit({ type: "startHand" })}
          >
            Deal
          </button>
        )}
        {legal.includes("takeUpcard") && (
          <button
            type="button"
            style={hudButton}
            onClick={() => submit({ type: "takeUpcard", seat: seatToPlay })}
          >
            Take upcard
          </button>
        )}
        {legal.includes("passUpcard") && (
          <button
            type="button"
            style={hudButton}
            onClick={() => submit({ type: "passUpcard", seat: seatToPlay })}
          >
            Pass
          </button>
        )}
        {legal.includes("discard") && selected && !discardBlocked && (
          <button
            type="button"
            style={hudButton}
            onClick={() => submitDiscard(false)}
          >
            Discard selected
          </button>
        )}
        {selected && ginKeys.has(cardKey(selected)) && (
          <button
            type="button"
            style={hudPrimaryButton}
            onClick={() => submitDiscard(true)}
          >
            Declare gin!
          </button>
        )}
        {/* Auto-sort and dragging cannot both own the layout, so this is a
            one-shot: it re-groups the hand and any later drag takes it back. */}
        {game &&
          game.phase !== "handOver" &&
          game.phase !== "awaitingStart" && (
            <button
              type="button"
              style={hudButton}
              onClick={() => store.autoSort(seatToPlay)}
              title="arrange the hand into melds — drag a card to take over"
            >
              Auto-sort
            </button>
          )}
        {legal.includes("discard") && selected && discardBlocked && (
          <span style={hint}>
            the card you just took cannot go straight back
          </span>
        )}
        {ginKeys.size > 0 && !(selected && ginKeys.has(cardKey(selected))) && (
          <span style={hint}>gin available — select a gold card</span>
        )}
      </Hud>
    </div>
  );
}

// How many times a dropped socket retries before it gives up and asks the
// player to do something about it.
const MAX_RETRIES = 4;

// Networked play: owns the relay transport and the lobby state machine. The
// transport is created on a Create/Join click (or an auto-reconnect on load),
// never in a render, so React StrictMode's double effects can't open two
// sockets. Once the hand contract arrives the store has a game and the table
// takes over from the lobby.
function RelayApp() {
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [lobbyState, setLobbyState] = useState<LobbyUiState>({ phase: "menu" });
  const [link, setLink] = useState<"open" | "retrying" | "lost">("open");
  const transportRef = useRef<RelayTransport | null>(null);
  const retryRef = useRef<{ attempts: number; timer: number | null }>({
    attempts: 0,
    timer: null
  });

  // The transport reports a dropped socket but never retries by itself, so
  // the retry lives here: a fresh transport replaying the stored session,
  // backing off, then handing the decision to the player.
  const reconnectSoon = () => {
    const session = loadSession();
    if (!session || retryRef.current.attempts >= MAX_RETRIES) {
      setLink(session ? "lost" : "open");
      return;
    }
    const attempt = retryRef.current.attempts++;
    setLink("retrying");
    retryRef.current.timer = window.setTimeout(
      () => {
        transportRef.current?.destroy();
        transportRef.current = null;
        ensureTransport().reconnect(session.code, session.token, session.seat);
      },
      Math.min(8000, 1000 * 2 ** attempt)
    );
  };

  const handleEvent = (event: LobbyEvent) => {
    switch (event.type) {
      case "created":
        setLobbyState({ phase: "waiting", code: event.code });
        break;
      case "error":
        transportRef.current?.destroy();
        transportRef.current = null;
        setLobbyState({ phase: "menu", error: event.reason });
        break;
      case "connection":
        if (event.status === "open") {
          retryRef.current.attempts = 0;
          setLink("open");
        } else if (event.status === "closed") {
          reconnectSoon();
        }
        break;
      case "started":
        // `started` shows up as a non-null store game (the table renders).
        break;
    }
  };

  const ensureTransport = (): RelayTransport => {
    if (!transportRef.current) {
      transportRef.current = createRelayTransport({
        store,
        onEvent: handleEvent
      });
    }
    return transportRef.current;
  };

  const retryNow = () => {
    retryRef.current.attempts = 0;
    reconnectSoon();
  };

  useEffect(() => {
    // The retry bookkeeping is mutated in place, never reassigned, so it is
    // safe to capture here for the cleanup to cancel a pending attempt.
    const retry = retryRef.current;
    const session = loadSession();
    if (session) {
      ensureTransport().reconnect(session.code, session.token, session.seat);
      setLobbyState({ phase: "connecting" });
    }
    return () => {
      if (retry.timer !== null) window.clearTimeout(retry.timer);
      retry.timer = null;
      transportRef.current?.destroy();
      transportRef.current = null;
    };
  }, []);

  if (snapshot.game) {
    return (
      <GameView
        submit={(action) => transportRef.current?.submit(action)}
        follow="viewer"
        noGameText="connecting…"
        banner={
          link !== "open" && (
            <div style={linkBanner}>
              {link === "retrying" ? (
                <span>Reconnecting…</span>
              ) : (
                <>
                  <span>Disconnected</span>
                  <button type="button" style={hudButton} onClick={retryNow}>
                    Reconnect
                  </button>
                </>
              )}
            </div>
          )
        }
      />
    );
  }

  return (
    <Lobby
      state={lobbyState}
      onCreate={(name) => {
        ensureTransport().create(name);
        setLobbyState({ phase: "connecting" });
      }}
      onJoin={(code, name) => {
        ensureTransport().join(code, name);
        setLobbyState({ phase: "connecting" });
      }}
    />
  );
}

function App() {
  if (mode === "relay") return <RelayApp />;
  if (mode === "solo") {
    return (
      <GameView submit={staticSubmit!} follow="acting" noGameText="no game" />
    );
  }
  // Loopback creator/joiner: fixed to one seat over the BroadcastChannel.
  return (
    <GameView
      submit={staticSubmit!}
      follow="viewer"
      noGameText={
        mode === "joiner"
          ? "waiting for the creating tab (open ?seat=a)"
          : "no game"
      }
    />
  );
}

const hint: CSSProperties = { opacity: 0.7, alignSelf: "center" };

const linkBanner: CSSProperties = {
  position: "absolute",
  top: "0.6rem",
  right: "0.6rem",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  padding: "0.35rem 0.7rem",
  background: "rgba(120, 30, 30, 0.85)",
  color: "#fff",
  borderRadius: "8px",
  fontFamily: "system-ui, sans-serif",
  fontSize: "0.8rem"
};

export default App;
