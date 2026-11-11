import Phaser from "phaser";
import { SYMBOL_SIZE, TEX } from "../constants";
import type { RuntimeConfig } from "../config";
import { loadMascotFrames } from "../gifMascot";
import { MOBILE_FONT } from "../mobile/configMobile";

/**
 * Carga de assets. Baja los sprites del tema (si el casino tiene imágenes subidas)
 * y genera texturas placeholder para el resto (celda, moneda, confeti, botón).
 * Un símbolo sin imagen cae al placeholder de color + letra.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super("Preload");
  }

  preload() {
    // Sprites del tema del casino actual.
    const runtime = this.registry.get("runtime") as RuntimeConfig;
    runtime.theme?.symbols.forEach((s) => {
      if (s.image_url) this.load.image(`sym-${s.code}`, s.image_url);
    });

    // Chrome del casino (fondo, logo, banner de premio, botón de girar, música).
    const a = runtime.theme?.assets;
    if (a) {
      // FONDO: en táctil NO se carga como textura (lo pinta la capa DOM "cover"
      // detrás del canvas transparente; antes se decodificaba y subía a la GPU sin
      // dibujarse nunca). En escritorio sí: se dibuja dentro de Phaser (canvas
      // OPACO, ver config.ts), con el fondo horizontal optimizado si el tema lo trae.
      // Los GIF/video siguen siendo DOM.
      const bgUrl = a.background_desktop || a.background;
      const isGifBg = !!bgUrl && bgUrl.toLowerCase().endsWith(".gif");
      if (!this.registry.get("isTouchDevice") && bgUrl && !isGifBg && runtime.theme?.background_type !== "VIDEO") {
        this.load.image(TEX.bg, bgUrl);
      }
      // En móvil, BootScene ya pudo haber cargado el logo (pantalla de carga,
      // Fase 6) — evita pedirlo dos veces.
      if (a.logo && !this.textures.exists(TEX.logo)) this.load.image(TEX.logo, a.logo);
      if (a.prize_banner) this.load.image(TEX.prizeBanner, a.prize_banner);
      if (a.spin_button) this.load.image(TEX.spinBtn, a.spin_button);
      if (a.music_on) this.load.image(TEX.musicOn, a.music_on);
      if (a.music_off) this.load.image(TEX.musicOff, a.music_off);
      if (a.music_track) this.load.audio(TEX.musicTrack, a.music_track);
      if (a.turbo_on) this.load.image(TEX.turboOn, a.turbo_on);
      if (a.turbo_off) this.load.image(TEX.turboOff, a.turbo_off);
      if (a.auto_on) this.load.image(TEX.autoOn, a.auto_on);
      if (a.auto_off) this.load.image(TEX.autoOff, a.auto_off);
      if (a.bet_plus) this.load.image(TEX.betPlus, a.bet_plus);
      if (a.bet_minus) this.load.image(TEX.betMinus, a.bet_minus);
      if (a.info_button) this.load.image(TEX.infoBtn, a.info_button);
      // Mascota del premio grande: si es GIF se decodifica aparte (ver create()),
      // porque hay que descomponerlo en texturas por cuadro, no se puede cargar con
      // el loader normal. Si es imagen estática, sí entra por el loader de siempre.
      const mascotIsGif = !!a.jackpot_mascot && a.jackpot_mascot.toLowerCase().endsWith(".gif");
      if (a.jackpot_mascot && !mascotIsGif) this.load.image(TEX.jackpotMascot, a.jackpot_mascot);
      // Paneles/banners decorativos (opcionales, estáticos: una animada aquí solo
      // mostraría su primer cuadro, igual que prize_banner/logo de siempre).
      if (a.footer_banner) this.load.image(TEX.footerBanner, a.footer_banner);
      if (a.topbar_banner) this.load.image(TEX.topbarBanner, a.topbar_banner);
      if (a.balance_banner) this.load.image(TEX.balanceBanner, a.balance_banner);
      if (a.bet_banner) this.load.image(TEX.betBanner, a.bet_banner);
      // Efecto de rodillos: igual que jackpot_mascot, si es GIF se decodifica aparte.
      const reelFxIsGif = !!a.reel_effect && a.reel_effect.toLowerCase().endsWith(".gif");
      if (a.reel_effect && !reelFxIsGif) this.load.image(TEX.reelEffect, a.reel_effect);
      // Marco ilustrado de la rejilla: siempre estático (si se sube un GIF, se usa
      // su primer cuadro, igual que el resto de banners decorativos del tema).
      if (a.grid_frame) this.load.image(TEX.gridFrame, a.grid_frame);
      // Personajes decorativos (opcionales, solo se dibujan en horizontal).
      if (!this.registry.get("isTouchDevice")) {
        if (a.character_left) this.load.image(TEX.characterLeft, a.character_left);
        if (a.character_right) this.load.image(TEX.characterRight, a.character_right);
      }
    }

    // Si un asset falla (404), Phaser sigue y se usa el placeholder.
    this.load.on("loaderror", (file: Phaser.Loader.File) =>
      console.warn("No se pudo cargar el asset:", file.key)
    );

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    // Pantalla de carga: si el tema trae imagen (ya cargada por BootScene), se
    // muestra COMPLETA y centrada (contain) en vez de a pantalla completa (cover):
    // suelen ser pósters/carteles diseñados para verse enteros, no para recortar
    // (si se recorta como fondo, con relaciones de aspecto muy distintas a la
    // pantalla se ve "rara": solo asoma una tira ampliada del centro).
    if (this.textures.exists(TEX.loadingImage)) {
      const bg = this.add.image(cx, cy, TEX.loadingImage).setDepth(-1);
      const t = bg.texture.getSourceImage();
      bg.setScale(Math.min(this.scale.width / t.width, this.scale.height / t.height));
    }

    const isMobile = this.registry.get("isMobile") as boolean | undefined;
    // FASE 4 DESKTOP (punto 7): mismo criterio landscape/portrait que usa
    // SlotScene (this.portrait = H > W) — acá no existe esa escena todavía,
    // así que se calcula directo contra el tamaño real (Scale.RESIZE para
    // cualquier modo no móvil, así que esto YA es el tamaño real de la
    // ventana en todo momento).
    const isLandscape = this.scale.width > this.scale.height;
    if (isMobile) {
      // SOLO MÓVIL (Fase 6, regla 4): logo + leyenda "CARGANDO" en la
      // tipografía cartoon + barra redondeada en dorado, para que no se vea
      // vacío mientras cargan los assets.
      if (this.textures.exists(TEX.logo)) {
        const logo = this.add.image(cx, cy - this.scale.height * 0.12, TEX.logo).setOrigin(0.5);
        const t = logo.texture.getSourceImage();
        const maxW = this.scale.width * 0.6;
        const maxH = this.scale.height * 0.18;
        logo.setScale(Math.min(maxW / t.width, maxH / t.height, 1));
      }
      this.add
        .text(cx, cy + this.scale.height * 0.06, "CARGANDO…", {
          fontFamily: MOBILE_FONT,
          fontSize: `${Math.round(this.scale.width * 0.032)}px`,
          fontStyle: "700",
          color: "#ffd23f",
        })
        .setOrigin(0.5)
        .setStroke("#3a2410", 4)
        .setShadow(0, 2, "#000000", 4, true, true);

      const barW = Math.min(this.scale.width * 0.6, 360);
      const barH = 14;
      const barY = cy + this.scale.height * 0.1;
      const track = this.add.graphics();
      track.fillStyle(0xffffff, 0.12).fillRoundedRect(cx - barW / 2, barY - barH / 2, barW, barH, barH / 2);
      const fill = this.add.graphics();
      this.load.on("progress", (p: number) => {
        fill.clear();
        const w = Math.max(barH, barW * p);
        fill.fillStyle(0xffd23f, 1).fillRoundedRect(cx - barW / 2, barY - barH / 2, w, barH, barH / 2);
      });
    } else if (isLandscape) {
      // FASE 4 DESKTOP (punto 7): logo + "CARGANDO…" + barra redondeada
      // dorada — mismo tratamiento que móvil, con proporciones de pantalla
      // horizontal. El fallback de ventana angosta no táctil (más abajo)
      // conserva la barra genérica de siempre, sin tocar.
      if (this.textures.exists(TEX.logo)) {
        const logo = this.add.image(cx, cy - this.scale.height * 0.14, TEX.logo).setOrigin(0.5);
        const t = logo.texture.getSourceImage();
        const maxW = this.scale.width * 0.26;
        const maxH = this.scale.height * 0.22;
        logo.setScale(Math.min(maxW / t.width, maxH / t.height, 1));
      }
      this.add
        .text(cx, cy + this.scale.height * 0.05, "CARGANDO…", {
          fontFamily: MOBILE_FONT,
          fontSize: `${Math.round(Math.min(this.scale.width * 0.022, 30))}px`,
          fontStyle: "700",
          color: "#ffd23f",
        })
        .setOrigin(0.5)
        .setStroke("#3a2410", 4)
        .setShadow(0, 2, "#000000", 4, true, true);

      const barW = Math.min(this.scale.width * 0.3, 360);
      const barH = 12;
      const barY = cy + this.scale.height * 0.1;
      const track = this.add.graphics();
      track.fillStyle(0xffffff, 0.12).fillRoundedRect(cx - barW / 2, barY - barH / 2, barW, barH, barH / 2);
      const fill = this.add.graphics();
      this.load.on("progress", (p: number) => {
        fill.clear();
        const w = Math.max(barH, barW * p);
        fill.fillStyle(0xffd23f, 1).fillRoundedRect(cx - barW / 2, barY - barH / 2, w, barH, barH / 2);
      });
    } else {
      // FALLBACK de ventana angosta no táctil: barra genérica de siempre, sin tocar.
      const barW = Math.min(this.scale.width * 0.6, 360);
      this.add.rectangle(cx, cy, barW, 8, 0xffffff, 0.12);
      const bar = this.add.rectangle(cx - barW / 2, cy, 0, 8, 0x06d6a0).setOrigin(0, 0.5);
      this.load.on("progress", (p: number) => bar.setSize(barW * p, 8));
    }
  }

  create() {
    this.generatePlaceholderTextures();

    // Decodificación del GIF de la mascota (si la hay): ASÍNCRONA, no bloquea el
    // arranque del juego. SlotScene recoge la promesa del registry cuando la
    // necesite (al caer un premio grande); si para entonces no ha resuelto, esa
    // vez se celebra sin la mascota (igual que un casino sin GIF subido).
    const runtime = this.registry.get("runtime") as RuntimeConfig;
    const mascotUrl = runtime.theme?.assets?.jackpot_mascot;
    if (mascotUrl && mascotUrl.toLowerCase().endsWith(".gif")) {
      this.registry.set("mascotFramesPromise", loadMascotFrames(this, mascotUrl, "jackpot-mascot"));
    }
    // Efecto de rodillos: AMBIENTAL (se ve siempre, no solo al ganar), así que se
    // decodifica igual de temprano pero SlotScene lo arranca en cuanto resuelva.
    const reelFxUrl = runtime.theme?.assets?.reel_effect;
    if (reelFxUrl && reelFxUrl.toLowerCase().endsWith(".gif")) {
      this.registry.set("reelFxFramesPromise", loadMascotFrames(this, reelFxUrl, "reel-fx"));
    }

    this.scene.start("Slot");
  }

  private generatePlaceholderTextures() {
    const g = this.add.graphics();

    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, SYMBOL_SIZE, SYMBOL_SIZE, 22);
    g.generateTexture(TEX.cell, SYMBOL_SIZE, SYMBOL_SIZE);
    g.clear();

    // Marco de celda (siempre visible): fondo translúcido + borde sutil, para que
    // cada símbolo quede "encajado" en su casilla como en un slot real.
    const S = SYMBOL_SIZE;
    const inset = 6;
    const rad = 20;
    g.fillStyle(0x0a1226, 0.55).fillRoundedRect(inset, inset, S - inset * 2, S - inset * 2, rad);
    g.fillStyle(0xffffff, 0.05).fillRoundedRect(inset, inset, S - inset * 2, (S - inset * 2) * 0.42, rad);
    g.lineStyle(2, 0xffffff, 0.12).strokeRoundedRect(inset, inset, S - inset * 2, S - inset * 2, rad);
    g.generateTexture(TEX.cellFrame, S, S);
    g.clear();

    g.fillStyle(0xffffff, 1).fillCircle(20, 20, 20);
    g.generateTexture(TEX.coin, 40, 40);
    g.clear();

    g.fillStyle(0xffffff, 1).fillRect(0, 0, 16, 24);
    g.generateTexture(TEX.confetti, 16, 24);
    g.clear();

    // Totalmente transparente (sin fillStyle, nada dibujado): zona táctil
    // invisible para botones del HUD móvil dibujados con Graphics.
    g.generateTexture(TEX.transparentPixel, 2, 2);
    g.clear();

    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 300, 100, 50);
    g.generateTexture(TEX.button, 300, 100);
    g.clear();

    // Resplandor radial (blanco, cae a transparente): para el pulso de símbolos
    // ganadores, el idle, el aro de anticipación, el resplandor del SPIN y el
    // destello táctil de los botones. Se pinta con blend ADD.
    // CORRECCIÓN 5 (punto 3a): la versión anterior aproximaba el degradado con
    // 24 círculos superpuestos dibujados por Graphics — a tamaños grandes
    // (p. ej. detrás del SPIN, o el destello de `mobilePressFeedback` sobre
    // CUALQUIER botón, que es justo el otro caso donde se reportó el mismo
    // defecto) el resultado no era un degradado limpio y dejaba ver un borde
    // cuadrado tenue (el cuadro de 256x256 de la textura, con blendMode ADD
    // haciendo visible hasta una opacidad mínima). Un degradado radial REAL de
    // canvas (`createRadialGradient`) no tiene ese problema: cae a alpha 0 de
    // forma continua y exacta en el radio exterior, sin aproximación.
    const GLOW = 256;
    // `createCanvas` solo da `null` si la clave ya existe — es la primera vez
    // que se crea `TEX.glow` en toda la carga, así que siempre es un texture nuevo.
    const glowCanvasTex = this.textures.createCanvas(TEX.glow, GLOW, GLOW)!;
    const gctx = glowCanvasTex.getContext();
    const gc = GLOW / 2;
    const glowGrad = gctx.createRadialGradient(gc, gc, 0, gc, gc, gc);
    glowGrad.addColorStop(0, "rgba(255,255,255,0.9)");
    glowGrad.addColorStop(0.6, "rgba(255,255,255,0.35)");
    glowGrad.addColorStop(1, "rgba(255,255,255,0)");
    gctx.fillStyle = glowGrad;
    gctx.fillRect(0, 0, GLOW, GLOW);
    glowCanvasTex.refresh();

    // Destello rómbico pequeño para partículas ambientales.
    const SPK = 24;
    const c2 = SPK / 2;
    g.fillStyle(0xffffff, 1);
    g.beginPath();
    g.moveTo(c2, 0);
    g.lineTo(SPK, c2);
    g.lineTo(c2, SPK);
    g.lineTo(0, c2);
    g.closePath();
    g.fillPath();
    g.generateTexture(TEX.sparkle, SPK, SPK);

    g.destroy();
  }
}
