import Phaser from "phaser";
import { PreloadScene } from "./scenes/PreloadScene";
import { SlotScene } from "./scenes/SlotScene";
import type { SpinResponse } from "../api/spinApi";
import type { Theme } from "../api/play";

/**
 * Config de runtime que React inyecta en Phaser. El juego NO conoce la API:
 * recibe una función `spin`, un callback de saldo y el `theme` (assets + colores)
 * del casino que se está jugando.
 */
export interface RuntimeConfig {
  betAmount: number;
  spin: (betAmount: number) => Promise<SpinResponse>;
  onBalance?: (balance: number) => void;
  theme?: Theme;
  grid?: { cols: number; rows: number };
  balance?: number;
  currency?: string;
  currencySymbol?: string;
  currencyExponent?: number;
  betLevels?: number[];
  betMin?: number;
  betMax?: number;
}

export function makeGameConfig(
  parent: HTMLElement,
  runtime: RuntimeConfig
): Phaser.Types.Core.GameConfig {
  // Fondo ANIMADO (video o GIF): el canvas se hace TRANSPARENTE y el medio se pinta
  // como elemento HTML DETRÁS (más fiable que dentro de Phaser). Los GIF se cargan
  // como <img> (animan nativos); los estáticos siguen dibujándose dentro de Phaser.
  const a = runtime.theme?.assets;
  const bgType = runtime.theme?.background_type;
  const isGif = bgType === "IMAGE" && !!a?.background && a.background.toLowerCase().endsWith(".gif");
  const isVideo = bgType === "VIDEO" && !!a?.background_video;
  const domBg = isGif || isVideo;

  return {
    type: Phaser.AUTO,
    parent,
    transparent: domBg,
    backgroundColor: runtime.theme?.background_color ?? "#0b0f1a",
    // RESIZE: el lienzo ocupa TODO el contenedor (pantalla completa en PC y móvil).
    // La escena recalcula su layout a partir del tamaño real (this.scale).
    scale: {
      mode: Phaser.Scale.RESIZE,
      width: "100%",
      height: "100%",
    },
    render: { antialias: true, roundPixels: true },
    scene: [PreloadScene, SlotScene],
    callbacks: {
      preBoot: (game) => game.registry.set("runtime", runtime),
    },
  };
}
