/// <reference types="vite/client" />

interface ImportMetaEnv {
  // The relay's WebSocket URL, injected at build time (CI) and falling back to
  // the local dev harness. See clients/web/src/relayTransport.ts.
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
