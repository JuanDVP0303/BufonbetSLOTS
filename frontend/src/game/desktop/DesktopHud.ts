/**
 * HUD del modo escritorio/horizontal: barra "glass" centrada con tres grupos
 *   izquierda: INFO · MENÚ · SONIDO
 *   centro:    CRÉDITO · [− APUESTA +] · GANANCIA
 *   derecha:   TURBO · AUTO · GIRAR (grande, sobresale de la barra)
 * + texto de ayuda de turbo + banner "GANASTE".
 *
 * Se construye UNA vez; `layout()` solo reposiciona (resize sin recrear objetos).
 * Sin tweens infinitos salvo el brillo del botón de girar, que corre SOLO en
 * reposo (se pausa mientras gira). Los montos son BitmapText (sin regenerar
 * texturas canvas en cada cambio).
 */
import Phaser from "phaser";
import { TEX } from "../constants";
import { CONFIG_DESKTOP, DESKTOP_FONT } from "./configDesktop";
import type { DesktopLayout, Rect, Spot } from "./layoutDesktop";

export interface TextLike {
  setText(value: string): unknown;
}

export interface HudCallbacks {
  onSpin(): void;
  onBet(dir: number): void;
  onAuto(): void;
  onTurbo(): void;
  onMusic(): void;
  onInfo(): void;
}

const D = CONFIG_DESKTOP;
const BTN = D.buttons;

/**
 * Quita los tweens de un objeto de forma SEGURA: `remove()` difiere la baja si el
 * TweenManager está procesando (a diferencia de killTweensOf(), que destruye el
 * tween en el acto y rompe si se llama desde el onComplete de ese mismo tween).
 */
export function removeTweensOf(scene: Phaser.Scene, target: object) {
  for (const t of scene.tweens.getTweensOf(target)) t.remove();
}

interface ButtonOpts {
  glyph: string;
  tooltip?: string;
  onClick?: () => void; // sin onClick = stub (visible, con tooltip, sin cursor de mano)
  texOn?: string;
  texOff?: string;
  spinDisc?: boolean; // botón de girar sin imagen del tema: disco + anillo dorado
  toggle?: boolean; // tiene estado activo/inactivo (se marca con halo, no apagándolo)
}

/** Botón con hover (escala), press (escala), estado activo/inactivo y deshabilitado. */
class HudButton {
  readonly root: Phaser.GameObjects.Container;
  readonly visual: Phaser.GameObjects.Container;
  private zone: Phaser.GameObjects.Zone;
  private gfx?: Phaser.GameObjects.Graphics;
  private img?: Phaser.GameObjects.Image;
  private glyph?: Phaser.GameObjects.Text;
  private tip?: Phaser.GameObjects.Text;
  // Toggles (turbo/auto/sonido): halo de luz estático detrás cuando están ACTIVOS.
  private halo?: Phaser.GameObjects.Image;
  private size = 0;
  private active = true;
  private enabled = true;
  private hovered = false;
  private texOn?: string;
  private texOff?: string;
  // Tweens propios de escala/tooltip: se reemplazan (no se acumulan) y NO tocan la
  // rotación de "girando" que la barra aplica al mismo `visual`.
  private scaleTween?: Phaser.Tweens.Tween;
  private tipTween?: Phaser.Tweens.Tween;

  constructor(private scene: Phaser.Scene, private opts: ButtonOpts, texts: Phaser.GameObjects.Text[]) {
    const has = (k?: string) => !!k && scene.textures.exists(k);
    const onAvail = has(opts.texOn);
    const offAvail = has(opts.texOff);
    if (onAvail || offAvail) {
      this.texOn = onAvail ? opts.texOn : opts.texOff;
      this.texOff = offAvail ? opts.texOff : opts.texOn;
    }
    this.root = scene.add.container(0, 0).setDepth(D.depth.hud);
    this.visual = scene.add.container(0, 0);
    if (opts.toggle) {
      this.halo = scene.add.image(0, 0, TEX.glow).setBlendMode(Phaser.BlendModes.ADD).setTint(BTN.activeHaloColor).setVisible(false);
      this.root.add(this.halo);
    }
    this.root.add(this.visual);
    if (this.texOn) {
      this.img = scene.add.image(0, 0, this.texOn);
      this.visual.add(this.img);
    } else {
      this.gfx = scene.add.graphics();
      this.glyph = scene.add
        .text(0, -1, opts.glyph, { fontFamily: DESKTOP_FONT, fontStyle: "800", color: "#ffffff" })
        .setOrigin(0.5)
        .setShadow(0, 2, "#000000", 3, true, true);
      texts.push(this.glyph);
      this.visual.add([this.gfx, this.glyph]);
    }
    this.zone = scene.add.zone(0, 0, 10, 10);
    this.root.add(this.zone);
    const interactive = !!opts.onClick;
    this.zone.setInteractive({ useHandCursor: interactive });
    if (opts.tooltip) {
      this.tip = scene.add
        .text(0, 0, opts.tooltip, {
          fontFamily: DESKTOP_FONT,
          fontSize: `${BTN.tooltipSize}px`,
          fontStyle: "700",
          color: "#ffffff",
          backgroundColor: "#140828e6",
          padding: { x: 9, y: 4 },
        })
        .setOrigin(0.5, 1)
        .setAlpha(0);
      texts.push(this.tip);
      this.root.add(this.tip);
    }
    this.zone.on("pointerover", () => {
      this.hovered = true;
      this.tipTo(1);
      if (this.enabled) this.scaleTo(BTN.hoverScale);
    });
    this.zone.on("pointerout", () => {
      this.hovered = false;
      this.tipTo(0);
      this.scaleTo(1);
    });
    if (interactive) {
      this.zone.on("pointerdown", () => {
        if (!this.enabled) return;
        this.scaleTween?.remove();
        this.visual.setScale(BTN.pressScale);
        opts.onClick!();
      });
      this.zone.on("pointerup", () => this.scaleTo(this.hovered && this.enabled ? BTN.hoverScale : 1));
    }
  }

  private scaleTo(scale: number) {
    this.scaleTween?.remove();
    this.scaleTween = this.scene.tweens.add({ targets: this.visual, scale, duration: BTN.tweenMs, ease: "Sine.easeOut" });
  }

  private tipTo(alpha: number) {
    if (!this.tip) return;
    this.tipTween?.remove();
    this.tipTween = this.scene.tweens.add({ targets: this.tip, alpha, duration: BTN.tweenMs });
  }

  /** Feedback visual de "presionado" sin clic (p. ej. al girar con ESPACIO). */
  flashPress() {
    if (!this.enabled) return;
    this.scaleTween?.remove();
    this.visual.setScale(BTN.pressScale);
    this.scaleTo(this.hovered ? BTN.hoverScale : 1);
  }

  place(cx: number, cy: number, size: number) {
    this.root.setPosition(cx, cy);
    if (size !== this.size) {
      this.size = size;
      this.zone.setSize(size * 1.06, size * 1.06); // también ajusta el hitArea
      if (this.glyph) this.glyph.setFontSize(Math.round(size * (this.opts.spinDisc ? 0.62 : 0.5)));
      if (this.tip) this.tip.setPosition(0, -size / 2 - 10);
      this.halo?.setDisplaySize(size * 1.9, size * 1.9);
      this.redraw();
    }
  }

  private redraw() {
    const s = this.size;
    // Activo = halo de luz detrás (inactivo NO se apaga: se vería deshabilitado).
    this.halo?.setVisible(this.active).setAlpha(BTN.activeHaloAlpha);
    if (this.img) {
      const key = this.active ? this.texOn! : this.texOff!;
      this.img.setTexture(key);
      const src = this.img.texture.getSourceImage();
      this.img.setScale(Math.min(s / src.width, s / src.height));
      return;
    }
    const g = this.gfx!;
    g.clear();
    if (this.opts.spinDisc) {
      const r = s / 2;
      g.fillStyle(0x0b0f1a, 0.62).fillCircle(0, 0, r);
      g.lineStyle(Math.max(3, r * 0.06), 0xffd23f, 0.95).strokeCircle(0, 0, r * 1.02);
      g.lineStyle(Math.max(1.5, r * 0.03), 0xffffff, 0.4);
      g.beginPath();
      g.arc(0, 0, r * 0.84, Math.PI * 1.08, Math.PI * 1.92, false);
      g.strokePath();
      return;
    }
    // "Candy": cuadrado redondeado verde glossy (mismo lenguaje que el arte del pack).
    const h = s / 2;
    const rad = s * 0.24;
    const on = this.active || !this.opts.toggle;
    const top = on ? BTN.candyTop : BTN.candyOffTop;
    const bottom = on ? BTN.candyBottom : BTN.candyOffBottom;
    g.fillStyle(0x000000, 0.25).fillRoundedRect(-h, -h + s * 0.06, s, s, rad);
    g.fillGradientStyle(top, top, bottom, bottom, 1).fillRoundedRect(-h, -h, s, s, rad);
    g.fillStyle(0xffffff, 0.22).fillRoundedRect(-h * 0.82, -h * 0.8, s * 0.82, s * 0.3, rad * 0.7);
    g.lineStyle(Math.max(2, s * 0.045), BTN.candyBorder, 0.95).strokeRoundedRect(-h, -h, s, s, rad);
    this.glyph?.setColor(this.active && this.opts.toggle ? "#fff36b" : "#ffffff");
  }

  setActive(on: boolean) {
    if (this.active === on) return;
    this.active = on;
    this.redraw();
  }

  setEnabled(on: boolean) {
    if (this.enabled === on) return;
    this.enabled = on;
    this.visual.setAlpha(on ? 1 : BTN.disabledAlpha);
    if (this.zone.input) this.zone.input.cursor = on && this.opts.onClick ? "pointer" : "default";
    if (this.hovered) {
      this.scene.input.manager.canvas.style.cursor = on && this.opts.onClick ? "pointer" : "default";
      this.scaleTo(on ? BTN.hoverScale : 1);
    }
  }
}

/** Caja CRÉDITO / APUESTA / GANANCIA: etiqueta (Text estático) + monto (BitmapText). */
class ValueBox {
  readonly root: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  readonly value: Phaser.GameObjects.BitmapText;
  private maxW = 100;
  private rect?: Rect;

  constructor(private scene: Phaser.Scene, labelText: string, labelColor: string, gold: boolean, texts: Phaser.GameObjects.Text[]) {
    this.root = scene.add.container(0, 0).setDepth(D.depth.hud);
    this.bg = scene.add.graphics();
    this.label = scene.add
      .text(0, 0, labelText, {
        fontFamily: DESKTOP_FONT,
        fontSize: `${D.bar.labelSize}px`,
        fontStyle: "800",
        color: labelColor,
      })
      .setOrigin(0.5)
      .setShadow(0, 2, "#000000", 3, true, true);
    texts.push(this.label);
    this.value = scene.add.bitmapText(0, 0, D.text.bitmapFontKey, "", D.bar.valueSize).setOrigin(0.5);
    if (gold) this.value.setTint(D.text.goldTop, D.text.goldTop, D.text.goldBottom, D.text.goldBottom);
    this.root.add([this.bg, this.label, this.value]);
  }

  place(r: Rect) {
    const same = this.rect && this.rect.x === r.x && this.rect.y === r.y && this.rect.w === r.w && this.rect.h === r.h;
    this.rect = { ...r };
    this.root.setPosition(r.x + r.w / 2, r.y + r.h / 2);
    if (same) return;
    const B = D.bar;
    this.bg.clear();
    this.bg.fillStyle(B.boxFill, B.boxFillAlpha).fillRoundedRect(-r.w / 2, -r.h / 2, r.w, r.h, 16);
    this.bg.lineStyle(1.5, 0xffffff, B.boxBorderAlpha).strokeRoundedRect(-r.w / 2, -r.h / 2, r.w, r.h, 16);
    this.label.setPosition(0, -r.h * 0.25);
    this.value.setPosition(0, r.h * 0.15);
    this.maxW = r.w - 16;
    this.fit();
  }

  /** Reduce el monto si no entra en la caja (saldos muy largos). */
  private fit() {
    this.value.setScale(1);
    const w = this.value.width;
    if (w > this.maxW) this.value.setScale(this.maxW / w);
  }

  readonly text: TextLike = {
    setText: (v: string) => {
      this.value.setText(v);
      this.fit();
    },
  };

  pulse() {
    removeTweensOf(this.scene, this.root);
    this.root.setScale(1);
    this.scene.tweens.add({ targets: this.root, scale: 1.06, duration: 120, yoyo: true, ease: "Sine.easeOut" });
  }
}

export class DesktopHud {
  private texts: Phaser.GameObjects.Text[] = [];
  private barGfx: Phaser.GameObjects.Graphics;
  private hint: Phaser.GameObjects.Text;
  private info: HudButton;
  private menu: HudButton;
  private sound: HudButton;
  private turbo: HudButton;
  private auto: HudButton;
  private spin: HudButton;
  private minus: HudButton;
  private plus: HudButton;
  private spinGlow: Phaser.GameObjects.Image;
  private glowTween: Phaser.Tweens.Tween;
  private busyTween?: Phaser.Tweens.Tween;
  private busy = false;
  readonly credit: ValueBox;
  readonly bet: ValueBox;
  readonly win: ValueBox;
  // Banner "GANASTE" (premio normal).
  private banner: Phaser.GameObjects.Container;
  private bannerBg: Phaser.GameObjects.Graphics;
  private bannerLabel: Phaser.GameObjects.Text;
  private bannerValue: Phaser.GameObjects.BitmapText;
  private bannerMaxW = 400;
  private barRect?: Rect;

  constructor(private scene: Phaser.Scene, cb: HudCallbacks, accent: number) {
    this.barGfx = scene.add.graphics().setDepth(D.depth.hud - 1);
    this.hint = scene.add
      .text(0, 0, D.hint.text, {
        fontFamily: DESKTOP_FONT,
        fontSize: `${D.hint.size}px`,
        fontStyle: "700",
        color: "#ffffff",
      })
      .setOrigin(0.5)
      .setAlpha(D.hint.alpha)
      .setShadow(0, 1, "#000000", 3, true, true)
      .setDepth(D.depth.hud);
    this.texts.push(this.hint);

    const t = this.texts;
    this.info = new HudButton(scene, { glyph: "i", tooltip: "INFO", onClick: cb.onInfo }, t);
    // MENÚ: sin funcionalidad todavía (igual que antes): visible, con tooltip, sin acción.
    this.menu = new HudButton(scene, { glyph: "≡", tooltip: "MENÚ" }, t);
    this.sound = new HudButton(scene, { glyph: "♪", tooltip: "SONIDO (M)", onClick: cb.onMusic, texOn: TEX.musicOn, texOff: TEX.musicOff, toggle: true }, t);
    this.turbo = new HudButton(scene, { glyph: "⚡", tooltip: "TURBO", onClick: cb.onTurbo, texOn: TEX.turboOn, texOff: TEX.turboOff, toggle: true }, t);
    this.auto = new HudButton(scene, { glyph: "∞", tooltip: "AUTO", onClick: cb.onAuto, texOn: TEX.autoOn, texOff: TEX.autoOff, toggle: true }, t);

    // Brillo del giro: sprite pre-renderizado (TEX.glow) en ADD; su tween es el ÚNICO
    // bucle infinito del HUD y se pausa mientras gira.
    this.spinGlow = scene.add
      .image(0, 0, TEX.glow)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(accent)
      .setAlpha(D.spin.glowAlphaMin)
      .setDepth(D.depth.hud - 1);
    this.glowTween = scene.tweens.add({
      targets: this.spinGlow,
      alpha: D.spin.glowAlphaMax,
      duration: D.spin.glowPulseMs,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    this.spin = new HudButton(scene, { glyph: "⟳", onClick: cb.onSpin, texOn: TEX.spinBtn, texOff: TEX.spinBtn, spinDisc: !scene.textures.exists(TEX.spinBtn) }, t);
    this.spin.root.setDepth(D.depth.hud + 1);

    this.minus = new HudButton(scene, { glyph: "−", onClick: () => cb.onBet(-1), texOn: TEX.betMinus, texOff: TEX.betMinus }, t);
    this.plus = new HudButton(scene, { glyph: "+", onClick: () => cb.onBet(1), texOn: TEX.betPlus, texOff: TEX.betPlus }, t);

    this.credit = new ValueBox(scene, "CRÉDITO", "#b6f56b", false, t);
    this.bet = new ValueBox(scene, "APUESTA", "#ffd23f", false, t);
    this.win = new ValueBox(scene, "GANANCIA", "#ff8fd0", true, t);

    // Banner GANASTE (reutilizado en cada premio: setText, nunca se recrea).
    this.bannerBg = scene.add.graphics();
    this.bannerLabel = scene.add
      .text(0, 0, "GANASTE", {
        fontFamily: DESKTOP_FONT,
        fontSize: `${D.winBanner.labelSize}px`,
        fontStyle: "800",
        color: "#ffffff",
      })
      .setOrigin(1, 0.5)
      .setStroke("#2b1604", 5)
      .setShadow(0, 2, "#000000", 4, true, true);
    this.texts.push(this.bannerLabel);
    this.bannerValue = scene.add
      .bitmapText(0, 0, D.text.bitmapFontKey, "", D.winBanner.valueSize)
      .setOrigin(0, 0.5)
      .setTint(D.text.goldTop, D.text.goldTop, D.text.goldBottom, D.text.goldBottom);
    this.banner = scene.add
      .container(0, 0, [this.bannerBg, this.bannerLabel, this.bannerValue])
      .setDepth(D.depth.winBanner)
      .setVisible(false);
  }

  /** Reposiciona todo según el layout calculado (sin recrear objetos). */
  layout(L: DesktopLayout) {
    const b = L.bar;
    this.drawBar(b.rect);
    this.hint.setPosition(b.hint.cx, b.hint.cy);
    const placeSpot = (btn: HudButton, s: Spot) => btn.place(s.cx, s.cy, s.size);
    placeSpot(this.info, b.info);
    placeSpot(this.menu, b.menu);
    placeSpot(this.sound, b.sound);
    placeSpot(this.turbo, b.turbo);
    placeSpot(this.auto, b.auto);
    placeSpot(this.minus, b.minus);
    placeSpot(this.plus, b.plus);
    this.spin.place(b.spin.cx, b.spin.cy, b.spin.r * 2);
    const glowD = b.spin.r * 2 * D.spin.glowScale;
    this.spinGlow.setPosition(b.spin.cx, b.spin.cy).setDisplaySize(glowD, glowD);
    this.credit.place(b.credit);
    this.bet.place(b.bet);
    this.win.place(b.win);
    this.banner.setPosition(L.winBanner.cx, L.winBanner.cy);
    this.bannerMaxW = L.winBanner.maxW;
  }

  private drawBar(r: Rect) {
    const prev = this.barRect;
    if (prev && prev.x === r.x && prev.y === r.y && prev.w === r.w && prev.h === r.h) return;
    this.barRect = { ...r };
    const B = D.bar;
    const g = this.barGfx;
    g.clear();
    g.fillStyle(0x000000, B.shadowAlpha).fillRoundedRect(r.x, r.y + 6, r.w, r.h, B.radius);
    g.fillGradientStyle(B.fillTop, B.fillTop, B.fillBottom, B.fillBottom, B.fillAlpha).fillRoundedRect(r.x, r.y, r.w, r.h, B.radius);
    g.fillStyle(0xffffff, B.highlightAlpha).fillRoundedRect(r.x + 8, r.y + 4, r.w - 16, r.h * 0.38, B.radius * 0.8);
    g.lineStyle(B.borderWidth, B.borderColor, B.borderAlpha).strokeRoundedRect(r.x, r.y, r.w, r.h, B.radius);
  }

  /** Nitidez de los Text del HUD al cambiar la resolución interna (zoom de cámara). */
  setTextResolution(res: number) {
    for (const t of this.texts) if (t.style.resolution !== res) t.setResolution(res);
  }

  /** Estado "girando": giro y −/+ deshabilitados, brillo apagado, icono rotando. */
  setBusy(busy: boolean) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.spin.setEnabled(!busy);
    this.minus.setEnabled(!busy);
    this.plus.setEnabled(!busy);
    this.spin.visual.setAlpha(busy ? D.spin.busyAlpha : 1);
    this.busyTween?.remove();
    this.busyTween = undefined;
    if (busy) {
      this.glowTween.pause();
      this.spinGlow.setVisible(false);
      this.busyTween = this.scene.tweens.add({
        targets: this.spin.visual,
        angle: "+=360",
        duration: D.spin.busyRotateMs,
        repeat: -1,
        ease: "Linear",
      });
    } else {
      this.spin.visual.setAngle(0);
      this.spinGlow.setVisible(true);
      this.glowTween.resume();
    }
  }

  setTurbo(on: boolean) {
    this.turbo.setActive(on);
  }
  setAuto(on: boolean) {
    this.auto.setActive(on);
  }
  setMusic(on: boolean) {
    this.sound.setActive(on);
  }
  /** Al girar con el teclado, el botón también "se presiona". */
  pressSpin() {
    this.spin.flashPress();
  }

  /** Muestra el banner GANASTE y devuelve el destino del conteo animado. */
  showWinBanner(): TextLike {
    const fit = () => {
      this.bannerValue.setScale(1);
      const gap = 14;
      const labelW = this.bannerLabel.width;
      const maxValueW = this.bannerMaxW - labelW - gap - 56;
      if (this.bannerValue.width > maxValueW) this.bannerValue.setScale(maxValueW / this.bannerValue.width);
      const total = labelW + gap + this.bannerValue.width * this.bannerValue.scaleX;
      this.bannerLabel.setX(-total / 2 + labelW);
      this.bannerValue.setX(-total / 2 + labelW + gap);
      const w = total + 56;
      const h = D.winBanner.height;
      this.bannerBg.clear();
      this.bannerBg.fillStyle(0x12062a, 0.86).fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      this.bannerBg.lineStyle(3, 0xff8fd0, 0.9).strokeRoundedRect(-w / 2, -h / 2, w, h, h / 2);
      this.bannerBg.lineStyle(1.5, 0xffd23f, 0.6).strokeRoundedRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, h / 2 - 5);
    };
    removeTweensOf(this.scene, this.banner);
    this.banner.setVisible(true).setAlpha(1).setScale(0.6);
    this.scene.tweens.add({ targets: this.banner, scale: 1, duration: 320, ease: "Back.easeOut" });
    return {
      setText: (v: string) => {
        this.bannerValue.setText(v);
        fit();
      },
    };
  }

  hideWinBanner() {
    removeTweensOf(this.scene, this.banner);
    this.banner.setVisible(false);
  }
}
