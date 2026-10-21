/**
 * CONFIG_MOBILE — único punto de ajuste para TODO lo visual/estructural del
 * modo móvil (Fase 1). Cambiar un número aquí cambia el juego en vivo, sin
 * tocar el resto del código. El modo ESCRITORIO no lee nada de este archivo.
 */

// Una sola familia tipográfica "cartoon bold" para todo el HUD móvil (Fase 3,
// regla 7), compartida por SlotScene y PreloadScene (pantalla de carga, Fase
// 6). Ver index.html (Google Fonts) y BootScene (espera a que cargue).
// Escritorio sigue usando "Arial, sans-serif" en su propio código.
export const MOBILE_FONT = "'Baloo 2', Arial, sans-serif";

export const CONFIG_MOBILE = {
  // Resolución de diseño fija del lienzo móvil. Phaser escala esto con
  // Scale.FIT + autoCenter a cualquier pantalla real, así que toda la
  // geometría del juego (rodillos, paneles, botones) se calcula SIEMPRE
  // contra estos mismos 1080x1920, sin importar el dispositivo.
  design: {
    width: 1080,
    height: 1920,
  },

  // Márgenes de seguridad (notch / home indicator de iPhone y equivalentes
  // Android), en píxeles CSS REALES de pantalla (no de la resolución de
  // diseño — se convierten automáticamente, ver designScaleFactor()).
  safeArea: {
    topPx: 30, // CORRECCIÓN 4 (punto 2): 40→30 (límite bajo del rango sugerido
    // 30–50) — menos espacio muerto entre los botones superiores y el logo.
    bottomPx: 50, // sugerido 40–60
  },

  // Composición vertical, en % de la ALTURA de diseño (1920).
  zones: {
    logoPct: 0.075, // CORRECCIÓN 4 (punto 2): 0.09→0.075, header más compacto
    winBandPct: 0.055, // franja de GANANCIA, pegada justo debajo de los rodillos
    // Ya NO hay `gridPct`: desde la Corrección 4 (punto 3) la rejilla se mide
    // por su propio ancho×alto (celdas 4:5, ver `grid.cellAspectHW`), no por
    // un % pre-reservado — así aprovecha TODO el alto que el ancho le deje
    // usar, en vez de quedar atada a una franja fija que podía sobrarle o
    // quedarle chica. El resto (lo que sobra tras header+rejilla+winBand) es
    // la zona de controles/footer, igual que antes.
  },

  // CORRECCIÓN 4 (punto 3): celdas VERTICALES en vez de cuadradas.
  grid: {
    cellAspectHW: 1.25, // alto/ancho de celda — 4:5 (ancho:alto) pedido = 1.25
  },

  // CORRECCIÓN 4 (punto 0): el juego NO tiene compra de función ni doblar
  // apuesta — el código de esos botones queda (mobileFeatureStub), pero se
  // deja de llamar mientras estos flags sean `false`. Si algún día el
  // backend los soporta, basta con poner el flag en `true`.
  features: {
    buyFeature: false,
    doubleChance: false,
  },

  // Distribución vertical del footer (de arriba a abajo): CRÉDITO/APUESTA (o
  // los botones de función si `features.*` están en `true`), fila de
  // controles −/SPIN/+, fila de iconos, texto de ronda. Alturas como fracción
  // de `design.width` (SIEMPRE 1080 en móvil → son, en la práctica, píxeles
  // de diseño fijos). Las filas se colocan en SECUENCIA (cada una debajo de
  // la anterior) con al menos `gapMinPct` de separación — así es IMPOSIBLE
  // que se solapen. Ver buildControlsMobile().
  layout: {
    featureHPct: 0.1, // alto de la fila CRÉDITO/APUESTA (o botones de función)
    spinDiameterPct: 0.28, // pedido explícito: botón de girar más grande (antes 22-24%)
    betBtnDiameterPct: 0.115, // −/+ de apuesta (CORRECCIÓN 4: antes 0.1, mín. 52px reales)
    iconDiameterPct: 0.1, // CORRECCIÓN 4 (punto 0/6): más grande (antes 0.088) —
    // usa el espacio que liberó quitar la fila de crédito/apuesta de abajo.
    showIconCaptions: false, // CORRECCIÓN 4 (punto 6): quitadas (opción A pedida)
    iconCaptionHPct: 0.03, // por si se vuelven a activar (mín. ~11px reales ya resuelto abajo)
    legalRowHPct: 0.03, // texto de ronda
    gapMinPct: 0.02, // separación mínima entre filas (crece si sobra espacio)
  },

  // Orden de profundidad (depth) de las capas del modo móvil, de atrás hacia
  // adelante. Referencia para organizar `setDepth(...)` en las fases
  // siguientes (Fase 1 no reordena el dibujado existente, solo lo documenta).
  depth: {
    background: -100, // fondo del tema (cover, full-bleed, detrás del canvas o dentro de él)
    reels: 0, // rodillos y su panel
    frame: 10, // marco/borde decorativo sobre los rodillos
    effects: 20, // partículas, pulsos de victoria, líneas de pago
    hud: 30, // controles: giro, −/+, crédito/apuesta, iconos, GANANCIA
    overlays: 100, // oscurecido de Big Win, modales, aviso de "gira tu teléfono"
  },

  // Fase 4 — animación de rodillos. TODOS los tiempos/velocidades del giro
  // móvil viven acá; no cambian el resultado del RNG, solo cómo se anima
  // hasta llegar a él. Escritorio no lee nada de este bloque (sigue con sus
  // propios números fijos en SlotScene/Reel).
  reel: {
    // Arranque: tirón corto hacia atrás (opcional, factor negativo breve) y
    // luego aceleración suave hasta la velocidad crucero.
    pullBackMs: 90,
    accelMs: 220,
    cruiseSpeed: 30, // símbolos/seg a velocidad normal (desktop usa 26, fijo)
    // Frenado normal: escalonado de izquierda a derecha + rebote al aterrizar.
    staggerMs: 230, // 200–260 pedido
    stopDurationMs: 650,
    landBounceMs: 160,
    overshoot: 0.3, // "peso" del carrete al pasarse un poco del objetivo
    // Turbo: casi simultáneo, más rápido, sin rebote exagerado.
    turboCruiseSpeedMult: 1.6,
    turboStaggerMs: 60,
    turboStopDurationMs: 260,
    turboOvershoot: 0.1,
    turboSquashY: 0.97, // 1 = sin squash; desktop usa 0.92 siempre (más marcado)
    // Motion blur "falso" (sin asset de símbolo desenfocado todavía): se
    // estira el símbolo en Y y se le baja el alpha mientras gira.
    blurScaleY: 1.12,
    blurAlpha: 0.9,
    // Anticipación (scatters/FREESPIN a punto de completar la condición): el
    // último rodillo gira más lento + brillo alrededor del panel + cámara.
    anticipationSpeedMult: 0.45,
    anticipationGlowAlpha: 0.85,
    anticipationShakeMs: 220,
    anticipationShakeIntensity: 0.0035,
  },

  // Fase 5 — presentación de ganancias (NO toca cómo se calcula/acredita el
  // premio, solo cómo se muestra). Umbrales propios de móvil, separados de
  // WIN_TIERS de escritorio para poder ajustarlos sin tocar nada compartido.
  winTiers: {
    big: 15,
    mega: 30,
    super: 60, // "SUPER WIN" en vez de "EPIC" (nombre pedido en la Fase 5)
  },
  celebration: {
    dimOpacity: 0.35, // símbolos NO ganadores, mientras se muestra la ganancia
    sparkleFreqMs: 180, // frecuencia de las partículas sutiles por símbolo ganador
    coinBurstSmall: 14, // monedas chicas en el contador de GANANCIA (premio normal)
    tiers: {
      big: {
        title: "¡BIG WIN!", color: "#ffd23f",
        gradient: ["#fff6c8", "#ffd23f", "#b5790a"] as [string, string, string],
        coins: 70, confetti: 90, shakeMs: 220, shakeI: 0.006, rollMs: 1300, holdMs: 2400,
      },
      mega: {
        title: "¡MEGA WIN!", color: "#ff9f1c",
        gradient: ["#fff3d6", "#ff9f1c", "#8a4e06"] as [string, string, string],
        coins: 110, confetti: 140, shakeMs: 320, shakeI: 0.009, rollMs: 1700, holdMs: 2900,
      },
      super: {
        title: "¡SUPER WIN!", color: "#ef476f",
        gradient: ["#ffd9e3", "#ef476f", "#7a0f2c"] as [string, string, string],
        coins: 160, confetti: 200, shakeMs: 420, shakeI: 0.013, rollMs: 2100, holdMs: 3400,
      },
      jackpot: {
        title: "¡JACKPOT!", color: "#ffd23f",
        gradient: ["#fffbe0", "#ffd23f", "#a66a00"] as [string, string, string],
        coins: 220, confetti: 260, shakeMs: 550, shakeI: 0.018, rollMs: 2600, holdMs: 4000,
      },
    },
  },
  // Vibración háptica corta (navigator.vibrate) — se usa solo si el navegador
  // lo soporta. Patrones más largos para premios más grandes.
  haptics: {
    normalWin: 15,
    bigWin: {
      big: [30, 40, 30],
      mega: [30, 40, 30, 40, 40],
      super: [40, 50, 40, 50, 60, 50],
      jackpot: [50, 60, 50, 60, 50, 60, 80],
    },
  },

  // CORRECCIÓN 1: modo debug — dibuja el bounding box de cada elemento del
  // HUD (ver SlotScene.debugRegisterBox) y avisa por consola si dos se
  // intersectan. En falso por defecto; activar a mano para inspeccionar.
  debug: {
    enabled: false,
  },
} as const;

/**
 * Clasifica el DISPOSITIVO (no la orientación actual) como "móvil": pantalla
 * táctil cuyo lado más chico no supera 820px. Usar min(ancho,alto) en vez de
 * innerWidth evita que rotar el teléfono cambie la clasificación.
 */
export function isMobileDeviceClass(): boolean {
  if (typeof window === "undefined") return false;
  const hasTouch =
    "ontouchstart" in window || (navigator.maxTouchPoints ?? 0) > 0;
  const minSide = Math.min(window.innerWidth, window.innerHeight);
  return hasTouch && minSide <= 820;
}

/** true si la ventana está apaisada AHORA MISMO (para el aviso de "gira tu teléfono"). */
export function isLandscapeNow(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth > window.innerHeight;
}

/**
 * Factor para convertir px CSS reales de pantalla a px de la resolución de
 * diseño (1080 de ancho), asumiendo que Scale.FIT está limitado por el ancho
 * (válido: diseño y dispositivo son ambos verticales). Se usa para que
 * `safeArea.topPx/bottomPx` midan lo mismo en cualquier teléfono.
 */
export function designScaleFactor(): number {
  if (typeof window === "undefined") return 1;
  return CONFIG_MOBILE.design.width / Math.max(1, window.innerWidth);
}
