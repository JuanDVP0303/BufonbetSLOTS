/**
 * Sistema de layout por orientación/tamaño — funciones PURAS (sin Phaser), para
 * poder probarlas fuera del navegador.
 *
 *  - chooseLayoutMode(): decide "portrait" (diseño móvil actual, intacto) o
 *    "landscape" (escritorio/horizontal, W/H >= 1.2).
 *  - desktopDesignSize() / desktopRenderScale(): espacio de layout (= tamaño CSS
 *    del contenedor, el lienzo lo llena entero) y resolución interna.
 *  - computeDesktopLayout(): TODA la geometría del modo horizontal (panel, logo,
 *    máscara, fila de controles…) a partir de CONFIG_DESKTOP.
 *
 * Coordenadas: px CSS del contenedor, origen arriba-izquierda. Los rectángulos son
 * {x, y, w, h} (esquina superior izquierda); los botones, centro + tamaño.
 */
import { CONFIG_DESKTOP } from "./configDesktop";

export type LayoutMode = "portrait" | "landscape";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Spot {
  cx: number;
  cy: number;
  size: number; // lado / diámetro
}
export interface GridSpec {
  cols: number;
  rows: number;
  // Tamaño del logo del tema (para su proporción). null = título por texto.
  logoAsset: { width: number; height: number } | null;
}

export interface DesktopLayout {
  W: number;
  H: number;
  ui: number; // H / referenceHeight: escala de tamaños "fijos" heredados
  controlsH: number;
  grid: { x: number; y: number; w: number; h: number; cellW: number; cellH: number };
  symbolScale: number;
  panel: Rect & { radius: number; headerH: number; pad: number };
  // Ventana de los rodillos (máscara): ancho interior del panel y alto de las celdas
  // + el margen que ocupa un símbolo agrandado (symbolScale). Esquinas inferiores
  // redondeadas como el panel.
  reelWindow: Rect & { radiusBottom: number };
  logo: { cx: number; cy: number; maxW: number; maxH: number };
  winBanner: { cx: number; cy: number; h: number; maxW: number };
  fsBadge: { right: number; cy: number; h: number };
  characters: { left: Rect | null; right: Rect | null };
  controls: {
    k: number; // escala aplicada por falta de ancho (1 = tamaño nominal)
    rowCy: number;
    strip: Rect;
    hint: { cx: number; cy: number; size: number; maxW: number; twoLines: boolean };
    info: Spot;
    menu: Spot;
    sound: Spot;
    turbo: Spot;
    auto: Spot;
    spin: { cx: number; cy: number; r: number };
    minus: Spot;
    plus: Spot;
    credit: Rect;
    bet: Rect;
    win: Rect;
    labelSize: number;
    valueSize: number;
    tooltipSize: number;
  };
}

const D = CONFIG_DESKTOP;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * "portrait" en dispositivos táctiles (diseño móvil de siempre) o en ventanas de
 * PC con ancho/alto < 1.2; "landscape" en el resto.
 */
export function chooseLayoutMode(containerW: number, containerH: number, isTouchDevice: boolean): LayoutMode {
  if (isTouchDevice) return "portrait";
  if (!containerW || !containerH) return "landscape";
  return containerW / containerH < D.portraitBelowAspect ? "portrait" : "landscape";
}

/**
 * Espacio de layout horizontal = tamaño CSS del contenedor. Con Scale.FIT y la
 * misma proporción, el lienzo llena el contenedor de borde a borde (como
 * Scale.RESIZE) pero conservando una resolución interna propia (DPR, ver abajo).
 */
export function desktopDesignSize(containerW: number, containerH: number): { width: number; height: number } {
  return { width: Math.max(320, Math.round(containerW || 1920)), height: Math.max(240, Math.round(containerH || 1080)) };
}

/**
 * Escala de render (backing / layout) = min(devicePixelRatio, 2), acotada por un
 * presupuesto de píxeles (nunca 4K innecesario).
 */
export function desktopRenderScale(
  design: { width: number; height: number },
  containerW: number,
  containerH: number,
  devicePixelRatio: number
): number {
  const R = D.render;
  const cssScale = Math.min(containerW / design.width, containerH / design.height) || 1;
  const dpr = Math.min(R.maxDevicePixelRatio, Math.max(1, devicePixelRatio || 1));
  const maxK = Math.sqrt(R.maxBackingPixels / (design.width * design.height));
  return Math.max(R.minScale, Math.min(cssScale * dpr, maxK));
}

/** Diseño móvil (1080 de ancho) para una ventana de PC vertical o casi cuadrada. */
export function portraitDesignSize(containerW: number, containerH: number): { width: number; height: number } {
  const hw = containerW > 0 ? containerH / containerW : 16 / 9;
  return { width: 1080, height: Math.round(1080 * Math.max(D.portraitMinHW, hw)) };
}

/** Geometría completa del modo horizontal. */
export function computeDesktopLayout(W: number, H: number, spec: GridSpec): DesktopLayout {
  const C = D.controls;
  const LG = D.logo;
  const G = D.grid;
  const P = D.panel;

  // ---- Reservas verticales ---------------------------------------------
  const controlsH = clamp(H * C.heightPct, C.minPx, C.maxPx);
  const topPad = H * LG.topPadPct;
  const pad = Math.round(H * P.padPct);
  const bannerH = H * D.winBanner.heightPct;
  // Entre el panel y la fila: el banner GANASTE va montado sobre el borde inferior
  // del panel, así que su mitad inferior necesita sitio (nunca pisa el GIRAR).
  const gapToControls = Math.max(H * P.gapToControlsPct, bannerH / 2 + H * 0.006);
  const controlsTop = H - controlsH;

  // ---- Logo: ~27% del ancho, con tope de alto --------------------------
  const logoAspect = spec.logoAsset ? spec.logoAsset.width / spec.logoAsset.height : 3.1;
  let logoW = W * LG.widthPct;
  let logoH = logoW / logoAspect;
  if (logoH > H * LG.maxHeightPct) {
    logoH = H * LG.maxHeightPct;
    logoW = logoH * logoAspect;
  }
  const logoAbove = logoH * (1 - LG.overPanelPct); // parte del logo por encima del panel
  // Franja superior del panel (bajo la mitad inferior del logo): las celdas empiezan
  // debajo, salvo la fracción `overCellsPct` que se permite invadir.
  const headerH = Math.max(pad, logoH * (LG.overPanelPct - LG.overCellsPct) + H * LG.gapToCellsPct);
  // logoOverlap = todo lo que el logo le quita al alto de las celdas.
  const logoOverlap = logoAbove + headerH;

  // ---- Celdas ----------------------------------------------------------
  // availW = W * 0.82; availH = H - controlsH - topPad - logoOverlap (- márgenes).
  const availW = W * G.widthPct;
  const availH = H - controlsH - gapToControls - topPad - logoOverlap - pad;
  let cellW = availW / spec.cols;
  let cellH = availH / spec.rows;
  // Celdas más anchas que altas, sin pasar de 1.3:1 (se usa el menor: no deforma).
  cellW = Math.min(cellW, cellH * G.cellAspectMax);
  cellH = Math.floor(Math.min(cellH, cellW / G.cellAspectMin));
  cellW = Math.floor(Math.min(cellW, cellH * G.cellAspectMax));
  const gridW = cellW * spec.cols;
  const gridH = cellH * spec.rows;

  // ---- Panel: centrado; bloque logo+panel centrado en el alto libre -----
  const panelW = gridW + pad * 2;
  const panelH = headerH + gridH + pad;
  const regionTop = topPad;
  const regionBottom = controlsTop - gapToControls;
  const slack = Math.max(0, regionBottom - regionTop - (logoAbove + panelH));
  const blockTop = regionTop + slack / 2;
  const panelY = Math.round(blockTop + logoAbove);
  const gridX = Math.round((W - gridW) / 2);
  const gridY = panelY + Math.round(headerH);
  const panelX = gridX - pad;
  const radius = Math.round(cellH * P.radiusPct);
  const panel = { x: panelX, y: panelY, w: panelW, h: gridY - panelY + gridH + pad, radius, headerH: gridY - panelY, pad };

  // Máscara: el símbolo agrandado puede asomar `bleed` por arriba/abajo de las celdas,
  // pero nunca fuera del panel (ni dentro de la franja del logo más de eso).
  const border = Math.max(1.5, P.borderWidthPx * (H / D.referenceHeight));
  const bleed = Math.min(pad, Math.ceil((cellH * (G.symbolScale - 1)) / 2) + 2);
  const reelWindow = {
    x: panelX + border,
    y: gridY - bleed,
    w: panelW - border * 2,
    h: gridH + bleed + Math.max(bleed, pad - border),
    radiusBottom: Math.max(0, radius - border),
  };

  const logo = { cx: W / 2, cy: panelY - logoAbove + logoH / 2, maxW: logoW, maxH: logoH };
  const winBanner = { cx: W / 2, cy: panel.y + panel.h, h: bannerH, maxW: gridW * D.winBanner.maxWidthOfGrid };
  const fsBadge = {
    right: panelX + panelW - pad * 2,
    cy: panelY + panel.headerH / 2,
    h: Math.min(panel.headerH * 0.72, H * D.fsBadge.heightPct),
  };

  // ---- Fila de controles ----------------------------------------------
  const controls = layoutControls(W, H, controlsH);

  // ---- Personajes: a los lados del panel, sin bajar a la fila -----------
  const CH = D.characters;
  const gap = H * CH.gapPct;
  const side = W * C.sidePct;
  const minW = H * CH.minWidthPct;
  const maxW = H * CH.maxWidthPct;
  const charTop = panelY;
  const charBottom = controlsTop - gap;
  const leftW = Math.min(maxW, panelX - gap - side);
  const rightX0 = panelX + panelW + gap;
  const rightW = Math.min(maxW, W - side - rightX0);
  const characters = {
    left: leftW >= minW ? { x: panelX - gap - leftW, y: charTop, w: leftW, h: charBottom - charTop } : null,
    right: rightW >= minW ? { x: rightX0, y: charTop, w: rightW, h: charBottom - charTop } : null,
  };

  return {
    W,
    H,
    ui: H / D.referenceHeight,
    controlsH,
    grid: { x: gridX, y: gridY, w: gridW, h: gridH, cellW, cellH },
    symbolScale: G.symbolScale,
    panel,
    reelWindow,
    logo,
    winBanner,
    fsBadge,
    characters,
    controls,
  };
}

/**
 * Una sola fila abajo:  INFO MENÚ SONIDO · CRÉDITO · − APUESTA + · GIRAR · AUTO TURBO · GANANCIA
 * Tamaños = fracciones de controlsH; CRÉDITO y GANANCIA anclados a % del ancho;
 * −/APUESTA/+ y AUTO/TURBO pegados al GIRAR (centrado). Si a lo ancho no cabe, todo
 * se reduce con un único factor `k` (nunca se solapan).
 */
function layoutControls(W: number, H: number, c: number): DesktopLayout["controls"] {
  const C = D.controls;
  const margin = W * C.sidePct;
  const half = W / 2 - margin;
  // Ancho que necesita cada mitad (en unidades de controlsH, a k = 1).
  const leftUnits =
    C.icon * 3 + C.iconGap * 2 + C.groupGap + C.boxW + C.groupGap + C.betBtn * 2 + C.betBtnGap * 2 + C.betBoxW + C.spinGap + C.spinD / 2;
  const rightUnits = C.spinD / 2 + C.spinGap + C.auto + C.iconGap + C.icon + C.groupGap + C.boxW;
  const k = clamp(Math.min(1, half / (c * leftUnits), half / (c * rightUnits)), C.minScale, 1);
  const s = (u: number) => u * c * k;

  const rowCy = H - c * C.rowCyFromBottom;
  const spinR = s(C.spinD) / 2;
  const spin = { cx: W / 2, cy: H - c * C.spinCyFromBottom, r: spinR };

  // Izquierda del GIRAR: + APUESTA − (de derecha a izquierda).
  const plus: Spot = { cx: spin.cx - spinR - s(C.spinGap) - s(C.betBtn) / 2, cy: rowCy, size: s(C.betBtn) };
  const betRight = plus.cx - s(C.betBtn) / 2 - s(C.betBtnGap);
  const boxH = s(C.boxH);
  const boxY = rowCy - boxH / 2;
  const bet: Rect = { x: betRight - s(C.betBoxW), y: boxY, w: s(C.betBoxW), h: boxH };
  const minus: Spot = { cx: bet.x - s(C.betBtnGap) - s(C.betBtn) / 2, cy: rowCy, size: s(C.betBtn) };

  // Extremo izquierdo: INFO MENÚ SONIDO.
  const icon = s(C.icon);
  const info: Spot = { cx: margin + icon / 2, cy: rowCy, size: icon };
  const menu: Spot = { cx: info.cx + icon + s(C.iconGap), cy: rowCy, size: icon };
  const sound: Spot = { cx: menu.cx + icon + s(C.iconGap), cy: rowCy, size: icon };

  // CRÉDITO: anclado a % del ancho, acotado entre los iconos y el "−".
  const boxW = s(C.boxW);
  const creditLo = sound.cx + icon / 2 + s(C.groupGap);
  const creditHi = minus.cx - s(C.betBtn) / 2 - s(C.groupGap) - boxW;
  const creditX = creditHi >= creditLo ? clamp(W * C.creditCx - boxW / 2, creditLo, creditHi) : (creditLo + creditHi) / 2;
  const credit: Rect = { x: creditX, y: boxY, w: boxW, h: boxH };

  // Derecha del GIRAR: AUTO TURBO, y GANANCIA anclada a % del ancho.
  const autoSize = s(C.auto);
  const auto: Spot = { cx: spin.cx + spinR + s(C.spinGap) + autoSize / 2, cy: rowCy, size: autoSize };
  const turbo: Spot = { cx: auto.cx + autoSize / 2 + s(C.iconGap) + icon / 2, cy: rowCy, size: icon };
  const turboRight = turbo.cx + icon / 2;
  const winLo = turboRight + s(C.groupGap);
  const winHi = W - margin - boxW;
  const winX = winHi >= winLo ? clamp(W * C.winCx - boxW / 2, winLo, winHi) : (winLo + winHi) / 2;
  const win: Rect = { x: winX, y: boxY, w: boxW, h: boxH };

  // Ayuda de turbo: integrada (2 líneas) entre TURBO y GANANCIA si cabe; si no, una
  // línea discreta encima de CRÉDITO, en el aire entre el panel y la fila.
  const hintSize = c * D.hint.size;
  const longest = Math.max(...D.hint.lines.map((l) => l.length));
  const twoLineW = longest * hintSize * 0.6;
  const room = win.x - turboRight - s(C.groupGap) * 0.6;
  let hint: DesktopLayout["controls"]["hint"];
  if (room >= twoLineW) {
    hint = { cx: (turboRight + win.x) / 2, cy: rowCy, size: hintSize, maxW: room, twoLines: true };
  } else {
    const size = hintSize * 0.9;
    hint = { cx: credit.x + credit.w / 2, cy: (H - c + boxY) / 2, size, maxW: credit.w * 1.6, twoLines: false };
  }

  const stripH = c * C.stripHeight;
  return {
    k,
    rowCy,
    strip: { x: 0, y: H - stripH, w: W, h: stripH },
    hint,
    info,
    menu,
    sound,
    turbo,
    auto,
    spin,
    minus,
    plus,
    credit,
    bet,
    win,
    labelSize: boxH * C.labelSize,
    valueSize: boxH * C.valueSize,
    tooltipSize: c * D.buttons.tooltipSize,
  };
}
