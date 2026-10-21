import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { SlotScene } from "./scenes/SlotScene";
import { CONFIG_MOBILE, isMobileDeviceClass } from "./mobile/configMobile";
import type { SpinResponse } from "../api/spinApi";
import type { Theme } from "../api/play";

/**
 * CORRECCIÓN 7: altura de diseño móvil AJUSTADA a la proporción real del
 * contenedor, en vez de la fija 1920 (proporción 1080:1920 = 0.5625).
 *
 * Con una altura fija, Scale.FIT solo puede evitar las barras negras si el
 * dispositivo tiene EXACTAMENTE esa proporción — la mayoría de los teléfonos
 * no la tienen (un iPhone grande ronda 0.46), así que el lienzo quedaba
 * "letterboxeado": más chico que la pantalla real, centrado, dejando franjas
 * arriba/abajo que NINGÚN elemento dibujado por Phaser podía alcanzar sin
 * importar cuánto se intentara estirar el HUD en coordenadas de diseño — la
 * causa raíz de buena parte de los huecos reportados en las Correcciones 5 y
 * 6 (incluido el "~100px vacíos bajo los iconos").
 *
 * Calculando la altura para que el lienzo tenga la MISMA proporción que el
 * contenedor real, Scale.FIT nunca necesita dejar barras: el ancho de diseño
 * sigue fijo en 1080 (todo lo demás en CONFIG_MOBILE/computeLayoutMobile ya
 * está expresado como % de `W`/`H`, así que no depende de que `H` sea 1920
 * exactas — ver designScaleFactor(), que solo usa `design.width`).
 */
function mobileDesignHeight(parent: HTMLElement): number {
  const w = parent.clientWidth || window.innerWidth;
  const h = parent.clientHeight || window.innerHeight;
  if (!w || !h) return CONFIG_MOBILE.design.height;
  return Math.round(CONFIG_MOBILE.design.width * (h / w));
}

/**
 * Config de runtime que React inyecta en Phaser. El juego NO conoce la API:
 * recibe una función `spin`, un callback de saldo y el `theme` (assets + colores)
 * del casino que se está jugando.
 */
export interface RuntimeConfig {
  betAmount: number;
  spin: (betAmount: number) => Promise<SpinResponse>;
  onBalance?: (balance: number) => void;
  // Devuelve true si React "manejó" el error (p. ej. mostró un modal de saldo):
  // en ese caso la escena NO muestra su mensaje rojo genérico.
  onSpinError?: (err: unknown) => boolean;
  // Abre el modal de combinaciones ganadoras (React): el botón "i" vive DENTRO
  // del footer de Phaser junto a AUTO/TURBO, pero el modal en sí es DOM.
  onShowPaytable?: () => void;
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
  runtime: RuntimeConfig,
  // DESKTOP (Fase 1): elemento que entra en pantalla completa al activarla
  // (ver SlotScene.toggleDesktopFullscreen). Por defecto sería solo el
  // <canvas> — pasando el wrapper completo (.slot-canvas-wrap), el aviso de
  // "gira tu teléfono" y cualquier capa DOM futura entran con él. Sin uso en
  // móvil (no hay botón de pantalla completa ahí).
  fullscreenTarget?: HTMLElement
): Phaser.Types.Core.GameConfig {
  // Fondo ANIMADO (video o GIF): el canvas se hace TRANSPARENTE y el medio se pinta
  // como elemento HTML DETRÁS (más fiable que dentro de Phaser). Los GIF se cargan
  // como <img> (animan nativos); los estáticos siguen dibujándose dentro de Phaser.
  const a = runtime.theme?.assets;
  const bgType = runtime.theme?.background_type;
  const isGif = bgType === "IMAGE" && !!a?.background && a.background.toLowerCase().endsWith(".gif");
  const isVideo = bgType === "VIDEO" && !!a?.background_video;

  // MÓVIL (pantalla táctil, ver isMobileDeviceClass): rama de configuración
  // completamente aparte de ESCRITORIO, que sigue exactamente igual que antes
  // (Scale.RESIZE al 100% del contenedor). El móvil usa Scale.FIT + autoCenter
  // sobre una resolución de diseño de ANCHO fijo (1080) pero ALTO ajustado a
  // la proporción REAL del contenedor (ver `mobileDesignHeight` abajo) — el
  // fondo del tema se pinta SIEMPRE como capa HTML detrás (full-bleed, cover)
  // para que no se vean barras negras en los márgenes del FIT — ver
  // SlotGameCanvas.tsx. Por eso el canvas es transparent:true siempre en móvil,
  // no solo para GIF/video como en escritorio.
  const isMobile = isMobileDeviceClass();

  return {
    type: Phaser.AUTO,
    parent,
    transparent: isMobile ? true : isGif || isVideo,
    backgroundColor: runtime.theme?.background_color ?? "#0b0f1a",
    scale: isMobile
      ? {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
          width: CONFIG_MOBILE.design.width,
          height: mobileDesignHeight(parent),
        }
      : {
          // RESIZE: el lienzo ocupa TODO el contenedor (pantalla completa en PC).
          // La escena recalcula su layout a partir del tamaño real (this.scale).
          mode: Phaser.Scale.RESIZE,
          width: "100%",
          height: "100%",
          // DESKTOP (Fase 1): al entrar en pantalla completa, el elemento que
          // la toma es el WRAPPER (ver nota del parámetro arriba), no el
          // <canvas> solo.
          fullscreenTarget: fullscreenTarget ?? parent,
        },
    render: { antialias: true, roundPixels: true },
    scene: [BootScene, PreloadScene, SlotScene],
    callbacks: {
      preBoot: (game) => {
        game.registry.set("runtime", runtime);
        game.registry.set("isMobile", isMobile);
      },
    },
  };
}
