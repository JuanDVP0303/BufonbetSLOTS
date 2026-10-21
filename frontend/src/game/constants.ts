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

// Umbrales de victoria grande: ganancia >= nivel x apuesta. BIG_WIN_MULTIPLIER se
// mantiene para no romper imports existentes (equivale a WIN_TIERS.big).
export const WIN_TIERS = { big: 15, mega: 30, epic: 60 } as const;
export type WinTier = "big" | "mega" | "epic" | "jackpot";
export const BIG_WIN_MULTIPLIER = WIN_TIERS.big;

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
  infoBtn: "tex-info-btn",
  // Animación/imagen del premio grande. Si es GIF se decodifica cuadro a cuadro
  // (ver game/gifMascot.ts) y esta clave no se usa; si es imagen estática, se carga
  // normal y se dibuja tal cual con la misma profundidad.
  jackpotMascot: "tex-jackpot-mascot",
  // Generadas en runtime (sin arte del tema): resplandor y destello para pulsos
  // de símbolos ganadores, idle y partículas ambientales.
  glow: "tex-glow",
  sparkle: "tex-sparkle",
  // Paneles/banners decorativos opcionales (si faltan, esa zona se ve como siempre).
  footerBanner: "tex-footer-banner",
  topbarBanner: "tex-topbar-banner",
  balanceBanner: "tex-balance-banner",
  betBanner: "tex-bet-banner",
  loadingImage: "tex-loading-image",
  // Igual que jackpotMascot: si es GIF se decodifica cuadro a cuadro (gifMascot.ts)
  // y esta clave no se usa; si es imagen estática, se carga normal.
  reelEffect: "tex-reel-effect",
  // Marco/fondo ilustrado de la rejilla (incluye las celdas dibujadas). Si existe,
  // sustituye el panel+borde genéricos de drawPanel() — ver ahí cómo se encaja.
  gridFrame: "tex-grid-frame",
  // Totalmente transparente (nada dibujado): zona táctil invisible para
  // botones del HUD móvil (Fase 3) dibujados con Graphics en vez de imagen.
  transparentPixel: "tex-transparent-px",
} as const;
