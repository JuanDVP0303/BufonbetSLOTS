/**
 * Sistema de layout por orientación/tamaño — funciones PURAS (sin Phaser), para
 * poder probarlas fuera del navegador.
 *
 *  - chooseLayoutMode(): decide "portrait" (diseño móvil actual, intacto) o
 *    "landscape" (escritorio/horizontal).
 *  - desktopDesignSize() / desktopRenderScale(): resolución de diseño y de render.
 *  - computeDesktopLayout(): TODA la geometría del modo horizontal (marco, logo,
 *    personajes, barra y cada botón) a partir de CONFIG_DESKTOP.
 *
 * Coordenadas: px de diseño, origen arriba-izquierda. Los rectángulos son
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
  size: number; // diámetro / lado
}
export interface FrameFractions {
  inner: { x0: number; y0: number; x1: number; y1: number };
  visible: { x0: number; y0: number; x1: number; y1: number };
}
export interface GridSpec {
  cols: number;
  rows: number;
  // Marco ilustrado (grid_frame del tema): tamaño del asset. null = panel por código.
  frameAsset: { width: number; height: number } | null;
}

export interface DesktopLayout {
  W: number;
  H: number;
  grid: { x: number; y: number; w: number; h: number; cellW: number; cellH: number };
  // Imagen del marco ilustrado (si hay): centro y escala uniforme.
  frameImage: { cx: number; cy: number; scale: number } | null;
  frameVisible: Rect; // caja visible del marco (imagen o panel)
  panelPad: number; // solo panel por código
  logo: { cx: number; cy: number; maxW: number; maxH: number };
  winBanner: { cx: number; cy: number; maxW: number; h: number };
  fsBadge: { right: number; cy: number };
  characters: { left: Rect | null; right: Rect | null };
  bar: {
    rect: Rect;
    radius: number;
    hint: { cx: number; cy: number };
    info: Spot;
    menu: Spot;
    sound: Spot;
    turbo: Spot;
    auto: Spot;
    spin: { cx: number; cy: number; r: number };
    credit: Rect;
    bet: Rect;
    win: Rect;
    minus: Spot;
    plus: Spot;
  };
}

const D = CONFIG_DESKTOP;

/**
 * "portrait" en dispositivos táctiles (diseño móvil de siempre) o en ventanas de
 * PC más altas que anchas; "landscape" en el resto.
 */
export function chooseLayoutMode(containerW: number, containerH: number, isTouchDevice: boolean): LayoutMode {
  if (isTouchDevice) return "portrait";
  if (!containerW || !containerH) return "landscape";
  return containerW / containerH < D.portraitBelowAspect ? "portrait" : "landscape";
}

/** Resolución de diseño horizontal: base 1920x1080 adaptada a la proporción del contenedor. */
export function desktopDesignSize(containerW: number, containerH: number): { width: number; height: number } {
  const cw = Math.max(1, containerW || D.design.width);
  const ch = Math.max(1, containerH || D.design.height);
  const aspect = Math.min(D.aspect.max, Math.max(D.aspect.min, cw / ch));
  // Ventanas bajas: alto de diseño menor (HUD proporcionalmente más grande).
  let height = Math.min(D.design.height, Math.max(D.design.minHeight, ch / D.design.minUiScale));
  let width = height * aspect;
  if (width < D.design.minWidth) {
    width = D.design.minWidth;
    height = width / aspect;
  }
  return { width: Math.round(width), height: Math.round(height) };
}

/**
 * Escala de render (backing / diseño). Se acerca a los píxeles físicos que de
 * verdad ocupa el lienzo (escala CSS × devicePixelRatio, con DPR ≤ 2) y se acota
 * por presupuesto de píxeles — nunca 4K innecesario, y en pantallas chicas
 * renderiza MENOS que 1920x1080.
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

/** Diseño móvil (1080 de ancho) para una ventana VERTICAL de PC. */
export function portraitDesignSize(containerW: number, containerH: number): { width: number; height: number } {
  const hw = containerW > 0 ? containerH / containerW : 16 / 9;
  return { width: 1080, height: Math.round(1080 * Math.max(D.portraitMinHW, hw)) };
}

/** Geometría completa del modo horizontal. */
export function computeDesktopLayout(W: number, H: number, spec: GridSpec): DesktopLayout {
  const C = D.layout;
  const B = D.bar;

  // ---- Barra (abajo, centrada, ancho máximo) -----------------------------
  const barW = Math.min(B.maxWidth, W - C.sideMargin * 2);
  const barX = (W - barW) / 2;
  const barBottom = H - B.marginBottom;
  const barTop = barBottom - B.height;
  const rowCy = barTop + B.height / 2;
  const spinR = B.spinRadius;
  const spinCy = rowCy - B.spinLift;
  const hintCy = barTop - D.hint.gapAboveBar - D.hint.size / 2;
  const hudTop = Math.min(spinCy - spinR, hintCy - D.hint.size / 2);

  // ---- Marco + celdas ----------------------------------------------------
  const frame = spec.frameAsset;
  const F = D.gridFrame;
  let cellAspect = 1; // ancho/alto de celda
  // Márgenes del marco visible respecto al rectángulo de celdas, como fracción
  // del ancho (izq/der) o alto (arriba/abajo) de ese rectángulo.
  let decoL = 0, decoR = 0, decoT = 0, decoB = 0;
  if (frame) {
    const innerW = (F.inner.x1 - F.inner.x0) * frame.width;
    const innerH = (F.inner.y1 - F.inner.y0) * frame.height;
    cellAspect = innerW / spec.cols / (innerH / spec.rows);
    decoL = ((F.inner.x0 - F.visible.x0) * frame.width) / innerW;
    decoR = ((F.visible.x1 - F.inner.x1) * frame.width) / innerW;
    decoT = ((F.inner.y0 - F.visible.y0) * frame.height) / innerH;
    decoB = ((F.visible.y1 - F.inner.y1) * frame.height) / innerH;
  }
  const gridAspect = (spec.cols * cellAspect) / spec.rows;

  const logoH = H * D.logo.heightPct;
  const logoTop = C.marginTop;
  // Altura vertical disponible para el marco VISIBLE (logo montado sobre su borde).
  const frameVisTopMin = logoTop + logoH * (1 - D.logo.overlapPct);
  const frameVisBottomMax = hudTop - C.gapFrameToHud;
  const availVisH = frameVisBottomMax - frameVisTopMin;

  // Alto de celdas: objetivo % de H, acotado por el alto y por el ancho máximo.
  let innerH = H * D.grid.heightPct;
  if (frame) {
    innerH = Math.min(innerH, availVisH / (1 + decoT + decoB));
  } else {
    // panel por código: pad = panelPadPct * cellH por lado
    const padF = (2 * D.grid.panelPadPct) / spec.rows;
    innerH = Math.min(innerH, availVisH / (1 + padF));
  }
  const maxVisW = W * D.grid.maxWidthPct;
  const visWPerInnerW = frame ? 1 + decoL + decoR : 1 + (2 * D.grid.panelPadPct) / (spec.cols * cellAspect);
  if (innerH * gridAspect * visWPerInnerW > maxVisW) innerH = maxVisW / visWPerInnerW / gridAspect;

  const cellH = Math.floor(innerH / spec.rows);
  const cellW = Math.floor(cellH * cellAspect);
  const gridW = cellW * spec.cols;
  const gridH = cellH * spec.rows;
  const panelPad = frame ? 0 : Math.round(cellH * D.grid.panelPadPct);

  const visTopOff = frame ? gridH * decoT : panelPad;
  const visBotOff = frame ? gridH * decoB : panelPad;
  const visLeftOff = frame ? gridW * decoL : panelPad;
  const visRightOff = frame ? gridW * decoR : panelPad;
  const frameVisH = gridH + visTopOff + visBotOff;

  // Logo + marco como un bloque, centrado verticalmente en el espacio libre.
  const slack = Math.max(0, availVisH - frameVisH);
  const frameVisTop = frameVisTopMin + slack / 2;
  const gridY = Math.round(frameVisTop + visTopOff);
  const gridX = Math.round((W - (gridW + visRightOff - visLeftOff)) / 2);
  const frameVisible: Rect = {
    x: gridX - visLeftOff,
    y: gridY - visTopOff,
    w: gridW + visLeftOff + visRightOff,
    h: frameVisH,
  };

  let frameImage: DesktopLayout["frameImage"] = null;
  if (frame) {
    const scale = gridW / ((F.inner.x1 - F.inner.x0) * frame.width);
    const dispW = frame.width * scale;
    const dispH = frame.height * scale;
    frameImage = {
      cx: gridX - F.inner.x0 * frame.width * scale + dispW / 2,
      cy: gridY - F.inner.y0 * frame.height * scale + dispH / 2,
      scale,
    };
  }

  // Logo: centrado sobre el marco, montado sobre su borde superior (su borde
  // superior nunca queda por encima de `marginTop`: frameVisTop >= frameVisTopMin).
  const logoMaxW = Math.min(D.logo.maxWidth, frameVisible.w * D.logo.maxWidthOfFrame);
  const logo = {
    cx: frameVisible.x + frameVisible.w / 2,
    cy: frameVisible.y - logoH * (0.5 - D.logo.overlapPct),
    maxW: logoMaxW,
    maxH: logoH,
  };

  // Banner GANASTE: sobre el borde inferior visible del marco (no tapa celdas).
  const winBanner = {
    cx: W / 2,
    cy: frameVisible.y + frameVisible.h,
    maxW: Math.min(D.winBanner.maxWidth, frameVisible.w * 0.6),
    h: D.winBanner.height,
  };

  // ---- Grupos de la barra ------------------------------------------------
  const icon = B.iconSize;
  const gap = B.iconGap;
  const info: Spot = { cx: barX + B.padX + icon / 2, cy: rowCy, size: icon };
  const menu: Spot = { cx: info.cx + icon + gap, cy: rowCy, size: icon };
  const sound: Spot = { cx: menu.cx + icon + gap, cy: rowCy, size: icon };
  const leftEnd = sound.cx + icon / 2;

  const spin = { cx: barX + barW - B.padX - spinR, cy: spinCy, r: spinR };
  const auto: Spot = { cx: spin.cx - spinR - B.spinGap - B.autoSize / 2, cy: rowCy, size: B.autoSize };
  const turbo: Spot = { cx: auto.cx - B.autoSize / 2 - gap - icon / 2, cy: rowCy, size: icon };
  const rightStart = turbo.cx - icon / 2;

  // Centro: CRÉDITO | − APUESTA + | GANANCIA. Si no cabe, se encogen las cajas.
  const room = rightStart - leftEnd - B.groupGap * 2;
  const fixedW = B.boxGap * 2 + (B.betBtnSize + B.betBtnGap) * 2;
  const wantBoxes = B.boxWidth * 2 + B.betBoxWidth;
  const k = Math.min(1, Math.max(0.5, (room - fixedW) / wantBoxes));
  const boxW = B.boxWidth * k;
  const betW = B.betBoxWidth * k;
  const centerW = fixedW + boxW * 2 + betW;
  const minCx = leftEnd + B.groupGap + centerW / 2;
  const maxCx = rightStart - B.groupGap - centerW / 2;
  const centerCx = Math.min(maxCx, Math.max(minCx, barX + barW / 2));
  const boxY = rowCy - B.boxHeight / 2;
  let x = centerCx - centerW / 2;
  const credit: Rect = { x, y: boxY, w: boxW, h: B.boxHeight };
  x += boxW + B.boxGap;
  const minus: Spot = { cx: x + B.betBtnSize / 2, cy: rowCy, size: B.betBtnSize };
  x += B.betBtnSize + B.betBtnGap;
  const bet: Rect = { x, y: boxY, w: betW, h: B.boxHeight };
  x += betW + B.betBtnGap;
  const plus: Spot = { cx: x + B.betBtnSize / 2, cy: rowCy, size: B.betBtnSize };
  x += B.betBtnSize + B.boxGap;
  const win: Rect = { x, y: boxY, w: boxW, h: B.boxHeight };

  // ---- Personajes: a los lados del marco, sin bajar a la barra -----------
  const CH = D.characters;
  const charTop = frameVisible.y;
  const charBottom = barTop - CH.gapAboveBar;
  const leftW = Math.min(CH.maxWidth, frameVisible.x - CH.gapToFrame - C.sideMargin);
  const rightX0 = frameVisible.x + frameVisible.w + CH.gapToFrame;
  const rightW = Math.min(CH.maxWidth, W - C.sideMargin - rightX0);
  const characters = {
    left:
      leftW >= CH.minWidth
        ? { x: frameVisible.x - CH.gapToFrame - leftW, y: charTop, w: leftW, h: charBottom - charTop }
        : null,
    right: rightW >= CH.minWidth ? { x: rightX0, y: charTop, w: rightW, h: charBottom - charTop } : null,
  };

  return {
    W,
    H,
    grid: { x: gridX, y: gridY, w: gridW, h: gridH, cellW, cellH },
    frameImage,
    frameVisible,
    panelPad,
    logo,
    winBanner,
    fsBadge: { right: frameVisible.x + frameVisible.w - 12, cy: frameVisible.y + 4 },
    characters,
    bar: {
      rect: { x: barX, y: barTop, w: barW, h: B.height },
      radius: B.radius,
      hint: { cx: W / 2, cy: hintCy },
      info,
      menu,
      sound,
      turbo,
      auto,
      spin,
      credit,
      bet,
      win,
      minus,
      plus,
    },
  };
}
