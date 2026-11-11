import Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { PreloadScene } from "./scenes/PreloadScene";
import { SlotScene } from "./scenes/SlotScene";
import { CONFIG_MOBILE, isMobileDeviceClass } from "./mobile/configMobile";
import { chooseLayoutMode, desktopDesignSize, desktopRenderScale, portraitDesignSize } from "./desktop/layoutDesktop";
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
  // Elemento que entra en pantalla completa (el wrapper completo, no solo el
  // <canvas>: así entran también las capas DOM de fondo). Sin uso en táctil.
  fullscreenTarget?: HTMLElement
): Phaser.Types.Core.GameConfig {
  // Clase de DISPOSITIVO (táctil y lado chico <= 820px): no cambia en la sesión.
  const isTouchDevice = isMobileDeviceClass();
  const pw = parent.clientWidth || window.innerWidth;
  const ph = parent.clientHeight || window.innerHeight;
  // Sistema de layout por orientación (ver desktop/layoutDesktop.ts): en táctil
  // SIEMPRE "portrait" (diseño móvil); en PC, "portrait" solo si ancho/alto < 1.2.
  const layoutMode = chooseLayoutMode(pw, ph, isTouchDevice);

  const callbacks: Phaser.Types.Core.CallbacksConfig = {
    preBoot: (game) => {
      game.registry.set("runtime", runtime);
      game.registry.set("isMobile", layoutMode === "portrait");
      game.registry.set("isTouchDevice", isTouchDevice);
      game.registry.set("layoutMode", layoutMode);
    },
  };

  if (isTouchDevice) {
    // ===== MÓVIL (táctil): configuración idéntica a la de siempre. =====
    // Scale.FIT + autoCenter sobre 1080 de ancho y alto ajustado a la proporción
    // REAL del contenedor (ver mobileDesignHeight). El fondo del tema lo pinta la
    // capa HTML detrás (cover) → canvas transparente.
    return {
      type: Phaser.AUTO,
      parent,
      transparent: true,
      backgroundColor: runtime.theme?.background_color ?? "#0b0f1a",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: CONFIG_MOBILE.design.width,
        height: mobileDesignHeight(parent),
      },
      render: { antialias: true, roundPixels: true },
      scene: [BootScene, PreloadScene, SlotScene],
      callbacks,
    };
  }

  // ===== ESCRITORIO (no táctil) =====
  // Canvas OPACO: el fondo se dibuja dentro de Phaser (una imagen "cover", sin FX)
  // y el navegador no tiene que mezclar el canvas con capas de debajo en cada
  // frame. Solo un fondo ANIMADO (GIF/video, que es DOM) necesita transparencia.
  const a = runtime.theme?.assets;
  const bgUrl = a?.background_desktop || a?.background;
  const animatedBg =
    (runtime.theme?.background_type === "IMAGE" && !!bgUrl && bgUrl.toLowerCase().endsWith(".gif")) ||
    (runtime.theme?.background_type === "VIDEO" && !!a?.background_video);
  // El lienzo LLENA el contenedor de borde a borde (sin letterbox ni márgenes): el
  // espacio de layout es el tamaño CSS real del contenedor (desktopDesignSize) y,
  // con Scale.FIT sobre esa misma proporción, el resultado es el de Scale.RESIZE…
  // pero con resolución INTERNA propia: backing = CSS × min(DPR, 2), con tope de
  // píxeles (desktopRenderScale). La escena compensa con zoom de cámara, así que el
  // layout siempre se expresa en px CSS. Cada resize (debounce) recalcula ambos.
  let width: number;
  let height: number;
  if (layoutMode === "portrait") {
    ({ width, height } = portraitDesignSize(pw, ph));
  } else {
    const design = desktopDesignSize(pw, ph);
    const k = desktopRenderScale(design, pw, ph, window.devicePixelRatio);
    width = Math.round(design.width * k);
    height = Math.round(design.height * k);
    const preBoot = callbacks.preBoot!;
    callbacks.preBoot = (game) => {
      preBoot(game);
      game.registry.set("desktopDesign", design);
    };
  }

  return {
    type: Phaser.AUTO,
    parent,
    transparent: animatedBg,
    backgroundColor: runtime.theme?.background_color ?? "#0b0f1a",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width,
      height,
      autoRound: true,
      fullscreenTarget: fullscreenTarget ?? parent,
    },
    render: {
      antialias: true, // los símbolos/arte se escalan: filtrado lineal necesario
      roundPixels: true,
      powerPreference: "high-performance",
      // Sin postFX/preFX en escritorio: no hace falta el pipeline de FX "pesado".
      // autoMobilePipeline solo aplica en iOS/Android (este camino es no táctil).
      autoMobilePipeline: true,
    },
    fps: { target: 60, smoothStep: true },
    // Sin física (no se carga Arcade/Matter: no hay `physics` en la config) ni gamepad.
    input: { gamepad: false, touch: true, mouse: true, keyboard: true },
    disableContextMenu: true,
    banner: false,
    scene: [BootScene, PreloadScene, SlotScene],
    callbacks,
  };
}
