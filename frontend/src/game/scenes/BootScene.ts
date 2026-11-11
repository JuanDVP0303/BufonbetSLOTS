import Phaser from "phaser";
import { TEX } from "../constants";
import type { RuntimeConfig } from "../config";

/**
 * Paso previo a PreloadScene: SOLO carga la imagen de pantalla de carga del tema
 * (si el operador subió una), para que ya esté lista cuando PreloadScene empiece a
 * descargar el resto (símbolos, chrome…) y pueda mostrarla de fondo en vez de la
 * barra genérica a secas. Si no hay imagen, pasa de largo sin esperar nada.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload() {
    const runtime = this.registry.get("runtime") as RuntimeConfig;
    const url = runtime.theme?.assets?.loading_image;
    if (url) this.load.image(TEX.loadingImage, url);
    // Fase 6 móvil (regla 4) + FASE 4 DESKTOP (punto 7): el logo se precarga
    // AQUÍ (no en PreloadScene, que es justo lo que tarda) para poder
    // mostrarlo en la pantalla de carga desde el primer frame, en cualquier
    // modo (antes solo móvil — ahora escritorio real también tiene logo +
    // "CARGANDO…" en su pantalla de carga).
    const logoUrl = runtime.theme?.assets?.logo;
    if (logoUrl) this.load.image(TEX.logo, logoUrl);
  }

  async create() {
    // Fase 3 móvil + FASE 4 DESKTOP (punto 7): espera a que la tipografía
    // cartoon del HUD esté lista para evitar el parpadeo con Arial de
    // respaldo — en cualquier modo (antes solo móvil).
    try {
      await document.fonts.load('700 48px "Baloo 2"');
      // Escritorio: la fuente bitmap de los montos se hornea con el peso 800.
      if (!this.registry.get("isTouchDevice")) await document.fonts.load('800 48px "Baloo 2"');
    } catch {
      // Si falla (fuente bloqueada, navegador viejo), seguimos con Arial.
    }
    this.scene.start("Preload");
  }
}
