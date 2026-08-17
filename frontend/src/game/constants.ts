// Diseño mobile-first, vertical (9:16). Phaser escala con Scale.FIT a la pantalla.
export const DESIGN_WIDTH = 540;
export const DESIGN_HEIGHT = 960;

export const REELS = 3; // columnas
export const ROWS = 3; // filas visibles
export const SYMBOL_SIZE = 150; // px en coordenadas de diseño

// Área de la rejilla, centrada horizontalmente y ubicada en la mitad superior.
export const GRID_WIDTH = REELS * SYMBOL_SIZE; // 450
export const GRID_X = (DESIGN_WIDTH - GRID_WIDTH) / 2; // 45
export const GRID_Y = 170;

// Símbolos: etiqueta visible y color. (Placeholder generado en runtime; sustituir
// por spritesheets reales en PreloadScene cuando existan los assets de arte.)
export const SYMBOLS = ["WILD", "A", "K", "Q", "J", "T"] as const;
export type SymbolKey = (typeof SYMBOLS)[number];

export const SYMBOL_LABEL: Record<string, string> = {
  WILD: "★",
  A: "A",
  K: "K",
  Q: "Q",
  J: "J",
  T: "10",
};

export const SYMBOL_COLOR: Record<string, number> = {
  WILD: 0xffd23f, // dorado
  A: 0xef476f, // rojo
  K: 0x9b5de5, // morado
  Q: 0x00bbf9, // azul
  J: 0x06d6a0, // verde
  T: 0x8d99ae, // gris
};

// Las 5 líneas de pago del 3x3 (fila por columna) — deben coincidir con el backend.
export const PAYLINES: number[][] = [
  [0, 0, 0], // superior
  [1, 1, 1], // central
  [2, 2, 2], // inferior
  [0, 1, 2], // diagonal ↘
  [2, 1, 0], // diagonal ↗
];

// Umbral de "Big Win": ganancia >= BIG_WIN_MULTIPLIER x apuesta.
export const BIG_WIN_MULTIPLIER = 15;

// Textura keys generadas y del chrome del casino (cargadas en PreloadScene).
export const TEX = {
  cell: "tex-cell",
  coin: "tex-coin",
  confetti: "tex-confetti",
  button: "tex-button",
  cellFrame: "tex-cell-frame",
  // Chrome del tema (imágenes subidas por el master).
  bg: "tex-bg",
  bgVideo: "vid-bg",
  logo: "tex-logo",
  prizeBanner: "tex-prize-banner",
  spinBtn: "tex-spin-btn",
  musicOn: "tex-music-on",
  musicOff: "tex-music-off",
  musicTrack: "audio-music",
  turboOn: "tex-turbo-on",
  turboOff: "tex-turbo-off",
  autoOn: "tex-auto-on",
  autoOff: "tex-auto-off",
  betPlus: "tex-bet-plus",
  betMinus: "tex-bet-minus",
} as const;
