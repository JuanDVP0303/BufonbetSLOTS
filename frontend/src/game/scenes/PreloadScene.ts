import Phaser from "phaser";
import { SYMBOL_SIZE, TEX } from "../constants";
import type { RuntimeConfig } from "../config";

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
      // Los GIF NO se cargan en Phaser (los animaría estáticos): se pintan como <img>
      // HTML detrás del canvas. Solo las imágenes ESTÁTICAS van como textura de Phaser.
      const isGifBg = !!a.background && a.background.toLowerCase().endsWith(".gif");
      if (a.background && !isGifBg) this.load.image(TEX.bg, a.background);
      if (a.logo) this.load.image(TEX.logo, a.logo);
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
    }

    // Si un asset falla (404), Phaser sigue y se usa el placeholder.
    this.load.on("loaderror", (file: Phaser.Loader.File) =>
      console.warn("No se pudo cargar el asset:", file.key)
    );

    const cx = this.scale.width / 2;
    const cy = this.scale.height / 2;
    const barW = Math.min(this.scale.width * 0.6, 360);
    this.add.rectangle(cx, cy, barW, 8, 0xffffff, 0.12);
    const bar = this.add.rectangle(cx - barW / 2, cy, 0, 8, 0x06d6a0).setOrigin(0, 0.5);
    this.load.on("progress", (p: number) => bar.setSize(barW * p, 8));
  }

  create() {
    this.generatePlaceholderTextures();
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

    g.fillStyle(0xffffff, 1).fillRoundedRect(0, 0, 300, 100, 50);
    g.generateTexture(TEX.button, 300, 100);

    g.destroy();
  }
}
