/**
 * Recursos pre-renderizados del modo escritorio. Todo se genera UNA vez (se
 * cachea en el TextureManager/BitmapFont cache del juego, sobrevive a reinicios
 * de escena) para no pagar nada por frame:
 *
 *  - ensureDigitFont(): fuente BITMAP para los montos (crédito/apuesta/ganancia).
 *    BitmapText dibuja quads del mismo atlas; no regenera una textura canvas en
 *    cada setText() como Phaser.Text (que sí lo hace en cada cambio).
 *  - bakeSymbolTexture(): símbolo con sombra + contorno oscuro HORNEADOS en un
 *    canvas (antes eran 2 preFX por sprite, re-renderizados por framebuffer en
 *    cada frame: 25 sprites x 2 pasadas).
 *  - ensureRaysTexture(): rayos de luz del BIG WIN como textura (antes un
 *    Graphics de 10 arcos re-teselado en cada frame).
 */
import Phaser from "phaser";

interface DigitFontOptions {
  family: string;
  weight: string;
  bakeSize: number;
  extraChars?: string;
}

const BASE_CHARS = "0123456789.,:-+×x/%$€£¥₡₲₱₹₺₽¢   ";

/**
 * Genera (si no existe) una fuente bitmap blanca con contorno oscuro y sombra.
 * Se tiñe con setTint() (un degradado vertical dorado = tint arriba/abajo).
 */
export function ensureDigitFont(scene: Phaser.Scene, key: string, opts: DigitFontOptions): void {
  const chars = Array.from(new Set(Array.from(BASE_CHARS + (opts.extraChars ?? ""))));
  const cached = scene.cache.bitmapFont.get(key) as { chars?: string } | undefined;
  if (cached && cached.chars === chars.join("")) return;
  if (cached) {
    scene.cache.bitmapFont.remove(key);
    if (scene.textures.exists(key)) scene.textures.remove(key);
  }

  const size = opts.bakeSize;
  const stroke = Math.max(3, Math.round(size * 0.12));
  const shadowY = Math.round(size * 0.05);
  const pad = stroke + shadowY + 4;
  const font = `${opts.weight} ${size}px ${opts.family}`;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const metrics = measure.measureText("0123456789$");
  const ascent = Math.ceil(metrics.actualBoundingBoxAscent || size * 0.8);
  const descent = Math.ceil(metrics.actualBoundingBoxDescent || size * 0.25);
  const lineH = ascent + descent;
  const cellH = lineH + pad * 2;

  const advances = chars.map((c) => Math.ceil(measure.measureText(c).width));
  const cols = 16;
  const cellW = Math.max(...advances) + pad * 2;
  const rowsN = Math.ceil(chars.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cellW * cols;
  canvas.height = cellH * rowsN;
  const ctx = canvas.getContext("2d")!;
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = stroke * 2;
  ctx.strokeStyle = "#2b1604";

  const glyphs: Record<number, unknown> = {};
  chars.forEach((c, i) => {
    const gx = (i % cols) * cellW;
    const gy = Math.floor(i / cols) * cellH;
    const baseX = gx + pad;
    const baseY = gy + pad + ascent;
    if (c.trim()) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.strokeText(c, baseX, baseY + shadowY);
      ctx.restore();
      ctx.strokeText(c, baseX, baseY);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c, baseX, baseY);
    }
    // Quad = avance del glifo + el margen del contorno a cada lado (los límites
    // de BitmapText usan `xAdvance`, así que el margen no descentra el texto).
    const gw = advances[i] + pad * 2;
    glyphs[c.codePointAt(0)!] = {
      x: gx,
      y: gy,
      width: gw,
      height: cellH,
      centerX: Math.floor(gw / 2),
      centerY: Math.floor(cellH / 2),
      xOffset: -pad,
      yOffset: -pad,
      xAdvance: advances[i],
      data: {},
      kerning: {},
      u0: gx / canvas.width,
      v0: gy / canvas.height,
      u1: (gx + gw) / canvas.width,
      v1: (gy + cellH) / canvas.height,
    };
  });

  scene.textures.addCanvas(key, canvas);
  scene.cache.bitmapFont.add(key, {
    data: { font: key, size, lineHeight: lineH, chars: glyphs },
    texture: key,
    frame: null,
    chars: chars.join(""),
  });
}

/**
 * Hornea sombra suave + contorno oscuro fino de un símbolo en una textura nueva
 * `dstKey`. Devuelve false si no se pudo (p. ej. canvas "tainted" por CORS): en
 * ese caso el carrete usa la textura original sin efectos.
 * `customData.bakeScale` = px horneados por px del asset original (para que el
 * carrete muestre el símbolo al mismo tamaño que la textura original).
 */
export function bakeSymbolTexture(scene: Phaser.Scene, srcKey: string, dstKey: string, maxSide: number): boolean {
  if (scene.textures.exists(dstKey)) return true;
  if (!scene.textures.exists(srcKey)) return false;
  try {
    const src = scene.textures.get(srcKey).getSourceImage() as CanvasImageSource & { width: number; height: number };
    const bakeScale = Math.min(1, maxSide / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * bakeScale));
    const h = Math.max(1, Math.round(src.height * bakeScale));
    const pad = Math.ceil(Math.max(w, h) * 0.1);
    const canvas = document.createElement("canvas");
    canvas.width = w + pad * 2;
    canvas.height = h + pad * 2;
    const ctx = canvas.getContext("2d")!;
    // "Solo sombra": se dibuja la imagen FUERA del lienzo y la sombra desplazada
    // hacia dentro — así la sombra no duplica la imagen ni sus bordes alfa.
    const OFF = canvas.width * 4;
    const shadowPass = (color: string, blur: number, dy: number) => {
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = blur;
      ctx.shadowOffsetX = OFF;
      ctx.shadowOffsetY = dy;
      ctx.drawImage(src, pad - OFF, pad, w, h);
      ctx.restore();
    };
    shadowPass("rgba(0,0,0,0.5)", h * 0.06, h * 0.045); // sombra de caída
    shadowPass("rgba(26,15,5,0.6)", Math.max(2, h * 0.02), 0); // contorno de contacto
    ctx.drawImage(src, pad, pad, w, h);
    // getImageData fuerza el chequeo de CORS: si el canvas quedó "tainted", WebGL
    // no podría subirlo — mejor saberlo acá y caer a la textura original.
    ctx.getImageData(0, 0, 1, 1);
    const tex = scene.textures.addCanvas(dstKey, canvas);
    if (!tex) return false;
    (tex as unknown as { customData: Record<string, unknown> }).customData.bakeScale = bakeScale;
    return true;
  } catch {
    if (scene.textures.exists(dstKey)) scene.textures.remove(dstKey);
    return false;
  }
}

/** Rayos de luz radiales (blancos, se tiñen al usarlos) en una textura cuadrada. */
export function ensureRaysTexture(scene: Phaser.Scene, key: string, size: number, rayCount = 10): void {
  if (scene.textures.exists(key)) return;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  const spread = Math.PI / rayCount / 2.2;
  for (let i = 0; i < rayCount; i++) {
    const a = (i / rayCount) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, c, a - spread, a + spread, false);
    ctx.closePath();
    ctx.fill();
  }
  scene.textures.addCanvas(key, canvas);
}

/**
 * Oscurecido + viñeta del fondo (elipse oscura en los bordes + degradado inferior
 * para la barra), horneados en una textura que se estira a pantalla completa.
 */
export function ensureVignetteTexture(scene: Phaser.Scene, key: string): void {
  if (scene.textures.exists(key)) return;
  const W = 512;
  const H = 512;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const radial = ctx.createRadialGradient(W / 2, H * 0.44, 0, W / 2, H * 0.44, W * 0.62);
  radial.addColorStop(0, "rgba(18,6,36,0.22)");
  radial.addColorStop(0.62, "rgba(18,6,36,0.5)");
  radial.addColorStop(1, "rgba(8,2,18,0.86)");
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, W, H);
  const linear = ctx.createLinearGradient(0, 0, 0, H);
  linear.addColorStop(0, "rgba(10,4,22,0.35)");
  linear.addColorStop(0.2, "rgba(10,4,22,0)");
  linear.addColorStop(0.66, "rgba(10,4,22,0)");
  linear.addColorStop(1, "rgba(10,4,22,0.65)");
  ctx.fillStyle = linear;
  ctx.fillRect(0, 0, W, H);
  scene.textures.addCanvas(key, canvas);
}
