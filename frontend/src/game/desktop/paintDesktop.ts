/**
 * Piezas de UI del modo escritorio dibujadas con Canvas 2D y HORNEADAS en una
 * textura (BakedImage): el panel de rodillos, los botones caramelo, las cajas de
 * CRÉDITO/APUESTA/GANANCIA y el banner GANASTE.
 *
 * Por qué no Phaser.Graphics: en WebGL un Graphics re-tesela sus formas (arcos de
 * esquinas redondeadas, degradados) en CADA frame. Aquí cada pieza es un único quad
 * que solo se vuelve a dibujar cuando cambia su tamaño, su estado o la resolución
 * interna (resize con debounce), nunca por frame. Se hornea a la resolución real
 * (× zoom de cámara), así que queda nítida sin coste extra.
 */
import Phaser from "phaser";
import { CONFIG_DESKTOP, DESKTOP_FONT } from "./configDesktop";

let bakedUid = 0;

/** Imagen respaldada por una CanvasTexture propia que se redibuja bajo demanda. */
export class BakedImage {
  readonly image: Phaser.GameObjects.Image;
  private readonly key: string;
  private readonly tex: Phaser.Textures.CanvasTexture;
  private sig = "";

  /** `bleed`: margen extra alrededor (px de layout) para sombras/resplandores. */
  constructor(scene: Phaser.Scene, public bleed = 0) {
    this.key = `__baked_${bakedUid++}`;
    this.tex = scene.textures.createCanvas(this.key, 2, 2)!;
    this.image = scene.add.image(0, 0, this.key);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (scene.textures.exists(this.key)) scene.textures.remove(this.key);
    });
  }

  /**
   * Dibuja (solo si cambió `w`, `h`, `res` o `state`) con `paint(ctx, w, h, res)`
   * en coordenadas de layout: (0,0) = esquina superior izquierda de la caja w×h.
   * La imagen queda centrada en su posición (origen 0.5).
   */
  draw(w: number, h: number, res: number, state: string, paint: (ctx: CanvasRenderingContext2D, w: number, h: number, res: number) => void) {
    const sig = `${w.toFixed(2)}|${h.toFixed(2)}|${res.toFixed(3)}|${this.bleed.toFixed(2)}|${state}`;
    if (sig === this.sig) return;
    this.sig = sig;
    const b = this.bleed;
    const pw = Math.max(2, Math.ceil((w + b * 2) * res));
    const ph = Math.max(2, Math.ceil((h + b * 2) * res));
    this.tex.setSize(pw, ph);
    const ctx = this.tex.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(res, 0, 0, res, b * res, b * res);
    paint(ctx, w, h, res);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.tex.refresh();
    // El frame cambió de tamaño: re-asignar la textura actualiza el tamaño del Image.
    this.image.setTexture(this.key);
    this.image.setScale(1 / res);
  }
}

/** Trazado de rectángulo redondeado (radios por esquina). */
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | { tl: number; tr: number; br: number; bl: number }
) {
  const R = typeof r === "number" ? { tl: r, tr: r, br: r, bl: r } : r;
  const m = Math.min(w, h) / 2;
  const tl = Math.min(R.tl, m), tr = Math.min(R.tr, m), br = Math.min(R.br, m), bl = Math.min(R.bl, m);
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

const font = (px: number, weight = "800") => `${weight} ${Math.max(1, px).toFixed(1)}px ${DESKTOP_FONT}`;

// ------------------------------------------------------------------------ //
// Panel de rodillos                                                         //
// ------------------------------------------------------------------------ //
export interface PanelPaintSpec {
  radius: number;
  border: number;
  glowBlur: number; // px de layout
  headerH: number; // franja superior (bajo el logo)
  pad: number;
  cols: number;
  cellW: number;
  gridH: number;
}

/**
 * Cuerpo del panel: resplandor exterior + vidrio morado translúcido + brillo
 * superior. Todo es suave, así que se hornea a BAJA resolución (rellenos grandes
 * con degradado en canvas son caros); las líneas finas van aparte (paintPanelLines).
 */
export function paintPanelBody(ctx: CanvasRenderingContext2D, w: number, h: number, s: PanelPaintSpec) {
  const P = CONFIG_DESKTOP.panel;
  // Resplandor exterior: trazos concéntricos cada vez más anchos y tenues.
  ctx.save();
  ctx.strokeStyle = P.glowColor;
  const steps = 3;
  for (let i = steps; i >= 1; i--) {
    ctx.globalAlpha = 0.22 * (1 - (i - 1) / steps);
    ctx.lineWidth = s.border + (s.glowBlur * 2 * i) / steps;
    roundRectPath(ctx, 0, 0, w, h, s.radius);
    ctx.stroke();
  }
  ctx.restore();

  // Vidrio: degradado vertical translúcido (el fondo se ve a través).
  ctx.save();
  ctx.globalAlpha = P.fillAlpha;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, P.fillTop);
  g.addColorStop(1, P.fillBottom);
  ctx.fillStyle = g;
  roundRectPath(ctx, 0, 0, w, h, s.radius);
  ctx.fill();
  ctx.restore();

  // Brillo superior muy suave, solo en su franja.
  const glossH = Math.min(h * 0.35, s.headerH + s.pad * 4);
  const gloss = ctx.createLinearGradient(0, 0, 0, glossH);
  gloss.addColorStop(0, "rgba(255,255,255,0.10)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  roundRectPath(ctx, 0, 0, w, glossH, { tl: s.radius, tr: s.radius, br: 0, bl: 0 });
  ctx.fill();
}

/** Líneas finas del panel (a resolución completa): divisores, filo interior y borde. */
export function paintPanelLines(ctx: CanvasRenderingContext2D, w: number, h: number, s: PanelPaintSpec) {
  const P = CONFIG_DESKTOP.panel;
  // Divisores entre rodillos: líneas finas que se desvanecen en los extremos.
  const top = s.headerH;
  const bottom = s.headerH + s.gridH;
  const lw = Math.max(1, s.border * 0.55);
  for (let c = 1; c < s.cols; c++) {
    const x = s.pad + c * s.cellW;
    const lg = ctx.createLinearGradient(0, top, 0, bottom);
    lg.addColorStop(0, `rgba(${P.dividerColor},0)`);
    lg.addColorStop(0.12, `rgba(${P.dividerColor},${P.dividerAlpha})`);
    lg.addColorStop(0.88, `rgba(${P.dividerColor},${P.dividerAlpha})`);
    lg.addColorStop(1, `rgba(${P.dividerColor},0)`);
    ctx.fillStyle = lg;
    ctx.fillRect(x - lw / 2, top, lw, bottom - top);
  }
  // Filo blanco interior + borde brillante.
  const inset = s.border * 1.6;
  ctx.lineWidth = Math.max(0.75, s.border * 0.45);
  ctx.strokeStyle = `rgba(255,255,255,${P.innerLineAlpha})`;
  roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, Math.max(0, s.radius - inset));
  ctx.stroke();
  ctx.lineWidth = s.border;
  ctx.strokeStyle = P.borderColor;
  roundRectPath(ctx, s.border / 2, s.border / 2, w - s.border, h - s.border, Math.max(0, s.radius - s.border / 2));
  ctx.stroke();
}

// ------------------------------------------------------------------------ //
// Botones caramelo (sin imagen del tema)                                    //
// ------------------------------------------------------------------------ //
export type Glyph = "info" | "menu" | "turbo" | "sound" | "auto" | "minus" | "plus" | "spin";

/** Cuadrado redondeado verde glossy (o círculo para −/+/GIRAR) con su ícono. */
export function paintCandyButton(ctx: CanvasRenderingContext2D, size: number, glyph: Glyph, on: boolean, toggle: boolean) {
  const B = CONFIG_DESKTOP.buttons;
  const s = size;
  const round = glyph === "spin" || glyph === "minus" || glyph === "plus";
  const rad = round ? s / 2 : s * 0.24;
  const lit = on || !toggle;
  const top = lit ? B.candyTop : B.candyOffTop;
  const bottom = lit ? B.candyBottom : B.candyOffBottom;
  // Sombra de caída.
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  roundRectPath(ctx, 0, s * 0.06, s, s, rad);
  ctx.fill();
  // Cuerpo.
  const g = ctx.createLinearGradient(0, 0, 0, s);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  roundRectPath(ctx, 0, 0, s, s, rad);
  ctx.fill();
  // Brillo.
  ctx.fillStyle = "rgba(255,255,255,0.26)";
  roundRectPath(ctx, s * 0.12, s * 0.08, s * 0.76, s * 0.32, rad * 0.7);
  ctx.fill();
  // Borde claro.
  ctx.lineWidth = Math.max(1.5, s * 0.05);
  ctx.strokeStyle = B.candyBorder;
  roundRectPath(ctx, ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth, Math.max(0, rad - ctx.lineWidth / 2));
  ctx.stroke();
  // Ícono (blanco, o amarillo si es un toggle ACTIVO).
  const color = toggle && on ? B.activeGlyph : "#ffffff";
  paintGlyph(ctx, glyph, s / 2, s / 2, s, color, on);
}

function paintGlyph(ctx: CanvasRenderingContext2D, glyph: Glyph, cx: number, cy: number, s: number, color: string, on: boolean) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowOffsetY = s * 0.03;
  ctx.shadowBlur = s * 0.04;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (glyph) {
    case "info":
    case "auto": {
      const text = glyph === "info" ? "i" : "AUTO";
      ctx.font = font(glyph === "info" ? s * 0.62 : s * 0.28);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy + s * 0.03);
      break;
    }
    case "menu": {
      const w = s * 0.5;
      const t = s * 0.09;
      for (const dy of [-0.16, 0, 0.16]) {
        roundRectPath(ctx, cx - w / 2, cy + dy * s - t / 2, w, t, t / 2);
        ctx.fill();
      }
      break;
    }
    case "turbo": {
      // Rayo.
      const u = s / 100;
      ctx.beginPath();
      ctx.moveTo(cx + 8 * u, cy - 32 * u);
      ctx.lineTo(cx - 18 * u, cy + 4 * u);
      ctx.lineTo(cx - 1 * u, cy + 4 * u);
      ctx.lineTo(cx - 8 * u, cy + 32 * u);
      ctx.lineTo(cx + 18 * u, cy - 6 * u);
      ctx.lineTo(cx + 1 * u, cy - 6 * u);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "sound": {
      const u = s / 100;
      ctx.beginPath();
      ctx.moveTo(cx - 24 * u, cy - 9 * u);
      ctx.lineTo(cx - 12 * u, cy - 9 * u);
      ctx.lineTo(cx + 2 * u, cy - 22 * u);
      ctx.lineTo(cx + 2 * u, cy + 22 * u);
      ctx.lineTo(cx - 12 * u, cy + 9 * u);
      ctx.lineTo(cx - 24 * u, cy + 9 * u);
      ctx.closePath();
      ctx.fill();
      ctx.lineWidth = 5 * u;
      if (on) {
        ctx.beginPath();
        ctx.arc(cx + 4 * u, cy, 12 * u, -0.9, 0.9);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 4 * u, cy, 22 * u, -0.9, 0.9);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(cx + 12 * u, cy - 10 * u);
        ctx.lineTo(cx + 28 * u, cy + 10 * u);
        ctx.moveTo(cx + 28 * u, cy - 10 * u);
        ctx.lineTo(cx + 12 * u, cy + 10 * u);
        ctx.stroke();
      }
      break;
    }
    case "minus":
    case "plus": {
      const w = s * 0.46;
      const t = s * 0.13;
      roundRectPath(ctx, cx - w / 2, cy - t / 2, w, t, t / 2);
      ctx.fill();
      if (glyph === "plus") {
        roundRectPath(ctx, cx - t / 2, cy - w / 2, t, w, t / 2);
        ctx.fill();
      }
      break;
    }
    case "spin": {
      // Dos flechas circulares.
      const r = s * 0.24;
      ctx.lineWidth = s * 0.075;
      for (const a0 of [-Math.PI * 0.95, Math.PI * 0.05]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, a0, a0 + Math.PI * 0.72);
        ctx.stroke();
        const a1 = a0 + Math.PI * 0.72;
        const hx = cx + Math.cos(a1) * r;
        const hy = cy + Math.sin(a1) * r;
        const tdir = a1 + Math.PI / 2;
        const hs = s * 0.09;
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(tdir) * hs, hy + Math.sin(tdir) * hs);
        ctx.lineTo(hx + Math.cos(a1) * hs, hy + Math.sin(a1) * hs);
        ctx.lineTo(hx - Math.cos(a1) * hs, hy - Math.sin(a1) * hs);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
  }
  ctx.restore();
}

// ------------------------------------------------------------------------ //
// Cajas CRÉDITO / APUESTA / GANANCIA y banner GANASTE                       //
// ------------------------------------------------------------------------ //
/** Pastilla de caramelo morada con la etiqueta horneada arriba. */
export function paintValuePill(ctx: CanvasRenderingContext2D, w: number, h: number, label: string, labelColor: string, labelSize: number) {
  const X = CONFIG_DESKTOP.box;
  const r = h * 0.38;
  ctx.fillStyle = `rgba(0,0,0,${X.shadowAlpha})`;
  roundRectPath(ctx, 0, h * 0.07, w, h, r);
  ctx.fill();
  ctx.save();
  ctx.globalAlpha = X.fillAlpha;
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, X.fillTop);
  g.addColorStop(1, X.fillBottom);
  ctx.fillStyle = g;
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = `rgba(255,255,255,${X.glossAlpha})`;
  roundRectPath(ctx, w * 0.05, h * 0.07, w * 0.9, h * 0.34, r * 0.8);
  ctx.fill();
  const bw = Math.max(1.5, h * 0.045);
  ctx.lineWidth = bw;
  ctx.strokeStyle = X.borderColor;
  roundRectPath(ctx, bw / 2, bw / 2, w - bw, h - bw, Math.max(0, r - bw / 2));
  ctx.stroke();
  // Etiqueta.
  ctx.font = font(labelSize);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, labelSize * 0.22);
  ctx.strokeStyle = "rgba(26,6,40,0.85)";
  ctx.strokeText(label, w / 2, h * 0.27);
  ctx.fillStyle = labelColor;
  ctx.fillText(label, w / 2, h * 0.27);
}

/** Banner GANASTE: pastilla oscura con doble borde (rosa + dorado). */
export function paintWinBanner(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const r = h / 2;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  roundRectPath(ctx, 0, h * 0.08, w, h, r);
  ctx.fill();
  ctx.fillStyle = "rgba(18,6,42,0.9)";
  roundRectPath(ctx, 0, 0, w, h, r);
  ctx.fill();
  const b1 = Math.max(1.5, h * 0.05);
  ctx.lineWidth = b1;
  ctx.strokeStyle = "rgba(255,143,224,0.95)";
  roundRectPath(ctx, b1 / 2, b1 / 2, w - b1, h - b1, r - b1 / 2);
  ctx.stroke();
  const inset = b1 * 2.2;
  ctx.lineWidth = Math.max(1, b1 * 0.5);
  ctx.strokeStyle = "rgba(255,210,63,0.6)";
  roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, r - inset);
  ctx.stroke();
}

/** Degradado vertical transparente → oscuro (franja sutil detrás de los controles). */
export function ensureFadeTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, "rgba(12,3,26,0)");
  g.addColorStop(0.45, "rgba(12,3,26,0.55)");
  g.addColorStop(1, "rgba(12,3,26,1)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  scene.textures.addCanvas(key, canvas);
}
