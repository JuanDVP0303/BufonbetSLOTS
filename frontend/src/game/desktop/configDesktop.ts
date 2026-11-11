/**
 * CONFIG_DESKTOP — ÚNICO punto de ajuste del modo ESCRITORIO / horizontal.
 *
 * Todo número visual o estructural del layout horizontal vive aquí; el código
 * (layoutDesktop.ts, DesktopHud.ts, SlotScene) solo lee estas constantes. El modo
 * móvil (vertical) NO lee nada de este archivo (ver CONFIG_MOBILE).
 *
 * Unidades: "px de diseño". El área base es 1920x1080 (16:9) y Phaser la escala
 * con Scale.FIT + CENTER_BOTH. El ancho de diseño se adapta a la proporción real
 * del contenedor entre `aspect.min` y `aspect.max` (así 16:10, 21:9… no dejan
 * barras); fuera de ese rango, el letterbox lo cubre la capa de fondo DOM
 * (cover + viñeta, ver SlotGameCanvas/.slot-desktop-shade), nunca barras negras.
 */

// Misma familia tipográfica "cartoon bold" que móvil.
export { MOBILE_FONT as DESKTOP_FONT } from "../mobile/configMobile";

export const CONFIG_DESKTOP = {
  // ---- Área de diseño y adaptación a la proporción del contenedor --------
  design: {
    width: 1920,
    height: 1080,
    // Ventanas bajas (p. ej. 1280x600): el alto de diseño baja hasta `minHeight`
    // para que el HUD no quede diminuto. Se busca que la escala CSS final
    // (alto real / alto de diseño) no baje de `minUiScale`.
    minHeight: 900,
    minUiScale: 0.66,
    // Ancho mínimo de diseño (la barra de control necesita ~1300 + márgenes).
    minWidth: 1440,
  },
  aspect: {
    min: 4 / 3, // más angosto que esto: letterbox arriba/abajo
    max: 2.4, // más ancho que esto (32:9…): letterbox a los costados
  },
  // Contenedor con ancho/alto < este valor (ventana VERTICAL en un PC) → se usa
  // el diseño móvil (portrait) sin cambios. En dispositivos táctiles siempre es portrait.
  portraitBelowAspect: 1.0,
  // Proporción mínima (alto/ancho) del diseño móvil cuando se usa en una ventana
  // vertical de PC: por debajo, el diseño móvil se letterboxea a los costados.
  portraitMinHW: 1.6,

  // ---- Resolución interna (nitidez vs. coste) -----------------------------
  // El lienzo se renderiza a `escalaCSS × min(devicePixelRatio, maxDevicePixelRatio)`
  // (cámara con zoom), con tope de píxeles: así 1366x768 renderiza ~1366x768 (no
  // 1920x1080) y un 4K/retina no pasa de ~2560x1440.
  render: {
    maxDevicePixelRatio: 2,
    maxBackingPixels: 2560 * 1440,
    minScale: 0.5,
    // Histéresis: solo se reasigna el lienzo si la escala cambia más de este % (evita
    // realocar el buffer de WebGL por diferencias mínimas al redimensionar).
    minRelativeChange: 0.04,
  },
  resizeDebounceMs: 100,
  // Posición vertical (fracción) del HOME del header DOM en horizontal (la misma
  // que PlayPage usa por defecto). Ver evento "mobile-top-icon-y".
  headerIconYFrac: 0.06,

  // ---- Composición vertical ----------------------------------------------
  layout: {
    marginTop: 14,
    sideMargin: 32,
    gapFrameToHud: 40, // aire mínimo entre el borde visible del marco y el HUD
  },
  logo: {
    heightPct: 0.13, // alto de la caja del logo, % del alto de diseño
    maxWidthOfFrame: 0.42, // nunca más ancho que este % del marco
    maxWidth: 560,
    overlapPct: 0.2, // % de la caja del logo que se monta sobre el borde superior del marco
    floatPx: 6, // flotación suave (tween barato, solo transform)
    sheenEveryMs: 6500, // destello ocasional (sprite ADD, sin postFX)
  },
  grid: {
    heightPct: 0.58, // alto de las celdas, % del alto de diseño (pedido: 55-60%)
    maxWidthPct: 0.72, // ancho máximo del marco visible, % del ancho de diseño
    // Marco dibujado por código (temas sin grid_frame): margen alrededor de las celdas.
    panelPadPct: 0.16, // % del alto de celda
  },
  // Marco ilustrado (grid_frame): rectángulo de celdas y caja visible, en fracción
  // del lienzo del asset. Medidos sobre GRILL.png (1080x798) de Dulce Fiesta; sirven
  // para cualquier marco que siga ese formato del pack estándar de temas.
  gridFrame: {
    inner: { x0: 42 / 1080, y0: 112 / 798, x1: 1019 / 1080, y1: 653 / 798 },
    visible: { x0: 0 / 1080, y0: 65 / 798, x1: 1075 / 1080, y1: 699 / 798 },
  },
  frame: {
    // Panel por código (sin grid_frame): mismo lenguaje que móvil.
    fillTop: 0x241c6b,
    fillBottom: 0x140f3d,
    fillAlpha: 0.75,
    borderColor: 0xffd23f,
    borderWidthPx: 7,
    cornerRadiusPct: 0.22, // % del alto de celda
  },
  // Personajes decorativos a los lados del marco: solo si el tema trae la imagen
  // Y hay al menos `minWidth` libres. Nunca bajan del borde superior de la barra.
  characters: {
    minWidth: 220,
    maxWidth: 520,
    gapToFrame: 16,
    gapAboveBar: 18,
  },

  // ---- Banner "GANASTE" (premio normal) -----------------------------------
  winBanner: {
    height: 74,
    maxWidth: 620,
    labelSize: 24,
    valueSize: 46,
  },

  // ---- Barra de control (glass oscuro, centrada) --------------------------
  bar: {
    maxWidth: 1300,
    height: 108,
    marginBottom: 18,
    radius: 30,
    padX: 26,
    groupGap: 18, // separación mínima entre grupos izquierda/centro/derecha
    fillTop: 0x2b1150,
    fillBottom: 0x12062a,
    fillAlpha: 0.8,
    borderColor: 0xffffff,
    borderAlpha: 0.16,
    borderWidth: 2,
    highlightAlpha: 0.08,
    shadowAlpha: 0.28,
    // Iconos chicos (info, menú, sonido, turbo).
    iconSize: 58,
    iconGap: 12,
    // Autoplay y giro.
    autoSize: 80,
    spinRadius: 76,
    spinLift: 22, // el giro sube este tanto respecto al centro de la barra (sobresale arriba)
    spinGap: 16, // aire entre AUTO y el giro
    // Cajas de CRÉDITO / APUESTA / GANANCIA.
    boxHeight: 74,
    boxWidth: 180,
    betBoxWidth: 154,
    boxGap: 14,
    betBtnSize: 56,
    betBtnGap: 6,
    boxFill: 0x000000,
    boxFillAlpha: 0.32,
    boxBorderAlpha: 0.1,
    labelSize: 19,
    valueSize: 32,
  },
  hint: {
    text: "MANTÉN ESPACIO PARA TIRADA TURBO",
    size: 16,
    gapAboveBar: 14,
    alpha: 0.55,
  },

  // ---- Botones -----------------------------------------------------------
  buttons: {
    hoverScale: 1.05,
    pressScale: 0.95,
    tweenMs: 110,
    disabledAlpha: 0.4,
    // Estilo "candy" (botones sin imagen del tema): mismo lenguaje que los
    // botones reales del pack (cuadrado redondeado verde con borde claro).
    candyTop: 0x8ce562,
    candyBottom: 0x3c9f1e,
    candyOffTop: 0x6c9a52,
    candyOffBottom: 0x35602a,
    candyBorder: 0xeaf7e0,
    activeHaloColor: 0xfff36b, // halo de los toggles ACTIVOS (turbo/auto/sonido)
    activeHaloAlpha: 0.55,
    tooltipSize: 15,
  },
  spin: {
    glowAlphaMin: 0.28,
    glowAlphaMax: 0.62,
    glowPulseMs: 1400,
    glowScale: 2.3, // diámetro del resplandor respecto al radio×2
    busyAlpha: 0.6,
    busyRotateMs: 900,
  },

  // ---- Texto -------------------------------------------------------------
  text: {
    // Fuente bitmap generada en runtime para los números (crédito/apuesta/ganancia):
    // se hornea a `bakeSize` y se muestra más chica (nítida hasta zoom x2).
    bitmapFontKey: "hud-digits",
    bakeSize: 96,
    rollUpIntervalMs: 33, // throttle del conteo animado (~30 actualizaciones/s)
    goldTop: 0xfff3c4,
    goldBottom: 0xffb300,
  },

  // ---- Efectos (límites de rendimiento) ----------------------------------
  effects: {
    particleScale: 0.45, // fracción de las monedas/confeti del nivel de premio
    maxCoins: 90,
    maxConfetti: 100,
    raysTextureSize: 1024,
    raysAlpha: 0.26,
  },

  fullscreen: {
    enabled: true,
    keyCode: "F",
  },

  // Profundidades (de atrás hacia adelante).
  depth: {
    background: -100,
    characters: -20,
    frame: -5,
    reels: 0,
    winLines: 5,
    logo: 8,
    effects: 20,
    hud: 30,
    winBanner: 40,
    overlays: 100,
  },
} as const;
