import type { Action, Seat } from "./engine/game.ts";
import type { GameStore } from "./store.ts";
import type {
  Contract,
  ErrorReason,
  Stamped,
  WireMessage
} from "./protocol.ts";

// The production transport: a WebSocket to the relay Lambda, which is the
// sequencer. Compared with the loopback this is *simpler* — the client never
// stamps. It submits actions and applies only the server's stamped echoes, in
// order, deduplicating by seq and asking for a resync on a gap (the same
// `inbox`/`applyContract` discipline the loopback uses). On top of the game
// relay it drives the lobby handshake (create / join / reconnect) and reports
// its progress through `onEvent`.

// Where lobby progress and connection state are reported to the UI.
export type LobbyEvent =
  | { type: "connection"; status: "connecting" | "open" | "closed" }
  | { type: "created"; code: string } // room made; waiting for an opponent
  | { type: "started" } // the hand contract has been applied; play begins
  | { type: "error"; reason: ErrorReason };

export interface RelayTransport {
  create(name: string): void;
  join(code: string, name: string): void;
  reconnect(code: string, token: string, seat: Seat): void;
  submit(action: Action): void;
  destroy(): void;
}

// The reconnection credentials, kept in sessionStorage so a refresh silently
// rejoins the same seat. Cleared when the room is gone or the token is stale.
export interface Session {
  readonly code: string;
  readonly token: string;
  readonly seat: Seat;
}

const SESSION_KEY = "gin-rummy-session";

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed.code &&
      parsed.token &&
      (parsed.seat === "a" || parsed.seat === "b")
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function saveSession(session: Session): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // A private-mode storage failure just means no auto-reconnect; play on.
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function defaultRelayUrl(): string {
  return import.meta.env.VITE_WS_URL ?? "ws://localhost:8787";
}

const randomUint32 = () => Math.floor(Math.random() * 0x100000000) >>> 0;

export function createRelayTransport(options: {
  store: GameStore;
  onEvent: (event: LobbyEvent) => void;
  url?: string;
}): RelayTransport {
  const { store, onEvent } = options;
  const socket = new WebSocket(options.url ?? defaultRelayUrl());

  let mySeat: Seat | null = null;
  let pendingCode: string | null = null; // the code a join/reconnect used
  let expectedSeq = 1;
  let contractApplied = false;
  const outbox: WireMessage[] = [];

  const send = (message: WireMessage) => {
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify(message));
    else outbox.push(message);
  };

  const applyContract = (contract: Contract) => {
    store.start({
      seed: contract.seed,
      dealer: contract.dealer,
      viewerSeat: mySeat ?? "a",
      names: contract.names
    });
    expectedSeq = 1;
    contractApplied = true;
    onEvent({ type: "started" });
  };

  const inbox = (stamped: Stamped) => {
    // A stamp outrunning the bootstrap is a gap by another name: ask for the
    // full picture rather than applying into a store with no game.
    if (!contractApplied) {
      send({ kind: "resyncRequest" });
      return;
    }
    if (stamped.seq < expectedSeq) return; // an echo we already applied
    if (stamped.seq > expectedSeq) {
      send({ kind: "resyncRequest" });
      return;
    }
    store.apply(stamped.action);
    expectedSeq = stamped.seq + 1;
  };

  const onMessage = (event: MessageEvent) => {
    let message: WireMessage;
    try {
      message = JSON.parse(event.data as string) as WireMessage;
    } catch {
      return;
    }
    switch (message.kind) {
      case "created":
        saveSession({ code: message.code, token: message.token, seat: "a" });
        onEvent({ type: "created", code: message.code });
        break;
      case "joined":
        if (pendingCode)
          saveSession({ code: pendingCode, token: message.token, seat: "b" });
        break;
      case "start":
        applyContract(message);
        break;
      case "action":
        inbox({ seq: message.seq, action: message.action });
        break;
      case "resync":
        applyContract(message);
        for (const stamped of message.log) inbox(stamped);
        break;
      case "error":
        if (message.reason === "badToken" || message.reason === "badCode")
          clearSession();
        onEvent({ type: "error", reason: message.reason });
        break;
    }
  };

  socket.addEventListener("message", onMessage);
  socket.addEventListener("open", () => {
    onEvent({ type: "connection", status: "open" });
    for (const message of outbox.splice(0))
      socket.send(JSON.stringify(message));
  });
  socket.addEventListener("close", () =>
    onEvent({ type: "connection", status: "closed" })
  );
  onEvent({ type: "connection", status: "connecting" });

  return {
    create(name) {
      mySeat = "a";
      send({ kind: "create", name, rnd: randomUint32() });
    },
    join(code, name) {
      mySeat = "b";
      pendingCode = code;
      send({ kind: "join", code, name, rnd: randomUint32() });
    },
    reconnect(code, token, seat) {
      mySeat = seat;
      pendingCode = code;
      send({ kind: "reconnect", code, token });
    },
    submit(action) {
      // Clients never apply their own actions: the server stamps and echoes.
      send({ kind: "submit", action });
    },
    destroy() {
      socket.removeEventListener("message", onMessage);
      socket.close();
    }
  };
}
