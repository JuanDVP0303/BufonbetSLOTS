/**
 * CONFIG_DESKTOP — ÚNICO punto de ajuste del modo ESCRITORIO / horizontal.
 *
 * Todo número visual o estructural del layout horizontal vive aquí; el código
 * (layoutDesktop.ts, DesktopHud.ts, SlotScene) solo lee estas constantes. El modo
 * móvil (vertical) NO lee nada de este archivo (ver CONFIG_MOBILE).
 *
 * Unidades: el espacio de layout horizontal es el TAMAÑO CSS REAL del contenedor
 * (W x H en px CSS): el lienzo lo llena de borde a borde, sin letterbox. Casi todo
 * se expresa como fracción de W, de H, de la altura de controles (`controls`) o
 * del alto de celda, así que el juego se ve igual en 1366x768 que en 2560x1440.
 * La nitidez la da la resolución interna (render), independiente del layout.
 */

// Misma familia tipográfica "cartoon bold" que móvil.
export { MOBILE_FONT as DESKTOP_FONT } from "../mobile/configMobile";

export const CONFIG_DESKTOP = {
  // Contenedor con ancho/alto < este valor → diseño móvil (portrait) sin cambios.
  // En dispositivos táctiles siempre es portrait.
  portraitBelowAspect: 1.2,
  // Proporción mínima (alto/ancho) del diseño móvil cuando se usa en una ventana
  // de PC casi cuadrada: por debajo, el diseño móvil se letterboxea a los costados.
  portraitMinHW: 1.6,
  // Alto de referencia: los tamaños "fijos" heredados (fuentes de avisos, trazos)
  // se multiplican por H / referenceHeight.
  referenceHeight: 1080,

  // ---- Resolución interna (nitidez vs. coste) -----------------------------
  // Backing = tamaño CSS × min(devicePixelRatio, maxDevicePixelRatio), con tope de
  // píxeles (cámara con zoom): 1366x768 renderiza 1366x768 y un 4K/retina no pasa
  // de ~2560x1440.
  render: {
    maxDevicePixelRatio: 2,
    maxBackingPixels: 2560 * 1440,
    minScale: 0.5,
    // Histéresis: solo se cambia la escala si varía más de este % (evita realocar el
    // buffer de WebGL por diferencias mínimas al redimensionar).
    minRelativeChange: 0.04,
  },
  resizeDebounceMs: 100,
  // Posición vertical (fracción) del HOME del header DOM en horizontal.
  headerIconYFrac: 0.06,

  // ---- Fondo --------------------------------------------------------------
  background: {
    focusY: 0.5, // "cover" centrado (0 = arriba, 1 = abajo)
    shadeAlpha: 0.7, // viñeta horneada encima del fondo (legibilidad)
  },

  // ---- Fila de controles (abajo, superpuesta al juego) ---------------------
  // controlsH = clamp(H * heightPct, minPx, maxPx). El resto de medidas de la fila
  // son fracciones de controlsH (× `k`, que solo baja de 1 si no cabe a lo ancho).
  controls: {
    heightPct: 0.13,
    minPx: 70,
    maxPx: 130,
    sidePct: 0.022, // margen lateral, fracción de W
    rowCyFromBottom: 0.46, // centro de la fila (cajas/botones chicos), desde abajo
    minScale: 0.55,
    icon: 0.5, // info, menú, sonido, turbo
    iconGap: 0.12,
    auto: 0.58,
    spinD: 0.94, // diámetro del GIRAR (sobresale por arriba del resto de la fila)
    spinCyFromBottom: 0.53,
    spinGap: 0.14, // aire entre GIRAR y sus vecinos
    boxH: 0.56,
    boxW: 1.72, // CRÉDITO / GANANCIA
    betBoxW: 1.26,
    betBtn: 0.46, // − / +
    betBtnGap: 0.05,
    groupGap: 0.24,
    // Anclas horizontales (fracción de W) de CRÉDITO y GANANCIA; −/APUESTA/+ y
    // AUTO/TURBO van pegados al GIRAR, que está centrado.
    creditCx: 0.24,
    winCx: 0.8,
    labelSize: 0.21, // fracción del alto de caja
    valueSize: 0.42,
    // Franja casi transparente detrás de la fila (degradado de abajo hacia arriba).
    stripHeight: 1.35, // × controlsH
    stripAlpha: 0.5,
  },
  hint: {
    lines: ["MANTÉN ESPACIO", "PARA TIRADA TURBO"],
    size: 0.105, // fracción de controlsH
    alpha: 0.6,
  },

  // ---- Logo (arriba, centrado, montado sobre el borde superior del panel) ---
  logo: {
    topPadPct: 0.04, // aire arriba, fracción de H
    widthPct: 0.27, // ancho objetivo, fracción de W
    maxHeightPct: 0.14, // tope de alto, fracción de H
    overPanelPct: 0.5, // fracción del logo que cae SOBRE el panel
    // Fracción del logo que puede invadir la fila superior de símbolos. 0 = el logo
    // se monta sobre una franja superior del panel y nunca tapa símbolos.
    overCellsPct: 0,
    gapToCellsPct: 0.004, // aire entre el logo y las celdas, fracción de H
    floatPct: 0.006, // flotación suave, fracción de H (animada en update, sin tween)
    floatPeriodMs: 3400,
    sheenEveryMs: 6500, // destello ocasional (sprite ADD, sin postFX)
  },

  // ---- Rodillos -----------------------------------------------------------
  grid: {
    widthPct: 0.82, // ancho objetivo de las celdas, fracción de W
    cellAspectMax: 1.3, // ancho/alto máximo de celda
    cellAspectMin: 1.0, // ancho/alto mínimo (nunca más altas que anchas)
    symbolScale: 1.08, // símbolo = "contain" en la celda × este factor
  },
  // Panel por código detrás de los rodillos (reemplaza al marco ilustrado y a las
  // casillas oscuras): vidrio morado + borde fino brillante + divisores sutiles.
  panel: {
    padPct: 0.014, // margen panel↔celdas, fracción de H
    radiusPct: 0.1, // radio de esquinas, fracción del alto de celda
    fillTop: "#4a1d8f",
    fillBottom: "#250b55",
    fillAlpha: 0.62,
    borderColor: "#ff8fe0",
    borderWidthPx: 2.5, // a H=1080 (escala con H, mínimo 1.5)
    glowColor: "rgba(255,110,220,0.55)",
    glowBlurPct: 0.012, // resplandor exterior del borde, fracción de H
    innerLineAlpha: 0.22, // filo blanco interior
    dividerAlpha: 0.16,
    dividerColor: "255,190,245",
    gapToControlsPct: 0.01, // aire mínimo entre el panel y la fila de controles
    // El cuerpo (degradado + resplandor, todo suave) se hornea a esta fracción de la
    // resolución interna: rellenos grandes con degradado en canvas son caros.
    bodyResolution: 0.35,
  },
  // Personajes decorativos a los lados del panel: solo si el tema trae la imagen
  // Y hay al menos `minWidthPct` × H libres (en 16:9 no hay sitio; en 21:9 sí).
  characters: {
    minWidthPct: 0.2,
    maxWidthPct: 0.48,
    gapPct: 0.012,
  },

  // ---- Banner "GANASTE" (premio normal): sobre el borde inferior del panel ---
  winBanner: {
    heightPct: 0.046, // fracción de H
    maxWidthOfGrid: 0.5,
    labelSize: 0.42, // fracción del alto del banner
    valueSize: 0.66,
  },
  // Insignia de tiradas gratis: en la franja superior del panel, a la derecha.
  fsBadge: {
    heightPct: 0.036,
  },

  // ---- Botones -----------------------------------------------------------
  buttons: {
    hoverScale: 1.05,
    pressScale: 0.95,
    tweenMs: 110,
    disabledAlpha: 0.4,
    // Estilo "caramelo" (botones sin imagen del tema): mismo lenguaje que los
    // botones reales del pack (cuadrado redondeado verde, borde claro, brillo).
    candyTop: "#9df06a",
    candyBottom: "#3a9a1c",
    candyOffTop: "#73a65a",
    candyOffBottom: "#35602a",
    candyBorder: "#effbe6",
    activeGlyph: "#fff36b",
    activeHaloColor: 0xfff36b, // halo de los toggles ACTIVOS (turbo/auto/sonido)
    activeHaloAlpha: 0.55,
    tooltipSize: 0.13, // fracción de controlsH
  },
  // Cajas CRÉDITO / APUESTA / GANANCIA: pastilla de caramelo morada.
  box: {
    fillTop: "#7b33c9",
    fillBottom: "#3a0f78",
    fillAlpha: 0.92,
    borderColor: "#ff8fe0",
    shadowAlpha: 0.35,
    glossAlpha: 0.2,
    labelColors: { credit: "#b6f56b", bet: "#ffd23f", win: "#ff9fdc" },
  },
  spin: {
    glowAlphaMin: 0.28,
    glowAlphaMax: 0.62,
    glowPulseMs: 1400, // animado en update (sin tween infinito)
    glowScale: 2.1, // diámetro del resplandor respecto al diámetro del botón
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
    // Las celebraciones se diseñaron para este alto de celda: se escalan con cellH.
    referenceCellH: 235,
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
