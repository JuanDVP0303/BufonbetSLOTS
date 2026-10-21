/**
 * CONFIG_DESKTOP — único punto de ajuste para todo lo visual/estructural del
 * modo ESCRITORIO (horizontal, no táctil). Cambiar un número aquí cambia el
 * juego en vivo, sin tocar el resto del código. El modo MÓVIL no lee nada de
 * este archivo (ver CONFIG_MOBILE en ../mobile/configMobile.ts).
 *
 * A diferencia de móvil, escritorio usa Scale.RESIZE (ver game/config.ts):
 * `this.scale.width/height` SON el tamaño REAL de la ventana en todo momento,
 * no una resolución de diseño fija — por eso no hace falta ningún truco de
 * conversión "diseño -> real" como en móvil. `design` de abajo es solo una
 * PROPORCIÓN de referencia (16:9), usada para acotar la "zona segura" del
 * contenido en monitores ultra anchos — no es una resolución de Phaser.
 */

// Misma familia tipográfica "cartoon bold" que móvil, para que el HUD de
// escritorio se sienta parte del mismo juego cuando se le agregue el arte
// (fases siguientes). Reexportada acá para que el código de escritorio no
// tenga que importar directo de `mobile/configMobile`.
export { MOBILE_FONT as DESKTOP_FONT } from "../mobile/configMobile";

export const CONFIG_DESKTOP = {
  // Proporción de referencia (16:9), NO una resolución fija de Phaser — ver
  // nota arriba. Se usa solo para calcular `maxAspect` de la zona segura.
  design: {
    width: 1920,
    height: 1080,
  },

  // Composición vertical, en % de la ALTURA real de la ventana.
  zones: {
    logoPct: 0.1, // franja del logo, arriba, centrado sobre los rodillos
    gridPct: 0.57, // 55-60% pedido — alto disponible para la rejilla 5x3
    controlBarPct: 0.12, // barra de control, abajo, a todo el ancho de la VENTANA
    gapMinPct: 0.012, // separación mínima entre zonas (header/etc.)
  },

  // CORRECCIÓN D2 (punto 3): espacio de GANANCIA — ya NO es un % de `H`
  // (antes `winBandPct`, una franja que no coincidía con el alto REAL del
  // texto — en 1280x720 el texto medía ~61px pero la franja reservada era de
  // apenas 36px, dejando solo ~3px antes de la barra en vez de los 16
  // pedidos). Ahora son dos huecos EXPLÍCITOS (arriba/abajo del texto) y el
  // alto del texto se calcula de verdad a partir del tamaño de letra — ver
  // computeLayoutDesktop() y drawWinInfoDesktop(), que usan la MISMA fórmula.
  ganancia: {
    gapAboveFramePx: 24, // entre el borde del marco y la etiqueta GANANCIA
    gapBelowToBarPx: 16, // entre el monto y la barra
  },

  // FASE 2 (punto 2): el marco ya NO usa casi todo el ancho de la zona segura
  // — deja margen a los lados para los personajes decorativos (Homer, etc.),
  // detrás del marco. % del ANCHO de la zona segura (`contentW`).
  grid: {
    widthPct: 0.64,
  },

  // FASE 2 (punto 4): estilo del marco de rodillos — mismo lenguaje visual
  // que el panel de rodillos móvil (azul/morado profundo translúcido + borde
  // dorado + resplandor interior), con sus propios números.
  frame: {
    fillTop: 0x241c6b,
    fillBottom: 0x140f3d,
    fillAlpha: 0.75, // pedido: ~75%
    borderColor: 0xffd23f,
    borderWidthPx: 7, // pedido: 6-8px reales (escritorio no tiene factor de escala — 1 real = 1 diseño)
    cornerRadiusPct: 0.1, // % del ancho de celda
  },

  // FASE 2 (punto 1): placeholder de personajes decorativos en los márgenes
  // laterales (Homer, etc.) — hasta que el tema tenga un asset dedicado.
  // CORRECCIÓN D1 (punto 2): se apagó porque el rectángulo se veía peor que
  // nada. CORRECCIÓN D2 (punto 4): reactivado con la posición/profundidad
  // corregidas — fuera del marco, estirado hasta la barra (no solo a la
  // altura de la rejilla) y con su propio nivel de profundidad (ver
  // depth.decorChar) para quedar SOBRE el fondo de la barra pero DEBAJO de
  // sus botones. En 16:9 casi exacto (las 4 resoluciones pedidas) sigue sin
  // haber margen real donde dibujarlo — eso es correcto, no un bug: ver
  // `marginW < 60` en drawDesktopDecorCharacters(). Solo aparece en pantallas
  // más anchas (21:9 en adelante).
  decorChar: {
    enabled: true,
    widthPct: 0.8, // % del margen lateral disponible
  },

  // FASE 2 (punto 1): fondo — menos contraste/saturación, desenfoque suave,
  // parallax leve con el mouse y "rosquillas" flotantes (placeholder).
  background: {
    contrast: -0.12,
    saturation: -0.18,
    blurStrength: 0.7,
    oversizeForParallax: 1.045,
    parallaxMaxPx: 16,
    floatingCount: 6,
  },

  // "Zona segura": el CONTENIDO del juego (logo + rodillos + HUD) nunca es
  // más ancho que `alto real × maxAspect` — en monitores ultra anchos (21:9)
  // el contenido se queda centrado en una proporción cómoda; el FONDO (que
  // sigue pintándose dentro de Phaser, en modo "cover" contra el alto/ancho
  // REALES — ver drawBackground) se extiende solo, llenando los costados.
  safeZone: {
    maxAspect: 1920 / 1080,
  },

  // FASE 3 (punto 1): fondo de la barra de control — azul marino translúcido
  // (reemplaza el verde con madera del banner del tema, que ya no se dibuja
  // para escritorio real) a TODO el ancho de la ventana, con degradado
  // vertical sutil y un filo claro arriba.
  // CORRECCIÓN D2 (punto 2): ~88% de opacidad (antes 75%) + tonos un poco
  // más oscuros, para que las rosquillas del fondo no se alcancen a ver a
  // través de los iconos.
  controlBar: {
    fillTop: 0x11234a, // azul marino, algo más claro arriba
    fillBottom: 0x081630, // mismo tono, más oscuro abajo
    fillAlpha: 0.88, // pedido: ~88%
    topBorderColor: 0xffffff,
    topBorderAlpha: 0.4,
    topBorderWidthPx: 3,
  },

  // FASE 3: tamaños del HUD de la barra de control, en % de `footerH` (el
  // alto real de la barra) salvo que se diga lo contrario — todo en px
  // reales, sin factor de escala (Scale.RESIZE).
  controls: {
    // CORRECCIÓN D2 (punto 1): los 3 grupos (izq/centro/der) ya no se reparten
    // en TODO el ancho de la zona segura — viven dentro de un contenedor de
    // ancho máximo, centrado, para que no se dispersen en monitores anchos.
    maxContentW: 1500,
    sideMarginPct: 0.045, // margen entre ese contenedor y el primer/último botón
    iconRPct: 0.26, // INFO/MENÚ/SONIDO/AUTO/TURBO
    iconMinR: 22,
    betBtnRPct: 0.3, // −/+
    betBtnMinR: 26, // mínimo ~52px reales de diámetro, mismo piso que móvil
    spinRPct: 0.68,
    spinMaxContentWPct: 0.045, // tope del radio del SPIN relativo a la zona segura
    spinProtrudePct: 0.3, // "sobresale ~30% por encima de la barra"
    spinSeparationPx: 28, // CORRECCIÓN D2 (punto 1): aire extra entre SPIN y −/+, para que no se pisen
    pillHPct: 0.64,
    pillWPct: 0.15, // % de la zona segura
    pillMaxW: 230,
    pillGapPct: 0.018, // separación entre pastillas y entre zonas
  },

  // Pantalla completa: botón en pantalla + tecla "F" (F11 es un atajo nativo
  // del navegador, fuera del control de la página — entrar/salir con F11
  // igual dispara un resize real, que la escena ya recalcula).
  fullscreen: {
    enabled: true,
    keyCode: "F",
  },

  // Orden de profundidad (depth) de las capas de escritorio, de atrás hacia
  // adelante — mismo esquema que móvil, para que las fases de arte tengan
  // dónde apoyarse sin reordenar nada a mano.
  // CORRECCIÓN D1 (punto 1): jerarquía FIJA, de atrás hacia adelante — la
  // causa del "velo azul" sobre símbolos/controles era que el RELLENO
  // translúcido del marco (antes en `frame-1`/`frame-2`, un valor POSITIVO)
  // quedaba por ENCIMA de los símbolos (depth 0, el default implícito de
  // Reel.ts — compartido con móvil, no se le pone un valor explícito para no
  // tocar ese archivo). `frameFill` es ahora NEGATIVO a propósito: el relleno
  // del marco SIEMPRE atrás de los símbolos; `frame` (el borde dorado) sigue
  // positivo porque ESE sí va delante, por diseño (enmarca los símbolos).
  depth: {
    background: -100, // fondo
    characters: -50, // decoración AMBIENTAL del fondo (rosquillas flotantes)
    frameFill: -10, // panel translúcido de rodillos (relleno + halo exterior)
    reels: 0, // símbolos — coincide con el depth 0 implícito de Reel.ts
    frame: 10, // marco dorado (borde + resplandor interior)
    effects: 20, // efectos de ganancia
    hudBar: 25, // fondo de la barra de control
    // CORRECCIÓN D2 (punto 4): los personajes decorativos (Homer) van en los
    // márgenes, fuera del marco, estirados hasta la barra — necesitan quedar
    // POR ENCIMA del fondo de la barra (`hudBar`, si no el 88% de opacidad de
    // la Corrección D2 punto 2 los tapa del todo) pero DEBAJO de sus botones
    // (`hud`) para el caso límite de una pantalla tan ancha que el margen se
    // les cruce con el SPIN/los iconos. Es un nivel DISTINTO de `characters`
    // (que es para las rosquillas AMBIENTALES, siempre atrás de todo) — estos
    // sí deben verse por encima de buena parte del HUD.
    decorChar: 27,
    hud: 30, // botones y pastillas
    overlays: 100, // overlays (BIG WIN, etc.)
  },

  // Modo debug: dibuja el bounding box de cada elemento del HUD de escritorio
  // registrado (ver SlotScene.debugRegisterBox) y avisa por consola si dos se
  // intersectan. En falso por defecto.
  debug: {
    enabled: false,
  },
} as const;
