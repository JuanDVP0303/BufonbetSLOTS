/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_GAME_SESSION?: string;
  readonly VITE_BET_AMOUNT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
