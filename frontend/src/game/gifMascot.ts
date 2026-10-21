import Phaser from "phaser";
import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";

export interface MascotFrames {
  keys: string[];
  delays: number[]; // ms por cuadro
}

// Distancia RGB por debajo de la cual un píxel se considera "fondo" (transparente),
// y una banda extra para suavizar el borde en vez de dejarlo dentado.
const CHROMA_THRESHOLD = 46;
const CHROMA_SOFT = 22;
// <1 reproduce el GIF un poco más rápido que su velocidad original (a pedido).
const SPEED_FACTOR = 0.82;

function colorDistance(r: number, g: number, b: number, br: number, bg: number, bb: number) {
  const dr = r - br;
  const dg = g - bg;
  const db = b - bb;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * Decodifica un GIF cuadro por cuadro (gifuct-js), compone cada cuadro (maneja el
 * disposal básico tipo "restaurar a fondo") y le quita el color de fondo dominante
 * por CHROMA-KEY (vuelve transparentes los píxeles cercanos a ese color), porque la
 * mayoría de los GIF que suben los operadores no traen canal alfa real.
 *
 * Cada cuadro resultante se registra como una textura de Phaser aparte, para poder
 * dibujarlo DENTRO del mismo canvas del juego con una profundidad (`depth`) exacta
 * (entre los rieles y el oscurecido del premio) — un <img> del DOM no se puede
 * intercalar con lo que Phaser dibuja, por eso se decodifica en vez de solo mostrar
 * el GIF nativo del navegador.
 */
export async function loadMascotFrames(
  scene: Phaser.Scene,
  url: string,
  keyPrefix: string
): Promise<MascotFrames | null> {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const gif = parseGIF(buf);
    const frames = decompressFrames(gif, true) as ParsedFrame[];
    if (!frames.length) return null;

    const W = gif.lsd.width;
    const H = gif.lsd.height;
    const full = document.createElement("canvas");
    full.width = W;
    full.height = H;
    const fullCtx = full.getContext("2d", { willReadFrequently: true })!;
    const temp = document.createElement("canvas");
    const tempCtx = temp.getContext("2d", { willReadFrequently: true })!;

    let bg: [number, number, number] | null = null;
    const keys: string[] = [];
    const delays: number[] = [];

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const { width, height, left, top } = frame.dims;
      temp.width = width;
      temp.height = height;
      const imgData = tempCtx.createImageData(width, height);
      imgData.data.set(frame.patch);
      tempCtx.putImageData(imgData, 0, 0);
      fullCtx.drawImage(temp, left, top);

      const composed = fullCtx.getImageData(0, 0, W, H);
      const data = composed.data;

      if (!bg) {
        // Color de fondo dominante: promedio de la esquina superior-izquierda.
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < 4; y++) {
          for (let x = 0; x < 4; x++) {
            const idx = (y * W + x) * 4;
            r += data[idx];
            g += data[idx + 1];
            b += data[idx + 2];
            n++;
          }
        }
        bg = [r / n, g / n, b / n];
      }
      const [br, bgc, bb] = bg;
      for (let p = 0; p < data.length; p += 4) {
        const dist = colorDistance(data[p], data[p + 1], data[p + 2], br, bgc, bb);
        if (dist < CHROMA_THRESHOLD) {
          data[p + 3] = 0;
        } else if (dist < CHROMA_THRESHOLD + CHROMA_SOFT) {
          data[p + 3] = Math.round(data[p + 3] * ((dist - CHROMA_THRESHOLD) / CHROMA_SOFT));
        }
      }

      const frameCanvas = document.createElement("canvas");
      frameCanvas.width = W;
      frameCanvas.height = H;
      frameCanvas.getContext("2d")!.putImageData(composed, 0, 0);

      const key = `${keyPrefix}-${i}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.addCanvas(key, frameCanvas);
      keys.push(key);
      // `frame.delay` de gifuct-js YA viene en ms (lo convierte internamente desde
      // centisegundos) — no volver a multiplicar por 10, o queda 10x más lento que
      // el GIF real. SPEED_FACTOR < 1 lo adelanta un poco más, a pedido.
      delays.push(Math.max(16, (frame.delay || 80) * SPEED_FACTOR));

      // "Restaurar a fondo": limpia el área del cuadro antes de componer el siguiente.
      if (frame.disposalType === 2) {
        fullCtx.clearRect(left, top, width, height);
      }
    }

    return { keys, delays };
  } catch (err) {
    console.warn("No se pudo decodificar el GIF del premio grande:", err);
    return null;
  }
}
